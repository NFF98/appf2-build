import { describe, expect, test } from "vitest";

import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import type { BlueprintValidationResult } from "../../src/platform/blueprint/validation-types.js";
import type { CapabilityDefinition } from "../../src/platform/capabilities/schema/capability-definition.js";
import { encode, node, source, validBlueprint, type JsonRecord } from "./blueprint-validation-fixtures.js";
import { cloneCapability, registrySource, snapshotOf, validateAgainst } from "./registry-snapshot-fixtures.js";

const { lit, op, scope, state } = source;
const TIMER = (id: string): JsonRecord => node(id, "logic.timer", "1.0.0", { props: { duration_ms: lit(1000) } });
const TEXT = (id: string, text: unknown = "x"): JsonRecord =>
  node(id, "content.text", "1.0.0", { props: { role: lit("BODY") }, bindings: { text: lit(text) } });

function nodesOf(candidate: JsonRecord): JsonRecord[] {
  return candidate.nodes as JsonRecord[];
}

function childrenOf(candidate: JsonRecord, id: string): string[] {
  return nodesOf(candidate).find((entry) => entry.id === id)!.children as string[];
}

function addUnder(candidate: JsonRecord, parentId: string, ...added: JsonRecord[]): JsonRecord {
  nodesOf(candidate).push(...added);
  childrenOf(candidate, parentId).push(...added.map((entry) => entry.id as string));
  return candidate;
}

function withListMaxItems(candidate: JsonRecord, maxItems: number): JsonRecord {
  const list = nodesOf(candidate).find((entry) => entry.id === "node_list")!;
  list.repeat = { ...(list.repeat as JsonRecord), max_items: maxItems };
  return candidate;
}

function rejection(result: BlueprintValidationResult): unknown {
  expect(result.admissible).toBeUndefined();
  const [issue] = result.report.issues;
  return { status: result.report.status, ...issue };
}

const V09 = { status: "REJECTED", error_code: "F02-ERR-011", stage: "V09" };

function expectRejectedAt(candidate: JsonRecord, path: string | RegExp): void {
  const actual = rejection(validateBlueprintCandidate(encode(candidate))) as { json_path: string };
  expect(actual).toMatchObject(V09);
  if (typeof path === "string") {
    expect(actual.json_path).toBe(path);
  } else {
    expect(actual.json_path).toMatch(path);
  }
}

function expectReportedUsage(): void {
  const result = validateBlueprintCandidate(encode(validBlueprint()));
  expect(result.report.status).toBe("PASSED");
  expect(result.report.resource_usage).toMatchObject({
    blueprint_bytes: result.admissible?.byteSize,
    node_count: 18,
    state_count: 8,
    rule_count: 1,
    action_count: 7,
    event_binding_count: 6,
    timer_count: 1,
    max_ui_child_depth: 4,
    max_repeat_depth: 1,
    max_type_descriptor_depth: 3
  });
}

function expectTimerCeilingUsesRepeatUpperBounds(): void {
  expectRejectedAt(addUnder(validBlueprint(), "node_item_row", TIMER("node_row_timer")), "$.nodes");
  expectRejectedAt(addUnder(withListMaxItems(validBlueprint(), 10), "node_item_row", TIMER("node_row_timer")), "$.nodes");
  const atCeiling = validateBlueprintCandidate(encode(addUnder(withListMaxItems(validBlueprint(), 9), "node_item_row", TIMER("node_row_timer"))));
  expect(atCeiling.report.status).toBe("PASSED");
  expect(atCeiling.report.resource_usage?.timer_count).toBe(10);
}

function expectTimerUsageComesFromRegistryTruth(): void {
  const ticker = cloneCapability("content.text", "content.ticker", "1.0.0", (definition) => ({
    ...definition,
    runtime: { ...definition.runtime, resourceUsage: { timerSlotsPerInstance: 1 } }
  }));
  const snapshot = snapshotOf(registrySource("6.7.0", [...registrySource("6.7.0").capabilities, ticker]));
  const tickers = (count: number): JsonRecord => {
    const candidate = { ...validBlueprint(), registry_version: "6.7.0" };
    const added = Array.from({ length: count }, (_, index) => ({ ...TEXT(`node_tick_${index}`), capability: { id: "content.ticker", version: "1.0.0" } }));
    return addUnder(candidate, "node_root", ...added);
  };
  expect(validateAgainst(tickers(9), snapshot).report.resource_usage?.timer_count).toBe(10);
  expect(rejection(validateAgainst(tickers(10), snapshot))).toMatchObject({ ...V09, json_path: "$.nodes" });
}

