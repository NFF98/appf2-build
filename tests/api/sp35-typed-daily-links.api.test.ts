import { describe, expect, it } from "vitest";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import { lowerCompositionPlan, parseCompositionPlan } from "../../src/platform/compiler/typed-composition.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import { hydratedHarness } from "../runtime/runtime-fixtures.js";
import type { CoverageResult } from "../../src/platform/capabilities/coverage.js";
import type { JsonRecord } from "../contract/blueprint-validation-fixtures.js";

const rid = (x: number) => "sha256:" + x.toString(16).padStart(64,"0");
const ids = ["layout.container", "content.text", "content.list", "input.text", "action.button", "data.stat"];
const selected=ids.map(id=>{const def=CAPABILITY_REGISTRY_SOURCE.capabilities.find(x=>x.id===id);
  if(!def)throw Error("missing "+id);return {id,version:def.version};});
const coverage:CoverageResult={status:"FULLY_SUPPORTED",selected,registryVersion:CAPABILITY_REGISTRY_SOURCE.registryVersion,
  registryDigest:"sha256:"+"0".repeat(64),requirements:[],gaps:[]};
const task = {kind:"RECORD_LIST",key:"tasks",requirement_ids:[rid(1)],
  heading:"Smart Tasks",record_title_key:"title",record_done_key:"done",input_label:"Add task",
  add_label:"Add task",toggle_label:"Complete task",delete_label:"Delete task",
  total_label:"Task count",completed_label:"Today completed",max_items:10,track_day:true};
const summary = {kind:"TODAY_SUMMARY",key:"today",source_key:"tasks",requirement_ids:[rid(2)],
  heading:"My Today",total_label:"Total tasks",completed_label:"Today completed"};
const habit = {kind:"HABIT",key:"walking",requirement_ids:[rid(3)],
  heading:"Healthy Habits",habit_label:"Walking",complete_label:"Mark habit complete",completed_label:"Habits completed"};
const idsSet=new Set([rid(1),rid(2),rid(3)]);
describe("Sprint 3.5 linked TODAY_SUMMARY and day-aware habit",()=>{
  it("F02 admits a real task-list link; completing the task updates both views",async()=>{
    const plan=parseCompositionPlan({plan_version:"1.0.0",title:"LifePilot",modules:[task,summary,habit]} as never,idsSet,idsSet);
    const app=lowerCompositionPlan(plan,{coverage,validRequirementIds:idsSet});
    const result=validateBlueprintCandidate(new TextEncoder().encode(JSON.stringify(app)));
    expect(result.report.issues).toEqual([]);
    expect(result.report.status).toBe("PASSED");
    const h=await hydratedHarness(app as unknown as JsonRecord, {calendarDay: () => "2026-10-27"});
    const dispatch=(node:string,event_name:string,payload:Record<string,string>={})=>{
      const instance=h.runtime.nodeInstances().find(n=>n.key.node_id===node);
      expect(instance).toBeDefined();
      return h.runtime.dispatch({source_node_instance_key:instance!.key,event_name,payload,origin:"USER"});
    };
    expect(dispatch("node_m000_input","change",{value:"Dentist"})).toMatchObject({accepted:true});
    expect(dispatch("node_m000_add","press")).toMatchObject({accepted:true});
    expect(dispatch("node_m000_toggle","press")).toMatchObject({accepted:true});
    expect(h.runtime.readState("s_m000_rows")).toHaveLength(1);
    expect(h.runtime.readState("s_m000_rows")).toMatchObject([{done:true}]);
    expect(dispatch("node_m002_complete","press")).toMatchObject({accepted:true});
    expect(typeof h.runtime.readState("s_m002_completed_day")).toBe("string");
  });
  it("rejects false My Today linkage without a genuine daily tracked source",()=>{
    const noDay={...task,track_day:false};
    expect(()=>parseCompositionPlan({plan_version:"1.0.0",title:"Wrong",modules:[noDay,summary]} as never,idsSet))
      .toThrow("PLAN_UNTRUSTED_REFERENCE");
  });
});
