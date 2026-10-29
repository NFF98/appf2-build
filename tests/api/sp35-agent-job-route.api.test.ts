import {describe,it,expect} from "vitest";
import {createWorkerFetch} from "../../src/edge/worker-entry.js";
import type {Appf2WorkerEnv} from "../../src/edge/worker-composition.js";
import type {AgentJobRouteDeps} from "../../src/edge/agent-jobs.js";
import type {AgentJobRow} from "../../src/platform/agent/postgres-agent-jobs.js";
import type {AgentCheckpoint} from "../../src/platform/agent/agent-contract.js";
import type {ModelCallRow} from "../../src/platform/agent/postgres-model-calls.js";
import {sha256CodeBytes} from "../../src/platform/blueprint/code-artifact-v2.js";
import type {WorkerRequestDbContext} from "../../src/platform/blueprint/worker-postgres-executor.js";
const ORIGIN="https://app.example";
const OWNER="c264c7c2-a967-4fbc-b201-ae9e942e03bc";
const JOB_ID="ba45436c-c3f1-44f1-adc6-bdd0fb1592e7";
const TIME=Date.now();
type SourceRow={project_hash:string;parent_hash:null|string;project_revision:number;snapshot:unknown};
const env:Appf2WorkerEnv={
 HYPERDRIVE_FRESH:{connectionString:"postgres://not-used"},
 HYPERDRIVE_F02_ADMISSION:{connectionString:"postgres://not-used"},
 HYPERDRIVE_F07_EVENTS:{connectionString:"postgres://not-used"},
 APPF2_MODEL_BASE_URL:"https://not-used.invalid/v1",APPF2_MODEL_API_KEY:"none",
 APPF2_MODEL_NAME:"none",
 APPF2_IDENTITY_COOKIE_SECRET:"0123456789abcdef0123456789abcdef",
 APPF2_AGENT_CANDIDATE_ENABLED:"1"
};
const b64=(b:Uint8Array)=>Buffer.from(b).toString("base64url");
type Client={privateKey:CryptoKey;publicKey:Uint8Array<ArrayBuffer>};
async function client():Promise<Client>{
 const pair=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"]);
 return {privateKey:pair.privateKey,publicKey:new Uint8Array(await crypto.subtle.exportKey("spki",pair.publicKey))};
}
async function signed(person:Client,path:string,body:object,key:string,origin=ORIGIN):Promise<Request>{
 const bytes=new TextEncoder().encode(JSON.stringify(body));
 const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
 const transcript=new TextEncoder().encode(JSON.stringify([
  "APPF2_MUTATION_PoP_V1","POST",path,b64(digest),key,TIME]));
 const signature=new Uint8Array(await crypto.subtle.sign(
  {name:"ECDSA",hash:"SHA-256"},person.privateKey,transcript));
 return new Request(ORIGIN+path,{method:"POST",headers:{
  "Content-Type":"application/json","Origin":origin,"Sec-Fetch-Site":"same-origin",
  "Idempotency-Key":key,"X-Appf2-PoP-Key":b64(person.publicKey),
  "X-Appf2-PoP-Signature":b64(signature),"X-Appf2-PoP-Timestamp":String(TIME)
 },body:bytes});
}
class Database {
 readonly snapshots=new Map<string,SourceRow>();
 jobs=new Map<string,AgentJobRow>();
 modelCalls=new Map<string,ModelCallRow>();
 sandboxCalls=new Map<string,{status:string;receipt_json:unknown|null;job_id:string;owner_anonymous_id:string;call_id:string;model_call_key:string;job_revision:number;checkpoint_hash:string;project_hash:string;call_hash:string;max_charge_cents:number}>();
 identities=new Map<string,{thumb:string;key:string}>();
 context:WorkerRequestDbContext|null=null;
 readonly db={
  close:async()=>undefined,
  // eslint-disable-next-line complexity, max-lines-per-function -- Test-only scoped SQL fake.
  query:async<T>(sql:string,args:readonly unknown[]):Promise<{rows:readonly T[]}>=>{
   if(sql.startsWith("UPDATE public.appf2_agent_job")){
    const row=this.jobs.get(String(args[0]));
    if(!row||row.revision!==args[2]||row.checkpoint_hash!==args[7])
     return {rows:[]};
    const checkpoint=JSON.parse(String(args[6])) as AgentCheckpoint;
    this.jobs.set(row.job_id,{...row,revision:row.revision+1,
     project_hash:String(args[4]),checkpoint_hash:String(args[3]),
     checkpoint,job_state:String(args[5])});
    return {rows:[{job_id:row.job_id} as T]};
   }
   if(sql.startsWith("SELECT job_id::text,owner_anonymous_id::text,call_id")){
    const row=this.sandboxCalls.get(String(args[2]));
    return {rows:row&&row.owner_anonymous_id===args[1]?[row as T]:[]};
   }
   if(sql.startsWith("SELECT appf2_internal.reserve_agent_sandbox_call")){
    const [jobId,modelKey,id,revision,cpHash,projectHash,hash,charge]=args;
    const job=this.jobs.get(String(jobId)),model=this.modelCalls.get(String(modelKey));
    if(!job||!model||model.status!=="SUCCEEDED"||
     job.revision!==revision||job.checkpoint_hash!==cpHash||
     job.project_hash!==projectHash||
     model.job_revision!==revision||model.checkpoint_hash!==cpHash)
     throw Error("SANDBOX_FAKE_ADMISSION_FAILED");
    const prior=this.sandboxCalls.get(String(id));
    if(prior)return {rows:[{status:prior.status} as T]};
    if([...this.sandboxCalls.values()].some(row=>
     ["RESERVED","IN_FLIGHT","BLOCKED_UNCERTAIN"].includes(row.status)))
     throw Error("SANDBOX_FAKE_ACTIVE");
    const paid=[...this.modelCalls.values()].reduce((sum,r)=>sum+r.max_charge_cents,0);
    const container=[...this.sandboxCalls.values()].reduce((sum,r)=>sum+r.max_charge_cents,0);
    if(paid+container+Number(charge)>job.checkpoint.budget.max_cost_cents)
     throw Error("SANDBOX_FAKE_BUDGET");
    const row={job_id:String(jobId),owner_anonymous_id:job.owner_anonymous_id,
     call_id:String(id),model_call_key:String(modelKey),job_revision:Number(revision),
     checkpoint_hash:String(cpHash),project_hash:String(projectHash),
     call_hash:String(hash),max_charge_cents:Number(charge),
     status:"RESERVED",receipt_json:null};
    this.sandboxCalls.set(row.call_id,row);
    return {rows:[{status:"RESERVED"} as T]};
   }
   if(sql.startsWith("UPDATE public.appf2_agent_sandbox_call")){
    const row=this.sandboxCalls.get(String(args[2]));
    if(!row)return {rows:[]};
    if(sql.includes("SET status='IN_FLIGHT'")){
     if(row.status!=="RESERVED"||row.call_hash!==args[3]||
      row.checkpoint_hash!==args[4])return {rows:[]};
     this.sandboxCalls.set(row.call_id,{...row,status:"IN_FLIGHT"});
    }else if(sql.includes("SET status='SUCCEEDED'")){
     if(row.status!=="IN_FLIGHT")return {rows:[]};
     this.sandboxCalls.set(row.call_id,{...row,status:"SUCCEEDED",
      receipt_json:JSON.parse(String(args[3])) as unknown});
    }else if(sql.includes("SET status='BLOCKED_UNCERTAIN'")){
     if(row.status!=="IN_FLIGHT")return {rows:[]};
     this.sandboxCalls.set(row.call_id,{...row,status:"BLOCKED_UNCERTAIN"});
    }else throw Error("SANDBOX_FAKE_SQL_UNKNOWN");
    return {rows:[{call_id:row.call_id} as T]};
   }
   if(sql.startsWith("SELECT appf2_internal.reserve_agent_model_call")){
    const current=this.jobs.get(String(args[0]));
    if(!current||current.revision!==args[2]||current.checkpoint_hash!==args[3])
     throw Error("INVALID_RESERVATION");
    const old=this.modelCalls.get(String(args[1]));
    if(old)return {rows:[{status:old.status} as T]};
    const row:ModelCallRow={
     job_id:String(args[0]),owner_anonymous_id:current.owner_anonymous_id,
     call_key:String(args[1]),job_revision:Number(args[2]),
     checkpoint_hash:String(args[3]),request_hash:String(args[4]),
     model:String(args[5]),max_charge_cents:Number(args[6]),
     status:"RESERVED",response_json:null,response_id:null,
     input_tokens:null,output_tokens:null
    };
    this.modelCalls.set(row.call_key,row);
    return {rows:[{status:"RESERVED"} as T]};
   }
   if(sql.startsWith("SELECT job_id::text,owner_anonymous_id::text,call_key")){
    const row=this.modelCalls.get(String(args[2]));
    return {rows:row&&row.owner_anonymous_id===args[1]?[row as T]:[]};
   }
   if(sql.startsWith("UPDATE public.appf2_agent_model_call")){
    const row=this.modelCalls.get(String(args[2]));
    if(!row)return {rows:[]};
    if(sql.includes("SET status='IN_FLIGHT'")){
     if(row.status!=="RESERVED")return {rows:[]};
     this.modelCalls.set(row.call_key,{...row,status:"IN_FLIGHT"});
    }else if(sql.includes("SET status='SUCCEEDED'")){
     if(row.status!=="IN_FLIGHT")return {rows:[]};
     this.modelCalls.set(row.call_key,{...row,status:"SUCCEEDED",
      response_json:JSON.parse(String(args[3])) as unknown,response_id:String(args[4]),
      input_tokens:Number(args[5]),output_tokens:Number(args[6])});
    }else if(sql.includes("SET status='BLOCKED_UNCERTAIN'")){
     if(row.status!=="IN_FLIGHT")return {rows:[]};
     this.modelCalls.set(row.call_key,{...row,status:"BLOCKED_UNCERTAIN"});
    }else throw Error("UNKNOWN_MODEL_TRANSITION");
    return {rows:[{call_key:row.call_key} as T]};
   }
   if(sql.startsWith("INSERT INTO public.appf2_agent_project_snapshot")){
    const key=String(args[0])+":"+String(args[1]);
    if(!this.snapshots.has(key))this.snapshots.set(key,{
     project_hash:String(args[1]),parent_hash:args[2] as string|null,
     project_revision:Number(args[3]),snapshot:JSON.parse(String(args[4])) as unknown});
    return {rows:[{project_hash:args[1]} as T]};
   }
   if(sql.startsWith("SELECT project_hash,parent_hash,project_revision,snapshot")){
    const row=this.snapshots.get(String(args[0])+":"+String(args[1]));
    return {rows:row?[row as T]:[]};
   }
   if(sql.startsWith("INSERT INTO public.appf2_agent_job")){
    const owner=String(args[1]),thumb=String(args[2]),key=String(args[3]);
    const found=Array.from(this.identities.values()).some(i=>i.thumb===thumb&&i.key===key);
    if(found)return {rows:[]};
    const cp=JSON.parse(String(args[7])) as AgentCheckpoint;
    const row:AgentJobRow={job_id:String(args[0]),owner_anonymous_id:owner,
     request_hash:String(args[4]),project_hash:String(args[6]),revision:0,
     checkpoint_hash:String(args[5]),checkpoint:cp,job_state:cp.state};
    this.jobs.set(row.job_id,row);
    this.identities.set(row.job_id,{thumb,key});
    return {rows:[{job_id:row.job_id} as T]};
   }
   if(sql.includes("FROM public.appf2_agent_job")&&sql.includes("owner_key_thumbprint")){
    if(sql.startsWith("SELECT job_id::text\n")){
     const id=String(args[0]),r=this.jobs.get(id),ident=this.identities.get(id);
     return {rows:r?.owner_anonymous_id===args[1]&&ident?.thumb===args[2]?[{job_id:id} as T]:[]};
    }
    const id=Array.from(this.identities.entries()).find(entry=>
     entry[1].thumb===args[1]&&entry[1].key===args[2])?.[0];
    return {rows:id?[{job_id:id} as T]:[]};
   }
   if(sql.startsWith("SELECT job_id::text,owner_anonymous_id::text,request_hash")){
    const row=this.jobs.get(String(args[0]));
    return {rows:row&&row.owner_anonymous_id===args[1]?[row as T]:[]};
   }
   throw Error("UNEXPECTED_DATABASE_STATEMENT");
  }
 };
 makeDeps():AgentJobRouteDeps{
  return {db:(_env,ctx)=>{this.context=ctx;return this.db;},newJobId:()=>JOB_ID};
 }
}
describe("Sprint 3.5 live Worker candidate Agent Job API (cryptographic signed requests; no AI)",()=>{
 it("signed first-party request creates multi-file durable Job; retry and signed reopen work",async()=>{
  const person=await client(),database=new Database();
  const fetch=createWorkerFetch({}, {now:()=>TIME,agent:database.makeDeps()});
  const key="appf2_agent_create_123456";
  const prompt="做一個可以用手機玩的多人骰子遊戲";
  const body={anonymous_id:OWNER,prompt};
  const one=await fetch(await signed(person,"/api/v1/agent-jobs",body,key),env);
  expect(one.status).toBe(201);
  const first=await one.json() as {data:{job_id:string;files:{path:string}[];ai_started:boolean}};
  expect(first.data.job_id).toBe(JOB_ID);
  expect(first.data.files.map(f=>f.path)).toEqual(["index.html","package.json","src/main.ts","src/style.css"]);
  expect(first.data.ai_started).toBe(false);
  expect(database.jobs.size).toBe(1);
  const again=await fetch(await signed(person,"/api/v1/agent-jobs",body,key),env);
  expect(again.status).toBe(201);
  expect(database.jobs.size).toBe(1);
  const path="/api/v1/agent-jobs/"+JOB_ID;
  const reopened=await fetch(await signed(person,path,{anonymous_id:OWNER},"agent_read_12345678"),env);
  expect(reopened.status).toBe(200);
  const view=await reopened.json() as {data:{files:{path:string;content:string}[];checkpoint:{step:number}}};
  expect(view.data.files.find(f=>f.path==="src/main.ts")?.content).toContain(prompt);
  expect(view.data.checkpoint.step).toBe(0);
  expect(database.context?.anonymousId).toBe(OWNER);
 });
 it("wrong PoP key or guessed anonymous UUID cannot read another creator's source",async()=>{
  const owner=await client(),attacker=await client(),database=new Database();
  const fetch=createWorkerFetch({}, {now:()=>TIME,agent:database.makeDeps()});
  await fetch(await signed(owner,"/api/v1/agent-jobs",
   {anonymous_id:OWNER,prompt:"私人的四顆骰子遊戲"},"agent_create_123456"),env);
  const path="/api/v1/agent-jobs/"+JOB_ID;
  const stolen=await fetch(await signed(attacker,path,
   {anonymous_id:OWNER},"attacker_read_12345"),env);
  expect(stolen.status).toBe(404);
  expect(await stolen.text()).not.toContain("src/main.ts");
 });
 it("rejects unsigned, cross-origin and disabled requests before any DB connection",async()=>{
  const person=await client(),database=new Database();
  const fetch=createWorkerFetch({}, {now:()=>TIME,agent:database.makeDeps()});
  const payload={anonymous_id:OWNER,prompt:"建立一個實用計時器"};
  const unsigned=await fetch(new Request(ORIGIN+"/api/v1/agent-jobs",{
   method:"POST",headers:{"Content-Type":"application/json","Origin":ORIGIN,
    "Idempotency-Key":"candidate_123456"},body:JSON.stringify(payload)}),env);
  expect(unsigned.status).toBe(404);
  const wrong=await fetch(await signed(person,"/api/v1/agent-jobs",
   payload,"candidate_123456","https://other.example"),env);
  expect(wrong.status).toBe(404);
  const disabled=await fetch(await signed(person,"/api/v1/agent-jobs",
   payload,"candidate_123456"),{...env,APPF2_AGENT_CANDIDATE_ENABLED:"0"});
  expect(disabled.status).toBe(404);
  expect(database.jobs.size).toBe(0);
  expect(database.context).toBeNull();
 });
});
describe("Sprint 3.5 explicit-consent model planning (offline)",()=>{
 it("signed consent permits one mocked model planning response and durable no-charge replay",async()=>{
  const person=await client(),db=new Database();
  let calls=0;
  const deps={...db.makeDeps(),sendModel:async()=>{
   calls++;
   return {id:"resp_mock12345678",status:"completed",
    usage:{input_tokens:100,output_tokens:50},output:[]};
  }};
  const fetch=createWorkerFetch({}, {now:()=>TIME,agent:deps});
  const prompt="建立一個可以分享的多人骰子遊戲";
  const created=await fetch(await signed(person,"/api/v1/agent-jobs",{
   anonymous_id:OWNER,prompt,max_cost_cents:20,explicit_ai_consent:true
  },"candidate_budget_123456"),env);
  expect(created.status).toBe(201);
  expect(db.jobs.get(JOB_ID)?.checkpoint.budget.max_cost_cents).toBe(20);
  const path="/api/v1/agent-jobs/"+JOB_ID+"/model-plan";
  const plan={anonymous_id:OWNER,prompt,model_call_key:"model_plan_123456",
   max_charge_cents:5,max_output_tokens:512,explicit_ai_consent:true};
  const enabled={...env,APPF2_AGENT_MODEL_EXECUTION_ENABLED:"1",
   APPF2_OPENAI_AGENT_API_KEY:"unit_test_fake_provider_key_123456"};
  const first=await fetch(await signed(person,path,plan,"model_request_123456"),enabled);
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({data:{status:"MODEL_RESPONSE_SAVED",
   source:"PROVIDER",response_id:"resp_mock12345678"}});
  expect(db.jobs.get(JOB_ID)?.checkpoint.state).toBe("PLANNING");
  expect(db.jobs.get(JOB_ID)?.checkpoint.step).toBe(1);
  expect(calls).toBe(1);
  expect(db.modelCalls.get("model_plan_123456")?.status).toBe("SUCCEEDED");
  const replay=await fetch(await signed(person,path,plan,"model_request_123456"),enabled);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({data:{source:"DURABLE_REPLAY"}});
  expect(calls).toBe(1);
 });
 it("rejects model execution without independent feature gate or signed positive consent",async()=>{
  const person=await client(),db=new Database();
  let calls=0;
  const deps={...db.makeDeps(),sendModel:async()=>{calls++;throw Error("SHOULD_NOT_SEND");}};
  const fetch=createWorkerFetch({}, {now:()=>TIME,agent:deps});
  const prompt="做一個有動畫的多人骰子遊戲";
  const created=await fetch(await signed(person,"/api/v1/agent-jobs",{
   anonymous_id:OWNER,prompt
  },"candidate_nobudget_123456"),env);
  expect(created.status).toBe(201);
  const path="/api/v1/agent-jobs/"+JOB_ID+"/model-plan";
  const body={anonymous_id:OWNER,prompt,model_call_key:"model_plan_123456",
   max_charge_cents:5,max_output_tokens:512,explicit_ai_consent:true};
  const disabled=await fetch(await signed(person,path,body,"model_request_123456"),env);
  expect(disabled.status).toBe(404);
  const enabled={...env,APPF2_AGENT_MODEL_EXECUTION_ENABLED:"1",
   APPF2_OPENAI_AGENT_API_KEY:"unit_test_fake_provider_key_123456"};
  const noBudget=await fetch(await signed(person,path,body,"model_request_123456"),enabled);
  expect(noBudget.status).toBe(503);
  expect(calls).toBe(0);
 });
});
describe("Sprint 3.5 trusted candidate prompt rendering",()=>{
 it("does not interpret untrusted user prompt as source code or run AI",async()=>{
  const person=await client(),database=new Database();
  const fetch=createWorkerFetch({}, {now:()=>TIME,agent:database.makeDeps()});
  const dangerous='<img src=x onerror=alert(1)> 嘗試建立 App';
  const req=await signed(person,"/api/v1/agent-jobs",
   {anonymous_id:OWNER,prompt:dangerous},"candidate_attack_1234");
  const response=await fetch(req,env);
  expect(response.status).toBe(201);
  const source=Array.from(database.snapshots.values())[0]?.snapshot as {
   files:{path:string;content:string}[]};
  const main=source.files.find(f=>f.path==="src/main.ts")?.content??"";
  expect(main).toContain("textContent=");
  expect(main).not.toContain("innerHTML=");
  expect(database.jobs.get(JOB_ID)?.checkpoint.budget.max_cost_cents).toBe(0);
 });
});

