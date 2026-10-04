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

function hasOnlyDataProperties(value: object): boolean {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    return false;
  }
  const isArray = Array.isArray(value);
  return Object.getOwnPropertyNames(value).every((key) => {
    if (isArray && key === "length") return true;
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    return "value" in descriptor && descriptor.enumerable === true;
  });
}

function isDenseArray(value: readonly unknown[]): boolean {
  const keys = Object.keys(value);
  return keys.length === value.length && keys.every((key, index) => key === String(index));
}

type JsonFrame =
  | { readonly kind: "enter"; readonly value: unknown; readonly path: string }
  | { readonly kind: "exit"; readonly value: object };

function childrenOf(value: object, path: string): JsonFrame[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => ({ kind: "enter", value: item, path: `${path}[${index}]` }));
  }
  return Object.entries(value).map(([key, item]) => ({
    kind: "enter",
    value: item,
    path: `${path}[${JSON.stringify(key)}]`
  }));
}

function isJsonContainer(value: object): boolean {
  if (Array.isArray(value)) {
    return isDenseArray(value) && hasOnlyDataProperties(value);
  }
  return isPlainRecord(value) && hasOnlyDataProperties(value);
}

/**
 * Returns the first path that is not inert JSON data (functions, class instances, accessors,
 * non-finite numbers, sparse arrays or cycles), or null when the whole value is plain JSON.
 * Iterative so attacker-controlled nesting cannot exhaust the call stack.
 */
export function findNonJsonPath(root: unknown, rootPath = "$"): string | null {
  const ancestors = new Set<object>();
  const stack: JsonFrame[] = [{ kind: "enter", value: root, path: rootPath }];
  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.kind === "exit") {
      ancestors.delete(frame.value);
      continue;
    }
    const { value, path } = frame;
    if (value === null || typeof value === "string" || typeof value === "boolean") {
      continue;
    }
    if (typeof value === "number") {
      if (!Number.isFinite(value)) return path;
      continue;
    }
    if (typeof value !== "object" || ancestors.has(value) || !isJsonContainer(value)) {
      return path;
    }
    ancestors.add(value);
    stack.push({ kind: "exit", value }, ...childrenOf(value, path).reverse());
  }
  return null;
}

type SerializeTask = { readonly text: string } | { readonly value: JsonValue };

/** Deterministic key-sorted JSON encoding; iterative for the same stack-safety reason. */
export function canonicalJson(root: JsonValue): string {
  const output: string[] = [];
  const tasks: SerializeTask[] = [{ value: root }];
  while (tasks.length > 0) {
    const task = tasks.pop()!;
    if ("text" in task) {
      output.push(task.text);
      continue;
    }
    const { value } = task;
    if (value === null || typeof value !== "object") {
      output.push(JSON.stringify(Object.is(value, -0) ? 0 : value));
      continue;
    }
    const pending: SerializeTask[] = [];
    if (Array.isArray(value)) {
      const items = value as readonly JsonValue[];
      pending.push({ text: "[" });
      items.forEach((item, index) => {
        if (index > 0) pending.push({ text: "," });
        pending.push({ value: item });
      });
      pending.push({ text: "]" });
    } else {
      const record = value as JsonRecord;
      pending.push({ text: "{" });
      Object.keys(record)
        .sort()
        .forEach((key, index) => {
          pending.push({ text: `${index > 0 ? "," : ""}${JSON.stringify(key)}:` });
          pending.push({ value: record[key]! });
        });
      pending.push({ text: "}" });
    }
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      tasks.push(pending[index]!);
    }
  }
  return output.join("");
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
