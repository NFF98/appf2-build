import { describe, expect, it } from "vitest";
import type { TypeDescriptor } from "../../src/platform/capabilities/schema/validator-contract.js";
import { inferValueSource, type TypingContext } from "../../src/platform/blueprint/value-source-typing.js";
import type { ValueSource } from "../../src/platform/blueprint/validation-types.js";
import { evaluateTyped, type EvaluationEnv } from "../../src/platform/runtime/expression-vm.js";
import type { RuntimeValue } from "../../src/platform/runtime/runtime-value.js";

const descriptor: TypeDescriptor = {
  type: "LIST", constraints: { item: { type: "STRING", constraints: { max_length: 80 } }, max_length: 3 }
};
const state: ValueSource = { kind: "STATE", key: "items" };
const literal = (value: string | number): ValueSource => ({ kind: "LITERAL", value });
const edit = (op: string, ...args: ValueSource[]): ValueSource => ({ kind: "OP", op, args });
const types: TypingContext = {
  errorCode: "F02-ERR-010", stage: "V08",
  lookupState: (key) => key === "items" ? { descriptor, mutable: true } : undefined,
  lookupRule: () => undefined
};
const runtime = (items: readonly RuntimeValue[]): EvaluationEnv => ({
  readState: (key) => {
    if (key !== "items") throw Error("unknown state");
    return items;
  },
  readRule: () => { throw Error("unexpected rule"); }
});

describe("Sprint 3.5 typed local list edits", () => {
  it("appends a new task, leaving the original list unchanged", () => {
    const items = Object.freeze(["Buy milk"]);
    const source = edit("LIST_APPEND", state, literal("Call dentist"));
    expect(inferValueSource(source, "$.actions[0].steps[0].value", types, descriptor)).toEqual(descriptor);
    expect(evaluateTyped(source, runtime(items))).toEqual(["Buy milk", "Call dentist"]);
    expect(items).toEqual(["Buy milk"]);
  });

  it("removes an item by an existing zero-based index without mutating the source", () => {
    const items = Object.freeze(["first", "second", "third"]);
    const source = edit("LIST_REMOVE_AT", state, literal(1));
    expect(inferValueSource(source, "$.actions[0].steps[0].value", types, descriptor)).toEqual(descriptor);
    expect(evaluateTyped(source, runtime(items))).toEqual(["first", "third"]);
    expect(items).toHaveLength(3);
  });

  it("replaces one item by index and preserves the others", () => {
    const items = Object.freeze(["first", "second"]);
    const source = edit("LIST_REPLACE_AT", state, literal(0), literal("updated"));
    expect(inferValueSource(source, "$.actions[0].steps[0].value", types, descriptor)).toEqual(descriptor);
    expect(evaluateTyped(source, runtime(items))).toEqual(["updated", "second"]);
    expect(items[0]).toBe("first");
  });

  it("rejects negative, fractional and out-of-bounds indexes", () => {
    for (const index of [-1, 1.5, 2, Number.MAX_SAFE_INTEGER]) {
      expect(() => evaluateTyped(edit("LIST_REMOVE_AT", state, literal(index)), runtime(["a", "b"]))).toThrow();
      expect(() => evaluateTyped(edit("LIST_REPLACE_AT", state, literal(index), literal("x")), runtime(["a", "b"]))).toThrow();
    }
  });

  it("rejects oversized lists and wrongly typed added items", () => {
    expect(() => evaluateTyped(edit("LIST_APPEND", state, literal("x")), runtime(Array(500).fill("a") as string[]))).toThrow();
    expect(() => inferValueSource(edit("LIST_APPEND", state, literal(42)), "$.test", types, descriptor)).toThrow();
    expect(() => inferValueSource(edit("LIST_REPLACE_AT", state, literal("wrong-index"), literal("x")), "$.test", types, descriptor)).toThrow();
  });
});