describe("Sprint 3.5 model-authored source edit in real signed Worker API (offline)",()=>{
 it("persists one model-authored edit, returns new source and replays without rewriting",async()=>{
  const person=await client(),db=new Database(),prompt="製作完整的十八啦多人骰子遊戲";
  let calls=0;
  const source='import "./style.css";document.querySelector<HTMLDivElement>("#app")!.textContent="模型產生的骰子遊戲";';
  const deps={...db.makeDeps(),sendModel:async()=>{
   calls++;
   const snap=Array.from(db.snapshots.values())[0]?.snapshot as {
    files:{path:string;hash:string}[]};
   const old=snap.files.find(f=>f.path==="src/main.ts")?.hash??"";
   return {id:"resp_mockedit123456",status:"completed",
    usage:{input_tokens:125,output_tokens:170},
    output:[{type:"function_call",call_id:"call_edit_123456",name:"write_file",
     arguments:JSON.stringify({path:"src/main.ts",content:source,previous_hash:old})}]};
  }};
  const fetch=createWorkerFetch({}, {now:()=>TIME,agent:deps});
  const enabled={...env,APPF2_AGENT_MODEL_EXECUTION_ENABLED:"1",
   APPF2_OPENAI_AGENT_API_KEY:"unit_test_fake_provider_key_123456"};
  const creation=await fetch(await signed(person,"/api/v1/agent-jobs",{
   anonymous_id:OWNER,prompt,max_cost_cents:20,explicit_ai_consent:true
  },"model_edit_create_123456"),env);
  expect(creation.status).toBe(201);
  const root="/api/v1/agent-jobs/"+JOB_ID;
  const plan={anonymous_id:OWNER,prompt,model_call_key:"model_edit_123456",
   max_charge_cents:5,max_output_tokens:1024,explicit_ai_consent:true};
  const planned=await fetch(await signed(person,root+"/model-plan",plan,
   "model_edit_plan_123456"),enabled);
  expect(planned.status).toBe(200);
  const applyBody={anonymous_id:OWNER,model_call_key:"model_edit_123456",
   expected_revision:1};
  const first=await fetch(await signed(person,root+"/apply-plan",applyBody,
   "apply_edit_123456"),env);
  expect(first.status).toBe(200);
  const status=await first.json() as {data:{status:string;revision:number}};
  expect(status.data).toMatchObject({status:"FILE_EDIT_SAVED",revision:2});
  const reopened=await fetch(await signed(person,root,{anonymous_id:OWNER},
   "read_edit_12345678"),env);
  const view=await reopened.json() as {data:{files:{path:string;content:string}[];checkpoint:{state:string}}};
  expect(reopened.status).toBe(200);
  expect(view.data.checkpoint.state).toBe("CODING");
  expect(view.data.files.find(f=>f.path==="src/main.ts")?.content).toBe(source);
  const again=await fetch(await signed(person,root+"/apply-plan",applyBody,
   "apply_edit_123456"),env);
  expect(again.status).toBe(200);
  expect(await again.json()).toMatchObject({data:{status:"ALREADY_APPLIED",revision:2}});
  expect(calls).toBe(1);
  expect(db.jobs.get(JOB_ID)?.revision).toBe(2);
 });
 it("refuses to run model-chosen build commands in the Worker",async()=>{
  const person=await client(),db=new Database(),prompt="建立有完整動畫的多人骰子遊戲";
  const deps={...db.makeDeps(),sendModel:async()=>({
   id:"resp_mockbuild123456",status:"completed",usage:{input_tokens:100,output_tokens:20},
   output:[{type:"function_call",call_id:"call_build_123456",name:"run_build",
    arguments:JSON.stringify({target:"project"})}]
  })};
  const fetch=createWorkerFetch({}, {now:()=>TIME,agent:deps});
  const enabled={...env,APPF2_AGENT_MODEL_EXECUTION_ENABLED:"1",
   APPF2_OPENAI_AGENT_API_KEY:"unit_test_fake_provider_key_123456"};
  await fetch(await signed(person,"/api/v1/agent-jobs",{
   anonymous_id:OWNER,prompt,max_cost_cents:20,explicit_ai_consent:true
  },"build_create_12345678"),env);
  const root="/api/v1/agent-jobs/"+JOB_ID;
  const plan={anonymous_id:OWNER,prompt,model_call_key:"model_build_123456",
   max_charge_cents:5,max_output_tokens:1024,explicit_ai_consent:true};
  expect((await fetch(await signed(person,root+"/model-plan",plan,
   "model_build_plan_123456"),enabled)).status).toBe(200);
  const result=await fetch(await signed(person,root+"/apply-plan",{
   anonymous_id:OWNER,model_call_key:"model_build_123456",expected_revision:1
  },"apply_build_123456"),env);
  expect(result.status).toBe(503);
  expect(db.jobs.get(JOB_ID)?.revision).toBe(1);
  expect(db.jobs.get(JOB_ID)?.checkpoint.completed_call_ids).toEqual([]);
 });
});

