import { describe, expect, test } from "vitest";

import { VALIDATOR_REGISTRY } from "../../generated/capabilities/validator-registry.js";
import { canonicalizeJson } from "../../src/platform/blueprint/canonical-json.js";
import { validateResources } from "../../src/platform/blueprint/resource-bounds.js";
import { BlueprintValidationFailure, type Blueprint, type JsonValue } from "../../src/platform/blueprint/validation-types.js";
import type { GeneratedCapabilityValidator, TypeDescriptor, ValidatorRegistry } from "../../src/platform/capabilities/schema/validator-contract.js";
import { validBlueprint, type JsonRecord } from "./blueprint-validation-fixtures.js";
import {
  capabilityNode,
  container,
  expectIssue,
  expectPassed,
  lit,
  minimalBlueprint,
  op,
  registryWithEntry,
  state,
  textNode,
  validate
} from "./execution-safety-fixtures.js";

const TEXT = { id: "content.text", version: "1.0.0" };
const BUTTON = { id: "action.button", version: "1.0.0" };
const TIMER = { id: "logic.timer", version: "1.0.0" };
const SCORE = { id: "logic.score", version: "1.0.0" };
const ENCODER = new TextEncoder();
const range = (count: number): number[] => Array.from({ length: count }, (_, index) => index);
const bytes = (value: unknown): number => ENCODER.encode(canonicalizeJson(value)).byteLength;

interface Built {
  readonly candidate: JsonRecord;
  readonly registry?: ValidatorRegistry;
}

interface CeilingCase {
  readonly label: string;
  readonly limit: number;
  readonly build: (count: number) => Built;
  readonly path: (count: number) => string;
  readonly code?: string;
  readonly stage?: string;
}

/** Greedy fill of 8192-char strings so canonical bytes hit `target` exactly (ASCII = 1 byte/char). */
function fitStrings(target: number, make: (lengths: readonly number[]) => JsonRecord, measure: (candidate: JsonRecord) => number): JsonRecord {
  const lengths: number[] = [];
  for (;;) {
    lengths.push(0);
    const remaining = target - measure(make(lengths));
    expect(remaining).toBeGreaterThanOrEqual(0);
    lengths[lengths.length - 1] = Math.min(remaining, 8192);
    if (remaining <= 8192) {
      return make(lengths);
    }
  }
}

const textNodes = (count: number): JsonRecord[] => range(count).map((index) => textNode(`node_t${index}`));
const flagState = { flag: { mode: "MUTABLE", type: "BOOLEAN", initial: false } };
const setFlag = { type: "SET_STATE", target: "flag", value: lit(true) };

function nestedList(depth: number, leaf: JsonRecord): JsonRecord {
  return depth === 0 ? leaf : { type: "LIST", constraints: { item: nestedList(depth - 1, leaf), max_length: 2 } };
}

function nestedArray(depth: number): JsonValue {
  return depth === 1 ? [1] : [nestedArray(depth - 1)];
}

function absChain(depth: number): JsonRecord {
  return depth === 1 ? lit(1) : op("ABS", absChain(depth - 1));
}

/** Receiving descriptor lives in the Registry, so only the Blueprint literal's own container depth is measured. */
function deepPayloadRegistry(literalDepth: number): ValidatorRegistry {
  const payload = nestedList(literalDepth, { type: "NUMBER" }) as unknown as TypeDescriptor;
  return registryWithEntry(VALIDATOR_REGISTRY, TEXT, (entry) => ({
    ...entry,
    validator: {
      ...entry.validator,
      props: { ...entry.validator.props, payload: { required: false, matcher: { kind: "EXACT", descriptor: payload }, source_kinds: ["LITERAL"], invariant_ids: [] } }
    }
  }));
}

function manyEventsRegistry(): ValidatorRegistry {
  return registryWithEntry(VALIDATOR_REGISTRY, BUTTON, (entry) => {
    const press = entry.validator.events.press!;
    return { ...entry, validator: { ...entry.validator, events: Object.fromEntries(range(10).map((index) => [`e_${index}`, press])) } };
  });
}

function manyVersionsRegistry(): ValidatorRegistry {
  const clone = structuredClone(VALIDATOR_REGISTRY) as unknown as { capabilities: Record<string, Record<string, GeneratedCapabilityValidator>> };
  const template = clone.capabilities["content.text"]!["1.0.0"]!;
  for (const index of range(25)) {
    clone.capabilities["content.text"]![`1.0.${index + 1}`] = { ...template, version: `1.0.${index + 1}` };
  }
  return clone as unknown as ValidatorRegistry;
}

