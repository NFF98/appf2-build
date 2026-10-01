import type { StateModel, StateValueType, ValueLocation } from "./blueprint-model.js";
import {
  STATE_KEY_PATTERN,
  expectObject,
  isReservedStateKey,
  matches,
  rejectUnknownKeys,
  schemaIssue
} from "./json-shape.js";
import type { JsonObject, JsonValue } from "./strict-json.js";
import type { IssueCollector } from "./validation-types.js";
import { validateValueSource } from "./value-source.js";

const MUTABLE_KEYS = new Set(["mode", "type", "initial", "constraints"]);
const DERIVED_KEYS = new Set(["mode", "type", "expr"]);
const STATE_TYPES = new Set<StateValueType>([
  "NUMBER",
  "STRING",
  "BOOLEAN",
  "ENUM",
  "LIST",
  "RECORD"
]);
const SCALAR_TYPES = new Set(["NUMBER", "STRING", "BOOLEAN"]);

export function validateStateMap(
  state: JsonValue | undefined,
  issues: IssueCollector
): Map<string, StateModel> | null {
  const object = expectObject(state, "$.state", issues);
  if (object === null) {
    return null;
  }
  const models = new Map<string, StateModel>();
  for (const key of Object.keys(object)) {
    const model = validateStateEntry(key, object[key]!, issues);
    if (model !== null) {
      models.set(key, model);
    }
  }
  return models;
}

function validateStateEntry(
  key: string,
  value: JsonValue,
  issues: IssueCollector
): StateModel | null {
  const path = `$.state.${key}`;
  if (!matches(key, STATE_KEY_PATTERN) || isReservedStateKey(key)) {
    schemaIssue(issues, path, "schema_invalid");
    return null;
  }
  const object = expectObject(value, path, issues);
  if (object === null || typeof object.mode !== "string" || typeof object.type !== "string") {
    schemaIssue(issues, path, "schema_invalid");
    return null;
  }
  if (!STATE_TYPES.has(object.type as StateValueType)) {
    schemaIssue(issues, `${path}.type`, "schema_invalid");
    return null;
  }
  const valueType = object.type as StateValueType;
  if (object.mode === "DERIVED") {
    return validateDerivedState(key, valueType, object, path, issues);
  }
  if (object.mode === "MUTABLE") {
    return validateMutableState(key, valueType, object, path, issues);
  }
  schemaIssue(issues, `${path}.mode`, "schema_invalid");
  return null;
}

function validateDerivedState(
  key: string,
  valueType: StateValueType,
  object: JsonObject,
  path: string,
  issues: IssueCollector
): StateModel | null {
  rejectUnknownKeys(object, DERIVED_KEYS, path, issues);
  const exprPath = `${path}.expr`;
  if (object.expr === undefined || !validateValueSource(object.expr, exprPath, issues)) {
    if (object.expr === undefined) {
      schemaIssue(issues, exprPath, "schema_invalid");
    }
    return null;
  }
  const expr: ValueLocation = {
    path: exprPath,
    value: object.expr,
    family: "STATE_EXPR",
    scope: "GENERAL",
    owner: `state:${key}`,
    repeatAliases: null
  };
  return { key, mode: "DERIVED", valueType, expr };
}

function validateMutableState(
  key: string,
  valueType: StateValueType,
  object: JsonObject,
  path: string,
  issues: IssueCollector
): StateModel | null {
  rejectUnknownKeys(object, MUTABLE_KEYS, path, issues);
  if (object.initial === undefined) {
    schemaIssue(issues, `${path}.initial`, "schema_invalid");
    return null;
  }
  if (!initialMatches(valueType, object.initial, object.constraints, path, issues)) {
    return null;
  }
  return { key, mode: "MUTABLE", valueType, expr: null };
}

