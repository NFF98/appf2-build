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

/** For an already CONFIRMED USER_EXPLICIT array of >=2 unique scalar facts
 * the values themselves are the only proven possible selections. Never
 * synthesize labels, delete values, change source/requiredness or repair
 * unconfirmed/AI-proposed/risky items. This merely makes the existing list
 * projectable through F01's mandatory MULTI_CHOICE contract. */
function exactUserListChoices(item: Record<string, JsonValue>): readonly JsonValue[] | null {
  if (item.source !== "USER_EXPLICIT" || item.resolution_state !== "CONFIRMED" ||
      !Array.isArray(item.resolved_value) || !Array.isArray(item.alternatives) ||
      item.alternatives.length !== 0 || !Array.isArray(item.policy_risk_flags) ||
      item.policy_risk_flags.length !== 0) return null;
  const values = item.resolved_value;
  if (values.length < 2 || values.length > 24 || !values.every(v =>
      typeof v === "string" || typeof v === "number" || typeof v === "boolean")) return null;
  const uniq = new Set(values.map(v => JSON.stringify(v)));
  return uniq.size === values.length ? values : null;
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
  // LIST maps to MULTI_CHOICE, which requires distinct selected options.
  // For explicit, confirmed lists only, existing user values may supply
  // their own exact option set; all other unproven choices still fail closed.
  if (scalarType === "LIST" && !provenListChoices(value, item.alternatives)) {
    const userOptions = exactUserListChoices(item);
    if (userOptions === null) return item;
    return {
      ...item, expected_value_type: "LIST", question_type: "MULTI_CHOICE",
      alternatives: [...userOptions]
    };
  }
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

/** Correct only an F01 primitive-stat type token provably incompatible with
 * the user's original money request. A composed summary remains a REQUIRED
 * capability and F02 must still implement spending and remaining separately.
 * Never change amounts, facts, sources, requirement IDs or risk flags. */
// eslint-disable-next-line complexity -- All guards preserve mandatory finance functionality and avoid speculative type rewriting.
export function correctMoneyStatisticHint(raw: JsonValue, originalUserIntent?: string): JsonValue {
  if (!isPlainRecord(raw) || raw.interaction_class !== "statistic" ||
    raw.required !== true || !Array.isArray(raw.input_types) || raw.input_types.length !== 0 ||
    !Array.isArray(raw.output_types) || raw.output_types.length !== 1 ||
    raw.output_types[0] !== "RECORD" || typeof raw.semantic_need !== "string" ||
    typeof originalUserIntent !== "string" || originalUserIntent.length > 6000 ||
    !/(?:預算|预算|budget)/i.test(originalUserIntent) ||
    !/(?:費用|花費|支出|expense|spent|spend)/i.test(originalUserIntent) ||
    !/(?:剩餘|剩余|餘額|余额|remaining|left)/i.test(originalUserIntent) ||
    !/(?:預算|预算|費用|花費|支出|金額|餘額|budget|spend|spent|expense|remaining)/i.test(raw.semantic_need))
    return raw;
  return { ...raw, output_types: ["NUMBER"] };
}

export function normalizeAnalysisDescriptorFlags(value: JsonValue, originalUserIntent?: string): JsonValue {
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
    const corrected = correctMoneyStatisticHint(normalized, originalUserIntent);
    return entry.required === undefined ? { ...corrected as typeof normalized, required: false } : corrected;
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
