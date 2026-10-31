/* eslint-disable max-depth -- Frozen independent QA cases require bounded nested fail-closed per-case execution. */
/**
 * Triggered from a creator-P256 signed Worker dispatch. GitHub receives only
 * a 30-minute encrypted ticket; never source/prompt/DB credential. Runner
 * obtains GitHub OIDC and Worker verifies signature, repository and workflow.
 * Untrusted source may ONLY compile in network-denied Docker and then render
 * in a browser with third-party network requests blocked. No publishing.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {spawnSync} from "node:child_process";
import {createHash} from "node:crypto";
import {chromium} from "@playwright/test";
import {verifyProjectSnapshot} from "../../dist/src/platform/agent/project-workspace.js";
import {stageVerifiedFreeCiProject} from "./sp35-free-ci-stage-project.mjs";
import {trustedFreeCiOidcRequestUrl} from "../../dist/src/edge/free-ci-oidc-request-url.js";
const host="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
// The workflow_dispatch ticket must be read from the protected runner event
// file, NEVER from a step-level environment value printed in Actions logs.
const eventFile=process.env.GITHUB_EVENT_PATH??"";
if(!/^\/home\/runner\/work\/_temp\/_github_workflow\/event\.json$/u.test(eventFile))
 throw Error("FREE_CI_EVENT_FILE_UNTRUSTED");
const eventBody=await fs.readFile(eventFile,"utf8");
if(eventBody.length>16000)throw Error("FREE_CI_EVENT_FILE_SIZE_LIMIT");
const event=JSON.parse(eventBody);
if(event?.ref!=="refs/heads/product/sprint-3.5-complex-intent-recovery-20261026"||
 typeof event?.inputs?.ticket!=="string")
 throw Error("FREE_CI_EVENT_INPUT_INVALID");
const ticket=event.inputs.ticket;
const audience="appf2-sp35-free-ci-private-source-v1";
if(!/^[A-Za-z0-9_-]{80,3000}$/u.test(ticket))
 throw Error("FREE_CI_DISPATCH_TICKET_INVALID");
if(process.env.GITHUB_REPOSITORY!=="NFF98/appf2-build"||
 process.env.GITHUB_EVENT_NAME!=="workflow_dispatch"||
 process.env.GITHUB_REF!=="refs/heads/product/sprint-3.5-complex-intent-recovery-20261026")
 throw Error("FREE_CI_UNTRUSTED_RUN");
async function newOidc(){
 const endpoint=trustedFreeCiOidcRequestUrl(
  process.env.ACTIONS_ID_TOKEN_REQUEST_URL??"");
 const secret=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN??"";
 if(!endpoint||secret.length<20){
  // Diagnostics reveal presence/allowlisting ONLY. Never log token or full URL.
  let host="INVALID_OR_MISSING";
  try{
   const h=new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL??"").hostname;
   host=h.endsWith(".actions.githubusercontent.com")?
    h:"UNRECOGNIZED_HOST";
  }catch{ /* missing URL */ }
  console.log("SP35 OIDC SAFE PREFLIGHT: url_present="+
   Boolean(process.env.ACTIONS_ID_TOKEN_REQUEST_URL)+
   " token_present="+Boolean(secret)+" url_allowed="+Boolean(endpoint)+
   " host="+host);
  throw Error("FREE_CI_OIDC_NOT_PROVIDED");
 }
 endpoint.searchParams.set("audience",audience);
 const response=await fetch(endpoint,{headers:{"Authorization":"Bearer "+secret},
  signal:globalThis.AbortSignal.timeout(12000)});
 const body=await response.json().catch(()=>null);
 if(!response.ok||typeof body?.value!=="string")
  throw Error("FREE_CI_OIDC_ISSUANCE_FAILED");
 return body.value;
}
async function artifactHash(root){
 const files=[];
 async function visit(dir,relative){
  const entries=await fs.readdir(dir,{withFileTypes:true});
  for(const item of entries){
   const name=relative?relative+"/"+item.name:item.name;
   const absolute=path.join(dir,item.name);
   if(item.isDirectory())await visit(absolute,name);
   else if(item.isFile()){
    const bytes=await fs.readFile(absolute);
    if(bytes.length>5*1024*1024)throw Error("FREE_CI_ARTIFACT_SIZE_LIMIT");
    files.push([name,createHash("sha256").update(bytes).digest("hex")]);
   }else throw Error("FREE_CI_ARTIFACT_UNSAFE_FILE");
   if(files.length>128)throw Error("FREE_CI_ARTIFACT_COUNT_LIMIT");
  }
 }
 await visit(root,"");
 files.sort((a,b)=>a[0].localeCompare(b[0],"en"));
 if(!files.some(x=>x[0]==="index.html"))throw Error("FREE_CI_ARTIFACT_NO_INDEX");
 return "sha256:"+createHash("sha256").update(JSON.stringify(files)).digest("hex");
}
async function freeBuiltPreview(root,projectHash,digest){
 const index=await fs.readFile(path.join(root,"index.html"),"utf8");
 const scripts=[...index.matchAll(
  /<script\b[^>]*\bsrc="\/(assets\/[A-Za-z0-9_.-]+\.js)"[^>]*><\/script>/gu)];
 const styles=[...index.matchAll(
  /<link\b[^>]*\bhref="\/(assets\/[A-Za-z0-9_.-]+\.css)"[^>]*>/gu)];
 if(scripts.length!==1||styles.length>3)
  throw Error("FREE_CI_PREVIEW_UNSUPPORTED_VITE_ASSETS");
 const js=await fs.readFile(path.join(root,scripts[0][1]),"utf8");
 const css=(await Promise.all(styles.map(match=>
  fs.readFile(path.join(root,match[1]),"utf8")))).join("\n");
 const preview={project_hash:projectHash,artifact_hash:digest,
  index_html:index,javascript:js,css};
 if(new globalThis.TextEncoder().encode(JSON.stringify(preview)).length>400000)
  throw Error("FREE_CI_PREVIEW_BOUND_EXCEEDED");
 return preview;
}
const source=await fetch(host+"/api/v1/internal/free-ci/source",{
 method:"POST",headers:{"Authorization":"Bearer "+await newOidc(),
  "Content-Type":"application/json"},body:JSON.stringify({ticket}),
 signal:globalThis.AbortSignal.timeout(25000),redirect:"error"});
