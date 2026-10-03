import { describe, expect, test } from "vitest";

import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import {
  encode,
  issueOf,
  node,
  nodeIndex,
  source,
  validBlueprint,
  type JsonRecord
} from "../contract/blueprint-validation-fixtures.js";

const { lit, op, state } = source;

function validate(candidate: unknown): ReturnType<typeof validateBlueprintCandidate> {
  return validateBlueprintCandidate(encode(candidate));
}

function container(id: string, children: string[]): JsonRecord {
  return node(id, "layout.container", "1.0.0", {
    props: { direction: lit("COLUMN"), gap: lit("NONE"), align: lit("START") },
    children
  });
}

function withExtraNodes(rootChildren: readonly string[], extra: readonly JsonRecord[]): JsonRecord {
  const candidate = validBlueprint();
  const nodes = candidate.nodes as JsonRecord[];
  const root = nodes[nodeIndex("node_root")] as JsonRecord;
  root.children = [...(root.children as string[]), ...rootChildren];
  nodes.push(...extra);
  return candidate;
}

function withDerived(entries: Record<string, JsonRecord>): JsonRecord {
  const candidate = validBlueprint();
  Object.assign(candidate.state as JsonRecord, entries);
  return candidate;
}

function withRules(rules: readonly JsonRecord[]): JsonRecord {
  const candidate = validBlueprint();
  candidate.rules = [...(candidate.rules as JsonRecord[]), ...rules];
  return candidate;
}

const derived = (expr: JsonRecord): JsonRecord => ({ mode: "DERIVED", type: "NUMBER", expr });
const rule = (id: string, expr: JsonRecord): JsonRecord => ({ id, result_type: "NUMBER", expr });
const ruleRef = (ruleId: string): JsonRecord => ({ kind: "RULE", rule_id: ruleId });

describe("F02 node graph and derived/rule dependency cycles", () => {
  test("TEST-F02-007 rejects node cycles, non-tree node graphs and derived/rule dependency cycles", () => {
    const nodeCount = (validBlueprint().nodes as JsonRecord[]).length;
    const detachedCycle = withExtraNodes([], [container("node_cycle_a", ["node_cycle_b"]), container("node_cycle_b", ["node_cycle_a"])]);
    expect(issueOf(validate(detachedCycle))).toEqual({ code: "F02-ERR-007", stage: "V06", path: `$.nodes[${nodeCount}]` });

    const selfCycle = withExtraNodes([], [container("node_self", ["node_self"])]);
    expect(issueOf(validate(selfCycle))).toMatchObject({ code: "F02-ERR-007", stage: "V06" });

    const rootAsChild = withExtraNodes(["node_back"], [container("node_back", ["node_root"])]);
    expect(issueOf(validate(rootAsChild))).toEqual({
      code: "F02-ERR-007",
      stage: "V06",
      path: `$.nodes[${nodeCount}].children[0]`
    });

    const multiParent = withExtraNodes(["node_shared_parent"], [container("node_shared_parent", ["node_title"])]);
    expect(issueOf(validate(multiParent))).toMatchObject({ code: "F02-ERR-007", stage: "V06" });

    const orphan = withExtraNodes([], [container("node_orphan", [])]);
    expect(issueOf(validate(orphan))).toEqual({ code: "F02-ERR-007", stage: "V06", path: `$.nodes[${nodeCount}]` });

    const derivedCycle = withDerived({
      loop_a: derived(op("ADD", state("loop_b"), lit(1))),
      loop_b: derived(op("ADD", state("loop_a"), lit(1)))
    });
    expect(issueOf(validate(derivedCycle))).toMatchObject({ code: "F02-ERR-006", stage: "V05" });

    const derivedSelf = withDerived({ loop_self: derived(op("ADD", state("loop_self"), lit(1))) });
    expect(issueOf(validate(derivedSelf))).toEqual({ code: "F02-ERR-006", stage: "V05", path: "$.state.loop_self.expr" });

    const mixedCycle = withDerived({ loop_mixed: derived(ruleRef("rule_loop_mixed")) });
    (mixedCycle.rules as JsonRecord[]).push(rule("rule_loop_mixed", op("ADD", state("loop_mixed"), lit(1))));
    expect(issueOf(validate(mixedCycle))).toEqual({ code: "F02-ERR-006", stage: "V05", path: "$.state.loop_mixed.expr" });

    const ruleCycle = withRules([
      rule("rule_loop_a", op("ADD", ruleRef("rule_loop_b"), lit(1))),
      rule("rule_loop_b", op("ADD", ruleRef("rule_loop_a"), lit(1)))
    ]);
    expect(issueOf(validate(ruleCycle))).toMatchObject({ code: "F02-ERR-009", stage: "V07" });

    const ruleSelf = withRules([rule("rule_loop_self", op("ADD", ruleRef("rule_loop_self"), lit(1)))]);
    expect(issueOf(validate(ruleSelf))).toEqual({ code: "F02-ERR-009", stage: "V07", path: "$.rules[1].expr" });
  });

  test("admits acyclic derived/rule chains regardless of declaration order", () => {
    const chain = withDerived({
      doubled: derived(op("MUL", ruleRef("rule_people_plus_one"), lit(2)))
    });
    (chain.rules as JsonRecord[]).unshift(rule("rule_people_plus_one", op("ADD", state("people"), lit(1))));
    const result = validate(chain);
    expect(result.report.issues).toEqual([]);
    expect(result.report.status).toBe("PASSED");
  });
});