function repeatChain(depth: number): JsonRecord {
  const lists = range(depth).map((index) =>
    capabilityNode(`node_list_${index}`, { id: "content.list", version: "1.0.0" }, {
      children: index + 1 < depth ? [`node_list_${index + 1}`] : [],
      repeat: { items: index === 0 ? state("grid") : { kind: "SCOPE", name: `item_${index - 1}`, path: "" }, item_alias: `item_${index}`, max_items: 2 }
    })
  );
  const grid = nestedList(depth, { type: "NUMBER" });
  return minimalBlueprint([lists[0]!], {
    state: { grid: { mode: "MUTABLE", initial: [], ...grid } },
    nodes: [container("node_root", ["node_list_0"]), ...lists]
  });
}

const GLOBAL_CEILINGS: readonly CeilingCase[] = [
  {
    label: "canonical Blueprint bytes",
    limit: 262_144,
    build: (count) => ({
      candidate: fitStrings(count, (lengths) => minimalBlueprint(lengths.map((length, index) => textNode(`node_t${index}`, "a".repeat(length)))), bytes)
    }),
    path: () => "$"
  },
  { label: "nodes", limit: 100, build: (count) => ({ candidate: minimalBlueprint(textNodes(count - 1)) }), path: () => "$.nodes" },
  {
    label: "state entries",
    limit: 100,
    build: (count) => ({ candidate: minimalBlueprint([], { state: Object.fromEntries(range(count).map((index) => [`flag_${index}`, flagState.flag])) }) }),
    path: () => "$.state"
  },
  {
    label: "rules",
    limit: 100,
    build: (count) => ({ candidate: minimalBlueprint([], { rules: range(count).map((index) => ({ id: `rule_${index}`, result_type: "BOOLEAN", expr: lit(true) })) }) }),
    path: () => "$.rules"
  },
  {
    label: "actions",
    limit: 100,
    build: (count) => ({ candidate: minimalBlueprint([], { state: flagState, actions: range(count).map((index) => ({ id: `action_${index}`, steps: [setFlag] })) }) }),
    path: () => "$.actions"
  },
  {
    label: "action steps per action",
    limit: 16,
    build: (count) => ({ candidate: minimalBlueprint([], { state: flagState, actions: [{ id: "action_many", steps: range(count).map(() => setFlag) }] }) }),
    path: () => "$.actions[0].steps"
  },
  {
    label: "expression AST nodes",
    limit: 64,
    build: (count) => ({ candidate: minimalBlueprint([], { state: { sum: { mode: "DERIVED", type: "NUMBER", expr: op("ADD", ...range(count - 1).map(() => lit(1))) } } }) }),
    path: () => "$.state.sum.expr"
  },
  {
    label: "expression depth",
    limit: 12,
    build: (count) => ({ candidate: minimalBlueprint([], { state: { sum: { mode: "DERIVED", type: "NUMBER", expr: absChain(count) } } }) }),
    path: () => "$.state.sum.expr"
  },
  {
    label: "composite literal depth",
    limit: 12,
    build: (count) => ({
      candidate: minimalBlueprint([{ ...textNode("node_payload"), props: { role: lit("BODY"), payload: lit(nestedArray(count)) } }]),
      registry: deepPayloadRegistry(count)
    }),
    path: () => "$.nodes[1].props.payload.value"
  },
  {
    label: "TypeDescriptor depth",
    limit: 12,
    build: (count) => ({ candidate: minimalBlueprint([], { state: { deep: { mode: "MUTABLE", initial: [], ...nestedList(count - 1, { type: "NUMBER" }) } } }) }),
    path: () => "$.state.deep"
  },
  {
    label: "UI child depth",
    limit: 12,
    build: (count) => ({
      candidate: minimalBlueprint([], {
        nodes: range(count).map((index) => container(index === 0 ? "node_root" : `node_c${index}`, index + 1 < count ? [`node_c${index + 1}`] : []))
      })
    }),
    path: (count) => `$.nodes[${count - 1}]`
  },
  { label: "repeat depth", limit: 2, build: (count) => ({ candidate: repeatChain(count) }), path: (count) => `$.nodes[${count}].repeat` },
  {
    label: "total initial state bytes",
    limit: 131_072,
    build: (count) => ({
      candidate: fitStrings(
        count,
        (lengths) =>
          minimalBlueprint([], {
            state: Object.fromEntries(lengths.map((length, index) => [`text_${index}`, { mode: "MUTABLE", type: "STRING", initial: "a".repeat(length), constraints: { max_length: 8192 } }]))
          }),
        (candidate) => bytes(Object.fromEntries(Object.entries(candidate.state as Record<string, JsonRecord>).map(([key, entry]) => [key, entry.initial])))
      )
    }),
    path: () => "$.state"
  },
  {
    label: "event bindings",
    limit: 200,
    build: (count) => ({
      candidate: minimalBlueprint(
        range(Math.ceil(count / 10)).map((index) =>
          capabilityNode(`node_b${index}`, BUTTON, {
            props: { label: lit("b") },
            events: Object.fromEntries(range(Math.min(10, count - index * 10)).map((event) => [`e_${event}`, "action_go"]))
          })
        ),
        { state: flagState, actions: [{ id: "action_go", steps: [setFlag] }] }
      ),
      registry: manyEventsRegistry()
    }),
    path: () => "$.nodes"
  },
  {
    label: "concurrent timers",
    limit: 10,
    build: (count) => ({ candidate: minimalBlueprint(range(count).map((index) => capabilityNode(`node_timer_${index}`, TIMER, { props: { duration_ms: lit(1000) } }))) }),
    path: () => "$.nodes"
  },
  {
    label: "result outputs",
    limit: 50,
    build: (count) => ({ candidate: minimalBlueprint([], { result: { outputs: range(count).map((index) => ({ id: `out_${index}`, label: "o", value: lit(1), sensitivity: "NORMAL" })) } }) }),
    path: () => "$.result.outputs"
  },
  {
    label: "support degradations",
    limit: 50,
    build: (count) => ({
      candidate: minimalBlueprint([], {
        support: {
          coverage_status: "PARTIALLY_SUPPORTED",
          degradations: range(count).map((index) => ({ requirement_id: `req_${index}`, description: "d", capability_refs: [TEXT], preserves_semantic_core: true }))
        }
      })
    }),
    path: () => "$.support.degradations"
  },
  {
    label: "capability refs per degradation",
    limit: 20,
    build: (count) => ({
      candidate: minimalBlueprint([], {
        support: {
          coverage_status: "PARTIALLY_SUPPORTED",
          degradations: [{ requirement_id: "req_many", description: "d", capability_refs: range(count).map((index) => ({ id: "content.text", version: `1.0.${index + 1}` })), preserves_semantic_core: true }]
        }
      }),
      registry: manyVersionsRegistry()
    }),
    path: () => "$.support.degradations[0].capability_refs"
  }
];