function initialMatches(
  valueType: StateValueType,
  initial: JsonValue,
  constraints: JsonValue | undefined,
  path: string,
  issues: IssueCollector
): boolean {
  switch (valueType) {
    case "NUMBER":
      return numberInitial(initial, constraints, path, issues);
    case "STRING":
      return stringInitial(initial, constraints, path, issues);
    case "BOOLEAN":
      return booleanInitial(initial, constraints, path, issues);
    case "ENUM":
      return enumInitial(initial, constraints, path, issues);
    case "LIST":
      return listInitial(initial, constraints, path, issues);
    case "RECORD":
      return recordInitial(initial, constraints, path, issues);
    default:
      return false;
  }
}

function numberInitial(
  initial: JsonValue,
  constraints: JsonValue | undefined,
  path: string,
  issues: IssueCollector
): boolean {
  if (typeof initial !== "number" || !Number.isFinite(initial)) {
    schemaIssue(issues, `${path}.initial`, "schema_invalid");
    return false;
  }
  const bounds = readNumberBounds(constraints, path, issues);
  if (bounds === null) {
    return false;
  }
  if (bounds.min !== null && initial < bounds.min) {
    schemaIssue(issues, `${path}.initial`, "schema_invalid");
    return false;
  }
  if (bounds.max !== null && initial > bounds.max) {
    schemaIssue(issues, `${path}.initial`, "schema_invalid");
    return false;
  }
  return true;
}

function readNumberBounds(
  constraints: JsonValue | undefined,
  path: string,
  issues: IssueCollector
): { min: number | null; max: number | null } | null {
  if (constraints === undefined) {
    return { min: null, max: null };
  }
  const object = expectObject(constraints, `${path}.constraints`, issues);
  if (object === null) {
    return null;
  }
  rejectUnknownKeys(object, new Set(["min", "max"]), `${path}.constraints`, issues);
  const min = readOptionalNumber(object.min, `${path}.constraints.min`, issues);
  const max = readOptionalNumber(object.max, `${path}.constraints.max`, issues);
  if ((object.min !== undefined && min === null) || (object.max !== undefined && max === null)) {
    return null;
  }
  if (min !== null && max !== null && min > max) {
    schemaIssue(issues, `${path}.constraints`, "schema_invalid");
    return null;
  }
  return { min, max };
}

function readOptionalNumber(
  value: JsonValue | undefined,
  path: string,
  issues: IssueCollector
): number | null {
  if (value === undefined) {
    return null;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    schemaIssue(issues, path, "schema_invalid");
    return null;
  }
  return value;
}

function stringInitial(
  initial: JsonValue,
  constraints: JsonValue | undefined,
  path: string,
  issues: IssueCollector
): boolean {
  if (typeof initial !== "string" || constraints !== undefined) {
    schemaIssue(issues, constraints === undefined ? `${path}.initial` : `${path}.constraints`, "schema_invalid");
    return false;
  }
  return true;
}

function booleanInitial(
  initial: JsonValue,
  constraints: JsonValue | undefined,
  path: string,
  issues: IssueCollector
): boolean {
  if (typeof initial !== "boolean" || constraints !== undefined) {
    schemaIssue(issues, constraints === undefined ? `${path}.initial` : `${path}.constraints`, "schema_invalid");
    return false;
  }
  return true;
}

function enumInitial(
  initial: JsonValue,
  constraints: JsonValue | undefined,
  path: string,
  issues: IssueCollector
): boolean {
  const object = expectObject(constraints, `${path}.constraints`, issues);
  if (object === null) {
    return false;
  }
  rejectUnknownKeys(object, new Set(["allowed"]), `${path}.constraints`, issues);
  if (!Array.isArray(object.allowed) || object.allowed.length === 0) {
    schemaIssue(issues, `${path}.constraints.allowed`, "schema_invalid");
    return false;
  }
  const seen = new Set<string>();
  for (const allowed of object.allowed) {
    if (!isEnumLiteral(allowed) || seen.has(enumToken(allowed))) {
      schemaIssue(issues, `${path}.constraints.allowed`, "schema_invalid");
      return false;
    }
    seen.add(enumToken(allowed));
  }
  if (!isEnumLiteral(initial) || !seen.has(enumToken(initial))) {
    schemaIssue(issues, `${path}.initial`, "schema_invalid");
    return false;
  }
  return true;
}

