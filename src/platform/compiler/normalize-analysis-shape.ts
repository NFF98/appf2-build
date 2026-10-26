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
const QUESTIONS: Readonly<Record<string, string>> = {
  STRING: "FREE_TEXT", NUMBER: "NUMBER", BOOLEAN: "BOOLEAN",
  ENUM: "SINGLE_CHOICE", LIST: "MULTI_CHOICE", RECORD: "STRUCTURED_FIELDS"
};

function fixScalarMetadata(item: JsonValue): JsonValue {
  if (!isPlainRecord(item) || !Array.isArray(item.policy_risk_flags) ||
      item.policy_risk_flags.length !== 0 || !Array.isArray(item.alternatives)) return item;
  const value = item.resolution_state === "CONFIRMED" ? item.resolved_value :
    item.resolution_state === "PROPOSED" ? item.proposed_default : undefined;
  if (value === undefined || value === null ||
      (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean")) return item;
  // The actual scalar is never modified; only erroneous model-selected UI metadata.
  const scalarType = typeof value === "string" ? "STRING" :
    typeof value === "number" ? "NUMBER" : "BOOLEAN";
  const enumMatches = item.expected_value_type === "ENUM" &&
    item.alternatives.some(option => option === value);
  const expectedType = enumMatches ? "ENUM" : scalarType;
  const requiredQuestion = QUESTIONS[expectedType];
  if (item.expected_value_type === expectedType && item.question_type === requiredQuestion) return item;
  return { ...item, expected_value_type: expectedType, question_type: requiredQuestion };
}

export function normalizeAnalysisDescriptorFlags(value: JsonValue): JsonValue {
  if (!isPlainRecord(value)) return value;
  const output = value.requested_outputs;
  const hints = value.capability_hints;
  if (!Array.isArray(output) || !Array.isArray(hints)) return value;

  const outputs = output.map(entry => {
    if (!isPlainRecord(entry) || entry.required !== undefined) return entry;
    if (entry.source !== "USER_EXPLICIT" && entry.source !== "DOMAIN_KNOWN" &&
      entry.source !== "LLM_PROPOSED" && entry.source !== "NFF_DEFAULT") return entry;
    return { ...entry, required: entry.source === "USER_EXPLICIT" };
  });
  const capabilities = hints.map(entry => {
    if (!isPlainRecord(entry) || entry.required !== undefined) return entry;
    return { ...entry, required: false };
  });
  const policy = Object.fromEntries(COLLECTIONS.flatMap(name => {
    const items = value[name];
    return Array.isArray(items) ? [[name, items.map(fixScalarMetadata)]] : [];
  }));
  return { ...value, requested_outputs: outputs, capability_hints: capabilities, ...policy };
}
