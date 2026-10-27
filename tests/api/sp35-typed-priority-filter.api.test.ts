import { describe, expect, it } from "vitest";
import COMPOSITION_PLAN_SCHEMA from "../../src/platform/compiler/composition-plan-v1.schema.json";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import { computeRegistryDigest } from "../../src/platform/capabilities/generate-registry.js";
import { certifyTypedModuleRoles, lowerCompositionPlan, parseCompositionPlan } from "../../src/platform/compiler/typed-composition.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import type { CoverageResult } from "../../src/platform/capabilities/coverage.js";
import { hydratedHarness } from "../runtime/runtime-fixtures.js";
import type { JsonRecord } from "../contract/blueprint-validation-fixtures.js";

const rid = "sha256:" + "c".repeat(64);
const registry = CAPABILITY_REGISTRY_SOURCE;
const refs = ["input.text","action.button","content.list","data.stat","input.select"]
  .map(id => { const def = registry.capabilities.find(x=>x.id===id);
    if (!def) throw Error("Missing F04 registered role "+id);
    return {id,version:def.version};
  });
const coverage: CoverageResult = {status:"FULLY_SUPPORTED",selected:refs,
  registryVersion:registry.registryVersion,
  registryDigest:computeRegistryDigest(registry),requirements:[],gaps:[]};
const module = {kind:"RECORD_LIST",key:"tasks",requirement_ids:[rid],
  heading:"Smart Tasks",record_title_key:"title",record_done_key:"done",
  input_label:"Task name",add_label:"Add task",toggle_label:"Complete task",
  delete_label:"Delete task",total_label:"Task count",
  completed_label:"Today done",max_items:18,track_day:true,priority_filter:true};
describe("Sprint 3.5 priority filter preserves original list index safety",()=>{
  it("independently passes F02 and edits the unfiltered original row",async()=>{
    // The provider schema must advertise optional priority_filter, not merely
    // let an internal parser accept it.
    expect(module.priority_filter).toBe(true);
    expect(JSON.stringify(COMPOSITION_PLAN_SCHEMA)).toContain('"priority_filter"');
    const plan=parseCompositionPlan({plan_version:"1.0.0",
      title:"Smart Tasks",modules:[module]} as never,new Set([rid]),new Set([rid]));
    const closed=certifyTypedModuleRoles(coverage,plan);
    const blueprint=lowerCompositionPlan(plan,{coverage:closed,validRequirementIds:new Set([rid])});
    const report=validateBlueprintCandidate(new TextEncoder().encode(JSON.stringify(blueprint)));
    expect(report.report.issues).toEqual([]);
    expect(report.report.status).toBe("PASSED");
    const {runtime}=await hydratedHarness(blueprint as unknown as JsonRecord,{calendarDay:()=>"2026-10-27"});
    const fire=(id:string,evt:string,payload:Record<string,string>={},index=0)=>{
      const key=runtime.nodeInstances().filter(n=>n.key.node_id===id)[index]?.key;
      expect(key).toBeDefined();
      return runtime.dispatch({source_node_instance_key:key!,event_name:evt,payload,origin:"USER"});
    };
    fire("node_m000_input","change",{value:"A"});
    fire("node_m000_add","press");
    fire("node_m000_priority","change",{value:"High"});
    fire("node_m000_input","change",{value:"B"});
    fire("node_m000_add","press");
    expect(runtime.readState("s_m000_rows")).toMatchObject([{title:"A"},{title:"B",priority:"High"}]);
    fire("node_m000_filter","change",{value:"High"});
    expect(runtime.readState("s_m000_filter_priority")).toBe("High");
    expect(runtime.readState("s_m000_rows")).toHaveLength(2);
    // Filtering must never cause a computed list index to target the wrong
    // mutable row: complete the SECOND original task after selecting High.
    expect(fire("node_m000_toggle","press",{},1)).toMatchObject({accepted:true});
    expect(runtime.readState("s_m000_rows")).toMatchObject([
      {title:"A",done:false},{title:"B",done:true,priority:"High"}
    ]);
  });
});
