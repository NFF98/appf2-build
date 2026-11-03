import {beforeEach,describe,expect,it,vi} from "vitest";
import {createUserEdit,acceptUserEdit,validCreateUserEdit,
 validInitializeEdit,validAcceptUserEdit} from "../../src/edge/agent-user-edit.js";
import {validUserEditGenerate} from "../../src/edge/agent-user-edit-model.js";
import {recoverAgentJob} from "../../src/platform/agent/durable-agent-service.js";
import type {AgentJobExecutor} from "../../src/platform/agent/postgres-agent-jobs.js";

vi.mock("../../src/platform/agent/durable-agent-service.js",()=>({
 recoverAgentJob:vi.fn()
}));
const owner="b101ed0f-f0ab-46dc-b880-c0acb35291a0";
const jobId="c101ed0f-f0ab-46dc-b880-c0acb35291a0";
const editId="d101ed0f-f0ab-46dc-b880-c0acb35291a0";
const hash="sha256:"+"a".repeat(64);
const old={version:"1" as const,criteria:[{
 id:"old_button",source_quote:"新增按鈕",description:"按下原有新增按鈕",
 automatable:true,steps:[{action:"click" as const,role:"button" as const,name:"新增"}],
 assertions:[{kind:"text_includes" as const,text:"1"}]
}]};
const fresh={version:"1" as const,criteria:[{
 id:"new_label",source_quote:"新增說明文字",description:"新增說明可見",
 automatable:true,steps:[],
 assertions:[{kind:"text_includes" as const,text:"說明"}]
}]};
const requirements="我需要新增按鈕，按下後計數加一";
const request="請新增說明文字";
const accepted={project_hash:hash,project_revision:2,generation:0,
 requirements_text:requirements,qa_plan:old,qa_plan_hash:hash};
function dbFake(opts:{ownerOk?:boolean;accept?:typeof accepted;
 editState?:string}={}){
 const queries:string[]=[];
 const db:AgentJobExecutor={query:async <T>(sql:string,params?:unknown[])=>{
  queries.push(sql);
  if(sql.includes("owner_key_thumbprint"))
   return {rows:opts.ownerOk===false?[]:[{job_id:jobId} as T]};
  if(sql.includes("appf2_agent_accepted_version")&&sql.startsWith("SELECT"))
   return {rows:opts.accept===undefined?[accepted as T]:[opts.accept as T]};
  if(sql.includes("appf2_agent_user_edit")&&sql.startsWith("SELECT"))
   return {rows:[{edit_id:editId,base_project_hash:hash,base_generation:0,
    state:opts.editState??"QA_FAILED"} as T]};
  if(sql.startsWith("INSERT INTO public.appf2_agent_user_edit"))
   return {rows:[{edit_id:params?.[0]} as T]};
  return {rows:[]};
 }};
 return {db,queries};
}
const ctx=(db:AgentJobExecutor)=>({db,jobId,ownerThumb:"f".repeat(64)});
const input={anonymous_id:owner,expected_project_hash:hash,
 expected_revision:2,expected_generation:0,user_request:request,new_qa_plan:fresh};

describe("SP35 USER_EDIT original Accepted version safety",()=>{
 beforeEach(()=>{
  vi.clearAllMocks();
  vi.mocked(recoverAgentJob).mockResolvedValue({
   job:{revision:2,job_state:"CODING"} as never,
   project:{project_hash:hash} as never
  });
 });
 it("rejects missing or forged consents / unconfirmed QA before any model",()=>{
  expect(validCreateUserEdit(input)).toBe(true);
  expect(validCreateUserEdit({...input,new_qa_plan:{version:"1",criteria:[]}})).toBe(false);
  expect(validCreateUserEdit({...input,extra:"inject"})).toBe(false);
  expect(validInitializeEdit({anonymous_id:owner,original_prompt:requirements,
   expected_project_hash:hash,expected_revision:2})).toBe(true);
  const accept={anonymous_id:owner,expected_accepted_hash:hash,
   expected_generation:0,explicit_accept_consent:true};
  expect(validAcceptUserEdit(accept)).toBe(true);
  expect(validAcceptUserEdit({...accept,explicit_accept_consent:false})).toBe(false);
  const generate={anonymous_id:owner,edit_id:editId,expected_accepted_hash:hash,
   expected_generation:0,expected_revision:2,
   explicit_ai_consent:true,explicit_free_ci_consent:true};
  expect(validUserEditGenerate(generate)).toBe(true);
  expect(validUserEditGenerate({...generate,explicit_ai_consent:false})).toBe(false);
 });
 it("saves an independent QA draft without modifying source or invoking AI",async()=>{
  const {db,queries}=dbFake();
  const result=await createUserEdit(input,ctx(db));
  expect(result.status).toBe("USER_EDIT_DRAFT_SAVED_NO_AI");
  expect(result.paid_ai_calls).toBe(0);
  expect(result.accepted_project_hash).toBe(hash);
  expect(queries.some(q=>q.includes("INSERT INTO public.appf2_agent_user_edit"))).toBe(true);
  expect(queries.some(q=>/appf2_agent_model_call|UPDATE public.appf2_agent_job/u.test(q))).toBe(false);
 });
 it("denies another owner before any edit write",async()=>{
  const {db,queries}=dbFake({ownerOk:false});
  await expect(createUserEdit(input,ctx(db))).rejects.toThrow("SP35_USER_EDIT_NOT_CREATOR");
  expect(queries.some(q=>q.startsWith("INSERT"))).toBe(false);
 });
 it("denies stale accepted generation and working-head races",async()=>{
  const {db,queries}=dbFake();
  await expect(createUserEdit({...input,expected_generation:1},ctx(db)))
   .rejects.toThrow("SP35_USER_EDIT_BASE_CAS_CONFLICT");
  expect(queries.some(q=>q.startsWith("INSERT"))).toBe(false);
 });
 it("cannot silently reuse an old criterion ID to overwrite accepted QA",async()=>{
  const {db,queries}=dbFake();
  const renamed={...fresh,criteria:[{...fresh.criteria[0],id:"old_button"}]};
  await expect(createUserEdit({...input,new_qa_plan:renamed},ctx(db)))
   .rejects.toThrow("SP35_USER_EDIT_QA_CANNOT_ACCUMULATE");
  expect(queries.some(q=>q.startsWith("INSERT"))).toBe(false);
 });
 it("a failed candidate can NEVER invoke the atomic accept procedure",async()=>{
  const {db,queries}=dbFake({editState:"QA_FAILED"});
  await expect(acceptUserEdit({anonymous_id:owner,expected_accepted_hash:hash,
   expected_generation:0,explicit_accept_consent:true},editId,ctx(db)))
   .rejects.toThrow("SP35_USER_EDIT_ACCEPTED_STALE_OR_UNTESTED");
  expect(queries.some(q=>q.includes("appf2_internal.accept_user_edit"))).toBe(false);
 });
});
