import { DependencyGraph } from "./dependency-graph.js";
import {
  F01_CLARIFICATION_POLICY_VERSION,
  IMPACT_LEVELS,
  INTENT_SOURCES,
  IntentContractError,
  MATERIALITY_LEVELS,
  POLICY_ITEM_COLLECTIONS,
  POLICY_RISK_FLAGS,
  PROPOSAL_SOURCES,
  QUESTION_TYPES,
  QUESTION_VALUE_TYPE,
  RESOLUTION_STATES,
  SENSITIVITY_LEVELS,
  USER_DECISION_SOURCES,
  VALUE_TYPES,
  policyItemsOf,
  type IntentErrorCode,
  type IntentViolation,
  type KnownInput,
  type PolicyItemCollection,
  type PolicyVisibleItem,
  type StructuredIntentEnvelope
} from "./intent-contract.js";
import { isJsonValue, isPlainRecord } from "./json-value.js";
import { distinctCanonicalCount, isChoiceQuestion, valueFitsItem, valueMatchesType } from "./value-shape.js";

/**
 * UNTRUSTED_ANALYSIS = Prompt A output: may not carry server-owned policy state or assert a User
 * decision. TRUSTED = server-produced / server-persisted Envelope after a trusted transition.
 */
export type EnvelopeTrust = "UNTRUSTED_ANALYSIS" | "TRUSTED";

type UnknownRecord = Readonly<Record<string, unknown>>;

const ENVELOPE_FIELDS = [
  "envelope_version",
  "goal",
  "actors",
  "entities",
  "known_inputs",
  "constraints",
  "requested_outputs",
  "candidate_rules",
  "missing_fields",
  "ambiguities",
  "assumptions",
  "capability_hints",
  "analysis_metadata"
] as const;
const OPAQUE_ARRAY_FIELDS = ["actors", "entities", "requested_outputs", "capability_hints"] as const;
const ITEM_REQUIRED_FIELDS = [
  "id",
  "semantic_role",
  "description",
  "source",
  "resolution_state",
  "expected_value_type",
  "question_type",
  "required_for_execution",
  "impact_level",
  "materiality",
  "policy_risk_flags",
  "depends_on_ids",
  "confidence",
  "can_default",
  "alternatives",
  "user_visible",
  "rationale"
] as const;
const ITEM_OPTIONAL_FIELDS = ["source_ref", "resolved_value", "proposed_default"] as const;
const KNOWN_INPUT_REQUIRED_FIELDS = ["id", "key", "value", "value_type", "source", "sensitivity"] as const;
const KNOWN_INPUT_OPTIONAL_FIELDS = ["source_ref", "confidence"] as const;
const SOURCE_REF_FIELDS = ["policy_id", "policy_version", "origin_item_id"] as const;
const POLICY_STATE_FIELDS = ["policy_version", "answered_question_ids", "changed_semantic_item_ids"] as const;

class Violations {
  readonly list: IntentViolation[] = [];

  add(path: string, reason: string): void {
    this.list.push({ path, reason });
  }

  get count(): number {
    return this.list.length;
  }
}

const isNonEmptyString = (value: unknown): value is string => typeof value === "string" && value.length > 0;
const isFiniteNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function checkClosedKeys(
  record: UnknownRecord,
  fields: { readonly required: readonly string[]; readonly optional: readonly string[] },
  path: string,
  out: Violations
): void {
  const allowed = new Set([...fields.required, ...fields.optional]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) out.add(`${path}.${key}`, "UNKNOWN_FIELD");
  }
  for (const key of fields.required) {
    if (!Object.hasOwn(record, key)) out.add(`${path}.${key}`, "MISSING_FIELD");
  }
}

function checkEnum(value: unknown, allowed: readonly string[], path: string, out: Violations): void {
  if (typeof value !== "string" || !allowed.includes(value)) out.add(path, "INVALID_ENUM");
}

