import {
  ACTION_ID_PATTERN,
  ALIAS_PATTERN,
  EVENT_PATH_PATTERN,
  RULE_ID_PATTERN,
  STATE_KEY_PATTERN,
  expectArray,
  isJsonObject,
  matches,
  rejectUnknownKeys,
  schemaIssue
} from "./json-shape.js";
import type { JsonValue } from "./strict-json.js";
import type { IssueCollector } from "./validation-types.js";

const LITERAL_KEYS = new Set(["kind", "value"]);
const STATE_KEYS = new Set(["kind", "key"]);
const RULE_KEYS = new Set(["kind", "rule_id"]);
const EVENT_KEYS = new Set(["kind", "path"]);
const SCOPE_KEYS = new Set(["kind", "name", "path"]);
const OP_KEYS = new Set(["kind", "op", "args"]);

export function validateValueSource(
  value: JsonValue,
  path: string,
  issues: IssueCollector
): boolean {
  const before = issues.list.length;
  if (!isJsonObject(value) || typeof value.kind !== "string") {
    schemaIssue(issues, path, "schema_invalid");
    return false;
  }
  switch (value.kind) {
    case "LITERAL":
      validateLiteral(value, path, issues);
      break;
    case "STATE":
      validateKeyed(value, path, issues, { allowed: STATE_KEYS, field: "key", pattern: STATE_KEY_PATTERN });
      break;
    case "RULE":
      validateKeyed(value, path, issues, { allowed: RULE_KEYS, field: "rule_id", pattern: RULE_ID_PATTERN });
      break;
    case "EVENT":
      validateKeyed(value, path, issues, { allowed: EVENT_KEYS, field: "path", pattern: EVENT_PATH_PATTERN });
      break;
    case "SCOPE":
      validateScope(value, path, issues);
      break;
    case "OP":
      validateOperator(value, path, issues);
      break;
    default:
      schemaIssue(issues, `${path}.kind`, "schema_invalid");
  }
  return issues.list.length === before;
}

function validateLiteral(
  value: { readonly [key: string]: JsonValue },
  path: string,
  issues: IssueCollector
): void {
  rejectUnknownKeys(value, LITERAL_KEYS, path, issues);
  const literal = value.value;
  const legal = typeof literal === "string"
    || typeof literal === "boolean"
    || (typeof literal === "number" && Number.isFinite(literal));
  if (!legal) {
    schemaIssue(issues, `${path}.value`, "schema_invalid");
  }
}

function validateKeyed(
  value: { readonly [key: string]: JsonValue },
  path: string,
  issues: IssueCollector,
  spec: { readonly allowed: ReadonlySet<string>; readonly field: string; readonly pattern: RegExp }
): void {
  rejectUnknownKeys(value, spec.allowed, path, issues);
  const token = value[spec.field];
  if (typeof token !== "string" || !matches(token, spec.pattern)) {
    schemaIssue(issues, `${path}.${spec.field}`, "schema_invalid");
  }
}

function validateScope(
  value: { readonly [key: string]: JsonValue },
  path: string,
  issues: IssueCollector
): void {
  rejectUnknownKeys(value, SCOPE_KEYS, path, issues);
  const name = value.name;
  const scopePath = value.path;
  if (typeof name !== "string" || !matches(name, ALIAS_PATTERN)) {
    schemaIssue(issues, `${path}.name`, "schema_invalid");
  }
  if (typeof scopePath !== "string" || (scopePath !== "" && !matches(scopePath, EVENT_PATH_PATTERN))) {
    schemaIssue(issues, `${path}.path`, "schema_invalid");
  }
}

function validateOperator(
  value: { readonly [key: string]: JsonValue },
  path: string,
  issues: IssueCollector
): void {
  rejectUnknownKeys(value, OP_KEYS, path, issues);
  if (typeof value.op !== "string" || value.op.length === 0) {
    schemaIssue(issues, `${path}.op`, "schema_invalid");
  }
  const args = expectArray(value.args, `${path}.args`, issues);
  if (args === null) {
    return;
  }
  for (let index = 0; index < args.length; index += 1) {
    validateValueSource(args[index]!, `${path}.args[${index}]`, issues);
  }
}

export function isActionId(value: string): boolean {
  return matches(value, ACTION_ID_PATTERN);
}