describe("Sprint 3.5 authenticated multi-turn Responses continuation (offline provider)",()=>{
 it("preserves response_id and proven edit result into next model turn, replays without charging twice",async()=>{
  const person=await client(),db=new Database();
  const prompt="請做漂亮的多人十八啦骰子遊戲，包含動畫及計分";
  let modelCalls=0;
  const observed:{previous_response_id?:string;input:unknown}[]=[];
  const deps={...db.makeDeps(),sendModel:async({request}:{
   request:{previous_response_id?:string;input:unknown}
  })=>{
   modelCalls++;
   observed.push({previous_response_id:request.previous_response_id,input:request.input});
   const snap=Array.from(db.snapshots.values()).find(x=>x.project_revision===modelCalls)
    ?.snapshot as {files:{path:string;hash:string}[]}|undefined;
   const path=modelCalls===1?"src/main.ts":"src/style.css";
   const previous_hash=snap?.files.find(f=>f.path===path)?.hash??"";
   return {id:modelCalls===1?"resp_first123456":"resp_second123456",
    status:"completed",usage:{input_tokens:85,output_tokens:65},output:[
     {type:"function_call",call_id:modelCalls===1?"call_first123456":"call_second123456",
      name:"write_file",arguments:JSON.stringify({path,previous_hash,
       content:modelCalls===1?"document.querySelector('#app')!.textContent='第一版';":
        "body{background:#e0f2fe}"})}
    ]};
  }};
  const fetch=createWorkerFetch({}, {now:()=>TIME,agent:deps});
  const enabled={...env,APPF2_AGENT_MODEL_EXECUTION_ENABLED:"1",
   APPF2_OPENAI_AGENT_API_KEY:"unit_test_fake_provider_key_123456"};
  const root="/api/v1/agent-jobs/"+JOB_ID;
  const created=await fetch(await signed(person,"/api/v1/agent-jobs",{
   anonymous_id:OWNER,prompt,max_cost_cents:20,explicit_ai_consent:true
  },"multi_turn_create_123456"),env);
  expect(created.status).toBe(201);
  const first={anonymous_id:OWNER,prompt,model_call_key:"first_call_123456",
   max_charge_cents:5,max_output_tokens:1024,explicit_ai_consent:true};
  expect((await fetch(await signed(person,root+"/model-plan",first,
   "first_plan_123456"),enabled)).status).toBe(200);
  const apply1={anonymous_id:OWNER,model_call_key:"first_call_123456",expected_revision:1};
  expect((await fetch(await signed(person,root+"/apply-plan",apply1,
   "apply_one_123456"),env)).status).toBe(200);
  expect(db.jobs.get(JOB_ID)?.revision).toBe(2);
  const next={anonymous_id:OWNER,expected_revision:2,
   previous_model_call_key:"first_call_123456",
   model_call_key:"second_call_123456",max_charge_cents:5,
   max_output_tokens:1024,explicit_ai_consent:true};
  const continued=await fetch(await signed(person,root+"/model-continue",next,
   "continue_one_123456"),enabled);
  expect(continued.status).toBe(200);
  expect(await continued.json()).toMatchObject({data:{
   status:"MODEL_RESPONSE_SAVED",source:"PROVIDER",response_id:"resp_second123456",
   revision:2}});
  expect(modelCalls).toBe(2);
  expect(observed[1]?.previous_response_id).toBe("resp_first123456");
  const modelInput=observed[1]?.input as {
   type:string;call_id:string;output:string}[];
  expect(modelInput).toHaveLength(1);
  expect(modelInput[0].type).toBe("function_call_output");
  expect(modelInput[0].call_id).toBe("call_first123456");
  expect(modelInput[0].output).toContain(db.jobs.get(JOB_ID)?.project_hash??"MISSING");
  const duplicate=await fetch(await signed(person,root+"/model-continue",next,
   "continue_one_123456"),enabled);
  expect(duplicate.status).toBe(200);
  expect(await duplicate.json()).toMatchObject({data:{source:"DURABLE_REPLAY"}});
  expect(modelCalls).toBe(2);
  const apply2=await fetch(await signed(person,root+"/apply-plan",{
   anonymous_id:OWNER,model_call_key:"second_call_123456",expected_revision:2
  },"apply_two_123456"),env);
  expect(apply2.status).toBe(200);
  expect(db.jobs.get(JOB_ID)?.revision).toBe(3);
  const recovered=await fetch(await signed(person,root,{anonymous_id:OWNER},
   "reopen_two_123456"),env);
  const source=await recovered.json() as {data:{files:{path:string;content:string}[]}};
  expect(source.data.files.find(x=>x.path==="src/style.css")?.content)
   .toBe("body{background:#e0f2fe}");
 });
 it("refuses continuation before a saved edit or if independent spend flag is off",async()=>{
  const person=await client(),db=new Database();let calls=0;
  const deps={...db.makeDeps(),sendModel:async()=>{calls++;throw Error("NO_DISPATCH");}};
  const fetch=createWorkerFetch({}, {now:()=>TIME,agent:deps});
  const prompt="做一個可以互動的多人骰子排行榜";
  await fetch(await signed(person,"/api/v1/agent-jobs",{
   anonymous_id:OWNER,prompt,max_cost_cents:20,explicit_ai_consent:true
  },"continuation_create_123456"),env);
  const payload={anonymous_id:OWNER,expected_revision:2,
   previous_model_call_key:"first_call_123456",model_call_key:"second_call_123456",
   max_charge_cents:5,max_output_tokens:1024,explicit_ai_consent:true};
  const path="/api/v1/agent-jobs/"+JOB_ID+"/model-continue";
  expect((await fetch(await signed(person,path,payload,
   "preedit_12345678"),env)).status).toBe(404);
  const enabled={...env,APPF2_AGENT_MODEL_EXECUTION_ENABLED:"1",
   APPF2_OPENAI_AGENT_API_KEY:"unit_test_fake_provider_key_123456"};
  expect((await fetch(await signed(person,path,payload,
   "preedit_12345678"),enabled)).status).toBe(503);
  expect(calls).toBe(0);
  expect(db.modelCalls.size).toBe(0);
 });
});

