import type { ValueType } from "./intent-contract.js";
import { canonicalJson, isPlainRecord, type JsonValue } from "./json-value.js";

export function distinctCanonicalCount(values: readonly JsonValue[]): number {
  return new Set(values.map((value) => canonicalJson(value))).size;
}

function isScalar(value: JsonValue): boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function matchesChoiceList(value: JsonValue, options: ReadonlySet<string>): boolean {
  if (!Array.isArray(value)) return false;
  const selected = (value as readonly JsonValue[]).map((entry) => canonicalJson(entry));
  return new Set(selected).size === selected.length && selected.every((entry) => options.has(entry));
}

/**
 * Validates a value against an expected_value_type. When choice options are supplied
 * (SINGLE_CHOICE → ENUM, MULTI_CHOICE → LIST) the value must select from those options only.
 */
export function valueMatchesType(
  value: JsonValue,
  valueType: ValueType,
  options?: readonly JsonValue[]
): boolean {
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
      return optionSet === undefined ? Array.isArray(value) : matchesChoiceList(value, optionSet);
    case "RECORD":
      return isPlainRecord(value);
  }
}
