// GOV-REFORM-20261013: one Task -> one enduring PR lifecycle, change routing,
// Activation/Rebind necessity, Task-lease continuity and exact-HEAD full-gate verdicts.
// Pure functions; the CLI only reads canonical repository state.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { matchesPathRule, sameJson, GOVERNANCE_REFORM_POLICY_PATH, HUMAN_EXCEPTION_SCHEMA } from "./human-exception.mjs";

export const LIFECYCLE_STATES=Object.freeze([
  "AUTHORIZED_TASK","DRAFT_DEVELOPMENT","LOCAL_AC_TESTS_PASS","GPT_BCE_PASS",
  "HUMAN_FINAL_INTEGRATION_READY","EXACT_HEAD_FULL_GATES_PASS","HUMAN_MERGE_APPROVED",
  "MERGED","EVIDENCE_AND_CLOSURE"
]);
const HEAD_BOUND=new Set(["LOCAL_AC_TESTS_PASS","GPT_BCE_PASS","HUMAN_FINAL_INTEGRATION_READY","EXACT_HEAD_FULL_GATES_PASS","HUMAN_MERGE_APPROVED"]);
const NEXT={
  AUTHORIZED_TASK:["DRAFT_DEVELOPMENT"],
  DRAFT_DEVELOPMENT:["LOCAL_AC_TESTS_PASS"],
  LOCAL_AC_TESTS_PASS:["GPT_BCE_PASS"],
  GPT_BCE_PASS:["HUMAN_FINAL_INTEGRATION_READY"],
  HUMAN_FINAL_INTEGRATION_READY:["EXACT_HEAD_FULL_GATES_PASS"],
  EXACT_HEAD_FULL_GATES_PASS:["HUMAN_MERGE_APPROVED"],
  HUMAN_MERGE_APPROVED:["MERGED"],
  MERGED:["EVIDENCE_AND_CLOSURE"],
  EVIDENCE_AND_CLOSURE:[]
};
const ACTOR_FOR={
  DRAFT_DEVELOPMENT:["CURSOR"],
  LOCAL_AC_TESTS_PASS:["CURSOR","CI"],
  GPT_BCE_PASS:["GPT"],
  HUMAN_FINAL_INTEGRATION_READY:["HUMAN"],
  EXACT_HEAD_FULL_GATES_PASS:["CI"],
  HUMAN_MERGE_APPROVED:["HUMAN"],
  MERGED:["HUMAN"],
  EVIDENCE_AND_CLOSURE:["HUMAN"]
};
// The prior prototype trusted caller-supplied provenance_checked_by_trusted_executor=true.
// A caller can forge that Boolean; no independent verifier is wired to canonical Human
// authority. Delegated Human-only lifecycle steps are therefore ALWAYS denied until
// a separately reviewed trusted verifier is implemented and tested.
const delegationErrors=({actor})=>
  actor==="GPT_DELEGATED"?
    ["TRUSTED_HUMAN_APPROVAL_VERIFIER_NOT_CONNECTED: AI cannot self-certify Human authority"]:
    null;


/** Any new commit invalidates every HEAD-bound claim; post-merge commits never inherit authority. */
export function onNewHead(record,newHead){
  if(record.head===newHead) return {ok:true,record,invalidated:[]};
  if(["MERGED","EVIDENCE_AND_CLOSURE"].includes(record.state)) return {ok:false,errors:["post-merge commits need a new authorized change; no inherited authority"]};
  const invalidated=HEAD_BOUND.has(record.state)?[record.state]:[];
  const state=invalidated.length?"DRAFT_DEVELOPMENT":record.state;
  return {ok:true,record:{...record,state,head:newHead,attested_head:null},invalidated};
}

const allMappedPass=evidence=>Boolean(evidence?.mapped_tests?.length) && evidence.mapped_tests.every(t=>t.status==="PASS");
const TRANSITION_EVIDENCE={
  LOCAL_AC_TESTS_PASS:[(e)=>allMappedPass(e),"mapped AC/Test results must all be PASS (NOT_RUN/UNTESTED is not PASS)"],
  GPT_BCE_PASS:[(e,head)=>e?.bce_head===head,"GPT BCE must cite the exact current HEAD"],
  EXACT_HEAD_FULL_GATES_PASS:[(e)=>e?.final_gate?.verdict==="PASS","full required gates must PASS on the exact HEAD"],
  HUMAN_MERGE_APPROVED:[(e,head)=>e?.approved_head===head,"Human merge approval must bind the exact HEAD"]
};
const transitionEvidenceErrors=(to,evidence,head)=>{
  const rule=TRANSITION_EVIDENCE[to];
  return !rule || rule[0](evidence,head)?[]:[rule[1]];
};

