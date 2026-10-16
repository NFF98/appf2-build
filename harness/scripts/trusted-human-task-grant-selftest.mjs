// Tests data-path integrity only. Not a real GitHub approval nor a merged PR.
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {delegatedTaskExecutor,githubPageDecision,
  readLiveDelegationEvidence,freshMergeReceipt,
  mainControlStateMatch,verifyLiveMainCanonicalState} from "./task-pr-lifecycle.mjs";
import {verifyLiveGrant} from "./trusted-human-task-grant.mjs";
import {reconcileTaskEvidencePr,liveTaskClosureCheck,
  writeExistingProtectedClosureCandidate} from "./evidence-ledger-report.mjs";
import {pathToFileURL} from "node:url";
import {inspectGitHubHumanGrant,taskScopeDigest,githubCompareProvesAncestor,
  inspectMergedMainAncestry,inspectGrantMainAdvance,ENVIRONMENT,WORKFLOW}
  from "./trusted-human-task-grant.mjs";
import {inspectIssuance} from "./task-human-grant-issuance.mjs";
import {inspectLiveGitHubRequiredChecks} from "./final-ready-preflight.mjs";
const sha="a".repeat(40),base="b".repeat(40),NOW=1792000000;
const fresh=()=>{
  const task={task_id:"T009",status:"IN_PROGRESS",build_spec_id:"BS-P1-025",
    allowed_write_paths:["src/","tests/"],acceptance_links:[{acceptance_id:"A1",test_id:"T1"}]};
  const grant={schema:"APPF2-TRUSTED-TASK-GRANT-1",task_id:"T009",
    sprint_id:"SP-P1-003",build_spec_id:"BS-P1-025",
    base_sha:sha,scope_sha256:taskScopeDigest(task),
    approved_at_unix:NOW-3600,expires_at_unix:NOW-3600+30*86400};
  const sprint={active_sprint:"SP-P1-003",active_task:"T009",
    active_build_spec:"BS-P1-025",status:"ACTIVE"};
  const build={active_baseline:"BS-P1-025",implementation_enabled:true};
  const run={event:"workflow_dispatch",conclusion:"success",head_sha:sha,
    head_branch:"main",created_at:new Date((NOW-3600)*1000).toISOString(),
    display_title:"APPF2-L1|T009|SP-P1-003|"+grant.scope_sha256,
    path:"NFF98/appf2-build/"+WORKFLOW+"@refs/heads/main",
    repository:{full_name:"NFF98/appf2-build"}};
  const review={state:"approved",user:{login:"NFF98"},
    environments:[{name:ENVIRONMENT}]};
  const approvals=[review];
  const environment={name:ENVIRONMENT,protection_rules:[{type:"required_reviewers",
    reviewers:[{type:"User",reviewer:{login:"NFF98"}}]}]};
  const pr={state:"open",base:{ref:"main"},
    head:{sha:"c".repeat(40)},body:"Task: T009\nTask-Grant-Run: 123"};
  return {run,approvals,environment,grant,original:JSON.parse(JSON.stringify(grant)),
    task,sprint,build,pr,ancestor:true,baseAncestor:true,now:NOW};
};
function runCanonicalMainSnapshotCases(){
  const main="a".repeat(40),next="b".repeat(40);
  const sample=[{active_sprint:"SP-P1-003",active_task:"T009"},
    {implementation_enabled:true,active_baseline:"BS-P1-025"},
    {sprint_id:"SP-P1-003",tasks:[{task_id:"T009",status:"REVIEW"}]}];
  const run=(f=()=>{})=>{
    const data={mainSha:main,baseSha:main,
      localDocs:JSON.parse(JSON.stringify(sample)),
      remoteDocs:JSON.parse(JSON.stringify(sample))};
    f(data);return mainControlStateMatch(data);
  };
  assert.equal(run(),true);
  for(const mutate of [
    x=>{x.baseSha=next;},x=>{x.mainSha="invalid";},
    x=>{x.remoteDocs[0].active_task="T006";},
    x=>{x.remoteDocs[1].implementation_enabled=false;},
    x=>{x.remoteDocs[2].tasks[0].status="CLOSED";},
    x=>{x.remoteDocs[2].tasks.push({task_id:"T010"});},
    x=>{x.remoteDocs.pop();},x=>{x.localDocs.pop();},
    x=>{x.remoteDocs=null;}
  ])assert.equal(run(mutate),false,"Stale Main canonical state admitted");
  return 10;
}
function runPaginationSelfTests(){
  let count=0;
  const page=githubPageDecision;
  const pageRows=n=>Array.from({length:n},(_,i)=>({id:i+1}));
  assert.equal(page({rows:pageRows(40)}),"COMPLETE");count++;
  assert.equal(page({rows:pageRows(100)}),"NEXT_PAGE");count++;
  assert.equal(page({rows:pageRows(20),page:2,accumulated:100}),"COMPLETE");count++;
  assert.equal(page({rows:pageRows(20),page:2,accumulated:100,expected:121}),"HARD_STOP");count++;
  assert.equal(page({rows:pageRows(20),page:2,accumulated:100,expected:120}),"COMPLETE");count++;
  assert.equal(page({rows:pageRows(100),page:10,accumulated:900}),"HARD_STOP");count++;
  assert.equal(page({rows:pageRows(101)}),"HARD_STOP");count++;
  assert.equal(page({rows:"forged"}),"HARD_STOP");count++;
  assert.equal(page({rows:pageRows(1),expected:0}),"HARD_STOP");count++;
  assert.equal(page({rows:[],expected:0}),"COMPLETE");count++;
  assert.equal(page({rows:pageRows(100),expected:100}),"COMPLETE");count++;
  assert.equal(page({rows:pageRows(100),expected:101}),"NEXT_PAGE");count++;
  assert.equal(page({rows:pageRows(99),expected:100}),"HARD_STOP");count++;
  return count;
}
function runAncestrySelfTests(){
  let count=0;
  for(const [status,allowed] of [
    ["ahead",true],["identical",true],["diverged",false],
    ["behind",false],["not-found",false],[null,false]
  ]){
    assert.equal(githubCompareProvesAncestor({status}),allowed);
    count++;
  }
  assert.equal(githubCompareProvesAncestor(null),false);count++;
  // Authentic Main merge ancestry: GitHub compare receipt must bind *both*
  // SHA endpoints and the current local Main, not a caller-supplied Boolean.
  const merge="d".repeat(40),current="e".repeat(40);
  const positive={mergeSha:merge,mainSha:current,localHead:current,
    compare:{status:"ahead",base_commit:{sha:merge},
      merge_base_commit:{sha:merge}}};
  assert.equal(inspectMergedMainAncestry(positive),true);count++;
  const receipts=[
    {compare:{...positive.compare,status:"identical"},mainSha:merge,localHead:merge},
    {compare:{...positive.compare,status:"diverged"}},
    {compare:{...positive.compare,status:"behind"}},
    {compare:{...positive.compare,base_commit:{sha:current}}},
    {compare:{...positive.compare,merge_base_commit:{sha:current}}},
    {localHead:"f".repeat(40)},{mergeSha:"not-a-sha"},
    {mainSha:"not-a-sha"},{compare:null}
  ];
  for(const patch of receipts){
    const data={...positive,...patch};
    const expected=data.mainSha===merge&&data.localHead===merge&&
      data.compare?.status==="identical"&&
      data.compare?.base_commit?.sha===merge;
    assert.equal(inspectMergedMainAncestry(data),Boolean(expected),
      "Main ancestry must fail closed unless exact GitHub compare+checkout agrees");
    count++;
  }
  const granted="a".repeat(40),advanced="f".repeat(40);
  const prove={grantSha:granted,baseSha:advanced,
    compare:{status:"ahead",base_commit:{sha:granted},
      merge_base_commit:{sha:granted},commits:[{sha:advanced}]}};
  assert.equal(inspectGrantMainAdvance(prove),true);count++;
  assert.equal(inspectGrantMainAdvance({...prove,baseSha:granted,compare:null}),true);count++;
  for(const patch of [
    {compare:null},{compare:{...prove.compare,status:"diverged"}},
    {compare:{...prove.compare,status:"behind"}},
    {compare:{...prove.compare,base_commit:{sha:advanced}}},
    {compare:{...prove.compare,merge_base_commit:{sha:advanced}}},
    {compare:{...prove.compare,commits:[{sha:granted}]}},
    {grantSha:"invalid"},{baseSha:"invalid"}
  ]){assert.equal(inspectGrantMainAdvance({...prove,...patch}),false);count++;}
  return count;
}
export function runTrustedGrantSelfTests(){
  let total=0;
  const yes=x=>{const r=inspectGitHubHumanGrant(x);assert.equal(r.ok,true,r.errors.join("|"));total++;};
  const no=(mutate)=>{const x=fresh();mutate(x);
    const r=inspectGitHubHumanGrant(x);assert.equal(r.ok,false,"fake grant admitted");total++;};
  yes(fresh());
  no(x=>{x.environment.protection_rules=[];});
  no(x=>{x.environment.protection_rules[0].reviewers=[{type:"User",reviewer:{login:"GPT"}}];});
  no(x=>{x.approvals=[];});
  no(x=>{x.approvals[0].user.login="GPT";});
  no(x=>{x.approvals.push({state:"rejected",user:{login:"NFF98"},
    environments:[{name:ENVIRONMENT}]});});
  no(x=>{x.run.event="push";});
  no(x=>{x.run.head_branch="unsafe-feature";});
  no(x=>{x.run.created_at="not-a-time";});
  no(x=>{x.run.conclusion="failure";});
  no(x=>{x.run.path="NFF98/appf2-build/.github/workflows/fake.yml@main";});
  no(x=>{x.run.path=".github/workflows/task-human-grant.yml.bak@refs/heads/main";});
  no(x=>{x.run.path="wrong-owner/appf2-build/"+WORKFLOW+"@refs/heads/main";});
  const actualGitHubPath=fresh();
  actualGitHubPath.run.path=WORKFLOW+"@refs/heads/main";
  yes(actualGitHubPath);
  no(x=>{x.run.repository.full_name="other/fake";});
  no(x=>{x.grant.schema="LEGACY";});
  no(x=>{x.grant.scope_sha256="f".repeat(64);});
  no(x=>{x.grant.base_sha="not-a-SHA";});
  no(x=>{x.grant.expires_at_unix+=1;});
  no(x=>{x.run.display_title="APPF2-L1|T008|SP-P1-003|"+x.grant.scope_sha256;});
  no(x=>{x.task.allowed_write_paths=["src/","tests/","secrets/"];});
  no(x=>{x.task.status="BLOCKED";});
  no(x=>{x.sprint.active_task="T008";});
  no(x=>{x.build.implementation_enabled=false;});
  no(x=>{x.build.active_baseline="BS-P1-026";});
  no(x=>{x.pr.body="Task: T008\nTask-Grant-Run: 123";});
  no(x=>{x.pr.state="closed";});
  // Post-merge mode does NOT re-use open-PR assertions. A true GitHub Main
  // ancestry receipt is required; a caller Boolean never reaches live verification.
  const closed=fresh();
  closed.phase="POST_MERGE_CLOSURE";
  closed.pr.state="closed";closed.pr.merged=true;
  closed.pr.merged_at="2026-10-16T02:00:00Z";
  closed.pr.merge_commit_sha="d".repeat(40);
  closed.mergedOnMain=true;
  yes(closed);
  no(x=>{x.phase="POST_MERGE_CLOSURE";});
  no(x=>{x.pr.state="closed";x.pr.merged=true;
    x.pr.merged_at="2026-10-16T02:00:00Z";x.pr.merge_commit_sha="d".repeat(40);
    x.phase="POST_MERGE_CLOSURE";x.mergedOnMain=false;});
  no(x=>{x.pr.state="closed";x.pr.merged=false;
    x.pr.merged_at="2026-10-16T02:00:00Z";x.pr.merge_commit_sha="d".repeat(40);
    x.phase="POST_MERGE_CLOSURE";x.mergedOnMain=true;});
  no(x=>{x.pr.state="closed";x.pr.merged=true;
    x.pr.merged_at="2026-10-16T02:00:00Z";x.pr.merge_commit_sha="bad-sha";
    x.phase="POST_MERGE_CLOSURE";x.mergedOnMain=true;});
  no(x=>{x.pr.state="closed";x.pr.merged=true;
    x.pr.merged_at="2026-10-16T02:00:00Z";x.pr.merge_commit_sha="d".repeat(40);
    x.phase="WRONG_PHASE";x.mergedOnMain=true;});
  no(x=>{x.pr.base.ref="other";});
  no(x=>{x.ancestor=false;});
  no(x=>{x.baseAncestor=false;});
  total+=runAncestrySelfTests();
  const sameHead=fresh();sameHead.run.head_sha=sameHead.pr.head.sha;
  sameHead.grant.base_sha=sameHead.run.head_sha;yes(sameHead);
  no(x=>{x.now=x.grant.expires_at_unix+1;});
  no(x=>{x.grant.approved_at_unix="not-human";});
  const issuing=fresh(),input={task_id:issuing.grant.task_id,
    sprint_id:issuing.grant.sprint_id,scope_sha256:issuing.grant.scope_sha256,
    head_sha:issuing.run.head_sha};
  const v=inspectIssuance({...issuing,input,now:NOW});
  assert.equal(v.ok,true,v.errors.join("|"));total++;
  const before=fresh();before.task.status="PLANNED";
  before.sprint.active_sprint=null;before.sprint.active_task=null;before.sprint.status="HOLD";
  before.build.implementation_enabled=false;
  assert.equal(inspectIssuance({...before,input,now:NOW}).ok,true,
    "Human grant must happen BEFORE activation, not require duplicate approval");total++;
  before.sprint.active_task="T008";
  assert.equal(inspectIssuance({...before,input,now:NOW}).ok,false);total++;
  total+=runPaginationSelfTests();
  total+=runCanonicalMainSnapshotCases();
  const rawChecks=["ci","attack","governance","Analyze JavaScript / TypeScript"]
    .map((name,i)=>({name,id:i+100,head_sha:sha,status:"completed",
      conclusion:"success",app:{slug:"github-actions"}}));
  const full=rows=>inspectLiveGitHubRequiredChecks({head:sha,checks:{check_runs:rows}});
  assert.equal(full(rawChecks).length,0);total++;
  const reject=rows=>{assert.notEqual(full(rows).length,0);total++;};
  reject(rawChecks.slice(0,3));
  reject(rawChecks.map((x,i)=>i?x:{...x,head_sha:base}));
  reject(rawChecks.map((x,i)=>i?x:{...x,conclusion:"skipped"}));
  reject(rawChecks.map((x,i)=>i?x:{...x,status:"in_progress"}));
  reject(rawChecks.map((x,i)=>i?x:{...x,app:{slug:"unknown-bot"}}));
  reject([...rawChecks,{...rawChecks[0],id:999,conclusion:"failure"}]);
  return total+runFreshMergeReceiptTests();
}
function runFreshMergeReceiptTests(){
  const fixture=()=>({
    firstPr:{number:99,state:"open",draft:false,mergeable:true,
      base:{sha:"a".repeat(40)},head:{sha:"b".repeat(40)}},
    currentPr:{number:99,state:"open",draft:false,mergeable:true,
      base:{sha:"a".repeat(40)},head:{sha:"b".repeat(40)}},
    before:{comments:[{id:1,body:"GPT BCE PASS"}],
      changed:[{filename:"src/app.ts"}],
      checks:{total_count:1,check_runs:[{id:23,name:"ci",conclusion:"success"}]}},
    after:{comments:[{id:1,body:"GPT BCE PASS"}],
      changed:[{filename:"src/app.ts"}],
      checks:{total_count:1,check_runs:[{id:23,name:"ci",conclusion:"success"}]}}
  });
  const run=f=>{const data=fixture();f(data);return freshMergeReceipt(data);};
  const deny=f=>assert.equal(run(f),false,"stale merge proof admitted");
  assert.equal(run(()=>{}),true);
  deny(x=>{x.currentPr.head.sha="c".repeat(40);});
  deny(x=>{x.currentPr.base.sha="c".repeat(40);});
  deny(x=>{x.currentPr.mergeable=null;});
  deny(x=>{x.currentPr.draft=true;});
  deny(x=>{x.currentPr.state="closed";});
  deny(x=>{x.after.comments[0].body="forged BCE PASS";});
  deny(x=>{x.after.comments.push({id:2,body:"later challenge"});});
  deny(x=>{x.after.changed[0].filename="src/other.ts";});
  deny(x=>{x.after.checks.check_runs[0].conclusion="failure";});
  deny(x=>{x.after.checks.check_runs[0].id=24;});
  deny(x=>{x.after.checks.total_count=0;});
  deny(x=>{x.after.checks.check_runs.push({id:23,name:"ci"});});
  return 13;
}
const REPO="NFF98/appf2-build";
const PR=Number(process.env.APPF2_NEGATIVE_PR_NUMBER);
const TOKEN=process.env.GH_TOKEN;
const hex40=s=>/^[a-f0-9]{40}$/.test(s||"");
const localHead=()=>execFileSync("git",["rev-parse","HEAD"],{encoding:"utf8"}).trim();
const gh=async endpoint=>{
  const response=await fetch("https://api.github.com/repos/"+REPO+endpoint,{headers:{
    accept:"application/vnd.github+json",
    authorization:"Bearer "+TOKEN,
    "X-GitHub-Api-Version":"2026-03-10",
    "User-Agent":"appf2-real-negative-github-e2e"
  }});
  if(!response.ok)throw Error("LIVE GITHUB FETCH FAILURE "+response.status+" "+endpoint);
  return response.json();
};
const snapshot=async()=>{
  const [pr,main,branch]=await Promise.all([
    gh("/pulls/"+PR),gh("/branches/main"),
    gh("/branches/governance/task-one-approval-20261016")
  ]);
  return {pr,main:main?.commit?.sha,branch:branch?.commit?.sha};
};
const safeNegativePrecondition=(s,head)=>[
  s.pr?.number===PR,s.pr?.state==="open",s.pr?.draft===true,
  s.pr?.head?.sha===head,s.branch===head,
  s.pr?.base?.ref==="main",s.pr?.base?.sha===s.main,
  s.pr?.head?.repo?.full_name===REPO,
  s.main!==head,hex40(s.main),hex40(head),
  !/^Task-Grant-Run:/m.test(s.pr?.body||"")
].every(Boolean);
const mustDeny=async (label,invoke,message)=>{
  let received="";
  try{await invoke();}catch(e){received=String(e?.message||e);}
  if(!message.test(received))
    throw Error("LIVE NEGATIVE FAIL ["+label+"]: unexpected admission/error: "+
      (received||"ADMITTED"));
  console.log("LIVE NEGATIVE EXPECTED HARD_STOP: "+label);
};
export async function verifyLiveUnauthorizedNegative(){
  if(!TOKEN||!Number.isSafeInteger(PR)||PR!==401)
    throw Error("LIVE NEGATIVE STOP: require exact Draft PR 401 and token");
  const head=localHead(),before=await snapshot();
  if(!safeNegativePrecondition(before,head))
    throw Error("LIVE NEGATIVE STOP: GitHub main/draft HEAD or scope drift");
  await mustDeny("original Human grant absent",
    ()=>verifyLiveGrant({pr:before.pr,token:TOKEN}),
    /Task-Grant-Run 缺失/);
  await mustDeny("delegated CHECK must reject missing grant",
    ()=>delegatedTaskExecutor({prNumber:PR,token:TOKEN,action:"CHECK"}),
    /Task-Grant-Run 缺失/);
  await mustDeny("Evidence apply must reject wrong Task lease",
    ()=>reconcileTaskEvidencePr({prNumber:PR,token:TOKEN,apply:true}),
    /active Task lease missing or wrong scope/);
  await mustDeny("Closure check must reject missing grant",
    ()=>liveTaskClosureCheck({prNumber:PR,token:TOKEN}),
    /Task-Grant-Run 缺失/);
  await mustDeny("Closure apply must reject non-Main checkout",
    ()=>writeExistingProtectedClosureCandidate({
      sourcePrNumber:PR,controlPrNumber:PR,token:TOKEN,apply:true}),
    /executor checkout must match live Main/);
  // Read actual PR comments, changed files, and check runs through the same
  // complete, capped, GitHub-paginated API path used by the trusted executor.
  const canonical=await verifyLiveMainCanonicalState({pr:before.pr,token:TOKEN});
  console.log("LIVE MAIN CANONICAL SNAPSHOT VERIFIED: "+
    JSON.stringify(canonical));
  const inventory=await readLiveDelegationEvidence({prNumber:PR,head,token:TOKEN});
  if(!inventory.changed.length||inventory.checks.total_count!==
    inventory.checks.check_runs.length)
    throw Error("LIVE PAGINATION FAIL: incomplete authoritative file/check inventory");
  console.log("LIVE GITHUB PAGINATION VERIFIED: "+
    JSON.stringify({comments:inventory.comments.length,changed:inventory.changed.length,
      checks:inventory.checks.total_count}));
  const after=await snapshot();
  if(after.main!==before.main||after.branch!==before.branch||
    after.pr?.head?.sha!==before.pr.head.sha||after.pr?.state!==before.pr.state)
    throw Error("LIVE NEGATIVE FAIL: protected main/PR drift after test");
  console.log("LIVE GITHUB NEGATIVE INTEGRATION: 5/5 REAL API HARD_STOP PASS; "+
    "Main/PR unchanged. Human positive approval/Merge/Closure NOT_RUN.");
  await verifyLiveMainFastForward(after.main);
  const bootstrap=await inspectLiveBootstrapState({token:TOKEN,mainSha:after.main});
  console.log("LIVE 16P BOOTSTRAP READINESS (informational, NOT PASS): "+
    JSON.stringify(bootstrap));
}

