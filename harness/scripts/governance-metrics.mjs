// GOV-REFORM-20261013: reform effectiveness metrics (Task-PR ratio, Human
// approvals and re-approvals, full CI runs per head, rework commits, open PRs).
// Inputs are canonical git history plus optional `gh` JSON exports; read-only.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const TASK_RE=/\b(T\d{3})\b/g;
const PR_RE=/\(#(\d+)\)\s*$|Merge pull request #(\d+)/;
const REWORK_RE=/\b(fix|repair|rework|correct|retry|revert)\b|修正|修復|重做|返工|更正/i;
const FULL_WORKFLOWS=new Set(["CI Gate","CodeQL"]);

const taskKeysOf=subject=>[...new Set([...subject.matchAll(TASK_RE)].map(m=>m[1]))];

const prsPerTask=commits=>{
  const byTask=new Map();
  for(const c of commits){
    const m=PR_RE.exec(c.subject);
    if(!m) continue;
    for(const t of taskKeysOf(c.subject)){
      if(!byTask.has(t)) byTask.set(t,new Set());
      byTask.get(t).add(Number(m[1]||m[2]));
    }
  }
  const counts=[...byTask.entries()].map(([task,prs])=>({task,prs:prs.size}));
  const total=counts.reduce((a,x)=>a+x.prs,0);
  return {tasks:counts.length,task_prs:total,
    prs_per_task_avg:counts.length?Number((total/counts.length).toFixed(2)):0,
    prs_per_task_max:counts.reduce((a,x)=>Math.max(a,x.prs),0),by_task:counts.sort((a,b)=>b.prs-a.prs)};
};

const approvals=dockets=>{
  let exact=0,reapprovals=0;
  for(const d of dockets){
    if(d?.human_approval?.decision==="APPROVE_EXACT_CANDIDATE") exact++;
    reapprovals+=Array.isArray(d?.previous_approval_history)?d.previous_approval_history.length:0;
  }
  return {dockets:dockets.length,human_exact_approvals:exact,redundant_reapprovals:reapprovals};
};

const JOB_CONCLUSIONS=new Set(["success","failure","cancelled","timed_out","skipped","neutral","action_required"]);

const incomplete=(reason)=>({status:"INCOMPLETE",reason,full_ci_runs:null,
  repeated_full_runs_same_head:null});

const emptyCounts=()=>({ready_ci_executed:0,ready_ci_success:0,ready_codeql_executed:0,
  ready_codeql_success:0,draft_fast_loop_executed:0,
  draft_required_skipped:0,push_full_ci_executed:0,
  push_full_codeql_executed:0});

// Transitional API data must never be represented as real full-CI statistics.
// Retain one explicitly UNVERIFIED regression counter for the old synthetic
// test harness; it is not actionable or publishable as actual CI savings.
const legacyFullCiRuns=input=>{
  const old=input.filter(r=>FULL_WORKFLOWS.has(r.name)&&r.event==="pull_request");
  const perHead=new Map();
  for(const r of old)perHead.set(r.name+"@"+r.headSha,(perHead.get(r.name+"@"+r.headSha)||0)+1);
  return {status:"INCOMPLETE_LEGACY_NO_JOB_EVIDENCE",full_ci_runs:null,
    repeated_full_runs_same_head:[...perHead.values()].reduce((a,n)=>a+n-1,0),
    warning:"LEGACY_SYNTHETIC_REGRESSION_ONLY; NOT A VALID REAL CI COUNT"};
};

const runShapeOk=(r,seen)=>Number.isSafeInteger(r.id)&&r.id>=1&&!seen.has(r.id)&&
  typeof r.headSha==="string"&&r.headSha.length===40&&
  Number.isSafeInteger(r.runAttempt)&&r.runAttempt>=1&&
  Array.isArray(r.jobs)&&r.jobs.length>0;

const jobRecordOk=j=>Number.isSafeInteger(j.id)&&j.id>=1&&j.status==="completed"&&
  JOB_CONCLUSIONS.has(j.conclusion);

// GitHub leaves the workflow-expression text as the skipped job name in
// Draft PRs, instead of resolving that conditional job's name to "ci".
// Accept that alias ONLY alongside an actual successful fast-loop.
const draftSkippedCiAlias=sameAttempt=>{
  const draftFast=sameAttempt.filter(j=>j.name==="fast-loop"&&j.conclusion==="success");
  const ciSkip=sameAttempt.filter(j=>j.name.includes("ci-recheck-only-skipped")&&
    j.conclusion==="skipped");
  return draftFast.length===1&&ciSkip.length===1?ciSkip:null;
};

const targetJobsForAttempt=(r,sameAttempt,wanted)=>{
  const named=sameAttempt.filter(j=>j.name===wanted);
  if(named.length) return named;
  if(r.name==="CI Gate"&&r.event==="pull_request")
    return draftSkippedCiAlias(sameAttempt)||named;
  return named;
};

const attemptJobsOk=(jobs,sameAttempt)=>jobs.length===1&&sameAttempt.every(jobRecordOk);

const tallyReadyCi=(job,r,state)=>{
  state.counts.ready_ci_executed++;
  if(job.conclusion==="success") state.counts.ready_ci_success++;
  state.perHead.set(r.headSha,(state.perHead.get(r.headSha)||0)+1);
  if(r.headBranch) state.branches.add(r.headBranch);
};

const tallyPrCiGate=(job,sameAttempt,r,state)=>{
  const fast=sameAttempt.filter(j=>j.name==="fast-loop");
  if(fast.length>1) return "Ambiguous fast-loop check";
  if(fast.length===1&&fast[0].conclusion!=="skipped") state.counts.draft_fast_loop_executed++;
  if(job.conclusion!=="skipped") tallyReadyCi(job,r,state);
  else state.counts.draft_required_skipped++;
  return null;
};

const tallyPrCodeql=(job,counts)=>{
  if(job.conclusion==="skipped"){ counts.draft_required_skipped++; return; }
  counts.ready_codeql_executed++;
  if(job.conclusion==="success") counts.ready_codeql_success++;
};

const tallyPush=(r,job,counts)=>{
  if(job.conclusion==="skipped") return;
  if(r.name==="CI Gate") counts.push_full_ci_executed++;
  else counts.push_full_codeql_executed++;
};

const tallyAttempt=(r,attempt,state)=>{
  const sameAttempt=r.jobs.filter(j=>j.attempt===attempt);
  const wanted=r.name==="CI Gate"?"ci":"Analyze JavaScript / TypeScript";
  const jobs=targetJobsForAttempt(r,sameAttempt,wanted);
  if(!attemptJobsOk(jobs,sameAttempt)) return "Missing or incomplete exact-attempt jobs";
  const job=jobs[0];
  if(r.event==="pull_request"){
    if(r.name==="CI Gate") return tallyPrCiGate(job,sameAttempt,r,state);
    tallyPrCodeql(job,state.counts);
    return null;
  }
  tallyPush(r,job,state.counts);
  return null;
};

const processRun=(r,state)=>{
  if(!FULL_WORKFLOWS.has(r.name)||!["pull_request","push"].includes(r.event)) return null;
  if(!runShapeOk(r,state.seen)) return "Malformed, duplicate or missing run/job evidence";
  state.seen.add(r.id);
  for(let attempt=1;attempt<=r.runAttempt;attempt++){
    const err=tallyAttempt(r,attempt,state);
    if(err) return err;
  }
  return null;
};

const measuredResult=(input,state)=>{
  const full=state.counts.ready_ci_executed;
  const sample=input.sample&&typeof input.sample==="object"?{
    strategy:input.sample.strategy||null,
    listed:Number.isSafeInteger(input.sample.listed)?input.sample.listed:null,
    enriched:Number.isSafeInteger(input.sample.enriched)?input.sample.enriched:null,
    truncated:Boolean(input.sample.truncated)
  }:null;
  return {status:"MEASURED_NO_PRE_POST_BASELINE",window_start:input.window_start,
    full_ci_runs:full,distinct_heads:state.perHead.size,
    repeated_full_runs_same_head:[...state.perHead.values()].reduce((a,n)=>a+n-1,0),
    full_runs_per_branch_avg:state.branches.size?Number((full/state.branches.size).toFixed(2)):0,
    ...state.counts,baseline_status:"INSUFFICIENT_BASELINE",sample,
    semantics:"One executed ci job per PR run ATTEMPT; Draft/CodeQL/Push categorized separately"+
      (sample?.truncated?"; SAMPLE newest enriched runs only — not a full-window census":"")};
};

// A source can contain authentic GitHub jobs yet cover only the newest N runs.
// Do not publish those N observations as a seven-day total, even when the
// producer mistakenly claims complete:true (legacy 2026-10-17 exporter bug).
const sampleMeta=input=>input?.sample&&typeof input.sample==="object"?{
  strategy:input.sample.strategy||null,
  listed:input.sample.listed,
  enriched:input.sample.enriched,
  truncated:input.sample.truncated===true
}:null;
const isPartialSample=sample=>sample?.truncated===true ||
  (Number.isSafeInteger(sample?.listed)&&Number.isSafeInteger(sample?.enriched)&&
   sample.enriched<sample.listed);
const sampleShapeOK=(input,sample)=>sample&&
  sample.strategy==="newest"&&Number.isSafeInteger(sample.listed)&&sample.listed>0&&
  Number.isSafeInteger(sample.enriched)&&sample.enriched>=1&&
  sample.enriched===input.runs.length&&sample.enriched<=sample.listed;
const sampledResult=(input,state,sample)=>({
  status:"INCOMPLETE_SAMPLED",complete:false,
  reason:"Only newest enriched runs were observed; not a seven-day total or savings baseline",
  window_start:input.window_start,
  full_ci_runs:null,repeated_full_runs_same_head:null,
  ready_ci_executed:null,ready_ci_success:null,
  ready_codeql_executed:null,ready_codeql_success:null,
  draft_fast_loop_executed:null,draft_required_skipped:null,
  push_full_ci_executed:null,push_full_codeql_executed:null,
  baseline_status:"INSUFFICIENT_BASELINE",
  source_complete_claim_invalid:input.complete===true,
  sample:{...sample,truncated:true},
  sample_counts:{...state.counts,distinct_heads:state.perHead.size,
    repeated_ready_ci_same_head:[...state.perHead.values()].reduce((a,n)=>a+n-1,0)},
  semantics:"Newest sampled GitHub Actions run ATTEMPT/jobs ONLY. Sample counts are NOT whole-window totals. No savings percentage."
});
const fullCiRuns=input=>{
  if(Array.isArray(input)) return legacyFullCiRuns(input);
  if(!input||!Array.isArray(input.runs)||
     typeof input.window_start!=="string"||!input.window_start)
    return incomplete("GitHub run/job history missing or pagination incomplete");
  if(!input.runs.length) return incomplete("No enriched run/job rows in observation window");
  const sample=sampleMeta(input),partial=isPartialSample(sample);
  if(partial&&!sampleShapeOK(input,sample))
    return incomplete("Sample count/coverage metadata disagrees with enriched GitHub rows");
  if(!partial&&input.complete!==true)
    return incomplete("GitHub run/job history missing or pagination incomplete");
  const state={seen:new Set(),perHead:new Map(),branches:new Set(),counts:emptyCounts()};
  for(const r of input.runs){
    const err=processRun(r,state);
    if(err)return incomplete(err);
  }
  return partial?sampledResult(input,state,sample):measuredResult(input,state);
};

export { fullCiRuns };

/** Pure metric computation; every source is injected. */
export function computeGovernanceMetrics({commits,runs,dockets,openPrs}){
  const rework=commits.filter(c=>REWORK_RE.test(c.subject) && taskKeysOf(c.subject).length);
  return {
    task_pr:prsPerTask(commits),
    human_approval:approvals(dockets),
    ci:runs?fullCiRuns(runs):{status:"NOT_MEASURED",reason:"no gh run export supplied"},
    rework:{task_rework_commits:rework.length,ratio_of_task_commits:Number((rework.length/Math.max(1,commits.filter(c=>taskKeysOf(c.subject).length).length)).toFixed(2))},
    open_prs:openPrs?{open:openPrs.length,draft:openPrs.filter(p=>p.isDraft).length}:{status:"NOT_MEASURED"}
  };
}

function cli(argv){
  const arg=name=>{const i=argv.indexOf("--"+name);return i>=0?argv[i+1]:null;};
  const since=arg("since")||"2026-09-01";
  const log=execFileSync("git",["log","--first-parent","--since="+since,"--format=%H%x1f%s%x1f%cI",arg("ref")||"origin/main"],{encoding:"utf8"});
  const commits=log.trim().split("\n").filter(Boolean).map(l=>{const [sha,subject,date]=l.split("\x1f");return {sha,subject,date};});
  const dir="delivery/constitutional-cases";
  const dockets=fs.existsSync(dir)?fs.readdirSync(dir).filter(f=>f.endsWith(".json")).map(f=>JSON.parse(fs.readFileSync(path.join(dir,f),"utf8"))):[];
  const optional=name=>arg(name)?JSON.parse(fs.readFileSync(arg(name),"utf8")):null;
  const runs=optional("runs"),runLimit=Number(arg("run-limit")||1000);
  const limitations=["Task keys come from first-parent commit subjects; the same Txxx in different Sprints is aggregated."];
  if(runs && Array.isArray(runs.runs) && runs.runs.length>=runLimit) limitations.push("Run export reached --run-limit "+runLimit+"; CI is INCOMPLETE unless all source jobs were imported.");
  const metrics={since,generated_at:new Date().toISOString(),limitations,...computeGovernanceMetrics({commits,runs,dockets,openPrs:optional("open-prs")})};
  const out=JSON.stringify(metrics,null,2);
  if(arg("out")) fs.writeFileSync(arg("out"),out+"\n");
  console.log(out);
  return 0;
}
if(import.meta.url===pathToFileURL(process.argv[1]||"").href) process.exit(cli(process.argv.slice(2)));