function checkIdList(value: unknown, path: string, out: Violations): void {
  if (!Array.isArray(value) || !value.every(isNonEmptyString)) out.add(path, "INVALID_STRING_ARRAY");
  else if (new Set(value).size !== value.length) out.add(path, "DUPLICATE_ENTRY");
}

function checkSourceRef(value: unknown, path: string, out: Violations): void {
  if (value === undefined) return;
  if (!isPlainRecord(value)) {
    out.add(path, "INVALID_SOURCE_REF");
    return;
  }
  checkClosedKeys(value, { required: [], optional: SOURCE_REF_FIELDS }, path, out);
  for (const key of SOURCE_REF_FIELDS) {
    if (value[key] !== undefined && !isNonEmptyString(value[key])) out.add(`${path}.${key}`, "INVALID_STRING");
  }
}

/** NFF_DEFAULT policy provenance is mandatory; Prompt A can never claim an accepted proposal. */
function checkProvenance(
  record: Pick<KnownInput, "source" | "source_ref">,
  path: string,
  trust: EnvelopeTrust,
  out: Violations
): void {
  const ref = record.source_ref;
  if (record.source === "NFF_DEFAULT" && !(isNonEmptyString(ref?.policy_id) && isNonEmptyString(ref?.policy_version))) {
    out.add(`${path}.source_ref`, "NFF_DEFAULT_POLICY_PROVENANCE_REQUIRED");
  }
  if (trust === "UNTRUSTED_ANALYSIS" && record.source === "USER_ACCEPTED_PROPOSAL") {
    out.add(`${path}.source`, "USER_DECISION_NOT_ASSERTABLE_BY_ANALYSIS");
  }
}

function checkItemFieldTypes(record: UnknownRecord, path: string, out: Violations): void {
  if (!isNonEmptyString(record.id)) out.add(`${path}.id`, "INVALID_ID");
  for (const key of ["semantic_role", "description", "rationale"] as const) {
    if (typeof record[key] !== "string") out.add(`${path}.${key}`, "INVALID_STRING");
  }
  checkEnum(record.source, INTENT_SOURCES, `${path}.source`, out);
  checkSourceRef(record.source_ref, `${path}.source_ref`, out);
  checkEnum(record.resolution_state, RESOLUTION_STATES, `${path}.resolution_state`, out);
  checkEnum(record.expected_value_type, VALUE_TYPES, `${path}.expected_value_type`, out);
  checkEnum(record.question_type, QUESTION_TYPES, `${path}.question_type`, out);
  checkEnum(record.impact_level, IMPACT_LEVELS, `${path}.impact_level`, out);
  checkEnum(record.materiality, MATERIALITY_LEVELS, `${path}.materiality`, out);
  for (const key of ["required_for_execution", "can_default", "user_visible"] as const) {
    if (typeof record[key] !== "boolean") out.add(`${path}.${key}`, "INVALID_BOOLEAN");
  }
  const flags = record.policy_risk_flags;
  if (!Array.isArray(flags) || !flags.every((flag) => POLICY_RISK_FLAGS.includes(flag))) {
    out.add(`${path}.policy_risk_flags`, "INVALID_RISK_FLAGS");
  } else if (new Set(flags).size !== flags.length) {
    out.add(`${path}.policy_risk_flags`, "DUPLICATE_ENTRY");
  }
  checkIdList(record.depends_on_ids, `${path}.depends_on_ids`, out);
  if (!isFiniteNumber(record.confidence)) out.add(`${path}.confidence`, "INVALID_NUMBER");
  if (!Array.isArray(record.alternatives)) out.add(`${path}.alternatives`, "INVALID_ARRAY");
}

