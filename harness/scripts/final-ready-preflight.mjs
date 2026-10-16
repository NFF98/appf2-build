// Fail-closed, exact-HEAD readiness check for all required GitHub workflows.
// This is an admission gate, not proof of Human identity or a replacement for GCCA.
// Evidence is external to HEAD (append-only PR comments); the code HEAD never embeds its own SHA.
import fs from "node:fs";
import { pathToFileURL } from "node:url";
import { finalGateVerdict, readLiveDelegationEvidence } from "./task-pr-lifecycle.mjs";
import { exceptionDigest, matchesPathRule } from "./human-exception.mjs";
import { verifyLiveGrant } from "./trusted-human-task-grant.mjs";

export const READY_MARKER="[APPF2-FINAL-READY-V1]";
export const READY_SCHEMA="APPF2-FINAL-READY-V1";
export const REQUIRED_LOCAL=[
  "npm ci","npm run check:lint","npm run gate","npm run dry-run:attack",
  "npm run product:ci","node harness/scripts/final-ready-selftest.mjs"
];
const HEX40=/^[0-9a-f]{40}$/, HEX64=/^[0-9a-f]{64}$/;
const KINDS=["LOCAL_TESTS","GPT_BCE","HUMAN_FINAL_READY"];
const validUrl=(s,repo)=>{
  if(typeof s!=="string") return false;
  const prefix="https://github.com/"+repo+"/";
  if(!s.startsWith(prefix)) return false;
  return /^(?:issues|pull)\/\d+(?:#issuecomment-\d+)?$|^actions\/runs\/\d+(?:\/job\/\d+)?$|^commit\/[0-9a-f]{40}$/.test(s.slice(prefix.length));
};
// Only a specific immutable workflow job or referenced GitHub comment can serve as a log pointer.
// SHA256 strings are structurally checked here; independent BCE must verify actual linked log bytes.
const specificEvidenceUrl=(s,repo)=>validUrl(s,repo) &&
  (s.includes("/actions/runs/") && /\/job\/\d+$/.test(s) ||
   /#issuecomment-\d+$/.test(s));
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
    assertion(specificEvidenceUrl(run?.log_url,ctx.repo),
      "local test proof needs an exact workflow job or GitHub comment, not a mutable issue root: "+run?.command,e);
    assertion(run?.head_sha===ctx.head && run?.base_sha===ctx.base,
      "local test log must bind current exact HEAD and BASE: "+run?.command,e);
    assertion(Date.parse(run?.completed_at)<=Date.parse(ctx.localCommentCreatedAt),
      "local run completed after its claimed attestation comment: "+run?.command,e);
  }
  return e;
};
const bceEvidenceErrors=(r,ctx)=>{
  const e=[];
  assertion(r.scope_verdict==="PASS" && r.execution_evidence_verdict==="PASS",
    "GPT BCE requires separate scope and execution-evidence PASS",e);
  assertion(r.reviewer_role==="GPT_INDEPENDENT" && nonEmpty(r.independent_review_note),
    "GPT BCE reviewer declaration/review note missing; role remains manually verified",e);
  assertion(specificEvidenceUrl(r.review_url,ctx.repo) && HEX64.test(r.review_sha256||""),
    "GPT BCE immutable review reference/digest missing",e);
  return e;
};
const humanEvidenceErrors=(r,c,ctx)=>{
  const e=[];
  assertion(r.verdict==="APPROVED" && r.decision==="APPROVE_FINAL_INTEGRATION_READY",
    "exact Human Final Ready decision missing",e);
  assertion(r.approver===ctx.owner && isRepoOwner(c,ctx.owner),
    "Human approval needs repository owner; machine cannot authenticate person",e);
  assertion(HEX64.test(r.candidate_sha256||"") && r.candidate_sha256===ctx.candidateDigest,
    "Human exact candidate digest missing/mismatched against Git content",e);
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
  const runs=safeArray(checks?.check_runs).filter(x=>x.name==="fast-loop" && x.head_sha===head);
  const rows=runs.filter(x=>Number.isSafeInteger(x.id) && x.id>0).sort((a,b)=>b.id-a.id);
  // Old PASS must not mask a newer failed/re-run attempt for the same HEAD.
  if(rows.length!==runs.length || !rows.length) return ["missing complete ID-bound current-HEAD fast-loop result"];
  const latest=rows[0];
  return latest.status==="completed" && latest.conclusion==="success"?[]:
    ["latest exact-HEAD fast-loop failed, skipped or is still running; older PASS cannot override"];
};
const prIdentityMatches=(pr,live,head,base)=>
  pr.number===live.number && pr.head?.sha===head && pr.base?.sha===base;
