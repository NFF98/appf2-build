import {describe,it,expect} from "vitest";
import {createWorkerFetch} from "../../src/edge/worker-entry.js";
import type {Appf2WorkerEnv} from "../../src/edge/worker-composition.js";
import type {AgentJobRouteDeps} from "../../src/edge/agent-jobs.js";
import type {AgentJobRow} from "../../src/platform/agent/postgres-agent-jobs.js";
import type {AgentCheckpoint} from "../../src/platform/agent/agent-contract.js";
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
 identities=new Map<string,{thumb:string;key:string}>();
 context:WorkerRequestDbContext|null=null;
 readonly db={
  close:async()=>undefined,
  // eslint-disable-next-line complexity -- Simulated SQL is used to test owner binding and idempotent creates.
  query:async<T>(sql:string,args:readonly unknown[]):Promise<{rows:readonly T[]}>=>{
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
    const id=Array.from(this.identities.entries()).find(([_,ident])=>
     ident.thumb===args[1]&&ident.key===args[2])?.[0];
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