const V05_CEILINGS: readonly CeilingCase[] = [
  {
    label: "initial LIST items (receiving max_length 500)",
    limit: 500,
    build: (count) => ({ candidate: minimalBlueprint([], { state: { list: { mode: "MUTABLE", type: "LIST", initial: range(count), constraints: { item: { type: "NUMBER" }, max_length: 500 } } } }) }),
    path: () => "$.state.list.initial",
    code: "F02-ERR-006",
    stage: "V05"
  },
  {
    label: "initial LIST platform max_length 500",
    limit: 500,
    build: (count) => ({ candidate: minimalBlueprint([], { state: { list: { mode: "MUTABLE", type: "LIST", initial: [], constraints: { item: { type: "NUMBER" }, max_length: count } } } }) }),
    path: () => "$.state.list.constraints.max_length",
    code: "F02-ERR-006",
    stage: "V05"
  },
  {
    label: "initial STRING chars (receiving max_length 8192)",
    limit: 8192,
    build: (count) => ({ candidate: minimalBlueprint([], { state: { note: { mode: "MUTABLE", type: "STRING", initial: "a".repeat(count), constraints: { max_length: 8192 } } } }) }),
    path: () => "$.state.note.initial",
    code: "F02-ERR-006",
    stage: "V05"
  },
  {
    label: "initial STRING platform max_length 8192",
    limit: 8192,
    build: (count) => ({ candidate: minimalBlueprint([], { state: { note: { mode: "MUTABLE", type: "STRING", initial: "", constraints: { max_length: count } } } }) }),
    path: () => "$.state.note.constraints.max_length",
    code: "F02-ERR-006",
    stage: "V05"
  }
];

