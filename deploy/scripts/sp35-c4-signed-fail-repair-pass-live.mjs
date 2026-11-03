/** C4 zero-provider-call, creator-signed real Staging PIPELINE proof.
 * Independent FAIL and repaired PASS are GitHub-OIDC Docker/Chromium receipts.
 * The corrected source is AUTHOR-DEFINED, NOT autonomously AI repaired.
 * One owner/Job/immutable original QA, no impersonation, no public publish.
 */
import {randomUUID,webcrypto} from "node:crypto";
const origin="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
const crypto=webcrypto,owner=randomUUID();
const keys=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},
 false,["sign","verify"]);
const spki=Buffer.from(await crypto.subtle.exportKey("spki",keys.publicKey))
 .toString("base64url");
const digest=async b=>Buffer.from(await crypto.subtle.digest("SHA-256",b))
 .toString("base64url");
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function signed(path,body,status=200){
 const bytes=new globalThis.TextEncoder().encode(JSON.stringify(body));
 const nonce="sp35C4Free_"+randomUUID().replaceAll("-","");
 const now=Date.now();
 const transcript=new globalThis.TextEncoder().encode(JSON.stringify([
  "APPF2_MUTATION_PoP_V1","POST",path,await digest(bytes),nonce,now]));
 const sig=Buffer.from(await crypto.subtle.sign(
  {name:"ECDSA",hash:"SHA-256"},keys.privateKey,transcript))
  .toString("base64url");
 const response=await fetch(origin+path,{method:"POST",redirect:"error",headers:{
  "Content-Type":"application/json","Origin":origin,"Sec-Fetch-Site":"same-origin",
  "Idempotency-Key":nonce,"X-Appf2-PoP-Key":spki,
  "X-Appf2-PoP-Signature":sig,"X-Appf2-PoP-Timestamp":String(now)},
  body:bytes,signal:globalThis.AbortSignal.timeout(125000)});
 const json=await response.json().catch(()=>null);
 if(response.status!==status||!json?.data)
  throw Error("C4_SIGNED_HTTP_"+response.status+"_ROUTE_"+path.split("/").at(-1)+
   "_"+String(json?.error??"NO_DATA").slice(0,80));
 return json.data;
}
const prompt="請做一個可操作骰子遊戲：按「擲骰」按鈕後顯示「得分：6」。";
const plan={version:"1",criteria:[{
 id:"dice_action",source_quote:"按「擲骰」按鈕後顯示「得分：6」",
 description:"Chromium 實際按擲骰並觀察文字",
 automatable:true,
 steps:[{action:"click",role:"button",name:"擲骰"}],
 assertions:[{kind:"text_appears",text:"得分：6"}]}]};
const start=await signed("/api/v1/agent-jobs",{
 anonymous_id:owner,prompt},201);
if(start.revision!==0||start.ai_started!==false||
 start.approved_max_cost_cents!==0||start.app_published!==false)
 throw Error("C4_FREE_INITIAL_JOB_NOT_VERIFIED");
const base="/api/v1/agent-jobs/"+start.job_id;
await signed(base+"/qa-plan",{anonymous_id:owner,expected_revision:0,
 original_prompt:prompt,original_plan:plan});
const script=value=>`import "./style.css";
const app=document.querySelector("#app");
if(!app)throw Error("ROOT_NOT_FOUND");
const button=document.createElement("button");
button.textContent="擲骰";
const output=document.createElement("p");
output.textContent="得分：0";
button.addEventListener("click",()=>{output.textContent="得分：${value}";});
app.replaceChildren(button,output);`;
const imported=await signed(base+"/import-files",{anonymous_id:owner,
 expected_revision:0,expected_project_hash:start.project_hash,
 files:[{path:"src/main.ts",content:script(0)}]});
if(imported.revision!==2||imported.status!=="IMPORTED_NO_AI")
 throw Error("C4_INITIAL_BAD_SOURCE_NOT_SAVED");
