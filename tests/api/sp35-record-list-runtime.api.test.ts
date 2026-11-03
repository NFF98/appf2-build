import { describe, expect, it } from "vitest";
import type { TypeDescriptor } from "../../src/platform/capabilities/schema/validator-contract.js";
import { inferValueSource, type TypingContext } from "../../src/platform/blueprint/value-source-typing.js";
import type { ValueSource } from "../../src/platform/blueprint/validation-types.js";
import { evaluateTyped, type EvaluationEnv } from "../../src/platform/runtime/expression-vm.js";

const record: TypeDescriptor = {
  type: "RECORD", constraints: { fields: {
    title: { type: "STRING", constraints: { max_length: 80 } },
    done: { type: "BOOLEAN" }, category: { type: "STRING", constraints: { max_length: 30 } }
  } }
};
const tasks: TypeDescriptor = { type: "LIST", constraints: { item: record, max_length: 25 } };
const current = Object.freeze([{ title: "Milk", done: false, category: "shopping" },
  { title: "Walk", done: true, category: "health" }]);
const state: ValueSource = { kind: "STATE", key: "tasks" };
const item: ValueSource = { kind: "SCOPE", name: "item", path: "" };
const literal = (value: string | number | boolean): ValueSource => ({ kind: "LITERAL", value });
const op = (name: string, ...args: ValueSource[]): ValueSource => ({ kind: "OP", op: name, args });
const typing: TypingContext = {
  errorCode: "F02-ERR-009", stage: "V07",
  lookupState: (key) => key === "tasks" ? { descriptor: tasks, mutable: true } : undefined,
  lookupRule: () => undefined,
  scope: new Map([["item", record]])
};
const env: EvaluationEnv = {
  readState: () => current,
  readRule: () => { throw Error("unexpected rule"); },
  scope: new Map([["item", current[0]!]])
};

describe("Sprint 3.5 typed task records, completion and filtering", () => {
  it("changes the completion flag without mutating a task record", () => {
    const source = op("RECORD_SET", item, literal("done"), literal(true));
    expect(inferValueSource(source, "$.actions[0].steps[0].value", typing)).toEqual(record);
    expect(evaluateTyped(source, env)).toEqual({ title: "Milk", done: true, category: "shopping" });
    expect(current[0]?.done).toBe(false);
  });

  it("filters tasks by completed flag and supports COUNT of filtered tasks", () => {
    const filtered = op("LIST_FILTER_EQ", state, literal("done"), literal(true));
    expect(inferValueSource(filtered, "$.rules[0].expr", typing)).toEqual(tasks);
    expect(evaluateTyped(filtered, env)).toEqual([current[1]]);
    expect(evaluateTyped(op("COUNT", filtered), env)).toBe(1);
    expect(current).toHaveLength(2);
  });

  it("filters by category without altering the original task order", () => {
    const filtered = op("LIST_FILTER_EQ", state, literal("category"), literal("shopping"));
    expect(evaluateTyped(filtered, env)).toEqual([current[0]]);
    expect(current[0]?.category).toBe("shopping");
  });

  it("rejects undeclared fields, dynamic field names and incorrect type", () => {
    expect(() => inferValueSource(op("RECORD_SET", item, literal("unknown"), literal(true)), "$.bad", typing)).toThrow();
    expect(() => inferValueSource(op("RECORD_SET", item, state, literal(true)), "$.bad", typing)).toThrow();
    expect(() => inferValueSource(op("LIST_FILTER_EQ", state, literal("done"), literal("yes")), "$.bad", typing)).toThrow();
    expect(() => evaluateTyped(op("RECORD_SET", item, literal("__proto__"), literal(true)), env)).toThrow();
  });
});
