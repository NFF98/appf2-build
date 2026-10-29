import {describe,it,expect} from "vitest";
import {createWorkerFetch} from "../../src/edge/worker-entry.js";
import type {Appf2WorkerEnv} from "../../src/edge/worker-composition.js";
import type {AgentJobRouteDeps} from "../../src/edge/agent-jobs.js";
import type {AgentJobRow} from "../../src/platform/agent/postgres-agent-jobs.js";
import type {AgentCheckpoint} from "../../src/platform/agent/agent-contract.js";
import type {ModelCallRow} from "../../src/platform/agent/postgres-model-calls.js";
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
