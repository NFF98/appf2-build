/**
 * Product E2E: compile the ACTUAL APPf2 homepage, open in Chromium, click the
 * REAL Agent button, check browser P-256 proofs and durable project UI.
 * The in-process fake Worker never uses a model, database or Cloudflare,
 * and cannot establish that arbitrary AI-generated Apps are functional.
 */
import {build} from "vite";
import {chromium} from "@playwright/test";
import {verifyMutationProof} from "../../dist/src/edge/create-proof.js";
import {validFreezeQaPlanBody} from "../../dist/src/edge/agent-qa-plan.js";
import {validGenerateQaBody} from "../../dist/src/edge/agent-qa-generate.js";
import {qaRepairCallKey} from "../../dist/src/platform/agent/qa-repair-key.js";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const out=path.join(root,"dist/web");
const jobId="da4d1bd2-2cce-4c96-a197-637b5e71a3bd";
const code=JSON.stringify({name:"mock-candidate",private:true,type:"module"});
const qaPlan={version:"1",criteria:[{
 id:"req_1",source_quote:"計分",description:"使用者操作後計分改變",
 steps:[{action:"click",role:"button",name:"加分"}],
 assertions:[{kind:"text_appears",text:"1"}],automatable:true
}]};
const job={job_id:jobId,revision:0,status:"CREATED",project_hash:"sha256:"+"a".repeat(64),
 checkpoint:{step:0,completed_call_ids:[],budget:{max_steps:8,max_tokens:8192,max_cost_cents:60}},
 files:[{path:"index.html",content:"<div id='app'></div>"},
  {path:"src/main.ts",content:"document.getElementById('app')?.replaceChildren();"},
  {path:"src/style.css",content:"body{color:#222}"},
  {path:"package.json",content:code}],app_published:false};
let owner=null,thumb=null,firstKey=null;
let planDone=false,toolDone=false,proofCount=0,planCount=0,stepCount=0,renewCount=0;
let qaFreezeCount=0,autoPlanCount=0,frozenPlan=null,createdPrompt=null;
let qaRunCount=0,qaRepairCount=0,lastRepairKey=null,autoQaPending=false;
const qaAttemptHashes=new Set();
const savedQaChecks=[{criterion_id:"req_1",category:"BROWSER",
 verdict:"FAIL",evidence_hash:null}];
