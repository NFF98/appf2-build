// GOV-REFORM-20261013 positive/negative regression matrix. Executed by
// governance-gate.mjs on every CI run. All fixtures are synthetic; a PASS here
// is NOT Human approval and NOT Product evidence.
import fs from "node:fs";
import path from "node:path";
import {
  evaluateHumanException,isPersistentProceduralWaiver,exceptionDigest,
  HUMAN_EXCEPTION_SCHEMA,GOVERNANCE_REFORM_POLICY_PATH
} from "./human-exception.mjs";
import {
  LIFECYCLE_STATES,advance,onNewHead,finalGateVerdict,classifyChange,
  requiresActivation,requiresRebind,leaseDecision
} from "./task-pr-lifecycle.mjs";
import { selectImpactedTests } from "./select-impacted-tests.mjs";
import { buildEvidenceLedger } from "./evidence-ledger.mjs";
import { planTaskEvidenceReferences,planTaskClosureReadiness,
  planProtectedClosureMutation,inspectProtectedControlPrProvenance } from "./evidence-ledger-report.mjs";
import { computeGovernanceMetrics,fullCiRuns } from "./governance-metrics.mjs";
import { preflight,prCreationDecision,taskKeyOfPr,hasPrJustification,governanceCaseOfPr,hasHumanFacingChinese } from "./gpt-preflight.mjs";

const NOW=1792000000,BASE="a".repeat(40),DOCKET="delivery/constitutional-cases/GOV-TEST-EXCEPTION-001.json";
const RULESET_CONTEXTS=["ci","attack","governance","Analyze JavaScript / TypeScript"];
const clone=x=>JSON.parse(JSON.stringify(x));
const expectCases=(group,cases,run)=>{
  for(const [name,want,input] of cases){
    const got=run(input);
    if(got!==want) throw Error("GOV-REFORM SELF-TEST FAILED ["+group+"]: "+name+" expected "+want+" got "+got);
  }
  return cases.length;
};

const rebindDigest=ctx=>{
  const paths=ctx.changed.filter(p=>p!==ctx.docketPath);
  const digest=exceptionDigest(ctx.readHead,paths);
  ctx.docket.exact_changed_paths=[...paths];
  ctx.docket.candidate_digest_sha256=digest;
  if(ctx.docket.human_approval) ctx.docket.human_approval.candidate_digest_sha256=digest;
  return ctx;
};
const withPath=(ctx,p,content="x\n")=>{
  ctx.files.set(p,Buffer.from(typeof content==="string"?content:JSON.stringify(content)));
  if(!ctx.changed.includes(p)) ctx.changed.unshift(p);
  return rebindDigest(ctx);
};
function fixture(policy,{lane="GOVERNANCE_REFORM",files={"harness/scripts/example.mjs":"export const x=1;\n"},scope={},baseJson={},baseExists=[]}={}){
  const map=new Map(Object.entries(files).map(([k,v])=>[k,Buffer.from(typeof v==="string"?v:JSON.stringify(v))]));
  const sprint={active_sprint:"SP-P9-001",active_build_spec:"BS-P9-001",active_task:"T001",status:"ACTIVE"};
  const build={active_baseline:"BS-P9-001",implementation_enabled:true};
  const ctx={
    files:map,changed:[...map.keys(),DOCKET],base:BASE,policy:policy.exception,humanAccounts:policy.human_authority_accounts,
    docketPath:DOCKET,isNewDocket:true,baseDigests:new Set(),now:NOW,
    readHead:p=>map.get(p)||null,readHeadJson:p=>map.has(p)?JSON.parse(map.get(p).toString("utf8")):null,
    readBaseJson:p=>baseJson[p]??null,existsAtBase:p=>baseExists.includes(p),
    state:{baseSprint:sprint,headSprint:{...sprint},baseBuild:build,headBuild:{...build}},
    docket:{case_id:"GOV-TEST-EXCEPTION-001",base_sha:BASE,
      scope_exception:{schema:HUMAN_EXCEPTION_SCHEMA,lane,reason:"synthetic reason",risk:"synthetic risk",owner:"Human",
        follow_up:"synthetic follow-up",residual_gaps:["synthetic gap"],never_converts_fail_or_untested_to_pass:true,
        affected_sprint:"SP-P9-001",affected_tasks:[],covered_gates:["CHANGE_SCOPE"],expires_at_unix:NOW+3600,...scope},
      human_approval:{case_id:"GOV-TEST-EXCEPTION-001",source_kind:"DIRECT_HUMAN_MESSAGE",decision:"APPROVE_EXACT_CANDIDATE",
        scope:"EXACT_PR_DIFF",human_message_ref:"Human direct message: exact digest decision",approver:"NFF98",approved_at_unix:NOW-60}}
  };
  return rebindDigest(ctx);
}
const ok=ctx=>evaluateHumanException(ctx).ok;

function governanceLaneCases(policy){
  const g=()=>fixture(policy);
  const set=(fn)=>{const c=g();fn(c);return c;};
  return [
    ["GOVERNANCE_REFORM exact candidate",true,g()],
    ["approval missing",false,set(c=>{delete c.docket.human_approval;})],
    ["bot/AI source kind",false,set(c=>{c.docket.human_approval.source_kind="AI_GENERATED_COMMENT";})],
    ["placeholder decision ref",false,set(c=>{c.docket.human_approval.human_message_ref="SYNTHETIC-NOT-HUMAN";})],
    ["unregistered approver",false,set(c=>{c.docket.human_approval.approver="cursor-bot";})],
    ["approval bound to other digest",false,set(c=>{c.docket.human_approval.candidate_digest_sha256="b".repeat(64);})],
    ["plan-level approval is not exact candidate",false,set(c=>{c.docket.human_approval.decision="APPROVE_PLAN";})],
    ["byte drift after approval",false,set(c=>{c.files.set("harness/scripts/example.mjs",Buffer.from("export const x=2;\n"));})],
    ["stale base SHA",false,set(c=>{c.base="b".repeat(40);})],
    ["unapproved extra path",false,set(c=>{c.files.set("harness/x.md",Buffer.from("x"));c.changed.push("harness/x.md");})],
    ["Product source smuggled",false,withPath(g(),"src/edge/evil.ts")],
    ["Product test smuggled",false,withPath(g(),"tests/api/evil.test.ts")],
    ["dependency manifest smuggled",false,withPath(g(),"package.json","{}")],
    ["Activation record forged",false,withPath(g(),"build-spec/activations/BS-P9-002.json","{}")],
    ["CURRENT pointer switched",false,withPath(g(),"build-spec/CURRENT.json","{}")],
    ["release workflow edited",false,withPath(g(),".github/workflows/release.yml")],
    ["secret file",false,withPath(g(),"harness/.env")],
    ["other docket edited",false,withPath(g(),"delivery/constitutional-cases/GOV-OLD-001.json","{}")],
    ["replay: docket already at base",false,set(c=>{c.isNewDocket=false;})],
    ["replay: digest already consumed",false,set(c=>{c.baseDigests.add(c.docket.candidate_digest_sha256);})],
    ["expired",false,set(c=>{c.now=NOW+7200;})],
    ["TTL longer than policy",false,set(c=>{c.docket.scope_exception.expires_at_unix=NOW+40*86400;})],
    ["approval dated in the future",false,set(c=>{c.docket.human_approval.approved_at_unix=NOW+86400;})],
    ["non-waivable gate claimed",false,set(c=>{c.docket.scope_exception.covered_gates=["CHANGE_SCOPE","EVIDENCE_PASS"];})],
    ["gate unknown to lane",false,set(c=>{c.docket.scope_exception.covered_gates=["BACKLOG_T008_CLOSE_AFTER_T006_REVIEW"];})],
    ["residual GAP missing",false,set(c=>{c.docket.scope_exception.residual_gaps=[];})],
    ["claims FAIL/UNTESTED may become PASS",false,set(c=>{c.docket.scope_exception.never_converts_fail_or_untested_to_pass=false;})],
    ["bound to other Sprint",false,set(c=>{c.docket.scope_exception.affected_sprint="SP-P9-002";})],
    ["Sprint control mutated in governance lane",false,set(c=>{c.state.headSprint.status="REVIEW";})],
    ["governance lane claims Task authority",false,set(c=>{c.docket.scope_exception.affected_tasks=["T001"];})],
    ["unknown lane",false,set(c=>{c.docket.scope_exception.lane="ANYTHING_GOES";})]
  ];
}

