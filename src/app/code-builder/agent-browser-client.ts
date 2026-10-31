/**
 * Real browser-to-Worker multi-file coding agent. All requests use fresh
 * owner-bound P-256 proof, explicit bounded AI/container consent, no retries.
 * Candidate source is not a published or independently verified App.
 */
import {createBrowserIdentityDependencies,ensureAnonymousId}
 from "../../platform/identity/browser-identity.js";
import {mutationProofTranscript} from "../../edge/create-proof.js";
import {PopKeyring,AGENT_OWNER_PROOF_LIFETIME_MS,type PopKey} from "../create/pop-keyring.js";
import {createBrowserPopKeyPersistence} from "../shell/tab-app-recovery.js";
import {parseQaPlan,type QaPlan} from "../../platform/qa/requirement-contract.js";
import {qaRepairCallKey} from "../../platform/agent/qa-repair-key.js";
import {previewAssetPaths,type PrivatePreviewAsset,type PreviewSource}
 from "./agent-private-preview.js";

const SLOT="appf2.agent.candidate.job.v1";
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export const MAX_TURNS_PER_CLICK=6;
const KEY=/^[A-Za-z0-9_-]{8,80}$/u;
/** Same job, saved tool and CAS head always use the same paid model-call key.
 * If the browser loses an HTTP response, a later resume cannot accidentally
 * invent a distinct billable continuation for the same durable tool result.
 * The Worker still fences unknown outcomes and requires fresh signed consent.
 */
export async function stableAgentContinuationKey(kind:"agent_recover"|"agent_next",
 jobId:string,priorModelKey:string,revision:number):Promise<string>{
 if(!ID.test(jobId)||!KEY.test(priorModelKey)||
  !Number.isSafeInteger(revision)||revision<0)
  throw Error("AGENT_CONTINUATION_KEY_INVALID");
 const bytes=new TextEncoder().encode("APPF2_AGENT_CONTINUATION_KEY_V1:"+
  JSON.stringify([kind,jobId,priorModelKey,revision]));
 const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
 return kind+"_"+Array.from(digest.slice(0,20),
  b=>b.toString(16).padStart(2,"0")).join("");
}

/** One tool CAS step plus its separately charged model continuation are a
 * two-part transaction. Stop before consuming the last permitted job step so
 * the signed renewal can occur first and both parts remain recoverable.
 */
export function enoughAgentStepsForContinuation(remaining:number):boolean{
 return Number.isSafeInteger(remaining)&&remaining>=2;
}
export type CandidateFile={readonly path:string;readonly content:string;
 readonly hash?:string;readonly bytes?:number};
export type SavedFreeCiSmoke={readonly status:"BUILD_BROWSER_SMOKE"|"BUILD_FAILED";readonly run_id:string;
 readonly failure_stage?:unknown;readonly diagnostic_code?:unknown;
 readonly diagnostic_excerpt?:unknown;
 readonly artifact_hash:string;readonly preview_ready:boolean;
 readonly qa_plan_hash?:string;
 readonly qa_checks?:readonly {criterion_id:string;verdict:"PASS"|"FAIL"|"UNTESTED";evidence_hash:string|null}[];
 readonly original_requirements_qa:false;
 readonly app_published:false};
export type CandidateJob={readonly job_id:string;readonly revision:number;
 readonly free_ci?:SavedFreeCiSmoke|null;
 readonly project_hash:string;readonly status:string;
 readonly files:readonly CandidateFile[];
 readonly checkpoint:{readonly step:number;
 readonly completed_call_ids:readonly string[];readonly budget:{
  readonly max_steps:number;readonly max_cost_cents:number;
  readonly max_tokens:number}};
 readonly app_published:false};
type Progress={readonly revision:number;readonly remaining_steps:number;
 readonly can_resume:boolean;
 readonly resume_model_call_key:string|null;readonly next_action:string;
 readonly can_continue_saved_tool_result?:boolean;
 readonly resume_previous_model_call_key?:string|null;
 readonly qa_attempt_state?:"NOT_RUN"|"IN_FLIGHT"|"BLOCKED_UNCERTAIN"|"RESULT_RECORDED";
 readonly qa_observed_checks?:readonly {criterion_id:string;
  verdict:"PASS"|"FAIL"|"UNTESTED";evidence_hash:string|null}[];
 readonly proven_preview_pair?:{build_call_id:string;test_call_id:string}|null;
 readonly calls:readonly {model_call_key:string;state:string;
  tool:string|null;call_id?:string|null;requires_container_consent:boolean}[]};
