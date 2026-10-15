// GOV-392 positive/negative regression matrix for the carry-forward register, Change Review and
// administrative Sprint closure. Executed by governance-gate.mjs on every CI run. All fixtures are
// synthetic; a PASS here is NOT Human approval and NOT Product evidence.
import fs from "node:fs";
import path from "node:path";
import { exceptionDigest, GOVERNANCE_REFORM_POLICY_PATH } from "./human-exception.mjs";
import {
  carryForwardRowErrors,rowTruthErrors,registerErrors,registerDiffErrors,docketCarryForwardErrors,
  inspectCarryForwardChange,closedSprintErrors,productAlignmentErrors,taskSnapshotDigest,
  CARRY_FORWARD_SCHEMA,ADMIN_CLOSURE,CARRY_FORWARD_MODULE_PATH
} from "./validate-special-approvals-and-carry-forward.mjs";

const NOW=1792000000,BASE="b".repeat(40),SID="SP-P9-003",CASE="GOV-TEST-ADMIN-CLOSE-001";
const DOCKET="delivery/constitutional-cases/"+CASE+".json";
const HUMAN_REF="Human direct message: exact closure decision for this fixture";
const clone=x=>JSON.parse(JSON.stringify(x));
export const selfTestTrace=[];
// Each case: [name, expectPass, input, reason]. A negative case must fail for its stated reason.
const expectCases=(group,cases,run)=>{
  for(const [name,want,input,reason] of cases){
    const errors=run(typeof input==="function"?input():input),got=errors.length===0;
    if(got!==want) throw Error("GOV-392 SELF-TEST FAILED ["+group+"]: "+name+" expected "+want+" got "+got+" "+JSON.stringify(errors));
    if(!want && !(reason instanceof RegExp)) throw Error("GOV-392 SELF-TEST INVALID ["+group+"]: "+name+" has no expected reason");
    if(!want && !errors.some(e=>reason.test(e))) throw Error("GOV-392 SELF-TEST FAILED ["+group+"]: "+name+" failed for another reason "+JSON.stringify(errors));
    selfTestTrace.push({group,name,expect:want?"PASS":"REJECT",errors});
  }
  return cases.length;
};

const tasksDoc=()=>({sprint_id:SID,tasks:[
  {task_id:"T001",status:"CLOSED",build_spec_id:"BS-P9-025",acceptance_links:[{acceptance_id:"F01-AC-001",test_id:"TEST-F01-001"}],completion_evidence:["EV-T001-001"]},
  {task_id:"T006",status:"BLOCKED",build_spec_id:"BS-P9-025",acceptance_links:[
    {acceptance_id:"F00-AC-036",test_id:"TEST-F00-036"},{acceptance_id:"F00-AC-037",test_id:"TEST-F00-037"}],completion_evidence:["EV-T006-001","EV-T006-002"]},
  {task_id:"T008",status:"CLOSED",build_spec_id:"BS-P9-025",acceptance_links:[{acceptance_id:"F01-AC-013",test_id:"TEST-F01-API-001"}],completion_evidence:["EV-T008-001"]}
]});
const queue=()=>({items:[
  {backlog_item_id:"BL-P9-001",status:"DONE",sprint_id:SID},
  {backlog_item_id:"BL-P9-015",status:"SPRINTED",sprint_id:SID},
  {backlog_item_id:"BL-P9-008",status:"DONE",sprint_id:"SP-P9-002",revalidation:{status:"CLOSED",task_id:"T008"}}
]});
const row=(id,over={})=>({
  row_schema:CARRY_FORWARD_SCHEMA,id,title:"Carry-forward "+id,status:"BLOCKED",
  source:{kind:"TASK",sprint_id:SID,task_id:"T006",backlog_item_ids:[],refs:[DOCKET]},
  acceptance:[],human_decision:{case_id:CASE,human_message_ref:HUMAN_REF,approved_at_unix:NOW-100,expires_at_unix:null},
  waived_gate:null,reason:"Product work unfinished at Sprint close",risk:"Unverified behaviour shipped later",owner:"Human + Planning",
  next_phase:{target:"PENDING_PRODUCT_ALIGNMENT",decided_by_human:false},completion_criterion:"Independent PASS Evidence recorded",
  history:[{at_unix:NOW-100,event:"REGISTERED",ref:DOCKET}],resolution:null,...over
});
const rows=()=>[
  {id:"POI-002",title:"legacy row",status:"DEFERRED_REVIEW"},
  row("GAP-T006-01",{status:"UNTESTED",acceptance:[{acceptance_id:"F00-AC-037",test_id:"TEST-F00-037",evidence_status:"UNTESTED",evidence_refs:["EV-T006-002"]}]}),
  row("GAP-T006-03"),
  row("GAP-BL-015",{source:{kind:"BACKLOG",sprint_id:SID,task_id:null,backlog_item_ids:["BL-P9-015"],refs:[DOCKET]}})
];
const world=policy=>{
  const td=tasksDoc(),q=queue();
  return {policy,td,q,register:{items:rows()},
    ctx:{cf:policy.carry_forward,placeholder:new RegExp(policy.exception.placeholder_ref_pattern,"i"),
      nonWaivable:policy.exception.non_waivable_gates,now:NOW,
      sprints:new Map([[SID,{m:{status:"CLOSED"},td}]]),backlogById:new Map(q.items.map(x=>[x.backlog_item_id,x]))}};
};
const rowErrs=(w,r)=>[...carryForwardRowErrors(r,w.ctx),...rowTruthErrors(r,w.ctx)];

