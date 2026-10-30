/**
 * PRIVATE independent Cloudflare Browser Run verifier. No public workers.dev
 * route, no model credentials, no script evaluation in the trusted Worker.
 * The browser receives only compiled files over a private Service Binding.
 */
import puppeteer from "@cloudflare/puppeteer";
import {validPrivateBrowserQaTask,strictQaChecks,observedBrowserEvidenceHash,
 type PrivateBrowserQaTask,type PrivateQaCheck}
 from "../../src/platform/agent/qa-browser-contract.js";
import {validBuiltAssetRequest,builtAssetContentType,MAX_BUILT_ASSET_BYTES}
 from "../../src/platform/agent/private-built-artifact.js";
import {sha256CodeBytes} from "../../src/platform/blueprint/code-artifact-v2.js";
import {sealAgentQaPacket} from "../../src/platform/agent/qa-packet.js";
import type {QaCriterion,QaAssertion,QaStep}
 from "../../src/platform/qa/requirement-contract.js";
const ORIGIN="https://appf2-qa-private.invalid";
const CAP=65536;
type Env={APPF2_QA_BROWSER:Fetcher;APPF2_SANDBOX_BROKER_SERVICE:Fetcher;
 APPF2_QA_PRIVATE_TOKEN:string;APPF2_SANDBOX_BROKER_TOKEN:string;
 APPF2_QA_VERIFIER_SECRET:string;APPF2_QA_BROWSER_PAID_CONSENT?:string};
type Page=Awaited<ReturnType<Awaited<ReturnType<typeof puppeteer.launch>>["newPage"]>>;
function reply(status:number,body:unknown):Response{
 return new Response(JSON.stringify(body),{status,headers:{
  "Content-Type":"application/json","Cache-Control":"private, no-store"}});
}
async function authorized(request:Request,token:string):Promise<boolean>{
 const supplied=request.headers.get("Authorization")??"";
 if(token.length<32||supplied.length!==token.length+7||
  !supplied.startsWith("Bearer "))return false;
 const [x,y]=await Promise.all([token,supplied.slice(7)].map(s=>
  crypto.subtle.digest("SHA-256",new TextEncoder().encode(s))));
 const a=new Uint8Array(x),b=new Uint8Array(y);let mismatches=0;
 for(let i=0;i<a.length;i++)mismatches|=a[i]^b[i];
 return mismatches===0;
}
function assetFrom(url:string):string|null{
 try{
  const u=new URL(url);
  if(u.origin!==ORIGIN||u.search||u.hash||u.username||u.password)return null;
  const name=u.pathname==="/"?"index.html":u.pathname.slice(1);
  return validBuiltAssetRequest({job_id:"ba45436c-c3f1-44f1-adc6-bdd0fb1592e7",
   project_hash:"sha256:"+"f".repeat(64),build_call_id:"call_build_123456",
   path:name})?name:null;
 }catch{return null;}
}
async function privateAsset(env:Env,task:PrivateBrowserQaTask,
 name:string):Promise<string>{
 const body={job_id:task.job_id,project_hash:task.project_hash,
  build_call_id:task.build_call_id,path:name};
 if(!validBuiltAssetRequest(body))throw Error("QA_ASSET_PATH_REJECTED");
 const response=await env.APPF2_SANDBOX_BROKER_SERVICE.fetch(
  new Request("https://appf2-sandbox-internal.invalid/internal/build-asset",{
   method:"POST",headers:{"Authorization":"Bearer "+env.APPF2_SANDBOX_BROKER_TOKEN,
    "Content-Type":"application/json"},body:JSON.stringify(body),
   redirect:"error",signal:AbortSignal.timeout(8000)}));
 if(response.status!==200)throw Error("QA_ASSET_NOT_PROVEN");
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes.length===0||bytes.length>MAX_BUILT_ASSET_BYTES)
  throw Error("QA_ASSET_SIZE_INVALID");
 return new TextDecoder("utf-8",{fatal:true}).decode(bytes);
}
function hooked(page:Page,env:Env,task:PrivateBrowserQaTask,
 used:Map<string,string>):Promise<void>{
 return page.setRequestInterception(true).then(()=>{
  page.on("request",request=>{
   void (async()=>{
    const name=request.method()==="GET"?assetFrom(request.url()):null;
    if(!name){await request.abort();return;}
    try{
     let body=used.get(name);
     if(body===undefined){
      body=await privateAsset(env,task,name);
      used.set(name,body);
     }
     await request.respond({status:200,body,contentType:builtAssetContentType(name),
      headers:{"Content-Security-Policy":
       "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; form-action 'none'; base-uri 'none'",
       "Access-Control-Allow-Origin":ORIGIN,"X-Content-Type-Options":"nosniff"}});
    }catch{await request.abort().catch(()=>undefined);}
   })().catch(()=>undefined);
  });
 });
}
const roles:Readonly<Record<string,string>>={
 button:'button,input[type="button"],input[type="submit"],[role="button"]',
 tab:'[role="tab"]',link:'a,[role="link"]',
 textbox:'textarea,input[type="text"],input:not([type]),[role="textbox"]',
 spinbutton:'input[type="number"],[role="spinbutton"]',
 heading:'h1,h2,h3,h4,h5,h6,[role="heading"]',
 list:'ul,ol,[role="list"]'
};
async function named(page:Page,role:string,name:string){
 const handles=await page.$$(roles[role]??"::-p-not-found");
 const matches=[];
 for(const handle of handles){
  const observation=await handle.evaluate(node=>{
   const el=node as HTMLElement;
   const label=(el.getAttribute("aria-label")??"").trim();
   const associated="labels" in el?
    Array.from((el as HTMLInputElement).labels??[]).map(l=>l.textContent??"").join(" "):"";
   const text=(label||associated||el.innerText||
    el.getAttribute("placeholder")||"").replace(/\s+/gu," ").trim();
   let visible=el.getClientRects().length>0;
   for(let ancestor:Element|null=el;ancestor&&visible;ancestor=ancestor.parentElement){
    const css=getComputedStyle(ancestor);
    if(css.display==="none"||css.visibility==="hidden"||
      css.visibility==="collapse"||Number(css.opacity)===0||
      ancestor.getAttribute("aria-hidden")==="true"||
      ancestor.hasAttribute("hidden"))visible=false;
   }
   return {text,visible};
  });
  // A hidden decoy must never be selected as a clickable QA control.
  if(observation.visible&&observation.text===name)matches.push(handle);
 }
 if(matches.length!==1)throw Error("QA_CONTROL_NOT_UNIQUE:"+role);
 return matches[0]!;
}
/** QA must assert rendered, user-visible text: textContent also includes
 * display:none, hidden, script and template nodes, causing false PASS.
 */
