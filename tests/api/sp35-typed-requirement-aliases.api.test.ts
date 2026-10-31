import { describe, expect, it } from "vitest";
import { aliasResolvedRequirements, restorePlanRequirementIds } from "../../src/platform/compiler/typed-requirement-aliases.js";
import { parseCompositionPlan } from "../../src/platform/compiler/typed-composition.js";
import type { ResolvedIntent } from "../../src/platform/intent/resolved-intent.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";

const reqs = Array.from({length:27},(_,i)=>({
  requirement_id:"sha256:"+(i+1).toString(16).padStart(64,"0"),
  semantic_need:"Required feature "+(i+1),required:true
}));
const resolved={capability_requirements:reqs,goal:"LifePilot",accepted_assumptions:[]} as unknown as ResolvedIntent;
const first={kind:"DISPLAY",key:"one",heading:"Overview",body:"Hello",
  requirement_ids:Array.from({length:12},(_,i)=>"req_"+(i+1))};
const second={...first,key:"two",
  requirement_ids:Array.from({length:12},(_,i)=>"req_"+(i+13))};
const third={...first,key:"three",requirement_ids:["req_25","req_26","req_27"]};
describe("Sprint3.5 immutable short requirement aliases",()=>{
  it("replaces only the model-facing IDs, restores every original and passes strict reference coverage",()=>{
    const presented=aliasResolvedRequirements(resolved);
    const shown=presented.capability_requirements as Array<{requirement_id:string}>;
    expect(shown).toHaveLength(27);
    expect(shown[0]?.requirement_id).toBe("req_1");
    expect(shown[26]?.requirement_id).toBe("req_27");
    expect(resolved.capability_requirements[0]?.requirement_id).toMatch(/^sha256:/);
    const plan={plan_version:"1.0.0",title:"LifePilot",modules:[first,second,third]};
    const restored=restorePlanRequirementIds(plan as JsonValue,resolved.capability_requirements);
    const hashes=new Set(reqs.map(x=>x.requirement_id));
    expect(parseCompositionPlan(restored,hashes,hashes).modules).toHaveLength(3);
  });
  it("leaves missing, duplicate or fabricated IDs invalid rather than filling them",()=>{
    const hashes=new Set(reqs.map(x=>x.requirement_id));
    const plan={plan_version:"1.0.0",title:"LifePilot",modules:[
      first,second,{...third,requirement_ids:["req_25","req_26","req_999"]}
    ]};
    const restored=restorePlanRequirementIds(plan as JsonValue,resolved.capability_requirements);
    expect(()=>parseCompositionPlan(restored,hashes,hashes)).toThrow();
    const missing=restorePlanRequirementIds({plan_version:"1.0.0",title:"LifePilot",
      modules:[first,second]} as JsonValue,resolved.capability_requirements);
    expect(()=>parseCompositionPlan(missing,hashes,hashes)).toThrow("PLAN_UNTRUSTED_REFERENCE");
  });
});