/** Progress exposes normalized MODEL_UNCERTAIN / MODEL_PENDING, not the
 * raw DB journal status BLOCKED_UNCERTAIN. Never start paid planning from an
 * unresolved prior call after a reload or an interrupted request.
 */
export function paidAgentReconciliationRequired(progress:Pick<Progress,
 "next_action"|"calls">):boolean{
 return progress.next_action==="AWAIT_MODEL_RECONCILIATION"||
  progress.calls.some(call=>
   call.state==="MODEL_UNCERTAIN"||call.state==="MODEL_PENDING");
}
/** A trusted saved run_build may precede read_file/inspect_project before
 * the latest run_test. Keep the latest tested head and choose the nearest
 * proven saved build, never blindly assume the preceding checkpoint step
 * was a build. The server rechecks both signed Sandbox receipts.
 */
export function provenPreviewBuildAndTest(completed:readonly string[],
 calls:readonly {state:string;tool:string|null;call_id?:string|null}[]):
 {build:string;test:string}|null{
 const test=completed.at(-1);
 if(!test)return null;
 // Known signed model provenance must never contradict the claimed last test.
 const knownTest=calls.find(c=>c.call_id===test);
 if(knownTest&&(knownTest.state!=="ALREADY_APPLIED"||
  knownTest.tool!=="run_test"))return null;
 const buildCandidates=calls.filter(c=>c.state==="ALREADY_APPLIED"&&
  c.tool==="run_build"&&typeof c.call_id==="string").map(c=>c.call_id!);
 const known=buildCandidates.filter(id=>completed.indexOf(id)>=0&&
  completed.indexOf(id)<completed.lastIndexOf(test));
 known.sort((a,b)=>completed.lastIndexOf(b)-completed.lastIndexOf(a));
 const build=known[0]??completed.at(-2);
 const inspectedBuild=calls.find(c=>c.call_id===build);
 if(inspectedBuild&&(inspectedBuild.state!=="ALREADY_APPLIED"||
  inspectedBuild.tool!=="run_build"))return null;
 return build&&build!==test&&completed.indexOf(build)>=0&&
  completed.indexOf(build)<completed.lastIndexOf(test)?
  {build,test}:null;
}
/** Modern Worker returns full-checkpoint signed provenance, so never fall
 * back to guessed neighboring IDs when that authoritative field is null.
 * Older fixture/API schemas may still derive IDs, which the Worker rejects
 * unless its own Sandbox build/test receipts are independently proven.
 */
export function savedPreviewPair(progress:Progress,
 completed:readonly string[]):{build:string;test:string}|null{
 const pair=progress.proven_preview_pair;
 if(pair!==undefined){
  if(!pair||completed.at(-1)!==pair.test_call_id||
   completed.indexOf(pair.build_call_id)<0||
   completed.indexOf(pair.build_call_id)>=completed.lastIndexOf(pair.test_call_id))
   return null;
  return {build:pair.build_call_id,test:pair.test_call_id};
 }
 return provenPreviewBuildAndTest(completed,progress.calls);
}
type Step={readonly status:string;readonly action:string;readonly revision:number};
export type CandidateSnapshot={readonly job:CandidateJob;readonly progress:Progress|null;
 readonly message:string;readonly completed_steps:number};
export type AgentStoredTarget={readonly jobId:string;readonly prompt:string;
 readonly firstModelKey:string;readonly qaPlan?:QaPlan};
export type AgentBrowserOptions={readonly allowAi:boolean;
 readonly allowContainer:boolean;readonly approvedCents:number};