function expectCapabilityBudgetsCarryCapabilityRef(): void {
  const limited = cloneCapability("content.text", "content.limited", "1.0.0", (definition): CapabilityDefinition => ({
    ...definition,
    runtime: { ...definition.runtime, resourceBudget: { ...definition.runtime.resourceBudget, maxInstancesPerBlueprint: 19 } }
  }));
  const tally = cloneCapability("logic.score", "logic.tally", "1.0.0", (definition): CapabilityDefinition => ({
    ...definition,
    runtime: { ...definition.runtime, resourceBudget: { ...definition.runtime.resourceBudget, maxActionBindings: 1 } }
  }));
  const snapshot = snapshotOf(registrySource("6.8.0", [...registrySource("6.8.0").capabilities, limited, tally]));

  const repeated = addUnder({ ...validBlueprint(), registry_version: "6.8.0" }, "node_item_row", {
    ...TEXT("node_row_limited"),
    capability: { id: "content.limited", version: "1.0.0" }
  });
  expect(rejection(validateAgainst(repeated, snapshot))).toMatchObject({
    ...V09,
    json_path: "$.nodes",
    capability_ref: { id: "content.limited", version: "1.0.0" }
  });
  expect(validateAgainst(withListMaxItems(repeated, 19), snapshot).report.status).toBe("PASSED");

  const invoked = addUnder({ ...validBlueprint(), registry_version: "6.8.0" }, "node_root", node("node_tally", "logic.tally", "1.0.0"));
  (invoked.actions as JsonRecord[]).push({
    id: "action_tally",
    steps: [
      { type: "INVOKE_CAPABILITY", target_node_id: "node_tally", capability_action: "increment", args: { delta: lit(1) } },
      { type: "INVOKE_CAPABILITY", target_node_id: "node_tally", capability_action: "reset", args: {} }
    ]
  });
  expect(rejection(validateAgainst(invoked, snapshot))).toMatchObject({ ...V09, capability_ref: { id: "logic.tally", version: "1.0.0" } });
}

function expectByteCeilings(): void {
  const large = Array.from({ length: 33 }, (_, index) => TEXT(`node_big_${index}`, "a".repeat(8_000)));
  expectRejectedAt(addUnder(validBlueprint(), "node_root", ...large), "$");

  const heavyState = validBlueprint();
  const stateMap = heavyState.state as JsonRecord;
  for (let index = 0; index < 17; index += 1) {
    stateMap[`heavy_${index}`] = { mode: "MUTABLE", type: "STRING", initial: "b".repeat(8_000), constraints: { max_length: 8_192 } };
  }
  expectRejectedAt(heavyState, "$.state");
}

function expectCountCeilings(): void {
  const manyStates = validBlueprint();
  for (let index = 0; index < 93; index += 1) {
    (manyStates.state as JsonRecord)[`flag_${index}`] = { mode: "MUTABLE", type: "BOOLEAN", initial: false };
  }
  expectRejectedAt(manyStates, "$.state");

  const manyRules = validBlueprint();
  for (let index = 0; index < 100; index += 1) {
    (manyRules.rules as JsonRecord[]).push({ id: `rule_extra_${index}`, result_type: "BOOLEAN", expr: lit(true) });
  }
  expectRejectedAt(manyRules, "$.rules");

  const manyActions = validBlueprint();
  for (let index = 0; index < 94; index += 1) {
    (manyActions.actions as JsonRecord[]).push({ id: `action_extra_${index}`, steps: [{ type: "SET_STATE", target: "people", value: lit(1) }] });
  }
  expectRejectedAt(manyActions, "$.actions");
}

function ruleWith(expr: JsonRecord): JsonRecord {
  const candidate = validBlueprint();
  (candidate.rules as JsonRecord[]).push({ id: "rule_heavy", result_type: "NUMBER", expr });
  return candidate;
}

