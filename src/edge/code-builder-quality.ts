/**
 * Staging online gate: original prompt -> frozen independent plan -> code ->
 * isolated Chromium -> optional bounded repair. No hash-only "quality PASS".
 * All model/browser failures are fail-closed; caller never publishes drafts.
 */
import puppeteer from "@cloudflare/puppeteer";
import type {Appf2WorkerEnv} from "./worker-composition.js";
import {appf2ModelProviderConfig} from "../platform/compiler/appf2-model-provider.js";
import {QA_PLANNER_PROMPT,normalizeModelQaPlan} from "../platform/qa/requirement-planner.js";
import {type QaPlan,type QaEvidence,type QaCriterion} from "../platform/qa/requirement-contract.js";
import {verifyAndRepair,type QaDraft} from "../platform/qa/repair-loop.js";
import {codeBuilderModelRequest} from "./code-builder-generation-contract.js";

const FAILCLOSED_ERROR="QA_UNAVAILABLE_OR_UNVERIFIED";
function safeInput(s:string):string{return s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll('"',"&quot;");}
const template=async(javascript:string)=>{
 const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(javascript)));
 const hash=btoa(String.fromCharCode(...digest));
 const csp=["default-src 'none'","script-src 'sha256-"+hash+"'","script-src-attr 'none'",
  "style-src 'unsafe-inline'","img-src data:","connect-src 'none'","font-src 'none'",
  "worker-src 'none'","frame-src 'none'","form-action 'none'"].join("; ");
 const doc='<!doctype html><html><head><meta charset="utf-8">'+
   '<meta http-equiv="Content-Security-Policy" content="'+safeInput(csp)+'"></head>'+
   '<body><main id="app"></main><script>'+javascript+'</script></body></html>';
 return '<!doctype html><html><body><iframe name="candidate" sandbox="allow-scripts" '+
   'referrerpolicy="no-referrer" srcdoc="'+safeInput(doc)+'"></iframe></body></html>';
};
/** Return primitive evidence from real DOM, never a model-authored assertion. */
async function checkCriterion(browser:Awaited<ReturnType<typeof puppeteer.launch>>,
 source:string,criterion:QaCriterion):Promise<QaEvidence>{
 if(!criterion.automatable)return {id:criterion.id,verdict:"UNTESTED",detail:"HUMAN_REVIEW_REQUIRED"};
 const page=await browser.newPage();
 try{
  await page.setRequestInterception(true);
  page.on("request",request=>{void request.abort().catch(()=>undefined);});
  await page.setContent(await template(source),{waitUntil:"domcontentloaded",timeout:6000});
  let frame=page.frames().find(f=>f.name()==="candidate");
  for(let n=0;!frame&&n<12;n++){await new Promise(r=>setTimeout(r,100));frame=page.frames().find(f=>f.name()==="candidate");}
  if(!frame)throw Error("QA_SANDBOX_FRAME_MISSING");
  // eslint-disable-next-line complexity -- Independent UI assertion variants are all fail-closed.
  const result=await frame.evaluate(async test=>{
   const root=document.getElementById("app");
   if(!root)return {ok:false,detail:"MISSING_APP_ROOT"};
   const find=(role:string,name:string):Element|null=>{
    const allowed=role==="button"?["button",'[role="button"]']:
     role==="tab"?['[role="tab"]',"button"]:
     role==="link"?["a"]:role==="textbox"?["input","textarea"]:
     role==="heading"?["h1","h2","h3","h4"]:["input"];
    return Array.from(document.querySelectorAll(allowed.join(","))).find(el=>{
     const explicit=el.getAttribute("aria-label");
     const describedBy=el.getAttribute("aria-labelledby");
     const referenced=describedBy?describedBy.split(/\\s+/u).map(id=>document.getElementById(id)?.textContent??"").join(" "):"";
     const labels=el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement?
       Array.from(el.labels??[]).map(x=>x.textContent??"").join(" "):"";
     const candidate=(explicit||referenced||labels||el.getAttribute("placeholder")||el.textContent||"").trim();
     return candidate===name;
    })??null;
   };
   const before=new Map<string,string>();
   for(const a of test.assertions)if(a.kind==="text_changes")
    before.set(a.selector,document.querySelector(a.selector)?.textContent??"");
   for(const step of test.steps){
    const el=find(step.role,step.name);
    if(!el)return {ok:false,detail:"MISSING_CONTROL:"+step.name};
    if(step.action==="click")(el as HTMLElement).click();
    else if(step.action==="fill"){
     const input=el as HTMLInputElement;input.value=step.value;
     input.dispatchEvent(new Event("input",{bubbles:true}));
     input.dispatchEvent(new Event("change",{bubbles:true}));
    }
    await new Promise(resolve=>setTimeout(resolve,30));
   }
   for(const a of test.assertions){
    let pass=false;
    if(a.kind==="visible"){const el=find(a.role,a.name);pass=!!el&&(el as HTMLElement).getClientRects().length>0;}
    if(a.kind==="text_includes")pass=(root.textContent??"").includes(a.text);
    if(a.kind==="element_count")pass=root.querySelectorAll(a.selector).length===a.count;
    if(a.kind==="text_changes")pass=(root.querySelector(a.selector)?.textContent??"")!==before.get(a.selector);
    if(a.kind==="pure_case"){
     const fn=(window as unknown as Record<string,unknown>)[a.function_name];
     if(typeof fn==="function"){
      const value=(fn as (...args:unknown[])=>unknown)(...a.input);
      const actual=a.result_path? (value as Record<string,unknown>|null)?.[a.result_path]:value;
      pass=JSON.stringify(actual)===JSON.stringify(a.expected);
     }
    }
    if(!pass)return {ok:false,detail:"ASSERTION_FAILED:"+a.kind};
   }
   return {ok:true,detail:"BROWSER_OBSERVED"};
  },criterion);
  return {id:criterion.id,verdict:result.ok?"PASS":"FAIL",detail:result.detail};
 }catch{return {id:criterion.id,verdict:"FAIL",detail:"BROWSER_TEST_CRASH"};}
 finally{await page.close().catch(()=>undefined);}
}
export async function browserVerifyCode(env:Appf2WorkerEnv,draft:QaDraft,plan:QaPlan):Promise<readonly QaEvidence[]>{
 if(!env.APPF2_QA_BROWSER)throw Error(FAILCLOSED_ERROR);
 const browser=await puppeteer.launch(env.APPF2_QA_BROWSER as Parameters<typeof puppeteer.launch>[0]);
 try{
  const out:QaEvidence[]=[];
  for(const criterion of plan.criteria)out.push(await checkCriterion(browser,draft.javascript,criterion));
  return out;
 }finally{await browser.close().catch(()=>undefined);}
}
type CompletionMessage={role:"system"|"user";content:string};
async function modelJson(env:Appf2WorkerEnv,messages:CompletionMessage[],tokens:number):Promise<unknown>{
 const config=appf2ModelProviderConfig({
  APPF2_MODEL_BASE_URL:env.APPF2_MODEL_BASE_URL,APPF2_MODEL_API_KEY:env.APPF2_MODEL_API_KEY,
  APPF2_MODEL_NAME:env.APPF2_MODEL_NAME,APPF2_MODEL_PROVIDER:env.APPF2_MODEL_PROVIDER,
  APPF2_XAI_API_KEY:env.APPF2_XAI_API_KEY,APPF2_XAI_MODEL_NAME:env.APPF2_XAI_MODEL_NAME,
  APPF2_DEEPSEEK_API_KEY:env.APPF2_DEEPSEEK_API_KEY,APPF2_DEEPSEEK_MODEL_NAME:env.APPF2_DEEPSEEK_MODEL_NAME
 }).config;
 const response=await fetch(config.baseUrl+"/chat/completions",{
  method:"POST",headers:{Authorization:"Bearer "+config.apiKey,"Content-Type":"application/json"},
  body:JSON.stringify({model:config.model,temperature:0,max_completion_tokens:tokens,
   response_format:{type:"json_object"},messages}),signal:AbortSignal.timeout(45000)
 });
 if(!response.ok)throw Error("QA_MODEL_UNAVAILABLE");
 const data:unknown=await response.json();
 if(typeof data!=="object"||data===null)return null;
 const choices=(data as {choices?:unknown}).choices;
 if(!Array.isArray(choices)||!choices[0])return null;
 const choice=choices[0] as {finish_reason?:string;message?:{content?:unknown}};
 if(choice.finish_reason!=="stop"||typeof choice.message?.content!=="string")return null;
 try{return JSON.parse(choice.message.content) as unknown;}catch{return null;}
}
export async function generateQaPlan(env:Appf2WorkerEnv,prompt:string):Promise<QaPlan|null>{
 const raw=await modelJson(env,[{role:"system",content:QA_PLANNER_PROMPT},{role:"user",content:prompt}],2500);
 const plan=normalizeModelQaPlan(raw,prompt);
 if(!plan||plan.criteria.length===0)throw Error("QA_PLAN_SCHEMA_REJECTED");
 if(plan.criteria.some(c=>!c.automatable))throw Error("QA_PLAN_REQUIRES_HUMAN_REVIEW");
 return plan;
}
export async function repairQaCode(env:Appf2WorkerEnv,draft:QaDraft,plan:QaPlan,
 evidence:readonly QaEvidence[],attempt:number):Promise<QaDraft|null>{
 const messages=codeBuilderModelRequest("model","repair").messages;
 const policy=messages[0]?.content??"";
 const payload=JSON.stringify({attempt,plan,evidence,source:draft.javascript});
 if(payload.length>40000)return null;
 const result=await modelJson(env,[{role:"system",content:policy+" Fix failed independent QA. Respond only with {title,javascript}."},
  {role:"user",content:payload}],8000);
 if(!result||typeof result!=="object"||Array.isArray(result))return null;
 const item=result as Record<string,unknown>;
 if(typeof item.title!=="string"||typeof item.javascript!=="string"||item.javascript.length>128*1024)return null;
 return {title:item.title,javascript:item.javascript};
}
export async function qualityGateCode(env:Appf2WorkerEnv,prompt:string,initial:QaDraft,
 allowRepair:boolean,plan:QaPlan):Promise<QaDraft|null>{
 const outcome=await verifyAndRepair(initial,plan,
  (draft,acceptance)=>browserVerifyCode(env,draft,acceptance),{
   maxRepairs:allowRepair?2:0,
   repair:allowRepair?(draft,acceptance,failed,attempt)=>repairQaCode(env,draft,acceptance,failed,attempt):undefined
  });
 return outcome.status==="VERIFIED"?outcome.draft:null;
}
