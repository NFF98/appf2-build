// Fail-closed, exact-HEAD readiness check for all required GitHub workflows.
// This is an admission gate, not proof of Human identity or a replacement for GCCA.
// Evidence is external to HEAD (append-only PR comments); the code HEAD never embeds its own SHA.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { finalGateVerdict } from "./task-pr-lifecycle.mjs";

export const READY_MARKER="[APPF2-FINAL-READY-V1]";
export const READY_SCHEMA="APPF2-FINAL-READY-V1";
export const REQUIRED_LOCAL=[
  "npm ci","npm run check:lint","npm run gate","npm run dry-run:attack",
  "npm run product:ci","node harness/scripts/final-ready-selftest.mjs"
];
const HEX40=/^[0-9a-f]{40}$/, HEX64=/^[0-9a-f]{64}$/;
const KINDS=["LOCAL_TESTS","GPT_BCE","HUMAN_FINAL_READY"];
const validUrl=(s,repo)=>typeof s==="string" && s.startsWith("https://github.com/"+repo+"/") &&
  !s.includes("..") && !s.includes("#");
const stamp=s=>typeof s==="string" && Number.isFinite(Date.parse(s));
const nonEmpty=s=>typeof s==="string" && s.trim().length>0;
const isRepoOwner=(c,owner)=>c?.user?.login===owner && c?.user?.type==="User" && c?.author_association==="OWNER";
const numericPass=r=>r?.status==="PASS" && r.exit_code===0 && HEX64.test(r.log_sha256||"") &&
  nonEmpty(r.node_version) && stamp(r.completed_at);
const safeArray=x=>Array.isArray(x)?x:[];
const assertion=(ok,msg,e)=>{if(!ok)e.push(msg);};
const readJsonFile=file=>JSON.parse(fs.readFileSync(file,"utf8"));