const prHeadAndBaseValid=(head,base)=>HEX40.test(head||"") && HEX40.test(base||"");
const prOpenReady=(pr,live)=>live.state==="open" && !live.draft && !pr.draft;
const prIsSameRepo=(live,repo)=>live.base?.ref==="main" && live.head?.repo?.full_name===repo;
const prMetadataErrors=(event,live,repo)=>{
  const e=[],pr=event?.pull_request,head=live?.head?.sha,base=live?.base?.sha;
  if(!pr || !live) return ["missing live PR metadata"];
  assertion(prIdentityMatches(pr,live,head,base),"PR event stale or missing fields vs live PR",e);
  assertion(prHeadAndBaseValid(head,base),"missing exact HEAD/BASE",e);
  assertion(prOpenReady(pr,live),"NOT_READY: PR is Draft or closed",e);
  assertion(prIsSameRepo(live,repo),"unexpected PR base or fork",e);
  return e;
};
const stageEvidenceErrors=(x,ctx)=>{
  if(x.record.kind==="LOCAL_TESTS") return localEvidenceErrors(x.record,{...ctx,localCommentCreatedAt:x.comment.created_at});
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
// Same exact path+bytes SHA256 as the constitutional and Human-exception validators.
export function candidateDigestOf(changedFiles,readBytes){
  if(!Array.isArray(changedFiles)) return null;
  const paths=changedFiles.flat().map(x=>x?.filename);
  if(paths.some(x=>!nonEmpty(x)) || new Set(paths).size!==paths.length) return null;
  const dockets=paths.filter(x=>/^delivery\/constitutional-cases\/GOV-[A-Z0-9-]+\.json$/.test(x));
  const others=dockets.length===1?paths.filter(x=>x!==dockets[0]):paths;
  return exceptionDigest(readBytes,others);
};
/** Pure verifier. A shared GitHub OWNER credential is NOT cryptographic Human provenance. */
export function inspectPrReadiness({event,live,comments,checks,changedFiles,candidateDigest,repo}){
  const errors=prMetadataErrors(event,live,repo),head=live?.head?.sha,base=live?.base?.sha;
  const ctx={head,base,live,repo,owner:repo.split("/")[0],candidateDigest};
  assertion(HEX64.test(candidateDigest||""),"cannot compute exact Git-byte candidate SHA256",errors);
  errors.push(...currentReadinessErrors({comments,ctx}),...fastLoopErrors(checks,head),
    ...protectedChangeErrors(changedFiles,comments,head));
  return {ok:errors.length===0,head,errors,manual_provenance_required:true};
}
// L1 Task: Human's ONE GitHub Environment approval replaces the extra
// Final Ready comment. Local proof, independent BCE and FOUR live GitHub check
// runs remain mandatory; a fake caller Boolean cannot enter via the real CLI.
const REAL_CHECKS=["ci","attack","governance","Analyze JavaScript / TypeScript"];
export function inspectLiveGitHubRequiredChecks({head,checks}){
  const errors=[];
  const rows=safeArray(checks?.check_runs);
  for(const name of REAL_CHECKS){
    const matched=rows.filter(x=>x.name===name && x.head_sha===head)
      .sort((a,b)=>(b.id||0)-(a.id||0));
    if(!matched.length || matched[0]?.status!=="completed" ||
      matched[0]?.conclusion!=="success" ||
      matched[0]?.app?.slug!=="github-actions")
      errors.push("真實 GitHub Check 未達精確 HEAD success: "+name);
  }
  return errors;
}
// A branch push may have four green check names on the SAME SHA and even
// list the PR in check_run.pull_requests. Only an authenticated pull_request
// workflow run is eligible for the actual Ready full-gate decision.
const REQUIRED_PR_WORKFLOWS={
  ci:".github/workflows/ci.yml",
  attack:".github/workflows/attack-dry-run.yml",
  governance:".github/workflows/governance-gate.yml",
  "Analyze JavaScript / TypeScript":".github/workflows/codeql.yml"
};
const latestRequiredCheck=(checks,name,head)=>safeArray(checks?.check_runs)
  .filter(c=>c.name===name&&c.head_sha===head)
  .sort((a,b)=>(b.id||0)-(a.id||0))[0];
const exactJobRunRef=check=>{
  const match=/^https:\/\/github\.com\/NFF98\/appf2-build\/actions\/runs\/(\d+)\/job\/(\d+)$/
    .exec(check?.details_url||"");
  if(!match||Number(match[2])!==check?.id)return null;
  return Number(match[1]);
};
export const checkReadyPrRunOrigin=({name,check,run,head,base,prNumber}={})=>{
  const id=exactJobRunRef(check);
  return id!==null && Number.isSafeInteger(id) &&
    run?.id===id && run?.event==="pull_request" &&
    run?.path===REQUIRED_PR_WORKFLOWS[name] &&
    run?.repository?.full_name==="NFF98/appf2-build" &&
    run?.head_sha===head &&
    run?.status==="completed" && run?.conclusion==="success" &&
    safeArray(run.pull_requests).some(p=>p.number===prNumber &&
      p.head?.sha===head && p.base?.sha===base);
};
export async function verifyLiveRequiredPrRunOrigins({head,base,prNumber,checks,token}={}){
  if(!HEX40.test(head||"")||!HEX40.test(base||"")||
    !Number.isSafeInteger(prNumber)||prNumber<1||!token)
    throw Error("HARD_STOP: required PR workflow provenance context unavailable");
  const selected=REAL_CHECKS.map(name=>({
    name,check:latestRequiredCheck(checks,name,head)}));
  if(inspectLiveGitHubRequiredChecks({head,checks}).length ||
    selected.some(({check})=>exactJobRunRef(check)===null))
    throw Error("HARD_STOP: Full Ready PR checks missing or skipped");
  const results=await Promise.all(selected.map(async ({name,check})=>{
    const id=exactJobRunRef(check);
    const response=await fetch("https://api.github.com/repos/NFF98/appf2-build/actions/runs/"+id,{
      headers:{accept:"application/vnd.github+json",
        authorization:"Bearer "+token,"X-GitHub-Api-Version":"2026-03-10",
        "User-Agent":"appf2-ready-run-origin-verifier"}});
    if(!response.ok)throw Error("HARD_STOP: GitHub PR workflow source unavailable "+response.status);
    const run=await response.json();
    return checkReadyPrRunOrigin({name,check,run,head,base,prNumber});
  }));
  if(results.some(ok=>!ok))
    throw Error("HARD_STOP: push/synthetic/full-gate provenance is not a real PR Ready run");
  return {ok:true,head,base,pr_number:prNumber,verified_names:REAL_CHECKS};
}
const validVerifiedGrant=(g,head)=>g?.ok===true &&
  g?.decision==="VERIFIED_GITHUB_HUMAN_APPROVAL"&&
  g?.current_head===head;
const L1_FILE_STATUSES=new Set(["added","modified","removed","renamed",
  "copied","changed","unchanged"]);
const forbiddenL1Path=(path,rules)=>!nonEmpty(path) ||
  path.startsWith("delivery/constitutional-cases/") ||
  rules.some(rule=>matchesPathRule(path,rule));
const l1FileScopeOK=(file,rules)=>{
  if(!L1_FILE_STATUSES.has(file?.status) ||
    forbiddenL1Path(file.filename,rules))return false;
  if(["renamed","copied"].includes(file.status))
    return !forbiddenL1Path(file.previous_filename,rules);
  return file.previous_filename==null;
};
// Ready must NOT approve protected-source renames or deletions disguised as
// ordinary implementation. The independent merge executor also enforces the
// actual Task allowed_write_paths on every live PR filename and origin.
export const l1TaskChangedPathsValid=files=>{
  const rows=Array.isArray(files)?files.flat():[];
  const policy=readJsonFile("harness/policy/repo-policy.json");
  const rules=policy.governance_only_paths;
  return Array.isArray(rules) && rules.length>0 &&
    rows.length>0 && rows.every(f=>l1FileScopeOK(f,rules));
};
const l1BceOrderValid=(records)=>{
  const local=records.find(x=>x.record.kind==="LOCAL_TESTS");
  const bce=records.find(x=>x.record.kind==="GPT_BCE");
  return local&&bce &&
    bce.comment.id>local.comment.id&&
    Date.parse(bce.comment.created_at)>=Date.parse(local.comment.created_at);
};
const l1StageEvidenceErrors=(comments,head,ctx)=>{
  const errors=[],records=safeArray(comments).flat().map(comment=>({
    comment,record:parseReadinessComment(comment)})).filter(x=>x.record?.head_sha===head);
  for(const kind of ["LOCAL_TESTS","GPT_BCE"]){
    const stage=records.filter(x=>x.record.kind===kind);
    assertion(stage.length===1,"缺少或重複 "+kind+" exact-HEAD 證據",errors);
    if(stage.length===1)errors.push(...commonErrors(stage[0].comment,stage[0].record,ctx),
      ...stageEvidenceErrors(stage[0],ctx));
  }
  assertion(l1BceOrderValid(records),"BCE 必須晚於 Local tests",errors);
  return errors;
};
export function inspectTaskPrReadiness({event,live,comments,checks,changedFiles,
  candidateDigest,repo,verifiedGrant,verifiedPrRunOrigins}){
  const errors=prMetadataErrors(event,live,repo);
  const head=live?.head?.sha,base=live?.base?.sha;
  const ctx={head,base,live,repo,owner:repo.split("/")[0],candidateDigest};
  assertion(validVerifiedGrant(verifiedGrant,head),"缺少 API 證明的 Human 一次授權",errors);
  assertion(verifiedPrRunOrigins?.ok===true &&
    verifiedPrRunOrigins.head===head &&
    verifiedPrRunOrigins.base===base &&
    verifiedPrRunOrigins.pr_number===live?.number &&
    REAL_CHECKS.every(name=>verifiedPrRunOrigins.verified_names?.includes(name)),
    "四項 Gate 缺少真實 pull_request 工作流程來源證明；Push PASS 不等於 Ready",errors);
  assertion(HEX64.test(candidateDigest||""),"精確 SHA256 不存在",errors);
  assertion(l1TaskChangedPathsValid(changedFiles),"L1 Task 夾帶受保護治理或 SSOT",errors);
  errors.push(...l1StageEvidenceErrors(comments,head,ctx));
  errors.push(...inspectLiveGitHubRequiredChecks({head,checks}));
  return {ok:!errors.length,head,errors,manual_provenance_required:false,
    grant_kind:"GITHUB_ENVIRONMENT_REVIEW",human_approvals_required:1};
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
async function main(argv){
  const val=name=>{const n=argv.indexOf("--"+name);return n<0?null:argv[n+1];};
  const eventName=process.env.GITHUB_EVENT_NAME,repo=process.env.GITHUB_REPOSITORY;
  const event=readJsonFile(val("event"));
  let result;
  if(eventName==="pull_request"){
    const live=readJsonFile(val("live-pr"));
    // Shell's first-page Check Runs preview is NOT authoritative. Read all
    // official GitHub comments/files/checks through the trusted executor's
    // complete paginated and duplicate-rejecting API path for Ready too.
    const {comments,changed,checks}=await readLiveDelegationEvidence({
      prNumber:live.number,head:live.head?.sha,
      token:process.env.GH_TOKEN||process.env.GITHUB_TOKEN});
    const changedFiles=changed;
    const candidateDigest=candidateDigestOf(changedFiles,rel=>{
      try{return fs.readFileSync(rel);}catch{return null;}
    });
    // No second Human approval for a normal Task with authenticated GitHub grant.
    if(/^Task:\s*T\d{3}\b/m.test(live.body||"")){
      const verifiedGrant=await verifyLiveGrant({pr:live,
        token:process.env.GH_TOKEN||process.env.GITHUB_TOKEN});
      const verifiedPrRunOrigins=await verifyLiveRequiredPrRunOrigins({
        head:live.head?.sha,base:live.base?.sha,prNumber:live.number,
        checks,token:process.env.GH_TOKEN||process.env.GITHUB_TOKEN});
      result=inspectTaskPrReadiness({event,live,comments,checks,changedFiles,
        candidateDigest,repo,verifiedGrant,verifiedPrRunOrigins});
    }else{
      result=inspectPrReadiness({event,live,comments,checks,changedFiles,candidateDigest,repo});
    }
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
if(process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href)
  main(process.argv.slice(2)).then(code=>{process.exitCode=code;})
    .catch(error=>{console.error("FINAL READY: HARD STOP "+error.message);process.exitCode=1;});
