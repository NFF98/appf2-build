import { describe, expect, it } from "vitest";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import { lowerCompositionPlan, parseCompositionPlan } from "../../src/platform/compiler/typed-composition.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import { hydratedHarness } from "../runtime/runtime-fixtures.js";
import type { CoverageResult } from "../../src/platform/capabilities/coverage.js";
import type { JsonRecord } from "../contract/blueprint-validation-fixtures.js";

const rid = "sha256:" + "a".repeat(64);
const roles = ["layout.container", "content.text", "input.number", "action.button", "data.stat"]
  .map(id => {
    const def = CAPABILITY_REGISTRY_SOURCE.capabilities.find(c => c.id === id);
    if (!def) throw Error("Missing " + id);
    return {id,version:def.version};
  });
const coverage: CoverageResult = {status:"FULLY_SUPPORTED",
  registryVersion:CAPABILITY_REGISTRY_SOURCE.registryVersion,
  registryDigest:"sha256:"+"0".repeat(64),
  selected:roles,requirements:[],gaps:[]};
const module = {kind:"BUDGET",key:"money",requirement_ids:[rid],
  heading:"Money Snapshot",budget_label:"Weekly budget",expense_label:"Expense amount",
  add_expense_label:"Add expense",spent_label:"Spent",remaining_label:"Remaining",
  initial_budget:200};
describe("Sprint 3.5 typed interactive finance module",()=>{
  it("lowered F02 Blueprint runs two real inputs and commits expenses",async()=>{
    const plan = parseCompositionPlan({plan_version:"1.0.0",title:"Budget",
      modules:[module]} as never,new Set([rid]),new Set([rid]));
    const app = lowerCompositionPlan(plan,{coverage,validRequirementIds:new Set([rid])});
    const report = validateBlueprintCandidate(new TextEncoder().encode(JSON.stringify(app)));
    expect(report.report.issues).toEqual([]);
    expect(report.report.status).toBe("PASSED");
    const harness=await hydratedHarness(app as unknown as JsonRecord);
    const runtime=harness.runtime;
    const key=(node:string)=> {
      const result=runtime.nodeInstances().find(n=>n.key.node_id===node)?.key;
      expect(result).toBeDefined();
      return result!;
    };
    const dispatch=(node:string,name:string,value?:number)=>runtime.dispatch({
      source_node_instance_key:key(node),event_name:name,
      payload:value===undefined?{}:{value},origin:"USER"});
    expect(dispatch("node_m000_budget_f00","change",300)).toMatchObject({accepted:true});
    expect(dispatch("node_m000_expense_f00","change",37)).toMatchObject({accepted:true});
    expect(dispatch("node_m000_add_expense","press")).toMatchObject({accepted:true});
    expect(runtime.readState("s_m000_spent")).toBe(37);
    const output=runtime.snapshotMutableState();
    expect(Object.values(output)).toContain(37);
    expect(dispatch("node_m000_expense_f00","change",50)).toMatchObject({accepted:true});
    expect(dispatch("node_m000_add_expense","press")).toMatchObject({accepted:true});
    expect(runtime.readState("s_m000_spent")).toBe(87);
  });
  it("rejects negative or forged budget configuration",()=>{
    expect(()=>parseCompositionPlan({plan_version:"1.0.0",title:"bad",
      modules:[{...module,initial_budget:-5}]} as never,new Set([rid]))).toThrow("PLAN_SCHEMA_INVALID");
  });
});