function nestedAdd(levels: number): JsonRecord {
  let expr: JsonRecord = lit(1);
  for (let level = 0; level < levels; level += 1) {
    expr = op("ADD", expr, lit(1));
  }
  return expr;
}

function expectExpressionAndStructureCeilings(): void {
  expectRejectedAt(ruleWith(op("ADD", ...Array.from({ length: 64 }, () => lit(1)))), "$.rules[1].expr");
  expect(validateBlueprintCandidate(encode(ruleWith(op("ADD", ...Array.from({ length: 63 }, () => lit(1)))))).report.status).toBe("PASSED");
  expectRejectedAt(ruleWith(nestedAdd(12)), /^\$\.rules\[1\]\.expr(\.args\[\d\]){12}$/);
  expect(validateBlueprintCandidate(encode(ruleWith(nestedAdd(11)))).report.status).toBe("PASSED");

  let descriptor: JsonRecord = { type: "BOOLEAN" };
  for (let level = 0; level < 12; level += 1) {
    descriptor = { type: "LIST", constraints: { item: descriptor, max_length: 1 } };
  }
  const deepState = validBlueprint();
  (deepState.state as JsonRecord).deep = { mode: "MUTABLE", initial: [], ...descriptor };
  expectRejectedAt(deepState, "$.state.deep");

  const deepTree = validBlueprint();
  let parentId = "node_root";
  for (let level = 0; level < 12; level += 1) {
    const id = `node_chain_${level}`;
    addUnder(deepTree, parentId, node(id, "layout.container", "1.0.0", { props: { direction: lit("ROW"), gap: lit("SM"), align: lit("START") } }));
    parentId = id;
  }
  expectRejectedAt(deepTree, `$.nodes[${nodesOf(deepTree).length - 1}]`);
}

function expectRepeatDepthCeiling(): void {
  const cell = { type: "RECORD", constraints: { fields: { name: { type: "STRING", constraints: { max_length: 20 } } } } };
  const row = { type: "RECORD", constraints: { fields: { cells: { type: "LIST", constraints: { item: cell, max_length: 2 } } } } };
  const group = { type: "RECORD", constraints: { fields: { rows: { type: "LIST", constraints: { item: row, max_length: 2 } } } } };
  const nested = (depth: 2 | 3): JsonRecord => {
    const candidate = validBlueprint();
    (candidate.state as JsonRecord).matrix = { mode: "MUTABLE", type: "LIST", initial: [], constraints: { item: group, max_length: 2 } };
    const list = (id: string, items: JsonRecord, alias: string, child: string): JsonRecord =>
      node(id, "content.list", "1.0.0", { repeat: { items, item_alias: alias, max_items: 2 }, children: [child] });
    addUnder(candidate, "node_root", list("node_l1", state("matrix"), "g", "node_l2"));
    if (depth === 2) {
      nodesOf(candidate).push(list("node_l2", scope("g", "rows"), "r", "node_leaf"), TEXT("node_leaf"));
    } else {
      nodesOf(candidate).push(list("node_l2", scope("g", "rows"), "r", "node_l3"), list("node_l3", scope("r", "cells"), "c", "node_leaf"));
      nodesOf(candidate).push({ ...TEXT("node_leaf"), bindings: { text: scope("c", "name") } });
    }
    return candidate;
  };
  expect(validateBlueprintCandidate(encode(nested(2))).report.status).toBe("PASSED");
  const threeLevels = nested(3);
  expectRejectedAt(threeLevels, `$.nodes[${nodesOf(threeLevels).findIndex((entry) => entry.id === "node_l3")}]`);
}

describe("F02 V09 hard resource ceilings", () => {
  test("TEST-F02-010 rejects every statically provable hard resource ceiling and capability budget overflow at V09 before Runtime", () => {
    expectReportedUsage();
    expectTimerCeilingUsesRepeatUpperBounds();
    expectTimerUsageComesFromRegistryTruth();
    expectCapabilityBudgetsCarryCapabilityRef();
    expectByteCeilings();
    expectCountCeilings();
    expectExpressionAndStructureCeilings();
    expectRepeatDepthCeiling();
  });
});
