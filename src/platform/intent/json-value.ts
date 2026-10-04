import { CanonicalJsonError, canonicalizeJson } from "../blueprint/canonical-json.js";

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type JsonRecord = { readonly [key: string]: JsonValue };

export function isPlainRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Returns the deterministic canonical encoding, or null when the value is not inert JSON data
 * (functions, class instances, accessors, undefined, non-finite numbers, sparse arrays, cycles,
 * or nesting deep enough to exhaust the stack).
 */
export function tryCanonicalJson(value: unknown): string | null {
  try {
    return canonicalizeJson(value);
  } catch (error) {
    if (error instanceof CanonicalJsonError || error instanceof RangeError) {
      return null;
    }
    throw error;
  }
}

export function isJsonValue(value: unknown): value is JsonValue {
  return tryCanonicalJson(value) !== null;
}

/** Canonical encoding of already-validated JSON; a failure here means corrupted trusted data. */
export function canonicalJson(value: JsonValue): string {
  return canonicalizeJson(value);
}

export function jsonEquals(left: JsonValue | undefined, right: JsonValue | undefined): boolean {
  if (left === undefined || right === undefined) {
    return left === right;
  }
  return canonicalJson(left) === canonicalJson(right);
}

export function deepFreeze<T>(root: T): T {
  const visited = new WeakSet<object>();
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== "object" || current === null || visited.has(current)) {
      continue;
    }
    visited.add(current);
    Object.freeze(current);
    pending.push(...Object.values(current));
  }
  return root;
}
