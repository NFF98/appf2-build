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

function fixScalarMetadata(item: JsonValue): JsonValue {
  if (!isPlainRecord(item) || !safePolicyItem(item)) return item;
  const value = item.resolution_state === "CONFIRMED" ? item.resolved_value :
    item.resolution_state === "PROPOSED" ? item.proposed_default : undefined;
  const scalarType = actualValueType(value);
  if (scalarType === null) return item;
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
  return value.map((token) => typeof token === "string" &&
    Object.hasOwn(HINT_TYPE_ALIASES, token) ? HINT_TYPE_ALIASES[token]! : token);
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
    if (!isPlainRecord(entry)) return entry;
    const normalized = {
      ...entry,
      ...(Array.isArray(entry.input_types) ? { input_types: canonicalHintTypes(entry.input_types) } : {}),
      ...(Array.isArray(entry.output_types) ? { output_types: canonicalHintTypes(entry.output_types) } : {})
    };
    return entry.required === undefined ? { ...normalized, required: false } : normalized;
  });
  const policy = Object.fromEntries(COLLECTIONS.flatMap(name => {
    const items = value[name];
    return Array.isArray(items) ? [[name, items.map(item => fixScalarMetadata(promoteRequiredMateriality(item)))]] : [];
  }));
  return { ...value, requested_outputs: outputs, capability_hints: capabilities, ...policy };
}
