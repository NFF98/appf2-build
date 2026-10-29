import {QA_PLANNER_PROMPT} from "../../src/platform/qa/requirement-planner.js";
import {normalizeModelQaPlan} from "../../src/platform/qa/requirement-planner.js";
import {describe,it,expect} from "vitest";
import {parseQaPlan,summarizeQa} from "../../src/platform/qa/requirement-contract.js";
import {verifyAndRepair} from "../../src/platform/qa/repair-loop.js";
const prompt="創造一個可增加分數並切換排行頁面的新工具";
const criteria=[
 {id:"increase",source_quote:"增加分數",description:"實際加分",
  steps:[{action:"click",role:"button",name:"增加"}],
  assertions:[{kind:"text_includes",text:"得分：1"}],automatable:true},
 {id:"ranking",source_quote:"切換排行頁面",description:"切到排行",
  steps:[{action:"click",role:"tab",name:"排行"}],
  assertions:[{kind:"visible",role:"heading",name:"排行榜"}],automatable:true}
];
const plan=parseQaPlan({version:"1",criteria},prompt)!;
describe("universal independent acceptance (not dice-specific)",()=>{
 it("requires actual task completion evidence, not an unchecked human label",()=>{
  expect(QA_PLANNER_PROMPT).toContain("mark-task-complete");
  expect(QA_PLANNER_PROMPT).toContain("the mere continued presence of the Complete button is not evidence");
  expect(QA_PLANNER_PROMPT).toContain("automatable MUST be true");
 });
 it("normalizes AI-only criterion IDs without weakening any user requirement",()=>{
  const raw={version:"1",criteria:[{...criteria[0],id:"需求-一"},
    {...criteria[1],id:"REQ-2"}]};
  const parsed=normalizeModelQaPlan(raw,prompt);
  expect(parsed?.criteria.map(x=>x.id)).toEqual(["req_1","req_2"]);
  expect(parsed?.criteria.map(x=>x.source_quote)).toEqual(criteria.map(x=>x.source_quote));
  expect(normalizeModelQaPlan({version:"1",criteria:[{...raw.criteria[0],source_quote:"not in prompt"}]},prompt)).toBeNull();
 });
 it("binds every claim to original prompt, rejects no-evidence and duplicate claims",()=>{
  expect(plan).not.toBeNull();
  expect(parseQaPlan({version:"1",criteria:[{...criteria[0],source_quote:"not in user prompt"}]},prompt)).toBeNull();
  expect(parseQaPlan({version:"1",criteria:[criteria[0],criteria[0]]},prompt)).toBeNull();
  expect(summarizeQa(plan,[{id:"increase",verdict:"PASS",detail:"changed"}]).passed).toBe(false);
 });
 it("accepts unique unnamed textbox and list controls, never unnamed click actions",()=>{
  const c={...criteria[0],steps:[{action:"fill",role:"textbox",name:"",value:"買牛奶"}],
    assertions:[{kind:"visible",role:"list",name:""}]};
  expect(parseQaPlan({version:"1",criteria:[c]},prompt)).not.toBeNull();
  expect(parseQaPlan({version:"1",criteria:[{...c,steps:[{action:"click",role:"button",name:""}]}]},prompt)).toBeNull();
 });
 it("rejects unsafe pure calculation test injection before execution",()=>{
  const c={...criteria[0],assertions:[{kind:"pure_case",function_name:"__score",input:[[2,4,6]],expected:12}]};
  expect(parseQaPlan({version:"1",criteria:[c]},prompt)).not.toBeNull();
  expect(parseQaPlan({version:"1",criteria:[{...c,assertions:[{...c.assertions[0],function_name:"alert();"}]}]},prompt)).toBeNull();
 });
 it("only allows new-visible-text evidence following a real action",()=>{
  const c={...criteria[0],assertions:[{kind:"text_appears",text:"收藏數：1"}]};
  expect(parseQaPlan({version:"1",criteria:[c]},prompt)).not.toBeNull();
  expect(parseQaPlan({version:"1",criteria:[{...c,steps:[]}]},prompt)).toBeNull();
  expect(parseQaPlan({version:"1",criteria:[{...c,assertions:[{kind:"text_appears",text:""}]}]},prompt)).toBeNull();
 });
 it("passes only with evidence for ALL requested interactions",async()=>{
  const value=await verifyAndRepair({title:"novel",javascript:"good"},plan,
    async()=>criteria.map(x=>({id:x.id,verdict:"PASS" as const,detail:"browser observed"})));
  expect(value.status).toBe("VERIFIED");expect(value.attempts).toHaveLength(1);
 });
 it("repairs at most twice and keeps original acceptance contract",async()=>{
  let calls=0;let tests=0;
  const outcome=await verifyAndRepair({title:"x",javascript:"broken"},plan,
    async(draft)=>{tests++;return criteria.map(c=>({
      id:c.id,verdict:draft.javascript==="fixed"?"PASS" as const:"FAIL" as const,detail:"observed"
    }));},
    {maxRepairs:15,repair:async()=>{calls++;return {title:"x",javascript:calls===2?"fixed":"still_bad"};}});
  expect(outcome.status).toBe("VERIFIED");expect(calls).toBe(2);expect(tests).toBe(3);
 });
 it("fails closed on missing evidence, pending human decisions and broken runtime",async()=>{
  const untested={...plan,criteria:[{...plan.criteria[0],automatable:false}]};
  expect((await verifyAndRepair({title:"x",javascript:"x"},untested,async()=>[])).status).toBe("NEEDS_HUMAN");
  expect((await verifyAndRepair({title:"x",javascript:"x"},plan,async()=>{throw Error("browser crashed");})).status).toBe("NEEDS_HUMAN");
 });
});

