import { describe, expect, it } from "vitest";
import { blueprintWith, buttonNode, hydratedHarness, lit, node, op, press, state } from "./runtime-fixtures.js";

const expenses = {
  mode: "MUTABLE", type: "LIST",
  initial: [{ category: "Food", amount: 15 }, { category: "Travel", amount: 20 }],
  constraints: {
    item: { type: "RECORD", constraints: { fields: {
      category: { type: "STRING", constraints: { max_length: 80 } },
      amount: { type: "NUMBER" }
    } } },
    max_length: 25
  }
};
const total = () => op("LIST_SUM_BY", state("expenses"), lit("amount"));
const app = () => blueprintWith({
  state: { expenses, weekly_budget: { mode: "MUTABLE", type: "NUMBER", initial: 100 } },
  rules: [
    { id: "rule_total", result_type: "NUMBER", expr: total() },
    { id: "rule_remaining", result_type: "NUMBER",
      expr: op("SUB", state("weekly_budget"), total()) }
  ],
  actions: [{
    id: "action_expense", steps: [{
      type: "SET_STATE", target: "expenses",
      value: op("LIST_APPEND", state("expenses"), lit({ category: "Food", amount: 10 }))
    }]
  }],
  nodes: [
    node("node_total", "data.stat", "1.0.0", {
      props: { label: lit("Spent this week"), format: lit("CURRENCY_DISPLAY") },
      bindings: { value: total() }
    }),
    buttonNode("node_expense", "action_expense")
  ]
});

describe("Sprint 3.5 real expense total and weekly budget", () => {
  it("admits the Blueprint and recomputes totals after a user adds an expense", async () => {
    const h = await hydratedHarness(app());
    expect(h.runtime.readRule("rule_total")).toEqual({ ok: true, value: 35 });
    expect(h.runtime.readRule("rule_remaining")).toEqual({ ok: true, value: 65 });
    expect(press(h, "node_expense")).toMatchObject({ accepted: true });
    expect(h.runtime.readRule("rule_total")).toEqual({ ok: true, value: 45 });
    expect(h.runtime.readRule("rule_remaining")).toEqual({ ok: true, value: 55 });
    expect(h.runtime.actionSequence).toBe(1);
  });
});