function listInitial(
  initial: JsonValue,
  constraints: JsonValue | undefined,
  path: string,
  issues: IssueCollector
): boolean {
  const object = expectObject(constraints, `${path}.constraints`, issues);
  if (object === null || !Array.isArray(initial)) {
    schemaIssue(issues, `${path}.initial`, "schema_invalid");
    return false;
  }
  rejectUnknownKeys(object, new Set(["item_type", "max_length"]), `${path}.constraints`, issues);
  if (typeof object.item_type !== "string" || !SCALAR_TYPES.has(object.item_type)) {
    schemaIssue(issues, `${path}.constraints.item_type`, "schema_invalid");
    return false;
  }
  if (!isWholeNumber(object.max_length) || object.max_length < 0) {
    schemaIssue(issues, `${path}.constraints.max_length`, "schema_invalid");
    return false;
  }
  if (initial.length > object.max_length) {
    schemaIssue(issues, `${path}.initial`, "schema_invalid");
    return false;
  }
  return initial.every((item, index) => scalarMatches(object.item_type as string, item, `${path}.initial[${index}]`, issues));
}

function recordInitial(
  initial: JsonValue,
  constraints: JsonValue | undefined,
  path: string,
  issues: IssueCollector
): boolean {
  const object = expectObject(constraints, `${path}.constraints`, issues);
  const initialObject = expectObject(initial, `${path}.initial`, issues);
  if (object === null || initialObject === null) {
    return false;
  }
  rejectUnknownKeys(object, new Set(["fields"]), `${path}.constraints`, issues);
  const fields = expectObject(object.fields, `${path}.constraints.fields`, issues);
  if (fields === null) {
    return false;
  }
  const fieldNames = Object.keys(fields);
  const initialNames = Object.keys(initialObject);
  if (!sameMembers(fieldNames, initialNames)) {
    schemaIssue(issues, `${path}.initial`, "schema_invalid");
    return false;
  }
  for (const name of fieldNames) {
    const fieldPath = `${path}.constraints.fields.${name}`;
    if (!matches(name, STATE_KEY_PATTERN)) {
      schemaIssue(issues, fieldPath, "schema_invalid");
      return false;
    }
    if (!fieldMatches(fields[name]!, initialObject[name]!, fieldPath, issues)) {
      return false;
    }
  }
  return true;
}

function fieldMatches(
  definition: JsonValue,
  initial: JsonValue,
  path: string,
  issues: IssueCollector
): boolean {
  const object = expectObject(definition, path, issues);
  if (object === null) {
    return false;
  }
  rejectUnknownKeys(object, new Set(["type"]), path, issues);
  if (typeof object.type !== "string" || !SCALAR_TYPES.has(object.type)) {
    schemaIssue(issues, `${path}.type`, "schema_invalid");
    return false;
  }
  return scalarMatches(object.type, initial, path, issues);
}

function scalarMatches(
  valueType: string,
  value: JsonValue,
  path: string,
  issues: IssueCollector
): boolean {
  const legal = (valueType === "NUMBER" && typeof value === "number" && Number.isFinite(value))
    || (valueType === "STRING" && typeof value === "string")
    || (valueType === "BOOLEAN" && typeof value === "boolean");
  if (!legal) {
    schemaIssue(issues, path, "schema_invalid");
    return false;
  }
  return true;
}

function isEnumLiteral(value: JsonValue): value is string | number | boolean {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean";
}

function enumToken(value: string | number | boolean): string {
  return `${typeof value}:${String(value)}`;
}

function isWholeNumber(value: JsonValue | undefined): value is number {
  return typeof value === "number" && Number.isInteger(value);
}

function sameMembers(left: readonly string[], right: readonly string[]): boolean {
  if (left.length !== right.length) {
    return false;
  }
  const rightSet = new Set(right);
  return left.every((key) => rightSet.has(key));
}