const encoder=new TextEncoder();
function validatedTarget(v:unknown):AgentStoredTarget|null{
 if(typeof v!=="object"||v===null||Array.isArray(v))return null;
 const x=v as Record<string,unknown>;
 if(!ID.test(String(x.jobId))||typeof x.prompt!=="string"||
  x.prompt.length<5||x.prompt.length>800||typeof x.firstModelKey!=="string"||
  !/^[A-Za-z0-9_-]{8,80}$/u.test(x.firstModelKey))return null;
 const qaPlan=x.qaPlan===undefined?undefined:parseQaPlan(x.qaPlan,x.prompt);
 if(x.qaPlan!==undefined&&!qaPlan)return null;
 return {jobId:String(x.jobId),prompt:x.prompt,firstModelKey:x.firstModelKey,
  ...(qaPlan?{qaPlan}:{})};
}
const CANDIDATE_RECOVERY_MS=AGENT_OWNER_PROOF_LIFETIME_MS;
const LIBRARY_SLOT="appf2.agent.candidate.library.v1";
const MAX_RECENT_CANDIDATES=32;
export type SavedCandidate=AgentStoredTarget&{readonly savedAt:number};
/** A small local browser index of persisted jobs, NOT an access grant.
 * Every restore still requires the matching nonextractable IndexedDB key and
 * server-side owner PoP. No code, response body, or API secret is stored.
 */
// eslint-disable-next-line complexity -- Expiry, integrity, duplicate and malformed stored records fail closed.
export function readSavedCandidateLibrary():readonly SavedCandidate[]{
 try{
  const stored=localStorage.getItem(LIBRARY_SLOT);
  // Migrate the previous one-job pointer, preserving the original expiry.
  const legacy=localStorage.getItem(SLOT);
  const raw=stored??(legacy?"["+legacy+"]":null);
  if(!raw||raw.length>250000)return [];
  const parsed:unknown=JSON.parse(raw);
  if(!Array.isArray(parsed))return [];
  const result:SavedCandidate[]=[],seen=new Set<string>();
  for(const item of parsed.slice(0,MAX_RECENT_CANDIDATES*2)){
   if(typeof item!=="object"||item===null||Array.isArray(item))continue;
   const value=item as Record<string,unknown>;
   const age=Date.now()-Number(value.savedAt);
   if(typeof value.savedAt!=="number"||!Number.isFinite(age)||
    age< -60000||age>CANDIDATE_RECOVERY_MS)continue;
   const target=validatedTarget(item);
   if(!target||seen.has(target.jobId))continue;
   seen.add(target.jobId);
   result.push({...target,savedAt:value.savedAt});
   if(result.length>=MAX_RECENT_CANDIDATES)break;
  }
  return result;
 }catch{return [];}
}
/** Selecting a saved card performs no paid operations and does NOT renew age. */
export function chooseSavedCandidate(jobId:string):boolean{
 const entry=readSavedCandidateLibrary().find(x=>x.jobId===jobId);
 if(!entry)return false;
 try{
  localStorage.setItem(SLOT,JSON.stringify(entry));
  sessionStorage.setItem(SLOT,JSON.stringify(entry));
  return true;
 }catch{return false;}
}
/** Persist only the target and frozen requirements in this browser profile.
 * The P-256 private signing key stays nonextractable in IndexedDB; an ID or
 * localStorage record alone never grants creator access. Expire Agent records and keys after 30 days.
 */