function rowCases(policy){
  const w=world(policy),base=()=>rows()[1],plain=()=>rows()[2];
  const set=(make,fn)=>()=>{const r=make();fn(r);return r;};
  const resolved=r=>{r.status="RESOLVED";r.acceptance[0].evidence_status="PASS";r.resolution={evidence_refs:["EV-NEW-001"],resolution_ref:"PR #999",resolved_at_unix:NOW};};
  const T008_ORDER="BACKLOG_T008_CLOSE_AFTER_T006_REVIEW";
  return expectCases("register row",[
    ["UNTESTED row naming the UNTESTED Acceptance",true,base],
    ["BLOCKED Task row",true,plain],
    ["legacy-style id rejected",false,set(plain,r=>{r.id="POI-999";}),/id must match/],
    ["missing owner",false,set(plain,r=>{r.owner="";}),/owner required/],
    ["status DONE is not a register state",false,set(plain,r=>{r.status="DONE";}),/status invalid: DONE/],
    ["missing source references",false,set(plain,r=>{r.source.refs=[];}),/source\.refs/],
    ["missing Human reference (placeholder)",false,set(plain,r=>{r.human_decision.human_message_ref="PENDING Human approval";}),/human_message_ref missing or placeholder/],
    ["waived gate without Human decision",false,set(plain,r=>{r.waived_gate=T008_ORDER;r.human_decision=null;}),/requires an exact Human decision/],
    ["non-waivable gate waived",false,set(plain,r=>{r.waived_gate="EVIDENCE_PASS";}),/non-waivable gate/],
    ["expired approval still open",false,set(plain,r=>{r.waived_gate=T008_ORDER;r.human_decision.expires_at_unix=NOW-10;}),/expired approval/],
    ["permanent Human disposition never expires",true,set(plain,r=>{r.waived_gate=T008_ORDER;})],
    ["expired approval but RESOLVED with PASS evidence",true,set(base,r=>{r.waived_gate=T008_ORDER;r.human_decision.expires_at_unix=NOW-10;resolved(r);})],
    ["RESOLVED without resolution evidence",false,set(base,r=>{resolved(r);r.resolution.evidence_refs=[];}),/RESOLVED requires resolution/],
    ["RESOLVED while Acceptance UNTESTED (fake-green)",false,set(base,r=>{resolved(r);r.acceptance[0].evidence_status="UNTESTED";}),/fake-green/],
    ["UNTESTED gap falsely marked PASS",false,set(base,r=>{r.acceptance[0].evidence_status="PASS";}),/no fake PASS/],
    ["unresolved row carrying a resolution",false,set(plain,r=>{r.resolution={evidence_refs:["x"],resolution_ref:"x",resolved_at_unix:NOW};}),/may not carry a resolution/],
    ["Sprint4 target not decided by Human",false,set(plain,r=>{r.next_phase={target:"SP-P1-004",decided_by_human:false};}),/PENDING_PRODUCT_ALIGNMENT/],
    ["Human-decided target without reference",false,set(plain,r=>{r.next_phase={target:"F06",decided_by_human:true,decision_ref:""};}),/decision_ref/],
    ["empty history",false,set(plain,r=>{r.history=[];}),/history must be/],
    ["duplicate Acceptance pair",false,set(base,r=>{r.acceptance.push(clone(r.acceptance[0]));}),/duplicate Acceptance/],
    ["phantom Acceptance not mapped to the Task",false,set(base,r=>{r.acceptance[0].acceptance_id="F06-AC-001";}),/phantom Acceptance/],
    ["unknown source Sprint",false,set(plain,r=>{r.source.sprint_id="SP-P9-099";}),/source Sprint not found/]
  ],r=>rowErrs(w,r))+expectCases("register truth",[
    ["T006 falsely CLOSED while gap open",false,()=>{const x=world(policy);x.td.tasks[1].status="CLOSED";return {x,r:base()};},/fake closure/],
    ["Backlog falsely DONE while BACKLOG row open",false,()=>{const x=world(policy);x.ctx.backlogById.get("BL-P9-015").status="DONE";return {x,r:rows()[3]};},/is DONE while its carry-forward row is open/],
    ["revalidation complete while REVALIDATION row open",false,()=>({x:world(policy),r:row("GAP-REVAL",{source:{kind:"REVALIDATION",sprint_id:SID,task_id:"T008",backlog_item_ids:["BL-P9-008"],refs:[DOCKET]}})}),/revalidation BL-P9-008 is complete/]
  ],({x,r})=>rowErrs(x,r))+expectCases("register",[
    ["legacy rows tolerated, strict rows valid",true,()=>world(policy).register],
    ["duplicate IDs",false,()=>({items:[...rows(),rows()[2]]}),/duplicate register id GAP-T006-03/],
    ["missing items[]",false,()=>({}),/must contain items/]
  ],reg=>registerErrors(reg,w.ctx));
}

