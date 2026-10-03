import { describe, expect, test } from "vitest";

import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import {
  actionIndex,
  encode,
  issueOf,
  mutate,
  node,
  nodeIndex,
  source,
  validBlueprint,
  withValue,
  type JsonRecord
} from "./blueprint-validation-fixtures.js";

const { lit, op, state, event, scope } = source;

function validate(candidate: unknown): ReturnType<typeof validateBlueprintCandidate> {
  return validateBlueprintCandidate(encode(candidate));
}

function expectRejected(candidate: JsonRecord, expected: { code: string; stage: string; path?: string }, label: string): void {
  const result = validate(candidate);
  expect(result.report.status, label).toBe("REJECTED");
  expect(result.admissible, label).toBeUndefined();
  expect(issueOf(result), label).toMatchObject(expected);
}

function withSecondPickSiteOutsideRepeat(): JsonRecord {
  const candidate = validBlueprint();
  const nodes = candidate.nodes as JsonRecord[];
  (nodes[nodeIndex("node_root")] as JsonRecord).children = [
    ...((nodes[nodeIndex("node_root")] as JsonRecord).children as string[]),
    "node_outside_pick"
  ];
  nodes.push(node("node_outside_pick", "action.button", "1.0.0", { props: { label: lit("外部") }, events: { press: "action_pick_item" } }));
  return candidate;
}

function withExtraScoreTarget(parentId: string): { candidate: JsonRecord; stepPath: string } {
  const candidate = validBlueprint();
  const nodes = candidate.nodes as JsonRecord[];
  const parent = nodes[nodeIndex(parentId)] as JsonRecord;
  parent.children = [...(parent.children as string[]), "node_extra_score"];
  nodes.push(node("node_extra_score", "logic.score", "1.0.0", { props: { initial: lit(0), min: lit(0), max: lit(10) } }));
  const roll = actionIndex("action_roll");
  const steps = (candidate.actions as JsonRecord[])[roll]?.steps as JsonRecord[];
  steps.push({ type: "INVOKE_CAPABILITY", target_node_id: "node_extra_score", capability_action: "increment", args: { delta: lit(1) } });
  return { candidate, stepPath: `$.actions[${roll}].steps[${steps.length - 1}].target_node_id` };
}

