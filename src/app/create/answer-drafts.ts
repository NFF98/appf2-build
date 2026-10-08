import type { JsonValue } from "../../platform/intent/json-value.js";
import { valueMatchesType } from "../../platform/intent/value-shape.js";
import type { ClarificationQuestionView } from "./f01-wire.js";

export type FieldRow = { readonly name: string; readonly value: string };

/** Unsent User input per question; kept verbatim across failures so nothing typed is lost. */
export type AnswerDraft =
  | { readonly kind: "TEXT"; readonly text: string }
  | { readonly kind: "BOOLEAN"; readonly value: boolean | null }
  | { readonly kind: "CHOICE"; readonly index: number | null }
  | { readonly kind: "MULTI"; readonly indices: readonly number[] }
  | { readonly kind: "FIELDS"; readonly rows: readonly FieldRow[] };

export type DraftProblem = "REQUIRED" | "TYPE_MISMATCH" | "DUPLICATE_FIELD";
export type DraftValue = { readonly ok: true; readonly value: JsonValue } | { readonly ok: false; readonly problem: DraftProblem };

export function emptyDraft(question: ClarificationQuestionView): AnswerDraft {
  switch (question.question_type) {
    case "BOOLEAN":
      return { kind: "BOOLEAN", value: null };
    case "SINGLE_CHOICE":
      return { kind: "CHOICE", index: null };
    case "MULTI_CHOICE":
      return { kind: "MULTI", indices: [] };
    case "STRUCTURED_FIELDS":
      return { kind: "FIELDS", rows: [{ name: "", value: "" }] };
    case "FREE_TEXT":
    case "NUMBER":
      return { kind: "TEXT", text: "" };
  }
}

const missing: DraftValue = { ok: false, problem: "REQUIRED" };

function textValue(question: ClarificationQuestionView, text: string): DraftValue {
  const trimmed = text.trim();
  if (trimmed.length === 0) return missing;
  if (question.question_type !== "NUMBER") return { ok: true, value: text };
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false, problem: "TYPE_MISMATCH" };
}

function fieldsValue(rows: readonly FieldRow[]): DraftValue {
  const filled = rows.filter((row) => row.name.trim().length > 0);
  if (filled.length === 0) return missing;
  const record: Record<string, JsonValue> = {};
  for (const row of filled) {
    const name = row.name.trim();
    if (Object.hasOwn(record, name)) return { ok: false, problem: "DUPLICATE_FIELD" };
    record[name] = row.value;
  }
  return { ok: true, value: record };
}

function rawValue(question: ClarificationQuestionView, draft: AnswerDraft): DraftValue {
  const options = question.options ?? [];
  switch (draft.kind) {
    case "TEXT":
      return textValue(question, draft.text);
    case "BOOLEAN":
      return draft.value === null ? missing : { ok: true, value: draft.value };
    case "CHOICE":
      return draft.index === null || options[draft.index] === undefined ? missing : { ok: true, value: options[draft.index] as JsonValue };
    case "MULTI":
      return draft.indices.length === 0 ? missing : { ok: true, value: [...draft.indices].sort((a, b) => a - b).map((index) => options[index] as JsonValue) };
    case "FIELDS":
      return fieldsValue(draft.rows);
  }
}

/**
 * F00-UX-009 rule 5 local required/type check. Every F01 question is `required: true`; the shape check is
 * F01's own `valueMatchesType`, so the Browser can never accept a value the server contract would reject
 * for type reasons. F01 remains the authority on the submitted answer.
 */
export function draftValue(question: ClarificationQuestionView, draft: AnswerDraft | undefined): DraftValue {
  const value = rawValue(question, draft ?? emptyDraft(question));
  if (!value.ok) return value;
  return valueMatchesType(value.value, question.expected_value_type, question.options) ? value : { ok: false, problem: "TYPE_MISMATCH" };
}

export function displayValue(value: JsonValue | undefined): string {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return value.map((entry) => displayValue(entry)).join("、");
  return Object.entries(value)
    .map(([key, entry]) => `${key}：${displayValue(entry)}`)
    .join("、");
}