function registerDiffCases(){
  const before={items:rows()};
  const mut=fn=>()=>{const a=clone(before);fn(a.items);return {b:before,a};};
  const step=(r,status)=>{r.status=status;r.history.push({at_unix:NOW,event:"STATUS_"+status,ref:"PR #998"});};
  return expectCases("register diff",[
    ["unchanged",true,mut(()=>{})],
    ["append strict row",true,mut(items=>{items.push(row("GAP-NEW-01"));})],
    ["append legacy-format row",false,mut(items=>{items.push({id:"POI-099",status:"OPEN"});}),/new register row must use/],
    ["delete legacy row",false,mut(items=>{items.splice(0,1);}),/row deleted: POI-002/],
    ["delete carry-forward row",false,mut(items=>{items.splice(2,1);}),/row deleted: GAP-T006-03/],
    ["status change with appended history",true,mut(items=>{step(items[2],"OPEN");})],
    ["status change without history",false,mut(items=>{items[2].status="OPEN";}),/without a new history entry/],
    ["history rewritten",false,mut(items=>{items[2].history[0].ref="rewritten";}),/append-only/],
    ["Human decision rewritten",false,mut(items=>{items[2].human_decision.human_message_ref="other decision";step(items[2],"OPEN");}),/human_decision is immutable/],
    ["Acceptance set changed",false,mut(items=>{items[1].acceptance[0].test_id="TEST-F00-039";step(items[1],"BLOCKED");}),/Acceptance\/Test set is immutable/],
    ["schema dropped",false,mut(items=>{delete items[2].row_schema;}),/lost APPF2-CARRY-FORWARD-1/],
    ["RESOLVED row edited afterwards",false,()=>{
      const b=clone(before),r=b.items[1];r.status="RESOLVED";r.acceptance[0].evidence_status="PASS";
      r.resolution={evidence_refs:["EV"],resolution_ref:"PR",resolved_at_unix:NOW};
      const a=clone(b);a.items[1].owner="someone else";return {b,a};
    },/RESOLVED register row is immutable/]
  ],({b,a})=>registerDiffErrors(b,a));
}