export function savedCandidateTarget():AgentStoredTarget|null{
 try{
  const raw=localStorage.getItem(SLOT);
  if(raw!==null){
   if(raw.length>25000){localStorage.removeItem(SLOT);return null;}
   let data:unknown;
   try{data=JSON.parse(raw);}
   catch{localStorage.removeItem(SLOT);return null;}
   if(typeof data!=="object"||data===null||Array.isArray(data)){
    localStorage.removeItem(SLOT);return null;
   }
   const record=data as Record<string,unknown>;
   const age=Date.now()-Number(record.savedAt);
   if(typeof record.savedAt!=="number"||
    !Number.isFinite(age)||age< -60000||age>CANDIDATE_RECOVERY_MS){
    localStorage.removeItem(SLOT);return null;
   }
   const target=validatedTarget(data);
   if(!target)localStorage.removeItem(SLOT);
   return target;
  }
 }catch{ /* Private mode or storage disabled: retain same-tab behavior. */ }
 try{return validatedTarget(JSON.parse(sessionStorage.getItem(SLOT)??"null"));}
 catch{return null;}
}
export function saveTarget(value:AgentStoredTarget):void{
 const prior=readSavedCandidateLibrary();
 // Do not extend a job's 24-hour proof key just by reading/replanning it.
 const savedAt=prior.find(x=>x.jobId===value.jobId)?.savedAt??Date.now();
 const record={...value,savedAt};
 try{sessionStorage.setItem(SLOT,JSON.stringify(record));}
 catch{ /* Private mode can still use live in-memory key. */ }
 try{
  localStorage.setItem(SLOT,JSON.stringify(record));
  const recent=[record,...prior.filter(x=>x.jobId!==value.jobId)]
   .slice(0,MAX_RECENT_CANDIDATES);
  localStorage.setItem(LIBRARY_SLOT,JSON.stringify(recent));
 }catch{ /* Private browsing degrades to tab-only recovery. */ }
}
function ring():PopKeyring{
 return new PopKeyring({subtle:crypto.subtle,now:Date.now,
  persistence:createBrowserPopKeyPersistence(AGENT_OWNER_PROOF_LIFETIME_MS),
  keyLifetimeMs:AGENT_OWNER_PROOF_LIFETIME_MS});
}
type Envelope<T>={data:T};
export class AgentHttpFailure extends Error{
 constructor(readonly status:number,readonly code:string){
  super(status===404?"多檔案 Agent 服務尚未在這個網站啟用。":
   status===503?"服務暫時無法處理；已停止，不會重複付費。":
    "Agent API "+status+"："+code);
 }
}
async function signedPost<T>(path:string,body:object,key:PopKey,
 signal?:AbortSignal):Promise<T>{
 const json=JSON.stringify(body),idempotencyKey="agent_"+crypto.randomUUID();
 const proof=await key.proofHeaders(time=>mutationProofTranscript({
  method:"POST",path,body:encoder.encode(json),idempotencyKey},time));
 const response=await fetch(path,{method:"POST",credentials:"same-origin",
  headers:{...proof,"Content-Type":"application/json",
   "Idempotency-Key":idempotencyKey},body:json,signal});
 let payload:unknown;
 try{payload=await response.json();}catch{payload=null;}
 if(!response.ok){
  const code=typeof payload==="object"&&payload!==null&&"error" in payload?
   String((payload as {error:unknown}).error):"INVALID_RESPONSE";
  throw new AgentHttpFailure(response.status,code);
 }
 if(typeof payload!=="object"||payload===null||!("data" in payload))
  throw Error("Agent API 回傳資料格式不正確；已停止，沒有自動重試。");
 return (payload as Envelope<T>).data;
}
export class BrowserCodingAgent {
 private readonly keys=ring();
 private readonly owner=ensureAnonymousId(createBrowserIdentityDependencies());
 private key:PopKey|null=null;
 private target:AgentStoredTarget|null=null;
 private path():string{
  if(!this.target)throw Error("NO_AGENT_JOB");
  return "/api/v1/agent-jobs/"+this.target.jobId;
 }
 private async signer():Promise<PopKey>{
  if(this.key)return this.key;
  const target=this.target;
  if(!target)throw Error("NO_AGENT_JOB");
  const restored=await this.keys.recoverForIntent(target.jobId);
  if(!restored)throw Error("原建立者的簽章金鑰已過期或遺失；不會重新扣費。");
  this.key=restored;
  return restored;
 }
 private async post<T>(suffix:string,body:object):Promise<T>{
  return signedPost<T>(this.path()+suffix,body,await this.signer());
 }
 async create(prompt:string,opts:AgentBrowserOptions,
  qaPlan?:QaPlan):Promise<AgentStoredTarget>{
  if(qaPlan&&!parseQaPlan(qaPlan,prompt.trim()))
   throw Error("原始驗收計畫與需求不一致，已停止。");
  if(!opts.allowAi||prompt.trim().length<5||prompt.length>800||
   !Number.isSafeInteger(opts.approvedCents)||
   opts.approvedCents<(qaPlan?8:16)||opts.approvedCents>100)
   throw Error("自動 QA 規劃需要至少 16 美分的專案總預算（QA 與首次編碼各 8 美分）。");
  const logical="agent_"+crypto.randomUUID();
  const key=await this.keys.keyForCreate(logical);
  const data=await signedPost<{job_id:string}>("/api/v1/agent-jobs",{
   anonymous_id:this.owner,prompt:prompt.trim(),
   explicit_ai_consent:true,max_cost_cents:opts.approvedCents
  },key);
  if(!ID.test(data.job_id))throw Error("Agent 專案識別碼無效。");
  this.keys.bindIntent(logical,data.job_id,key);
  this.key=key;
  this.target={jobId:data.job_id,prompt:prompt.trim(),
   firstModelKey:"agent_first_"+crypto.randomUUID(),
   ...(qaPlan?{qaPlan}:{})};
  saveTarget(this.target);
  if(qaPlan)await this.freezeOriginalQaPlan();
  return this.target;
 }
 async restore():Promise<AgentStoredTarget|null>{
  const saved=savedCandidateTarget();
  if(!saved)return null;
  this.target=saved;
  await this.signer();
  return saved;
 }
 /** PRIVATE source is dispatched by the Worker, never from this browser.
  * The signed POST contains owner identity + consent only; public GitHub Actions
  * gets a short encrypted ticket, not source code or the user's prompt.
  */
 async dispatchFreeCiBuild(explicitConsent:boolean):Promise<void>{
  if(!explicitConsent)throw Error("未核准免費 GitHub Actions 隔離建置。");
  const result=await this.post<{status:string;app_published:false}>(
   "/free-ci-dispatch",{anonymous_id:this.owner,explicit_free_ci_consent:true});
  if(result.status!=="FREE_CI_QUEUED"||result.app_published!==false)
   throw Error("免費 Runner 工作尚未成功排程；進度仍然保留。");
 }
 async read():Promise<CandidateJob>{
  return this.post("",{anonymous_id:this.owner});
 }
 async progress():Promise<Progress>{
  return this.post("/agent-progress",{anonymous_id:this.owner});
 }
 /** A fresh explicit owner-signed step-only renewal. No additional money is
  * authorized, no saved tool is replayed, and this never dispatches AI/containers.
  */
 async extendStepsSameCost():Promise<CandidateJob>{
  const current=await this.read(),cp=current.checkpoint;
  if(!cp||!Number.isSafeInteger(cp.budget.max_steps)||
   !Number.isSafeInteger(cp.budget.max_cost_cents)||
   cp.budget.max_steps>=512||cp.budget.max_steps<8)
   throw Error("專案步數上限不允許延長。");
  const next=Math.min(512,cp.budget.max_steps+16);
  await this.post("/extend-budget",{
   anonymous_id:this.owner,expected_revision:current.revision,
   explicit_budget_consent:true,new_max_steps:next,
   new_max_cost_cents:cp.budget.max_cost_cents
  });
  const saved=await this.read();
  if(saved.checkpoint.budget.max_steps!==next||
   saved.checkpoint.budget.max_cost_cents!==cp.budget.max_cost_cents||
   saved.project_hash!==current.project_hash)
   throw Error("新的步數授權尚未驗證保存，已停止。");
  return saved;
 }
 /** This is allowed only at CREATED/revision 0 before any AI coding.
  * The server enforces the freeze and rejects any later plan changes.
  */
 async freezeOriginalQaPlan():Promise<void>{
  const target=this.target;
  if(!target?.qaPlan)throw Error("沒有可凍結的原始 QA 計畫。");
  await this.post("/qa-plan",{anonymous_id:this.owner,expected_revision:0,
   original_prompt:target.prompt,original_plan:target.qaPlan});
 }
 /** One bounded paid model call, journaled by an immutable job-scoped key.
  * Validate the model plan and freeze it BEFORE the coding model begins.
  * Failed or uncertain outcomes never trigger an additional provider call.
  */
 async generateOriginalQaPlan():Promise<QaPlan>{
  const target=this.target;
  if(!target)throw Error("NO_AGENT_JOB");
  if(target.qaPlan){await this.freezeOriginalQaPlan();return target.qaPlan;}
  const result=await this.post<{original_plan:unknown;status:string}>(
   "/qa-generate",{anonymous_id:this.owner,expected_revision:0,
    original_prompt:target.prompt,explicit_ai_consent:true,
    max_charge_cents:8,max_output_tokens:4096});
  const plan=parseQaPlan(result.original_plan,target.prompt);
  if(result.status!=="QA_ORIGINAL_PLAN_FROZEN"||!plan)
   throw Error("AI 產生的原始 QA 計畫無法驗證；未開始編碼。");
  this.target={...target,qaPlan:plan};
  saveTarget(this.target);
  return plan;
 }
 /** Owner-signed, journaled per-call AI model in the SAME Worker Job.
  * One paid call per phase; server stores reservation BEFORE provider fetch.
  * Each phase is an explicit original-creator consent, never a blind retry.
  */
 async freeAiStage(stage:"QA"|"CODE"|"REPAIR"):Promise<{
  readonly status:string;readonly original_plan?:QaPlan;
  readonly project_hash?:string;readonly revision?:number;
  readonly app_published:false
 }>{
  const target=this.target;
  if(!target)throw Error("NO_AGENT_JOB");
  const job=await this.read();
  const result=await this.post<{status:string;original_plan?:QaPlan;
   project_hash?:string;revision?:number;app_published:false}>(
   "/free-ai-stage",{anonymous_id:this.owner,
    original_prompt:target.prompt,expected_project_hash:job.project_hash,
    stage,explicit_ai_consent:true,explicit_free_ci_consent:true});
  if(result.app_published!==false)
   throw Error("付費 AI 處理不得直接發布 App。");
  if(result.original_plan){
   const parsed=parseQaPlan(result.original_plan,target.prompt);
   if(!parsed)throw Error("原始需求驗收計畫不可驗證。");
   this.target={...target,qaPlan:parsed};
   saveTarget(this.target);
  }
  return result;
 }
 /** Explicit, separately signed PUBLIC release of a fully QA-passing saved App.
  * The server refuses missing plans, FAIL, UNTESTED and stale hashes.
  * Only an owner-signed click may make the resulting /code/ card shareable.
  */
 async publishFreeCiApp(title:string,consent:boolean):Promise<{
  share_id:string;url:string;blueprint_hash:string;status:"ACTIVE"}>{
  if(!consent||title.trim().length<1||title.length>80)
   throw Error("需要建立者明確同意公開分享此 App。");
  const target=this.target;
  if(!target)throw Error("NO_AGENT_JOB");
  const job=await this.read();
  if(!job.free_ci?.preview_ready)
   throw Error("未完成免費 Docker 與 Browser QA，禁止公開。");
  const share=await this.post<{share_id:string;url:string;
   blueprint_hash:string;status:"ACTIVE"}>("/publish-code-app",{
    anonymous_id:this.owner,expected_project_hash:job.project_hash,
    original_prompt:target.prompt,title:title.trim(),
    explicit_public_share_consent:true});
  if(share.status!=="ACTIVE"||!ID.test(share.share_id)||
   share.url!=="/code/"+share.share_id)
   throw Error("正式分享的資料庫紀錄尚未驗證，停止。");
  return share;
 }
 /** Reopen the exact free-Runner-built private Vite bundle stored in DB.
  * This fetches immutable bytes only, with fresh original-owner P-256 PoP.
  * No model call, Docker rebuild, Containers charge or public grant.
  */
 async freeCiPreview():Promise<PreviewSource>{
  const job=await this.read();
  if(!job.free_ci?.preview_ready||job.free_ci.app_published!==false)
   throw Error("此版本尚無免費 Docker 可操作建置成果。");
  const result=await this.post<PreviewSource&{app_published:false}>(
   "/free-ci-preview",{anonymous_id:this.owner,
    expected_project_hash:job.project_hash});
  if(result.project_hash!==job.project_hash||
   result.app_published!==false)
   throw Error("免費 Docker 私人預覽版本不符，停止讀取。");
  return result;
 }
 /** Read already built assets using the original creator PoP. This may wake
  * the private container, so it requires a fresh explicit click consent.
  * No AI, build, test, or publication occurs here.
  */
 async privatePreview(explicitConsent:boolean):Promise<PreviewSource>{
  if(!explicitConsent)throw Error("必須另外授權存取雲端已建置 App 才能預覽。");
  const job=await this.read(),ids=job.checkpoint.completed_call_ids;
  if(!["TESTING","REPAIRING"].includes(job.status)||ids.length<2)
   throw Error("目前沒有通過隔離建置與測試的 App 可預覽。");
  const recorded=await this.progress();
  const pair=savedPreviewPair(recorded,ids);
  if(!pair)throw Error("找不到已證明的建置與測試結果。");
  const {build,test}=pair;
  const get=async(path:string)=>{
   const result=await this.post<PrivatePreviewAsset>("/preview-asset",{
    anonymous_id:this.owner,expected_revision:job.revision,
    project_hash:job.project_hash,build_call_id:build,test_call_id:test,
    path,explicit_container_preview_consent:true
   });
   if(result.path!==path||result.project_hash!==job.project_hash||
    typeof result.text!=="string")
    throw Error("私人 App 建置資產不符，停止預覽。");
   return result.text;
  };
  const index=await get("index.html");
  const paths=previewAssetPaths(index);
  // Only standard Vite single-module output is previewed; unsupported
  // chunks fail visibly rather than loading arbitrary remote code.
  const javascript=await get(paths.script);
  const styles=await Promise.all(paths.styles.map(get));
  return {project_hash:job.project_hash,index_html:index,
   javascript,css:styles.join("\n")};
 }
 /** Independently execute browser acceptance only after a proven build/test.
  * Caller consent is per click, and repeated requests never retry a paid run.
  */
 async independentQa(explicitConsent:boolean,reconcileOnly=false){
  const target=this.target;
  if(!explicitConsent||!target?.qaPlan)
   throw Error("需要開發前凍結的 QA 計畫與獨立瀏覽器費用授權。");
  const job=await this.read();
  const completed=job.checkpoint.completed_call_ids;
  if(job.status!=="TESTING"||!Array.isArray(completed)||completed.length<2)
   throw Error("必須先有已保存的隔離建置與測試，才能啟動獨立 QA。");
  const recorded=await this.progress();
  const pair=savedPreviewPair(recorded,completed);
  if(!pair)throw Error("找不到已保存且順序正確的建置與測試證據。");
  return this.post<{status:string;ready_for_review:boolean;checks:readonly {
   criterion_id:string;verdict:string}[];app_published:false}>("/qa-run",{
   anonymous_id:this.owner,job_id:target.jobId,
   expected_revision:job.revision,project_hash:job.project_hash,
   build_call_id:pair.build,test_call_id:pair.test,
   original_prompt:target.prompt,original_plan:target.qaPlan,
   explicit_browser_qa_consent:true,
   ...(reconcileOnly?{reconcile_only:true}: {})
  });
 }
 /** AI repair is a separate P-256 signed, explicitly paid action.
  * Never initiated automatically by the Browser QA response.
  */
 async repairFailedQa(explicitConsent:boolean){
  const target=this.target;
  if(!explicitConsent||!target?.qaPlan)
   throw Error("修復 AI 費用尚未核准，或缺少原始 QA 計畫。");
  const job=await this.read();
  if(job.status!=="REPAIRING")throw Error("尚無已驗證失敗的 QA 可修復。");
  return this.post<{status:string;response_id:string;app_published:false}>(
   "/qa-repair",{anonymous_id:this.owner,expected_revision:job.revision,
    model_call_key:qaRepairCallKey(job.project_hash),
    original_prompt:target.prompt,original_plan:target.qaPlan,
    max_charge_cents:8,max_output_tokens:4096,explicit_ai_consent:true
   });
 }
 /** Initial AI call is explicit; never automatically repeats if its outcome is uncertain. */
 async plan():Promise<void>{
  if(!this.target)throw Error("NO_AGENT_JOB");
  await this.post("/model-plan",{anonymous_id:this.owner,prompt:this.target.prompt,
   model_call_key:this.target.firstModelKey,max_charge_cents:8,
   max_output_tokens:4096,explicit_ai_consent:true});
 }
 /** At most six steps per click; every AI and Sandbox side effect independently signed.
  * No request is reissued after any network error or unknown paid outcome.
  */
 // eslint-disable-next-line complexity -- One authorized response per tool, no retry on uncertain charge.
 async advance(opts:AgentBrowserOptions,onProgress:(s:CandidateSnapshot)=>void,
 shouldStop:()=>boolean=()=>false,
 maxTurns=MAX_TURNS_PER_CLICK):Promise<CandidateSnapshot>{
  if(!Number.isSafeInteger(maxTurns)||maxTurns<0||maxTurns>MAX_TURNS_PER_CLICK)
   throw Error("AGENT_STEP_LIMIT_INVALID");
  if(!opts.allowAi)throw Error("AI 執行必須經過明確同意。");
  let completed=0;
  let message="已保存專案；準備讀取持久化 Agent 狀態。";
  for(let i=0;i<maxTurns&&!shouldStop();i++){
   const progress=await this.progress();
   if(progress.can_continue_saved_tool_result&&
    progress.resume_previous_model_call_key){
    if(progress.remaining_steps<1){
     message="工作步數已用盡，請先簽章延長（不會增加已核准費用）。";
     break;
    }
    // The preceding tool already changed the durable project. Do NOT replay
    // it or invent its output; continue from the saved model response/receipt.
    await this.post("/model-continue",{
     anonymous_id:this.owner,
     previous_model_call_key:progress.resume_previous_model_call_key,
     model_call_key:await stableAgentContinuationKey("agent_recover",
      this.target!.jobId,progress.resume_previous_model_call_key,progress.revision),
     expected_revision:progress.revision,
     max_charge_cents:8,max_output_tokens:4096,explicit_ai_consent:true
    });
    completed++;
    message="已從保存的工具結果接續 AI，沒有重新執行已完成工具。";
    onProgress({job:await this.read(),progress:await this.progress(),
     message,completed_steps:completed});
    continue;
   }
   if(!progress.can_resume||!progress.resume_model_call_key){
    message=progress.next_action==="BUDGET_RENEWAL_REQUIRED"?
     "已達本次工作步數上限；可簽章延長步數，不會增加已核准費用。":
     progress.next_action==="VERIFY_INDEPENDENT_QA"?
     "AI 已停止產生工具指令，等待依原需求獨立 QA，尚未發布。":
     progress.next_action==="AWAIT_MODEL_RECONCILIATION"?
      "AI 費用結果不確定，已安全暫停；不會再次付費。":
      "目前沒有可安全接續的模型步驟。";
    break;
   }
   if(!enoughAgentStepsForContinuation(progress.remaining_steps)){
    message="工作步數只剩最後一格；為避免先執行再中斷，請先簽章延長 16 步（費用上限不變）。";
    break;
   }
   const next=progress.calls.find(x=>x.model_call_key===progress.resume_model_call_key);
   if(next?.requires_container_consent&&!opts.allowContainer){
    message="已保存 AI 程式，建置／測試需要你另外授權容器費用。";
    break;
   }
   const body={
    anonymous_id:this.owner,model_call_key:progress.resume_model_call_key,
    expected_revision:progress.revision,
    ...(opts.allowContainer?{explicit_container_consent:true,max_container_charge_cents:5}:{}),
    explicit_ai_consent:true,next_model_call_key:await stableAgentContinuationKey(
     "agent_next",this.target!.jobId,progress.resume_model_call_key,
     progress.revision),
    max_ai_charge_cents:8,max_output_tokens:4096
   };
   const applied=await this.post<Step>("/auto-step",body);
   completed++;
   message=applied.status==="MODEL_RESPONSE_SAVED"?
    "AI 已保存下一回合，正在處理下一步…":
    applied.status==="AWAITING_CONTAINER_CONSENT"?
     "需另行授權 Cloudflare Sandbox 建置費用。":
     applied.status==="INDEPENDENT_QA_REQUIRED"?
      "生成及測試結果待獨立 QA，尚未發布。":
      "已保存最新專案；需要新一輪授權才會繼續。";
   onProgress({job:await this.read(),progress:await this.progress(),message,completed_steps:completed});
   if(applied.status!=="MODEL_RESPONSE_SAVED")break;
  }
  const job=await this.read(),progress=await this.progress();
  if(completed===maxTurns&&maxTurns===MAX_TURNS_PER_CLICK)
   message="本次最多六步已完成；可從保存的進度繼續，不會重跑已完成步驟。";
  return {job,progress,message,completed_steps:completed};
 }
}
