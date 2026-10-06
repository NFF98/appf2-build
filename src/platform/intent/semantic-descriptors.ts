import { CAPABILITY_REGISTRY_SOURCE } from "../capabilities/registry.js";
import {
  IMPACT_LEVELS,
  INTENT_SOURCES,
  POLICY_ITEM_COLLECTIONS,
  VALUE_TYPES,
  ephemeralRequirementsOf,
  type StructuredIntentEnvelope
} from "./intent-contract.js";
import { isPlainRecord } from "./json-value.js";

type UnknownRecord = Readonly<Record<string, unknown>>;
export type AddViolation = (path: string, reason: string) => void;

/** F01-DATA-001A canonical semantic ID grammar for descriptors and hints. */
export const SEMANTIC_ID_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const MAX_TEXT_CODE_POINTS = 512;
const MAX_TYPE_TOKENS = 16;

const DESCRIPTOR_FIELDS = { required: ["id", "semantic_role", "description", "source"], optional: ["source_ref"] } as const;
const OUTPUT_FIELDS = {
  required: [...DESCRIPTOR_FIELDS.required, "output_type", "required"],
  optional: DESCRIPTOR_FIELDS.optional
} as const;
const HINT_FIELDS = {
  required: [
    "hint_id",
    "semantic_need",
    "required",
    "impact_level",
    "input_types",
    "output_types",
    "interaction_class",
    "constraint_item_ids",
    "source_item_ids"
  ],
  optional: []
} as const;
const SOURCE_REF_FIELDS = ["policy_id", "policy_version", "origin_item_id"] as const;

/**
 * Pinned F04 compiler catalog vocabulary. `interaction_class` must be an existing catalog
 * `intent_classes[]` token; Capability IDs and runtime handler identities must never leak into
 * `semantic_need`.
 */
export const COMPILER_CATALOG_INTENT_CLASSES: ReadonlySet<string> = new Set(
  CAPABILITY_REGISTRY_SOURCE.capabilities.flatMap((definition) => definition.semantic.intentClasses)
);
const FORBIDDEN_CATALOG_IDENTITIES: readonly string[] = CAPABILITY_REGISTRY_SOURCE.capabilities
  .flatMap((definition) => [definition.id, definition.runtime.registrationKey])
  .map((identity) => identity.toLowerCase());