function docketCases(policy){
  const reg={items:rows()},cf=policy.carry_forward,why="Rule-only change; defers and waives nothing.";
  const exception=over=>({case_id:CASE,scope_exception:{lane:"GOVERNANCE_REFORM",residual_gaps:["NONE"]},...over});
  return expectCases("docket carry-forward",[
    ["record without obligation markers",true,{case_id:CASE,why5:[]}],
    ["exception docket without carry_forward (silent)",false,exception({}),/silent carry-forward/],
    ["linked open rows",true,exception({carry_forward:{ids:["GAP-T006-01","GAP-BL-015"]}})],
    ["unknown register id",false,exception({carry_forward:{ids:["GAP-MISSING-01"]}}),/missing from register/],
    ["row does not link back",false,exception({case_id:"GOV-TEST-OTHER-001",carry_forward:{ids:["GAP-T006-01"]}}),/does not link back/],
    ["duplicate ids",false,exception({carry_forward:{ids:["GAP-T006-01","GAP-T006-01"]}}),/unique register IDs/],
    ["explicit zero-gap declaration",true,exception({carry_forward:{zero_gap:true,justification:why}})],
    ["zero-gap with short justification",false,exception({carry_forward:{zero_gap:true,justification:"none"}}),/at least 20 characters/],
    ["zero-gap on CLOSURE_DEFERRAL",false,exception({scope_exception:{lane:"CLOSURE_DEFERRAL",residual_gaps:["NONE"]},carry_forward:{zero_gap:true,justification:why}}),/CLOSURE_DEFERRAL/],
    ["zero-gap while residual gaps listed",false,exception({scope_exception:{lane:"GOVERNANCE_REFORM",residual_gaps:["GAP-X"]},carry_forward:{zero_gap:true,justification:why}}),/residual_gaps exactly/],
    ["zero-gap on deferred Acceptance",false,exception({deferred_acceptance_id:"F00-AC-037",carry_forward:{zero_gap:true,justification:why}}),/impossible for a deferred Acceptance/],
    ["closure docket using administrative_closure ids",true,{case_id:CASE,closure_disposition:ADMIN_CLOSURE,administrative_closure:{carry_forward_ids:["GAP-T006-01","GAP-T006-03"]}}],
    ["closure docket with a second, divergent carry_forward list",false,{case_id:CASE,closure_disposition:ADMIN_CLOSURE,administrative_closure:{carry_forward_ids:["GAP-T006-01"]},carry_forward:{zero_gap:true,justification:why}},/only in administrative_closure/]
  ],d=>docketCarryForwardErrors(d,DOCKET,reg,cf));
}

const closure=()=>{
  const td=tasksDoc();
  const a={schema:"APPF2-ADMIN-CLOSURE-1",case_id:CASE,carry_forward_ids:["GAP-T006-01","GAP-T006-03","GAP-BL-015"],
    open_tasks:[{id:"T006",status:"BLOCKED",snapshot_sha256:taskSnapshotDigest(td.tasks[1])}],
    open_backlog:[{id:"BL-P9-015",status:"SPRINTED"}],open_revalidations:[],
    historical_procedural_dispositions:[{gate_id:"BACKLOG_T008_CLOSE_AFTER_T006_REVIEW",task_id:"T008"}]};
  const m={sprint_id:SID,status:"CLOSED",build_spec_id:"BS-P9-025",closure_disposition:ADMIN_CLOSURE,
    backlog_item_ids:["BL-P9-001","BL-P9-015"],revalidation_item_ids:["BL-P9-008"],administrative_closure:a};
  const digest="c".repeat(64);
  const docket={case_id:CASE,closure_disposition:ADMIN_CLOSURE,sprint_id:SID,build_spec_id:"BS-P9-025",
    never_converts_fail_or_untested_to_pass:true,administrative_closure:clone(a),candidate_digest_sha256:digest,
    why5:Array.from({length:5},(_,i)=>({question:"W"+(i+1),answer:"fixture answer",evidence_ref:"fixture ref"})),
    human_approval:{case_id:CASE,source_kind:"DIRECT_HUMAN_MESSAGE",decision:"APPROVE_EXACT_CANDIDATE",scope:"EXACT_PR_DIFF",
      human_message_ref:HUMAN_REF,approver:"NFF98",approved_at_unix:NOW-50,candidate_digest_sha256:digest}};
  return {td,m,docket,q:queue(),register:{items:rows()}};
};
const closureErrs=(policy,x)=>{
  const backlogById=new Map(x.q.items.map(i=>[i.backlog_item_id,i]));
  return closedSprintErrors({sid:x.sid||SID,m:x.m,td:x.td,backlogById,selectedIds:new Set(x.m.backlog_item_ids),
    revalidationIds:new Set(x.m.revalidation_item_ids||[]),docket:x.docket,full:policy,register:x.register});
};

