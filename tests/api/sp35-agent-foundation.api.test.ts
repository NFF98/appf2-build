import {describe,it,expect} from "vitest";
import {createProjectSnapshot,verifyProjectSnapshot,applyProjectEdits,assertWorkspacePath}
 from "../../src/platform/agent/project-workspace.js";
import {parseAgentToolCall,validateAgentCheckpoint,advanceAgentCheckpoint}
 from "../../src/platform/agent/agent-contract.js";
import {validateSandboxLimits} from "../../src/platform/agent/sandbox-adapter.js";
import {summarizeCandidateQa,admitsPublicationFromCandidateReceipt}
 from "../../src/platform/agent/qa-receipt.js";
const files=[{path:"index.html",content:"<main id='app'></main>"},
 {path:"src/main.ts",content:"import {add} from './math'; console.log(add(1,2))"},
 {path:"src/math.ts",content:"export const add=(a:number,b:number)=>a+b;"}];
const h="sha256:"+"a".repeat(64);
describe("Sprint 3.5 agent foundation is candidate-only, no cloud or AI claims",()=>{
 it("makes immutable content-addressed multi-file versions and enforces CAS",async()=>{
  const base=await createProjectSnapshot("VITE_WEB","index.html",files);
  expect(await verifyProjectSnapshot(base)).toBe(true);
  expect(base.files.map(x=>x.path)).toEqual(["index.html","src/main.ts","src/math.ts"]);
  expect(base.project_hash).toMatch(/^sha256:[0-9a-f]{64}$/u);
  const changed=await applyProjectEdits(base,base.project_hash,[{
   operation:"replace",path:"src/math.ts",
   previous_hash:base.files[2].hash,content:"export const add=(a:number,b:number)=>a-b;"
  },{operation:"add",path:"src/extra.ts",content:"export const extra=7;"}]);
  expect(changed.revision).toBe(2);
  expect(changed.parent_hash).toBe(base.project_hash);
  expect(changed.project_hash).not.toBe(base.project_hash);
  expect(await verifyProjectSnapshot(changed)).toBe(true);
  await expect(applyProjectEdits(base,changed.project_hash,[
   {operation:"delete",path:"src/math.ts",previous_hash:base.files[2].hash}
  ])).rejects.toThrow("PROJECT_STALE_REVISION");
  await expect(applyProjectEdits(base,base.project_hash,[
   {operation:"delete",path:"src/math.ts",previous_hash:h}
  ])).rejects.toThrow("PROJECT_EDIT_CONFLICT");
 });
 it("rejects traversal, credential paths, duplicate case and source tampering",async()=>{
  for(const path of ["../x","/etc/passwd","x\\evil",".env","public/.git/config",
    "node_modules/a","src/../../x","src//x","src/%2e%2e","CON","src/.hidden"]){
   expect(()=>assertWorkspacePath(path)).toThrow("PROJECT_UNSAFE_PATH");
  }
  await expect(createProjectSnapshot("VITE_WEB","index.html",[
   ...files,{path:"SRC/MAIN.TS",content:"duplicate"}
  ])).rejects.toThrow("PROJECT_DUPLICATE_PATH");
  const base=await createProjectSnapshot("VITE_WEB","index.html",files);
  expect(await verifyProjectSnapshot({...base,files:base.files.map(f=>
   f.path==="index.html"?{...f,content:"tampered"}:f)})).toBe(false);
  expect(await verifyProjectSnapshot({...base,evil:true})).toBe(false);
  expect(await verifyProjectSnapshot({...base,project_hash:h})).toBe(false);
  await expect(createProjectSnapshot("VITE_WEB","index.html",[
   {path:"index.html",content:"x".repeat(256*1024+1)}
  ])).rejects.toThrow("PROJECT_SIZE_LIMIT");
 });
 it("allows only broker tool schemas, never shell commands or model-defined test targets",()=>{
  const valid={call_id:"call_12345678",name:"run_build",project_hash:h,args:{target:"project"}};
  expect(parseAgentToolCall(valid)).toEqual(valid);
  expect(parseAgentToolCall({...valid,args:{target:"npm run deploy"}})).toBeNull();
  expect(parseAgentToolCall({...valid,name:"exec",args:{command:"rm -rf /"}})).toBeNull();
  expect(parseAgentToolCall({...valid,args:{...valid.args,command:"curl metadata"}})).toBeNull();
  expect(parseAgentToolCall({...valid,name:"write_file",
    args:{path:"../secrets",content:"x",previous_hash:""}})).toBeNull();
  expect(parseAgentToolCall({...valid,name:"write_file",
    args:{path:"src/main.ts",content:"x",previous_hash:""}})?.name).toBe("write_file");
 });
 it("rejects budget overruns, replay IDs and impossible transitions",()=>{
  const b={max_steps:10,max_tokens:1000,max_cost_cents:0};
  const old={version:"APPF2_AGENT_CHECKPOINT_V1" as const,job_id:"job_12345678",
   state:"CREATED" as const,project_hash:h,step:0,tokens_used:0,cost_cents:0,
   budget:b,completed_call_ids:[],previous_checkpoint_id:null};
  const next={...old,state:"PLANNING" as const,step:1,completed_call_ids:["call_12345678"],
   previous_checkpoint_id:h};
  expect(validateAgentCheckpoint(old)).toBe(true);
  expect(()=>advanceAgentCheckpoint(old,next)).not.toThrow();
  expect(()=>advanceAgentCheckpoint(next,{...next,state:"READY"})).toThrow();
  expect(validateAgentCheckpoint({...next,cost_cents:1})).toBe(false);
  expect(validateAgentCheckpoint({...next,completed_call_ids:["call_12345678","call_12345678"]})).toBe(false);
 });
 it("never treats missing tests, forged QA or unattested result as publishable",()=>{
  const receipt={version:"APPF2_CANDIDATE_QA_V1" as const,
   source_project_hash:h,built_artifact_hash:h,sandbox_execution_id:"run_12345678",
   runner_attestation:null,checks:[{
    criterion_id:"browser_click",category:"BROWSER" as const,verdict:"PASS" as const,evidence_hash:h
   }]};
  expect(summarizeCandidateQa(receipt,["browser_click","db_write"]).ready_for_review).toBe(false);
  expect(admitsPublicationFromCandidateReceipt(receipt)).toBe(false);
  expect(summarizeCandidateQa({...receipt,runner_attestation:"unverified"},["browser_click"]).ready_for_review).toBe(true);
  expect(admitsPublicationFromCandidateReceipt({...receipt,runner_attestation:"unverified"})).toBe(false);
  expect(()=>validateSandboxLimits({wall_time_ms:1000,cpu_millis:1000,memory_mb:128,
    disk_mb:256,network_policy:"DENY_ALL",allowed_hosts:["metadata.google.internal"]})).toThrow();
 });
});
