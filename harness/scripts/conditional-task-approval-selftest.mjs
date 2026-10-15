import { evaluateTaskConditionalApproval as evaluate } from "./conditional-task-approval.mjs";
import { advance, onNewHead } from "./task-pr-lifecycle.mjs";
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
  const c=make();
  const record={state:"GPT_BCE_PASS",head:HEAD,task_id:c.grant.task_id,
    sprint_id:c.grant.sprint_id,build_spec_id:c.grant.build_spec_id,scope_sha256:DIGEST};
  const evidence={bce_head:HEAD,approved_head:HEAD,
    final_gate:{verdict:"PASS"},mapped_tests:[{id:"AC1",status:"PASS"}]};
  const act=(r,to,actor,context=c.context,grant=c.grant)=>
    advance(r,{to,actor,head:HEAD,evidence,conditional_grant:grant,conditional_context:context});
  const first=act(record,"HUMAN_FINAL_INTEGRATION_READY","GPT_DELEGATED");
  if(!first.ok)throw Error("lifecycle should permit bounded Final Ready: "+first.errors);
  const gates=act(first.record,"EXACT_HEAD_FULL_GATES_PASS","CI");
  if(!gates.ok)throw Error("lifecycle must retain exact-head full-gates state");
  const mergeApproval=act(gates.record,"HUMAN_MERGE_APPROVED","GPT_DELEGATED");
  if(!mergeApproval.ok)throw Error("lifecycle should permit conditional merge after full PASS");
  const beforeMerge=act(mergeApproval.record,"MERGED","GPT_DELEGATED");
  if(beforeMerge.ok)throw Error("lifecycle allowed MERGED before GitHub confirmation");
  c.context.pr.merged=true;c.context.pr.merge_commit_sha="d".repeat(40);
  c.context.canonical_main_contains_merge=true;
  const merged=act(mergeApproval.record,"MERGED","GPT_DELEGATED");
  if(!merged.ok)throw Error("lifecycle rejected verified merge: "+merged.errors);
  const closed=act(merged.record,"EVIDENCE_AND_CLOSURE","GPT_DELEGATED");
  if(!closed.ok)throw Error("lifecycle rejected verified conditional closure: "+closed.errors);
  const stale=onNewHead(first.record,"f".repeat(40));
  if(stale.record.state!=="DRAFT_DEVELOPMENT")throw Error("new HEAD inherits prior delegation");
  const fake=make();
  fake.context.provenance_checked_by_trusted_executor=false;
  if(act(record,"HUMAN_FINAL_INTEGRATION_READY","GPT_DELEGATED",fake.context,fake.grant).ok)
    throw Error("unverified Human origin delegated authority");
  const skipped=act(record,"HUMAN_MERGE_APPROVED","GPT_DELEGATED");
  if(skipped.ok)throw Error("delegation may not skip lifecycle stages");
  return tests.length+7;
}
if(process.argv[1]?.endsWith("/conditional-task-approval-selftest.mjs"))
  console.log("ONE APPROVAL: "+runConditionalApprovalSelfTests()+"/37 PASS (synthetic, NOT Human provenance or real GitHub check)");
