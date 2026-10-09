import { describe, expect, test } from "vitest";

import { decidableAssumptions, planDecisions } from "../../src/app/create/assumptions.js";
import { readAssumptionShape, readQuestionShape, sameShape, type EditShape } from "../../src/app/create/edit-shape.js";
import { readDecision } from "../../src/app/create/f01-wire.js";
import { changeKind, collectIds, hasProblemWithin, nodeFromJson, parseNumber, readFields, type FieldNode, type JsonNode, type NodeProblem } from "../../src/app/create/json-draft.js";
import { optionLabels, summaryText } from "../../src/app/create/value-display.js";
import { draftFrom, emptyDraft, readDraft } from "../../src/app/create/value-draft.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";
import { OPEN_JSON_RECORD_V1 } from "../../src/platform/intent/visible-assumptions.js";

const STRING: EditShape = { valueType: "STRING" };
const NUMBER: EditShape = { valueType: "NUMBER" };
const BOOLEAN: EditShape = { valueType: "BOOLEAN" };
const RECORD: EditShape = { valueType: "RECORD" };
const ROUNDING: EditShape = { valueType: "ENUM", options: [10, 1, "none"] };
const ADD_ONS: EditShape = { valueType: "LIST", options: ["drinks", { item: "cake", size: 6 }, 0] };

const pairing = {
  STRING: { question_type: "FREE_TEXT", expected_value_type: "STRING" },
  NUMBER: { question_type: "NUMBER", expected_value_type: "NUMBER" },
  BOOLEAN: { question_type: "BOOLEAN", expected_value_type: "BOOLEAN" },
  ENUM: { question_type: "SINGLE_CHOICE", expected_value_type: "ENUM" },
  LIST: { question_type: "MULTI_CHOICE", expected_value_type: "LIST" },
  RECORD: { question_type: "STRUCTURED_FIELDS", expected_value_type: "RECORD" }
} as const;

const field = (name: string, value: JsonNode): FieldNode => ({ id: `field-${name}-${value.id}`, name, value });

describe("F00 typed edit shapes and drafts", () => {
  test("edit shapes come only from the projected fields and fail closed on any inconsistency", () => {
    expect(readAssumptionShape({ ...pairing.ENUM, options: [10, 1, "none"] }, 10)).toEqual(ROUNDING);
    expect(readAssumptionShape({ ...pairing.RECORD, record_edit_schema: OPEN_JSON_RECORD_V1 }, { main: "火鍋" })).toEqual(RECORD);
    expect(readAssumptionShape(pairing.STRING, "")).toEqual(STRING);

    const broken: [Record<string, unknown>, JsonValue][] = [
      [pairing.ENUM, 10],
      [{ ...pairing.ENUM, options: [10, 1] }, 5],
      [{ ...pairing.ENUM, options: [10] }, 10],
      [{ ...pairing.LIST, options: ["drinks", "drinks"] }, []],
      [{ ...pairing.LIST, options: ["drinks", "cake"] }, ["drinks", "drinks"]],
      [pairing.RECORD, {}],
      [{ ...pairing.RECORD, record_edit_schema: { ...OPEN_JSON_RECORD_V1, nested: false } }, {}],
      [{ ...pairing.RECORD, record_edit_schema: OPEN_JSON_RECORD_V1 }, ["not", "a", "record"]],
      [{ ...pairing.STRING, record_edit_schema: OPEN_JSON_RECORD_V1 }, "x"],
      [{ question_type: "FREE_TEXT", expected_value_type: "BOOLEAN" }, true],
      [{ ...pairing.NUMBER, options: [1, 2] }, 1],
      [pairing.NUMBER, "8"],
      [pairing.BOOLEAN, "true"],
      [{ question_type: "toString", expected_value_type: "STRING" }, "x"]
    ];
    for (const [fields, pending] of broken) expect(readAssumptionShape(fields, pending)).toBeNull();
    expect(readQuestionShape({ ...pairing.LIST, options: ["a", "b"] })).toEqual({ valueType: "LIST", options: ["a", "b"] });
    expect(sameShape(ROUNDING, { valueType: "ENUM", options: [10, 1, "none"] })).toBe(true);
    expect(sameShape(ROUNDING, { valueType: "ENUM", options: [1, 10, "none"] })).toBe(false);
  });

  test("a decision round is rejected whole when it breaks status invariants or repeats ids", () => {
    const question = (id: string) => ({ question_id: id, prompt: id, required: true, semantic_item_ids: [`t_${id}`], ...pairing.NUMBER });
    const pending = { assumption_id: "a1", classification: "DEFAULT", description: "幣別", proposed_default: "TWD", ...pairing.STRING };
    const round = (status: string, questions: unknown[], assumptions: unknown[] = []) =>
      readDecision({ intent_id: "intent-1", intent_version: 1, status, questions, visible_assumptions: assumptions });

    expect(round("NEEDS_CLARIFICATION", [question("q1")])?.questions).toHaveLength(1);
    expect(round("NEEDS_CLARIFICATION", [])).toBeNull();
    expect(round("NEEDS_CLARIFICATION", ["q1", "q2", "q3", "q4"].map(question))).toBeNull();
    expect(round("NEEDS_CLARIFICATION", [question("q1"), question("q1")])).toBeNull();
    expect(round("NEEDS_CLARIFICATION", [{ ...question("q1"), semantic_item_ids: ["a", "b"] }])).toBeNull();
    expect(round("NEEDS_CLARIFICATION", [{ ...question("q1"), required: false }])).toBeNull();
    expect(round("READY", [question("q1")])).toBeNull();
    expect(round("READY_WITH_VISIBLE_ASSUMPTIONS", [], [{ ...pending, classification: "FACT", resolved_value: "TWD" }])).toBeNull();
    expect(round("READY_WITH_VISIBLE_ASSUMPTIONS", [], [pending, pending])).toBeNull();
    expect(round("READY_WITH_VISIBLE_ASSUMPTIONS", [], [{ ...pending, classification: "GUESS" }])).toBeNull();
    expect(round("READY_WITH_VISIBLE_ASSUMPTIONS", [], [pending])?.assumptions[0]).toEqual({
      assumptionId: "a1",
      classification: "DEFAULT",
      description: "幣別",
      value: "TWD",
      shape: STRING
    });
    expect(readDecision({ intent_id: "intent-1", intent_version: 0, status: "READY", questions: [], visible_assumptions: [] })).toBeNull();
  });
});

