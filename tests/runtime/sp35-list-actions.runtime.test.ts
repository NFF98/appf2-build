import { describe, expect, it } from "vitest";
import { blueprintWith, buttonNode, hydratedHarness, lit, op, press, state } from "./runtime-fixtures.js";

const listState = {
  items: {
    mode: "MUTABLE", type: "LIST", initial: ["Milk"],
    constraints: { item: { type: "STRING", constraints: { max_length: 80 } }, max_length: 5 }
  }
};

const app = () => blueprintWith({
  state: listState,
  actions: [
    { id: "action_add", steps: [
      { type: "SET_STATE", target: "items", value: op("LIST_APPEND", state("items"), lit("Bread")) }
    ] },
    { id: "action_edit", steps: [
      { type: "SET_STATE", target: "items", value: op("LIST_REPLACE_AT", state("items"), lit(0), lit("Oat milk")) }
    ] },
    { id: "action_remove", steps: [
      { type: "SET_STATE", target: "items", value: op("LIST_REMOVE_AT", state("items"), lit(1)) }
    ] },
    { id: "action_invalid", steps: [
      { type: "SET_STATE", target: "items", value: op("LIST_REMOVE_AT", state("items"), lit(99)) }
    ] }
  ],
  nodes: [
    buttonNode("node_add", "action_add"),
    buttonNode("node_edit", "action_edit"),
    buttonNode("node_remove", "action_remove"),
    buttonNode("node_invalid", "action_invalid")
  ]
});

describe("Sprint 3.5 real generated App list Action commits", () => {
  it("commits button-driven add, edit and delete to the F03 mutable store", async () => {
    const harness = await hydratedHarness(app());
    expect(harness.runtime.readState("items")).toEqual(["Milk"]);
    expect(press(harness, "node_add")).toMatchObject({ accepted: true });
    expect(harness.runtime.readState("items")).toEqual(["Milk", "Bread"]);
    expect(press(harness, "node_edit")).toMatchObject({ accepted: true });
    expect(harness.runtime.readState("items")).toEqual(["Oat milk", "Bread"]);
    expect(press(harness, "node_remove")).toMatchObject({ accepted: true });
    expect(harness.runtime.readState("items")).toEqual(["Oat milk"]);
    expect(harness.runtime.actionSequence).toBe(3);
    expect(harness.runtime.snapshotMutableState()).toEqual({ items: ["Oat milk"] });
  });

  it("does not partially mutate the list on an out-of-bounds user action", async () => {
    const harness = await hydratedHarness(app());
    const before = harness.runtime.snapshotMutableState();
    press(harness, "node_invalid");
    expect(harness.runtime.readState("items")).toEqual(before.items);
    expect(harness.runtime.actionSequence).toBe(0);
  });
});
