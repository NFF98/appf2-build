import type { JsonObject, JsonValue } from "./strict-json.js";
import {
  IssueCollector,
  type F02ErrorCode,
  type ValidationStage
} from "./validation-types.js";

export const STATE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const NODE_ID_PATTERN = /^node_[a-z0-9_]{1,58}$/;
export const RULE_ID_PATTERN = /^rule_[a-z0-9_]{1,58}$/;
export const ACTION_ID_PATTERN = /^action_[a-z0-9_]{1,56}$/;
export const ALIAS_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const EVENT_PATH_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*$/;

export function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function rejectUnknownKeys(
  value: JsonObject,
  allowed: ReadonlySet<string>,
  path: string,
  issues: IssueCollector,
  stage: ValidationStage = "V02"
): void {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      issues.add({
        error_code: "F02-ERR-002",
        stage,
        json_path: `${path}.${key}`,
        capability_ref: null,
        message_key: "unknown_key"
      });
    }
  }
}

export function expectString(
  value: JsonValue | undefined,
  path: string,
  issues: IssueCollector,
  errorCode: F02ErrorCode = "F02-ERR-002"
): string | null {
  if (typeof value !== "string") {
    issues.add({
      error_code: errorCode,
      stage: "V02",
      json_path: path,
      capability_ref: null,
      message_key: "schema_invalid"
    });
    return null;
  }
  return value;
}

export function expectObject(
  value: JsonValue | undefined,
  path: string,
  issues: IssueCollector
): JsonObject | null {
  if (value === undefined || !isJsonObject(value)) {
    issues.add({
      error_code: "F02-ERR-002",
      stage: "V02",
      json_path: path,
      capability_ref: null,
      message_key: "schema_invalid"
    });
    return null;
  }
  return value;
}

export function expectArray(
  value: JsonValue | undefined,
  path: string,
  issues: IssueCollector
): JsonValue[] | null {
  if (!Array.isArray(value)) {
    issues.add({
      error_code: "F02-ERR-002",
      stage: "V02",
      json_path: path,
      capability_ref: null,
      message_key: "schema_invalid"
    });
    return null;
  }
  return value;
}

export function matches(value: string, pattern: RegExp): boolean {
  return pattern.test(value);
}

export function unicodeLength(value: string): number {
  return Array.from(value).length;
}

export function isReservedStateKey(key: string): boolean {
  return key.startsWith("nff_") || key.startsWith("sys_") || key.startsWith("__");
}

export function schemaIssue(issues: IssueCollector, path: string, messageKey: string): void {
  issues.add({
    error_code: "F02-ERR-002",
    stage: "V02",
    json_path: path,
    capability_ref: null,
    message_key: messageKey
  });
}
