import type { JsonValue } from "../../platform/intent/json-value.js";

/** Typed value kinds of an OPEN_JSON_RECORD_V1 field (F01-DATA-004A RECORD rule 2). */
export const NODE_KINDS = ["STRING", "NUMBER", "BOOLEAN", "NULL", "LIST", "RECORD"] as const;
export type NodeKind = (typeof NODE_KINDS)[number];

/**
 * Unsent, User-editable JSON value. Every node keeps a stable local id so React state and field-level
 * problems survive edits; numbers stay as typed text until submit so a partial entry is never lost.
 */
export type JsonNode =
  | { readonly id: string; readonly kind: "STRING"; readonly text: string }
  | { readonly id: string; readonly kind: "NUMBER"; readonly text: string }
  | { readonly id: string; readonly kind: "BOOLEAN"; readonly value: boolean | null }
  | { readonly id: string; readonly kind: "NULL" }
  | { readonly id: string; readonly kind: "LIST"; readonly items: readonly JsonNode[] }
  | { readonly id: string; readonly kind: "RECORD"; readonly fields: readonly FieldNode[] };

export type FieldNode = { readonly id: string; readonly name: string; readonly value: JsonNode };

export type NodeProblem = "FIELD_NAME_REQUIRED" | "FIELD_NAME_DUPLICATE" | "NUMBER_INVALID" | "BOOLEAN_REQUIRED";
export type NodeProblems = Readonly<Record<string, NodeProblem>>;

let lastId = 0;
const newId = (): string => `node-${++lastId}`;

/** Plain decimal / exponent notation only; `Number("")`, hex or `Infinity` are not finite JSON numbers. */
const DECIMAL = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

export function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (!DECIMAL.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export function emptyNode(kind: NodeKind, id: string = newId()): JsonNode {
  switch (kind) {
    case "STRING":
    case "NUMBER":
      return { id, kind, text: "" };
    case "BOOLEAN":
      return { id, kind, value: null };
    case "NULL":
      return { id, kind };
    case "LIST":
      return { id, kind, items: [] };
    case "RECORD":
      return { id, kind, fields: [] };
  }
}

export function emptyField(): FieldNode {
  return { id: newId(), name: "", value: emptyNode("STRING") };
}

/** An explicit User type change. Text survives STRING ↔ NUMBER; any other change starts an empty value. */
export function changeKind(node: JsonNode, kind: NodeKind): JsonNode {
  if (node.kind === kind) return node;
  if ((node.kind === "STRING" || node.kind === "NUMBER") && (kind === "STRING" || kind === "NUMBER")) {
    return { id: node.id, kind, text: node.text };
  }
  return emptyNode(kind, node.id);
}

export function fieldsFromRecord(record: { readonly [key: string]: JsonValue }): FieldNode[] {
  return Object.entries(record).map(([name, value]) => ({ id: newId(), name, value: nodeFromJson(value) }));
}

export function nodeFromJson(value: JsonValue): JsonNode {
  const id = newId();
  if (value === null) return { id, kind: "NULL" };
  if (typeof value === "string") return { id, kind: "STRING", text: value };
  if (typeof value === "number") return { id, kind: "NUMBER", text: String(value) };
  if (typeof value === "boolean") return { id, kind: "BOOLEAN", value };
  if (Array.isArray(value)) return { id, kind: "LIST", items: (value as readonly JsonValue[]).map(nodeFromJson) };
  return { id, kind: "RECORD", fields: fieldsFromRecord(value as { readonly [key: string]: JsonValue }) };
}

/**
 * Reads User-defined fields into a native plain object. Names are taken exactly as typed; blank or repeated
 * names are reported instead of silently overwriting a sibling. `Object.fromEntries` defines own properties,
 * so a field literally named `__proto__` stays data.
 */
export function readFields(fields: readonly FieldNode[], problems: Record<string, NodeProblem>): JsonValue | undefined {
  const names = new Set<string>();
  const entries: [string, JsonValue][] = [];
  let valid = true;
  for (const field of fields) {
    if (field.name.trim().length === 0) problems[field.id] = "FIELD_NAME_REQUIRED";
    else if (names.has(field.name)) problems[field.id] = "FIELD_NAME_DUPLICATE";
    names.add(field.name);
    const value = readNode(field.value, problems);
    if (value === undefined || problems[field.id] !== undefined) valid = false;
    else entries.push([field.name, value]);
  }
  return valid ? Object.fromEntries(entries) : undefined;
}

function readItems(items: readonly JsonNode[], problems: Record<string, NodeProblem>): JsonValue | undefined {
  const values = items.map((item) => readNode(item, problems));
  return values.every((value) => value !== undefined) ? (values as JsonValue[]) : undefined;
}

/** Native JsonValue of a node, or undefined after recording every problem found in the subtree. */
export function readNode(node: JsonNode, problems: Record<string, NodeProblem>): JsonValue | undefined {
  switch (node.kind) {
    case "STRING":
      return node.text;
    case "NUMBER": {
      const parsed = parseNumber(node.text);
      if (parsed === null) problems[node.id] = "NUMBER_INVALID";
      return parsed ?? undefined;
    }
    case "BOOLEAN":
      if (node.value === null) problems[node.id] = "BOOLEAN_REQUIRED";
      return node.value ?? undefined;
    case "NULL":
      return null;
    case "LIST":
      return readItems(node.items, problems);
    case "RECORD":
      return readFields(node.fields, problems);
  }
}

/** Ids of every node and field in the subtree, used to drop stale problems once the User edits it. */
export function collectIds(fields: readonly FieldNode[], into: Set<string> = new Set()): Set<string> {
  const pending: JsonNode[] = [];
  for (const field of fields) {
    into.add(field.id);
    pending.push(field.value);
  }
  while (pending.length > 0) {
    const node = pending.pop() as JsonNode;
    into.add(node.id);
    if (node.kind === "LIST") pending.push(...node.items);
    if (node.kind === "RECORD") {
      for (const field of node.fields) {
        into.add(field.id);
        pending.push(field.value);
      }
    }
  }
  return into;
}

export function hasProblemWithin(node: JsonNode, problems: NodeProblems): boolean {
  if (problems[node.id] !== undefined) return true;
  if (node.kind === "LIST") return node.items.some((item) => hasProblemWithin(item, problems));
  if (node.kind === "RECORD") return node.fields.some((field) => problems[field.id] !== undefined || hasProblemWithin(field.value, problems));
  return false;
}