const PROVIDER_METADATA = /\b(?:openai|anthropic|claude|gpt-?[0-9a-z.]*|gemini|groq|llama|mistral|provider_model|model_adapter)\b/i;
const EXECUTABLE_CODE = /=>|[{}]|<\/?script|\bfunction\s*\(|\bimport\s|\brequire\s*\(|\beval\s*\(|\bnew\s+Function\b/i;
const MODULE_PATH = /node_modules|(?:^|[\s"'(])(?:\.{1,2}\/|\/)?(?:src|generated|lib)\/|\.(?:m?[jt]sx?|json)\b/i;

const codePointLength = (text: string): number => Array.from(text).length;

function checkClosedKeys(
  record: UnknownRecord,
  fields: { readonly required: readonly string[]; readonly optional: readonly string[] },
  path: string,
  add: AddViolation
): void {
  const allowed = new Set([...fields.required, ...fields.optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) add(`${path}.${key}`, "UNKNOWN_FIELD");
  }
  for (const key of fields.required) {
    if (!Object.hasOwn(record, key)) add(`${path}.${key}`, "MISSING_FIELD");
  }
}

function checkSemanticId(value: unknown, path: string, add: AddViolation): void {
  if (typeof value !== "string" || !SEMANTIC_ID_PATTERN.test(value)) add(path, "INVALID_SEMANTIC_ID");
}

function checkBoundedText(value: unknown, path: string, add: AddViolation): void {
  if (typeof value !== "string") {
    add(path, "INVALID_STRING");
    return;
  }
  const length = codePointLength(value.trim());
  if (length < 1 || length > MAX_TEXT_CODE_POINTS) add(path, "TEXT_LENGTH_OUT_OF_BOUNDS");
}

function checkEnum(value: unknown, allowed: readonly string[], path: string, add: AddViolation): void {
  if (typeof value !== "string" || !allowed.includes(value)) add(path, "INVALID_ENUM");
}

function checkSourceRef(value: unknown, path: string, add: AddViolation): void {
  if (value === undefined) return;
  if (!isPlainRecord(value)) {
    add(path, "INVALID_SOURCE_REF");
    return;
  }
  checkClosedKeys(value, { required: [], optional: SOURCE_REF_FIELDS }, path, add);
  for (const key of SOURCE_REF_FIELDS) {
    if (value[key] !== undefined && (typeof value[key] !== "string" || value[key] === "")) add(`${path}.${key}`, "INVALID_STRING");
  }
}

function validateDescriptor(value: unknown, path: string, output: boolean, add: AddViolation): void {
  if (!isPlainRecord(value)) {
    add(path, "INVALID_DESCRIPTOR");
    return;
  }
  checkClosedKeys(value, output ? OUTPUT_FIELDS : DESCRIPTOR_FIELDS, path, add);
  checkSemanticId(value.id, `${path}.id`, add);
  if (typeof value.semantic_role !== "string" || value.semantic_role === "") add(`${path}.semantic_role`, "INVALID_STRING");
  checkBoundedText(value.description, `${path}.description`, add);
  checkEnum(value.source, INTENT_SOURCES, `${path}.source`, add);
  checkSourceRef(value.source_ref, `${path}.source_ref`, add);
  if (!output) return;
  checkEnum(value.output_type, VALUE_TYPES, `${path}.output_type`, add);
  if (typeof value.required !== "boolean") add(`${path}.required`, "INVALID_BOOLEAN");
}

function checkTypeTokens(value: unknown, path: string, add: AddViolation): void {
  if (!Array.isArray(value) || !value.every((token) => typeof token === "string" && (VALUE_TYPES as readonly string[]).includes(token))) {
    add(path, "INVALID_VALUE_TYPE_TOKENS");
  } else if (value.length > MAX_TYPE_TOKENS) {
    add(path, "TOO_MANY_VALUE_TYPE_TOKENS");
  } else if (new Set(value).size !== value.length) {
    add(path, "DUPLICATE_ENTRY");
  }
}

function checkIdRefs(value: unknown, path: string, add: AddViolation): void {
  if (!Array.isArray(value) || !value.every((id) => typeof id === "string" && id !== "")) add(path, "INVALID_STRING_ARRAY");
  else if (new Set(value).size !== value.length) add(path, "DUPLICATE_ENTRY");
}

/** `semantic_need` must stay semantic: no provider/model metadata, Capability ID, code, module path or handler identity. */
export function semanticNeedLeak(text: string): string | null {
  const lower = text.toLowerCase();
  if (FORBIDDEN_CATALOG_IDENTITIES.some((identity) => lower.includes(identity))) return "CAPABILITY_IDENTITY_IN_SEMANTIC_NEED";
  if (PROVIDER_METADATA.test(text)) return "PROVIDER_METADATA_IN_SEMANTIC_NEED";
  if (EXECUTABLE_CODE.test(text)) return "CODE_IN_SEMANTIC_NEED";
  if (MODULE_PATH.test(text)) return "MODULE_PATH_IN_SEMANTIC_NEED";
  return null;
}

function validateHint(value: unknown, path: string, add: AddViolation): void {
  if (!isPlainRecord(value)) {
    add(path, "INVALID_CAPABILITY_HINT");
    return;
  }
  checkClosedKeys(value, HINT_FIELDS, path, add);
  checkSemanticId(value.hint_id, `${path}.hint_id`, add);
  checkBoundedText(value.semantic_need, `${path}.semantic_need`, add);
  if (typeof value.semantic_need === "string") {
    const leak = semanticNeedLeak(value.semantic_need);
    if (leak !== null) add(`${path}.semantic_need`, leak);
  }
  if (typeof value.required !== "boolean") add(`${path}.required`, "INVALID_BOOLEAN");
  checkEnum(value.impact_level, IMPACT_LEVELS, `${path}.impact_level`, add);
  checkTypeTokens(value.input_types, `${path}.input_types`, add);
  checkTypeTokens(value.output_types, `${path}.output_types`, add);
  if (typeof value.interaction_class !== "string" || !COMPILER_CATALOG_INTENT_CLASSES.has(value.interaction_class)) {
    add(`${path}.interaction_class`, "UNKNOWN_INTERACTION_CLASS");
  }
  checkIdRefs(value.constraint_item_ids, `${path}.constraint_item_ids`, add);
  checkIdRefs(value.source_item_ids, `${path}.source_item_ids`, add);
}

/** Shape-level F01-DATA-001A validation of the four descriptor / hint arrays. */
export function validateDescriptorShapes(record: UnknownRecord, add: AddViolation): void {
  for (const key of ["actors", "entities"] as const) {
    const values = record[key];
    if (!Array.isArray(values)) add(`$.${key}`, "INVALID_ARRAY");
    else values.forEach((value, index) => validateDescriptor(value, `$.${key}[${index}]`, false, add));
  }
  const outputs = record.requested_outputs;
  if (!Array.isArray(outputs)) add("$.requested_outputs", "INVALID_ARRAY");
  else outputs.forEach((value, index) => validateDescriptor(value, `$.requested_outputs[${index}]`, true, add));
  const hints = record.capability_hints;
  if (!Array.isArray(hints)) add("$.capability_hints", "INVALID_ARRAY");
  else hints.forEach((value, index) => validateHint(value, `$.capability_hints[${index}]`, add));
}

function descriptorIds(envelope: StructuredIntentEnvelope): { readonly id: string; readonly path: string }[] {
  return [
    ...envelope.actors.map((descriptor, index) => ({ id: descriptor.id, path: `$.actors[${index}].id` })),
    ...envelope.entities.map((descriptor, index) => ({ id: descriptor.id, path: `$.entities[${index}].id` })),
    ...envelope.requested_outputs.map((descriptor, index) => ({ id: descriptor.id, path: `$.requested_outputs[${index}].id` })),
    ...envelope.capability_hints.map((hint, index) => ({ id: hint.hint_id, path: `$.capability_hints[${index}].hint_id` }))
  ];
}

/**
 * Identity / reference invariants that need the whole Envelope: descriptor and hint IDs are unique and never
 * collide with policy-visible item or KnownInput IDs; `constraint_item_ids[]` reference same-Envelope
 * constraint items; `source_item_ids[]` reference policy-visible items, KnownInputs or descriptors. A BF-050
 * DO_NOT_PERSIST marker keeps its KnownInput's stable ID, so it counts as a KnownInput here.
 */
export function checkDescriptorReferences(envelope: StructuredIntentEnvelope, add: AddViolation): void {
  const policyIds = new Set(POLICY_ITEM_COLLECTIONS.flatMap((collection) => envelope[collection].map((item) => item.id)));
  const knownInputIds = new Set([...envelope.known_inputs, ...ephemeralRequirementsOf(envelope)].map((input) => input.id));
  const constraintIds = new Set(envelope.constraints.map((item) => item.id));
  const seen = new Set<string>();
  for (const { id, path } of descriptorIds(envelope)) {
    if (policyIds.has(id) || knownInputIds.has(id)) add(path, "SEMANTIC_ID_COLLISION");
    else if (seen.has(id)) add(path, "DUPLICATE_SEMANTIC_ID");
    seen.add(id);
  }
  const descriptorOnly = new Set([...envelope.actors, ...envelope.entities, ...envelope.requested_outputs].map((descriptor) => descriptor.id));
  envelope.capability_hints.forEach((hint, index) => {
    const path = `$.capability_hints[${index}]`;
    for (const id of hint.constraint_item_ids) {
      if (!constraintIds.has(id)) add(`${path}.constraint_item_ids`, "UNKNOWN_CONSTRAINT_ITEM_REF");
    }
    for (const id of hint.source_item_ids) {
      if (!policyIds.has(id) && !knownInputIds.has(id) && !descriptorOnly.has(id)) add(`${path}.source_item_ids`, "UNKNOWN_SOURCE_ITEM_REF");
    }
  });
}
