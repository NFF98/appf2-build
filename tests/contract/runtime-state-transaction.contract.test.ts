import { describe, expect, test } from "vitest";

import { hashBlueprint } from "../../src/platform/blueprint/content-identity.js";
import type { ValueSource } from "../../src/platform/blueprint/validation-types.js";
import { singletonKey } from "../../src/platform/runtime/node-instance-key.js";
import { RuntimeFailure } from "../../src/platform/runtime/runtime-errors.js";
import {
  blueprintWith,
  buttonNode,
  capabilityState,
  change,
  event,
  hydratedHarness,
  lit,
  node,
  op,
  press,
  snapshot,
  state
} from "../runtime/runtime-fixtures.js";

const numberInput = (id: string, key: string, actionId: string) =>
  node(id, "input.number", "1.0.0", { props: { label: lit(id) }, bindings: { bind: state(key) }, events: { change: actionId } });
const setFromEvent = (id: string, target: string) => ({ id, steps: [{ type: "SET_STATE", target, value: event("value") }] });
const rule = (ruleId: string) => ({ kind: "RULE", rule_id: ruleId });

function recomputeBlueprint() {
  return blueprintWith({
    state: {
      a: { mode: "MUTABLE", type: "NUMBER", initial: 1 },
      b: { mode: "MUTABLE", type: "NUMBER", initial: 2 },
      c: { mode: "MUTABLE", type: "NUMBER", initial: 5 },
      z: { mode: "MUTABLE", type: "NUMBER", initial: 1 },
      sum: { mode: "DERIVED", type: "NUMBER", expr: op("ADD", state("a"), state("b")) },
      double: { mode: "DERIVED", type: "NUMBER", expr: op("MUL", state("sum"), lit(2)) },
      tripled_c: { mode: "DERIVED", type: "NUMBER", expr: op("MUL", state("c"), lit(3)) },
      inverse: { mode: "DERIVED", type: "NUMBER", expr: op("DIV", lit(10), state("z")) }
    },
    rules: [
      { id: "rule_big", result_type: "BOOLEAN", expr: op("GT", state("double"), lit(10)) },
      { id: "rule_ratio", result_type: "BOOLEAN", expr: op("GT", op("DIV", state("a"), state("c")), lit(0)) }
    ],
    actions: [
      setFromEvent("action_set_a", "a"),
      setFromEvent("action_set_c", "c"),
      setFromEvent("action_set_z", "z"),
      {
        id: "action_chain",
        steps: [
          { type: "SET_STATE", target: "a", value: lit(10) },
          { type: "SET_STATE", target: "b", value: state("double") }
        ]
      },
      { id: "action_guarded", steps: [{ type: "SET_STATE", target: "b", value: lit(0), when: rule("rule_ratio") }] }
    ],
    nodes: [
      numberInput("node_a", "a", "action_set_a"),
      numberInput("node_c", "c", "action_set_c"),
      numberInput("node_z", "z", "action_set_z"),
      buttonNode("node_chain", "action_chain"),
      buttonNode("node_guarded", "action_guarded")
    ]
  });
}

const KEYS = ["a", "b", "c", "z", "sum", "double", "tripled_c", "inverse"];

function scoreNode(id: string, initial: number, events: Record<string, string> = {}) {
  return node(id, "logic.score", "1.0.0", { props: { initial: lit(initial), min: lit(0), max: lit(100) }, events });
}

const invoke = (target: string, action: string, args: Record<string, ValueSource | Record<string, unknown>> = {}) => ({
  type: "INVOKE_CAPABILITY",
  target_node_id: target,
  capability_action: action,
  args
});