describe("QA repair policy: evidence-driven progress, no endless re-tries",()=>{
 it("three ineffective revisions force re-interpretation, not an imaginary PASS",async()=>{
  const attempts:string[]=[];
  const original=JSON.stringify(plan);
  const result=await verifyAndRepair({title:"game",javascript:"v0"},plan,
   async()=>criteria.map(x=>({id:x.id,verdict:"FAIL" as const,detail:"same failure"})),
   {maxRepairs:12,repair:async(draft,_plan,_fail,n,reason)=>{
    attempts.push(reason??"");
    return {...draft,javascript:"v"+n};
   }});
  expect(result.status).toBe("NEEDS_REPLAN");
  expect(result.next_action).toBe("REINTERPRET_OR_CHANGE_APPROACH");
  expect(result.attempts).toHaveLength(4);
  expect(attempts).toEqual(["REPAIR","REPAIR","RETHINK"]);
  expect(JSON.stringify(plan)).toBe(original);
  expect(result.attempts.every(x=>!x.passed)).toBe(true);
 });
 it("independent observable progress prevents premature strategy switch",async()=>{
  let tried=0;
  const result=await verifyAndRepair({title:"x",javascript:"v0"},plan,
   async()=>{const n=tried++;return criteria.map((c,i)=>({
    id:c.id,verdict:n>=2||n===1&&i===0?"PASS" as const:"FAIL" as const,
    detail:"browser observation"
   }));},
   {maxRepairs:3,repair:async(draft,_p,_f,n)=>({...draft,javascript:"v"+n})});
  expect(result.status).toBe("VERIFIED");
  expect(result.attempts).toHaveLength(3);
 });
 it("budget refusal preserves draft and cannot secretly run another repair",async()=>{
  let repaired=0;
  const result=await verifyAndRepair({title:"x",javascript:"original"},plan,
   async()=>criteria.map(c=>({id:c.id,verdict:"FAIL" as const,detail:"broken"})),
   {maxRepairs:3,budgetAllowsRepair:()=>false,repair:async(draft)=>{
    repaired++;return draft;
   }});
  expect(result.status).toBe("PAUSED_BUDGET");
  expect(result.next_action).toBe("REQUEST_BUDGET");
  expect(result.draft.javascript).toBe("original");
  expect(result.attempts).toHaveLength(1);
  expect(repaired).toBe(0);
 });
 it("missing tests or an ambiguous original requirement can never be promoted",async()=>{
  const original={...plan,criteria:[{...plan.criteria[0],automatable:false}]};
  const result=await verifyAndRepair({title:"x",javascript:"x"},original,
   async()=>criteria.map(c=>({id:c.id,verdict:"PASS" as const,detail:"fake"})),
   {maxRepairs:3,repair:async()=>({title:"x",javascript:"y"})});
  expect(result.status).toBe("NEEDS_HUMAN");
  expect(result.next_action).toBe("HUMAN_REVIEW");
  expect(result.attempts).toHaveLength(1);
 });
});

describe("Independent QA evidence conflicts fail closed",()=>{
 it("cannot pass with duplicated PASS, unknown IDs or invalid verdicts",()=>{
  const correct=criteria.map(c=>({id:c.id,verdict:"PASS" as const,detail:"observed"}));
  expect(summarizeQa(plan,correct).passed).toBe(true);
  expect(summarizeQa(plan,[...correct,correct[0]]).passed).toBe(false);
  expect(summarizeQa(plan,[...correct,{
   id:"unrequested_feature",verdict:"PASS" as const,detail:"invented"
  }]).passed).toBe(false);
  expect(summarizeQa(plan,correct.map((x,i)=>i===0?
   {...x,verdict:"UNKNOWN" as "PASS"}:x)).passed).toBe(false);
 });
});