describe("F00 typed drafts, record fields and decisions", () => {
  test("drafts read back as native typed values and text is never coerced into another type", () => {
    expect(readDraft(NUMBER, { kind: "TEXT", text: " 1.5e3 " }, "EDIT")).toEqual({ ok: true, value: 1500 });
    expect(["0x10", "Infinity", "1,000", "七百"].map((text) => parseNumber(text))).toEqual([null, null, null, null]);
    expect(readDraft(NUMBER, { kind: "TEXT", text: "abc" }, "EDIT")).toMatchObject({ ok: false, problem: "TYPE_MISMATCH" });
    expect(readDraft(NUMBER, { kind: "TEXT", text: " " }, "EDIT")).toMatchObject({ ok: false, problem: "REQUIRED" });
    expect(readDraft(STRING, { kind: "TEXT", text: "" }, "EDIT")).toEqual({ ok: true, value: "" });
    expect(readDraft(STRING, { kind: "TEXT", text: "  " }, "ANSWER")).toMatchObject({ ok: false, problem: "REQUIRED" });
    expect(readDraft(STRING, { kind: "TEXT", text: "true" }, "EDIT")).toEqual({ ok: true, value: "true" });
    expect(readDraft(BOOLEAN, { kind: "BOOLEAN", value: false }, "EDIT")).toEqual({ ok: true, value: false });
    expect(readDraft(BOOLEAN, emptyDraft(BOOLEAN), "EDIT")).toMatchObject({ ok: false, problem: "REQUIRED" });
    expect(readDraft(ROUNDING, { kind: "CHOICE", index: 2 }, "EDIT")).toEqual({ ok: true, value: "none" });
    expect(readDraft(ROUNDING, { kind: "CHOICE", index: 7 }, "EDIT")).toMatchObject({ ok: false, problem: "REQUIRED" });
    expect(readDraft(ADD_ONS, { kind: "MULTI", indices: [2, 1] }, "EDIT")).toEqual({ ok: true, value: [{ item: "cake", size: 6 }, 0] });
    expect(readDraft(ADD_ONS, { kind: "MULTI", indices: [] }, "EDIT")).toEqual({ ok: true, value: [] });
    expect(readDraft(ADD_ONS, { kind: "MULTI", indices: [] }, "ANSWER")).toMatchObject({ ok: false, problem: "REQUIRED" });
    expect(readDraft(ADD_ONS, { kind: "MULTI", indices: [1, 1] }, "EDIT")).toMatchObject({ ok: false, problem: "TYPE_MISMATCH" });
    expect(readDraft(RECORD, { kind: "RECORD", fields: [] }, "EDIT")).toEqual({ ok: true, value: {} });
    expect(readDraft(NUMBER, { kind: "BOOLEAN", value: true }, "EDIT")).toMatchObject({ ok: false, problem: "TYPE_MISMATCH" });
  });

  test("record fields keep User defined names exactly and report blank or repeated names on the later field", () => {
    const problems: Record<string, NodeProblem> = {};
    const proto = field("__proto__", { id: "n1", kind: "STRING", text: "data" });
    const nested = field("budget", { id: "n2", kind: "RECORD", fields: [field("per_person", { id: "n3", kind: "NUMBER", text: "700" })] });
    const value = readFields([proto, nested, field("note", { id: "n4", kind: "NULL" })], problems);
    expect(problems).toEqual({});
    expect(JSON.stringify(value)).toBe('{"__proto__":"data","budget":{"per_person":700},"note":null}');
    expect(Object.getPrototypeOf(value)).toBe(Object.prototype);

    const first = field("main", { id: "n5", kind: "STRING", text: "a" });
    const repeated = field("main", { id: "n6", kind: "STRING", text: "b" });
    const blank = field(" ", { id: "n7", kind: "BOOLEAN", value: null });
    const invalid = field("count", { id: "n8", kind: "LIST", items: [{ id: "n9", kind: "NUMBER", text: "七" }] });
    expect(readFields([first, repeated, blank, invalid], problems)).toBeUndefined();
    expect(problems).toEqual({ [repeated.id]: "FIELD_NAME_DUPLICATE", [blank.id]: "FIELD_NAME_REQUIRED", n7: "BOOLEAN_REQUIRED", n9: "NUMBER_INVALID" });
    expect(hasProblemWithin(invalid.value, problems)).toBe(true);
    expect(hasProblemWithin(first.value, problems)).toBe(false);
    expect(collectIds([invalid])).toEqual(new Set([invalid.id, "n8", "n9"]));
  });

  test("editors are seeded from the presented value through the shape and keep text across number and string", () => {
    const menu = { main: "火鍋", extras: ["飲料", { size: 6 }], vegan: false };
    const seeded = draftFrom(RECORD, menu);
    expect(seeded.kind === "RECORD" && readFields(seeded.fields, {})).toEqual(menu);
    expect(draftFrom(ROUNDING, "none")).toEqual({ kind: "CHOICE", index: 2 });
    expect(draftFrom(ADD_ONS, [0, { size: 6, item: "cake" }])).toEqual({ kind: "MULTI", indices: [2, 1] });
    expect(draftFrom(NUMBER, 12)).toEqual({ kind: "TEXT", text: "12" });

    const text = nodeFromJson("42");
    expect(changeKind(text, "NUMBER")).toEqual({ id: text.id, kind: "NUMBER", text: "42" });
    expect(changeKind(text, "LIST")).toEqual({ id: text.id, kind: "LIST", items: [] });
  });

  test("option labels and summaries keep distinct native values distinguishable", () => {
    expect(optionLabels([1, "1", true, null])).toEqual(["1（數字）", "1（文字）", "是", "空值"]);
    expect(optionLabels(["drinks", { item: "cake", size: 6 }, 0])).toEqual(["drinks", "item：cake、size：6", "0"]);
    expect(summaryText({ budget: { per_person: 700 }, extras: ["a", ""] })).toBe("budget：｛per_person：700｝、extras：［a、（空白）］");
    expect(summaryText([])).toBe("（無）");
  });

  test("only explicit choices become decisions and an invalid edit blocks the whole submission locally", () => {
    const round = readDecision({
      intent_id: "intent-1",
      intent_version: 3,
      status: "NEEDS_CLARIFICATION",
      questions: [{ question_id: "q1", prompt: "人數", required: true, semantic_item_ids: ["a_count"], ...pairing.NUMBER }],
      visible_assumptions: [
        { assumption_id: "a_count", classification: "PROPOSAL", description: "人數", proposed_default: 4, ...pairing.NUMBER },
        { assumption_id: "a_tip", classification: "DEFAULT", description: "小費", proposed_default: true, ...pairing.BOOLEAN },
        { assumption_id: "a_fact", classification: "FACT", description: "幣別", resolved_value: "TWD" }
      ]
    });
    if (round === null) throw new Error("fixture round must satisfy the F01 contract");
    const decidable = decidableAssumptions(round);
    expect(decidable.map((item) => item.assumptionId)).toEqual(["a_tip"]);
    expect(planDecisions(decidable, {}, false).decisions).toEqual([]);
    expect(planDecisions(decidable, {}, true).decisions).toEqual([{ assumption_id: "a_tip", decision: "ACCEPT" }]);
    expect(planDecisions(decidable, { a_tip: { decision: "EDIT", value: { kind: "BOOLEAN", value: false } } }, true).decisions).toEqual([
      { assumption_id: "a_tip", decision: "EDIT", edited_value: false }
    ]);
    expect(planDecisions(decidable, { a_tip: { decision: "EDIT", value: { kind: "BOOLEAN", value: null } } }, true)).toEqual({
      decisions: [],
      problems: { a_tip: "REQUIRED" },
      nodeProblems: {}
    });
  });
});