describe("Sprint 3.5 signed read-only model journal status (zero provider calls)",()=>{
 it("shows uncertain cost state safely and refuses another creator key",async()=>{
  const owner=await client(),intruder=await client(),db=new Database();
  const fetch=createWorkerFetch({}, {now:()=>TIME,agent:db.makeDeps()});
  const created=await fetch(await signed(owner,"/api/v1/agent-jobs",{
   anonymous_id:OWNER,prompt:"建立多檔案每日任務追蹤 App"
  },"status_create_123456"),env);
  expect(created.status).toBe(201);
  const job=db.jobs.get(JOB_ID)!;
  const modelCall="model_status_123456";
  db.modelCalls.set(modelCall,{job_id:JOB_ID,owner_anonymous_id:OWNER,
   call_key:modelCall,job_revision:0,checkpoint_hash:job.checkpoint_hash,
   request_hash:job.request_hash,model:"gpt-6.1-sol",max_charge_cents:5,
   status:"BLOCKED_UNCERTAIN",response_json:null,response_id:null,
   input_tokens:null,output_tokens:null});
  const path="/api/v1/agent-jobs/"+JOB_ID+"/model-status";
  const body={anonymous_id:OWNER,model_call_key:modelCall};
  const actual=await fetch(await signed(owner,path,body,"status_read_123456"),env);
  expect(actual.status).toBe(200);
  expect(await actual.json()).toMatchObject({data:{
   status:"BLOCKED_UNCERTAIN",needs_reconciliation:true,response_id:null
  }});
  const denied=await fetch(await signed(intruder,path,body,"status_spoof_123456"),env);
  expect(denied.status).toBe(503);
  expect(await denied.text()).not.toContain("BLOCKED_UNCERTAIN");
 });
});

const sandboxEnabled={...env,APPF2_AGENT_SANDBOX_EXECUTION_ENABLED:"1",
 APPF2_SANDBOX_BROKER_URL:"https://appf2-private.example.workers.dev/",
 APPF2_SANDBOX_BROKER_TOKEN:"unit-test-private-bearer-token-abcde123456",
 APPF2_SANDBOX_ALLOWED_JOB_ID:JOB_ID};