function ssotClosureHotfixCases(policy){
  const tasksPath="delivery/sprints/SP-P9-001/tasks.json";
  const baseTasks={sprint_id:"SP-P9-001",tasks:[{task_id:"T001",status:"IN_PROGRESS",scope:["typo"],completion_evidence:[]},{task_id:"T002",status:"PLANNED",scope:["b"],completion_evidence:[]}]};
  const ssot=(mutateTasks=x=>x,scope={},extra={})=>{
    const head=clone(baseTasks);head.tasks[0].scope=["fixed typo"];mutateTasks(head);
    return fixture(policy,{lane:"PROTECTED_SSOT_AMENDMENT",files:{[tasksPath]:head,...extra},baseJson:{[tasksPath]:baseTasks},
      scope:{affected_tasks:["T001"],semantic_class:"CORRECTION",impact_audit:["T001 scope wording only"],...scope}});
  };
  const material=extra=>ssot(x=>x,{semantic_class:"MATERIAL_PRODUCT_SEMANTIC",design_change_ref:"NFF98/appf2-design@0123abc"},extra);
  const closure=scope=>fixture(policy,{lane:"CLOSURE_DEFERRAL",files:{[tasksPath]:baseTasks,"delivery/evidence/EV-SP-P9-001-T001-001.json":"{}"},
    scope:{affected_tasks:["T001"],affected_build_spec:"BS-P9-001",covered_gates:["BACKLOG_T008_CLOSE_AFTER_T006_REVIEW"],...scope}});
  const hotfix=(scope={},files={"src/edge/fix.ts":"export const fixed=true;\n"},baseExists=[])=>fixture(policy,{lane:"HOTFIX",files,baseExists,
    scope:{incident_ref:"INC-SYN-1",retrospective_due_unix:NOW+86400,required_full_gates:[...RULESET_CONTEXTS],...scope}});
  return [
    ["SSOT correction to affected Task",true,ssot()],
    ["SSOT amendment transitions Task status",false,ssot(h=>{h.tasks[0].status="CLOSED";})],
    ["SSOT amendment edits unaffected Task",false,ssot(h=>{h.tasks[1].scope=["widened"];})],
    ["SSOT amendment creates a Task",false,ssot(h=>{h.tasks.push({task_id:"T003",status:"PLANNED"});})],
    ["material semantic without new baseline",false,ssot(x=>x,{semantic_class:"MATERIAL_PRODUCT_SEMANTIC",design_change_ref:"NFF98/appf2-design@0123abc"})],
    ["material semantic with Design ref + new baseline",true,material({"build-spec/baselines/BS-P9-002/manifest.json":"{}"})],
    ["existing locked baseline rewritten",false,(()=>{const c=material({"build-spec/baselines/BS-P9-001/manifest.json":"{}"});c.existsAtBase=p=>p.startsWith("build-spec/baselines/BS-P9-001/");return c;})()],
    ["SSOT lane touches harness",false,withPath(ssot(),"harness/scripts/x.mjs")],
    ["CLOSURE_DEFERRAL procedural gate",true,closure()],
    ["CLOSURE_DEFERRAL unknown gate",false,closure({covered_gates:["EVIDENCE_LATER"]})],
    ["CLOSURE_DEFERRAL claims CHANGE_SCOPE",false,closure({covered_gates:["CHANGE_SCOPE"]})],
    ["CLOSURE_DEFERRAL without Task",false,closure({affected_tasks:[]})],
    ["CLOSURE_DEFERRAL bound to another Build Spec",false,closure({affected_build_spec:"BS-P9-002"})],
    ["SSOT lane cannot move CURRENT",false,withPath(material({"build-spec/baselines/BS-P9-002/manifest.json":"{}"}),"build-spec/CURRENT.json","{}")],
    ["HOTFIX with full gates",true,hotfix()],
    ["HOTFIX drops CodeQL",false,hotfix({required_full_gates:["ci","attack","governance"]})],
    ["HOTFIX rewrites existing migration",false,hotfix({},{"supabase/migrations/1_old.sql":"--"},["supabase/migrations/1_old.sql"])],
    ["HOTFIX touches harness",false,withPath(hotfix(),"harness/scripts/x.mjs")]
  ];
}

// Use-time checks for a MERGED CLOSURE_DEFERRAL docket: every gate run re-validates it.
function persistentWaiverCases(policy){
  const valid=fixture(policy,{lane:"CLOSURE_DEFERRAL",scope:{affected_tasks:["T008"],affected_sprint:"SP-P1-003",
    affected_build_spec:"BS-P1-025",covered_gates:["BACKLOG_T008_CLOSE_AFTER_T006_REVIEW"]}}).docket;
  const expires=valid.scope_exception.expires_at_unix;
  const q={policy:policy.exception,accounts:policy.human_authority_accounts,gateId:"BACKLOG_T008_CLOSE_AFTER_T006_REVIEW",
    taskId:"T008",sprintId:"SP-P1-003",buildSpecId:"BS-P1-025",now:NOW,fileName:"GOV-TEST-EXCEPTION-001.json",
    revokedIds:new Set(),digestCounts:new Map([[valid.candidate_digest_sha256,1]])};
  const edit=fn=>{const d=clone(valid);fn(d);return d;};
  return expectCases("persistent waiver",[
    ["merged exact waiver",true,[valid,q]],
    ["valid one second before expiry",true,[valid,{...q,now:expires-1}]],
    ["expired at use time",false,[valid,{...q,now:expires+1}]],
    ["TTL longer than policy",false,[edit(d=>{d.scope_exception.expires_at_unix=d.human_approval.approved_at_unix+policy.exception.max_ttl_seconds+1;}),q]],
    ["expiry missing",false,[edit(d=>{delete d.scope_exception.expires_at_unix;}),q]],
    ["approval dated after use time",false,[edit(d=>{d.human_approval.approved_at_unix=NOW+86400;}),q]],
    ["placeholder Human reference",false,[edit(d=>{d.human_approval.human_message_ref="PENDING Human decision";}),q]],
    ["unregistered approver",false,[edit(d=>{d.human_approval.approver="cursor-bot";}),q]],
    ["AI-generated source kind",false,[edit(d=>{d.human_approval.source_kind="AI_GENERATED_COMMENT";}),q]],
    ["revoked by later docket",false,[valid,{...q,revokedIds:new Set([valid.case_id])}]],
    ["digest replayed by another docket",false,[valid,{...q,digestCounts:new Map([[valid.candidate_digest_sha256,2]])}]],
    ["docket renamed / file mismatch",false,[valid,{...q,fileName:"GOV-OTHER-001.json"}]],
    ["other gate",false,[valid,{...q,gateId:"EVIDENCE_PASS"}]],
    ["non-waivable gate smuggled into covered_gates",false,[edit(d=>{d.scope_exception.covered_gates.push("EVIDENCE_PASS");}),q]],
    ["other Task",false,[valid,{...q,taskId:"T006"}]],
    ["other Sprint",false,[valid,{...q,sprintId:"SP-P1-004"}]],
    ["other Build Spec after rebaseline",false,[valid,{...q,buildSpecId:"BS-P1-026"}]],
    ["not a closure lane",false,[edit(d=>{d.scope_exception.lane="GOVERNANCE_REFORM";}),q]],
    ["approval stripped",false,[edit(d=>{delete d.human_approval;}),q]],
    ["approval digest mismatch",false,[edit(d=>{d.human_approval.candidate_digest_sha256="c".repeat(64);}),q]],
    ["residual GAP removed",false,[edit(d=>{d.scope_exception.residual_gaps=[];}),q]],
    ["fake-green declaration removed",false,[edit(d=>{d.scope_exception.never_converts_fail_or_untested_to_pass=false;}),q]]
  ],([d,query])=>isPersistentProceduralWaiver(d,query));
}

