/**
 * Real browser-to-Worker multi-file coding agent. All requests use fresh
 * owner-bound P-256 proof, explicit bounded AI/container consent, no retries.
 * Candidate source is not a published or independently verified App.
 */
import {createBrowserIdentityDependencies,ensureAnonymousId}
 from "../../platform/identity/browser-identity.js";
import {mutationProofTranscript} from "../../edge/create-proof.js";
import {PopKeyring,type PopKey} from "../create/pop-keyring.js";
import {createBrowserPopKeyPersistence} from "../shell/tab-app-recovery.js";

const SLOT="appf2.agent.candidate.job.v1";
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const MAX_TURNS_PER_CLICK=6;
export type CandidateFile={readonly path:string;readonly content:string};
export type CandidateJob={readonly job_id:string;readonly revision:number;
 readonly project_hash:string;readonly status:string;
 readonly files:readonly CandidateFile[];
 readonly checkpoint:{readonly step:number;readonly budget:{
  readonly max_steps:number;readonly max_cost_cents:number;
  readonly max_tokens:number}};
 readonly app_published:false};
type Progress={readonly revision:number;readonly can_resume:boolean;
 readonly resume_model_call_key:string|null;readonly next_action:string;
 readonly calls:readonly {model_call_key:string;state:string;
  tool:string|null;requires_container_consent:boolean}[]};
type Step={readonly status:string;readonly action:string;readonly revision:number};
export type CandidateSnapshot={readonly job:CandidateJob;readonly progress:Progress|null;
 readonly message:string;readonly completed_steps:number};
export type AgentStoredTarget={readonly jobId:string;readonly prompt:string;
 readonly firstModelKey:string};
export type AgentBrowserOptions={readonly allowAi:boolean;
 readonly allowContainer:boolean;readonly approvedCents:number};
const encoder=new TextEncoder();
function validatedTarget(v:unknown):AgentStoredTarget|null{
 if(typeof v!=="object"||v===null||Array.isArray(v))return null;
 const x=v as Record<string,unknown>;
 if(!ID.test(String(x.jobId))||typeof x.prompt!=="string"||
  x.prompt.length<5||x.prompt.length>800||typeof x.firstModelKey!=="string"||
  !/^[A-Za-z0-9_-]{8,80}$/u.test(x.firstModelKey))return null;
 return {jobId:String(x.jobId),prompt:x.prompt,firstModelKey:x.firstModelKey};
}
export function savedCandidateTarget():AgentStoredTarget|null{
 try {return validatedTarget(JSON.parse(sessionStorage.getItem(SLOT)??"null"));}
 catch{return null;}
}
function saveTarget(value:AgentStoredTarget):void{
 try{sessionStorage.setItem(SLOT,JSON.stringify(value));}
 catch{ /* Browser can still operate until reload. */ }
}
function ring():PopKeyring{
 return new PopKeyring({subtle:crypto.subtle,now:Date.now,
  persistence:createBrowserPopKeyPersistence()});
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
 async create(prompt:string,opts:AgentBrowserOptions):Promise<AgentStoredTarget>{
  if(!opts.allowAi||prompt.trim().length<5||prompt.length>800||
   !Number.isSafeInteger(opts.approvedCents)||opts.approvedCents<8||
   opts.approvedCents>100)throw Error("請先核准 AI 費用上限與需求。");
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
   firstModelKey:"agent_first_"+crypto.randomUUID()};
  saveTarget(this.target);
  return this.target;
 }
 async restore():Promise<AgentStoredTarget|null>{
  const saved=savedCandidateTarget();
  if(!saved)return null;
  this.target=saved;
  await this.signer();
  return saved;
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
 shouldStop:()=>boolean=()=>false):Promise<CandidateSnapshot>{
  if(!opts.allowAi)throw Error("AI 執行必須經過明確同意。");
  let completed=0;
  let message="已保存專案；準備讀取持久化 Agent 狀態。";
  for(let i=0;i<MAX_TURNS_PER_CLICK&&!shouldStop();i++){
   const progress=await this.progress();
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
   const next=progress.calls.find(x=>x.model_call_key===progress.resume_model_call_key);
   if(next?.requires_container_consent&&!opts.allowContainer){
    message="已保存 AI 程式，建置／測試需要你另外授權容器費用。";
    break;
   }
   const body={
    anonymous_id:this.owner,model_call_key:progress.resume_model_call_key,
    expected_revision:progress.revision,
    ...(opts.allowContainer?{explicit_container_consent:true,max_container_charge_cents:5}:{}),
    explicit_ai_consent:true,next_model_call_key:"agent_next_"+crypto.randomUUID(),
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
  if(completed===MAX_TURNS_PER_CLICK)
   message="本次最多六步已完成；可從保存的進度繼續，不會重跑已完成步驟。";
  return {job,progress,message,completed_steps:completed};
 }
}