export function parseReadinessComment(comment){
  const body=comment?.body;
  if(typeof body!=="string" || !body.startsWith(READY_MARKER+"\n")) return null;
  try{
    const a=JSON.parse(body.slice(READY_MARKER.length+1));
    return a && typeof a==="object" && !Array.isArray(a)?a:{invalid:"not an object"};
  }catch{return {invalid:"malformed JSON"};}
}
const sourceErrors=(c,owner)=>{
  const errors=[];
  assertion(isRepoOwner(c,owner),"comment author must be repository OWNER, non-bot",errors);
  assertion(Number.isSafeInteger(c.id) && c.id>0,"comment id missing",errors);
  assertion(stamp(c.created_at) && c.created_at===c.updated_at,"comment must be unedited and dated",errors);
  return errors;
};
const commonErrors=(c,record,ctx)=>{
  const e=[];
  assertion(record.schema===READY_SCHEMA,"unknown readiness schema",e);
  assertion(record.pr_number===ctx.live.number,"readiness PR number mismatch",e);
  assertion(record.head_sha===ctx.head && HEX40.test(record.head_sha||""),"stale or malformed readiness HEAD",e);
  assertion(record.base_sha===ctx.base && HEX40.test(record.base_sha||""),"stale or malformed readiness BASE",e);
  assertion(record.verdict==="PASS" || (record.kind==="HUMAN_FINAL_READY" && record.verdict==="APPROVED"),
    "readiness verdict is not PASS/APPROVED",e);
  assertion(KINDS.includes(record.kind),"unknown readiness stage",e);
  return e.concat(sourceErrors(c,ctx.owner));
};
const localEvidenceErrors=(record,ctx)=>{
  const e=[],runs=safeArray(record.test_runs);
  assertion(runs.length>=REQUIRED_LOCAL.length,"local test manifest missing required commands",e);
  assertion(nonEmpty(record.environment) && nonEmpty(record.lock_sha256) &&
    HEX64.test(record.lock_sha256||""),"local environment/lock digest missing",e);
  for(const name of REQUIRED_LOCAL){
    const matched=runs.filter(r=>r.command===name);
    assertion(matched.length===1,"local command missing or duplicated: "+name,e);
  }
  for(const run of runs){
    assertion(numericPass(run),"local test skipped/failed or missing immutable log digest: "+run?.command,e);
    assertion(validUrl(run?.log_url,ctx.repo),"local test evidence link is not repository-scoped: "+run?.command,e);
  }
  return e;
};
const bceEvidenceErrors=(r,ctx)=>{
  const e=[];
  assertion(r.scope_verdict==="PASS" && r.execution_evidence_verdict==="PASS",
    "GPT BCE requires separate scope and execution-evidence PASS",e);
  assertion(r.reviewer_role==="GPT_INDEPENDENT" && nonEmpty(r.independent_review_note),
    "GPT BCE reviewer declaration/review note missing; role remains manually verified",e);
  assertion(validUrl(r.review_url,ctx.repo) && HEX64.test(r.review_sha256||""),
    "GPT BCE immutable review reference/digest missing",e);
  return e;
};
const humanEvidenceErrors=(r,c,ctx)=>{
  const e=[];
  assertion(r.verdict==="APPROVED" && r.decision==="APPROVE_FINAL_INTEGRATION_READY",
    "exact Human Final Ready decision missing",e);
  assertion(r.approver===ctx.owner && isRepoOwner(c,ctx.owner),
    "Human approval needs repository owner; machine cannot authenticate person",e);
  assertion(HEX64.test(r.candidate_sha256||""),"Human exact candidate digest missing",e);
  assertion(r.human_provenance_manual_check_required===true,
    "Human-origin ambiguity must remain explicit",e);
  return e;
};
const uniqueStageErrors=(records,head)=>{
  const e=[];
  const current=records.filter(r=>r.record.head_sha===head);
  for(const kind of KINDS) assertion(current.filter(x=>x.record.kind===kind).length===1,
    "exactly one "+kind+" attestation required for current HEAD",e);
  return {current,e};
};
const orderErrors=records=>{
  const e=[];
  if(records.length!==3)return ["incomplete current-HEAD readiness chain"];
  const stages=KINDS.map(k=>records.find(x=>x.record.kind===k));
  if(stages.some(x=>!x))return ["missing ordered stage"];
  for(let i=1;i<stages.length;i++){
    const prev=stages[i-1].comment,cur=stages[i].comment;
    assertion(cur.id>prev.id && Date.parse(cur.created_at)>=Date.parse(prev.created_at),
      "readiness stage ordering violation: "+KINDS[i],e);
  }
  return e;
};
const fastLoopErrors=(checks,head)=>{
  const rows=safeArray(checks?.check_runs).filter(x=>x.name==="fast-loop" && x.head_sha===head);
  const good=rows.some(r=>r.status==="completed" && r.conclusion==="success");
  return good?[]:["missing independent successful current-HEAD GitHub fast-loop; skipped is not PASS"];
};
const prMetadataErrors=(event,live,repo)=>{
  const e=[],pr=event?.pull_request,head=live?.head?.sha,base=live?.base?.sha;
  if(!pr || !live) return ["missing live PR metadata"];
  assertion(pr.number===live.number && pr.head?.sha===head && pr.base?.sha===base,
    "PR event stale or missing fields vs live PR",e);
  assertion(HEX40.test(head||"") && HEX40.test(base||""),"missing exact HEAD/BASE",e);
  assertion(live.state==="open" && !live.draft && !pr.draft,"NOT_READY: PR is Draft or closed",e);
  assertion(live.base?.ref==="main" && live.head?.repo?.full_name===repo,
    "unexpected PR base or fork",e);
  return e;
};
const stageEvidenceErrors=(x,ctx)=>{
  if(x.record.kind==="LOCAL_TESTS") return localEvidenceErrors(x.record,ctx);
  if(x.record.kind==="GPT_BCE") return bceEvidenceErrors(x.record,ctx);
  if(x.record.kind==="HUMAN_FINAL_READY") return humanEvidenceErrors(x.record,x.comment,ctx);
  return ["unknown readiness stage"];
};
const currentReadinessErrors=({comments,ctx})=>{
  const decoded=safeArray(comments).flat().map(comment=>({comment,record:parseReadinessComment(comment)}))
    .filter(x=>x.record!==null);
  const {current,e}=uniqueStageErrors(decoded,ctx.head);
  const errors=[...e,...orderErrors(current)];
  for(const x of current){
    if(x.record.invalid){errors.push("malformed readiness proof");continue;}
    errors.push(...commonErrors(x.comment,x.record,ctx),...stageEvidenceErrors(x,ctx));
  }
  return errors;
};
const protectedChangeErrors=(files,comments,head)=>{
  if(!Array.isArray(files)) return ["protected changed-file inventory is unavailable"];
  const changed=files.flat().map(x=>x?.filename).filter(nonEmpty);
  if(changed.length!==files.flat().length) return ["protected changed-file inventory malformed"];
  const workflowChanged=changed.some(x=>x.startsWith(".github/workflows/"));
  const gateChanged=changed.some(x=>x==="harness/scripts/final-ready-preflight.mjs" ||
    x==="harness/scripts/run-final-ready-preflight.sh");
  if(!workflowChanged || !gateChanged) return [];
  const human=comments.flat().map(parseReadinessComment)
    .find(r=>r?.head_sha===head && r.kind==="HUMAN_FINAL_READY");
  return human?.protected_change_acknowledged===true?[]:
    ["protected workflow and admission gate changed together without Human explicit acknowledgment"];
};
/** Pure verifier. A shared GitHub OWNER credential is NOT cryptographic Human provenance. */
export function inspectPrReadiness({event,live,comments,checks,changedFiles,repo}){
  const errors=prMetadataErrors(event,live,repo),head=live?.head?.sha,base=live?.base?.sha;
  const ctx={head,base,live,repo,owner:repo.split("/")[0]};
  errors.push(...currentReadinessErrors({comments,ctx}),...fastLoopErrors(checks,head),
    ...protectedChangeErrors(changedFiles,comments,head));
  return {ok:errors.length===0,head,errors,manual_provenance_required:true};
}
/** On push, require an associated merged PR: a direct main push cannot greenwash gates. */
export function inspectNonPrInvocation({eventName,ref,sha,associatedPrs}){
  if(eventName==="workflow_dispatch" || eventName==="schedule"){
    return ref==="refs/heads/main"?{ok:true,reason:"main maintenance run"}:{ok:false,errors:["non-main manual/scheduled execution"]};
  }
  if(eventName!=="push" || ref!=="refs/heads/main" || !HEX40.test(sha||"")){
    return {ok:false,errors:["non-PR workflow invocation is not protected main push"]};
  }
  const exists=safeArray(associatedPrs).flat().some(pr=>pr.merged_at && pr.merge_commit_sha===sha && pr.base?.ref==="main");
  return exists?{ok:true,reason:"verified merged PR main push"}:
    {ok:false,errors:["direct main push without associated merged PR is NOT_READY"]};
}
/** Final result audit: BCE cannot override failed, missing, skipped or stale required GCCA. */
export function bceCiConsistency({head,checks,required,bcePass}){
  const full=finalGateVerdict({head,required,checks});
  return bcePass && full.verdict!=="PASS"?
    {ok:false,reason:"BCE_CI_MISMATCH",head,full}:
    {ok:!bcePass?false:full.verdict==="PASS",reason:full.verdict,head,full};
}
function main(argv){
  const val=name=>{const n=argv.indexOf("--"+name);return n<0?null:argv[n+1];};
  const eventName=process.env.GITHUB_EVENT_NAME,repo=process.env.GITHUB_REPOSITORY;
  const event=readJsonFile(val("event"));
  let result;
  if(eventName==="pull_request"){
    const live=readJsonFile(val("live-pr"));
    result=inspectPrReadiness({event,live,comments:readJsonFile(val("comments")),
      checks:readJsonFile(val("checks")),changedFiles:readJsonFile(val("changed-files")),repo});
  }else{
    result=inspectNonPrInvocation({eventName,ref:process.env.GITHUB_REF,
      sha:process.env.GITHUB_SHA,associatedPrs:val("associated-prs")?readJsonFile(val("associated-prs")):[]});
  }
  if(result.ok){console.log("FINAL READY PREFLIGHT: ADMITTED "+(result.head||result.reason)+
    " | Human provenance MUST be manually verified; not a Human signature");return 0;}
  console.error("FINAL READY PREFLIGHT: NOT_READY");
  for(const e of result.errors||[])console.error("- "+e);
  return 1;
}
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)process.exit(main(process.argv.slice(2)));