// Stage 2 of a Human-approved mid-Sprint rebaseline: move control pointers to an already-merged LOCKED baseline.
function buildSpecActivationCases(policy){
  const T="delivery/sprints/SP-P9-001/tasks.json",M="delivery/sprints/SP-P9-001/manifest.json",Q="delivery/backlog/QUEUE.json";
  const AR="build-spec/activations/BS-P9-002.json",NEW_MANIFEST="build-spec/baselines/BS-P9-002/manifest.json";
  const task=(id,status,bs="BS-P9-001")=>({task_id:id,status,build_spec_id:bs,acceptance_links:[{acceptance_id:"F99-AC-001",test_id:"TEST-F99-001"}],allowed_write_paths:["src/demo/"],completion_evidence:[]});
  const baseTasks={sprint_id:"SP-P9-001",tasks:[task("T000","CLOSED"),task("T001","REVIEW"),task("T002","BLOCKED")]};
  const baseManifest={sprint_id:"SP-P9-001",build_spec_id:"BS-P9-001",status:"ACTIVE"};
  const baseQueue={build_spec_id:"BS-P9-001",items:[{backlog_item_id:"BL-1",status:"SPRINTED",sprint_id:"SP-P9-001",build_spec_id:"BS-P9-001",revalidation:{status:"CLOSED",target_build_spec_id:"BS-P9-001"}}]};
  const make=(mutate=()=>{})=>{
    const head={tasks:clone(baseTasks),manifest:{...baseManifest,build_spec_id:"BS-P9-002"},queue:clone(baseQueue),
      record:{baseline_id:"BS-P9-002",previous_baseline:"BS-P9-001",type:"REBASELINE"},
      build:{active_baseline:"BS-P9-002",implementation_enabled:true},
      sprint:{active_sprint:"SP-P9-001",active_build_spec:"BS-P9-002",active_task:"T001",status:"REVIEW"},
      baseJson:{[T]:baseTasks,[M]:baseManifest,[Q]:baseQueue,[NEW_MANIFEST]:{status:"LOCKED",supersedes:"BS-P9-001"}},
      baseExists:[NEW_MANIFEST],extra:{},
      scope:{activation:{from_baseline:"BS-P9-001",to_baseline:"BS-P9-002"},design_change_ref:"NFF98/appf2-design@0123abc + BD-999",
        impact_audit:["T001/T002 rebind only; T000 CLOSED unchanged"],covered_gates:["CHANGE_SCOPE","ACTIVATION_SPRINT_PAUSE_PRECONDITION"]}};
    for(const t of head.tasks.tasks) if(t.status!=="CLOSED") t.build_spec_id="BS-P9-002";
    head.queue.build_spec_id="BS-P9-002";head.queue.items[0].build_spec_id="BS-P9-002";
    mutate(head);
    const c=fixture(policy,{lane:"BUILD_SPEC_ACTIVATION",scope:head.scope,baseJson:head.baseJson,baseExists:head.baseExists,files:{
      "build-spec/CURRENT.json":head.build,[AR]:head.record,"delivery/CURRENT-SPRINT.json":head.sprint,[T]:head.tasks,[M]:head.manifest,[Q]:head.queue,...head.extra}});
    c.state={baseSprint:{active_sprint:"SP-P9-001",active_build_spec:"BS-P9-001",active_task:"T001",status:"REVIEW"},headSprint:head.sprint,
      baseBuild:{active_baseline:"BS-P9-001",implementation_enabled:true},headBuild:head.build};
    if(head.dropRecord){c.changed=c.changed.filter(p=>p!==AR);rebindDigest(c);}
    return c;
  };
  const t1=h=>h.tasks.tasks[1];
  return expectCases("build spec activation",[
    ["mid-Sprint activation of merged LOCKED baseline",true,make()],
    ["AC/Test remap of affected Task",true,make(h=>{t1(h).acceptance_links.push({acceptance_id:"F99-AC-002",test_id:"TEST-F99-002"});h.scope.affected_tasks=["T001"];})],
    ["AC/Test remap of unaffected Task",false,make(h=>{t1(h).acceptance_links.push({acceptance_id:"F99-AC-002",test_id:"TEST-F99-002"});})],
    ["target baseline created in same PR (not yet merged)",false,make(h=>{h.baseJson[NEW_MANIFEST]=null;h.baseExists=[];})],
    ["target baseline not LOCKED",false,make(h=>{h.baseJson[NEW_MANIFEST]={status:"DRAFT",supersedes:"BS-P9-001"};})],
    ["target does not supersede active baseline",false,make(h=>{h.baseJson[NEW_MANIFEST]={status:"LOCKED",supersedes:"BS-P9-000"};})],
    ["CURRENT points elsewhere than declared",false,make(h=>{h.build.active_baseline="BS-P9-003";})],
    ["implementation_enabled flipped",false,make(h=>{h.build.implementation_enabled=false;})],
    ["Activation Record missing",false,make(h=>{h.dropRecord=true;})],
    ["Activation Record already at base",false,make(h=>{h.baseExists.push(AR);})],
    ["Activation Record wrong lineage",false,make(h=>{h.record.previous_baseline="BS-P9-000";})],
    ["Task switched during activation",false,make(h=>{h.sprint.active_task="T002";})],
    ["Sprint status changed during activation",false,make(h=>{h.sprint.status="ACTIVE";})],
    ["Task status changed",false,make(h=>{t1(h).status="CLOSED";})],
    ["Task write scope widened",false,make(h=>{t1(h).allowed_write_paths.push("src/other/");})],
    ["CLOSED Task rebound",false,make(h=>{h.tasks.tasks[0].build_spec_id="BS-P9-002";})],
    ["Task rebound to undeclared baseline",false,make(h=>{t1(h).build_spec_id="BS-P9-003";})],
    ["Task added",false,make(h=>{h.tasks.tasks.push(task("T003","PLANNED","BS-P9-002"));})],
    ["Sprint manifest status changed",false,make(h=>{h.manifest.status="CLOSED";})],
    ["Backlog item lifecycle changed",false,make(h=>{h.queue.items[0].status="DONE";})],
    ["existing revalidation rewritten",false,make(h=>{h.queue.items[0].revalidation.status="IN_PROGRESS";})],
    ["new baseline bytes smuggled",false,make(h=>{h.extra["build-spec/baselines/BS-P9-002/functions/demo.md"]="# changed";})],
    ["old locked baseline rewritten",false,make(h=>{h.extra["build-spec/baselines/BS-P9-001/manifest.json"]="{}";})],
    ["Delta rewritten during activation",false,make(h=>{h.extra["delivery/deltas/BD-999.json"]="{}";})],
    ["Product source smuggled",false,make(h=>{h.extra["src/demo/x.ts"]="export const x=1;";})],
    ["Design/Delta reference missing",false,make(h=>{delete h.scope.design_change_ref;})],
    ["impact audit missing",false,make(h=>{h.scope.impact_audit=[];})],
    ["from == to",false,make(h=>{h.scope.activation.to_baseline="BS-P9-001";})],
    ["ACTIVATION gate itself claimed",false,make(h=>{h.scope.covered_gates.push("ACTIVATION");})],
    ["GOVERNANCE lane cannot activate",false,make(h=>{h.scope.lane="GOVERNANCE_REFORM";})]
  ],ok);
}

