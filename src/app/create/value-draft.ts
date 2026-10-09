import { canonicalJson, isPlainRecord, type JsonValue } from "../../platform/intent/json-value.js";
import { shapeAccepts, type EditShape } from "./edit-shape.js";
import { collectIds, emptyField, fieldsFromRecord, parseNumber, readFields, type FieldNode, type NodeProblem } from "./json-draft.js";

/**
 * Unsent User input for one F01 shape, kept verbatim across failures. Choices are indices into the F01
 * `options[]`, so a submitted value is always one of the trusted native alternatives.
 */
export type ValueDraft =
  | { readonly kind: "TEXT"; readonly text: string }
  | { readonly kind: "BOOLEAN"; readonly value: boolean | null }
  | { readonly kind: "CHOICE"; readonly index: number | null }
  | { readonly kind: "MULTI"; readonly indices: readonly number[] }
  | { readonly kind: "RECORD"; readonly fields: readonly FieldNode[] };

/**
 * ANSWER: a required clarification answer, so an empty entry is not an answer.
 * EDIT: replaces a pending value; any value that fits the projected type is a legitimate edit.
 */
export type DraftMode = "ANSWER" | "EDIT";

export type ValueProblem = "REQUIRED" | "TYPE_MISMATCH" | "INVALID_FIELDS";

export type DraftRead =
  | { readonly ok: true; readonly value: JsonValue }
  | { readonly ok: false; readonly problem: ValueProblem; readonly nodeProblems: Readonly<Record<string, NodeProblem>> };

const failed = (problem: ValueProblem, nodeProblems: Readonly<Record<string, NodeProblem>> = {}): DraftRead => ({ ok: false, problem, nodeProblems });

export function emptyDraft(shape: EditShape): ValueDraft {
  switch (shape.valueType) {
    case "STRING":
    case "NUMBER":
      return { kind: "TEXT", text: "" };
    case "BOOLEAN":
      return { kind: "BOOLEAN", value: null };
    case "ENUM":
      return { kind: "CHOICE", index: null };
    case "LIST":
      return { kind: "MULTI", indices: [] };
    case "RECORD":
      return { kind: "RECORD", fields: [emptyField()] };
  }
}

function optionIndex(options: readonly JsonValue[], value: JsonValue): number {
  const key = canonicalJson(value);
  return options.findIndex((option) => canonicalJson(option) === key);
}

/** EDIT starts from the value F01 presented; the shape (never the value) decides which editor that is. */
export function draftFrom(shape: EditShape, value: JsonValue): ValueDraft {
  switch (shape.valueType) {
    case "STRING":
    case "NUMBER":
      return { kind: "TEXT", text: typeof value === "string" || typeof value === "number" ? String(value) : "" };
    case "BOOLEAN":
      return { kind: "BOOLEAN", value: typeof value === "boolean" ? value : null };
    case "ENUM": {
      const index = optionIndex(shape.options, value);
      return { kind: "CHOICE", index: index < 0 ? null : index };
    }
    case "LIST": {
      const selected = Array.isArray(value) ? (value as readonly JsonValue[]) : [];
      return { kind: "MULTI", indices: selected.map((entry) => optionIndex(shape.options, entry)).filter((index) => index >= 0) };
    }
    case "RECORD":
      return { kind: "RECORD", fields: isPlainRecord(value) ? fieldsFromRecord(value as { readonly [key: string]: JsonValue }) : [] };
  }
}

function readText(shape: EditShape, text: string, mode: DraftMode): DraftRead {
  if (shape.valueType === "NUMBER") {
    if (text.trim().length === 0) return failed("REQUIRED");
    const parsed = parseNumber(text);
    return parsed === null ? failed("TYPE_MISMATCH") : { ok: true, value: parsed };
  }
  return mode === "ANSWER" && text.trim().length === 0 ? failed("REQUIRED") : { ok: true, value: text };
}

function readRecord(fields: readonly FieldNode[], mode: DraftMode): DraftRead {
  if (mode === "ANSWER" && fields.length === 0) return failed("REQUIRED");
  const nodeProblems: Record<string, NodeProblem> = {};
  const value = readFields(fields, nodeProblems);
  return value === undefined ? failed("INVALID_FIELDS", nodeProblems) : { ok: true, value };
}

function readRaw(shape: EditShape, draft: ValueDraft, mode: DraftMode): DraftRead {
  const options = "options" in shape ? shape.options : [];
  switch (draft.kind) {
    case "TEXT":
      return readText(shape, draft.text, mode);
    case "BOOLEAN":
      return draft.value === null ? failed("REQUIRED") : { ok: true, value: draft.value };
    case "CHOICE": {
      const option = draft.index === null ? undefined : options[draft.index];
      return option === undefined ? failed("REQUIRED") : { ok: true, value: option };
    }
    case "MULTI": {
      if (mode === "ANSWER" && draft.indices.length === 0) return failed("REQUIRED");
      const selected = [...draft.indices].sort((left, right) => left - right).map((index) => options[index]);
      return selected.every((option): option is JsonValue => option !== undefined) ? { ok: true, value: selected } : failed("TYPE_MISMATCH");
    }
    case "RECORD":
      return readRecord(draft.fields, mode);
  }
}

/**
 * Local required / type check before F01-API-002. The final gate is F01's own `valueMatchesType`, so the
 * Browser never submits a value whose type the trusted contract would reject; F01 stays the authority.
 */
export function readDraft(shape: EditShape, draft: ValueDraft, mode: DraftMode): DraftRead {
  const read = readRaw(shape, draft, mode);
  if (!read.ok) return read;
  return shapeAccepts(shape, read.value) ? read : failed("TYPE_MISMATCH");
}

/** Ids inside a RECORD draft whose field-level problems become stale once that draft changes. */
export function draftNodeIds(draft: ValueDraft | undefined): ReadonlySet<string> {
  return draft?.kind === "RECORD" ? collectIds(draft.fields) : new Set();
}
