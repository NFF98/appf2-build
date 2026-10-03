import { describe, expect, test } from "vitest";

import { VALIDATOR_REGISTRY } from "../../generated/capabilities/validator-registry.js";
import { canonicalizeJson } from "../../src/platform/blueprint/canonical-json.js";
import {
  validateBlueprintCandidate,
  type BlueprintValidationContext
} from "../../src/platform/blueprint/validate-blueprint.js";
import type {
  BlueprintValidationResult,
  CapabilityRef
} from "../../src/platform/blueprint/validation-types.js";
import { generateRegistryArtifacts } from "../../src/platform/capabilities/generate-registry.js";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import type { CapabilityDefinition } from "../../src/platform/capabilities/schema/capability-definition.js";
import type { GeneratedCapabilityValidator } from "../../src/platform/capabilities/schema/validator-contract.js";
import {
  actionIndex,
  encode,
  node,
  nodeIndex,
  source,
  validBlueprint,
  type JsonRecord
} from "./blueprint-validation-fixtures.js";
import { registryAdding, registryWith, withBudget, withTimerSlots } from "./validator-registry-variants.js";

const { lit, op, state } = source;
const STRING_CEILING = 8192;
const UTF8 = new TextEncoder();

function validate(candidate: unknown, context: BlueprintValidationContext = {}): BlueprintValidationResult {
  return validateBlueprintCandidate(encode(candidate), context);
}

function byteLength(value: unknown): number {
  return UTF8.encode(canonicalizeJson(value)).byteLength;
}

function expectPassed(result: BlueprintValidationResult, label: string): void {
  expect(result.report.issues, label).toEqual([]);
  expect(result.report.status, label).toBe("PASSED");
}

function expectExceeded(result: BlueprintValidationResult, label: string, jsonPath: string, ref?: CapabilityRef): void {
  expect(result.report.status, label).toBe("REJECTED");
  expect(result.report.issues, label).toEqual([
    ref === undefined
      ? { error_code: "F02-ERR-011", stage: "V09", json_path: jsonPath }
      : { error_code: "F02-ERR-011", stage: "V09", json_path: jsonPath, capability_ref: ref }
  ]);
}

function nodesOf(candidate: JsonRecord): JsonRecord[] {
  return candidate.nodes as JsonRecord[];
}

function rootOf(candidate: JsonRecord): JsonRecord {
  return nodesOf(candidate)[0]!;
}

function withRootChildren(candidate: JsonRecord, children: readonly JsonRecord[]): JsonRecord {
  nodesOf(candidate).push(...children);
  (rootOf(candidate).children as string[]).push(...children.map((child) => child.id as string));
  return candidate;
}

function container(id: string, children: string[] = []): JsonRecord {
  return node(id, "layout.container", "1.0.0", {
    props: { direction: lit("COLUMN"), gap: lit("SM"), align: lit("START") },
    children
  });
}

function withRuleCount(total: number): JsonRecord {
  const candidate = validBlueprint();
  const rules = candidate.rules as JsonRecord[];
  for (let index = rules.length; index < total; index += 1) {
    rules.push({ id: `rule_pad_${index}`, result_type: "BOOLEAN", expr: op("GT", lit(1), lit(0)) });
  }
  return candidate;
}

function withActionCount(total: number): JsonRecord {
  const candidate = validBlueprint();
  const actions = candidate.actions as JsonRecord[];
  for (let index = actions.length; index < total; index += 1) {
    actions.push({ id: `action_pad_${index}`, steps: [{ type: "RESET_STATE", target: "ALL_MUTABLE" }] });
  }
  return candidate;
}

function withStateCount(total: number): JsonRecord {
  const candidate = validBlueprint();
  const entries = candidate.state as JsonRecord;
  for (let index = Object.keys(entries).length; index < total; index += 1) {
    entries[`pad_${index}`] = { mode: "MUTABLE", type: "BOOLEAN", initial: false };
  }
  return candidate;
}

function withExpression(expr: JsonRecord): JsonRecord {
  const candidate = validBlueprint();
  (candidate.rules as JsonRecord[]).push({ id: "rule_measured", result_type: expr.op === "ADD" ? "NUMBER" : "BOOLEAN", expr });
  return candidate;
}

function addition(astNodes: number): JsonRecord {
  return op("ADD", ...Array.from({ length: astNodes - 1 }, () => lit(1)));
}

function negations(depth: number): JsonRecord {
  let expr: JsonRecord = lit(true);
  for (let level = 1; level < depth; level += 1) {
    expr = op("NOT", expr);
  }
  return expr;
}