function savedModelTool(db:Database,key:string,callId:string,
 name:"run_build"|"run_test"):void{
 const job=db.jobs.get(JOB_ID)!;
 const response={id:"resp_"+callId.slice(5)+"123456",status:"completed",
  output:[{type:"function_call",call_id:callId,name,
   arguments:JSON.stringify({target:"project"})}]};
 db.modelCalls.set(key,{job_id:JOB_ID,owner_anonymous_id:OWNER,call_key:key,
  job_revision:job.revision,checkpoint_hash:job.checkpoint_hash,
  request_hash:job.request_hash,model:"gpt-6.1-sol",
  max_charge_cents:2,status:"SUCCEEDED",
  response_json:response,response_id:response.id,input_tokens:85,output_tokens:30});
}
async function codingJob(person:Client,db:Database,fetch:ReturnType<typeof createWorkerFetch>){
 const prompt="請生成漂亮且完整的多人十八啦骰子遊戲";
 const created=await fetch(await signed(person,"/api/v1/agent-jobs",{
  anonymous_id:OWNER,prompt,max_cost_cents:35,explicit_ai_consent:true
 },"sandbox_create_123456"),env);
 expect(created.status).toBe(201);
 // Transition to CODING with a committed model-origin file change.
 const job=db.jobs.get(JOB_ID)!;
 const cp={...job.checkpoint,state:"PLANNING" as const,step:1,
  previous_checkpoint_id:job.checkpoint_hash};
 const {checkpointHash}=await import("../../src/platform/agent/postgres-agent-jobs.js");
 db.jobs.set(JOB_ID,{...job,checkpoint:cp,checkpoint_hash:await checkpointHash(cp),
  job_state:"PLANNING",revision:1});
 savedModelTool(db,"model_edit_123456","call_edit_123456","run_build");
 // Replace the synthetic build record with a genuine first edit.
 const model=db.modelCalls.get("model_edit_123456")!;
 const snap=Array.from(db.snapshots.values())[0]?.snapshot as {
  files:{path:string;hash:string}[]};
 const prior=snap.files.find(f=>f.path==="src/main.ts")!.hash;
 db.modelCalls.set("model_edit_123456",{...model,response_json:{
  id:model.response_id,status:"completed",output:[{type:"function_call",
   call_id:"call_edit_123456",name:"write_file",arguments:JSON.stringify({
    path:"src/main.ts",content:"document.querySelector('#app')!.textContent='APPf2';",
    previous_hash:prior
   })}]
 }});
 const applied=await fetch(await signed(person,
  "/api/v1/agent-jobs/"+JOB_ID+"/apply-plan",{
   anonymous_id:OWNER,model_call_key:"model_edit_123456",expected_revision:1
  },"sandbox_apply_123456"),env);
 expect(applied.status).toBe(200);
 expect(db.jobs.get(JOB_ID)?.job_state).toBe("CODING");
 expect(db.jobs.get(JOB_ID)?.revision).toBe(2);
}
describe("Sprint 3.5 private sandbox build/test Worker bridge (mock isolated broker, no paid container)",()=>{
 it("persists build/test receipts and CAS checkpoints; identical signed build is never re-executed",async()=>{
  const person=await client(),db=new Database();
  let remoteCount=0;
  const deps={...db.makeDeps(),sendSandbox:async(task:{
   job_id:string;project:{project_hash:string};call:{call_id:string;project_hash:string}
  })=>{
   remoteCount++;
   const detail="MOCK_ISOLATED_CONTAINER_COMPILE_PASS";
   return {call_id:task.call.call_id,project_hash:task.project.project_hash,
    exit_code:0,timed_out:false,detail,
    output_digest:await sha256CodeBytes(new TextEncoder().encode(detail)),
    runner_attestation:"APPF2_ISOLATED_CLOUDFLARE_CONTAINER_V1"};
  }};
  const fetch=createWorkerFetch({}, {now:()=>TIME,agent:deps});
  await codingJob(person,db,fetch);
  savedModelTool(db,"build_model_123456","call_build_123456","run_build");
  const path="/api/v1/agent-jobs/"+JOB_ID+"/sandbox-run";
  const body={anonymous_id:OWNER,model_call_key:"build_model_123456",
   expected_revision:2,explicit_container_consent:true,max_charge_cents:4};
  const first=await fetch(await signed(person,path,body,"sandbox_exec_123456"),sandboxEnabled);
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({data:{status:"SANDBOX_RESULT_SAVED",
   job_state:"BUILDING",revision:3,exit_code:0}});
  expect(db.sandboxCalls.get("call_build_123456")?.status).toBe("SUCCEEDED");
  const repeat=await fetch(await signed(person,path,body,"sandbox_exec_123456"),sandboxEnabled);
  expect(repeat.status).toBe(200);
  expect(await repeat.json()).toMatchObject({data:{status:"ALREADY_APPLIED"}});
  expect(remoteCount).toBe(1);
  savedModelTool(db,"test_model_123456","call_test_123456","run_test");
  const testing=await fetch(await signed(person,path,{
   anonymous_id:OWNER,model_call_key:"test_model_123456",expected_revision:3,
   explicit_container_consent:true,max_charge_cents:4
  },"sandbox_test_123456"),sandboxEnabled);
  expect(testing.status).toBe(200);
  expect(await testing.json()).toMatchObject({data:{job_state:"TESTING",revision:4}});
  expect(remoteCount).toBe(2);
 });
 it("rejects missing approval, forged evidence and uncertain network results without paid retries",async()=>{
  const person=await client(),db=new Database();let sent=0;
  const deps={...db.makeDeps(),sendSandbox:async()=>{
   sent++;throw Error("network timeout");
  }};
  const fetch=createWorkerFetch({}, {now:()=>TIME,agent:deps});
  await codingJob(person,db,fetch);
  savedModelTool(db,"build_model_123456","call_build_123456","run_build");
  const path="/api/v1/agent-jobs/"+JOB_ID+"/sandbox-run";
  const body={anonymous_id:OWNER,model_call_key:"build_model_123456",
   expected_revision:2,explicit_container_consent:true,max_charge_cents:4};
  expect((await fetch(await signed(person,path,body,"disabled_123456"),env)).status).toBe(404);
  const fail=await fetch(await signed(person,path,body,"isolated_123456"),sandboxEnabled);
  expect(fail.status).toBe(503);
  expect(db.sandboxCalls.get("call_build_123456")?.status).toBe("BLOCKED_UNCERTAIN");
  expect((await fetch(await signed(person,path,body,"isolated_123456"),sandboxEnabled)).status)
   .toBe(503);
  expect(sent).toBe(1);
  expect(db.jobs.get(JOB_ID)?.revision).toBe(2);
  const wrong=await client();
  const spoof=await fetch(await signed(wrong,path,body,"spoof_12345678"),sandboxEnabled);
  expect(spoof.status).toBe(503);
  expect(sent).toBe(1);
 });
 it("rejects sandbox proof tampering and never advances the job checkpoint",async()=>{
  const person=await client(),db=new Database();let sent=0;
  const fetch=createWorkerFetch({}, {now:()=>TIME,agent:{...db.makeDeps(),
   sendSandbox:async(task:{call:{call_id:string;project_hash:string}})=>{
    sent++;
    return {call_id:task.call.call_id,project_hash:task.call.project_hash,
     exit_code:0,timed_out:false,detail:"FAKE",
     output_digest:"sha256:"+"f".repeat(64),
     runner_attestation:"APPF2_ISOLATED_CLOUDFLARE_CONTAINER_V1"};
   }}});
  await codingJob(person,db,fetch);
  savedModelTool(db,"build_model_123456","call_build_123456","run_build");
  const path="/api/v1/agent-jobs/"+JOB_ID+"/sandbox-run";
  const outcome=await fetch(await signed(person,path,{
   anonymous_id:OWNER,model_call_key:"build_model_123456",expected_revision:2,
   explicit_container_consent:true,max_charge_cents:4
  },"tamper_12345678"),sandboxEnabled);
  expect(outcome.status).toBe(503);
  expect(db.jobs.get(JOB_ID)?.revision).toBe(2);
  expect(db.sandboxCalls.get("call_build_123456")?.status).toBe("BLOCKED_UNCERTAIN");
  expect(sent).toBe(1);
 });
});

describe("Sprint 3.5 signed incremental budget renewal beyond eight steps",()=>{
 it("preserves source and completed work at step eight; owner can authorize more",async()=>{
  const creator=await client(),db=new Database();
  const fetch=createWorkerFetch({}, {now:()=>TIME,agent:db.makeDeps()});
  const prompt="做一個有帳號、計分與多人排行榜的遊戲";
  expect((await fetch(await signed(creator,"/api/v1/agent-jobs",{
   anonymous_id:OWNER,prompt
  },"extension_create_123456"),env)).status).toBe(201);
  const before=db.jobs.get(JOB_ID)!;
  const completed=Array.from({length:8},(_,i)=>"call_budget_"+i+"abcdef");
  const cp={...before.checkpoint,state:"CODING" as const,step:8,
   completed_call_ids:completed};
  const {checkpointHash}=await import("../../src/platform/agent/postgres-agent-jobs.js");
  db.jobs.set(JOB_ID,{...before,checkpoint:cp,checkpoint_hash:await checkpointHash(cp),
   job_state:"CODING"});
  const path="/api/v1/agent-jobs/"+JOB_ID+"/extend-budget";
  const body={anonymous_id:OWNER,expected_revision:0,explicit_budget_consent:true,
   new_max_steps:20,new_max_cost_cents:15};
  const approved=await fetch(await signed(creator,path,body,
   "budget_renew_123456"),env);
  expect(approved.status).toBe(200);
  expect(await approved.json()).toMatchObject({data:{
   status:"BUDGET_EXTENDED",revision:1,budget:{max_steps:20,
    max_tokens:8192,max_cost_cents:15},step:8,app_published:false
  }});
  const saved=db.jobs.get(JOB_ID)!;
  expect(saved.checkpoint.completed_call_ids).toEqual(completed);
  expect(saved.project_hash).toBe(before.project_hash);
  expect(saved.checkpoint.state).toBe("CODING");
  expect(saved.checkpoint.step).toBe(8);
  expect(saved.revision).toBe(1);
  expect(db.modelCalls.size).toBe(0);
  expect(db.sandboxCalls.size).toBe(0);
  expect((await fetch(await signed(creator,path,body,
   "budget_repeat_123456"),env)).status).toBe(503);
  expect(db.jobs.get(JOB_ID)?.revision).toBe(1);
 });
 it("denies unapproved, cross-creator, excess step or cost extensions",async()=>{
  const owner=await client(),attacker=await client(),db=new Database();
  const fetch=createWorkerFetch({}, {now:()=>TIME,agent:db.makeDeps()});
  await fetch(await signed(owner,"/api/v1/agent-jobs",{
   anonymous_id:OWNER,prompt:"建立一個可操作的多人排行榜"
  },"budget_create_123456"),env);
  const path="/api/v1/agent-jobs/"+JOB_ID+"/extend-budget";
  const base={anonymous_id:OWNER,expected_revision:0,explicit_budget_consent:true,
   new_max_steps:20,new_max_cost_cents:10};
  expect((await fetch(await signed(attacker,path,base,
   "wrong_owner_123456"),env)).status).toBe(503);
  expect((await fetch(await signed(owner,path,{
   ...base,explicit_budget_consent:false
  },"no_consent_123456"),env)).status).toBe(400);
  expect((await fetch(await signed(owner,path,{
   ...base,new_max_steps:32
  },"excess_steps_123456"),env)).status).toBe(503);
  expect((await fetch(await signed(owner,path,{
   ...base,new_max_cost_cents:101
  },"excess_cost_123456"),env)).status).toBe(400);
  expect(db.jobs.get(JOB_ID)?.revision).toBe(0);
 });
});