/** F01-DATA-001 source ↔ resolution_state invariant. */
function checkSourceResolution(item: PolicyVisibleItem, path: string, trust: EnvelopeTrust, out: Violations): void {
  if (USER_DECISION_SOURCES.has(item.source) && item.resolution_state !== "CONFIRMED") {
    out.add(`${path}.resolution_state`, "USER_SOURCE_MUST_BE_CONFIRMED");
  }
  if (item.resolution_state === "PROPOSED" && !PROPOSAL_SOURCES.has(item.source)) {
    out.add(`${path}.source`, "PROPOSED_SOURCE_NOT_ALLOWED");
  }
  if (item.source === "LLM_PROPOSED" && item.resolution_state === "CONFIRMED") {
    out.add(`${path}.resolution_state`, "LLM_PROPOSAL_IS_NEVER_CONFIRMED_TRUTH");
  }
  if (trust === "UNTRUSTED_ANALYSIS" && PROPOSAL_SOURCES.has(item.source) && item.resolution_state !== "PROPOSED") {
    out.add(`${path}.resolution_state`, "PROPOSAL_MUST_BE_PROPOSED_BEFORE_USER_DECISION");
  }
}

/** F01-DATA-001 resolution_state ↔ resolved_value / proposed_default / can_default invariant. */
function checkStateValues(item: PolicyVisibleItem, path: string, out: Violations): void {
  const hasResolved = item.resolved_value !== undefined;
  const hasDefault = item.proposed_default !== undefined;
  const confirmed = item.resolution_state === "CONFIRMED";
  const proposed = item.resolution_state === "PROPOSED";
  if (confirmed !== hasResolved) {
    out.add(`${path}.resolved_value`, confirmed ? "CONFIRMED_REQUIRES_RESOLVED_VALUE" : "RESOLVED_VALUE_ONLY_FOR_CONFIRMED");
  }
  if (proposed !== hasDefault) {
    out.add(`${path}.proposed_default`, proposed ? "PROPOSED_REQUIRES_PROPOSED_DEFAULT" : "PROPOSED_DEFAULT_ONLY_FOR_PROPOSED");
  }
  if (item.can_default && !proposed) out.add(`${path}.can_default`, "CAN_DEFAULT_ONLY_FOR_PROPOSED");
  if (item.can_default && !hasDefault) out.add(`${path}.proposed_default`, "SAFE_DEFAULT_VALUE_REQUIRED");
  if (hasResolved && !valueFitsItem(item.resolved_value!, item)) {
    out.add(`${path}.resolved_value`, "RESOLVED_VALUE_SHAPE_MISMATCH");
  }
  if (hasDefault && !valueFitsItem(item.proposed_default!, item)) {
    out.add(`${path}.proposed_default`, "PROPOSED_DEFAULT_SHAPE_MISMATCH");
  }
}

function checkAnswerShape(item: PolicyVisibleItem, collection: PolicyItemCollection, path: string, out: Violations): void {
  if (QUESTION_VALUE_TYPE[item.question_type] !== item.expected_value_type) {
    out.add(`${path}.question_type`, "QUESTION_VALUE_TYPE_MISMATCH");
  }
  if ((isChoiceQuestion(item) || collection === "ambiguities") && distinctCanonicalCount(item.alternatives) < 2) {
    out.add(`${path}.alternatives`, "AT_LEAST_TWO_DISTINCT_ALTERNATIVES_REQUIRED");
  }
}

/** COSMETIC is presentation-only; any risk flag or execution requirement makes an item MATERIAL. */
function checkMateriality(item: PolicyVisibleItem, path: string, out: Violations): void {
  if (item.materiality !== "COSMETIC") return;
  if (item.required_for_execution) out.add(`${path}.required_for_execution`, "COSMETIC_CANNOT_BE_REQUIRED");
  if (item.policy_risk_flags.length > 0) out.add(`${path}.policy_risk_flags`, "RISK_ITEM_MUST_BE_MATERIAL");
}

type ItemLocation = { readonly collection: PolicyItemCollection; readonly path: string };