describe("F03 Instance Store recomputation and atomic transactions", () => {
  test("TEST-F03-004 a mutation recomputes exactly the affected derived states and rules in dependency order", async () => {
    const harness = await hydratedHarness(recomputeBlueprint());
    expect(snapshot(harness, KEYS)).toMatchObject({ "state:sum": 3, "state:double": 6, "state:tripled_c": 15, "state:inverse": 10 });
    expect(harness.runtime.readRule("rule_big")).toEqual({ ok: true, value: false });

    change(harness, "node_a", 4);
    expect(snapshot(harness, KEYS)).toMatchObject({ "state:a": 4, "state:sum": 6, "state:double": 12, "state:tripled_c": 15, "state:inverse": 10 });
    expect(harness.runtime.readRule("rule_big")).toEqual({ ok: true, value: true });
    expect(harness.runtime.readRule("rule_ratio")).toEqual({ ok: true, value: true });

    press(harness, "node_chain");
    expect(snapshot(harness, KEYS)).toMatchObject({ "state:a": 10, "state:b": 24, "state:sum": 34, "state:double": 68 });

    change(harness, "node_c", 0);
    expect(harness.runtime.readState("tripled_c")).toBe(0);
    const failed = harness.runtime.readRule("rule_ratio");
    expect(failed?.ok).toBe(false);
    expect(failed?.ok === false ? failed.failure.code : undefined).toBe("F03-ERR-008");
    expect(harness.runtime.readRule("rule_big")).toEqual({ ok: true, value: true });

    const beforeGuarded = snapshot(harness, KEYS);
    press(harness, "node_guarded");
    expect(snapshot(harness, KEYS)).toEqual(beforeGuarded);
    expect(harness.runtime.runtimeErrors().at(-1)).toMatchObject({ code: "F03-ERR-006", action_id: "action_guarded" });

    change(harness, "node_c", 2);
    expect(harness.runtime.readRule("rule_ratio")).toEqual({ ok: true, value: true });
    press(harness, "node_guarded");
    expect(harness.runtime.readState("b")).toBe(0);
    expect(harness.runtime.readState("sum")).toBe(10);

    const beforeDerivedFailure = snapshot(harness, KEYS);
    change(harness, "node_z", 0);
    expect(snapshot(harness, KEYS)).toEqual(beforeDerivedFailure);
    expect(harness.runtime.runtimeErrors().at(-1)).toMatchObject({ code: "F03-ERR-008", action_id: "action_set_z" });
  });

  test("TEST-F03-006 an Action commits only when every step succeeds and a failing step leaves no partial state", async () => {
    const blueprint = blueprintWith({
      state: {
        a: { mode: "MUTABLE", type: "NUMBER", initial: 1 },
        b: { mode: "MUTABLE", type: "NUMBER", initial: 1 },
        zero: { mode: "MUTABLE", type: "NUMBER", initial: 0 },
        huge: { mode: "MUTABLE", type: "NUMBER", initial: 1e308 },
        names: { mode: "MUTABLE", type: "LIST", initial: [], constraints: { item: { type: "STRING", constraints: { max_length: 20 } }, max_length: 3 } }
      },
      actions: [
        { id: "action_all", steps: [{ type: "SET_STATE", target: "a", value: lit(2) }, { type: "SET_STATE", target: "b", value: op("ADD", state("a"), lit(1)) }, invoke("node_score", "increment", { delta: state("b") })] },
        { id: "action_div", steps: [{ type: "SET_STATE", target: "a", value: lit(50) }, { type: "SET_STATE", target: "b", value: op("DIV", lit(1), state("zero")) }] },
        { id: "action_overflow", steps: [{ type: "SET_STATE", target: "a", value: event("value") }, { type: "SET_STATE", target: "b", value: op("MUL", state("huge"), lit(10)) }] },
        { id: "action_capability", steps: [{ type: "SET_STATE", target: "a", value: lit(70) }, invoke("node_score", "increment", { delta: op("MUL", state("a"), lit(1000)) })] },
        { id: "action_args", steps: [invoke("node_score", "increment", { delta: lit(1) }), invoke("node_random", "choose_item", { items: state("names") })] }
      ],
      nodes: [
        buttonNode("node_all", "action_all"),
        buttonNode("node_div", "action_div"),
        numberInput("node_overflow", "a", "action_overflow"),
        buttonNode("node_capability", "action_capability"),
        buttonNode("node_args", "action_args"),
        scoreNode("node_score", 0),
        node("node_random", "logic.random", "1.0.0")
      ]
    });
    const harness = await hydratedHarness(blueprint);
    const keys = ["a", "b", "zero", "huge"];
    const capabilities = ["node_score", "node_random"];
    const observed: unknown[] = [];
    harness.runtime.subscribe(() => observed.push(snapshot(harness, keys, capabilities)));

    press(harness, "node_all");
    expect(observed).toEqual([snapshot(harness, keys, capabilities)]);
    expect(snapshot(harness, keys, capabilities)).toMatchObject({ "state:a": 2, "state:b": 3, "capability:node_score": { value: 3 }, action_sequence: 1 });

    const committed = snapshot(harness, keys, capabilities);
    const failures: readonly [string, () => unknown, string][] = [
      ["DIV by zero after a write", () => press(harness, "node_div"), "F03-ERR-008"],
      ["non-finite result after an EVENT write", () => change(harness, "node_overflow", 60), "F03-ERR-009"],
      ["capability invariant after a write", () => press(harness, "node_capability"), "F03-ERR-011"],
      ["capability FAILURE after a capability write", () => press(harness, "node_args"), "F03-ERR-011"]
    ];
    for (const [label, dispatch, code] of failures) {
      expect(dispatch(), label).toMatchObject({ accepted: true });
      expect(snapshot(harness, keys, capabilities), label).toEqual(committed);
      expect(harness.runtime.runtimeErrors().at(-1)?.code, label).toBe(code);
      expect(harness.runtime.status, label).toBe("READY");
    }
    expect(observed).toHaveLength(1);
    expect(harness.runtime.runtimeErrors().at(-2)).toMatchObject({ capability_id: "logic.score", action_id: "action_capability" });
  });
});