export function advance(record,{to,actor,head,evidence,conditional_grant,conditional_context}){
  const errors=[],delegated=delegationErrors({record,to,actor,head,
    grant:conditional_grant,context:conditional_context});
  if(!(NEXT[record.state]||[]).includes(to)) errors.push("illegal transition "+record.state+" -> "+to);
  if(!(ACTOR_FOR[to]||[]).includes(actor) && (!delegated || delegated.length))
    errors.push(to+" cannot be set by "+actor);
  if(head!==record.head) errors.push("HEAD changed since the last attestation; call onNewHead first");
  if(delegated) errors.push(...delegated);
  errors.push(...transitionEvidenceErrors(to,evidence,record.head));
  if(errors.length) return {ok:false,errors};
  return {ok:true,record:{...record,state:to,attested_head:HEAD_BOUND.has(to)?head:record.attested_head}};
}

/** Draft/fast-loop/skipped/stale results are never a full-gate PASS. */
export function finalGateVerdict({head,required,checks}){
  const results=required.map(context=>{
    const runs=(checks||[]).filter(c=>c.context===context);
    const latest=runs.filter(c=>c.head_sha===head).at(-1);
    if(!latest) return {context,result:runs.length?"STALE_HEAD":"MISSING"};
    if(latest.mode!=="FULL") return {context,result:"NOT_FULL_MODE_"+(latest.mode||"UNKNOWN")};
    if(latest.conclusion==="skipped" || latest.conclusion==="neutral") return {context,result:"SKIPPED_IS_NOT_PASS"};
    return {context,result:latest.conclusion==="success"?"PASS":"FAILED"};
  });
  return {head,verdict:results.every(r=>r.result==="PASS")?"PASS":"NOT_PASS",results};
}

const isSideEffect=p=>p.startsWith("delivery/evidence/") || p.startsWith("delivery/findings/");
const CONTROL_FILES=/^(?:build-spec\/CURRENT\.json|delivery\/CURRENT-SPRINT\.json|delivery\/backlog\/QUEUE\.json|delivery\/sprints\/SP-P\d+-\d{3}\/(?:tasks|manifest)\.json)$/;
const startsWithAny=(p,list)=>(list||[]).some(rule=>matchesPathRule(p,rule));

const classifyStructural=changed=>{
  if(changed.some(p=>p.startsWith("build-spec/activations/"))) return {change_class:"ACTIVATION",authority:"HUMAN_ACTIVATION"};
  if(changed.some(p=>p.startsWith("build-spec/baselines/"))) return {change_class:"FREEZE_OR_REBASELINE",authority:"HUMAN_FREEZE_THEN_ACTIVATION"};
  if(changed.every(isSideEffect)) return {change_class:"EVIDENCE",authority:"SAME_TASK_LEASE"};
  if(changed.every(p=>isSideEffect(p) || CONTROL_FILES.test(p))) return {change_class:"CLOSURE_OR_STATE_CONTROL",authority:"HUMAN_CONTROL_TRANSITION"};
  return null;
};

/** Route a diff to the smallest legal authority; BUGFIX/TEST inside the Task lease needs no new approval. */
export function classifyChange({changed,task,repoPolicy,exceptionLane}){
  if(!changed.length) return {change_class:"NONE",authority:"NONE"};
  if(exceptionLane) return {change_class:exceptionLane.change_class,authority:"HUMAN_EXACT_EXCEPTION"};
  const structural=classifyStructural(changed);
  if(structural) return structural;
  const relevant=changed.filter(p=>!isSideEffect(p));
  const gov=relevant.filter(p=>startsWithAny(p,repoPolicy.governance_only_paths));
  const product=relevant.filter(p=>startsWithAny(p,repoPolicy.implementation_roots));
  if(gov.length && product.length) return {change_class:"MIXED_FORBIDDEN",authority:"SPLIT_BY_AUTHORITY_OR_EXACT_EXCEPTION"};
  if(gov.length) return {change_class:"GOVERNANCE",authority:"HUMAN_EXACT_EXCEPTION"};
  const inTask=task && relevant.every(p=>startsWithAny(p,task.allowed_write_paths));
  if(!inTask) return {change_class:"OUT_OF_TASK_SCOPE",authority:"FINDING_THEN_PLANNING_OR_HOTFIX"};
  const testsOnly=relevant.every(p=>p.startsWith("tests/"));
  return {change_class:testsOnly?"TEST_IN_TASK":"BUGFIX_OR_IMPLEMENTATION_IN_TASK",authority:"SAME_TASK_LEASE"};
}