async function bodyText(page:Page):Promise<string>{
 return page.$eval("body",el=>(el as HTMLElement).innerText??"");
}
async function applyStep(page:Page,s:QaStep):Promise<void>{
 const h=await named(page,s.role,s.name);
 if(s.action==="click")await h.click();
 else {await h.click({clickCount:3});await h.type(s.value);}
}
async function assertion(page:Page,a:QaAssertion,before:string,
 old:Map<string,string>):Promise<boolean>{
 if(a.kind==="text_includes")return (await bodyText(page)).includes(a.text);
 if(a.kind==="text_appears")
  return !before.includes(a.text)&&(await bodyText(page)).includes(a.text);
 if(a.kind==="visible"){
  const handle=await named(page,a.role,a.name);
  const shown=await handle.evaluate(el=>{
   for(let node:Element|null=el;node;node=node.parentElement){
    const style=getComputedStyle(node);
    if(style.display==="none"||style.visibility==="hidden"||
      style.visibility==="collapse"||Number(style.opacity)===0||
      node.getAttribute("aria-hidden")==="true"||node.hasAttribute("hidden"))
     return false;
   }
   return el.getClientRects().length>0;
  });
  return shown&&await handle.isIntersectingViewport();
 }
 if(a.kind==="element_count")return (await page.$$(a.selector)).length===a.count;
 if(a.kind==="text_changes")
  return old.get(a.selector)!==(await page.$eval(a.selector,e=>e.textContent??""));
 if(a.kind==="pure_case"){
  const value=await page.evaluate(q=>{
   const fn=(globalThis as unknown as Record<string,unknown>)[q.function_name];
   return typeof fn==="function"?(fn as (...p:unknown[])=>unknown)(...q.input):null;
  },a);
  const selected=a.result_path?value!==null&&typeof value==="object"?
   (value as Record<string,unknown>)[a.result_path]:null:value;
  return JSON.stringify(selected)===JSON.stringify(a.expected);
 }
 return false;
}
async function criterion(browser:Awaited<ReturnType<typeof puppeteer.launch>>,
 env:Env,task:PrivateBrowserQaTask,c:QaCriterion,used:Map<string,string>)
 :Promise<PrivateQaCheck>{
 if(!c.automatable)return {criterion_id:c.id,category:"BROWSER",
  verdict:"UNTESTED",evidence_hash:null};
 const page=await browser.newPage();let crashes=0;
 page.on("pageerror",()=>{crashes++;});
 try{
  await hooked(page,env,task,used);
  await page.goto(ORIGIN+"/",{waitUntil:"domcontentloaded",timeout:8000});
  const before=await bodyText(page),old=new Map<string,string>();
  for(const a of c.assertions)if(a.kind==="text_changes")
   old.set(a.selector,await page.$eval(a.selector,e=>e.textContent??""));
  for(const s of c.steps)await applyStep(page,s);
  if(crashes>0)throw Error("QA_PAGE_EXCEPTION");
  for(const a of c.assertions)
   if(!(await assertion(page,a,before,old)))throw Error("QA_ASSERTION_FAILED");
  const after=await bodyText(page);
  if(crashes>0)throw Error("QA_PAGE_EXCEPTION");
  return {criterion_id:c.id,category:"BROWSER",verdict:"PASS",
   evidence_hash:await observedBrowserEvidenceHash(task,c.id,before,after,
    [...used.keys()])};
 }catch{
  return {criterion_id:c.id,category:"BROWSER",verdict:"FAIL",evidence_hash:null};
 }finally{await page.close().catch(()=>undefined);}
}
async function verify(env:Env,task:PrivateBrowserQaTask){
 const used=new Map<string,string>(),checks:PrivateQaCheck[]=[];
 const browser=await puppeteer.launch(env.APPF2_QA_BROWSER,{
  guardrails:{allowedDomains:[]}
 });
 try{
  for(const c of task.original_plan.criteria)
   checks.push(await criterion(browser,env,task,c,used));
 }finally{await browser.close();}
 if(!strictQaChecks(task.original_plan,checks))
  return {ready_for_review:false,checks,packet:null,app_published:false};
 const files=Array.from(used.entries()).sort(([a],[b])=>a.localeCompare(b));
 if(!files.some(([p])=>p==="index.html"))
  throw Error("QA_MAIN_DOCUMENT_NOT_VERIFIED");
 const artifact=await sha256CodeBytes(new TextEncoder().encode(JSON.stringify(files)));
 const packet=await sealAgentQaPacket({
  version:"APPF2_AGENT_QA_PACKET_V1",job_id:task.job_id,
  original_prompt:task.original_prompt,original_plan:task.original_plan,
  receipt:{version:"APPF2_CANDIDATE_QA_V1",
   source_project_hash:task.project_hash,built_artifact_hash:artifact,
   sandbox_execution_id:task.test_call_id,checks,runner_attestation:null}
 },env.APPF2_QA_VERIFIER_SECRET);
 return {ready_for_review:true,checks,packet,app_published:false};
}
export default {
 // eslint-disable-next-line complexity -- Private paid browser, request and provenance gates.
 async fetch(request:Request,env:Env):Promise<Response>{
  if(new URL(request.url).pathname!=="/internal/verify-built-app"||
   request.method!=="POST"||new URL(request.url).search)
   return new Response("Not Found",{status:404});
  if(env.APPF2_QA_BROWSER_PAID_CONSENT!=="OWNER_APPROVED_ONE_SHOT"||
   !(await authorized(request,env.APPF2_QA_PRIVATE_TOKEN))||
   env.APPF2_QA_VERIFIER_SECRET?.length<32||
   env.APPF2_SANDBOX_BROKER_TOKEN?.length<32)
   return new Response("Not Found",{status:404});
  if(Number(request.headers.get("Content-Length")??0)>CAP)
   return reply(413,{error:"QA_INPUT_TOO_LARGE"});
  const raw=await request.text();
  if(raw.length>CAP)return reply(413,{error:"QA_INPUT_TOO_LARGE"});
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{return reply(400,{error:"QA_BAD_JSON"});}
  if(!validPrivateBrowserQaTask(parsed))return reply(400,{error:"QA_INVALID_INPUT"});
  try{return reply(200,{data:await verify(env,parsed)});}
  catch{return reply(503,{error:"QA_UNAVAILABLE_NO_RETRY"});}
 }
} satisfies ExportedHandler<Env>;