function policyInvariantCases(policy){
  const ex=policy.exception;
  const lanesWaivable=Object.values(ex.lanes).flatMap(l=>l.waivable_gates||[]);
  return expectCases("policy invariants",[
    ["lifecycle states mirror policy",true,JSON.stringify(policy.lifecycle.states)===JSON.stringify(LIFECYCLE_STATES)],
    ["full-gate contexts equal enforced Ruleset contexts",true,JSON.stringify(policy.full_gate_contexts)===JSON.stringify(RULESET_CONTEXTS)],
    ["only direct Human messages accepted",true,JSON.stringify(ex.accepted_source_kinds)===JSON.stringify(["DIRECT_HUMAN_MESSAGE"])],
    ["max TTL <= 30 days",true,ex.max_ttl_seconds<=30*86400],
    ["security/evidence gates non-waivable",true,["EVIDENCE_PASS","PRODUCT_CI","CODEQL","SECURITY_AUDIT","HUMAN_MERGE","BASELINE_IMMUTABILITY","ACTIVATION"].every(g=>ex.non_waivable_gates.includes(g))],
    ["no lane may waive a non-waivable gate",true,lanesWaivable.every(g=>!ex.non_waivable_gates.includes(g))],
    ["release/deploy forbidden everywhere",true,["releases/","deploy/",".github/workflows/release.yml"].every(p=>ex.global_forbidden_paths.includes(p))],
    ["only BUILD_SPEC_ACTIVATION may move CURRENT/Activation",true,Object.entries(ex.lanes).every(([n,l])=>n==="BUILD_SPEC_ACTIVATION" ||
      l.forbidden_paths.includes("build-spec/") || ["build-spec/CURRENT.json","build-spec/activations/"].every(p=>l.forbidden_paths.includes(p)))],
    ["BUILD_SPEC_ACTIVATION cannot touch baselines/Deltas/Evidence",true,["build-spec/baselines/","delivery/deltas/","delivery/evidence/"].every(p=>ex.lanes.BUILD_SPEC_ACTIVATION.forbidden_paths.includes(p))],
    ["only HOTFIX may touch Product source",true,Object.entries(ex.lanes).every(([n,l])=>n==="HOTFIX" || l.forbidden_paths.includes("src/"))],
    ["16P_ACCEPTANCE_LEASE lane present",true,Boolean(ex.lanes["16P_ACCEPTANCE_LEASE"])],
    ["16P_ACCEPTANCE_LEASE preserves HOLD pointers",true,["delivery/CURRENT-SPRINT.json","delivery/sprints/","delivery/backlog/","build-spec/","src/"].every(p=>ex.lanes["16P_ACCEPTANCE_LEASE"].forbidden_paths.includes(p))],
    ["16P_ACCEPTANCE_LEASE policy forbids Sprint4/T008 reuse",true,policy.sixteen_p_acceptance_lease?.canonical_task_id==="T016"&&
      policy.sixteen_p_acceptance_lease.forbidden_reuse_task_ids.includes("T008")&&
      policy.sixteen_p_acceptance_lease.forbidden_sprint_ids.includes("SP-P1-004")&&
      policy.sixteen_p_acceptance_lease.direct_connector_prewrite_default===false]
  ],x=>x);
}

function sixteenPAcceptanceLeaseCases(policy){
  const lease={
    schema:"APPF2-16P-ACCEPTANCE-LEASE-1",lease_id:"16P-LEASE-001",task_id:"T016",status:"ACTIVE",
    product_hold_preserved:true,sprint4_forbidden:true,bound_sprint_id:null,
    never_converts_fail_or_untested_to_pass:true,activated_at_unix:NOW-60,expires_at_unix:NOW+3600,
    allowed_write_paths:["delivery/audits/","harness/scripts/16p-real-e2e.mjs"],
    activation_case_id:"GOV-16P-ACCEPTANCE-LEASE-ACT-001",title:"16P acceptance",
    direct_connector_prewrite_proven:false
  };
  const hold={active_sprint:null,active_build_spec:null,active_task:null,status:"HOLD"};
  const build={active_baseline:"BS-P1-025",implementation_enabled:false};
  const base=()=>{
    const c=fixture(policy,{lane:"16P_ACCEPTANCE_LEASE",
      files:{"delivery/16p-acceptance-lease/CURRENT.json":lease,"delivery/audits/note.json":{"ok":true}},
      scope:{affected_tasks:["T016"],affected_sprint:null,product_hold_preserved:true,sprint4_forbidden:true,
        covered_gates:["CHANGE_SCOPE"]}});
    c.state={baseSprint:hold,headSprint:{...hold},baseBuild:build,headBuild:{...build}};
    return rebindDigest(c);
  };
  return [
    ["16P_ACCEPTANCE_LEASE exact ACTIVE lease",true,base()],
    ["16P lease cannot bind Sprint4",false,(()=>{const c=base();c.docket.scope_exception.affected_sprint="SP-P1-004";return rebindDigest(c);})()],
    ["16P lease cannot mutate CURRENT-SPRINT",false,(()=>{const c=base();c.state.headSprint={...hold,status:"ACTIVE",active_task:"T016"};return c;})()],
    ["16P lease cannot reuse T008",false,(()=>{const c=base();c.docket.scope_exception.affected_tasks=["T008"];
      c.files.set("delivery/16p-acceptance-lease/CURRENT.json",Buffer.from(JSON.stringify({...lease,task_id:"T008"})));return rebindDigest(c);})()],
    ["16P lease cannot self-attest connector proven",false,(()=>{const c=base();c.docket.scope_exception.direct_connector_prewrite_proven=true;return c;})()],
    ["16P lease missing CURRENT.json",false,(()=>{const c=base();c.files.delete("delivery/16p-acceptance-lease/CURRENT.json");
      c.changed=c.changed.filter(p=>p!=="delivery/16p-acceptance-lease/CURRENT.json");return rebindDigest(c);})()]
  ];
}

function lifecycleCases(){
  const r0={task_id:"T001",state:"AUTHORIZED_TASK",head:"h1"};
  const ev={mapped_tests:[{id:"TEST-1",status:"PASS"}],bce_head:"h1",final_gate:{verdict:"PASS"},approved_head:"h1"};
  const walk=steps=>steps.reduce((acc,[to,actor,head="h1"])=>acc.ok?advance(acc.record,{to,actor,head,evidence:ev}):acc,{ok:true,record:r0});
  const happy=[["DRAFT_DEVELOPMENT","CURSOR"],["LOCAL_AC_TESTS_PASS","CI"],["GPT_BCE_PASS","GPT"],["HUMAN_FINAL_INTEGRATION_READY","HUMAN"],
    ["EXACT_HEAD_FULL_GATES_PASS","CI"],["HUMAN_MERGE_APPROVED","HUMAN"],["MERGED","HUMAN"],["EVIDENCE_AND_CLOSURE","HUMAN"]];
  const ready={...r0,state:"HUMAN_FINAL_INTEGRATION_READY"};
  const moved=onNewHead(ready,"h2");
  return expectCases("lifecycle",[
    ["happy path reaches closure",true,()=>walk(happy).record?.state==="EVIDENCE_AND_CLOSURE"],
    ["GPT cannot mark Final Ready",false,()=>walk([...happy.slice(0,3),["HUMAN_FINAL_INTEGRATION_READY","GPT"]]).ok],
    ["Cursor cannot approve merge",false,()=>walk([...happy.slice(0,5),["HUMAN_MERGE_APPROVED","CURSOR"]]).ok],
    ["state skipping rejected",false,()=>walk([["DRAFT_DEVELOPMENT","CURSOR"],["GPT_BCE_PASS","GPT"]]).ok],
    ["NOT_RUN mapped test is not PASS",false,()=>advance({...r0,state:"DRAFT_DEVELOPMENT"},{to:"LOCAL_AC_TESTS_PASS",actor:"CI",head:"h1",evidence:{mapped_tests:[{status:"PASS"},{status:"NOT_RUN"}]}}).ok],
    ["Final Ready on A invalidated by commit B",true,()=>moved.record.state==="DRAFT_DEVELOPMENT" && moved.invalidated.includes("HUMAN_FINAL_INTEGRATION_READY")],
    ["full gates cannot pass after HEAD change",false,()=>advance(moved.record,{to:"EXACT_HEAD_FULL_GATES_PASS",actor:"CI",head:"h2",evidence:ev}).ok],
    ["stale-head attestation rejected",false,()=>advance({...r0,state:"DRAFT_DEVELOPMENT"},{to:"LOCAL_AC_TESTS_PASS",actor:"CI",head:"h9",evidence:ev}).ok],
    ["BCE must cite exact HEAD",false,()=>advance({...r0,state:"LOCAL_AC_TESTS_PASS"},{to:"GPT_BCE_PASS",actor:"GPT",head:"h1",evidence:{bce_head:"h0"}}).ok],
    ["post-merge commit inherits nothing",false,()=>onNewHead({...r0,state:"MERGED"},"h3").ok]
  ],fn=>fn());
}

