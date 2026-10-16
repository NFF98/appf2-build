import { evaluateTaskConditionalApproval as evaluate } from "./conditional-task-approval.mjs";
import { advance, onNewHead,delegatedPremergePolicy } from "./task-pr-lifecycle.mjs";
const BASE="a".repeat(40),HEAD="b".repeat(40),DIGEST="c".repeat(64),NOW=1792000000;
const contexts=["ci","attack","governance","Analyze JavaScript / TypeScript"];
const make=()=>{
  const grant={schema:"APPF2-TASK-ONE-APPROVAL-1",change_class:"L1_TASK",
    actions:["MARK_FINAL_READY","APPROVE_MERGE","RECORD_MERGE","APPROVE_CLOSURE"],
    task_id:"T001",sprint_id:"SP-P1-003",build_spec_id:"BS-P1-025",
    scope_sha256:DIGEST,base_sha:BASE,approved_at_unix:NOW-3600,expires_at_unix:NOW+86400,
    human:{approver:"NFF98",source_kind:"DIRECT_HUMAN_MESSAGE",
      decision:"AUTHORIZE_TASK_CONDITIONAL_EXECUTION",human_message_ref:"chat://human-direct-001"}};
  const context={change_class:"L1_TASK",task_id:"T001",sprint_id:"SP-P1-003",
    build_spec_id:"BS-P1-025",scope_sha256:DIGEST,base_sha:BASE,now:NOW,
    provenance_checked_by_trusted_executor:true,authority_revoked:false,scope_changed:false,
    head_sha:HEAD,checks:contexts.map(name=>({name,head_sha:HEAD,
      status:"completed",conclusion:"success",mode:"FULL"})),
    bce:{verdict:"PASS",head_sha:HEAD,independent:true},
    mapped_ac_tests:[{id:"AC1",status:"PASS"}],scope_gate:{verdict:"PASS"},
    evidence_gate:{verdict:"PASS"},product_truth_changed:false,security_exception:false,
    sprint_status:"REVIEW",task_status:"REVIEW",branch_protection_pass:true,
    pr:{state:"open",draft:false,base_ref:"main",head_sha:HEAD,
      mergeable:true,merged:false,merge_commit_sha:null},
    closure:{verdict:"PASS",head_sha:HEAD,no_unmapped_gaps:true,carry_forward_verified:true},
    canonical_main_contains_merge:false};
  return {grant,context};
};
export function runConditionalApprovalSelfTests(){
  const tests=[
    ["single grant reaches Ready", "MARK_FINAL_READY",true,()=>{}],
    ["single grant reaches Merge eligibility","APPROVE_MERGE",true,()=>{}],
    ["missing independent Human-origin verification","APPROVE_MERGE",false,x=>{x.context.provenance_checked_by_trusted_executor=false;}],
    ["AI fake Human source","APPROVE_MERGE",false,x=>{x.grant.human.source_kind="AI_GENERATED_COMMENT";}],
    ["revoked grant","APPROVE_MERGE",false,x=>{x.context.authority_revoked=true;}],
    ["expired grant","APPROVE_MERGE",false,x=>{x.context.now=NOW+86401;}],
    ["overlong grant","APPROVE_MERGE",false,x=>{x.grant.expires_at_unix=NOW+31*86400;}],
    ["wrong Task","APPROVE_MERGE",false,x=>{x.context.task_id="T002";}],
    ["wrong Sprint","APPROVE_MERGE",false,x=>{x.context.sprint_id="SP-P1-004";}],
    ["wrong baseline","APPROVE_MERGE",false,x=>{x.context.build_spec_id="BS-P1-026";}],
    ["changed allowed scope","APPROVE_MERGE",false,x=>{x.context.scope_sha256="e".repeat(64);}],
    ["base drift","APPROVE_MERGE",false,x=>{x.context.base_sha="f".repeat(40);}],
    ["L3 governance change","APPROVE_MERGE",false,x=>{x.context.change_class="L3_GOVERNANCE";}],
    ["scope exception","APPROVE_MERGE",false,x=>{x.context.security_exception=true;}],
    ["Product truth change","APPROVE_MERGE",false,x=>{x.context.product_truth_changed=true;}],
    ["one required Gate fails","APPROVE_MERGE",false,x=>{x.context.checks[1].conclusion="failure";}],
    ["one check skipped","APPROVE_MERGE",false,x=>{x.context.checks[2].conclusion="skipped";}],
    ["fast-loop cannot substitute FULL","APPROVE_MERGE",false,x=>{x.context.checks[0].mode="FAST_LOOP";}],
    ["stale CI head","APPROVE_MERGE",false,x=>{x.context.checks[0].head_sha="d".repeat(40);}],
    ["BCE on old HEAD","APPROVE_MERGE",false,x=>{x.context.bce.head_sha="d".repeat(40);}],
    ["BCE non-independent","APPROVE_MERGE",false,x=>{x.context.bce.independent=false;}],
    ["mapped AC NOT_RUN","APPROVE_MERGE",false,x=>{x.context.mapped_ac_tests[0].status="NOT_RUN";}],
    ["mapped AC BLOCKED","APPROVE_MERGE",false,x=>{x.context.mapped_ac_tests[0].blocked=true;}],
    ["scope gate fails","APPROVE_MERGE",false,x=>{x.context.scope_gate.verdict="FAIL";}],
    ["evidence gate fails","APPROVE_MERGE",false,x=>{x.context.evidence_gate.verdict="FAIL";}],
    ["Draft PR","APPROVE_MERGE",false,x=>{x.context.pr.draft=true;}],
    ["closed PR","APPROVE_MERGE",false,x=>{x.context.pr.state="closed";}],
    ["GitHub protection failed","APPROVE_MERGE",false,x=>{x.context.branch_protection_pass=false;}],
    ["BLOCKED Task","APPROVE_MERGE",false,x=>{x.context.task_status="BLOCKED";}],
    ["Task already CLOSED","APPROVE_MERGE",false,x=>{x.context.task_status="CLOSED";}],
    ["no automatic new Sprint","APPROVE_MERGE",false,x=>{x.context.sprint_status="CLOSED";}],
    ["record merge before merge", "RECORD_MERGE",false,()=>{}],
    ["record verified merge","RECORD_MERGE",true,x=>{x.context.pr.merged=true;x.context.pr.merge_commit_sha="d".repeat(40);x.context.canonical_main_contains_merge=true;}],
    ["closure before merge","APPROVE_CLOSURE",false,()=>{}],
    ["closure only after merge","APPROVE_CLOSURE",true,x=>{x.context.pr.merged=true;x.context.pr.merge_commit_sha="d".repeat(40);x.context.canonical_main_contains_merge=true;}],
    ["closure missing carry-forward proof","APPROVE_CLOSURE",false,x=>{x.context.pr.merged=true;x.context.pr.merge_commit_sha="d".repeat(40);x.context.canonical_main_contains_merge=true;x.context.closure.carry_forward_verified=false;}],
    ["closure lacks canonical Main ancestry","APPROVE_CLOSURE",false,x=>{x.context.pr.merged=true;x.context.pr.merge_commit_sha="d".repeat(40);}],
    ["unknown extra authority action","START_NEXT_SPRINT",false,()=>{}],
    ["unapproved action list","APPROVE_MERGE",false,x=>{x.grant.actions.push("DEPLOY");}],
  ];
  for(const [label,action,expected,change] of tests){
    const fixture=make();change(fixture);
    const got=evaluate({grant:fixture.grant,action,context:fixture.context});
    if(got.ok!==expected)throw Error("ONE APPROVAL SELFTEST "+label+": "+got.decision+" "+got.errors.join(";"));
  }
  // Real executor policy: synthetic eligibility tests NEVER write/approve on GitHub.
  const livePr={number:17,state:"open",draft:false,
    base:{ref:"main",sha:BASE,repo:{full_name:"NFF98/appf2-build"}},
    head:{sha:HEAD,repo:{full_name:"NFF98/appf2-build"}},mergeable:true};
  const liveGrant={ok:true,decision:"VERIFIED_GITHUB_HUMAN_APPROVAL",
    source_head:BASE,base_sha:BASE,base_ancestor:true,
    current_head:HEAD,task_id:"T001"};
  const task={task_id:"T001",status:"REVIEW",build_spec_id:"BS-P1-025",allowed_write_paths:["src/"]};
  const sprint={active_sprint:"SP-P1-003",active_task:"T001",
    active_build_spec:"BS-P1-025",status:"REVIEW"};
  const build={active_baseline:"BS-P1-025",implementation_enabled:true};
  const valid={pr:livePr,grant:liveGrant,task,sprint,build,localHead:HEAD,
    readiness:{ok:true,head:HEAD},changedPaths:[{filename:"src/app.ts"}]};
  if(!delegatedPremergePolicy(valid).ok)
    throw Error("trusted premerge policy positive rejected");
  // A verified Main advance does NOT require another Task Human approval.
  const advanced=JSON.parse(JSON.stringify(valid));
  advanced.pr.base.sha="e".repeat(40);
  advanced.grant.base_sha=advanced.pr.base.sha;
  if(!delegatedPremergePolicy(advanced).ok)
    throw Error("verified Main fast-forward rejected without scope change");
  let negativeDelegates=0;
  const denyPremerge=mutation=>{
    const x=JSON.parse(JSON.stringify(valid));mutation(x);
    if(delegatedPremergePolicy(x).ok)throw Error("forged delegated premerge admitted");
    negativeDelegates++;
  };
  denyPremerge(x=>{x.grant.ok=false;});
  denyPremerge(x=>{x.grant.source_head="not-a-sha";});
  denyPremerge(x=>{x.grant.base_sha="f".repeat(40);});
  denyPremerge(x=>{x.grant.base_ancestor=false;});
  denyPremerge(x=>{x.grant.current_head="f".repeat(40);});
  denyPremerge(x=>{x.pr.draft=true;});
  denyPremerge(x=>{x.pr.mergeable=false;});
  denyPremerge(x=>{x.pr.base.repo.full_name="attacker/repo";});
  denyPremerge(x=>{x.pr.head.repo.full_name="attacker/repo";});
  denyPremerge(x=>{x.pr.head.sha="f".repeat(40);});
  denyPremerge(x=>{x.task.status="BLOCKED";});
  denyPremerge(x=>{x.changedPaths=[{filename:"src/app.ts"},{filename:"src2/bypass.ts"}];});
  denyPremerge(x=>{x.changedPaths=[];});
  denyPremerge(x=>{x.sprint.active_task="T008";});
  denyPremerge(x=>{x.build.implementation_enabled=false;});
  denyPremerge(x=>{x.readiness.ok=false;});
  denyPremerge(x=>{x.readiness.head="f".repeat(40);});

  // Previous "positive" delegation checks accepted a Boolean pretending to authenticate
  // Human. They were fake proof. Until a separate independent verifier is connected,
  // even seemingly complete inputs must NOT move Human-only lifecycle states.
  const c=make();
  const record={state:"GPT_BCE_PASS",head:HEAD,task_id:c.grant.task_id,
    sprint_id:c.grant.sprint_id,build_spec_id:c.grant.build_spec_id,scope_sha256:DIGEST};
  const evidence={bce_head:HEAD,approved_head:HEAD,
    final_gate:{verdict:"PASS"},mapped_tests:[{id:"AC1",status:"PASS"}]};
  const act=(r,to,actor,context=c.context)=>
    advance(r,{to,actor,head:HEAD,evidence,
      conditional_grant:c.grant,conditional_context:context});
  const denied=act(record,"HUMAN_FINAL_INTEGRATION_READY","GPT_DELEGATED");
  if(denied.ok || !denied.errors.some(e=>e.includes("TRUSTED_HUMAN_APPROVAL_VERIFIER_NOT_CONNECTED")))
    throw Error("caller-supplied true Boolean granted fake Human authority");
  const human=act(record,"HUMAN_FINAL_INTEGRATION_READY","HUMAN");
  if(!human.ok)throw Error("legitimate Human workflow regressed");
  const gates=act(human.record,"EXACT_HEAD_FULL_GATES_PASS","CI");
  if(!gates.ok)throw Error("actual CI gate transition regressed");
  if(act(gates.record,"HUMAN_MERGE_APPROVED","GPT_DELEGATED").ok)
    throw Error("AI masqueraded as Human merge approver");
  const authorized=act(gates.record,"HUMAN_MERGE_APPROVED","HUMAN");
  if(!authorized.ok)throw Error("legitimate Human merge approval regressed");
  if(act(authorized.record,"MERGED","GPT_DELEGATED").ok)
    throw Error("AI masqueraded as verified Human merge");
  if(act({...record,state:"MERGED"},"EVIDENCE_AND_CLOSURE","GPT_DELEGATED").ok)
    throw Error("AI masqueraded as Human closure approver");
  if(onNewHead(human.record,"f".repeat(40)).record.state!=="DRAFT_DEVELOPMENT")
    throw Error("HEAD change failed to invalidate readiness");
  return tests.length+7+1+negativeDelegates;
}
if(process.argv[1]?.endsWith("/conditional-task-approval-selftest.mjs"))
  console.log("ONE APPROVAL: "+runConditionalApprovalSelfTests()+" PASS (synthetic; live-only executor path NOT a Human approval)");
