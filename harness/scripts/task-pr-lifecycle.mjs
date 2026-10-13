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

export function advance(record,{to,actor,head,evidence}){
  const errors=[];
  if(!(NEXT[record.state]||[]).includes(to)) errors.push("illegal transition "+record.state+" -> "+to);
  if(!(ACTOR_FOR[to]||[]).includes(actor)) errors.push(to+" cannot be set by "+actor);
  if(head!==record.head) errors.push("HEAD changed since the last attestation; call onNewHead first");
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
if(import.meta.url===pathToFileURL(process.argv[1]||"").href) process.exit(cli(process.argv.slice(2)));