function closureCases(policy){
  const c=fn=>()=>{const x=closure();fn(x);return x;};
  const ordinary=fn=>c(x=>{delete x.m.closure_disposition;delete x.m.administrative_closure;fn(x);});
  const both=fn=>c(x=>{fn(x.m.administrative_closure);fn(x.docket.administrative_closure);});
  const APPROVAL=/exact Human closure approval missing or invalid/;
  return expectCases("administrative closure",[
    ["exact ADMINISTRATIVE_WITH_CARRY_FORWARD",true,c(()=>{})],
    ["ordinary CLOSED, all Tasks CLOSED",true,ordinary(x=>{x.td.tasks[1].status="CLOSED";x.q.items[1].status="DONE";})],
    ["ordinary CLOSED not weakened: T006 BLOCKED",false,ordinary(()=>{}),/requires every Task CLOSED: T006 is BLOCKED/],
    ["ordinary CLOSED not weakened: Backlog SPRINTED",false,ordinary(x=>{x.td.tasks[1].status="CLOSED";}),/requires every selected Backlog DONE: BL-P9-015/],
    ["ordinary CLOSED not weakened: revalidation open",false,ordinary(x=>{x.td.tasks[1].status="CLOSED";x.q.items[1].status="DONE";x.q.items[2].revalidation.status="IN_PROGRESS";}),/requires revalidation complete: BL-P9-008/],
    ["unknown disposition",false,c(x=>{x.m.closure_disposition="CLOSED_WITH_WAIVER";}),/invalid closure_disposition/],
    ["disposition on a non-CLOSED Sprint",false,c(x=>{x.m.status="REVIEW";}),/only valid on a CLOSED Sprint/],
    ["missing docket",false,c(x=>{x.docket=null;}),/Human closure docket missing/],
    ["missing Human approval",false,c(x=>{delete x.docket.human_approval;}),APPROVAL],
    ["placeholder Human reference",false,c(x=>{x.docket.human_approval.human_message_ref="TBD";}),APPROVAL],
    ["bot/AI source kind",false,c(x=>{x.docket.human_approval.source_kind="AI_GENERATED_COMMENT";}),APPROVAL],
    ["approver not a Human authority account",false,c(x=>{x.docket.human_approval.approver="cursor-bot";}),APPROVAL],
    ["fake/mismatched digest",false,c(x=>{x.docket.human_approval.candidate_digest_sha256="d".repeat(64);}),APPROVAL],
    ["admin mode applied to an unrelated Sprint",false,c(x=>{x.sid="SP-P9-004";x.m.sprint_id="SP-P9-004";}),/identity\/disposition\/Sprint/],
    ["live TTL exception reused as closure",false,c(x=>{x.docket.scope_exception={lane:"CLOSURE_DEFERRAL"};}),/must not be a TTL scope_exception/],
    ["manifest differs from approved docket",false,c(x=>{x.m.administrative_closure.carry_forward_ids.pop();}),/differs from the Human-approved docket/],
    ["five Why missing",false,c(x=>{x.docket.why5.pop();}),/five evidence-linked Why/],
    ["fake-green declaration missing",false,c(x=>{x.docket.never_converts_fail_or_untested_to_pass=false;}),/never_converts_fail_or_untested_to_pass/],
    ["unlisted open Task (T008 left REVIEW)",false,c(x=>{x.td.tasks[2].status="REVIEW";}),/unlisted open Task T008/],
    ["T006 status drift after approval",false,c(x=>{x.td.tasks[1].status="REVIEW";}),/T006 is REVIEW, approved as BLOCKED/],
    ["T006 Evidence bytes changed after approval",false,c(x=>{x.td.tasks[1].completion_evidence.push("EV-T006-099");}),/bytes changed after Human approval/],
    ["T006 falsely CLOSED/PASS",false,c(x=>{x.td.tasks[1].status="CLOSED";}),/approved open Task T006 no longer matches/],
    ["unlisted open Backlog",false,both(a=>{a.open_backlog=[];}),/unlisted open Backlog BL-P9-015/],
    ["open Task without carry-forward row",false,both(a=>{a.carry_forward_ids=["GAP-BL-015"];}),/open Task T006 has no carry-forward row/],
    ["carry-forward row from another Sprint",false,c(x=>{x.register.items[2].source.sprint_id="SP-P9-002";}),/belongs to another Sprint/],
    ["non-dispositionable gate",false,both(a=>{a.historical_procedural_dispositions[0].gate_id="EVIDENCE_PASS";}),/cannot receive a historical disposition/],
    ["VERIFIED Task cannot be carried",false,c(x=>{x.td.tasks[1].status="VERIFIED";for(const a of [x.m.administrative_closure,x.docket.administrative_closure]){a.open_tasks[0].status="VERIFIED";a.open_tasks[0].snapshot_sha256=taskSnapshotDigest(x.td.tasks[1]);}}),/cannot be carried forward/]
  ],x=>closureErrs(policy,x));
}

