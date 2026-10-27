import { describe, expect, it } from "vitest";
import { blueprintWith, hydratedHarness, lit, node, op, press, scope, state } from "./runtime-fixtures.js";

/** Actual F02-admitted Blueprint: actions use the repeated row's verified index, not a hard-coded slot. */
const app = () => blueprintWith({
  state: {
    tasks: { mode: "MUTABLE", type: "LIST",
      initial: [
        { title: "Milk", done: false },
        { title: "Dentist", done: false },
        { title: "Walk", done: true }
      ],
      constraints: { item: { type: "RECORD", constraints: { fields: {
        title: { type: "STRING", constraints: { max_length: 80 } }, done: { type: "BOOLEAN" }
      } } }, max_length: 8 }
    },
    completed: { mode: "DERIVED", type: "NUMBER", expr: op("COUNT",
      op("LIST_FILTER_EQ", state("tasks"), lit("done"), lit(true))) }
  },
  actions: [
    { id: "action_toggle", steps: [{ type: "SET_STATE", target: "tasks",
      value: op("LIST_REPLACE_AT", state("tasks"), scope("index", ""),
        op("RECORD_SET", scope("item", ""), lit("done"), op("NOT", scope("item", "done")))) }] },
    { id: "action_delete", steps: [{ type: "SET_STATE", target: "tasks",
      value: op("LIST_REMOVE_AT", state("tasks"), scope("index", "")) }] }
  ],
  nodes: [
    node("node_tasks", "content.list", "1.0.0", {
      repeat: { items: state("tasks"), item_alias: "item", index_alias: "index", max_items: 8 },
      children: ["node_row"]
    }),
    node("node_row", "layout.container", "1.0.0", {
      props: { direction: lit("ROW"), gap: lit("SM"), align: lit("CENTER") },
      children: ["node_toggle", "node_delete"]
    }),
    node("node_toggle", "action.button", "1.0.0", { props: { label: lit("Complete") }, events: { press: "action_toggle" } }),
    node("node_delete", "action.button", "1.0.0", { props: { label: lit("Delete") }, events: { press: "action_delete" } })
  ]
}, ["node_tasks"]);

function rowKeys(harness: Awaited<ReturnType<typeof hydratedHarness>>, nodeId: string) {
  return harness.runtime.nodeInstances().filter((instance) => instance.key.node_id === nodeId).map((instance) => instance.key);
}

describe("Sprint 3.5 row-specific interactive task list", () => {
  it("toggles the selected second task, not the first, and recalculates completion", async () => {
    const harness = await hydratedHarness(app());
    const rows = rowKeys(harness, "node_toggle");
    expect(rows).toHaveLength(3);
    expect(harness.runtime.readState("completed")).toBe(1);
    expect(press(harness, "node_toggle", rows[1]!)).toMatchObject({ accepted: true });
    expect(harness.runtime.readState("tasks")).toEqual([
      { title: "Milk", done: false }, { title: "Dentist", done: true }, { title: "Walk", done: true }
    ]);
    expect(harness.runtime.readState("completed")).toBe(2);
    expect(harness.runtime.actionSequence).toBe(1);
  });

  it("deletes the selected item and rebinds indices for subsequent clicks", async () => {
    const harness = await hydratedHarness(app());
    const deleteKeys = rowKeys(harness, "node_delete");
    expect(press(harness, "node_delete", deleteKeys[0]!)).toMatchObject({ accepted: true });
    expect(harness.runtime.readState("tasks")).toEqual([
      { title: "Dentist", done: false }, { title: "Walk", done: true }
    ]);
    const freshRows = rowKeys(harness, "node_toggle");
    expect(freshRows).toHaveLength(2);
    expect(press(harness, "node_toggle", freshRows[0]!)).toMatchObject({ accepted: true });
    expect(harness.runtime.readState("tasks")).toEqual([
      { title: "Dentist", done: true }, { title: "Walk", done: true }
    ]);
    expect(harness.runtime.readState("completed")).toBe(2);
    expect(harness.runtime.actionSequence).toBe(2);
  });
});