describe("F03 reset semantics", () => {
  test("TEST-F03-AC-008 reset returns mutable state to the Blueprint initial values", async () => {
    const initialItems = [{ name: "A", qty: 1 }];
    const blueprint = blueprintWith({
      state: {
        count: { mode: "MUTABLE", type: "NUMBER", initial: 3 },
        label: { mode: "MUTABLE", type: "STRING", initial: "init", constraints: { max_length: 20 } },
        items: {
          mode: "MUTABLE",
          type: "LIST",
          initial: initialItems,
          constraints: { item: { type: "RECORD", constraints: { fields: { name: { type: "STRING", constraints: { max_length: 20 } }, qty: { type: "NUMBER" } } } }, max_length: 5 }
        },
        label_length: { mode: "DERIVED", type: "NUMBER", expr: op("LENGTH", state("label")) }
      },
      actions: [
        {
          id: "action_mutate",
          steps: [
            { type: "SET_STATE", target: "count", value: lit(99) },
            { type: "SET_STATE", target: "label", value: lit("changed-label") },
            { type: "SET_STATE", target: "items", value: lit([{ name: "B", qty: 2 }, { name: "C", qty: 3 }]) },
            invoke("node_score", "increment", { delta: lit(4) }),
            invoke("node_random", "sample_number", { min: lit(1), max: lit(6) })
          ]
        },
        { id: "action_reset_label", steps: [{ type: "RESET_STATE", target: "label" }] },
        { id: "action_reset_all", steps: [{ type: "RESET_STATE", target: "ALL_MUTABLE" }] }
      ],
      nodes: [
        buttonNode("node_mutate", "action_mutate"),
        buttonNode("node_reset_label", "action_reset_label"),
        buttonNode("node_reset_all", "action_reset_all"),
        scoreNode("node_score", 0),
        node("node_random", "logic.random", "1.0.0")
      ]
    });
    const harness = await hydratedHarness(blueprint);
    const keys = ["count", "label", "items", "label_length"];
    const initial = snapshot(harness, keys);

    press(harness, "node_mutate");
    expect(snapshot(harness, keys)).toMatchObject({ "state:count": 99, "state:label": "changed-label", "state:label_length": 13 });

    press(harness, "node_reset_label");
    expect(snapshot(harness, keys)).toMatchObject({ "state:count": 99, "state:label": "init", "state:label_length": 4 });
    expect(harness.runtime.readState("items")).toEqual([{ name: "B", qty: 2 }, { name: "C", qty: 3 }]);

    const rngBefore = harness.runtime.rngMetadata();
    press(harness, "node_reset_all");
    const after = snapshot(harness, keys);
    expect({ ...after, action_sequence: initial.action_sequence, rng_counter: initial.rng_counter }).toEqual(initial);
    expect(harness.runtime.readState("items")).toEqual(initialItems);
    expect(Object.isFrozen(harness.runtime.readState("items"))).toBe(true);
    expect(capabilityState(harness, "node_score")).toEqual({ value: 4 });
    expect(harness.runtime.rngMetadata()).toEqual(rngBefore);
  });
});