function alignmentCases(policy){
  const sprints=()=>new Map([[SID,{m:closure().m}],["SP-P9-004",{m:{status:"ACTIVE"}}]]);
  const pa=(ids,ref=HUMAN_REF)=>({entry_gate:{product_alignment:{human_decision_ref:ref,reviewed_carry_forward_ids:ids}}});
  const all=["GAP-T006-01","GAP-T006-03","GAP-BL-015"];
  const run=({manifest,register={items:rows()},sid="SP-P9-004"})=>productAlignmentErrors({activeSid:sid,activeManifest:manifest,sprints:sprints(),register,full:policy});
  return expectCases("product alignment",[
    ["next Sprint without Product Alignment",false,{manifest:{entry_gate:{}}},/requires entry_gate\.product_alignment/],
    ["Product Alignment reviewed every open item",true,{manifest:pa(all)}],
    ["Product Alignment omitted one open item",false,{manifest:pa(all.slice(1))},/did not review open carry-forward GAP-T006-01/],
    ["Product Alignment placeholder reference",false,{manifest:pa(all,"PLACEHOLDER")},/requires entry_gate\.product_alignment/],
    ["resolved item need not be re-reviewed",true,()=>{const r={items:rows()};r.items[1].status="RESOLVED";return {manifest:pa(all.slice(1)),register:r};}],
    ["earlier Sprint unaffected",true,{manifest:{entry_gate:{}},sid:"SP-P9-002"}]
  ],run);
}

