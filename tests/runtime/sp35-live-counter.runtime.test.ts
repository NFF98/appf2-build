import { describe, expect, it } from "vitest";
import { blueprintWith, buttonNode, hydratedHarness, lit, node, op, press, state } from "./runtime-fixtures.js";

const app = () => blueprintWith({
  state: {
    groceries: {
      mode: "MUTABLE", type: "LIST", initial: ["Rice"],
      constraints: { item: { type: "STRING", constraints: { max_length: 80 } }, max_length: 10 }
    }
  },
  rules: [{ id: "rule_remaining", result_type: "NUMBER",
    expr: op("COUNT", state("groceries")) }],
  actions: [{
    id: "action_add", steps: [{
      type: "SET_STATE", target: "groceries",
      value: op("LIST_APPEND", state("groceries"), lit("Bread"))
    }]
  }],
  nodes: [
    node("node_count", "data.stat", "1.0.0", {
      props: { label: lit("Items Remaining"), format: lit("NUMBER") },
      bindings: { value: op("COUNT", state("groceries")) }
    }),
    buttonNode("node_add", "action_add")
  ]
});

describe("Sprint 3.5 live numeric counter is a working statistic", () => {
  it("passes F02 admission and updates actual F03 count after an add action", async () => {
    const h = await hydratedHarness(app());
    expect(h.runtime.readRule("rule_remaining")).toEqual({ ok: true, value: 1 });
    expect(h.runtime.readState("groceries")).toEqual(["Rice"]);
    expect(press(h, "node_add")).toMatchObject({ accepted: true });
    expect(h.runtime.readState("groceries")).toEqual(["Rice", "Bread"]);
    expect(h.runtime.readRule("rule_remaining")).toEqual({ ok: true, value: 2 });
    expect(h.runtime.actionSequence).toBe(1);
  });
});