const verifyLiveMainFastForward=async mainSha=>{
  const main=await gh("/commits/"+mainSha),parent=main?.parents?.[0]?.sha;
  if(!hex40(mainSha)||!hex40(parent))
    throw Error("LIVE MAIN ANCESTRY FAIL: canonical GitHub parent SHA unavailable");
  const [forward,reverse]=await Promise.all([
    gh("/compare/"+parent+"..."+mainSha),
    gh("/compare/"+mainSha+"..."+parent)]);
  if(!inspectGrantMainAdvance({grantSha:parent,baseSha:mainSha,compare:forward}))
    throw Error("LIVE MAIN ANCESTRY FAIL: official fast-forward proof missing");
  if(inspectGrantMainAdvance({grantSha:mainSha,baseSha:parent,compare:reverse}))
    throw Error("LIVE MAIN ANCESTRY FAIL: reverse direction incorrectly admitted");
  console.log("LIVE GITHUB MAIN FAST-FORWARD API: 1 ADMIT + 1 REJECT PASS; "+
    "History lineage proof only, NOT a Human Task grant or Merge");
};
const remoteRead=async (url,token)=>{
  try{
    const r=await fetch(url,{headers:{
      accept:"application/vnd.github+json",authorization:"Bearer "+token,
      "X-GitHub-Api-Version":"2026-03-10",
      "User-Agent":"appf2-16p-bootstrap-reality-check"
    }});
    return {status:r.status,json:r.ok?await r.json():null};
  }catch{return {status:0,json:null};}
};
const apiStatus=(r,ok,absent)=>{
  if(r.status===200)return ok(r.json);
  if(r.status===404)return absent;
  return "UNVERIFIED_API_HTTP_"+r.status;
};
const reviewerSettings=env=>env?.name==="appf2-task-human-approval"&&
  (env?.protection_rules||[]).some(p=>p.type==="required_reviewers" &&
    (p.reviewers||[]).some(x=>x.type==="User"&&x.reviewer?.login==="NFF98"));