const changeWorld=policy=>{
  const x=closure(),files=new Map(),baseFiles=new Map();
  const put=(map,p,v)=>map.set(p,Buffer.from(typeof v==="string"?v:JSON.stringify(v,null,2)+"\n"));
  const manifestPath="delivery/sprints/"+SID+"/manifest.json",tasksPath="delivery/sprints/"+SID+"/tasks.json";
  const baseManifest=clone(x.m);baseManifest.status="ACTIVE";delete baseManifest.closure_disposition;delete baseManifest.administrative_closure;
  put(baseFiles,GOVERNANCE_REFORM_POLICY_PATH,policy);
  put(baseFiles,policy.carry_forward.register_path,{items:rows().slice(0,1)});
  put(baseFiles,"delivery/CURRENT-SPRINT.json",{active_sprint:SID,active_build_spec:"BS-P9-025",active_task:"T008",status:"REVIEW"});
  put(baseFiles,"build-spec/CURRENT.json",{active_baseline:"BS-P9-025",implementation_enabled:true,reason:"active"});
  put(baseFiles,manifestPath,baseManifest);
  put(baseFiles,tasksPath,x.td);
  for(const [p,v] of baseFiles) files.set(p,v);
  put(files,policy.carry_forward.register_path,x.register);
  put(files,"delivery/CURRENT-SPRINT.json",{active_sprint:null,active_build_spec:null,active_task:null,status:"HOLD"});
  put(files,"build-spec/CURRENT.json",{active_baseline:"BS-P9-025",implementation_enabled:false,reason:"HOLD after administrative closure"});
  put(files,manifestPath,x.m);
  const w={files,baseFiles,docket:x.docket,put,
    changed:[policy.carry_forward.register_path,"delivery/CURRENT-SPRINT.json","build-spec/CURRENT.json",manifestPath],
    baseDocketDigests:new Set(),headPolicy:clone(policy),basePolicy:policy};
  w.seal=()=>{
    const others=w.changed.filter(p=>p!==DOCKET);
    const digest=exceptionDigest(p=>w.files.get(p)||null,others);
    w.docket.exact_changed_paths=[...others];w.docket.base_sha=BASE;
    w.docket.candidate_digest_sha256=digest;w.docket.human_approval.candidate_digest_sha256=digest;
    put(w.files,DOCKET,w.docket);
    if(!w.changed.includes(DOCKET)) w.changed.push(DOCKET);
    return w;
  };
  return w.seal();
};
const reviewErrs=w=>{
  const json=(map,p)=>map.has(p)?JSON.parse(map.get(p).toString("utf8")):null;
  return inspectCarryForwardChange({base:BASE,changed:w.changed,readHead:p=>w.files.get(p)||null,
    readHeadJson:p=>json(w.files,p),readBaseJson:p=>json(w.baseFiles,p),
    basePolicyFull:w.basePolicy,headPolicyFull:w.headPolicy,baseDocketDigests:w.baseDocketDigests}).errors;
};