describe("Sprint 3.5 durable Sandbox diagnostics -> next AI repair turn (NO paid services)",()=>{
 it("delivers saved compile failure to the next AI turn and persists its repair",async()=>{
  const person=await client(),db=new Database();
  let modelDispatches=0,sandboxDispatches=0;
  const observedRequests:{previous_response_id?:string;input:unknown}[]=[];
  const fetch=createWorkerFetch({}, {now:()=>TIME,agent:{...db.makeDeps(),
   sendSandbox:async(task:{call:{call_id:string;project_hash:string}})=>{
    sandboxDispatches++;
    const detail="VITE_COMPILE_FAILED:src/main.ts: unexpected token";
    return {call_id:task.call.call_id,project_hash:task.call.project_hash,
     exit_code:1,timed_out:false,detail,
     output_digest:await sha256CodeBytes(new TextEncoder().encode(detail)),
     runner_attestation:"APPF2_ISOLATED_CLOUDFLARE_CONTAINER_V1"};
   },
   sendModel:async({request}:{request:{
    previous_response_id?:string;input:unknown
   }})=>{
    modelDispatches++;observedRequests.push(request);
    const current=db.jobs.get(JOB_ID)!;
    const snap=db.snapshots.get(OWNER+":"+current.project_hash)?.snapshot as {
     files:{path:string;hash:string}[]};
    return {id:"resp_repair123456",status:"completed",
     usage:{input_tokens:150,output_tokens:75},
     output:[{type:"function_call",call_id:"call_repair123456",
      name:"write_file",arguments:JSON.stringify({
       path:"src/main.ts",previous_hash:snap.files.find(f=>
        f.path==="src/main.ts")!.hash,
       content:"document.querySelector('#app')!.textContent='repaired';"
      })}]
    };
   }
  }});
  await codingJob(person,db,fetch);
  savedModelTool(db,"build_model_123456","call_build_123456","run_build");
  const root="/api/v1/agent-jobs/"+JOB_ID;
  const build=await fetch(await signed(person,root+"/sandbox-run",{
   anonymous_id:OWNER,model_call_key:"build_model_123456",
   expected_revision:2,explicit_container_consent:true,max_charge_cents:4
  },"repair_build_123456"),sandboxEnabled);
  expect(build.status).toBe(200);
  expect(await build.json()).toMatchObject({data:{
   job_state:"REPAIRING",revision:3,exit_code:1
  }});
  const enabled={...sandboxEnabled,APPF2_AGENT_MODEL_EXECUTION_ENABLED:"1",
   APPF2_OPENAI_AGENT_API_KEY:"unit_test_fake_provider_key_123456"};
  const payload={anonymous_id:OWNER,previous_model_call_key:"build_model_123456",
   model_call_key:"repair_model_123456",expected_revision:3,
   explicit_ai_consent:true,max_charge_cents:5,max_output_tokens:1024};
  const next=await fetch(await signed(person,root+"/model-continue",payload,
   "repair_continue_123456"),enabled);
  expect(next.status).toBe(200);
  expect(modelDispatches).toBe(1);
  expect(sandboxDispatches).toBe(1);
  expect(observedRequests[0]?.previous_response_id).toBe("resp_build_123456123456");
  const toolInput=observedRequests[0]?.input as {call_id:string;output:string}[];
  expect(toolInput[0]?.call_id).toBe("call_build_123456");
  expect(toolInput[0]?.output).toContain("VITE_COMPILE_FAILED");
  expect(toolInput[0]?.output).toContain('"exit_code":1');
  const replay=await fetch(await signed(person,root+"/model-continue",payload,
   "repair_continue_123456"),enabled);
  expect(replay.status).toBe(200);
  expect(await replay.json()).toMatchObject({data:{source:"DURABLE_REPLAY"}});
  expect(modelDispatches).toBe(1);
  const applied=await fetch(await signed(person,root+"/apply-plan",{
   anonymous_id:OWNER,model_call_key:"repair_model_123456",expected_revision:3
  },"repair_apply_123456"),env);
  expect(applied.status).toBe(200);
  expect(db.jobs.get(JOB_ID)?.job_state).toBe("CODING");
  expect(db.jobs.get(JOB_ID)?.revision).toBe(4);
 });
 it("never sends an AI call when sandbox evidence is missing or falsified",async()=>{
  const person=await client(),db=new Database();let modelDispatches=0;
  const fetch=createWorkerFetch({}, {now:()=>TIME,agent:{...db.makeDeps(),
   sendSandbox:async(task:{call:{call_id:string;project_hash:string}})=>{
    const detail="successful build";
    return {call_id:task.call.call_id,project_hash:task.call.project_hash,
     exit_code:0,timed_out:false,detail,
     output_digest:await sha256CodeBytes(new TextEncoder().encode(detail)),
     runner_attestation:"APPF2_ISOLATED_CLOUDFLARE_CONTAINER_V1"};
   },
   sendModel:async()=>{modelDispatches++;throw Error("NEVER_SEND");}
  }});
  await codingJob(person,db,fetch);
  savedModelTool(db,"build_model_123456","call_build_123456","run_build");
  const root="/api/v1/agent-jobs/"+JOB_ID;
  const build=await fetch(await signed(person,root+"/sandbox-run",{
   anonymous_id:OWNER,model_call_key:"build_model_123456",
   expected_revision:2,explicit_container_consent:true,max_charge_cents:4
  },"gate_build_123456"),sandboxEnabled);
  expect(build.status).toBe(200);
  const row=db.sandboxCalls.get("call_build_123456")!;
  db.sandboxCalls.set(row.call_id,{...row,call_hash:"sha256:"+"1".repeat(64)});
  const enabled={...env,APPF2_AGENT_MODEL_EXECUTION_ENABLED:"1",
   APPF2_OPENAI_AGENT_API_KEY:"unit_test_fake_provider_key_123456"};
  const next=await fetch(await signed(person,root+"/model-continue",{
   anonymous_id:OWNER,previous_model_call_key:"build_model_123456",
   model_call_key:"continue_model_123456",expected_revision:3,
   explicit_ai_consent:true,max_charge_cents:5,max_output_tokens:1024
  },"gate_continue_123456"),enabled);
  expect(next.status).toBe(503);
  expect(modelDispatches).toBe(0);
  expect(db.modelCalls.has("continue_model_123456")).toBe(false);
 });
});


describe("Sprint 3.5 existing project read -> AI edit (signed real Worker routes, mock AI)",()=>{
 it("reads exact saved source, sends it into next model turn, then persists an edit without sandbox",async()=>{
  const person=await client(),db=new Database();
  const prompt="建立一個可互動的骰子計分器與排行榜";
  let calls=0;
  const observed:{previous_response_id?:string;input:unknown}[]=[];
  const deps={...db.makeDeps(),sendModel:async({request}:{request:{
   previous_response_id?:string;input:unknown
  }})=>{
   calls++;observed.push(request);
   if(calls===1)return {id:"resp_read_first123456",status:"completed",
    usage:{input_tokens:100,output_tokens:50},
    output:[{type:"function_call",call_id:"call_read_first123456",name:"read_file",
     arguments:JSON.stringify({path:"src/main.ts"})}]};
   const source=db.snapshots.get(OWNER+":"+db.jobs.get(JOB_ID)!.project_hash)!
    .snapshot as {files:{path:string;hash:string}[]};
   return {id:"resp_read_second123456",status:"completed",
    usage:{input_tokens:130,output_tokens:65},
    output:[{type:"function_call",call_id:"call_read_second123456",
     name:"write_file",arguments:JSON.stringify({path:"src/main.ts",
      previous_hash:source.files.find(f=>f.path==="src/main.ts")!.hash,
      content:"document.querySelector('#app')!.textContent='互動計分器';"})}]};
  }};
  const worker=createWorkerFetch({}, {now:()=>TIME,agent:deps});
  const enabled={...env,APPF2_AGENT_MODEL_EXECUTION_ENABLED:"1",
   APPF2_OPENAI_AGENT_API_KEY:"unit_test_fake_provider_key_123456"};
  const root="/api/v1/agent-jobs/"+JOB_ID;
  expect((await worker(await signed(person,"/api/v1/agent-jobs",{
   anonymous_id:OWNER,prompt,max_cost_cents:20,explicit_ai_consent:true
  },"read_create_12345678"),env)).status).toBe(201);
  const original=db.jobs.get(JOB_ID)!.project_hash;
  const first={anonymous_id:OWNER,prompt,model_call_key:"read_first_model_123456",
   max_charge_cents:5,max_output_tokens:1024,explicit_ai_consent:true};
  expect((await worker(await signed(person,root+"/model-plan",first,
   "read_plan_12345678"),enabled)).status).toBe(200);
  expect(String(observed[0]?.input)).toContain("CURRENT_PROJECT_FILES_JSON");
  expect(String(observed[0]?.input)).toContain("src/main.ts");
  const apply={anonymous_id:OWNER,model_call_key:"read_first_model_123456",
   expected_revision:1};
  const a=await worker(await signed(person,root+"/apply-plan",apply,
   "read_apply_12345678"),env);
  expect(a.status).toBe(200);
  expect(await a.json()).toMatchObject({data:{status:"FILE_READ_SAVED",revision:2,
   project_hash:original}});
  expect(db.jobs.get(JOB_ID)?.project_hash).toBe(original);
  expect(db.snapshots.size).toBe(1);
  const replay=await worker(await signed(person,root+"/apply-plan",apply,
   "read_apply_12345678"),env);
  expect(await replay.json()).toMatchObject({data:{status:"ALREADY_APPLIED"}});
  const next={anonymous_id:OWNER,previous_model_call_key:"read_first_model_123456",
   model_call_key:"read_second_model_123456",expected_revision:2,
   max_charge_cents:5,max_output_tokens:1024,explicit_ai_consent:true};
  const continued=await worker(await signed(person,root+"/model-continue",next,
   "read_continue_123456"),enabled);
  expect(continued.status).toBe(200);
  expect(calls).toBe(2);
  expect(observed[1]?.previous_response_id).toBe("resp_read_first123456");
  const readOutput=observed[1]?.input as {call_id:string;output:string}[];
  expect(readOutput[0]?.call_id).toBe("call_read_first123456");
  expect(readOutput[0]?.output).toContain("root missing");
  expect(readOutput[0]?.output).toContain("src/main.ts");
  expect((await worker(await signed(person,root+"/apply-plan",{
   anonymous_id:OWNER,model_call_key:"read_second_model_123456",expected_revision:2
  },"read_edit_apply_123456"),env)).status).toBe(200);
  const reopened=await worker(await signed(person,root,{anonymous_id:OWNER},
   "read_reopen_12345678"),env);
  const project=await reopened.json() as {data:{files:{path:string;content:string}[]}};
  expect(project.data.files.find(x=>x.path==="src/main.ts")?.content)
   .toContain("互動計分器");
  expect(db.jobs.get(JOB_ID)?.revision).toBe(3);
 });
});

