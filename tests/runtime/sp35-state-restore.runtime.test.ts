import { describe, expect, it } from "vitest";
import { blueprintWith, hydratedHarness, lit, node } from "./runtime-fixtures.js";

const app = () => blueprintWith({
  state: {
    tasks: {
      mode: "MUTABLE", type: "LIST", initial: ["Original"],
      constraints: { item: { type: "STRING", constraints: { max_length: 80 } }, max_length: 10 }
    },
    weekly_budget: { mode: "MUTABLE", type: "NUMBER", initial: 10 }
  },
  nodes: [
    node("node_intro", "content.text", "1.0.0", {
      props: { role: lit("BODY") },
      bindings: { text: lit("My tasks") }
    })
  ]
});

describe("Sprint 3.5 verified generated app tab-state restoration", () => {
  it("hydrates a complete, typed browser snapshot only after admission", async () => {
    let loadedHash = "";
    const harness = await hydratedHarness(app(), {
      restoreState: (hash) => {
        loadedHash = hash;
        return { tasks: ["Buy milk", "Call dentist"], weekly_budget: 25 };
      }
    });
    expect(loadedHash).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(harness.runtime.readState("tasks")).toEqual(["Buy milk", "Call dentist"]);
    expect(harness.runtime.readState("weekly_budget")).toBe(25);
    expect(harness.runtime.snapshotMutableState()).toEqual({
      tasks: ["Buy milk", "Call dentist"], weekly_budget: 25
    });
  });

  it("refuses corrupt partial state and restores all signed Blueprint defaults", async () => {
    const harness = await hydratedHarness(app(), {
      restoreState: () => ({ tasks: ["Buy milk"], weekly_budget: "not a number" })
    });
    expect(harness.runtime.readState("tasks")).toEqual(["Original"]);
    expect(harness.runtime.readState("weekly_budget")).toBe(10);
  });

  it("never trusts extra persisted fields or over-capacity lists", async () => {
    for (const snapshot of [
      { tasks: ["changed"], weekly_budget: 12, extra: true },
      { tasks: Array(11).fill("bad"), weekly_budget: 12 }
    ]) {
      const harness = await hydratedHarness(app(), { restoreState: () => snapshot });
      expect(harness.runtime.readState("tasks")).toEqual(["Original"]);
      expect(harness.runtime.readState("weekly_budget")).toBe(10);
    }
  });

  it("uses safe defaults when browser storage fails", async () => {
    const harness = await hydratedHarness(app(), { restoreState: () => { throw Error("blocked"); } });
    expect(harness.runtime.readState("tasks")).toEqual(["Original"]);
    expect(harness.runtime.status).toBe("READY");
  });
});