function changeReviewCases(policy){
  const cw=fn=>()=>{const w=changeWorld(policy);fn(w);return w;};
  const resealed=fn=>cw(w=>{fn(w);w.seal();});
  const later=fn=>cw(w=>{
    for(const [p,v] of w.files) w.baseFiles.set(p,v);
    w.changed=[];fn(w);
  });
  const reg=policy.carry_forward.register_path;
  return expectCases("change review",[
    ["exact administrative closure transition",true,cw(()=>{})],
    ["BASE policy without carry_forward: bootstrap only",true,cw(w=>{w.basePolicy=clone(policy);delete w.basePolicy.carry_forward;w.changed.push("harness/scripts/governance-gate.mjs");})],
    ["HEAD policy disables enforcement",false,cw(w=>{w.headPolicy.carry_forward.enforced=false;}),/suppression: HEAD policy/],
    ["governance-gate wiring removed",false,resealed(w=>{w.put(w.files,"harness/scripts/governance-gate.mjs","console.log('PASS');\n");w.changed.push("harness/scripts/governance-gate.mjs");}),/suppression: governance-gate/],
    ["validator deleted",false,resealed(w=>{w.changed.push(CARRY_FORWARD_MODULE_PATH);}),/suppression: carry-forward validator deleted/],
    ["validate-sprint unwired",false,resealed(w=>{w.put(w.files,"harness/scripts/validate-sprint.mjs","// no closure checks\n");w.changed.push("harness/scripts/validate-sprint.mjs");}),/suppression: harness\/scripts\/validate-sprint/],
    ["validate-backlog unwired",false,resealed(w=>{w.put(w.files,"harness/scripts/validate-backlog.mjs","// order rule only\n");w.changed.push("harness/scripts/validate-backlog.mjs");}),/suppression: harness\/scripts\/validate-backlog/],
    ["closure docket replayed from base",false,cw(w=>{w.baseFiles.set(DOCKET,w.files.get(DOCKET));}),/added in the same PR/],
    ["closure bytes changed after approval",false,cw(w=>{w.put(w.files,"build-spec/CURRENT.json",{active_baseline:"BS-P9-025",implementation_enabled:false,reason:"edited after approval"});}),/PR bytes differ/],
    ["changed paths differ from approval",false,cw(w=>{w.docket.exact_changed_paths.pop();w.put(w.files,DOCKET,w.docket);}),/changed paths differ/],
    ["candidate digest replayed",false,cw(w=>{w.baseDocketDigests.add(w.docket.candidate_digest_sha256);}),/replay: candidate digest/],
    ["stale base SHA",false,cw(w=>{w.docket.base_sha="e".repeat(40);w.put(w.files,DOCKET,w.docket);}),/base_sha must equal/],
    ["CURRENT-SPRINT not HOLD",false,resealed(w=>{w.put(w.files,"delivery/CURRENT-SPRINT.json",{active_sprint:null,active_build_spec:null,active_task:null,status:"ACTIVE"});}),/must move CURRENT-SPRINT to HOLD/],
    ["HOLD with implementation_enabled=true",false,resealed(w=>{w.put(w.files,"build-spec/CURRENT.json",{active_baseline:"BS-P9-025",implementation_enabled:true,reason:"HOLD"});}),/implementation_enabled=false/],
    ["closure moves the Build Spec",false,resealed(w=>{w.put(w.files,"build-spec/CURRENT.json",{active_baseline:"BS-P9-026",implementation_enabled:false,reason:"HOLD"});}),/implementation_enabled=false/],
    ["silent carry-forward omission at closure",false,resealed(w=>{const r=JSON.parse(w.files.get(reg));r.items.push(row("GAP-HIDDEN-01"));w.put(w.files,reg,r);}),/silent carry-forward omission: open register row GAP-HIDDEN-01/],
    ["register row deleted",false,resealed(w=>{w.put(w.files,reg,{items:rows().slice(1)});}),/register row deleted: POI-002/],
    ["new obligation docket without carry_forward",false,cw(w=>{const p="delivery/constitutional-cases/GOV-TEST-WAIVER-002.json";w.put(w.files,p,{case_id:"GOV-TEST-WAIVER-002",scope_exception:{lane:"CLOSURE_DEFERRAL"}});w.changed.push(p);}),/GOV-TEST-WAIVER-002\.json creates\/defers\/waives an obligation/],
    ["admin-closed manifest edited later",false,later(w=>{const p="delivery/sprints/"+SID+"/manifest.json";const m=JSON.parse(w.files.get(p));m.goal="rewritten";w.put(w.files,p,m);w.changed.push(p);}),/administratively CLOSED Sprint record is immutable/],
    ["admin-closed Task record edited later (T006 PASS)",false,later(w=>{const p="delivery/sprints/"+SID+"/tasks.json";const t=JSON.parse(w.files.get(p));t.tasks[1].status="CLOSED";w.put(w.files,p,t);w.changed.push(p);}),/administratively CLOSED Sprint record is immutable/],
    ["closure docket edited after merge",false,later(w=>{const d=JSON.parse(w.files.get(DOCKET));d.note="edited";w.put(w.files,DOCKET,d);w.changed.push(DOCKET);}),/docket is append-only/],
    ["later carry-forward resolution with history",true,later(w=>{const r=JSON.parse(w.files.get(reg));const g=r.items[3];
      g.status="RESOLVED";g.resolution={evidence_refs:["EV-NEW-001"],resolution_ref:"PR #999",resolved_at_unix:NOW+10};g.history.push({at_unix:NOW+10,event:"RESOLVED",ref:"PR #999"});
      w.put(w.files,reg,r);w.changed.push(reg);})]
  ],reviewErrs);
}

export function runCarryForwardSelfTests(root=process.cwd()){
  const policy=JSON.parse(fs.readFileSync(path.join(root,GOVERNANCE_REFORM_POLICY_PATH),"utf8"));
  if(!policy.carry_forward || !policy.administrative_closure) throw Error("GOV-392 SELF-TEST FAILED: policy sections missing");
  selfTestTrace.length=0;
  const counts={
    register:rowCases(policy),
    register_diff:registerDiffCases(),
    docket:docketCases(policy),
    administrative_closure:closureCases(policy),
    product_alignment:alignmentCases(policy),
    change_review:changeReviewCases(policy)
  };
  return {counts,total:Object.values(counts).reduce((a,n)=>a+n,0)};
}