let privatePreviewFetches=0;
let server=null,browser=null;
function json(res,status,data){
 res.writeHead(status,{"Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
 res.end(JSON.stringify(status===200||status===201?{data}:{error:data}));
}
// eslint-disable-next-line complexity, max-lines-per-function -- Signed creator and independent QA model routes are distinct.
async function api(req,res,url){
 const bytes=[];
 for await(const chunk of req)bytes.push(chunk);
 const raw=Buffer.concat(bytes),headers=new globalThis.Headers(req.headers);
 const idempotencyKey=headers.get("Idempotency-Key");
 if(!idempotencyKey||headers.get("Origin")!==url.origin||
  headers.get("Sec-Fetch-Site")==="cross-site"){
  json(res,404,"UNTRUSTED_ORIGIN");return;
 }
 const verified=await verifyMutationProof({method:"POST",path:url.pathname,
  body:new Uint8Array(raw),idempotencyKey,headers},Date.now());
 if(!verified){json(res,404,"INVALID_SIGNATURE");return;}
 proofCount++;
 let body;
 try{body=JSON.parse(raw.toString("utf8"));}catch{json(res,400,"BAD_JSON");return;}
 if(url.pathname==="/api/v1/agent-jobs"){
  if(owner!==null||body.explicit_ai_consent!==true||
   body.max_cost_cents!==60||String(body.prompt).length<5){
   json(res,400,"NO_CONSENT");return;
  }
  owner=body.anonymous_id;thumb=verified.keyThumbprint;
  createdPrompt=body.prompt;
  json(res,201,{job_id:jobId,app_published:false});return;
 }
 if(body.anonymous_id!==owner||verified.keyThumbprint!==thumb){
  json(res,404,"WRONG_CREATOR");return;
 }
 const base="/api/v1/agent-jobs/"+jobId;
 if(url.pathname===base){
  json(res,200,job);return;
 }
 if(url.pathname===base+"/qa-generate"){
  if(!validGenerateQaBody(body)||body.original_prompt!==createdPrompt||
   frozenPlan!==null||job.revision!==0){
   json(res,503,"QA_GENERATION_NOT_APPROVED");return;
  }
  autoPlanCount++;frozenPlan=qaPlan;qaFreezeCount++;
  json(res,200,{status:"QA_ORIGINAL_PLAN_FROZEN",
   original_plan:qaPlan,source:"PROVIDER",criteria_count:1,app_published:false});
  return;
 }
 if(url.pathname===base+"/qa-plan"){
  if(!validFreezeQaPlanBody(body)||body.original_prompt!==createdPrompt||
   job.revision!==0||frozenPlan!==null){
   json(res,503,"QA_PLAN_NOT_PRE_CODE");return;
  }
  frozenPlan=body.original_plan;qaFreezeCount++;
  json(res,200,{status:"QA_ORIGINAL_PLAN_FROZEN",criteria_count:1,
   project_hash:job.project_hash,revision:0,app_published:false});return;
 }
 if(url.pathname===base+"/preview-asset"){
  const last=job.checkpoint.completed_call_ids;
  if(!["TESTING","REPAIRING"].includes(job.status)||
   body.explicit_container_preview_consent!==true||
   body.expected_revision!==job.revision||body.project_hash!==job.project_hash||
   last.indexOf(body.build_call_id)<0||
    last.indexOf(body.build_call_id)>=last.lastIndexOf(body.test_call_id)||
    body.test_call_id!==last.at(-1)){
   json(res,503,"PRIVATE_PREVIEW_NOT_PROVEN");return;
  }
  const built={
   "index.html":'<!doctype html><html><head><script type="module" crossorigin src="/assets/index-DEMO1234.js"></script></head><body><div id="app"></div></body></html>',
   "assets/index-DEMO1234.js":"const app=document.querySelector('#app');const button=document.createElement('button');button.textContent='Demo Add';button.onclick=()=>{document.querySelector('#result').textContent='PREVIEW_CLICKED_42';};const result=document.createElement('p');result.id='result';app.append(button,result);"
  };
  if(!Object.hasOwn(built,body.path)){
   json(res,404,"PREVIEW_PATH_REJECTED");return;
  }
  privatePreviewFetches++;
  json(res,200,{path:body.path,text:built[body.path],
   project_hash:job.project_hash,
   content_type:body.path==="index.html"?"text/html":"text/javascript"});
  return;
 }
 if(url.pathname===base+"/qa-run"){
  const completed=job.checkpoint.completed_call_ids;
  if(job.status!=="TESTING"||body.explicit_browser_qa_consent!==true||
   body.job_id!==jobId||body.expected_revision!==job.revision||
   body.project_hash!==job.project_hash||
   body.original_prompt!==createdPrompt||
   JSON.stringify(body.original_plan)!==JSON.stringify(frozenPlan)||
   completed.indexOf(body.build_call_id)<0||
    completed.indexOf(body.build_call_id)>=completed.lastIndexOf(body.test_call_id)||
    body.test_call_id!==completed.at(-1)){
   json(res,503,"QA_NOT_PROVEN");return;
  }
  if(qaAttemptHashes.has(job.project_hash)){
   json(res,503,"QA_ALREADY_DISPATCHED_NO_RETRY");return;
  }
  qaAttemptHashes.add(job.project_hash);
  qaRunCount++;job.status="REPAIRING";job.revision++;
  json(res,200,{status:"BROWSER_QA_FAILED_REPAIR_READY",
   ready_for_review:false,app_published:false,
   checks:[{criterion_id:"req_1",category:"BROWSER",verdict:"FAIL",evidence_hash:null}]});
  return;
 }
 if(url.pathname===base+"/qa-repair"){
  if(job.status!=="REPAIRING"||body.explicit_ai_consent!==true||
   body.expected_revision!==job.revision||body.max_charge_cents!==8||
   body.max_output_tokens!==4096||body.original_prompt!==createdPrompt||
   JSON.stringify(body.original_plan)!==JSON.stringify(frozenPlan)||
   body.model_call_key!==qaRepairCallKey(job.project_hash)){
   json(res,503,"QA_REPAIR_NOT_APPROVED");return;
  }
  if(lastRepairKey!==body.model_call_key){
   lastRepairKey=body.model_call_key;qaRepairCount++;
  }
  json(res,200,{status:"QA_REPAIR_MODEL_SAVED",response_id:"resp_repair_mock123456",
   source:lastRepairKey===body.model_call_key?"DURABLE_REPLAY":"PROVIDER",
   ready_for_review:false,app_published:false});return;
 }
 if(url.pathname===base+"/model-plan"){
  if(planDone||qaFreezeCount!==1||!frozenPlan||
   body.explicit_ai_consent!==true||
   body.max_charge_cents!==8||body.max_output_tokens!==4096||
   !/^agent_first_[0-9a-f-]{36}$/u.test(body.model_call_key)){
   json(res,400,"NO_MODEL_APPROVAL");return;
  }
  firstKey=body.model_call_key;planCount++;planDone=true;
  job.revision=1;job.status="PLANNING";job.checkpoint.step=1;
  json(res,200,{status:"MODEL_RESPONSE_SAVED"});return;
 }
 if(url.pathname===base+"/extend-budget"){
  if(body.explicit_budget_consent!==true||body.expected_revision!==job.revision||
   body.new_max_steps!==job.checkpoint.budget.max_steps+16||
   body.new_max_cost_cents!==60){json(res,400,"UNAUTHORIZED_RENEWAL");return;}
  renewCount++;job.checkpoint.budget.max_steps=body.new_max_steps;job.revision++;
  json(res,200,{status:"BUDGET_EXTENDED",revision:job.revision,
   budget:job.checkpoint.budget,app_published:false});return;
 }
 if(url.pathname===base+"/agent-progress"){
  if(Object.keys(body).length!==1){json(res,400,"PROGRESS_NOT_READ_ONLY");return;}
  if(autoQaPending){
   json(res,200,{revision:job.revision,
    remaining_steps:job.checkpoint.budget.max_steps-job.checkpoint.step,
    can_resume:true,resume_model_call_key:"agent_autotest_12345678",
    next_action:"SIGN_NEXT_SEQUENCE",
    qa_attempt_state:qaAttemptHashes.has(job.project_hash)?"RESULT_RECORDED":"NOT_RUN",
    qa_observed_checks:qaAttemptHashes.has(job.project_hash)?savedQaChecks:[],
    calls:[{model_call_key:"agent_autotest_12345678",
     state:"CURRENT_MODEL_READY",tool:"run_test",requires_container_consent:true}]});
   return;
  }
  if(job.status==="TESTING"&&job.checkpoint.completed_call_ids.length>=2){
   const completed=job.checkpoint.completed_call_ids;
   const build=completed.find(id=>id.includes("_build_"));
   const test=completed.at(-1);
   json(res,200,{revision:job.revision,remaining_steps:
    job.checkpoint.budget.max_steps-job.checkpoint.step,
    can_resume:false,resume_model_call_key:null,
    next_action:"VERIFY_INDEPENDENT_QA",
    proven_preview_pair:{build_call_id:build,test_call_id:test},
    qa_attempt_state:qaAttemptHashes.has(job.project_hash)?"RESULT_RECORDED":"NOT_RUN",
    qa_observed_checks:qaAttemptHashes.has(job.project_hash)?savedQaChecks:[],
    calls:[{model_call_key:"agent_fixture_build_12345678",state:"ALREADY_APPLIED",
     call_id:build,tool:"run_build",requires_container_consent:true},
     {model_call_key:"agent_fixture_test_12345678",state:"ALREADY_APPLIED",
      call_id:test,tool:"run_test",requires_container_consent:true}]});
   return;
  }
  json(res,200,{revision:job.revision,remaining_steps:job.checkpoint.budget.max_steps-job.checkpoint.step,
   can_resume:planDone&&!toolDone,
   resume_model_call_key:planDone&&!toolDone?firstKey:null,
   next_action:toolDone?"NO_PROVEN_PENDING_MODEL":"SIGN_NEXT_SEQUENCE",
   qa_attempt_state:qaAttemptHashes.has(job.project_hash)?"RESULT_RECORDED":"NOT_RUN",
   qa_observed_checks:qaAttemptHashes.has(job.project_hash)?savedQaChecks:[],
   calls:planDone?[{model_call_key:firstKey,state:toolDone?"ALREADY_APPLIED":"CURRENT_MODEL_READY",
    tool:"write_files",requires_container_consent:false}]:[]});return;
 }
 if(url.pathname===base+"/auto-step"){
  if(autoQaPending&&body.model_call_key==="agent_autotest_12345678"){
   if(body.expected_revision!==job.revision||
    body.explicit_container_consent!==true||body.max_container_charge_cents!==5||
    body.explicit_ai_consent!==true||body.max_ai_charge_cents!==8){
    json(res,400,"AUTO_QA_NOT_CONSENTED");return;
   }
   stepCount++;autoQaPending=false;
   job.status="TESTING";job.revision++;job.checkpoint.step++;
   job.checkpoint.completed_call_ids=[
    "call_auto_build_12345678","call_auto_test_12345678"];
   json(res,200,{status:"INDEPENDENT_QA_REQUIRED",
    action:"VERIFY_ORIGINAL_REQUIREMENTS",revision:job.revision});
   return;
  }
  if(!planDone||toolDone||body.model_call_key!==firstKey||
   body.expected_revision!==1||body.explicit_ai_consent!==true||
   body.max_ai_charge_cents!==8||!body.next_model_call_key||
   body.max_output_tokens!==4096){
   json(res,400,"STALE_OR_UNAPPROVED_STEP");return;
  }
  stepCount++;toolDone=true;
  job.files.push({path:"src/game.ts",
   content:"export function roll(){return [1,2,3,4];}"});
  job.revision=2;job.status="CODING";job.checkpoint.step=2;
  job.project_hash="sha256:"+"b".repeat(64);
  json(res,200,{status:"STEP_APPLIED",
   action:"NEXT_MODEL_NEEDS_SIGNED_CONSENT",revision:2});return;
 }
 json(res,404,"ROUTE_NOT_FOUND");
}
async function staticFile(req,res,url){
 let file=url.pathname==="/"?"/index.html":url.pathname;
 if(!/^\/(?:index\.html|assets\/[A-Za-z0-9_.-]+)$/u.test(file)){
  res.writeHead(404);res.end();return;
 }
 file=path.join(out,file.slice(1));
 try{
  const body=await fs.readFile(file);
  const mime=file.endsWith(".js")?"text/javascript":
   file.endsWith(".css")?"text/css":"text/html";
  res.writeHead(200,{"Content-Type":mime,"X-Content-Type-Options":"nosniff"});
  res.end(body);
 }catch{res.writeHead(404);res.end();}
}
try{
 await build({configFile:path.join(root,"tooling/web/vite.config.ts"),logLevel:"error"});
 server=http.createServer((req,res)=>{
  const url=new URL(req.url??"/","http://"+req.headers.host);
  const action=url.pathname.startsWith("/api/v1/")?api(req,res,url):
   staticFile(req,res,url);
  void action.catch(e=>{console.error("BROWSER_WIRE_API_ERROR",e);
   if(!res.headersSent)json(res,503,"MOCK_UNAVAILABLE");else res.end();});
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const port=server.address().port;
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();
 const pageErrors=[];
 page.on("pageerror",e=>pageErrors.push(e.message));
 const origin="http://127.0.0.1:"+port;
 const homepage=await fetch(origin+"/");
 if(!homepage.ok||(await homepage.text()).indexOf("root")===-1)
  throw Error("AGENT_HOMEPAGE_HTTP_BOOT_FAILURE");
 await page.goto(origin+"/",{waitUntil:"domcontentloaded",timeout:15000});
 const primary=page.getByRole("button",{name:"建立新多檔案 App 專案"});
 if(await primary.count()!==1)throw Error("AGENT_HOMEPAGE_WIRING_MISSING");
 if(await primary.isEnabled())throw Error("AI_SPEND_NO_CONSENT");
 const prompt="建立四人十八啦骰子遊戲，有計分和排行榜";
 await page.getByRole("textbox",{name:"用一句話描述要做的 App"}).fill(prompt);
 // No QA JSON authored or pasted: the product must auto-plan from one sentence.
 await page.getByLabel(/我同意本次使用付費 AI/u).check();
 if(!(await primary.isEnabled()))throw Error("AGENT_CONSENT_UI_BROKEN");
 await primary.click();
 await page.getByText("已保存專案 · CODING").waitFor({timeout:15000});
 if(await page.getByText("本次處理 1 步",{exact:false}).count()!==1)
  throw Error("AGENT_DID_NOT_REACH_SAVED_STEP");
 await page.getByText("查看已保存原始碼",{exact:false}).click();
 await page.getByText("src/game.ts",{exact:true}).click();
 if(await page.getByText("export function roll()", {exact:false}).count()!==1)
  throw Error("AGENT_GENERATED_MULTIFILE_NOT_SHOWN");
 if(qaFreezeCount!==1||autoPlanCount!==1||!frozenPlan||
  JSON.stringify(frozenPlan)!==JSON.stringify(qaPlan)||
  planCount!==1||stepCount!==1||proofCount<6)
  throw Error("AGENT_WIRE_PROOF_OR_PAYLOAD_MISSING");
 // Reopening a saved card must restore its original proof key and last
 // Postgres job head; NEVER start a new model/QA/container operation.
 await page.getByRole("button",{name:"開啟："+prompt}).click();
 await page.getByText("已恢復保存的專案，不重新執行 AI 或雲端建置。")
  .waitFor({timeout:15000});
 if(planCount!==1||autoPlanCount!==1||stepCount!==1||
  qaRunCount!==0||qaRepairCount!==0)
  throw Error("AGENT_SAVED_CARD_REOPEN_RECHARGED_OR_RESTARTED");
 if(pageErrors.length)throw Error("AGENT_BROWSER_EXCEPTION:"+pageErrors.join("|"));
 // Reload must recover the persisted nonextractable P-256 key, not mint a
 // new key that would steal or fail the existing Job.
 await page.waitForTimeout(400);
 await page.reload({waitUntil:"domcontentloaded",timeout:15000});
 await page.getByLabel(/我同意本次使用付費 AI/u).check();
 await page.getByRole("button",{name:"繼續上次保存的 Agent 工作"}).click();
 await page.getByText("已保存專案 · CODING").waitFor({timeout:15000});
 if(qaFreezeCount!==1||autoPlanCount!==1||planCount!==1||stepCount!==1||proofCount<9)
  throw Error("AGENT_RELOAD_REPLAYED_PAID_CALL");
 const renewal=page.getByRole("button",{name:"延長 16 步（費用上限不變）"});
 await renewal.click();
 await page.getByText("累計步數 2/24",{exact:false}).waitFor({timeout:15000});
 if(renewCount!==1||job.revision!==3||job.checkpoint.budget.max_steps!==24||
  job.checkpoint.budget.max_cost_cents!==60||stepCount!==1||planCount!==1)
  throw Error("AGENT_BUDGET_RENEWAL_VIOLATED_CAS_OR_REPLAY");
 await page.reload({waitUntil:"domcontentloaded",timeout:15000});
 await page.getByLabel(/我同意本次使用付費 AI/u).check();
 await page.getByRole("button",{name:"繼續上次保存的 Agent 工作"}).click();
 await page.getByText("已保存專案 · CODING").waitFor({timeout:15000});
 if(renewCount!==1||qaFreezeCount!==1||autoPlanCount!==1||planCount!==1||stepCount!==1)
  throw Error("AGENT_BUDGET_RELOAD_SPENT_EXTRA");
 // Simulate a separately saved successful build+test checkpoint; no model
 // or container is actually run by this first-party browser wiring fixture.
 job.status="TESTING";job.revision++;job.checkpoint.step=4;
 job.checkpoint.completed_call_ids=["call_browser_build_123456",
  "call_browser_inspect_123456","call_browser_test_123456"];
 await page.reload({waitUntil:"domcontentloaded",timeout:15000});
 await page.getByLabel(/我同意本次使用付費 AI/u).check();
 await page.getByRole("button",{name:"繼續上次保存的 Agent 工作"}).click();
 await page.getByText("已保存專案 · TESTING").waitFor({timeout:15000});
 const preview=page.getByRole("button",{
  name:"開啟已建置 App 互動預覽（需雲端存取授權）"});
 if(await preview.isEnabled())throw Error("PRIVATE_PREVIEW_NO_SEPARATE_CONSENT");
 await page.getByLabel(/我另外授權 Cloudflare 隔離建置/u).check();
 await preview.click();
 const frame=page.frameLocator('iframe[title="私人候選 App 互動預覽（尚未通過發布驗收）"]');
 await frame.getByRole("button",{name:"Demo Add"}).click();
 await frame.getByText("PREVIEW_CLICKED_42").waitFor({timeout:15000});
 // The real generated candidate must be usable at full viewport size; a
 // 560px clipped iframe is not acceptable even when all buttons are clickable.
 const expand=page.getByRole("button",{name:"全螢幕顯示"});
 if(!(await expand.isEnabled()))throw Error("PRIVATE_PREVIEW_FULLSCREEN_NOT_AVAILABLE");
 await expand.click();
 const viewer=page.locator('[aria-label="私人候選 App 全螢幕檢視"]');
 await page.getByRole("button",{name:"退出全螢幕"}).waitFor({timeout:15000});
 const size=await viewer.boundingBox();
 const viewport=page.viewportSize();
 if(!size||!viewport||size.height<viewport.height-8||
  size.width<viewport.width-8)
  throw Error("PRIVATE_PREVIEW_FULLSCREEN_CLIPPED");
 await frame.getByRole("button",{name:"Demo Add"}).click();
 await frame.getByText("PREVIEW_CLICKED_42").waitFor({timeout:15000});
 await page.getByRole("button",{name:"退出全螢幕"}).click();
 await page.getByRole("button",{name:"全螢幕顯示"}).waitFor({timeout:15000});
 if(privatePreviewFetches!==2||qaRunCount!==0||qaRepairCount!==0)
  throw Error("PRIVATE_BUILD_PREVIEW_CAUSED_PAID_OR_UNSAFE_EFFECTS");
 const qaButton=page.getByRole("button",{
  name:"開始獨立瀏覽器 QA（需另行授權）"});
 if(await qaButton.isEnabled())throw Error("BROWSER_QA_SPENT_WITHOUT_SEPARATE_CONSENT");
 await page.getByLabel(/我另行核准本次獨立雲端瀏覽器 QA/u).check();
 await qaButton.click();
 await page.getByText("已保存專案 · REPAIRING").waitFor({timeout:15000});
 await page.getByText("使用者操作後計分改變：FAIL").waitFor({timeout:15000});
 if(qaRunCount!==1||job.status!=="REPAIRING")
  throw Error("BROWSER_QA_DID_NOT_SAVE_REPAIRING");
 await page.getByRole("button",{
  name:"根據 QA 失敗結果要求 AI 修復（需另行授權）"}).click();
 await page.getByText("修復模型回應已保存",{exact:false}).waitFor({timeout:15000});
 if(qaRepairCount!==1||!lastRepairKey||
  lastRepairKey!==qaRepairCallKey(job.project_hash))
  throw Error("BROWSER_QA_REPAIR_UNSTABLE_OR_NOT_SIGNED");
 // Real UI recovery is read-only: no second model/QA/container dispatch.
 const paidBefore={qaRunCount,qaRepairCount,stepCount,planCount,autoPlanCount};
 await page.getByRole("button",{
  name:"查詢已保存的產品進度與 QA 紀錄（不扣費）"}).click();
 await page.getByText("已從資料庫讀取最新工作與獨立 QA 紀錄",{
  exact:false}).waitFor({timeout:15000});
 await page.getByRole("region",{name:"QA 逐項結果"})
  .getByText("使用者操作後計分改變：FAIL").waitFor({timeout:15000});
 if(qaRunCount!==paidBefore.qaRunCount||
  qaRepairCount!==paidBefore.qaRepairCount||
  stepCount!==paidBefore.stepCount||planCount!==paidBefore.planCount||
  autoPlanCount!==paidBefore.autoPlanCount)
  throw Error("SAVED_QA_PROGRESS_READ_DISPATCHED_PAID_OPERATION");
 await page.reload({waitUntil:"domcontentloaded",timeout:15000});
 await page.getByLabel(/我同意本次使用付費 AI/u).check();
 await page.getByRole("button",{name:"繼續上次保存的 Agent 工作"}).click();
 await page.getByText("已保存專案 · REPAIRING").waitFor({timeout:15000});
 await page.getByRole("button",{
  name:"根據 QA 失敗結果要求 AI 修復（需另行授權）"}).click();
 await page.getByText("修復模型回應已保存",{exact:false}).waitFor({timeout:15000});
 if(qaRunCount!==1||qaRepairCount!==1||autoPlanCount!==1||planCount!==1)
  throw Error("BROWSER_QA_RELOAD_REPLAYED_PAID_REPAIR");
 // A fresh saved project revision now has a model-selected run_test already
 // awaiting signed container admission. One click with three separate
 // approvals must finish that tool, run QA, and start ONE repair.
 job.project_hash="sha256:"+"c".repeat(64);
 job.status="REPAIRING";job.revision++;autoQaPending=true;
 await page.reload({waitUntil:"domcontentloaded",timeout:15000});
 await page.getByLabel(/我同意本次使用付費 AI/u).check();
 await page.getByLabel(/我另外授權 Cloudflare 隔離建置/u).check();
 await page.getByLabel(/我另行核准本次獨立雲端瀏覽器 QA/u).check();
 await page.getByRole("button",{name:"繼續上次保存的 Agent 工作"}).click();
 await page.getByText("獨立 QA 失敗，已依本次授權修復一次",{
  exact:false}).waitFor({timeout:15000});
 if(autoQaPending||qaRunCount!==2||qaRepairCount!==2||
  lastRepairKey!==qaRepairCallKey(job.project_hash)||stepCount!==2)
  throw Error("AGENT_AUTOMATED_QA_REPAIR_NOT_PROVEN_IN_CHROMIUM");
 console.log("SP35 REAL FIRST-PARTY CHROMIUM → ONE SENTENCE → AUTOMATIC PRE-CODE QA PLAN → SIGNED QA FAILURE → ONE-SHOT REPAIR: PASS (MOCK QA/MODEL, NO CLOUD)");
}finally{
 if(browser)await browser.close();
 if(server)await new Promise(resolve=>server.close(resolve));
}