const frozenHash=imported.project_hash;
async function dispatch(){
 const v=await signed(base+"/free-ci-dispatch",{
  anonymous_id:owner,explicit_free_ci_consent:true},202);
 if(v.status!=="FREE_CI_QUEUED")throw Error("C4_GITHUB_DISPATCH_FAILED");
}
async function read(){return signed(base,{anonymous_id:owner});}
// eslint-disable-next-line complexity -- Each independent live QA, owner and spend fence fails closed.
async function awaitReceipt(hash,expectedVerdict){
 const deadline=Date.now()+9*60*1000;
 while(Date.now()<deadline){
  await sleep(11000);
  const j=await read();
  if(j.project_hash!==hash||j.ai_started!==false||
   j.app_published!==false||j.checkpoint?.cost_cents!==0)
   throw Error("C4_JOB_CHANGED_OR_CHARGED_OR_PUBLISHED");
  const receipt=j.free_ci;
  if(!receipt)continue;
  if(receipt.status!=="BUILD_BROWSER_SMOKE"||
   receipt.qa_checks?.length!==1||
   receipt.qa_checks[0].criterion_id!=="dice_action"||
   receipt.qa_checks[0].verdict!==expectedVerdict||
   receipt.original_requirements_qa!==false||
   !/^[0-9]{6,20}$/u.test(receipt.run_id))
   throw Error("C4_INDEPENDENT_QA_UNEXPECTED_"+receipt.status+"_"+
    String(receipt.qa_checks?.[0]?.verdict));
  if(expectedVerdict==="FAIL"){
   if(receipt.qa_checks[0].failure_code!=="ASSERTION_FAILED")
    throw Error("C4_FALSE_FAIL_REASON");
   return j;
  }
  if(receipt.qa_checks[0].evidence_hash===null)
   throw Error("C4_PASS_MISSING_EVIDENCE");
  if(!receipt.preview_ready)continue;
  return j;
 }
 throw Error("C4_GITHUB_CHROMIUM_RECEIPT_TIMEOUT_"+expectedVerdict);
}
await dispatch();
const failed=await awaitReceipt(frozenHash,"FAIL");
if(failed.revision!==2)throw Error("C4_INITIAL_FAILURE_NOT_REV2");
console.log("C4 REAL: same owner Job revision2 → OIDC Docker Chromium original QA FAIL (no AI)");
const repaired=await signed(base+"/import-repair",{anonymous_id:owner,
 expected_revision:2,expected_project_hash:frozenHash,
 files:[{path:"src/main.ts",content:script(6)}]});
if(repaired.status!=="MANUAL_REPAIR_SAVED_NO_AI"||
 repaired.revision!==4||repaired.project_hash===frozenHash||
 repaired.app_published!==false||repaired.ai_started!==false)
 throw Error("C4_SAME_JOB_REPAIR_NOT_DURABLY_SAVED");
const after=await read();
if(after.revision!==4||after.status!=="CODING"||
 after.project_hash!==repaired.project_hash||
 after.checkpoint?.step!==2||after.ai_started!==false||
 after.checkpoint?.cost_cents!==0)
 throw Error("C4_SAME_OWNER_SAVED_REPAIR_NOT_RECOVERABLE");
console.log("C4 REAL: new repaired source saved to SAME owner, SAME Job, revision4, no AI charge");
await dispatch();
const passed=await awaitReceipt(repaired.project_hash,"PASS");
if(passed.revision!==4)throw Error("C4_FINAL_JOB_REVISION_MISMATCH");
const asset=await signed(base+"/free-ci-preview",{
 anonymous_id:owner,expected_project_hash:repaired.project_hash});
const again=await signed(base+"/free-ci-preview",{
 anonymous_id:owner,expected_project_hash:repaired.project_hash});
if(typeof asset.javascript!=="string"||asset.javascript.length<100||
 asset.javascript!==again.javascript||asset.css!==again.css||
 asset.index_html!==again.index_html)
 throw Error("C4_REPAIRED_PRIVATE_APP_CANNOT_REOPEN");
console.log("C4 FREE LIVE PIPELINE PASS: one signed Job, frozen QA, first Chromium FAIL,");
console.log("manual corrected source DURABLY saved revision4, new Chromium PASS, reopened");
console.log("C4 LIMIT: creator-provided repair, NOT automatic paid GPT-6 model repair");
