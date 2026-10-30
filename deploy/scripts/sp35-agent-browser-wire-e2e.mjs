/**
 * Product E2E: compile the ACTUAL APPf2 homepage, open in Chromium, click the
 * REAL Agent button, check browser P-256 proofs and durable project UI.
 * The in-process fake Worker never uses a model, database or Cloudflare,
 * and cannot establish that arbitrary AI-generated Apps are functional.
 */
import {build} from "vite";
import {chromium} from "@playwright/test";
import {verifyMutationProof} from "../../dist/src/edge/create-proof.js";
import fs from "node:fs/promises";
import path from "node:path";
import http from "node:http";
import {fileURLToPath} from "node:url";
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),"../..");
const out=path.join(root,"dist/web");
const jobId="da4d1bd2-2cce-4c96-a197-637b5e71a3bd";
const code=JSON.stringify({name:"mock-candidate",private:true,type:"module"});
const job={job_id:jobId,revision:0,status:"CREATED",project_hash:"sha256:"+"a".repeat(64),
 files:[{path:"index.html",content:"<div id='app'></div>"},
  {path:"src/main.ts",content:"document.getElementById('app')?.replaceChildren();"},
  {path:"src/style.css",content:"body{color:#222}"},
  {path:"package.json",content:code}],app_published:false};
let owner=null,thumb=null,firstKey=null;
let planDone=false,toolDone=false,proofCount=0,planCount=0,stepCount=0;
let server=null,browser=null;
function json(res,status,data){
 res.writeHead(status,{"Content-Type":"application/json; charset=utf-8",
  "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
 res.end(JSON.stringify(status===200||status===201?{data}:{error:data}));
}
// eslint-disable-next-line complexity -- Signed creator, model and mock tool paths must remain distinct.
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
  json(res,201,{job_id:jobId,app_published:false});return;
 }
 if(body.anonymous_id!==owner||verified.keyThumbprint!==thumb){
  json(res,404,"WRONG_CREATOR");return;
 }
 const base="/api/v1/agent-jobs/"+jobId;
 if(url.pathname===base){
  json(res,200,job);return;
 }
 if(url.pathname===base+"/model-plan"){
  if(planDone||body.explicit_ai_consent!==true||
   body.max_charge_cents!==8||body.max_output_tokens!==4096||
   !/^agent_first_[0-9a-f-]{36}$/u.test(body.model_call_key)){
   json(res,400,"NO_MODEL_APPROVAL");return;
  }
  firstKey=body.model_call_key;planCount++;planDone=true;
  job.revision=1;job.status="PLANNING";
  json(res,200,{status:"MODEL_RESPONSE_SAVED"});return;
 }
 if(url.pathname===base+"/agent-progress"){
  if(Object.keys(body).length!==1){json(res,400,"PROGRESS_NOT_READ_ONLY");return;}
  json(res,200,{revision:job.revision,
   can_resume:planDone&&!toolDone,
   resume_model_call_key:planDone&&!toolDone?firstKey:null,
   next_action:toolDone?"NO_PROVEN_PENDING_MODEL":"SIGN_NEXT_SEQUENCE",
   calls:planDone?[{model_call_key:firstKey,state:toolDone?"ALREADY_APPLIED":"CURRENT_MODEL_READY",
    tool:"write_files",requires_container_consent:false}]:[]});return;
 }
 if(url.pathname===base+"/auto-step"){
  if(!planDone||toolDone||body.model_call_key!==firstKey||
   body.expected_revision!==1||body.explicit_ai_consent!==true||
   body.max_ai_charge_cents!==8||!body.next_model_call_key||
   body.max_output_tokens!==4096){
   json(res,400,"STALE_OR_UNAPPROVED_STEP");return;
  }
  stepCount++;toolDone=true;
  job.files.push({path:"src/game.ts",
   content:"export function roll(){return [1,2,3,4];}"});
  job.revision=2;job.status="CODING";job.project_hash="sha256:"+"b".repeat(64);
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
 if(planCount!==1||stepCount!==1||proofCount<5)
  throw Error("AGENT_WIRE_PROOF_OR_PAYLOAD_MISSING");
 if(pageErrors.length)throw Error("AGENT_BROWSER_EXCEPTION:"+pageErrors.join("|"));
 // Reload must recover the persisted nonextractable P-256 key, not mint a
 // new key that would steal or fail the existing Job.
 await page.waitForTimeout(400);
 await page.reload({waitUntil:"domcontentloaded",timeout:15000});
 await page.getByLabel(/我同意本次使用付費 AI/u).check();
 await page.getByRole("button",{name:"繼續上次保存的 Agent 工作"}).click();
 await page.getByText("已保存專案 · CODING").waitFor({timeout:15000});
 if(planCount!==1||stepCount!==1||proofCount<8)
  throw Error("AGENT_RELOAD_REPLAYED_PAID_CALL");
 console.log("SP35 REAL FIRST-PARTY CHROMIUM → P-256 SIGNED AGENT CREATE/PLAN/EDIT/RECOVERY: PASS (MOCK MODEL, NO CLOUD)");
}finally{
 if(browser)await browser.close();
 if(server)await new Promise(resolve=>server.close(resolve));
}