function budgetRegistry(ref: typeof TEXT, budget: Partial<GeneratedCapabilityValidator["resource_budget"]>, timerSlots?: number): ValidatorRegistry {
  return registryWithEntry(VALIDATOR_REGISTRY, ref, (entry) => ({
    ...entry,
    resource_budget: { ...entry.resource_budget, ...budget },
    resource_usage: timerSlots === undefined ? entry.resource_usage : { timerSlotsPerInstance: timerSlots }
  }));
}

function repeated(child: JsonRecord, maxItems: number): JsonRecord {
  const list = capabilityNode("node_list", { id: "content.list", version: "1.0.0" }, {
    children: [child.id as string],
    repeat: { items: state("rows"), item_alias: "row", max_items: maxItems }
  });
  return minimalBlueprint([list], {
    state: { rows: { mode: "MUTABLE", type: "LIST", initial: [], constraints: { item: { type: "NUMBER" }, max_length: 500 } } },
    nodes: [container("node_root", ["node_list"]), list, child]
  });
}

const TEXT_PROPS_BYTES = bytes({ role: lit("BODY") });
const timerNode = (id: string): JsonRecord => capabilityNode(id, TIMER, { props: { duration_ms: lit(1000) } });
const scoreActions = (count: number): JsonRecord => ({
  id: "action_score",
  steps: range(count).map(() => ({ type: "INVOKE_CAPABILITY", target_node_id: "node_score", capability_action: "increment", args: { delta: lit(1) } }))
});

const BUDGETS: readonly (CeilingCase & { readonly ref: typeof TEXT })[] = [
  { label: "maxInstancesPerBlueprint", ref: TEXT, limit: 3, build: (count) => ({ candidate: minimalBlueprint(textNodes(count)), registry: budgetRegistry(TEXT, { maxInstancesPerBlueprint: 3 }) }), path: () => "$.nodes" },
  {
    label: "maxInstancesPerBlueprint = Σ instance_upper_bound",
    ref: TEXT,
    limit: 3,
    build: (count) => ({ candidate: repeated(textNode("node_row_text"), count), registry: budgetRegistry(TEXT, { maxInstancesPerBlueprint: 3 }) }),
    path: () => "$.nodes"
  },
  {
    label: "maxSerializedPropsBytes",
    ref: TEXT,
    limit: 2,
    build: (count) => ({ candidate: minimalBlueprint(textNodes(count)), registry: budgetRegistry(TEXT, { maxSerializedPropsBytes: TEXT_PROPS_BYTES * 2 }) }),
    path: () => "$.nodes"
  },
  {
    label: "maxEventBindings",
    ref: BUTTON,
    limit: 2,
    build: (count) => ({
      candidate: minimalBlueprint(range(count).map((index) => capabilityNode(`node_b${index}`, BUTTON, { props: { label: lit("b") }, events: { press: "action_go" } })), {
        state: flagState,
        actions: [{ id: "action_go", steps: [setFlag] }]
      }),
      registry: budgetRegistry(BUTTON, { maxEventBindings: 2 })
    }),
    path: () => "$.nodes"
  },
  {
    label: "maxActionBindings",
    ref: SCORE,
    limit: 2,
    build: (count) => ({
      candidate: minimalBlueprint([capabilityNode("node_score", SCORE, { props: { initial: lit(0) } })], { actions: [scoreActions(count)] }),
      registry: budgetRegistry(SCORE, { maxActionBindings: 2 })
    }),
    path: () => "$.actions"
  },
  {
    label: "maxConcurrentTimers",
    ref: TIMER,
    limit: 2,
    build: (count) => ({ candidate: minimalBlueprint(range(count).map((index) => timerNode(`node_timer_${index}`))), registry: budgetRegistry(TIMER, { maxConcurrentTimers: 2 }) }),
    path: () => "$.nodes"
  }
];

function expectBoundary(entry: CeilingCase, ref?: typeof TEXT): void {
  const atLimit = entry.build(entry.limit);
  expectPassed(validate(atLimit.candidate, atLimit.registry), `${entry.label} = ${entry.limit}`);
  const over = entry.build(entry.limit + 1);
  const expected = { code: entry.code ?? "F02-ERR-011", stage: entry.stage ?? "V09", path: entry.path(entry.limit + 1) };
  expectIssue(validate(over.candidate, over.registry), ref === undefined ? expected : { ...expected, ref }, `${entry.label} = ${entry.limit + 1}`);
}