function withDescriptorDepth(depth: number): JsonRecord {
  let constraints: JsonRecord = { item: { type: "NUMBER" }, max_length: 1 };
  for (let level = 2; level < depth; level += 1) {
    constraints = { item: { type: "LIST", constraints }, max_length: 1 };
  }
  const candidate = validBlueprint();
  (candidate.state as JsonRecord).deep = { mode: "MUTABLE", type: "LIST", initial: [], constraints };
  return candidate;
}

function withUiDepth(leafDepth: number): JsonRecord {
  const chain = Array.from({ length: leafDepth - 1 }, (_, index) => `node_chain_${index + 1}`);
  const candidate = validBlueprint();
  nodesOf(candidate).push(...chain.map((id, index) => container(id, index + 1 < chain.length ? [chain[index + 1]!] : [])));
  (rootOf(candidate).children as string[]).push(chain[0]!);
  return candidate;
}

function withRepeatDepth(levels: number, maxItems = 1, stateKey = "items"): JsonRecord {
  const ids = Array.from({ length: levels }, (_, index) => `node_repeat_${index + 1}`);
  const candidate = validBlueprint();
  nodesOf(candidate).push(
    ...ids.map((id, index) =>
      node(id, "content.list", "1.0.0", {
        repeat: { items: state(stateKey), item_alias: `level_${index + 1}`, max_items: maxItems },
        children: index + 1 < ids.length ? [ids[index + 1]!] : ["node_repeat_leaf"]
      })
    ),
    node("node_repeat_leaf", "content.text", "1.0.0", { props: { role: lit("BODY") }, bindings: { text: lit("葉") } })
  );
  (rootOf(candidate).children as string[]).push(ids[0]!);
  return candidate;
}

function padded(candidate: JsonRecord, slots: readonly { value: Record<string, unknown>; key: string }[], target: number, measure: () => number): JsonRecord {
  let remaining = target - measure();
  for (const slot of slots) {
    const length = Math.min(STRING_CEILING, Math.max(remaining, 0));
    slot.value[slot.key] = "x".repeat(length);
    remaining -= length;
  }
  expect(measure()).toBe(target);
  return candidate;
}

function withBlueprintBytes(target: number): JsonRecord {
  const pads = Array.from({ length: 40 }, (_, index) =>
    node(`node_pad_${index}`, "content.text", "1.0.0", { props: { role: lit("BODY") }, bindings: { text: lit("") } })
  );
  const candidate = withRootChildren(validBlueprint(), pads);
  const slots = pads.map((pad) => ({ value: (pad.bindings as JsonRecord).text as Record<string, unknown>, key: "value" }));
  return padded(candidate, slots, target, () => byteLength(candidate));
}

function initialStateOf(candidate: JsonRecord): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(candidate.state as Record<string, JsonRecord>)
      .filter(([, entry]) => entry.mode === "MUTABLE")
      .map(([key, entry]) => [key, entry.initial])
  );
}

function withInitialStateBytes(target: number): JsonRecord {
  const candidate = validBlueprint();
  const entries = candidate.state as Record<string, JsonRecord>;
  const slots = Array.from({ length: 17 }, (_, index) => {
    const entry: JsonRecord = { mode: "MUTABLE", type: "STRING", initial: "", constraints: { max_length: STRING_CEILING } };
    entries[`pad_${index}`] = entry;
    return { value: entry, key: "initial" };
  });
  return padded(candidate, slots, target, () => byteLength(initialStateOf(candidate)));
}

function multiEventCapability(eventCount: number): GeneratedCapabilityValidator {
  const button = VALIDATOR_REGISTRY.capabilities["action.button"]!["1.0.0"]!;
  const press = button.validator.events.press!;
  return {
    ...button,
    id: "test.multi_event",
    validator: {
      ...button.validator,
      events: Object.fromEntries(Array.from({ length: eventCount }, (_, index) => [`press_${index}`, press]))
    }
  };
}

function withEventBindings(total: number): { candidate: JsonRecord; context: BlueprintValidationContext } {
  const extra = total - 6;
  const events = Object.fromEntries(Array.from({ length: extra }, (_, index) => [`press_${index}`, "action_reset"]));
  const candidate = withRootChildren(validBlueprint(), [
    node("node_multi", "test.multi_event", "1.0.0", { props: { label: lit("多重") }, events })
  ]);
  return { candidate, context: { registry: registryAdding(multiEventCapability(extra)) } };
}

function withRepeatedTimer(maxItems: number): JsonRecord {
  const candidate = validBlueprint();
  const root = rootOf(candidate);
  root.children = (root.children as string[]).map((id) => (id === "node_timer" ? "node_timer_slots" : id));
  nodesOf(candidate).push(
    node("node_timer_slots", "content.list", "1.0.0", {
      repeat: { items: state("items"), item_alias: "slot", max_items: maxItems },
      children: ["node_timer"]
    })
  );
  const roll = (candidate.actions as JsonRecord[])[actionIndex("action_roll")]!;
  roll.steps = (roll.steps as JsonRecord[]).filter((step) => step.target_node_id !== "node_timer");
  return candidate;
}