/** Activation is required only when execution authority changes, never for routine fixes. */
const sprintIdentity=s=>({sprint:s?.active_sprint??null,task:s?.active_task??null,build:s?.active_build_spec??null});
const buildIdentity=b=>({baseline:b?.active_baseline??null,enabled:b?.implementation_enabled??null});
const resumesExecution=(before,after)=>after?.status==="ACTIVE" && !["ACTIVE","REVIEW"].includes(before?.status);
export function requiresActivation({beforeSprint,afterSprint,beforeBuild,afterBuild}){
  if(!sameJson(sprintIdentity(beforeSprint),sprintIdentity(afterSprint))) return {required:true,reason:"active Sprint/Task/Build binding changed"};
  if(!sameJson(buildIdentity(beforeBuild),buildIdentity(afterBuild))) return {required:true,reason:"active baseline or implementation_enabled changed"};
  if(resumesExecution(beforeSprint,afterSprint)) return {required:true,reason:"execution resumes from "+beforeSprint?.status};
  return {required:false,reason:"no execution-authority change"};
}

/** Rebind is required only for baseline or AC/Test/Task-mapping changes, never for code fixes. */
export function requiresRebind({beforeBaseline,afterBaseline,beforeTasks,afterTasks}){
  if(beforeBaseline!==afterBaseline) return {required:true,reason:"baseline changed"};
  const mapping=td=>(td?.tasks||[]).map(t=>({id:t.task_id,build:t.build_spec_id,links:t.acceptance_links,backlog:t.backlog_item_ids}));
  if(!sameJson(mapping(beforeTasks),mapping(afterTasks))) return {required:true,reason:"Task AC/Test/Backlog mapping changed"};
  return {required:false,reason:"baseline and mappings unchanged"};
}

const SAME_LEASE_CLASSES=new Set(["BUGFIX_OR_IMPLEMENTATION_IN_TASK","TEST_IN_TASK","EVIDENCE"]);
/** Same valid lease + same scope continues without re-approval; anything else never inherits authority. */
export function leaseDecision({lease,request}){
  if(!lease || lease.status!=="ACTIVE") return {decision:"NEW_HUMAN_AUTHORIZATION_REQUIRED",reason:"no active Task lease"};
  for(const key of ["task_id","sprint_id","build_spec_id","scope_digest"]){
    if(lease[key]!==request[key]) return {decision:"NEW_HUMAN_AUTHORIZATION_REQUIRED",reason:key+" changed; no inherited authorization"};
  }
  if(SAME_LEASE_CLASSES.has(request.change_class)) return {decision:"CONTINUE_SAME_LEASE",reason:"same Task, same scope: no repeated approval"};
  return {decision:"SEPARATE_AUTHORITY_REQUIRED",reason:request.change_class+" is outside the Task lease"};
}

export const scopeDigestOf=task=>JSON.stringify([...(task?.allowed_write_paths||[])].sort());


// Trusted live task executor: never accept a caller-supplied "human_verified"
// value, check-run JSON, PR metadata or review comment as the authoritative input.
// This is an explicitly invoked GitHub API operation, NOT a background worker.
const DELEGATED_REPO="NFF98/appf2-build";
const FULL_CHECK_COUNT=100,MAX_GITHUB_PAGES=10;
const uniqueIdentity=(rows,key)=>rows.every(r=>r&&r[key]!=null) &&
  new Set(rows.map(r=>r[key])).size===rows.length;
const pageQuery=(endpoint,index)=>endpoint+
  (endpoint.includes("?")?"&":"?")+"per_page="+FULL_CHECK_COUNT+"&page="+index;