const data=await source.json().catch(()=>null);
if(source.status!==200||!data?.data?.project)
 throw Error("FREE_CI_SECURE_SOURCE_UNAVAILABLE_HTTP_"+source.status);
const project=data.data.project;
const plan=data.data.original_plan??null;
const originalPlanHash=data.data.qa_plan_hash??null;
if((plan===null)!==(originalPlanHash===null))throw Error("FREE_CI_QA_PLAN_INVALID");
if(!await verifyProjectSnapshot(project))throw Error("FREE_CI_SOURCE_HASH_INVALID");
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"sp35-oidc-free-ci-"));
let browser,server;
function docker(args){
 const result=spawnSync("docker",args,{
  encoding:"utf8",timeout:140000,maxBuffer:512*1024});
 if(result.error||result.status!==0)
  throw Error("FREE_CI_BUILD_FAILED:"+String(result.status));
}
try{
 const staged=await stageVerifiedFreeCiProject(project,tmp);
 if(staged.project_hash!==project.project_hash)
  throw Error("FREE_CI_STAGED_HASH_CHANGED");
 docker(["build","-t","appf2-sp35-free-ci:oidc",
  "-f","deploy/free-ci/Dockerfile","deploy"]);
 const uid=process.getuid?.()??1000,gid=process.getgid?.()??1000;
 docker(["run","--rm","--network","none","--cap-drop","ALL",
  "--security-opt","no-new-privileges","--pids-limit","100",
  "--memory","768m","--cpus","1","--user",uid+":"+gid,
  "--tmpfs","/tmp:rw,nosuid,size=64m",
  "-v",tmp+":/workspace/agent:rw","-w","/workspace/agent",
  "appf2-sp35-free-ci:oidc","node","/opt/appf2/build-locked.mjs"]);
 const html=await fs.readFile(path.join(tmp,"dist/index.html"),"utf8");
 if(html.length<50)throw Error("FREE_CI_BUILD_HTML_EMPTY");
 server=http.createServer(async(req,res)=>{
  const p=new URL(req.url??"/","http://127.0.0.1").pathname;
  if(!/^\/(?:index\.html|assets\/[A-Za-z0-9_.-]+)?$/u.test(p)){
   res.writeHead(404);res.end();return;}
  try{
   const data=await fs.readFile(path.join(tmp,"dist",p==="/"
    ?"index.html":p.slice(1)));
   res.setHeader("Content-Type",p.endsWith(".js")?"text/javascript":
    p.endsWith(".css")?"text/css":"text/html");
   res.end(data);
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const origin="http://127.0.0.1:"+server.address().port;
 browser=await chromium.launch({headless:true});
 const ctx=await browser.newContext({serviceWorkers:"block"});
 await ctx.route("**/*",route=>route.request().url().startsWith(origin+"/")?
  route.continue():route.abort());
 const page=await ctx.newPage();
 const errors=[];
 page.on("pageerror",error=>errors.push(error.message));
 await page.goto(origin,{waitUntil:"load",timeout:15000});
 await page.locator("body").waitFor({state:"visible",timeout:12000});
 if(!(await page.locator("body").innerText()).trim()||errors.length)
  throw Error("FREE_CI_CHROMIUM_RENDER_FAILED");
 const qaChecks=[];
 if(plan){
  if(!Array.isArray(plan.criteria)||plan.criteria.length<1||
   plan.criteria.length>20)throw Error("FREE_CI_QA_PLAN_INVALID");
  for(const criterion of plan.criteria){
   let verdict="UNTESTED",evidence_hash=null;
   if(criterion.automatable&&Array.isArray(criterion.steps)&&
      Array.isArray(criterion.assertions)&&criterion.assertions.length){
    const target=await ctx.newPage();
    try{
     await target.goto(origin,{waitUntil:"load",timeout:15000});
     const before=await target.locator("body").innerText();
     const selectorBefore=new Map();
     for(const assertion of criterion.assertions){
      if(assertion.kind==="text_changes"){
       const loc=target.locator(assertion.selector);
       if(await loc.count()!==1)throw Error("QA_PREVIOUS_SELECTOR_AMBIGUOUS");
       selectorBefore.set(assertion.selector,await loc.innerText());
      }
     }
     for(const step of criterion.steps){
      const loc=target.getByRole(step.role,{name:step.name,exact:true});
      if(await loc.count()!==1)throw Error("QA_TARGET_MISSING_OR_AMBIGUOUS");
      if(step.action==="click")await loc.click({timeout:2500});
      else if(step.action==="fill")await loc.fill(step.value,{timeout:2500});
      else throw Error("QA_STEP_UNSUPPORTED");
     }
     const after=await target.locator("body").innerText();
     let ok=true;
     for(const assertion of criterion.assertions){
      if(assertion.kind==="text_includes")ok&&=after.includes(assertion.text);
      else if(assertion.kind==="text_appears")
       ok&&=!before.includes(assertion.text)&&after.includes(assertion.text);
      else if(assertion.kind==="text_changes"){
       const loc=target.locator(assertion.selector);
       ok&&=await loc.count()===1&&
        selectorBefore.get(assertion.selector)!==await loc.innerText();
      }else if(assertion.kind==="element_count")
       ok&&=(await target.locator(assertion.selector).count())===assertion.count;
      else if(assertion.kind==="visible")
       ok&&=await target.getByRole(assertion.role,{name:assertion.name,exact:true}).isVisible();
      else ok=false;
     }
     verdict=ok?"PASS":"FAIL";
     if(ok)evidence_hash="sha256:"+createHash("sha256").update(
       JSON.stringify([project.project_hash,criterion.id,before,after,
         criterion.steps,criterion.assertions])).digest("hex");
    }catch{verdict="FAIL";}finally{await target.close();}
   }
   qaChecks.push({criterion_id:criterion.id,verdict,evidence_hash});
  }
 }
 const receipt={version:"APPF2_FREE_CI_SMOKE_V1",
  project_hash:project.project_hash,
  artifact_hash:await artifactHash(path.join(tmp,"dist")),
  checks:{locked_build:true,chromium_render:true},
  ...(plan?{qa_plan_hash:originalPlanHash,qa_checks:qaChecks}:{})};
 const saved=await fetch(host+"/api/v1/internal/free-ci/result",{
  method:"POST",headers:{"Authorization":"Bearer "+await newOidc(),
   "Content-Type":"application/json"},body:JSON.stringify({ticket,result:receipt}),
  signal:globalThis.AbortSignal.timeout(25000),redirect:"error"});
 const stored=await saved.json().catch(()=>null);
 if(saved.status!==200||!["RECORDED","REPLAYED"].includes(stored?.data?.status)||
  stored.data.project_hash!==project.project_hash||
  stored.data.original_requirements_qa!==false||
  stored.data.app_published!==false)
  throw Error("FREE_CI_SMOKE_RECEIPT_NOT_DURABLE_HTTP_"+saved.status);
 const assets=await freeBuiltPreview(path.join(tmp,"dist"),
  project.project_hash,receipt.artifact_hash);
 const previewSaved=await fetch(host+"/api/v1/internal/free-ci/preview",{
  method:"POST",headers:{"Authorization":"Bearer "+await newOidc(),
   "Content-Type":"application/json"},body:JSON.stringify({ticket,preview:assets}),
  signal:globalThis.AbortSignal.timeout(30000),redirect:"error"});
 const previewResult=await previewSaved.json().catch(()=>null);
 if(previewSaved.status!==200||
  !["RECORDED","REPLAYED"].includes(previewResult?.data?.status)||
  previewResult.data.project_hash!==project.project_hash||
  previewResult.data.app_published!==false)
  throw Error("FREE_CI_PRIVATE_PREVIEW_NOT_DURABLE_HTTP_"+previewSaved.status);
 console.log("SP35 FREE PRIVATE V2 PREVIEW: immutable built bytes saved privately for zero-AI re-open");
 console.log("SP35 PRIVATE FREE CI: GitHub OIDC verified, locked Docker build + Chromium render PASS");
 console.log("SP35 FREE CI RECEIPT: same Job/hash persisted in PostgreSQL "+stored.data.status);
 console.log("SP35 LIMIT: browser smoke only, original acceptance QA and publication NOT VERIFIED");
 await ctx.close();
}finally{
 await browser?.close().catch(()=>{});
 if(server)await new Promise(resolve=>server.close(resolve));
 await fs.rm(tmp,{force:true,recursive:true});
}