function finalGateCases(){
  const full=head=>RULESET_CONTEXTS.map(context=>({context,head_sha:head,conclusion:"success",mode:"FULL"}));
  const v=checks=>finalGateVerdict({head:"h1",required:RULESET_CONTEXTS,checks}).verdict;
  return expectCases("final gate",[
    ["all four FULL success on exact HEAD",["PASS"],full("h1")],
    ["Draft fast-loop green is not full PASS",["NOT_PASS"],full("h1").map(c=>({...c,mode:"FAST_LOOP"}))],
    ["skipped job is not PASS",["NOT_PASS"],full("h1").map(c=>c.context==="ci"?{...c,conclusion:"skipped"}:c)],
    ["green only on previous HEAD",["NOT_PASS"],full("h0")],
    ["CodeQL missing",["NOT_PASS"],full("h1").filter(c=>c.context!=="Analyze JavaScript / TypeScript")],
    ["latest rerun failed after earlier success",["NOT_PASS"],[...full("h1"),{context:"ci",head_sha:"h1",conclusion:"failure",mode:"FULL"}]]
  ].map(([n,[want],checks])=>[n,want,checks]),v);
}

function routingCases(repoPolicy){
  const task={task_id:"T008",allowed_write_paths:["src/edge/","tests/api/"]};
  const c=(changed,lane=null)=>classifyChange({changed,task,repoPolicy,exceptionLane:lane}).change_class;
  return expectCases("routing",[
    ["Bugfix inside Task lease",["BUGFIX_OR_IMPLEMENTATION_IN_TASK"],()=>c(["src/edge/a.ts","tests/api/a.test.ts","delivery/evidence/EV-SP-P1-003-T008-015.json"])],
    ["test-only change",["TEST_IN_TASK"],()=>c(["tests/api/a.test.ts"])],
    ["evidence only",["EVIDENCE"],()=>c(["delivery/evidence/EV-SP-P1-003-T008-015.json"])],
    ["closure control + evidence",["CLOSURE_OR_STATE_CONTROL"],()=>c(["delivery/sprints/SP-P1-003/tasks.json","delivery/evidence/EV-SP-P1-003-T008-015.json"])],
    ["governance rule",["GOVERNANCE"],()=>c(["harness/scripts/x.mjs"])],
    ["governance + product mixed",["MIXED_FORBIDDEN"],()=>c(["harness/scripts/x.mjs","src/edge/a.ts"])],
    ["product outside Task",["OUT_OF_TASK_SCOPE"],()=>c(["src/app/a.tsx"])],
    ["activation",["ACTIVATION"],()=>c(["build-spec/activations/BS-P1-026.json","build-spec/CURRENT.json"])],
    ["hotfix lane",["HOTFIX"],()=>c(["src/app/a.tsx"],{change_class:"HOTFIX"})]
  ].map(([n,[want],fn])=>[n,want,fn]),fn=>fn());
}

function authorityCases(){
  const s={active_sprint:"SP-P1-003",active_task:"T008",active_build_spec:"BS-P1-025",status:"ACTIVE"};
  const b={active_baseline:"BS-P1-025",implementation_enabled:true};
  const td={tasks:[{task_id:"T008",build_spec_id:"BS-P1-025",acceptance_links:[{acceptance_id:"A",test_id:"T"}],backlog_item_ids:["BL-1"]}]};
  const lease={status:"ACTIVE",task_id:"T008",sprint_id:"SP-P1-003",build_spec_id:"BS-P1-025",scope_digest:"d"};
  const req={task_id:"T008",sprint_id:"SP-P1-003",build_spec_id:"BS-P1-025",scope_digest:"d",change_class:"BUGFIX_OR_IMPLEMENTATION_IN_TASK"};
  const act=(bs,as,bb=b,ab=b)=>requiresActivation({beforeSprint:bs,afterSprint:as,beforeBuild:bb,afterBuild:ab}).required;
  const reb=(bb,ab,bt,at)=>requiresRebind({beforeBaseline:bb,afterBaseline:ab,beforeTasks:bt,afterTasks:at}).required;
  const changedLinks=clone(td);changedLinks.tasks[0].acceptance_links.push({acceptance_id:"B",test_id:"U"});
  return expectCases("activation/rebind/lease",[
    ["routine fix needs no Activation",false,()=>act(s,{...s})],
    ["ACTIVE -> REVIEW needs no Activation",false,()=>act(s,{...s,status:"REVIEW"})],
    ["Task switch needs Activation",true,()=>act(s,{...s,active_task:"T006"})],
    ["BLOCKED -> ACTIVE needs Activation",true,()=>act({...s,status:"BLOCKED"},s)],
    ["code fix needs no Rebind",false,()=>reb("BS-P1-025","BS-P1-025",td,clone(td))],
    ["AC/Test mapping change needs Rebind",true,()=>reb("BS-P1-025","BS-P1-025",td,changedLinks)],
    ["baseline change needs Rebind",true,()=>reb("BS-P1-025","BS-P1-026",td,td)],
    ["same lease continues without approval",true,()=>leaseDecision({lease,request:req}).decision==="CONTINUE_SAME_LEASE"],
    ["changed Task inherits nothing",true,()=>leaseDecision({lease,request:{...req,task_id:"T006"}}).decision==="NEW_HUMAN_AUTHORIZATION_REQUIRED"],
    ["revoked lease inherits nothing",true,()=>leaseDecision({lease:{...lease,status:"REVOKED"},request:req}).decision==="NEW_HUMAN_AUTHORIZATION_REQUIRED"],
    ["widened scope inherits nothing",true,()=>leaseDecision({lease,request:{...req,scope_digest:"wider"}}).decision==="NEW_HUMAN_AUTHORIZATION_REQUIRED"],
    ["governance change outside lease",true,()=>leaseDecision({lease,request:{...req,change_class:"GOVERNANCE"}}).decision==="SEPARATE_AUTHORITY_REQUIRED"]
  ],fn=>fn());
}

function impactedCases(cfg){
  const plan=changed=>selectImpactedTests(changed,cfg);
  return expectCases("impacted tests",[
    ["runtime change selects runtime family + types",true,()=>{const p=plan(["src/platform/runtime/x.ts"]);return p.mode==="IMPACTED" && p.scripts.includes("test:runtime") && p.scripts.includes("check:types") && p.not_run.includes("test:e2e");}],
    ["UI change selects browser families",true,()=>plan(["src/app/shell/App.tsx"]).scripts.includes("test:e2e")],
    ["governance-only diff is gate-only",true,()=>plan(["harness/scripts/x.mjs","delivery/GOV.md"]).mode==="GATE_ONLY"],
    ["dependency change falls back to full",true,()=>plan(["package.json"]).mode==="FULL_FALLBACK"],
    ["unmapped source falls back to full",true,()=>plan(["src/platform/identity/x.ts"]).mode==="FULL_FALLBACK"],
    ["test family change runs that family",true,()=>{const p=plan(["tests/api/x.test.ts"]);return p.scripts.includes("test:api") && !p.scripts.includes("test:e2e");}],
    ["no diff runs nothing and claims nothing",true,()=>plan([]).mode==="NO_CHANGE"]
  ],fn=>fn());
}