function validateItem(value: unknown, location: ItemLocation, trust: EnvelopeTrust, out: Violations): void {
  const { collection, path } = location;
  if (!isPlainRecord(value)) {
    out.add(path, "INVALID_ITEM");
    return;
  }
  const before = out.count;
  checkClosedKeys(value, { required: ITEM_REQUIRED_FIELDS, optional: ITEM_OPTIONAL_FIELDS }, path, out);
  checkItemFieldTypes(value, path, out);
  if (out.count !== before) return;
  const item = value as PolicyVisibleItem;
  checkProvenance(item, path, trust, out);
  checkSourceResolution(item, path, trust, out);
  checkAnswerShape(item, collection, path, out);
  checkStateValues(item, path, out);
  checkMateriality(item, path, out);
}

function validateKnownInput(value: unknown, path: string, trust: EnvelopeTrust, out: Violations): void {
  if (!isPlainRecord(value)) {
    out.add(path, "INVALID_KNOWN_INPUT");
    return;
  }
  const before = out.count;
  checkClosedKeys(value, { required: KNOWN_INPUT_REQUIRED_FIELDS, optional: KNOWN_INPUT_OPTIONAL_FIELDS }, path, out);
  if (!isNonEmptyString(value.id)) out.add(`${path}.id`, "INVALID_ID");
  if (typeof value.key !== "string") out.add(`${path}.key`, "INVALID_STRING");
  checkEnum(value.value_type, VALUE_TYPES, `${path}.value_type`, out);
  checkEnum(value.source, INTENT_SOURCES, `${path}.source`, out);
  checkEnum(value.sensitivity, SENSITIVITY_LEVELS, `${path}.sensitivity`, out);
  checkSourceRef(value.source_ref, `${path}.source_ref`, out);
  if (value.confidence !== undefined && !isFiniteNumber(value.confidence)) out.add(`${path}.confidence`, "INVALID_NUMBER");
  if (out.count !== before) return;
  const input = value as KnownInput;
  checkProvenance(input, path, trust, out);
  if (!valueMatchesType(input.value, input.value_type)) out.add(`${path}.value`, "VALUE_TYPE_MISMATCH");
}

function validatePolicyState(value: unknown, path: string, out: Violations): void {
  if (!isPlainRecord(value)) {
    out.add(path, "CLARIFICATION_POLICY_STATE_REQUIRED");
    return;
  }
  checkClosedKeys(value, { required: POLICY_STATE_FIELDS, optional: [] }, path, out);
  if (value.policy_version !== F01_CLARIFICATION_POLICY_VERSION) out.add(`${path}.policy_version`, "UNSUPPORTED_POLICY_VERSION");
  checkIdList(value.answered_question_ids, `${path}.answered_question_ids`, out);
  checkIdList(value.changed_semantic_item_ids, `${path}.changed_semantic_item_ids`, out);
}

/** F01-DATA-003A: clarification_policy_state is server-owned; Prompt A output may never carry it. */
function validateAnalysisMetadata(value: unknown, trust: EnvelopeTrust, out: Violations): void {
  const path = "$.analysis_metadata";
  if (!isPlainRecord(value)) {
    out.add(path, "INVALID_ANALYSIS_METADATA");
    return;
  }
  const statePath = `${path}.clarification_policy_state`;
  if (trust === "UNTRUSTED_ANALYSIS") {
    if (Object.hasOwn(value, "clarification_policy_state")) out.add(statePath, "SERVER_OWNED_POLICY_STATE");
    return;
  }
  validatePolicyState(value.clarification_policy_state, statePath, out);
}

export type DependencyResolution = "SELF_CONTAINED" | "DEFERRED_TO_MERGE";

/**
 * Unique stable IDs, same-Envelope references only, no self reference, acyclic graph. DEFERRED_TO_MERGE
 * applies to re-analysis fragments whose references may target trusted IDs: reference resolution and the
 * cycle check then run on the merged Envelope instead.
 */
