import { QUESTION_VALUE_TYPE, type QuestionType, type ValueType } from "../../platform/intent/intent-contract.js";
import { canonicalJson, isJsonValue, isPlainRecord, type JsonValue } from "../../platform/intent/json-value.js";
import { valueMatchesType } from "../../platform/intent/value-shape.js";
import { OPEN_JSON_RECORD_V1 } from "../../platform/intent/visible-assumptions.js";

export type ChoiceShape = { readonly valueType: "ENUM" | "LIST"; readonly options: readonly JsonValue[] };
export type PlainShape = { readonly valueType: "STRING" | "NUMBER" | "BOOLEAN" | "RECORD" };

/**
 * F01-DATA-001 / F01-DATA-004A answer & edit shape exactly as F01 projected it. It is the only authority for
 * which control the Shell renders; nothing is ever inferred from a current or proposed value.
 */
export type EditShape = ChoiceShape | PlainShape;

type WireFields = Readonly<Record<string, unknown>>;

export function optionsOf(shape: EditShape): readonly JsonValue[] | undefined {
  return "options" in shape ? shape.options : undefined;
}

export function sameShape(left: EditShape, right: EditShape): boolean {
  return left.valueType === right.valueType && canonicalJson(optionsOf(left) ?? null) === canonicalJson(optionsOf(right) ?? null);
}

export function shapeAccepts(shape: EditShape, value: JsonValue): boolean {
  return valueMatchesType(value, shape.valueType, optionsOf(shape));
}

/** The fixed question_type → expected_value_type pairing; any other combination is a contract violation. */
function readPairing(fields: WireFields): ValueType | null {
  const questionType = fields.question_type;
  if (typeof questionType !== "string" || !Object.hasOwn(QUESTION_VALUE_TYPE, questionType)) return null;
  const valueType = QUESTION_VALUE_TYPE[questionType as QuestionType];
  return fields.expected_value_type === valueType ? valueType : null;
}

/** Trusted alternatives: JSON-native, pairwise distinct by canonical form, at least two. */
function readOptions(value: unknown): readonly JsonValue[] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const options: JsonValue[] = [];
  const seen = new Set<string>();
  for (const option of value as readonly unknown[]) {
    if (!isJsonValue(option)) return null;
    const key = canonicalJson(option);
    if (seen.has(key)) return null;
    seen.add(key);
    options.push(option);
  }
  return options;
}

function isOpenRecordSchema(value: unknown): boolean {
  if (!isPlainRecord(value)) return false;
  const expected = Object.entries(OPEN_JSON_RECORD_V1);
  return Object.keys(value).length === expected.length && expected.every(([key, literal]) => value[key] === literal);
}

/** ClarificationQuestion shape: `options` iff SINGLE_CHOICE / MULTI_CHOICE. */
export function readQuestionShape(fields: WireFields): EditShape | null {
  const valueType = readPairing(fields);
  if (valueType === null) return null;
  if (valueType === "ENUM" || valueType === "LIST") {
    const options = readOptions(fields.options);
    return options === null ? null : { valueType, options };
  }
  return Object.hasOwn(fields, "options") ? null : { valueType };
}

/**
 * Pending DEFAULT / PROPOSAL edit shape (F01-DATA-004A): `options` iff ENUM / LIST, `record_edit_schema` iff
 * RECORD and exactly OPEN_JSON_RECORD_V1, and the pending value must itself fit the projected shape.
 */
export function readAssumptionShape(fields: WireFields, pending: JsonValue): EditShape | null {
  const shape = readQuestionShape(fields);
  if (shape === null) return null;
  const isRecord = shape.valueType === "RECORD";
  if (isRecord ? !isOpenRecordSchema(fields.record_edit_schema) : Object.hasOwn(fields, "record_edit_schema")) return null;
  return shapeAccepts(shape, pending) ? shape : null;
}
