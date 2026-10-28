import {describe,it,expect} from "vitest";
import {QA_PLANNER_PROMPT} from "../../src/platform/qa/requirement-planner.js";
import {parseQaPlan} from "../../src/platform/qa/requirement-contract.js";
// Exactly ONE one-time paid model call on explicit staging-only marker.
// Logs SCHEMA PROPERTIES only; never logs source, keys or full model content.
describe("one-shot real unknown-idea acceptance plan diagnostic",()=>{
 it("produces parseable criteria traceable to prompt",async()=>{
  if(process.env.APPF2_QA_PLAN_DIAGNOSTIC!=="1")return; // no AI in normal CI
  const key=process.env.APPF2_MODEL_API_KEY;
  if(!key)throw Error("NO_KEY");
  const prompt="請建立一個可操作的任務便條 App，有文字輸入框、「新增任務」按鈕和任務清單。輸入「買牛奶」後按新增，清單要出現「買牛奶」；每一個任務可以按「完成」切換完成狀態。";
  const response=await fetch("https://api.openai.com/v1/chat/completions",{
   method:"POST",headers:{"Authorization":"Bearer "+key,"Content-Type":"application/json"},
   body:JSON.stringify({model:process.env.APPF2_MODEL_NAME||"gpt-4.1",temperature:0,
     max_completion_tokens:2500,response_format:{type:"json_object"},
     messages:[{role:"system",content:QA_PLANNER_PROMPT},{role:"user",content:prompt}]}),
   signal:AbortSignal.timeout(45000)
  });
  expect(response.ok,"UPSTREAM_HTTP_"+response.status).toBe(true);
  const result=await response.json() as {
    choices?:{finish_reason?:string;message?:{content?:string}}[];
    usage?:{prompt_tokens?:number;completion_tokens?:number}
  };
  const answer=result.choices?.[0];let parsed:unknown;
  try{parsed=JSON.parse(answer?.message?.content??"");}catch{parsed=null;}
  const record=typeof parsed==="object"&&parsed!==null?parsed as {version?:unknown;criteria?:unknown}:null;
  const criteria=Array.isArray(record?.criteria)?record.criteria as Record<string,unknown>[]:[];
  const findings=criteria.slice(0,20).map(c=>({
   idType:typeof c.id,quoteMatches:typeof c.source_quote==="string"&&prompt.includes(c.source_quote),
   automatable:c.automatable,stepsCount:Array.isArray(c.steps)?c.steps.length:-1,
   assertionKinds:Array.isArray(c.assertions)?c.assertions.map(x=>x?.kind):[],
   individuallyAccepted:parseQaPlan({version:"1",criteria:[c]},prompt)!==null
  }));
  const valid=parseQaPlan(parsed,prompt);
  console.log("INDEPENDENT_QA_PLAN_DIAGNOSTIC:"+JSON.stringify({
   finish:answer?.finish_reason,
   parsed:parsed!==null,version:record?.version,
   criteriaCount:criteria.length,allAutomatable:valid?.criteria.every(c=>c.automatable)??false,
   accepted:valid!==null,usage:result.usage,findings
  }));
  expect(answer?.finish_reason).toBe("stop");
  expect(valid).not.toBeNull();
  expect(valid?.criteria.every(c=>c.automatable)).toBe(true);
 },75000);
});