describe("F02 state / binding / rule / action reference typing", () => {
  test("TEST-F02-006 never admits broken state, binding, rule or action references or incompatible types", () => {
    const people = nodeIndex("node_people");
    const stat = nodeIndex("node_stat");
    const title = nodeIndex("node_title");
    const size = nodeIndex("node_size");
    const note = nodeIndex("node_note");
    const setPeople = actionIndex("action_set_people");
    const roll = actionIndex("action_roll");

    expectRejected(withValue(["state", "people", "initial"], "four"), { code: "F02-ERR-006", stage: "V05", path: "$.state.people.initial" }, "initial type");
    expectRejected(
      withValue(["state", "note", "constraints"], { max_length: 8193 }),
      { code: "F02-ERR-006", stage: "V05", path: "$.state.note.constraints.max_length" },
      "STRING ceiling"
    );
    expectRejected(
      withValue(["state", "items", "constraints", "item", "constraints", "optional_fields"], ["name"]),
      { code: "F02-ERR-006", stage: "V05" },
      "app-state optional_fields"
    );
    expectRejected(
      withValue(["state", "size", "constraints", "allowed"], ["SMALL", 1]),
      { code: "F02-ERR-006", stage: "V05" },
      "heterogeneous ENUM"
    );

    expectRejected(withValue(["nodes", stat, "bindings", "value"], state("missing")), { code: "F02-ERR-008", stage: "V07", path: `$.nodes[${stat}].bindings.value.key` }, "missing STATE");
    expectRejected(withValue(["nodes", title, "bindings", "text"], state("people")), { code: "F02-ERR-008", stage: "V07", path: `$.nodes[${title}].bindings.text` }, "NUMBER to STRING binding");
    expectRejected(withValue(["nodes", people, "bindings", "bind"], state("per_person")), { code: "F02-ERR-008", stage: "V07" }, "DERIVED bound to mutable binding");
    expectRejected(withValue(["nodes", people, "props", "label"], state("note")), { code: "F02-ERR-008", stage: "V07" }, "prop source kind");
    expectRejected(withValue(["nodes", title, "bindings", "text"], event("value")), { code: "F02-ERR-008", stage: "V07" }, "EVENT outside action");
    expectRejected(withValue(["nodes", title, "bindings", "text"], scope("item", "name")), { code: "F02-ERR-008", stage: "V07" }, "SCOPE outside repeat");
    expectRejected(
      withValue(["nodes", nodeIndex("node_item_name"), "bindings", "text"], scope("item", "price")),
      { code: "F02-ERR-008", stage: "V07" },
      "SCOPE path type"
    );
    expectRejected(
      withValue(["nodes", nodeIndex("node_list"), "repeat", "items"], scope("item", "")),
      { code: "F02-ERR-008", stage: "V07" },
      "repeat alias visible to its own repeat.items"
    );
    expectRejected(withValue(["nodes", size, "props", "options"], lit([{ label: "小", value: "SMALL" }])), { code: "F02-ERR-008", stage: "V07" }, "SELECT_ENUM_DOMAIN");
    expectRejected(withValue(["nodes", note, "props", "max_length"], lit(201)), { code: "F02-ERR-008", stage: "V07" }, "INPUT_TEXT_BOUND");
    expectRejected(withValue(["nodes", nodeIndex("node_table"), "props", "max_rows"], lit(19)), { code: "F02-ERR-008", stage: "V07" }, "TABLE_ROWS_BOUND");
    expectRejected(withValue(["nodes", stat, "bindings", "value"], state("note")), { code: "F02-ERR-008", stage: "V07" }, "STAT_FORMAT numeric format on STRING");

    expectRejected(withValue(["state", "per_person", "expr"], { kind: "RULE", rule_id: "rule_missing" }), { code: "F02-ERR-009", stage: "V07", path: "$.state.per_person.expr.rule_id" }, "missing RULE");
    expectRejected(withValue(["rules", 0, "expr"], op("GT", scope("item", "price"), lit(0))), { code: "F02-ERR-009", stage: "V07" }, "SCOPE in Rule");
    expectRejected(withValue(["rules", 0, "result_type"], "NUMBER"), { code: "F02-ERR-009", stage: "V07", path: "$.rules[0].result_type" }, "rule result_type");
    expectRejected(withValue(["rules", 0, "expr"], op("EVAL", lit("1+1"))), { code: "F02-ERR-009", stage: "V07", path: "$.rules[0].expr.op" }, "operator allowlist");
    expectRejected(withValue(["rules", 0, "expr"], op("GT", state("people"), lit("0"))), { code: "F02-ERR-009", stage: "V07" }, "comparison operand types");
    expectRejected(withValue(["result", "outputs", 0, "value"], scope("item", "name")), { code: "F02-ERR-008", stage: "V07" }, "SCOPE in Result");

    expectRejected(withValue(["actions", setPeople, "steps", 0, "target"], "missing"), { code: "F02-ERR-010", stage: "V08", path: `$.actions[${setPeople}].steps[0].target` }, "missing SET_STATE target");
    expectRejected(withValue(["actions", setPeople, "steps", 0, "target"], "per_person"), { code: "F02-ERR-010", stage: "V08" }, "SET_STATE to DERIVED");
    expectRejected(withValue(["actions", setPeople, "steps", 0, "target"], "note"), { code: "F02-ERR-010", stage: "V08" }, "SET_STATE type mismatch");
    expectRejected(withValue(["nodes", people, "events", "change"], "action_missing"), { code: "F02-ERR-010", stage: "V08", path: `$.nodes[${people}].events.change` }, "missing event Action");
    expectRejected(withValue(["nodes", nodeIndex("node_notice"), "bindings", "action_refs"], lit(["action_missing"])), { code: "F02-ERR-010", stage: "V08" }, "missing action_refs Action");
    expectRejected(withValue(["actions", roll, "steps", 0, "target_node_id"], "node_missing"), { code: "F02-ERR-010", stage: "V08" }, "missing INVOKE target");
    expectRejected(withValue(["actions", roll, "steps", 0, "capability_action"], "sample_float"), { code: "F02-ERR-010", stage: "V08" }, "undeclared capability action");
    expectRejected(withValue(["actions", roll, "steps", 0, "args", "seed"], lit(1)), { code: "F02-ERR-010", stage: "V08" }, "undeclared action arg");
    expectRejected(withValue(["actions", roll, "steps", 0, "args", "min"], lit(7)), { code: "F02-ERR-010", stage: "V08" }, "RANDOM_MIN_MAX singleton");
    expectRejected(withValue(["actions", roll, "steps", 0, "args", "min"], state("people")), { code: "F02-ERR-010", stage: "V08" }, "RANDOM_MIN_MAX unprovable");
    expectRejected(withValue(["actions", roll, "steps", 4, "args", "value"], lit(11)), { code: "F02-ERR-010", stage: "V08" }, "SCORE_BOUNDS set");
    expectRejected(
      mutate(validBlueprint(), ["actions", roll, "steps", 0, "args"], (parent, key) => {
        delete ((parent as JsonRecord)[key] as JsonRecord).max;
      }),
      { code: "F02-ERR-010", stage: "V08" },
      "required action arg"
    );
    expectRejected(
      withValue(["actions", actionIndex("action_reset"), "steps"], [{ type: "SET_STATE", target: "people", value: event("value") }]),
      { code: "F02-ERR-010", stage: "V08" },
      "EVENT without dispatch site (action_refs does not dispatch)"
    );
    expectRejected(withSecondPickSiteOutsideRepeat(), { code: "F02-ERR-010", stage: "V08" }, "SCOPE missing at one dispatch site");
    for (const parentId of ["node_list", "node_item_row"]) {
      const repeated = withExtraScoreTarget(parentId);
      expectRejected(repeated.candidate, { code: "F02-ERR-010", stage: "V08", path: repeated.stepPath }, `INVOKE target under repeat ancestor via ${parentId}`);
    }
  });

  test("admits an otherwise identical INVOKE_CAPABILITY target when it is a singleton node without a repeat ancestor", () => {
    for (const parentId of ["node_root", "node_card"]) {
      const result = validate(withExtraScoreTarget(parentId).candidate);
      expect(result.report.status, parentId).toBe("PASSED");
      expect(result.report.issues, parentId).toEqual([]);
    }
  });

  test("keeps the canonical fixture valid so every rejection above isolates one broken reference", () => {
    expect(validate(validBlueprint()).report.status).toBe("PASSED");
    expect(validate(withValue(["nodes", nodeIndex("node_stat"), "props", "format"], lit("TEXT"))).report.status).toBe("PASSED");
  });
});
