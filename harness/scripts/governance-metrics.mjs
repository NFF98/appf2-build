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

const fullCiRuns=runs=>{
  const full=runs.filter(r=>FULL_WORKFLOWS.has(r.name) && r.event==="pull_request");
  const perHead=new Map();
  for(const r of full) perHead.set(r.name+"@"+r.headSha,(perHead.get(r.name+"@"+r.headSha)||0)+1);
  const branches=new Set(full.map(r=>r.headBranch).filter(Boolean));
  return {full_ci_runs:full.length,distinct_heads:perHead.size,
    repeated_full_runs_same_head:[...perHead.values()].reduce((a,n)=>a+n-1,0),
    full_runs_per_branch_avg:branches.size?Number((full.length/branches.size).toFixed(2)):0};
};

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
  if(runs && runs.length>=runLimit) limitations.push("Run export reached --run-limit "+runLimit+"; CI counts are a lower bound.");
  const metrics={since,generated_at:new Date().toISOString(),limitations,...computeGovernanceMetrics({commits,runs,dockets,openPrs:optional("open-prs")})};
  const out=JSON.stringify(metrics,null,2);
  if(arg("out")) fs.writeFileSync(arg("out"),out+"\n");
  console.log(out);
  return 0;
}
if(import.meta.url===pathToFileURL(process.argv[1]||"").href) process.exit(cli(process.argv.slice(2)));