describe("F03 immutable Blueprint identity and capability-local state separation", () => {
  test("TEST-F03-021 Instance state mutation never changes the immutable Blueprint or its content_hash", async () => {
    const blueprint = recomputeBlueprint();
    const parsedBody = JSON.parse(JSON.stringify(blueprint)) as Record<string, unknown>;
    const harness = await hydratedHarness(blueprint, { body: parsedBody });
    const admittedHash = harness.admitted.admission.content_hash;
    const instanceBlueprint = harness.runtime.blueprint;
    expect(hashBlueprint(instanceBlueprint)).toBe(admittedHash);

    (parsedBody.state as Record<string, unknown>).a = { mode: "MUTABLE", type: "NUMBER", initial: 999 };
    change(harness, "node_a", 7);
    press(harness, "node_chain");
    change(harness, "node_c", 0);
    change(harness, "node_z", 0);

    expect(harness.runtime.blueprint).toBe(instanceBlueprint);
    expect(hashBlueprint(harness.runtime.blueprint)).toBe(admittedHash);
    expect(harness.runtime.blueprint?.state.a).toEqual({ mode: "MUTABLE", type: "NUMBER", initial: 1 });
    expect(Object.isFrozen(instanceBlueprint)).toBe(true);
    expect(Object.isFrozen(instanceBlueprint?.state.a)).toBe(true);
    expect(Object.isFrozen(instanceBlueprint?.actions[3]?.steps[0])).toBe(true);
    expect(() => {
      (instanceBlueprint?.state as Record<string, unknown>).injected = {};
    }).toThrow(TypeError);
    expect(hashBlueprint(harness.runtime.blueprint)).toBe(admittedHash);
  });

  test("TEST-F03-AC-023 capability-local state is keyed by node instance and separate from Blueprint state", async () => {
    const blueprint = blueprintWith(
      {
        state: {
          value: { mode: "MUTABLE", type: "NUMBER", initial: 0 },
          rows: { mode: "MUTABLE", type: "LIST", initial: [1, 2], constraints: { item: { type: "NUMBER" }, max_length: 3 } }
        },
        actions: [
          { id: "action_bump_left", steps: [invoke("node_left", "increment", { delta: lit(5) })] },
          { id: "action_reset_all", steps: [{ type: "RESET_STATE", target: "ALL_MUTABLE" }] },
          { id: "action_set_value", steps: [{ type: "SET_STATE", target: "value", value: lit(42) }] }
        ],
        nodes: [
          buttonNode("node_bump_left", "action_bump_left"),
          buttonNode("node_reset_all", "action_reset_all"),
          buttonNode("node_set_value", "action_set_value"),
          scoreNode("node_left", 1),
          scoreNode("node_right", 2),
          node("node_rows", "content.list", "1.0.0", { repeat: { items: state("rows"), item_alias: "row", max_items: 3 }, children: ["node_row_score"] }),
          scoreNode("node_row_score", 7)
        ]
      },
      ["node_bump_left", "node_reset_all", "node_set_value", "node_left", "node_right", "node_rows"]
    );
    const harness = await hydratedHarness(blueprint);
    const clone = (index: number) => ({ node_id: "node_row_score", repeat_coordinates: [{ repeat_node_id: "node_rows", item_index: index }] });

    expect(harness.runtime.readCapabilityState(clone(0))).toEqual({ value: 7 });
    expect(harness.runtime.readCapabilityState(clone(1))).toEqual({ value: 7 });
    expect(harness.runtime.readCapabilityState(clone(2))).toBeUndefined();
    expect(harness.runtime.readCapabilityState(singletonKey("node_row_score"))).toBeUndefined();

    press(harness, "node_bump_left");
    expect(capabilityState(harness, "node_left")).toEqual({ value: 6 });
    expect(capabilityState(harness, "node_right")).toEqual({ value: 2 });
    expect(harness.runtime.readCapabilityState(clone(0))).toEqual({ value: 7 });
    expect(harness.runtime.readState("value")).toBe(0);

    press(harness, "node_set_value");
    expect(capabilityState(harness, "node_left")).toEqual({ value: 6 });
    press(harness, "node_reset_all");
    expect(harness.runtime.readState("value")).toBe(0);
    expect(capabilityState(harness, "node_left")).toEqual({ value: 6 });

    expect(() => harness.runtime.evaluateValue(state("node_left") as ValueSource)).toThrow(RuntimeFailure);
    const left = capabilityState(harness, "node_left");
    expect(Object.isFrozen(left)).toBe(true);
  });
});