const validPageInput=({rows,accumulated,expected,page})=>[
  Array.isArray(rows),rows?.length<=FULL_CHECK_COUNT,
  Number.isSafeInteger(page),page>=1,page<=MAX_GITHUB_PAGES,
  Number.isSafeInteger(accumulated),accumulated>=0,
  expected===null||Number.isSafeInteger(expected),
  expected===null||expected>=0,
  expected===null||expected<=MAX_GITHUB_PAGES*FULL_CHECK_COUNT
].every(Boolean);
const nextPageDecision=({size,total,expected,page})=>{
  if(expected!==null&&total>expected)return "HARD_STOP";
  if(expected!==null&&total===expected)return "COMPLETE";
  if(size<FULL_CHECK_COUNT)return expected===null?"COMPLETE":"HARD_STOP";
  return page===MAX_GITHUB_PAGES?"HARD_STOP":"NEXT_PAGE";
};
export const githubPageDecision=({rows,accumulated=0,expected=null,page=1}={})=>{
  if(!validPageInput({rows,accumulated,expected,page}))return "HARD_STOP";
  return nextPageDecision({size:rows.length,total:accumulated+rows.length,
    expected,page});
};
const fetchCompleteGitHubRows=async (endpoint,token)=>{
  const rows=[];
  for(let page=1;page<=MAX_GITHUB_PAGES;page++){
    const incoming=await delegateGitHubJson(pageQuery(endpoint,page),token);
    const decision=githubPageDecision({rows:incoming,accumulated:rows.length,page});
    if(decision==="HARD_STOP")throw Error("HARD_STOP: incomplete paginated GitHub inventory");
    rows.push(...incoming);
    if(decision==="COMPLETE")return rows;
  }
  throw Error("HARD_STOP: GitHub inventory exceeded safe pagination cap");
};
const fetchCompleteGitHubChecks=async (endpoint,token)=>{
  const check_runs=[];let expected=null;
  for(let page=1;page<=MAX_GITHUB_PAGES;page++){
    const incoming=await delegateGitHubJson(pageQuery(endpoint,page),token);
    if(!Number.isSafeInteger(incoming?.total_count)||
      (expected!==null&&incoming.total_count!==expected))
      throw Error("HARD_STOP: inconsistent live GitHub check total_count");
    expected=incoming.total_count;
    const decision=githubPageDecision({rows:incoming.check_runs,
      expected,accumulated:check_runs.length,page});
    if(decision==="HARD_STOP")throw Error("HARD_STOP: incomplete check-run inventory");
    check_runs.push(...incoming.check_runs);
    if(decision==="COMPLETE")return {total_count:expected,check_runs};
  }
  throw Error("HARD_STOP: GitHub check-runs exceeded safe pagination cap");
};
export async function readLiveDelegationEvidence({prNumber,head,token}={}){
  if(!delegatedInputOK({prNumber,token,action:"CHECK"})||
    !/^[0-9a-f]{40}$/.test(head||""))
    throw Error("HARD_STOP: invalid live inventory input");
  const root="/repos/"+DELEGATED_REPO;
  const [comments,changed,checks]=await Promise.all([
    fetchCompleteGitHubRows(root+"/issues/"+prNumber+"/comments",token),
    fetchCompleteGitHubRows(root+"/pulls/"+prNumber+"/files",token),
    fetchCompleteGitHubChecks(root+"/commits/"+head+"/check-runs",token)]);
  if(!completeApiInventory({comments,changed,checks}))
    throw Error("HARD_STOP: invalid/duplicated authoritative GitHub inventory");
  return {comments,changed,checks};
}
const isReadyTaskPr=pr=>[pr?.state==="open",pr?.draft===false,
  pr?.base?.ref==="main",pr?.base?.repo?.full_name===DELEGATED_REPO,
  pr?.head?.repo?.full_name===DELEGATED_REPO].every(Boolean);
const isTrustedExactHead=(pr,head)=>[pr?.head?.sha===head,
  /^[0-9a-f]{40}$/.test(head||"")].every(Boolean);
const isExactGitHubGrant=(grant,pr)=>[
  grant?.ok===true,grant?.decision==="VERIFIED_GITHUB_HUMAN_APPROVAL",
  grant?.source_head===pr?.base?.sha,grant?.current_head===pr?.head?.sha].every(Boolean);
const canonicalDelegationState=({task,sprint,build,grant})=>[
  task?.task_id===grant?.task_id,sprint?.active_task===task?.task_id,
  Boolean(sprint?.active_sprint),sprint?.active_build_spec===task?.build_spec_id,
  build?.active_baseline===task?.build_spec_id,build?.implementation_enabled===true,
  ["ACTIVE","REVIEW"].includes(sprint?.status),
  ["IN_PROGRESS","REVIEW"].includes(task?.status)].every(Boolean);
