import { describe, expect, it } from "vitest";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import { computeRegistryDigest } from "../../src/platform/capabilities/generate-registry.js";
import { certifyTypedModuleRoles } from "../../src/platform/compiler/typed-composition.js";
import type { CoverageResult } from "../../src/platform/capabilities/coverage.js";
import type { CompositionPlan } from "../../src/platform/compiler/typed-composition.js";

const source = CAPABILITY_REGISTRY_SOURCE;
const roles = ["input.text", "action.button", "data.stat", "content.list", "input.number"];
const selected = roles.map(id => {
  const definition = source.capabilities.find(def => def.id === id);
  if (!definition) throw Error("Missing supported role: " + id);
  return { id, version: definition.version };
});
const coverage: CoverageResult = {
  status: "FULLY_SUPPORTED", selected, gaps: [], requirements: [],
  registryVersion: source.registryVersion,
  registryDigest: computeRegistryDigest(source)
};
const rid = "sha256:" + "0".repeat(64);
const plan: CompositionPlan = { plan_version:"1.0.0",title:"LifePilot",modules:[
  { kind:"RECORD_LIST",key:"tasks",requirement_ids:[rid],
    heading:"Smart Tasks",record_title_key:"title",record_done_key:"done",input_label:"Task",
    add_label:"Add task",toggle_label:"Done",delete_label:"Delete",
    total_label:"Total",completed_label:"Completed",max_items:18 },
  {kind:"SHOPPING_LIST",key:"shopping",requirement_ids:[rid],
    heading:"Shopping List",item_label:"Item",quantity_label:"Qty",add_label:"Add item",
    bought_label:"Purchased",update_quantity_label:"Update quantity",
    total_label:"Total",outstanding_label:"Remaining",max_items:18},
  {kind:"BUDGET",key:"budget",requirement_ids:[rid],heading:"Money Snapshot",
    budget_label:"Budget",expense_label:"Expense",add_expense_label:"Add expense",
    spent_label:"Spent",remaining_label:"Remaining",initial_budget:200}
]};
describe("Sprint 3.5 F04 typed module role admission",()=>{
  it("admits exact active layout/heading roles only through the canonical resolver",()=>{
    const closed=certifyTypedModuleRoles(coverage,plan);
    expect(closed.selected.map(ref=>ref.id)).toEqual(expect.arrayContaining([
      "layout.container","content.text","content.list","input.text","input.number",
      "action.button","data.stat"
    ]));
    expect(closed.selected.some(ref=>ref.id==="media.video")).toBe(false);
    expect(coverage.selected.map(ref=>ref.id)).not.toContain("layout.container");
    expect(closed.status).toBe(coverage.status);
    expect(closed.requirements).toEqual(coverage.requirements);
  });
  it("never authorizes roles for incompatible, gapped or spoofed registry coverage",()=>{
    expect(()=>certifyTypedModuleRoles({...coverage,status:"PARTIALLY_SUPPORTED"},plan))
      .toThrow("COMPOSITION_UNSUPPORTED");
    expect(()=>certifyTypedModuleRoles({...coverage,gaps:[{
      requirementId:rid,description:"missing",evidenceCode:"MISSING"
    }]},plan)).toThrow("COMPOSITION_UNSUPPORTED");
    expect(()=>certifyTypedModuleRoles({...coverage,registryDigest:"bad"},plan))
      .toThrow("COMPOSITION_UNSUPPORTED");
  });
});
