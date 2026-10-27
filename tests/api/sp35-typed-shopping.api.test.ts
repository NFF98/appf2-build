import { describe, expect, it } from "vitest";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import { lowerCompositionPlan, parseCompositionPlan } from "../../src/platform/compiler/typed-composition.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import { hydratedHarness } from "../runtime/runtime-fixtures.js";
import type { CoverageResult } from "../../src/platform/capabilities/coverage.js";
import type { JsonRecord } from "../contract/blueprint-validation-fixtures.js";

const rid="sha256:"+"b".repeat(64);
const selected=["layout.container","content.text","content.list","input.text","input.number","action.button","data.stat"]
  .map(id=>{const v=CAPABILITY_REGISTRY_SOURCE.capabilities.find(x=>x.id===id);
    if(!v)throw Error("missing "+id);return{id,version:v.version};});
const coverage:CoverageResult={status:"FULLY_SUPPORTED",registryVersion:CAPABILITY_REGISTRY_SOURCE.registryVersion,
  registryDigest:"sha256:"+"0".repeat(64),selected,requirements:[],gaps:[]};
const module={kind:"SHOPPING_LIST",key:"groceries",requirement_ids:[rid],heading:"Shopping List",
  item_label:"Item name",quantity_label:"Quantity",add_label:"Add item",bought_label:"Purchased",
  update_quantity_label:"Update quantity",total_label:"All items",outstanding_label:"Still to buy",max_items:20};
describe("Sprint 3.5 trusted typed shopping rows",()=>{
  it("passes F02, edits exactly clicked row, toggles purchased and counts remaining",async()=>{
    const plan=parseCompositionPlan({plan_version:"1.0.0",title:"Shopping",modules:[module]} as never,new Set([rid]),new Set([rid]));
    const app=lowerCompositionPlan(plan,{coverage,validRequirementIds:new Set([rid])});
    const report=validateBlueprintCandidate(new TextEncoder().encode(JSON.stringify(app)));
    expect(report.report.issues).toEqual([]);
    const {runtime}=await hydratedHarness(app as unknown as JsonRecord);
    const fire=(id:string,event_name:string,payload:Record<string,string|number>={},index=0)=>{
      const key=runtime.nodeInstances().filter(n=>n.key.node_id===id)[index]?.key;
      expect(key).toBeDefined();
      return runtime.dispatch({source_node_instance_key:key!,event_name,payload,origin:"USER"});
    };
    for(const name of ["Milk","Bread"]){
      expect(fire("node_m000_input","change",{value:name})).toMatchObject({accepted:true});
      expect(fire("node_m000_add","press")).toMatchObject({accepted:true});
    }
    expect(fire("node_m000_quantity","change",{value:5})).toMatchObject({accepted:true});
    expect(fire("node_m000_update_quantity","press",{},1)).toMatchObject({accepted:true});
    expect(fire("node_m000_toggle","press",{},0)).toMatchObject({accepted:true});
    expect(runtime.readState("s_m000_rows")).toEqual([
      {title:"Milk",quantity:1,purchased:true},{title:"Bread",quantity:5,purchased:false}
    ]);
  });
});