function ledgerCases(levels){
  const task={task_id:"T001",build_spec_id:"BS-1",acceptance_links:[{acceptance_id:"A1",test_id:"T1"}],completion_evidence:["E1","E2"]};
  const e=(id,patch)=>({evidence_id:id,sprint_id:"SP",task_id:"T001",build_spec_id:"BS-1",source_commit:"c".repeat(40),blocking_findings:[],acceptance_ids:[],test_ids:[],...patch});
  const full=[e("E1",{kind:"TEST_RESULT",status:"PASS",acceptance_ids:["A1"],test_ids:["T1"],proof_level:"REAL_POSTGRES"}),
    e("E2",{kind:"COMMAND_RESULT",status:"PASS",command:"npm run gate"}),e("E3",{kind:"REVIEW",status:"PASS"})];
  const run=(list,anc=()=>true)=>buildEvidenceLedger({task,sprintId:"SP",evidenceList:list,requiredCommands:new Set(["npm run gate"]),isAncestor:anc,proofLevels:levels});
  return expectCases("evidence ledger",[
    ["complete evidence is closure-ready",true,()=>run(full).evidence_readiness==="EVIDENCE_COMPLETE_FOR_CLOSURE_CONTROL"],
    ["unreferenced review detected",true,()=>run(full).unreferenced.includes("E3")],
    ["FAIL test result never counts",true,()=>run([{...full[0],status:"FAIL"},full[1],full[2]]).missing_pairs.length===1],
    ["duplicate collapsed and reported",true,()=>{const l=run([...full,e("E4",{...full[1],evidence_id:"E4"})]);return l.duplicates.length===1 && !l.suggested_completion_evidence.includes("E4");}],
    ["stale source commit excluded",true,()=>run(full,sha=>sha!=="c".repeat(40)).evidence_readiness==="NOT_READY"],
    ["unlabelled proof level stays UNCLASSIFIED",true,()=>run([{...full[0],proof_level:undefined},full[1],full[2]]).proof_levels.UNCLASSIFIED===1]
  ],fn=>fn());
}

function normalizationCases(){
  const task={task_id:"T009",status:"REVIEW",build_spec_id:"BS-P1-025",
    acceptance_links:[{acceptance_id:"F01-AC-013",test_id:"TEST-F01-API-001"}],
    completion_evidence:["EV-SP-P1-003-T009-001"]};
  const e=(id,kind,status)=>({evidence_id:id,schema_version:2,
    kind,status,sprint_id:"SP-P1-003",task_id:"T009",build_spec_id:"BS-P1-025",
    source_commit:"a".repeat(40),acceptance_ids:kind==="TEST_RESULT"?["F01-AC-013"]:[],
    test_ids:kind==="TEST_RESULT"?["TEST-F01-API-001"]:[]});
  const a=e("EV-SP-P1-003-T009-001","TEST_RESULT","PASS");
  const b=e("EV-SP-P1-003-T009-002","COMMAND_RESULT","FAIL");
  const ledger={task_id:"T009",sprint_id:"SP-P1-003",
    suggested_completion_evidence:[a.evidence_id,b.evidence_id],
    duplicates:[],stale:[],dangling_refs:[]};
  const run=(f=x=>x)=>{const x=clone({task,ledger,existingEvidence:[a,b]});
    f(x);return planTaskEvidenceReferences({...x,sprintId:"SP-P1-003"});};
  return expectCases("canonical normalization",[
    ["append real Evidence reference, including honest FAIL status",true,()=>{const x=run();return x.ok&&x.changed&&x.add.length===1&&x.completion_evidence[1]===b.evidence_id;}],
    ["idempotent no repeat",true,()=>run(x=>{x.task.completion_evidence.push(b.evidence_id);}).changed===false],
    ["no status update is returned",true,()=>!Object.hasOwn(run(),"task_status")],
    ["noncanonical missing document fails",true,()=>!run(x=>{x.existingEvidence.pop();}).ok],
    ["unknown AC/Test forged fails",true,()=>!run(x=>{x.existingEvidence[0].test_ids=["FAKE"];}).ok],
    ["FAIL evidence stays FAIL",true,()=>!run(x=>{x.existingEvidence[1].status="UNTESTED";}).ok],
    ["duplicates refused",true,()=>!run(x=>{x.ledger.duplicates=[["x","y"]];}).ok],
    ["stale source refused",true,()=>!run(x=>{x.ledger.stale=[a.evidence_id];}).ok],
    ["dangling prior ref refused",true,()=>!run(x=>{x.ledger.dangling_refs=["missing"];}).ok],
    ["wrong Sprint rejected",true,()=>!run(x=>{x.existingEvidence[0].sprint_id="SP-P1-004";}).ok],
    ["wrong Build rejected",true,()=>!run(x=>{x.existingEvidence[1].build_spec_id="BS-P1-026";}).ok],
    ["CLOSED Task immutable",true,()=>!run(x=>{x.task.status="CLOSED";}).ok],
    ["BLOCKED Task cannot normalize",true,()=>!run(x=>{x.task.status="BLOCKED";}).ok],
    ["missing ledger is hard-stop",true,()=>!run(x=>{x.ledger={};}).ok],
    ["previous references preserved",true,()=>run().completion_evidence[0]===a.evidence_id],
  ],fn=>fn());
}

function closurePlanningCases(){
  const mk=()=>({
    task:{task_id:"T009",status:"REVIEW",build_spec_id:"BS-P1-025"},
    sprint:{active_sprint:"SP-P1-003",active_task:"T009",
      active_build_spec:"BS-P1-025",status:"REVIEW"},
    build:{active_baseline:"BS-P1-025",implementation_enabled:true},
    ledger:{task_id:"T009",sprint_id:"SP-P1-003",
      evidence_readiness:"EVIDENCE_COMPLETE_FOR_CLOSURE_CONTROL",missing_review:false,
      missing_pairs:[],missing_commands:[],duplicates:[],stale:[],dangling_refs:[],unreferenced:[]},
    grant:{ok:true,decision:"VERIFIED_GITHUB_HUMAN_APPROVAL",
      phase:"POST_MERGE_CLOSURE",mergedOnMain:true,current_head:"a".repeat(40)},
    pr:{state:"closed",merged:true,head:{sha:"a".repeat(40)},merge_commit_sha:"b".repeat(40)}
  });
  const check=mutate=>{const x=mk();mutate(x);return planTaskClosureReadiness(x);};
  return expectCases("postmerge protected closure preflight",[
    ["Synthetic eligible remains only a proposal",true,()=>{
      const r=check(()=>{});return r.ok&&!r.closure_performed&&!r.mutates;}],
    ["Unmerged PR rejected",false,()=>check(x=>{x.pr.merged=false;}).ok],
    ["Fake grant rejected",false,()=>check(x=>{x.grant.ok=false;}).ok],
    ["Wrong grant phase rejected",false,()=>check(x=>{x.grant.phase="ACTIVE_PR";}).ok],
    ["Main merge ancestry missing",false,()=>check(x=>{x.grant.mergedOnMain=false;}).ok],
    ["Grant to different HEAD",false,()=>check(x=>{x.grant.current_head="c".repeat(40);}).ok],
    ["Task not REVIEW",false,()=>check(x=>{x.task.status="BLOCKED";}).ok],
    ["Sprint mismatched",false,()=>check(x=>{x.sprint.active_task="T006";}).ok],
    ["Build mismatch",false,()=>check(x=>{x.build.active_baseline="BS-P1-026";}).ok],
    ["Missing mapped acceptance",false,()=>check(x=>{x.ledger.missing_pairs=["A1::T1"];}).ok],
    ["Missing command PASS",false,()=>check(x=>{x.ledger.missing_commands=["npm run gate"];}).ok],
    ["Missing review PASS",false,()=>check(x=>{x.ledger.missing_review=true;}).ok],
    ["Unreferenced Evidence",false,()=>check(x=>{x.ledger.unreferenced=["EV-001"];}).ok],
    ["Duplicate Evidence",false,()=>check(x=>{x.ledger.duplicates=[["EV1","EV2"]];}).ok],
    ["Stale Evidence",false,()=>check(x=>{x.ledger.stale=["EV-OLD"];}).ok],
    ["T008 closure requires Human L3",false,()=>check(x=>{x.task.task_id="T008";x.sprint.active_task="T008";x.ledger.task_id="T008";}).ok],
    ["T006 closure requires Human L3",false,()=>check(x=>{x.task.task_id="T006";x.sprint.active_task="T006";x.ledger.task_id="T006";}).ok]
  ],f=>f());
}