/**
 * children/node > 100 implies nodes > 100 in any V06-valid tree, so the V09 owner check is proven directly at the
 * resource stage with a node count inside its own ceiling.
 */
function childrenCeilingAtResourceStage(childCount: number): () => unknown {
  const rootNode = { id: "node_root", capability: { id: "layout.container", version: "1.0.0" }, props: {}, bindings: {}, events: {}, children: range(childCount).map(() => "node_a") };
  const child = { id: "node_a", capability: TEXT, props: {}, bindings: {}, events: {}, children: [] };
  const raw = { ...minimalBlueprint(), nodes: [rootNode, child] };
  const blueprint = raw as unknown as Blueprint;
  const capabilities = new Map([
    ["node_root", VALIDATOR_REGISTRY.capabilities["layout.container"]!["1.0.0"]!],
    ["node_a", VALIDATOR_REGISTRY.capabilities["content.text"]!["1.0.0"]!]
  ]);
  const graph = { order: blueprint.nodes, indexById: new Map([["node_root", 0], ["node_a", 1]]), parentById: new Map([["node_a", "node_root"]]) };
  return () => validateResources({ root: raw as unknown as Record<string, JsonValue>, blueprint, mutable: new Map(), graph, capabilities });
}

function expectTimerDerivation(): void {
  const underRepeat = validate(repeated(timerNode("node_row_timer"), 10));
  expectPassed(underRepeat, "timer under repeat max_items 10");
  expect(underRepeat.report.resource_usage?.timer_count).toBe(10);
  expectIssue(validate(repeated(timerNode("node_row_timer"), 11)), { code: "F02-ERR-011", stage: "V09", path: "$.nodes" }, "timer instance bound 11");

  const slotsOnText = validate(minimalBlueprint(textNodes(3)), budgetRegistry(TEXT, {}, 4));
  expectIssue(slotsOnText, { code: "F02-ERR-011", stage: "V09", path: "$.nodes" }, "timerSlotsPerInstance declared on a non-timer ID");
  const zeroSlotTimers = validate(minimalBlueprint(range(11).map((index) => timerNode(`node_timer_${index}`))), budgetRegistry(TIMER, {}, 0));
  expectPassed(zeroSlotTimers, "logic.timer with timerSlotsPerInstance 0");
  expect(zeroSlotTimers.report.resource_usage?.timer_count).toBe(0);
  const overflow = validate(repeated(timerNode("node_row_timer"), 2), budgetRegistry(TIMER, {}, Number.MAX_SAFE_INTEGER));
  expectIssue(overflow, { code: "F02-ERR-011", stage: "V09" }, "unsafe-integer timer product rejects without wrap");
}

describe("F02 BF-040 hard resource ceilings before Runtime", () => {
  test("TEST-F02-010 direct-proofs every V05/V09 ceiling, every static per-Capability budget and timer_count derivation", () => {
    for (const entry of [...GLOBAL_CEILINGS, ...V05_CEILINGS]) {
      expectBoundary(entry);
    }
    for (const entry of BUDGETS) {
      expectBoundary(entry, entry.ref);
    }
    expect(childrenCeilingAtResourceStage(100)).not.toThrow();
    expect(childrenCeilingAtResourceStage(101)).toThrowError(BlueprintValidationFailure);
    try {
      childrenCeilingAtResourceStage(101)();
    } catch (error: unknown) {
      expect((error as BlueprintValidationFailure).issue).toMatchObject({ error_code: "F02-ERR-011", stage: "V09", json_path: "$.nodes[0].children" });
    }
    expectPassed(validate(repeated(textNode("node_row_text"), 4), budgetRegistry(TEXT, { maxSerializedPropsBytes: TEXT_PROPS_BYTES })), "props bytes are not multiplied by repeat");
    expectPassed(validate(minimalBlueprint(textNodes(3)), budgetRegistry(TEXT, { maxLocalStateBytes: 0 })), "maxLocalStateBytes is an F03 dynamic guard, not V09");
    expectTimerDerivation();

    const usage = validate(validBlueprint()).report.resource_usage;
    expect(usage).toMatchObject({ node_count: 18, timer_count: 1, max_ui_child_depth: 4, max_repeat_depth: 1, max_expression_depth: 2 });
  });
});