export function delegatedPremergePolicy({pr,grant,task,sprint,build,localHead,readiness}){
  const errors=[],deny=(yes,why)=>{if(!yes)errors.push(why);};
  deny(isReadyTaskPr(pr),"PR must be Ready, same repo and based on canonical main");
  deny(isTrustedExactHead(pr,localHead),"trusted checkout HEAD differs from live PR HEAD");
  deny(isExactGitHubGrant(grant,pr),"live GitHub Environment grant not bound to exact BASE/HEAD");
  deny(canonicalDelegationState({task,sprint,build,grant}),
    "canonical Task/Sprint/Build state forbids delegation");
  deny(pr?.mergeable===true,"GitHub does not confirm PR is mergeable");
  deny(readiness?.ok===true&&readiness?.head===localHead,
    "exact-HEAD real checks and independent BCE/Local proof missing");
  return {ok:errors.length===0,decision:errors.length?"HARD_STOP":"ELIGIBLE_FOR_PROTECTED_MERGE_REQUEST",
    errors,pr_number:pr?.number,head_sha:localHead};
}
async function delegateGitHubJson(api,token,{method="GET",body}={}){
  const res=await fetch("https://api.github.com"+api,{method,headers:{
    accept:"application/vnd.github+json",authorization:"Bearer "+token,
    "X-GitHub-Api-Version":"2026-03-10",
    "User-Agent":"appf2-live-delegated-task-executor",
    ...(body?{"content-type":"application/json"}:{})
  },...(body?{body:JSON.stringify(body)}:{})});
  if(!res.ok)throw Error("GitHub API HARD_STOP: "+method+" "+res.status+" "+api);
  return res.json();
}
const delegatedInputOK=({prNumber,token,action})=>[
  Boolean(token),Number.isSafeInteger(prNumber),prNumber>0,
  ["CHECK","MERGE"].includes(action)].every(Boolean);
const completeApiInventory=({comments,changed,checks})=>[
  Array.isArray(comments),Array.isArray(changed),Array.isArray(checks?.check_runs),
  checks?.total_count===checks?.check_runs?.length,
  uniqueIdentity(comments,"id"),uniqueIdentity(changed,"filename"),
  uniqueIdentity(checks?.check_runs||[],"id")
].every(Boolean);
const candidateFileBytes=p=>{try{return fs.readFileSync(p);}catch{return null;}};
const unchangedTaskPr=(a,b)=>[
  a?.number===b?.number,a?.head?.sha===b?.head?.sha,
  a?.base?.sha===b?.base?.sha,b?.draft===false,b?.state==="open",
  b?.mergeable===true].every(Boolean);
const validMergedReceipt=merged=>[
  merged?.merged===true,/^[0-9a-f]{40}$/.test(merged?.sha||"")].every(Boolean);
export async function delegatedTaskExecutor({prNumber,token,action="CHECK"}={}){
  if(!delegatedInputOK({prNumber,token,action}))
    throw Error("invalid delegated Task execution input");
  const root="/repos/"+DELEGATED_REPO;
  // All authority/evidence inputs are fetched from the live GitHub API.
  const pr=await delegateGitHubJson(root+"/pulls/"+prNumber,token);
  const head=execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
  if(pr.head?.sha!==head)throw Error("HARD_STOP: local checkout != live PR HEAD");
  const {verifyLiveGrant}=await import("./trusted-human-task-grant.mjs");
  const grant=await verifyLiveGrant({pr,token});
  const {candidateDigestOf,inspectTaskPrReadiness}=await import("./final-ready-preflight.mjs");
  const {comments,changed,checks}=await readLiveDelegationEvidence({prNumber,head,token});
  const digest=candidateDigestOf(changed,candidateFileBytes);
  const event={pull_request:{number:pr.number,head:{sha:head},base:{sha:pr.base.sha},draft:pr.draft}};
  const readiness=inspectTaskPrReadiness({event,live:pr,comments,checks,
    changedFiles:changed,candidateDigest:digest,repo:DELEGATED_REPO,verifiedGrant:grant});
  const sprint=readJson("delivery/CURRENT-SPRINT.json"),build=readJson("build-spec/CURRENT.json");
  const taskId=pr.body?.match(/^Task:\s*(T\d{3})\b/m)?.[1];
  const task=(readJson("delivery/sprints/"+sprint.active_sprint+"/tasks.json").tasks||[])
    .find(t=>t.task_id===taskId);
  const result=delegatedPremergePolicy({pr,grant,task,sprint,build,localHead:head,readiness});
  if(!result.ok||!readiness.ok)
    return {...result,decision:"HARD_STOP",errors:[...result.errors,...readiness.errors]};
  const liveAgain=await delegateGitHubJson(root+"/pulls/"+prNumber,token);
  if(!unchangedTaskPr(pr,liveAgain))
    throw Error("HARD_STOP: PR head/base/draft/mergeability changed during evidence read");
  if(action==="CHECK")return {...result,action,merged:false};
  // No admin bypass. GitHub enforces normal protected-branch checks at PUT.
  // No Task Closure, Evidence mutation, next Task/Sprint or deployment.
  const merged=await delegateGitHubJson(root+"/pulls/"+prNumber+"/merge",token,{
    method:"PUT",body:{sha:head,merge_method:"squash"}});
  if(!validMergedReceipt(merged))
    throw Error("HARD_STOP: GitHub did not prove a merged commit");
  return {ok:true,decision:"GITHUB_MERGED_NEEDS_EVIDENCE_AND_CLOSURE",
    action,pr_number:prNumber,source_head:head,merge_commit_sha:merged.sha,merged:true};
}

