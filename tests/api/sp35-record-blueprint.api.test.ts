import { describe, expect, it } from "vitest";
import { blueprintWith, hydratedHarness, lit, node, op, scope, state } from "../runtime/runtime-fixtures.js";

const blueprint = () => blueprintWith({
  state: {
    tasks: {
      mode: "MUTABLE", type: "LIST",
      initial: [{ title: "Buy milk", done: false }, { title: "Take a walk", done: false }],
      constraints: {
        item: { type: "RECORD", constraints: { fields: {
          title: { type: "STRING", constraints: { max_length: 80 } },
          done: { type: "BOOLEAN" }
        } } },
        max_length: 25
      }
    }
  },
  rules: [{
    id: "rule_unfinished", result_type: "LIST",
    expr: op("LIST_FILTER_EQ", state("tasks"), lit("done"), lit(false))
  }],
  actions: [{
    id: "action_complete", steps: [{
      type: "SET_STATE", target: "tasks",
      value: op("LIST_REPLACE_AT", state("tasks"), scope("index", ""),
        op("RECORD_SET", scope("item", ""), lit("done"), lit(true)))
    }]
  }],
  nodes: [
    node("node_list", "content.list", "1.0.0", {
      repeat: { items: state("tasks"), item_alias: "item", index_alias: "index", max_items: 25 },
      children: ["node_row"]
    }),
    node("node_row", "layout.container", "1.0.0", {
      props: { direction: lit("ROW"), gap: lit("SM"), align: lit("CENTER") },
      children: ["node_title", "node_complete"]
    }),
    node("node_title", "content.text", "1.0.0", {
      props: { role: lit("BODY") }, bindings: { text: scope("item", "title") }
    }),
    node("node_complete", "action.button", "1.0.0", {
      props: { label: lit("Done") }, events: { press: "action_complete" }
    })
  ]
}, ["node_list"]);

describe("Sprint 3.5 complete task Blueprint through actual F02/F03 gate", () => {
  it("admits the real Blueprint and commits a repeated-row button action", async () => {
    const h = await hydratedHarness(blueprint());
    const keys = h.runtime.nodeInstances()
      .filter((instance) => instance.key.node_id === "node_complete").map((instance) => instance.key);
    expect(keys).toHaveLength(2);
    expect(h.runtime.readRule("rule_unfinished")).toMatchObject({ ok: true });
    const receipt = h.runtime.dispatch({
      source_node_instance_key: keys[0]!, event_name: "press", payload: {}, origin: "USER"
    });
    expect(receipt).toMatchObject({ accepted: true });
    expect(h.runtime.readState("tasks")).toEqual([
      { title: "Buy milk", done: true }, { title: "Take a walk", done: false }
    ]);
    expect(h.runtime.actionSequence).toBe(1);
    expect(h.runtime.readRule("rule_unfinished")).toMatchObject({ ok: true });
  });
});