describe("Sprint 3.5 signed Worker multi-file creation in one AI call (offline)",()=>{
 it("atomically saves 3 model-authored files, reopens and continues without replay charge",async()=>{
  const person=await client(),db=new Database();
  const prompt="建立可操作的多人骰子遊戲，包含規則、計分與動畫";
  const observed:{input:unknown;previous_response_id?:string}[]=[];
  let dispatch=0;
  const deps={...db.makeDeps(),sendModel:async({request}:{request:{
   input:unknown;previous_response_id?:string
  }})=>{
   observed.push(request);dispatch++;
   if(dispatch===1){
    const snap=Array.from(db.snapshots.values())[0]!.snapshot as {
     files:{path:string;hash:string}[]};
    const changes=[
     {path:"src/main.ts",previous_hash:snap.files.find(f=>f.path==="src/main.ts")!.hash,
      content:"import {score} from './game'; document.querySelector('#app')!.textContent=String(score(6,6));"},
     {path:"src/game.ts",previous_hash:"",content:"export const score=(a:number,b:number)=>a+b;"},
     {path:"src/players.ts",previous_hash:"",content:"export const players=['甲','乙'];"}
    ];
    return {id:"resp_batch_first123456",status:"completed",
     usage:{input_tokens:240,output_tokens:320},output:[
      {type:"function_call",call_id:"call_batch_first123456",name:"write_files",
       arguments:JSON.stringify({edits_json:JSON.stringify(changes)})}]};
   }
   return {id:"resp_batch_second123456",status:"completed",
    usage:{input_tokens:170,output_tokens:50},output:[]};
  }};
  const worker=createWorkerFetch({}, {now:()=>TIME,agent:deps});
  const enabled={...env,APPF2_AGENT_MODEL_EXECUTION_ENABLED:"1",
   APPF2_OPENAI_AGENT_API_KEY:"unit_test_fake_provider_key_123456"};
  const root="/api/v1/agent-jobs/"+JOB_ID;
  expect((await worker(await signed(person,"/api/v1/agent-jobs",{
   anonymous_id:OWNER,prompt,max_cost_cents:20,explicit_ai_consent:true
  },"batch_create_12345678"),env)).status).toBe(201);
  const initialHash=db.jobs.get(JOB_ID)!.project_hash;
  expect((await worker(await signed(person,root+"/model-plan",{
   anonymous_id:OWNER,prompt,model_call_key:"batch_first_model_123456",
   max_charge_cents:5,max_output_tokens:1024,explicit_ai_consent:true
  },"batch_plan_12345678"),enabled)).status).toBe(200);
  const first=await worker(await signed(person,root+"/apply-plan",{
   anonymous_id:OWNER,model_call_key:"batch_first_model_123456",
   expected_revision:1
  },"batch_apply_12345678"),env);
  expect(first.status).toBe(200);
  expect(await first.json()).toMatchObject({data:{status:"FILE_EDIT_SAVED",revision:2}});
  expect(db.jobs.get(JOB_ID)?.project_hash).not.toBe(initialHash);
  const read=await worker(await signed(person,root,{anonymous_id:OWNER},
   "batch_read_12345678"),env);
  const view=await read.json() as {data:{files:{path:string;content:string}[]}};
  expect(read.status).toBe(200);
  expect(view.data.files.some(f=>f.path==="src/game.ts")).toBe(true);
  expect(view.data.files.some(f=>f.path==="src/players.ts")).toBe(true);
  expect(db.snapshots.size).toBe(2);
  const next={anonymous_id:OWNER,previous_model_call_key:"batch_first_model_123456",
   model_call_key:"batch_second_model_123456",expected_revision:2,
   max_charge_cents:5,max_output_tokens:1024,explicit_ai_consent:true};
  expect((await worker(await signed(person,root+"/model-continue",next,
   "batch_continue_123456"),enabled)).status).toBe(200);
  expect(observed[1]?.previous_response_id).toBe("resp_batch_first123456");
  const toolOutput=observed[1]?.input as {output:string}[];
  expect(toolOutput[0]?.output).toContain(db.jobs.get(JOB_ID)?.project_hash??"MISSING");
  expect(dispatch).toBe(2);
  const replay=await worker(await signed(person,root+"/apply-plan",{
   anonymous_id:OWNER,model_call_key:"batch_first_model_123456",
   expected_revision:1
  },"batch_apply_12345678"),env);
  expect(await replay.json()).toMatchObject({data:{status:"ALREADY_APPLIED"}});
  expect(db.snapshots.size).toBe(2);
 });
});

describe("Sprint 3.5 signed resumable auto-step (offline provider/container)",()=>{
 it("saves a multi-file edit, optionally continues model, and pauses for container consent",async()=>{
  const creator=await client(),db=new Database();
  const prompt="建立多人骰子遊戲，包含動畫、規則、計分與排行榜";
  let ai=0,containers=0;
  const seen:{previous_response_id?:string;input:unknown}[]=[];
  const worker=createWorkerFetch({}, {now:()=>TIME,agent:{...db.makeDeps(),
   sendModel:async({request}:{request:{previous_response_id?:string;input:unknown}})=>{
    ai++;seen.push(request);
    if(ai===1){
     const file=(Array.from(db.snapshots.values())[0]!.snapshot as
      {files:{path:string;hash:string}[]}).files.find(f=>f.path==="src/main.ts")!;
     const changes=[{path:"src/main.ts",previous_hash:file.hash,
       content:"import {total} from './score';document.querySelector('#app')!.textContent=String(total(6,6));"},
      {path:"src/score.ts",previous_hash:"",
       content:"export const total=(a:number,b:number)=>a+b;"}];
     return {id:"resp_step_first123456",status:"completed",
      usage:{input_tokens:100,output_tokens:100},output:[{
       type:"function_call",call_id:"call_step_edit123456",name:"write_files",
       arguments:JSON.stringify({edits_json:JSON.stringify(changes)})}]};
    }
    return {id:"resp_step_build123456",status:"completed",
     usage:{input_tokens:90,output_tokens:30},output:[{
      type:"function_call",call_id:"call_step_build123456",name:"run_build",
      arguments:JSON.stringify({target:"project"})}]};
   },
   sendSandbox:async(task:{call:{call_id:string;project_hash:string}})=>{
    containers++;
    const detail="VITE_BUILD_ERROR: invalid import";
    return {call_id:task.call.call_id,project_hash:task.call.project_hash,
     exit_code:1,timed_out:false,detail,
     output_digest:await sha256CodeBytes(new TextEncoder().encode(detail)),
     runner_attestation:"APPF2_ISOLATED_CLOUDFLARE_CONTAINER_V1"};
   }
  }});
  const agentEnv={...env,APPF2_AGENT_AUTOSTEP_ENABLED:"1",
   APPF2_AGENT_MODEL_EXECUTION_ENABLED:"1",
   APPF2_OPENAI_AGENT_API_KEY:"unit_test_fake_provider_key_123456"};
  const root="/api/v1/agent-jobs/"+JOB_ID;
  expect((await worker(await signed(creator,"/api/v1/agent-jobs",{
   anonymous_id:OWNER,prompt,max_cost_cents:35,explicit_ai_consent:true
  },"step_create_12345678"),env)).status).toBe(201);
  expect((await worker(await signed(creator,root+"/model-plan",{
   anonymous_id:OWNER,prompt,model_call_key:"step_first_model_123456",
   max_charge_cents:5,max_output_tokens:1024,explicit_ai_consent:true
  },"step_plan_12345678"),agentEnv)).status).toBe(200);
  const path=root+"/auto-step";
  const first={anonymous_id:OWNER,model_call_key:"step_first_model_123456",
   expected_revision:1,explicit_ai_consent:true,
   next_model_call_key:"step_second_model_123456",max_ai_charge_cents:5,
   max_output_tokens:1024};
  const stepResult=await worker(await signed(creator,path,first,
   "step_edit_12345678"),agentEnv);
  expect(stepResult.status).toBe(200);
  expect(db.jobs.get(JOB_ID)?.revision).toBe(2);
  expect(db.snapshots.size).toBe(2);
  expect(ai).toBe(2);
  const action={anonymous_id:OWNER,model_call_key:"step_second_model_123456",
   expected_revision:2};
  const paused=await worker(await signed(creator,path,action,
   "step_pause_12345678"),agentEnv);
  expect(paused.status).toBe(200);
  expect(await paused.json()).toMatchObject({data:{
   status:"AWAITING_CONTAINER_CONSENT",revision:2,app_published:false}});
  expect(containers).toBe(0);
  const paid={...agentEnv,...sandboxEnabled};
  const approved={...action,explicit_container_consent:true,
   max_container_charge_cents:4};
  const built=await worker(await signed(creator,path,approved,
   "step_build_12345678"),paid);
  expect(built.status).toBe(200);
  expect(await built.json()).toMatchObject({data:{
   status:"STEP_APPLIED",revision:3,job_state:"REPAIRING",
   action:"NEXT_MODEL_NEEDS_SIGNED_CONSENT"}});
  expect(containers).toBe(1);
  const repeated=await worker(await signed(creator,path,approved,
   "step_build_12345678"),paid);
  expect(repeated.status).toBe(503);
  expect(containers).toBe(1);
  const reopened=await worker(await signed(creator,root,{anonymous_id:OWNER},
   "step_reopen_12345678"),env);
  expect(await reopened.json()).toMatchObject({data:{revision:3,
   checkpoint:{state:"REPAIRING"},app_published:false}});
  expect(seen[1]?.previous_response_id).toBe("resp_step_first123456");
 });
 it("fails closed without independent gate and rejects forged paid consent",async()=>{
  const person=await client(),db=new Database();
  const worker=createWorkerFetch({}, {now:()=>TIME,agent:db.makeDeps()});
  const prompt="做一個可玩的多人骰子遊戲";
  await worker(await signed(person,"/api/v1/agent-jobs",{
   anonymous_id:OWNER,prompt
  },"step_guard_create123456"),env);
  const path="/api/v1/agent-jobs/"+JOB_ID+"/auto-step";
  const req={anonymous_id:OWNER,model_call_key:"step_model_fake_123456",
   expected_revision:1};
  expect((await worker(await signed(person,path,req,
   "step_gate_12345678"),env)).status).toBe(404);
  expect((await worker(await signed(person,path,{...req,
   next_model_call_key:"other_call_123456",explicit_ai_consent:false,
   max_ai_charge_cents:5,max_output_tokens:1024
  },"step_bad_12345678"),{...env,APPF2_AGENT_AUTOSTEP_ENABLED:"1"})).status)
   .toBe(400);
  expect(db.modelCalls.size).toBe(0);
  expect(db.sandboxCalls.size).toBe(0);
 });
});

