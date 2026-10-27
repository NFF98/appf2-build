import { describe, expect, it } from "vitest";
import { SYSTEM_POLICY, composeResponseSchema } from "../../src/platform/compiler/prompts.js";
import { canonicalRepairHint, accumulateValidationIssues } from "../../src/platform/compiler/compose-validate.js";

describe("Sprint 3.5 real natural-language task app F02 incident", () => {
  it("constrains event values to canonical action IDs in upstream schema", () => {
    const schema = composeResponseSchema([{ id: "input.text", version: "1.0.0" }]);
    const props = schema.properties as Record<string, unknown>;
    const nodes = props.nodes as {items:{properties:{events:{additionalProperties:{pattern:string}}}}};
    const pattern = new RegExp(nodes.items.properties.events.additionalProperties.pattern);
    expect(pattern.test("action_update_input")).toBe(true);
    expect(pattern.test("action_addTask")).toBe(false);
    expect(pattern.test("change")).toBe(false);
    expect(pattern.test("")).toBe(false);
  });
  it("gives exact F02 V02 repair guidance for the observed events.change error", () => {
    const hint = canonicalRepairHint("F02-ERR-002", "V02", "$.nodes[1].events.change");
    expect(hint).toContain("actions[].id");
    expect(hint).toContain("action_update_input");
    expect(canonicalRepairHint("F02-ERR-002", "V03", "$.nodes[1].events.change")).toBeUndefined();
  });
  it("gives concrete safe fixes for real observed V06 root and repeat paths", () => {
    expect(canonicalRepairHint("F02-ERR-007", "V06", "$.root_node_id"))
      .toContain("actual node");
    expect(canonicalRepairHint("F02-ERR-007", "V06", "$.nodes[4].repeat"))
      .toContain("OMIT repeat");
    expect(canonicalRepairHint("F02-ERR-007", "V06", "$.nodes[4]"))
      .toContain("Orphan node");
    expect(canonicalRepairHint("F02-ERR-007", "V02", "$.nodes[4].repeat")).toBeUndefined();
  });
  it("prevents the natural task creator from sending invented roots or leaf repeats", () => {
    expect(SYSTEM_POLICY.BLUEPRINT_COMPOSE).toContain("root_node_id MUST be the id of ONE actual nodes[] entry");
    expect(SYSTEM_POLICY.BLUEPRINT_COMPOSE).toContain("input.text, input.toggle, action.button, content.text and data.stat MUST OMIT repeat");
    expect(SYSTEM_POLICY.BLUEPRINT_COMPOSE).toContain("EVERY ONCE in the children array".replace("EVERY ONCE","EXACTLY ONCE"));
  });
  it("preserves previous invalid event and orphan-node repair evidence together", () => {
    const first = {error_code:"F02-ERR-002",stage:"V02",json_path:"$.nodes[1].events.change"};
    const later = {error_code:"F02-ERR-007",stage:"V06",json_path:"$.nodes[4]"};
    expect(accumulateValidationIssues([first], [later]).map(x => x.error_code))
      .toEqual(["F02-ERR-002", "F02-ERR-007"]);
  });
  it("requires canonical input bindings and a fully connected node graph", () => {
    expect(SYSTEM_POLICY.BLUEPRINT_COMPOSE).toContain("events.change");
    expect(SYSTEM_POLICY.BLUEPRINT_COMPOSE).toContain("exactly one incoming children reference");
    expect(SYSTEM_POLICY.BLUEPRINT_COMPOSE).toContain("reachable node IDs");
  });
});
