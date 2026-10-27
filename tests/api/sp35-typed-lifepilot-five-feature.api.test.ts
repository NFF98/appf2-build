import { describe, expect, it } from "vitest";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import { parseCompositionPlan, lowerCompositionPlan } from "../../src/platform/compiler/typed-composition.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import { hydratedHarness } from "../runtime/runtime-fixtures.js";
import type { CoverageResult } from "../../src/platform/capabilities/coverage.js";
import type { JsonRecord } from "../contract/blueprint-validation-fixtures.js";

const rid = (n: number) => "sha256:" + n.toString(16).padStart(64, "0");
const selected = ["layout.container", "content.text", "content.list", "input.text",
  "input.number", "action.button", "data.stat"].map(id => {
  const c = CAPABILITY_REGISTRY_SOURCE.capabilities.find(def => def.id === id);
  if (!c) throw Error("Missing F04 component " + id);
  return { id, version: c.version };
});
const coverage: CoverageResult = {
  status: "FULLY_SUPPORTED", selected, registryVersion: CAPABILITY_REGISTRY_SOURCE.registryVersion,
  registryDigest: "sha256:" + "0".repeat(64), requirements: [], gaps: []
};
const modules = [
  {
    kind: "RECORD_LIST", key: "tasks", requirement_ids: [rid(1)],
    heading: "Smart Tasks", record_title_key: "title", record_done_key: "done",
    input_label: "Task name", add_label: "Add task", toggle_label: "Complete task",
    delete_label: "Delete task", total_label: "Tasks", completed_label: "Done today",
    max_items: 20, track_day: true
  },
  {
    kind: "TODAY_SUMMARY", key: "today", requirement_ids: [rid(2)],
    heading: "My Today", source_key: "tasks", total_label: "Total tasks", completed_label: "Done today"
  },
  {
    kind: "SHOPPING_LIST", key: "shopping", requirement_ids: [rid(3)],
    heading: "Shopping List", item_label: "Item", quantity_label: "Quantity",
    add_label: "Add item", bought_label: "Purchased", update_quantity_label: "Update quantity",
    total_label: "Total", outstanding_label: "Still to buy", max_items: 20
  },
  {
    kind: "BUDGET", key: "money", requirement_ids: [rid(4)],
    heading: "Money Snapshot", budget_label: "Weekly budget", expense_label: "Expense",
    add_expense_label: "Add expense", spent_label: "Spent", remaining_label: "Remaining",
    initial_budget: 200
  },
  {
    kind: "HABIT", key: "health", requirement_ids: [rid(5)],
    heading: "Healthy Habits", habit_label: "Walking",
    complete_label: "Mark habit complete", completed_label: "Habits completed"
  }
];
const ids = new Set([rid(1), rid(2), rid(3), rid(4), rid(5)]);
const day = "2026-10-27";

describe("Sprint 3.5 five-feature linked LifePilot F02/F03 end-to-end (deterministic, no model)", () => {
  it("all five real modules coexist and all mutations drive their linked derived results", async () => {
    const plan = parseCompositionPlan({ plan_version: "1.0.0", title: "LifePilot",
      modules } as never, ids, ids);
    const blueprint = lowerCompositionPlan(plan, { coverage, validRequirementIds: ids });
    const admission = validateBlueprintCandidate(new TextEncoder().encode(JSON.stringify(blueprint)));
    expect(admission.report.status).toBe("PASSED");
    expect(admission.report.issues).toEqual([]);
    const {runtime} = await hydratedHarness(blueprint as unknown as JsonRecord, {calendarDay: () => day});
    const fire = (node: string, name: string, payload: Record<string, string | number> = {}, index = 0) => {
      const key = runtime.nodeInstances().filter(x => x.key.node_id === node)[index]?.key;
      expect(key).toBeDefined();
      expect(runtime.dispatch({source_node_instance_key: key!, event_name: name,
        payload, origin: "USER"})).toMatchObject({accepted: true});
    };
    const metric = (id: string) => {
      const output = blueprint.result.outputs.find(x => x.id === id);
      expect(output).toBeDefined();
      return runtime.evaluateValue(output!.value);
    };
    // Smart Tasks and My Today share one mutable list, not mirrored display text.
    fire("node_m000_input", "change", {value: "Pay rent"});
    fire("node_m000_add", "press");
    expect(metric("result_m001_total")).toBe(1);
    expect(metric("result_m001_completed")).toBe(0);
    fire("node_m000_toggle", "press");
    expect(metric("result_m001_completed")).toBe(1);

    // Shopping supports row-specific quantity change and purchased state.
    fire("node_m002_input", "change", {value: "Milk"});
    fire("node_m002_add", "press");
    fire("node_m002_quantity", "change", {value: 5});
    fire("node_m002_update_quantity", "press");
    expect(runtime.readState("s_m002_rows")).toEqual([
      { title: "Milk", quantity: 5, purchased: false }
    ]);
    fire("node_m002_toggle", "press");
    expect(metric("result_m002_outstanding")).toBe(0);

    // Expense button commits a real transaction and recalculates the balance.
    fire("node_m003_expense_f00", "change", {value: 37});
    fire("node_m003_add_expense", "press");
    expect(metric("result_m003_spent")).toBe(37);
    expect(metric("result_m003_remaining")).toBe(163);

    // Habit is bound to the device-local calendar day.
    expect(metric("result_m004_completed")).toBe(0);
    fire("node_m004_complete", "press");
    expect(metric("result_m004_completed")).toBe(1);
    expect(metric("result_m001_completed")).toBe(1);
  });
  it("rejects forged cross-feature references before lowering", () => {
    const changed = modules.map(m => m.kind === "TODAY_SUMMARY"
      ? { ...m, source_key: "untrusted" } : m);
    expect(() => parseCompositionPlan({plan_version: "1.0.0",
      title: "bad", modules: changed} as never, ids, ids)).toThrow("PLAN_UNTRUSTED_REFERENCE");
  });
});