function protectedClosureWriterCases(){
  const mk=()=>{
    const task={task_id:"T009",status:"REVIEW",build_spec_id:"BS-P1-025",
      acceptance_links:[{acceptance_id:"A1",test_id:"T1"}],
      completion_evidence:["EV-SP-P1-003-T009-001"]};
    const other={task_id:"T007",status:"CLOSED",completion_evidence:[]};
    return {plan:{ok:true,decision:"ELIGIBLE_FOR_SEPARATE_PROTECTED_CONTROL_REVIEW",
      task_id:"T009",sprint_id:"SP-P1-003"},
    taskId:"T009",mainDoc:{sprint_id:"SP-P1-003",tasks:[task,other]},
    controlDoc:{sprint_id:"SP-P1-003",tasks:[{...task,status:"REVIEW"},other]}};
  };
  const run=fn=>{const x=clone(mk());fn(x);return planProtectedClosureMutation(x);};
  return expectCases("protected closure control writer",[
    ["writes only a proposed CLOSED status",true,()=>{
      const r=run(()=>{});return r.ok&&r.changed&&!r.closure_performed&&
        r.updated.tasks[0].status==="CLOSED"&&r.updated.tasks[1].status==="CLOSED";}],
    ["idempotent existing proposal",true,()=>!run(x=>{x.controlDoc.tasks[0].status="CLOSED";}).changed],
    ["fail when closure preflight invalid",false,()=>run(x=>{x.plan.ok=false;}).ok],
    ["wrong Task requested",false,()=>run(x=>{x.taskId="T006";}).ok],
    ["wrong Sprint requested",false,()=>run(x=>{x.controlDoc.sprint_id="SP-P1-004";}).ok],
    ["Main Task must be REVIEW",false,()=>run(x=>{x.mainDoc.tasks[0].status="BLOCKED";}).ok],
    ["Task missing from control",false,()=>run(x=>{x.controlDoc.tasks.pop();}).ok],
    ["duplicate Task IDs",false,()=>run(x=>{x.controlDoc.tasks[1].task_id="T009";}).ok],
    ["AC mutation rejected",false,()=>run(x=>{x.controlDoc.tasks[0].acceptance_links=[];}).ok],
    ["Evidence mutation rejected",false,()=>run(x=>{x.controlDoc.tasks[0].completion_evidence=[];}).ok],
    ["Other Task mutation rejected",false,()=>run(x=>{x.controlDoc.tasks[1].status="BLOCKED";}).ok],
    ["Task definition mutation rejected",false,()=>run(x=>{x.controlDoc.tasks[0].build_spec_id="BS-P1-026";}).ok],
    ["Root metadata mutation rejected",false,()=>run(x=>{x.controlDoc.schema_version=999;}).ok],
    ["Unexpected status transition rejected",false,()=>run(x=>{x.controlDoc.tasks[0].status="VERIFIED";}).ok],
    ["Unapproved closure status proposal forbidden",false,()=>run(x=>{x.plan.decision="HARD_STOP";}).ok]
  ],fn=>fn());
}

function protectedControlProvenanceCases(){
  const mk=()=>({
    source:{number:101,state:"closed",merged:true,
      merged_at:"2026-10-16T03:00:00Z",head:{ref:"task/t009"},
      body:"Task: T009\nTask-Grant-Run: 12345"},
    control:{number:102,state:"open",draft:true,
      created_at:"2026-10-16T03:00:01Z",
      base:{ref:"main",repo:{full_name:"NFF98/appf2-build"}},
      head:{ref:"control/t009",sha:"c".repeat(40),
        repo:{full_name:"NFF98/appf2-build"}},
      body:"Task: T009\nTask-Grant-Run: 12345\nClosure-Source-PR: 101\n"+
        "PR-Justification: CONTROL_TRANSITION_AFTER_MERGE 正式 Evidence 後的 Task Closure"}
  });
  const run=f=>{const x=mk();f(x);return inspectProtectedControlPrProvenance(
    x.source,x.control,"T009");};
  return expectCases("one grant; postmerge PR justified",[
    ["valid same-task control exception",true,()=>run(()=>{})],
    ["unmerged source refused",false,()=>run(x=>{x.source.merged=false;})],
    ["still open source refused",false,()=>run(x=>{x.source.state="open";})],
    ["same PR number refused",false,()=>run(x=>{x.control.number=101;})],
    ["control before source merge refused",false,()=>run(x=>{x.control.created_at="2026-10-16T02:59:59Z";})],
    ["bad control created_at refused",false,()=>run(x=>{x.control.created_at="not-a-date";})],
    ["missing source merged_at refused",false,()=>run(x=>{x.source.merged_at=null;})],
    ["reused task implementation branch refused",false,()=>run(x=>{x.control.head.ref="task/t009";})],
    ["missing justification refused",false,()=>run(x=>{x.control.body=x.control.body.replace(/PR-Justification:.+/,"");})],
    ["missing original grant refused",false,()=>run(x=>{x.source.body="Task: T009";})],
    ["missing control grant refused",false,()=>run(x=>{x.control.body=x.control.body.replace(/Task-Grant-Run:.+\n/,"");})],
    ["substituted control grant refused",false,()=>run(x=>{x.control.body=x.control.body.replace("Task-Grant-Run: 12345","Task-Grant-Run: 54321");})],
    ["wrong justification lane refused",false,()=>run(x=>{x.control.body=x.control.body.replace("CONTROL_TRANSITION_AFTER_MERGE","HOTFIX");})],
    ["empty justification rationale refused",false,()=>run(x=>{x.control.body=x.control.body.replace(/PR-Justification:.+/,"PR-Justification: CONTROL_TRANSITION_AFTER_MERGE ");})],
    ["wrong Task refused",false,()=>run(x=>{x.control.body=x.control.body.replace("Task: T009","Task: T008");})],
    ["wrong closure source refused",false,()=>run(x=>{x.control.body=x.control.body.replace("Closure-Source-PR: 101","Closure-Source-PR: 999");})],
    ["control fork refused",false,()=>run(x=>{x.control.head.repo.full_name="attacker/appf2-build";})],
    ["not a draft control refused",false,()=>run(x=>{x.control.draft=false;})],
    ["control points outside Main refused",false,()=>run(x=>{x.control.base.ref="unsafe";})]
  ],fn=>fn());
}