function withWideList(maxItems: number): JsonRecord {
  const candidate = validBlueprint();
  const items = (candidate.state as Record<string, JsonRecord>).items!;
  (items.constraints as JsonRecord).max_length = 500;
  const list = nodesOf(candidate)[nodeIndex("node_list")]!;
  (list.repeat as JsonRecord).max_items = maxItems;
  const table = nodesOf(candidate)[nodeIndex("node_table")]!;
  (table.props as JsonRecord).max_rows = lit(500);
  return candidate;
}

function ref(id: string, version = "1.0.0"): CapabilityRef {
  return { id, version };
}

function capabilityPath(nodeId: string): string {
  return `$.nodes[${nodeIndex(nodeId)}].capability`;
}

describe("F02 V09 resource bounds", () => {
  test("TEST-F02-010 enforces every reachable Phase 1 hard ceiling with deterministic §19 measurement before Runtime", () => {
    const fixture = validBlueprint();
    const passed = validate(fixture);
    expectPassed(passed, "canonical fixture");
    expect(passed.report.resource_usage).toEqual({
      blueprint_bytes: byteLength(fixture),
      node_count: 18,
      state_count: 8,
      rule_count: 1,
      action_count: 7,
      initial_state_bytes: byteLength(initialStateOf(fixture)),
      event_binding_count: 6,
      timer_count: 1,
      max_expression_ast_nodes: 3,
      max_expression_depth: 2,
      max_type_descriptor_depth: 3,
      max_composite_literal_depth: 2,
      max_ui_child_depth: 4,
      max_repeat_depth: 1
    });
    expect(passed.admissible?.byteSize).toBe(byteLength(fixture));

    const boundaries: readonly {
      readonly label: string;
      readonly atLimit: () => JsonRecord;
      readonly overLimit: () => JsonRecord;
      readonly path: string | RegExp;
    }[] = [
      { label: "canonical Blueprint bytes 262144", atLimit: () => withBlueprintBytes(262_144), overLimit: () => withBlueprintBytes(262_145), path: "$" },
      { label: "state entries 100", atLimit: () => withStateCount(100), overLimit: () => withStateCount(101), path: "$.state" },
      { label: "rules 100", atLimit: () => withRuleCount(100), overLimit: () => withRuleCount(101), path: "$.rules" },
      { label: "actions 100", atLimit: () => withActionCount(100), overLimit: () => withActionCount(101), path: "$.actions" },
      { label: "expression AST nodes 64", atLimit: () => withExpression(addition(64)), overLimit: () => withExpression(addition(65)), path: "$.rules[1].expr" },
      { label: "expression depth 12", atLimit: () => withExpression(negations(12)), overLimit: () => withExpression(negations(13)), path: "$.rules[1].expr" },
      { label: "TypeDescriptor depth 12", atLimit: () => withDescriptorDepth(12), overLimit: () => withDescriptorDepth(13), path: /^\$\.state\.deep/ },
      { label: "UI child depth 12", atLimit: () => withUiDepth(12), overLimit: () => withUiDepth(13), path: "$.nodes[29]" },
      { label: "repeat depth 2", atLimit: () => withRepeatDepth(2), overLimit: () => withRepeatDepth(3), path: "$.nodes[20].repeat" },
      { label: "total initial state bytes 131072", atLimit: () => withInitialStateBytes(131_072), overLimit: () => withInitialStateBytes(131_073), path: "$.state" },
      { label: "concurrent timers 10", atLimit: () => withRepeatedTimer(10), overLimit: () => withRepeatedTimer(11), path: "$.nodes" }
    ];
    for (const boundary of boundaries) {
      expectPassed(validate(boundary.atLimit()), `${boundary.label} at limit`);
      const over = validate(boundary.overLimit());
      expect(over.report.status, `${boundary.label} over limit`).toBe("REJECTED");
      expect(over.report.issues, `${boundary.label} over limit`).toEqual([
        { error_code: "F02-ERR-011", stage: "V09", json_path: boundary.path instanceof RegExp ? expect.stringMatching(boundary.path) : boundary.path }
      ]);
    }

    const eventsAtLimit = withEventBindings(200);
    expectPassed(validate(eventsAtLimit.candidate, eventsAtLimit.context), "event bindings 200");
    const eventsOverLimit = withEventBindings(201);
    expectExceeded(validate(eventsOverLimit.candidate, eventsOverLimit.context), "event bindings 201", "$.nodes");

    const declaredSlots = Object.values(VALIDATOR_REGISTRY.capabilities).flatMap((versions) =>
      Object.values(versions).map((capability) => [`${capability.id}@${capability.version}`, capability.resource_usage.timerSlotsPerInstance])
    );
    expect(declaredSlots.filter(([, slots]) => slots !== 0)).toEqual([["logic.timer@1.0.0", 1]]);
    expect(declaredSlots).toHaveLength(CAPABILITY_REGISTRY_SOURCE.capabilities.length);
    const [first, ...rest] = CAPABILITY_REGISTRY_SOURCE.capabilities;
    const undeclaredRuntime: Record<string, unknown> = { ...first!.runtime };
    delete undeclaredRuntime.resourceUsage;
    expect(() =>
      generateRegistryArtifacts({
        ...CAPABILITY_REGISTRY_SOURCE,
        capabilities: [{ ...first!, runtime: undeclaredRuntime as unknown as CapabilityDefinition["runtime"] }, ...rest]
      })
    ).toThrowError(expect.objectContaining({ code: "REGISTRY_GENERATION_INVALID" }) as Error);

    const repeatedTimers = validate(withRepeatedTimer(10));
    expect(repeatedTimers.report.resource_usage?.timer_count).toBe(10);
    const noTimerSlots = { registry: registryWith({ "logic.timer@1.0.0": withTimerSlots(0) }) };
    const undeclaredTimers = validate(withRepeatedTimer(11), noTimerSlots);
    expectPassed(undeclaredTimers, "logic.timer without declared timer slots");
    expect(undeclaredTimers.report.resource_usage?.timer_count).toBe(0);
    const textAsTimer = {
      registry: registryWith({ "logic.timer@1.0.0": withTimerSlots(0), "content.text@1.0.0": withTimerSlots(1) })
    };
    const swapped = validate(validBlueprint(), textAsTimer);
    expectExceeded(swapped, "timer slots declared on content.text", "$.nodes");
    expect(swapped.report.resource_usage?.timer_count).toBe(21);

    const overflow = withRepeatDepth(6, 500, "wide");
    (overflow.state as JsonRecord).wide = {
      mode: "MUTABLE",
      type: "LIST",
      initial: [],
      constraints: { item: { type: "NUMBER" }, max_length: 500 }
    };
    expectExceeded(validate(overflow), "safe integer overflow", `$.nodes[${nodesOf(overflow).length - 1}]`);

    expectExceeded(validate(withWideList(100)), "instance upper bound uses repeat max_items", capabilityPath("node_item_pick"), ref("action.button"));
    expectPassed(validate(withWideList(99)), "instance upper bound at the Capability budget");

    const scoreProps = nodesOf(validBlueprint())[nodeIndex("node_score")]!.props;
    const budgets: readonly {
      readonly label: string;
      readonly capability: string;
      readonly nodeId: string;
      readonly atLimit: Partial<GeneratedCapabilityValidator["resource_budget"]>;
      readonly overLimit: Partial<GeneratedCapabilityValidator["resource_budget"]>;
    }[] = [
      { label: "maxInstancesPerBlueprint", capability: "content.text", nodeId: "node_title", atLimit: { maxInstancesPerBlueprint: 21 }, overLimit: { maxInstancesPerBlueprint: 20 } },
      {
        label: "maxSerializedPropsBytes",
        capability: "logic.score",
        nodeId: "node_score",
        atLimit: { maxSerializedPropsBytes: byteLength(scoreProps) },
        overLimit: { maxSerializedPropsBytes: byteLength(scoreProps) - 1 }
      },
      { label: "maxEventBindings", capability: "input.number", nodeId: "node_people", atLimit: { maxEventBindings: 1 }, overLimit: { maxEventBindings: 0 } },
      { label: "maxActionBindings", capability: "logic.score", nodeId: "node_score", atLimit: { maxActionBindings: 2 }, overLimit: { maxActionBindings: 1 } },
      { label: "maxConcurrentTimers", capability: "logic.timer", nodeId: "node_timer", atLimit: { maxConcurrentTimers: 1 }, overLimit: { maxConcurrentTimers: 0 } }
    ];
    for (const budget of budgets) {
      const key = `${budget.capability}@1.0.0`;
      expectPassed(validate(validBlueprint(), { registry: registryWith({ [key]: withBudget(budget.atLimit) }) }), `${budget.label} at budget`);
      expectExceeded(
        validate(validBlueprint(), { registry: registryWith({ [key]: withBudget(budget.overLimit) }) }),
        `${budget.label} over budget`,
        capabilityPath(budget.nodeId),
        ref(budget.capability)
      );
    }
  });
});