const readJson=rel=>JSON.parse(fs.readFileSync(path.join(process.cwd(),rel),"utf8"));
const changedPaths=()=>{
  const base=process.env.BASE_SHA,head=process.env.HEAD_SHA||"HEAD";
  if(!base || /^0+$/.test(base)) return [];
  return execFileSync("git",["diff","--name-only",base,head],{encoding:"utf8"}).trim().split("\n").filter(Boolean);
};
const exceptionLaneOf=(changed,reform)=>{
  const dir=reform?.exception?.docket_dir;
  for(const p of changed.filter(x=>dir && x.startsWith(dir) && x.endsWith(".json"))){
    try{
      const s=JSON.parse(fs.readFileSync(p,"utf8")).scope_exception;
      if(s?.schema===HUMAN_EXCEPTION_SCHEMA) return reform.exception.lanes[s.lane]||null;
    }catch{/* deleted or invalid docket: the scope gate rejects it */}
  }
  return null;
};

function cli(argv){
  const [cmd,...rest]=argv;
  const arg=name=>{const i=rest.indexOf("--"+name);return i>=0?rest[i+1]:null;};
  if(cmd==="delegated-premerge"){
    console.error("Use explicit delegated-check / delegated-merge with live GitHub API; no caller Boolean permitted");
    return 2;
  }
  if(cmd==="classify"){
    const cs=readJson("delivery/CURRENT-SPRINT.json"),reform=readJson(GOVERNANCE_REFORM_POLICY_PATH);
    const td=cs.active_sprint?readJson("delivery/sprints/"+cs.active_sprint+"/tasks.json"):null;
    const task=(td?.tasks||[]).find(t=>t.task_id===cs.active_task)||null;
    const changed=changedPaths();
    const out=classifyChange({changed,task,repoPolicy:readJson("harness/policy/repo-policy.json"),exceptionLane:exceptionLaneOf(changed,reform)});
    console.log("CHANGE ROUTING: "+out.change_class+" -> authority "+out.authority+" (active Task "+(cs.active_task||"none")+", "+changed.length+" paths; informational, gates decide legality)");
    return 0;
  }
  if(cmd==="final-gate"){
    const reform=readJson(GOVERNANCE_REFORM_POLICY_PATH);
    const out=finalGateVerdict({head:arg("head"),required:reform.full_gate_contexts,checks:JSON.parse(fs.readFileSync(arg("checks"),"utf8"))});
    console.log(JSON.stringify(out,null,2));
    return out.verdict==="PASS"?0:1;
  }
  console.error("usage: task-pr-lifecycle.mjs classify | final-gate --head <sha> --checks <file.json>");
  return 2;
}
if(import.meta.url===pathToFileURL(process.argv[1]||"").href){
  const command=process.argv[2];
  if(command==="delegated-check"||command==="delegated-merge"){
    const prNumber=Number(process.argv[3]);
    delegatedTaskExecutor({prNumber,token:process.env.GH_TOKEN||process.env.GITHUB_TOKEN,
      action:command==="delegated-check"?"CHECK":"MERGE"})
      .then(result=>{console.log("DELEGATED TASK "+JSON.stringify(result));
        if(!result.ok)process.exitCode=1;})
      .catch(e=>{console.error("DELEGATED TASK HARD_STOP "+e.message);process.exitCode=1;});
  }else process.exit(cli(process.argv.slice(2)));
}
