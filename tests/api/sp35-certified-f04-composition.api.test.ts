import { describe, expect, it } from "vitest";
import { resolveCapabilityCoverage, type CapabilityRequirement } from "../../src/platform/capabilities/coverage.js";
import { certifyCompositeCoverage } from "../../src/platform/capabilities/certified-composition.js";
import { isCertifiedPlanEligible } from "../../src/platform/compiler/compose-validate.js";
import { lowerCompositionPlan, parseCompositionPlan } from "../../src/platform/compiler/typed-composition.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import { hydratedHarness } from "../runtime/runtime-fixtures.js";
import type { JsonRecord } from "../contract/blueprint-validation-fixtures.js";

const id = (n: number) => "sha256:" + n.toString(16).padStart(64,"0");
const feature = (
  n: number, cls: string, semantic: string,
  shape: { inputs?: string[]; outputs?: string[]; required?: boolean } = {}
): CapabilityRequirement => ({
  requirement_id: id(n), interaction_class: cls, semantic_need: semantic,
  required: shape.required ?? true, input_types: shape.inputs ?? [], output_types: shape.outputs ?? [],
  impact_level: "HIGH", constraints: []
});
const features = [
  feature(1,"button","新增任務的按鈕"),feature(2,"button","刪除任務的按鈕"),
  feature(3,"toggle","切換任務完成狀態的勾選框",{inputs:["BOOLEAN"],outputs:["BOOLEAN"]}),
  feature(4,"text_input","用戶輸入新任務內容",{inputs:["STRING"],outputs:["STRING"]}),
  feature(5,"metric","顯示已完成任務數量",{outputs:["NUMBER"]}),
  feature(6,"repeated_content","顯示所有任務及其狀態",{outputs:["LIST"],required:false})
];
const plan = {
  plan_version: "1.0.0" as const, title: "Todo",
  modules: [{
    kind: "RECORD_LIST" as const, key: "tasks",
    requirement_ids: features.map(x=>x.requirement_id),
    heading: "待辦清單",record_title_key:"title",record_done_key:"done",
    input_label:"新增任務",add_label:"加入",toggle_label:"完成",delete_label:"刪除",
    total_label:"總數",completed_label:"已完成",max_items:15
  }]
};
describe("Sprint3.5 F04 certified role closure from six real F01 atomic hints",()=>{
  it("selects all six registered roles, enables typed path and admits generated F02/F03 App", async()=>{
    const base=resolveCapabilityCoverage({requirements:features});
    const certified=certifyCompositeCoverage(base,features);
    expect(certified.certifiedProfile).toBe("RECORD_LIST");
    expect(certified.status).toBe("FULLY_SUPPORTED");
    expect(isCertifiedPlanEligible(certified)).toBe(true);
    for(const id of ["layout.container","content.text","content.list","input.text","action.button","data.stat"]){
      expect(certified.selected.map(x=>x.id)).toContain(id);
    }
    const candidate=lowerCompositionPlan(
      parseCompositionPlan(plan as never,new Set(features.map(x=>x.requirement_id)),new Set(features.filter(x=>x.required).map(x=>x.requirement_id))),
      {coverage:certified,validRequirementIds:new Set(features.map(x=>x.requirement_id))}
    );
    const result=validateBlueprintCandidate(new TextEncoder().encode(JSON.stringify(candidate)));
    expect(result.report.status).toBe("PASSED");
    expect(result.report.issues).toEqual([]);
    const runtime=(await hydratedHarness(candidate as unknown as JsonRecord)).runtime;
    const fire=(node:string,payload:Record<string,string>={},index=0,evt="press")=>{
      const key=runtime.nodeInstances().filter(n=>n.key.node_id===node)[index]?.key;
      expect(key).toBeDefined();
      expect(runtime.dispatch({source_node_instance_key:key!,event_name:evt,payload,origin:"USER"})).toMatchObject({accepted:true});
    };
    for(const task of ["A","B","C"]){fire("node_m000_input",{value:task},0,"change");fire("node_m000_add");}
    fire("node_m000_toggle",{},1);
    fire("node_m000_remove");
    expect(runtime.readState("s_m000_rows")).toEqual([{title:"B",done:true},{title:"C",done:false}]);
  });

  it("replays exact real Prompt A variant: add=button, remove=action",()=>{
    const recorded=features.map(x=>x.interaction_class==="button" &&
      x.semantic_need.includes("刪除") ? {...x,interaction_class:"action",
        semantic_need:"刪除任務的操作按鈕"} : x);
    const certified=certifyCompositeCoverage(resolveCapabilityCoverage({requirements:recorded}),recorded);
    expect(certified.certifiedProfile).toBe("RECORD_LIST");
    expect(isCertifiedPlanEligible(certified)).toBe(true);
    expect(certified.selected.map(x=>x.id)).toContain("layout.container");
  });

  it("never silently reports today-only completion as an all-time counter",()=>{
    const time=features.map(x=>x.interaction_class==="metric"?{...x,semantic_need:"顯示今日完成任務數量"}:x);
    const coverage=certifyCompositeCoverage(resolveCapabilityCoverage({requirements:time}),time);
    expect(coverage.status).toBe("FULLY_SUPPORTED");
    expect(coverage.certifiedProfile).toBe("RECORD_LIST_TODAY");
    expect(isCertifiedPlanEligible(coverage)).toBe(true);
  });
  it("rejects arbitrary button+list hints and unknown extra feature",()=>{
    const base=resolveCapabilityCoverage({requirements:features});
    expect(certifyCompositeCoverage(base,[...features,feature(7,"external","Sync all users")]).certifiedProfile).toBeUndefined();
    expect(certifyCompositeCoverage(base,features.map(f=>f.interaction_class==="button"&&f.semantic_need.includes("刪除")?{...f,semantic_need:"分享任務"}:f)).certifiedProfile).toBeUndefined();
  });
  it("rejects incomplete model plans that omit an explicit required feature",()=>{
    expect(()=>parseCompositionPlan({...plan,modules:[{...plan.modules[0]!,requirement_ids:[features[0]!.requirement_id]}]} as never,
      new Set(features.map(x=>x.requirement_id)),new Set(features.filter(x=>x.required).map(x=>x.requirement_id)))).toThrow(/PLAN_UNTRUSTED_REFERENCE/);
  });
});