function checkDependencyGraph(envelope: StructuredIntentEnvelope, resolution: DependencyResolution, out: Violations): void {
  const indexed = policyItemsOf(envelope);
  const ids = new Set<string>();
  const register = (id: string, path: string) => {
    if (ids.has(id)) out.add(path, "DUPLICATE_SEMANTIC_ID");
    ids.add(id);
  };
  envelope.known_inputs.forEach((input, index) => register(input.id, `$.known_inputs[${index}].id`));
  indexed.forEach(({ collection, item }) => register(item.id, `$.${collection}[${item.id}].id`));
  for (const { collection, item } of indexed) {
    const path = `$.${collection}[${item.id}].depends_on_ids`;
    for (const dependency of item.depends_on_ids) {
      if (dependency === item.id) out.add(path, "SELF_DEPENDENCY");
      else if (resolution === "SELF_CONTAINED" && !ids.has(dependency)) out.add(path, "UNKNOWN_DEPENDENCY");
    }
  }
  if (out.count > 0 || resolution === "DEFERRED_TO_MERGE") return;
  for (const id of new DependencyGraph(indexed.map(({ item }) => item)).cyclicItemIds()) {
    out.add(`$.depends_on_ids[${id}]`, "DEPENDENCY_CYCLE");
  }
}

function validateCollections(record: UnknownRecord, trust: EnvelopeTrust, out: Violations): void {
  if (!isNonEmptyString(record.envelope_version)) out.add("$.envelope_version", "INVALID_STRING");
  for (const key of OPAQUE_ARRAY_FIELDS) {
    if (!Array.isArray(record[key])) out.add(`$.${key}`, "INVALID_ARRAY");
  }
  if (!Array.isArray(record.known_inputs)) out.add("$.known_inputs", "INVALID_ARRAY");
  else record.known_inputs.forEach((input, index) => validateKnownInput(input, `$.known_inputs[${index}]`, trust, out));
  for (const collection of POLICY_ITEM_COLLECTIONS) {
    const items = record[collection];
    if (!Array.isArray(items)) out.add(`$.${collection}`, "INVALID_ARRAY");
    else items.forEach((item, index) => validateItem(item, { collection, path: `$.${collection}[${index}]` }, trust, out));
  }
  validateAnalysisMetadata(record.analysis_metadata, trust, out);
}

export function collectEnvelopeViolations(
  input: unknown,
  trust: EnvelopeTrust,
  resolution: DependencyResolution = "SELF_CONTAINED"
): IntentViolation[] {
  const out = new Violations();
  if (!isJsonValue(input)) {
    out.add("$", "NON_JSON_VALUE");
    return out.list;
  }
  if (!isPlainRecord(input)) {
    out.add("$", "INVALID_ENVELOPE");
    return out.list;
  }
  checkClosedKeys(input, { required: ENVELOPE_FIELDS, optional: [] }, "$", out);
  if (out.count > 0) return out.list;
  validateCollections(input, trust, out);
  if (out.count > 0) return out.list;
  checkDependencyGraph(input as StructuredIntentEnvelope, resolution, out);
  return out.list;
}

/**
 * F01-DATA-001 gate that runs before any Clarification Policy evaluation. `code` names the failure
 * owner: F01-ERR-002 for untrusted Prompt A output, F01-ERR-014 for server persisted/trusted state.
 */
export function assertEnvelope(
  input: unknown,
  trust: EnvelopeTrust,
  code: IntentErrorCode,
  resolution: DependencyResolution = "SELF_CONTAINED"
): void {
  const violations = collectEnvelopeViolations(input, trust, resolution);
  if (violations.length > 0) {
    throw new IntentContractError(code, "Structured Intent Envelope failed F01 shape/invariant validation.", violations);
  }
}

/** Prompt A trust boundary: F01-ERR-002 on failure; returns a detached copy immune to caller mutation. */
export function parseUntrustedAnalysisEnvelope(
  input: unknown,
  resolution: DependencyResolution = "SELF_CONTAINED"
): StructuredIntentEnvelope {
  assertEnvelope(input, "UNTRUSTED_ANALYSIS", "F01-ERR-002", resolution);
  return structuredClone(input) as StructuredIntentEnvelope;
}