function metricsPreflightCases(guard){
  const validJob={id:115,name:"ci",status:"completed",conclusion:"success",attempt:1};
  const validRun={id:101,name:"CI Gate",event:"pull_request",headSha:"a".repeat(40),
    headBranch:"gov/389-16p-3-9-fix",runAttempt:1,jobs:[validJob]};
  const partialInput={complete:false,window_start:"2026-10-10",
    sample:{strategy:"newest",listed:1156,enriched:1,truncated:true},runs:[validRun]};
  const partialReal=fullCiRuns(partialInput);
  const legacyLiar=fullCiRuns({...partialInput,complete:true});
  const completeReal=fullCiRuns({...partialInput,complete:true,
    sample:{strategy:"newest",listed:1,enriched:1,truncated:false}});
  const invalidSample=fullCiRuns({...partialInput,sample:{...partialInput.sample,enriched:3}});
  const m=computeGovernanceMetrics({
    commits:[{subject:"T008 impl (#386)"},{subject:"T008 evidence (#387)"},{subject:"fix T008 typo (#388)"},{subject:"T007 close (#380)"}],
    runs:[{name:"CI Gate",event:"pull_request",headSha:"h1",headBranch:"b"},{name:"CI Gate",event:"pull_request",headSha:"h1",headBranch:"b"},{name:"Governance Gate",event:"pull_request",headSha:"h1",headBranch:"b"}],
    dockets:[{human_approval:{decision:"APPROVE_EXACT_CANDIDATE"},previous_approval_history:[{},{}]}],openPrs:[{isDraft:true}]
  });
  const open=[{number:386,title:"T008：impl",body:""},{number:390,title:"gov",body:"Task: T009"}];
  const build={active_baseline:"BS-P1-025",implementation_enabled:true};
  const sprint={active_sprint:"SP-P1-003",active_build_spec:"BS-P1-025",active_task:"T008",status:"REVIEW"};
  const tasks=[{task_id:"T008",status:"REVIEW",build_spec_id:"BS-P1-025"},{task_id:"T006",status:"BLOCKED",build_spec_id:"BS-P1-025"}];
  const pf=(intent,taskId)=>preflight({build,sprint,tasks,openPrs:open,guard,intent,taskId}).decision;
  return expectCases("metrics/preflight/pr-guard",[
    ["Task-PR ratio measured",true,()=>m.task_pr.by_task.find(x=>x.task==="T008").prs===3],
    ["re-approvals counted",true,()=>m.human_approval.redundant_reapprovals===2],
    ["repeated full CI on same HEAD counted",true,()=>m.ci.repeated_full_runs_same_head===1],
    ["sample from real job shape is never complete",true,()=>partialReal.status==="INCOMPLETE_SAMPLED"&&
      partialReal.full_ci_runs===null&&partialReal.ready_ci_executed===null&&
      partialReal.sample_counts.ready_ci_executed===1&&partialReal.sample.truncated===true],
    ["legacy complete:true cannot disguise truncated sampling",true,()=>legacyLiar.status==="INCOMPLETE_SAMPLED"&&
      legacyLiar.source_complete_claim_invalid===true&&legacyLiar.full_ci_runs===null],
    ["genuinely full sample can be measured",true,()=>completeReal.status==="MEASURED_NO_PRE_POST_BASELINE"&&
      completeReal.full_ci_runs===1&&completeReal.ready_ci_executed===1],
    ["invalid sample metadata hard stops",true,()=>invalidSample.status==="INCOMPLETE"],
    ["rework commits counted",true,()=>m.rework.task_rework_commits===1],
    ["title Task key extracted",true,()=>taskKeyOfPr(open[0],guard)==="T008"],
    ["duplicate Task PR must reuse",true,()=>prCreationDecision({taskKey:"T008",openPrs:open,guard}).decision==="REUSE_EXISTING_PR"],
    ["justified new PR allowed",true,()=>prCreationDecision({taskKey:"T008",openPrs:open,guard,justified:hasPrJustification({body:"PR-Justification: CONTROL_TRANSITION_AFTER_MERGE closure after #386"},guard)}).decision==="NEW_PR_ALLOWED_WITH_JUSTIFICATION"],
    ["bare justification keyword rejected",false,()=>hasPrJustification({body:"PR-Justification: HOTFIX"},guard)],
    ["own PR excluded from duplicates",true,()=>prCreationDecision({taskKey:"T009",openPrs:open,guard,selfNumber:390}).decision==="NEW_PR_ALLOWED_PENDING_HUMAN_AUTHORITY"],
    ["unidentified PR denied",true,()=>prCreationDecision({taskKey:null,openPrs:open,guard}).decision==="BLOCKED_MISSING_TASK_OR_GOVERNANCE_CASE"],
    ["unverified PR inventory denied",true,()=>prCreationDecision({taskKey:"T008",openPrs:null,guard}).decision==="BLOCKED_NO_LIVE_PR_INVENTORY"],
    ["governance docket recognized",true,()=>governanceCaseOfPr({body:"Governance-Case: GOV-REFORM-20261013-001"})==="GOV-REFORM-20261013-001"],
    ["English-only Human PR explanation fails language guard",false,()=>hasHumanFacingChinese({title:"fix title",body:"Some English only"})],
    ["Human PR contains Chinese explanation",true,()=>hasHumanFacingChinese({title:"修復：檢查流程",body:"Governance-Case: GOV-REFORM-20261013-001"})],
    ["duplicate governance docket PR denied",true,()=>prCreationDecision({openPrs:[{number:89,body:"Governance-Case: GOV-REFORM-20261013-001"}],
      taskKey:null,governanceCase:"GOV-REFORM-20261013-001",guard}).decision==="REUSE_EXISTING_PR"],
    ["unknown product Task new PR denied",true,()=>preflight({build,sprint,tasks,openPrs:[],guard,intent:"NEW_PR",taskId:"T099"}).decision==="STOP"],
    ["CLOSED Task new PR denied",true,()=>preflight({build,sprint,tasks:[{...tasks[0],status:"CLOSED"},tasks[1]],openPrs:[],guard,intent:"NEW_PR",taskId:"T008"}).decision==="STOP"],
    ["redundant Activation denied",true,()=>pf("REQUEST_ACTIVATION","T008")==="REDUNDANT_ACTIVATION_DENIED"],
    ["redundant approval denied",true,()=>pf("REQUEST_APPROVAL","T008")==="REDUNDANT_APPROVAL_DENIED"],
    ["unneeded Rebind denied",true,()=>pf("REQUEST_REBIND","T008")==="REBIND_NOT_REQUIRED"],
    ["BLOCKED Task cannot continue",true,()=>pf("CONTINUE_TASK_WORK","T006")==="STOP"],
    ["REVIEW Task fix continues same lease",true,()=>pf("CONTINUE_TASK_WORK","T008")==="CONTINUE_SAME_LEASE"],
    ["missing PR inventory fails closed",true,()=>preflight({build,sprint,tasks,openPrs:null,guard,intent:"NEW_PR",taskId:"T008"}).decision==="BLOCKED_NO_LIVE_PR_INVENTORY"],
    ["CLOSED active Task cannot continue",true,()=>preflight({build,sprint,tasks:[{...tasks[0],status:"CLOSED"},tasks[1]],openPrs:open,guard,intent:"CONTINUE_TASK_WORK",taskId:"T008"}).decision==="STOP"],
    ["Task Build mismatch cannot continue",true,()=>preflight({build,sprint,tasks:[{...tasks[0],build_spec_id:"BS-P1-026"},tasks[1]],openPrs:open,guard,intent:"CONTINUE_TASK_WORK",taskId:"T008"}).decision==="STOP"],
    ["Sprint binding mismatch cannot continue",true,()=>preflight({build,sprint:{...sprint,active_build_spec:"BS-P1-026"},tasks,openPrs:open,guard,intent:"CONTINUE_TASK_WORK",taskId:"T008"}).decision==="STOP"]
  ],fn=>fn());
}

export function runGovernanceReformSelfTests(root=process.cwd()){
  const policy=JSON.parse(fs.readFileSync(path.join(root,GOVERNANCE_REFORM_POLICY_PATH),"utf8"));
  const repoPolicy=JSON.parse(fs.readFileSync(path.join(root,"harness/policy/repo-policy.json"),"utf8"));
  const counts={
    human_exception:expectCases("human exception",[...governanceLaneCases(policy),...ssotClosureHotfixCases(policy),...sixteenPAcceptanceLeaseCases(policy)],ok),
    persistent_waiver:persistentWaiverCases(policy),
    build_spec_activation:buildSpecActivationCases(policy),
    policy_invariants:policyInvariantCases(policy),
    lifecycle:lifecycleCases(),
    final_gate:finalGateCases(),
    routing:routingCases(repoPolicy),
    authority:authorityCases(),
    impacted_tests:impactedCases(policy.impacted_tests),
    evidence_ledger:ledgerCases(policy.evidence_proof_levels),
    evidence_normalization:normalizationCases(),
    protected_closure:closurePlanningCases(),
    protected_closure_writer:protectedClosureWriterCases(),
    protected_control_provenance:protectedControlProvenanceCases(),
    metrics_preflight:metricsPreflightCases(policy.pr_guard)
  };
  return {counts,total:Object.values(counts).reduce((a,n)=>a+n,0)};
}
