import type { PolicyVisibleItem, ValueType } from "./intent-contract.js";
import { canonicalJson, isPlainRecord, type JsonValue } from "./json-value.js";

export function distinctCanonicalCount(values: readonly JsonValue[]): number {
  return new Set(values.map((value) => canonicalJson(value))).size;
}

export function isChoiceQuestion(item: Pick<PolicyVisibleItem, "question_type">): boolean {
  return item.question_type === "SINGLE_CHOICE" || item.question_type === "MULTI_CHOICE";
}

/** SINGLE_CHOICE / MULTI_CHOICE values may only select from the target alternatives. */
export function choiceOptionsOf(
  item: Pick<PolicyVisibleItem, "question_type" | "alternatives">
): readonly JsonValue[] | undefined {
  return isChoiceQuestion(item) ? item.alternatives : undefined;
}

function isScalar(value: JsonValue): boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function selectsDistinctOptions(value: JsonValue, options: ReadonlySet<string>): boolean {
  if (!Array.isArray(value)) return false;
  const selected = (value as readonly JsonValue[]).map((entry) => canonicalJson(entry));
  return new Set(selected).size === selected.length && selected.every((entry) => options.has(entry));
}

/**
 * Checks a value against an expected_value_type. When choice options are given (SINGLE_CHOICE → ENUM,
 * MULTI_CHOICE → LIST) the value must select from exactly those options.
 */
export function valueMatchesType(value: JsonValue, valueType: ValueType, options?: readonly JsonValue[]): boolean {
  const optionSet = options === undefined ? undefined : new Set(options.map((option) => canonicalJson(option)));
  switch (valueType) {
    case "NUMBER":
      return typeof value === "number" && Number.isFinite(value);
    case "STRING":
      return typeof value === "string";
    case "BOOLEAN":
      return typeof value === "boolean";
    case "ENUM":
      return optionSet === undefined ? isScalar(value) : optionSet.has(canonicalJson(value));
    case "LIST":
      return optionSet === undefined ? Array.isArray(value) : selectsDistinctOptions(value, optionSet);
    case "RECORD":
      return isPlainRecord(value);
  }
}

/** F01-DATA-001: resolved_value / proposed_default / answers must fit the target's answer shape. */
export function valueFitsItem(value: JsonValue, item: PolicyVisibleItem): boolean {
  return valueMatchesType(value, item.expected_value_type, choiceOptionsOf(item));
}