// eslint-disable-next-line max-lines-per-function -- Three complete signed model and tool turns.
describe("Sprint 3.5 owner-signed bounded Agent Sequence (offline only)",()=>{
 it("completes edit -> failed build -> AI repair as three CAS steps, preserving recovery",async()=>{
  const person=await client(),db=new Database();
  const prompt="建立漂亮的多人骰子遊戲含動畫、計分與排行榜";
  let modelCalls=0,containerCalls=0;
  const fetch=createWorkerFetch({}, {now:()=>TIME,agent:{...db.makeDeps(),
   sendModel:async({request}:{request:{input:unknown;previous_response_id?:string}})=>{
    modelCalls++;
    if(modelCalls===1){
     const project=Array.from(db.snapshots.values())[0]!.snapshot as {
      files:{path:string;hash:string}[]};
     const edits=[
      {path:"src/main.ts",previous_hash:project.files.find(f=>f.path==="src/main.ts")!.hash,
       content:"import {roll} from './dice'; document.querySelector('#app')!.textContent=String(roll(4));"},
      {path:"src/dice.ts",previous_hash:"",content:"export const roll=(n:number)=>n*4;"}
     ];
     return {id:"resp_sequence_first123456",status:"completed",
      usage:{input_tokens:120,output_tokens:140},output:[
       {type:"function_call",call_id:"call_sequence_edit123456",
        name:"write_files",arguments:JSON.stringify({edits_json:JSON.stringify(edits)})}]};
    }
    if(modelCalls===2){
     expect(request.previous_response_id).toBe("resp_sequence_first123456");
     return {id:"resp_sequence_build123456",status:"completed",
      usage:{input_tokens:100,output_tokens:40},output:[
       {type:"function_call",call_id:"call_sequence_build123456",
        name:"run_build",arguments:JSON.stringify({target:"project"})}]};
    }
    expect(request.previous_response_id).toBe("resp_sequence_build123456");
    return {id:"resp_sequence_fix123456",status:"completed",
     usage:{input_tokens:80,output_tokens:80},output:[
      {type:"function_call",call_id:"call_sequence_fix123456",
       name:"write_file",arguments:JSON.stringify({
        path:"src/dice.ts",
        previous_hash:(db.snapshots.get(OWNER+":"+db.jobs.get(JOB_ID)!.project_hash)!.snapshot as {
         files:{path:string;hash:string}[]}).files.find(f=>f.path==="src/dice.ts")!.hash,
        content:"export const roll=(n:number)=>n*6;"
       })}]};
   },
   sendSandbox:async(task:{call:{call_id:string;project_hash:string}})=>{
    containerCalls++;
    const detail="TRUSTED_DIAGNOSTIC: Vite unresolved import, repair needed";
    return {call_id:task.call.call_id,project_hash:task.call.project_hash,
     exit_code:1,timed_out:false,detail,
     output_digest:await sha256CodeBytes(new TextEncoder().encode(detail)),
     runner_attestation:"APPF2_ISOLATED_CLOUDFLARE_CONTAINER_V1"};
   }
  }});
  const modelEnv={...env,APPF2_AGENT_AUTOSTEP_ENABLED:"1",
   APPF2_AGENT_MODEL_EXECUTION_ENABLED:"1",
   APPF2_OPENAI_AGENT_API_KEY:"unit_test_fake_provider_key_123456"};
  const allEnabled={...modelEnv,...sandboxEnabled};
  const root="/api/v1/agent-jobs/"+JOB_ID;
  expect((await fetch(await signed(person,"/api/v1/agent-jobs",{
   anonymous_id:OWNER,prompt,max_cost_cents:60,explicit_ai_consent:true
  },"seq_create_12345678"),env)).status).toBe(201);
  expect((await fetch(await signed(person,root+"/model-plan",{
   anonymous_id:OWNER,prompt,model_call_key:"seq_model_one_123456",
   max_charge_cents:5,max_output_tokens:1024,explicit_ai_consent:true
  },"seq_plan_12345678"),modelEnv)).status).toBe(200);
  const steps=[
   {anonymous_id:OWNER,model_call_key:"seq_model_one_123456",
    expected_revision:1,explicit_ai_consent:true,
    next_model_call_key:"seq_model_two_123456",max_ai_charge_cents:5,
    max_output_tokens:1024},
   {anonymous_id:OWNER,model_call_key:"seq_model_two_123456",
    expected_revision:2,explicit_ai_consent:true,
    next_model_call_key:"seq_model_three_123456",max_ai_charge_cents:5,
    max_output_tokens:1024,explicit_container_consent:true,
    max_container_charge_cents:4},
   {anonymous_id:OWNER,model_call_key:"seq_model_three_123456",expected_revision:3}
  ];
  const started=await fetch(await signed(person,root+"/agent-sequence",{
   anonymous_id:OWNER,steps
  },"seq_execute_12345678"),allEnabled);
  expect(started.status).toBe(200);
  expect(await started.json()).toMatchObject({data:{
   status:"SEQUENCE_LIMIT_REACHED",completed_steps:3,revision:4,
   job_state:"CODING",app_published:false}});
  expect(modelCalls).toBe(3);
  expect(containerCalls).toBe(1);
  expect(db.snapshots.size).toBe(3);
  const head=db.jobs.get(JOB_ID)!;
  expect(head.checkpoint.completed_call_ids).toHaveLength(3);
  const reopened=await fetch(await signed(person,root,{anonymous_id:OWNER},
   "seq_reopen_12345678"),env);
  const source=await reopened.json() as {data:{files:{path:string;content:string}[]}};
  expect(source.data.files.find(x=>x.path==="src/dice.ts")?.content)
   .toBe("export const roll=(n:number)=>n*6;");
  const replay=await fetch(await signed(person,root+"/agent-sequence",{
   anonymous_id:OWNER,steps
  },"seq_execute_12345678"),allEnabled);
  expect(replay.status).toBe(503);
  expect(modelCalls).toBe(3);
  expect(containerCalls).toBe(1);
 });
 it("rejects nonchain, unsigned step permission, 4 steps and excessive cost before dispatch",async()=>{
  const person=await client(),db=new Database();
  const fetch=createWorkerFetch({}, {now:()=>TIME,agent:db.makeDeps()});
  const path="/api/v1/agent-jobs/"+JOB_ID+"/agent-sequence";
  const a={anonymous_id:OWNER,model_call_key:"chain_one_123456",
   expected_revision:1,explicit_ai_consent:true,
   next_model_call_key:"chain_two_123456",max_ai_charge_cents:5,
   max_output_tokens:1024};
  const b={anonymous_id:OWNER,model_call_key:"chain_two_123456",expected_revision:2};
  const flags={...env,APPF2_AGENT_AUTOSTEP_ENABLED:"1"};
  for(const steps of [
   [a,{...b,model_call_key:"other_chain_123456"}],
   [a,{...b,expected_revision:3}],
   [a,b,b,b],
   [{...a,max_ai_charge_cents:100},{...b,explicit_container_consent:true,
    max_container_charge_cents:5}],
   [{...a,explicit_ai_consent:false},b]
  ]){
   const resp=await fetch(await signed(person,path,{anonymous_id:OWNER,steps},
    "seq_invalid_"+String(steps.length)+"_"+String(steps[0]?.expected_revision)),flags);
   expect(resp.status).toBe(400);
  }
  expect((await fetch(await signed(person,path,{anonymous_id:OWNER,steps:[a,b]},
   "seq_disabled_12345678"),env)).status).toBe(404);
  expect(db.modelCalls.size).toBe(0);
  expect(db.sandboxCalls.size).toBe(0);
 });
});
