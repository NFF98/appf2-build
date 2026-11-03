import { describe, expect, it } from "vitest";
import { resolveCapabilityCoverage, type CapabilityRequirement } from "../../src/platform/capabilities/coverage.js";
import { certifyCompositeCoverage } from "../../src/platform/capabilities/certified-composition.js";
import { isCertifiedPlanEligible } from "../../src/platform/compiler/compose-validate.js";
import { lowerCompositionPlan, parseCompositionPlan } from "../../src/platform/compiler/typed-composition.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import { hydratedHarness } from "../runtime/runtime-fixtures.js";
import type { JsonRecord } from "../contract/blueprint-validation-fixtures.js";

const rid = (n: number) => "sha256:" + n.toString(16).padStart(64, "0");
const requirement = (n: number, interaction_class: string, semantic_need: string,
  shape: { input_types?: string[]; output_types?: string[]; required?: boolean } = {}): CapabilityRequirement => ({
  requirement_id: rid(n), interaction_class, semantic_need,
  input_types: shape.input_types ?? [], output_types: shape.output_types ?? [],
  required: shape.required ?? true, impact_level: "HIGH", constraints: []
});
const original = [
  requirement(1, "button", "新增任務的按鈕"),
  requirement(2, "button", "刪除任務的按鈕"),
  requirement(3, "toggle", "切換任務完成狀態", {input_types:["BOOLEAN"],output_types:["BOOLEAN"]}),
  requirement(4, "text_input", "輸入任務名稱", {input_types:["STRING"],output_types:["STRING"]}),
  requirement(5, "metric", "顯示今天完成任務數量", {output_types:["NUMBER"]}),
  requirement(6, "repeated_content", "顯示任務及其狀態", {output_types:["LIST"],required:false})
];
const plan = {
  plan_version: "1.0.0" as const,
  title: "今日待辦",
  modules: [{
    kind:"RECORD_LIST" as const,key:"todos",requirement_ids:original.map(x=>x.requirement_id),
    heading:"待辦清單",record_title_key:"title",record_done_key:"done",input_label:"新增任務",
    add_label:"加入任務",toggle_label:"勾選完成",delete_label:"刪除",
    total_label:"總任務數",completed_label:"今日完成",max_items:10
  }]
};

describe("BD-026 real F02/F03 calendar-aware list integration, zero paid model requests",()=>{
  it("admits only a trusted F04 daily profile and counts by the recorded device-local completion day",async()=>{
    const covered=certifyCompositeCoverage(resolveCapabilityCoverage({requirements:original}),original);
    expect(covered.certifiedProfile).toBe("RECORD_LIST_TODAY");
    expect(isCertifiedPlanEligible(covered)).toBe(true);
    const parsed=parseCompositionPlan(plan as never,new Set(original.map(x=>x.requirement_id)),
      new Set(original.filter(x=>x.required).map(x=>x.requirement_id)));
    const bp=lowerCompositionPlan(parsed,{coverage:covered,
      validRequirementIds:new Set(original.map(x=>x.requirement_id))});
    const admitted=validateBlueprintCandidate(new TextEncoder().encode(JSON.stringify(bp)));
    expect(admitted.report.status).toBe("PASSED");
    expect(admitted.report.issues).toEqual([]);
    let today="2026-10-27";
    const harness=await hydratedHarness(bp as unknown as JsonRecord,{calendarDay:()=>today});
    const runtime=harness.runtime;
    const events=(node:string,event_name:string,payload:Record<string,string>={},index=0)=>{
      const key=runtime.nodeInstances().filter(x=>x.key.node_id===node)[index]?.key;
      expect(key).toBeDefined();
      expect(runtime.dispatch({source_node_instance_key:key!,event_name,payload,origin:"USER"})).toMatchObject({accepted:true});
    };
    const add=(value:string)=>{events("node_m000_input","change",{value});events("node_m000_add","press");};
    const mark=(index:number)=>events("node_m000_toggle","press",{},index);
    const remove=(index:number)=>events("node_m000_remove","press",{},index);
    const metric=bp.result.outputs.find(x=>x.id==="result_m000_completed");
    expect(metric?.label).toBe("今日完成");
    const count=()=>runtime.evaluateValue(metric!.value);
    add("A");add("B");add("C");
    expect(count()).toBe(0);
    mark(1);
    expect(count()).toBe(1);
    expect(runtime.readState("s_m000_rows")).toEqual([
      {title:"A",done:false,completed_day:""},
      {title:"B",done:true,completed_day:"2026-10-27"},
      {title:"C",done:false,completed_day:""}
    ]);
    today="2026-10-28";
    expect(count()).toBe(0);
    mark(2);
    expect(count()).toBe(1);
    mark(1); // uncomplete yesterday's B: removes stale completion date
    expect(count()).toBe(1);
    mark(1); // recomplete B today: new completion date is current, not yesterday
    expect(count()).toBe(2);
    remove(0);
    expect(runtime.readState("s_m000_rows")).toEqual([
      {title:"B",done:true,completed_day:"2026-10-28"},
      {title:"C",done:true,completed_day:"2026-10-28"}
    ]);
    expect(count()).toBe(2);
  });
});
