import type { DescriptorType } from "../capabilities/schema/validator-contract.js";
import type { JsonValue } from "../blueprint/validation-types.js";
import { invariantBroken } from "./runtime-errors.js";

/** F03 §10 Phase 1 Runtime value types. JSON null/undefined are never Runtime values. */
export type RuntimeValue = number | string | boolean | readonly RuntimeValue[] | RuntimeRecord;
export interface RuntimeRecord {
  readonly [field: string]: RuntimeValue;
}

/** VM-internal ABSENT sentinel; never stored, never a Result output (F03 §10). */
export const ABSENT: unique symbol = Symbol("appf2.runtime.ABSENT");
export type EvaluatedValue = RuntimeValue | typeof ABSENT;

export function isRuntimeRecord(value: unknown): value is RuntimeRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Value-level base type; ENUM members are primitives, so ENUM is matched by member type. */
export function matchesBaseType(value: RuntimeValue, type: DescriptorType): boolean {
  switch (type) {
    case "NUMBER":
      return typeof value === "number" && Number.isFinite(value);
    case "STRING":
      return typeof value === "string";
    case "BOOLEAN":
      return typeof value === "boolean";
    case "ENUM":
      return typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
    case "LIST":
      return Array.isArray(value);
    case "RECORD":
      return isRuntimeRecord(value);
  }
}

export function deepFreeze<T>(root: T): T {
  const pending: unknown[] = [root];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    if (typeof current === "object" && current !== null && !Object.isFrozen(current)) {
      Object.freeze(current);
      for (const child of Object.values(current)) {
        pending.push(child);
      }
    }
  }
  return root;
}

/**
 * Admitted JSON (F02 LITERAL / initial values) cannot contain null because F02 rejects LITERAL null and every
 * admitted value conforms to a TypeDescriptor; a top-level null here means the admitted content is broken.
 */
export function admittedRuntimeValue(value: JsonValue): RuntimeValue {
  if (value === null) {
    return invariantBroken("Admitted JSON value is null.");
  }
  return value as RuntimeValue;
}