export function summarizeBootstrapState({workflow,environment,design,mainSha}){
  const mainWorkflow=apiStatus(workflow,x=>
    x?.type==="file"?"PRESENT_MAIN":"UNVERIFIED_BAD_WORKFLOW_METADATA",
    "NOT_FOUND_ON_MAIN");
  const humanEnv=apiStatus(environment,x=>reviewerSettings(x)?
    "REQUIRED_REVIEWER_CONFIRMED":"REQUIRED_REVIEWER_NOT_CONFIGURED",
  "NOT_FOUND_OR_UNREADABLE");
  const designLineage=apiStatus(design,x=>
    ["ahead","identical"].includes(x?.status)?"FROZEN_ANCESTOR_CONFIRMED":
      x?.status==="diverged"?"DIVERGED_NEEDS_HUMAN_REVIEW":
        "UNVERIFIED_COMPARE_"+String(x?.status),
    "UNVERIFIED_DESIGN_NOT_FOUND");
  return {source:"LIVE_GITHUB_READ_ONLY",main_sha:mainSha,
    main_grant_workflow:mainWorkflow,human_environment:humanEnv,
    design_freeze_lineage:designLineage,positive_e2e:"NOT_RUN",
    decision:"NOT_ELIGIBLE_TO_DECLARE_16P_IMPLEMENTED"};
}
export async function inspectLiveBootstrapState({token,mainSha}){
  const api="https://api.github.com/repos/";
  const [workflow,environment,design]=await Promise.all([
    remoteRead(api+"NFF98/appf2-build/contents/.github/workflows/"+
      "task-human-grant.yml?ref="+mainSha,token),
    remoteRead(api+"NFF98/appf2-build/environments/appf2-task-human-approval",token),
    remoteRead(api+"NFF98/appf2-design/compare/"+
      "fda9045d0fc1b2b718d56ed49fa09abdce343a5c..."+
      "f844914b7afb738f903d4041f09a1d6c8f82711e",token)
  ]);
  return summarizeBootstrapState({workflow,environment,design,mainSha});
}


if(import.meta.url===pathToFileURL(process.argv[1]||"").href){
  if(process.argv.includes("--live-negative"))
    verifyLiveUnauthorizedNegative().catch(e=>{
      console.error("LIVE NEGATIVE INTEGRATION FAILED: "+e.message);
      process.exitCode=1;
    });
  else console.log("可信 Human Grant："+runTrustedGrantSelfTests()+
    " 項合成正負測試 PASS；真人 Environment E2E 尚未證明");
}
