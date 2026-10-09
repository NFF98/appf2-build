import type { JsonValue } from "../../platform/intent/json-value.js";

type Entries = readonly (readonly [string, JsonValue])[];

export function recordEntries(value: JsonValue): Entries {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? Object.entries(value as { readonly [key: string]: JsonValue }) : [];
}

export function scalarText(value: string | number | boolean | null): string {
  if (value === null) return "空值";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return value.length === 0 ? "（空白）" : value;
  return String(value);
}

/** One-line reading of any value; nested composites are bracketed so their structure stays visible. */
export function summaryText(value: JsonValue, nested = false): string {
  if (Array.isArray(value)) {
    const text = (value as readonly JsonValue[]).map((entry) => summaryText(entry, true)).join("、");
    if (nested) return `［${text}］`;
    return text.length === 0 ? "（無）" : text;
  }
  if (value !== null && typeof value === "object") {
    const text = recordEntries(value)
      .map(([key, entry]) => `${key}：${summaryText(entry, true)}`)
      .join("、");
    if (nested) return `｛${text}｝`;
    return text.length === 0 ? "（無欄位）" : text;
  }
  return scalarText(value as string | number | boolean | null);
}

const TYPE_NAMES = { string: "文字", number: "數字", boolean: "是非", null: "空值", list: "清單", record: "欄位組" } as const;

function typeName(value: JsonValue): string {
  if (value === null) return TYPE_NAMES.null;
  if (Array.isArray(value)) return TYPE_NAMES.list;
  if (typeof value === "object") return TYPE_NAMES.record;
  return TYPE_NAMES[typeof value as "string" | "number" | "boolean"];
}

/**
 * Labels for F01 `options[]`. Distinct native values may read alike (`1` and `"1"`); those labels name their
 * type so the User can always tell which trusted alternative they pick.
 */
export function optionLabels(options: readonly JsonValue[]): readonly string[] {
  const texts = options.map((option) => summaryText(option));
  const counts = new Map<string, number>();
  for (const text of texts) counts.set(text, (counts.get(text) ?? 0) + 1);
  return texts.map((text, index) => ((counts.get(text) ?? 0) > 1 ? `${text}（${typeName(options[index] as JsonValue)}）` : text));
}
