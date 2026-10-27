import { isPlainRecord, type JsonValue } from "../intent/json-value.js";

/**
 * Reconcile only omitted descriptor booleans in untrusted Prompt A output.
 * Never repair IDs, facts, assumptions, policy decisions, risk flags or values.
 * F01's authoritative parseUntrustedAnalysisEnvelope still validates every field.
 *
 * Missing 'required' means the model did not assert a mandatory requirement.
 * An output explicitly sourced from the user remains mandatory; all other
 * omitted descriptor required flags are treated as nonmandatory.
 */
const COLLECTIONS = ["constraints", "candidate_rules", "missing_fields", "ambiguities", "assumptions"] as const;
const DESCRIPTORS = ["actors", "entities", "known_inputs"] as const;
const SOURCE_REF_FIELDS = new Set(["policy_id", "policy_version", "origin_item_id"]);

/** A blank optional provenance field is not a source. Omit only exact empty
 * strings, never fabricate provenance or delete nonempty/unknown fields. */
function omitBlankOptionalSourceRef(entry: JsonValue): JsonValue {
  if (!isPlainRecord(entry) || !isPlainRecord(entry.source_ref)) return entry;
  const fields = Object.entries(entry.source_ref).filter(
    ([key, value]) => !SOURCE_REF_FIELDS.has(key) || value !== ""
  );
  if (fields.length === Object.keys(entry.source_ref).length) return entry;
  if (fields.length > 0) return { ...entry, source_ref: Object.fromEntries(fields) };
  const { source_ref: _unused, ...withoutRef } = entry;
  void _unused;
  return withoutRef;
}
const QUESTIONS: Readonly<Record<string, string>> = {
  STRING: "FREE_TEXT", NUMBER: "NUMBER", BOOLEAN: "BOOLEAN",
  ENUM: "SINGLE_CHOICE", LIST: "MULTI_CHOICE", RECORD: "STRUCTURED_FIELDS"
};

/** Never discard an execution requirement or risk flag because the LLM
 * mistakenly called it cosmetic. Conservatively promote its classification. */
function promoteRequiredMateriality(item: JsonValue): JsonValue {
  if (!isPlainRecord(item) || item.materiality !== "COSMETIC") return item;
  const hasRisk = Array.isArray(item.policy_risk_flags) && item.policy_risk_flags.length > 0;
  return item.required_for_execution === true || hasRisk
    ? { ...item, materiality: "MATERIAL" }
    : item;
}

function safePolicyItem(item: JsonValue): boolean {
  return isPlainRecord(item) && Array.isArray(item.policy_risk_flags) &&
    item.policy_risk_flags.length === 0 && Array.isArray(item.alternatives);
}

function actualValueType(value: JsonValue | undefined): string | null {
  if (typeof value === "string") return "STRING";
  if (typeof value === "number" && Number.isFinite(value)) return "NUMBER";
  if (typeof value === "boolean") return "BOOLEAN";
  if (Array.isArray(value)) return "LIST";
  if (isPlainRecord(value)) return "RECORD";
  return null;
}

function provenListChoices(value: JsonValue | undefined, alternatives: JsonValue): boolean {
  if (!Array.isArray(value) || !Array.isArray(alternatives) || alternatives.length < 2) return false;
  const options = new Set(alternatives.map(v => JSON.stringify(v)));
  return options.size >= 2 && value.every(entry => options.has(JSON.stringify(entry)));
}

/**
 * Fix only an internally inconsistent question label. The expected value
 * type is retained, and the authoritative F01 parser still validates choices,
 * facts, provenance and policy. Never infer new alternatives or modify risk.
 */
// eslint-disable-next-line complexity -- All type/choice guards are required to prevent changing user facts.
function alignQuestionMetadata(item: JsonValue): JsonValue {
  if (!safePolicyItem(item) || !isPlainRecord(item)) return item;
  if (typeof item.expected_value_type !== "string" ||
      typeof item.question_type !== "string") return item;
  const expectedQuestion = QUESTIONS[item.expected_value_type];
  if (expectedQuestion === undefined ||
      !Object.values(QUESTIONS).includes(item.question_type) ||
      expectedQuestion === item.question_type) return item;
  const alternatives = item.alternatives;
  if (expectedQuestion === "SINGLE_CHOICE" || expectedQuestion === "MULTI_CHOICE") {
    if (!Array.isArray(alternatives) ||
        new Set(alternatives.map(choice => JSON.stringify(choice))).size < 2) return item;
  } else if (Array.isArray(alternatives) && alternatives.length > 0 &&
             (item.question_type === "SINGLE_CHOICE" || item.question_type === "MULTI_CHOICE")) {
    // Nonempty options may carry intentional choice semantics: do not overwrite.
    return item;
  }
  return { ...item, question_type: expectedQuestion };
}

