import { IntentContractError, type IntentViolation } from "./intent-contract.js";
import { findNonJsonPath, isPlainRecord } from "./json-value.js";

/**
 * Server-owned clarification / resolution truth (F01-SEC-005, F01-SEC-007, F01-DATA-003A, F01-RQ-003).
 * A Client body carrying any of these at any depth is rejected rather than silently ignored.
 */
export const SERVER_OWNED_REQUEST_FIELDS: ReadonlySet<string> = new Set([
  "resolved_intent",
  "structured_intent",
  "resolved_value",
  "clarification_policy_state",
  "answered_question_ids",
  "changed_semantic_item_ids",
  "decision",
  "status",
  "lifecycle_status",
  "policy_version",
  "triggered_rule_ids",
  "questions",
  "visible_assumptions"
]);

export type UnknownRecord = Readonly<Record<string, unknown>>;

export function invalidRequest(violations: readonly IntentViolation[]): never {
  throw new IntentContractError("F01-ERR-001", "F01 request body is malformed or attempts to write server-owned state.", violations);
}

export function requireJsonRecord(body: unknown, path = "$"): UnknownRecord {
  if (findNonJsonPath(body, path) !== null || !isPlainRecord(body)) {
    invalidRequest([{ path, reason: "INVALID_JSON_OBJECT" }]);
  }
  return body;
}

export function rejectUnexpectedFields(
  record: UnknownRecord,
  required: readonly string[],
  optional: readonly string[],
  path: string
): void {
  const allowed = new Set([...required, ...optional]);
  const violations: IntentViolation[] = [];
  for (const key of Object.keys(record)) {
    if (allowed.has(key)) continue;
    violations.push({ path: `${path}.${key}`, reason: SERVER_OWNED_REQUEST_FIELDS.has(key) ? "SERVER_OWNED_FIELD" : "UNKNOWN_FIELD" });
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) violations.push({ path: `${path}.${key}`, reason: "MISSING_FIELD" });
  }
  if (violations.length > 0) invalidRequest(violations);
}

export function requirePositiveInteger(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    invalidRequest([{ path, reason: "INVALID_POSITIVE_INTEGER" }]);
  }
  return value;
}

export function requireNonEmptyString(value: unknown, path: string): string {
  if (typeof value !== "string" || value.length === 0) invalidRequest([{ path, reason: "INVALID_STRING" }]);
  return value;
}

export function requireArray(value: unknown, path: string): readonly unknown[] {
  if (!Array.isArray(value)) invalidRequest([{ path, reason: "INVALID_ARRAY" }]);
  return value;
}