function fixScalarMetadata(item: JsonValue): JsonValue {
  if (!isPlainRecord(item) || !safePolicyItem(item)) return item;
  const value = item.resolution_state === "CONFIRMED" ? item.resolved_value :
    item.resolution_state === "PROPOSED" ? item.proposed_default : undefined;
  const scalarType = actualValueType(value);
  if (scalarType === null) return item;
  // LIST maps to MULTI_CHOICE, which requires real distinct alternatives.
  // Never invent options or change a plain array fact into a false choice contract.
  if (scalarType === "LIST" && !provenListChoices(value, item.alternatives)) return item;
  // Only presentation/type metadata changes: no user value, safety flag,
  // policy decision or dependency is created, discarded or modified.
  const enumMatches = item.expected_value_type === "ENUM" && Array.isArray(item.alternatives) &&
    item.alternatives.some(option => option === value);
  const expectedType = enumMatches ? "ENUM" : scalarType;
  const requiredQuestion = QUESTIONS[expectedType];
  if (item.expected_value_type === expectedType && item.question_type === requiredQuestion) return item;
  return { ...item, expected_value_type: expectedType, question_type: requiredQuestion };
}

/** Only lossless, widely used type synonyms in non-authoritative capability-hint
 * metadata. Never guess arbitrary tokens or rewrite actual user facts/values. */
const HINT_TYPE_ALIASES: Readonly<Record<string, string>> = Object.freeze({
  ARRAY: "LIST", OBJECT: "RECORD", INTEGER: "NUMBER", FLOAT: "NUMBER"
});

function canonicalHintTypes(value: JsonValue): JsonValue {
  if (!Array.isArray(value)) return value;
  const canonical = value.map((token) => typeof token === "string" &&
    Object.hasOwn(HINT_TYPE_ALIASES, token) ? HINT_TYPE_ALIASES[token]! : token);
  // Type-token lists are sets. Deduplicate identical canonical entries without
  // altering meaning, order of distinct types, requiredness or unknown tokens.
  return [...new Set(canonical)];
}

export function normalizeAnalysisDescriptorFlags(value: JsonValue): JsonValue {
  if (!isPlainRecord(value)) return value;
  const output = value.requested_outputs;
  const hints = value.capability_hints;
  if (!Array.isArray(output) || !Array.isArray(hints)) return value;

  const outputs = output.map(rawEntry => {
    const entry = omitBlankOptionalSourceRef(rawEntry);
    if (!isPlainRecord(entry) || entry.required !== undefined) return entry;
    if (entry.source !== "USER_EXPLICIT" && entry.source !== "DOMAIN_KNOWN" &&
      entry.source !== "LLM_PROPOSED" && entry.source !== "NFF_DEFAULT") return entry;
    return { ...entry, required: entry.source === "USER_EXPLICIT" };
  });
  const capabilities = hints.map(entry => {
    if (!isPlainRecord(entry)) return entry;
    const normalized = {
      ...entry,
      ...(Array.isArray(entry.input_types) ? { input_types: canonicalHintTypes(entry.input_types) } : {}),
      ...(Array.isArray(entry.output_types) ? { output_types: canonicalHintTypes(entry.output_types) } : {})
    };
    return entry.required === undefined ? { ...normalized, required: false } : normalized;
  });
  const descriptors = Object.fromEntries(DESCRIPTORS.flatMap(name => {
    const entries = value[name];
    return Array.isArray(entries) ? [[name, entries.map(omitBlankOptionalSourceRef)]] : [];
  }));
  const policy = Object.fromEntries(COLLECTIONS.flatMap(name => {
    const items = value[name];
    return Array.isArray(items) ? [[name, items.map(item => alignQuestionMetadata(fixScalarMetadata(promoteRequiredMateriality(omitBlankOptionalSourceRef(item)))))]] : [];
  }));
  return { ...value, ...descriptors, requested_outputs: outputs, capability_hints: capabilities, ...policy };
}
