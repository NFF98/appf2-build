// GOV-CONST-001: fail-closed constitutional review, real Human signatures,
// and SHA-locked, exact-path, once-only founding bootstrap.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const CONSTITUTION_GENESIS_BASE="5b556e5d38b35b16640b58b27c1d64be63cac26b";
export const CONSTITUTION_BOOTSTRAP_FILES=Object.freeze([
  ".github/workflows/ci.yml",
  ".github/workflows/governance-gate.yml",
  "AGENTS.md",
  "harness/policy/APPF2-CONSTITUTION.md",
  "harness/scripts/governance-gate.mjs",
  "harness/scripts/validate-change-scope.mjs",
  "harness/scripts/validate-constitutional-change.mjs"
]);
export const CONSTITUTION_STAGES=Object.freeze(["R1","R2","R3","R4","R5"]);

const RE_SHA=/^[0-9a-f]{40}$/;
const RE_CASE=/^GOV-[A-Z0-9-]{3,90}$/;
const sorted=xs=>[...xs].sort();
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const fail=(errors,cond,msg)=>{if(!cond) errors.push("CONSTITUTION: "+msg);};

// Control and evidence record updates (e.g. approved Rebaseline/Activation)
// have their own stronger gates and are NOT edits to constitutional policy.
const isOrdinaryGovernedRecord=p=>
  p==="build-spec/CURRENT.json" || p.startsWith("build-spec/activations/") ||
  p.startsWith("build-spec/baselines/") ||
  p==="delivery/CURRENT-SPRINT.json" ||
  ["delivery/backlog/","delivery/sprints/","delivery/deltas/","delivery/findings/",
   "delivery/evidence/","delivery/audits/"].some(x=>p.startsWith(x)) ||
  p.startsWith("releases/manifests/");

const isConstitutionProtected=(p,policy)=>
  p==="package-lock.json" ||
  (!isOrdinaryGovernedRecord(p) &&
    (policy.governance_only_paths||[]).some(x=>x.endsWith("/")?p.startsWith(x):p===x));

export function isOneTimeConstitutionFounding({changed,base,cs,build}){
  return base===CONSTITUTION_GENESIS_BASE &&
    equal(sorted(changed),sorted(CONSTITUTION_BOOTSTRAP_FILES)) &&
    cs?.status==="ACTIVE" && cs.active_sprint==="SP-P1-003" &&
    cs.active_task==="T006" && cs.active_build_spec==="BS-P1-024" &&
    build?.active_baseline==="BS-P1-024" && build.implementation_enabled===true;
}

const readSafe=(root,rel)=>{
  if(!/^[a-zA-Z0-9/_.-]+$/.test(rel) || rel.startsWith("/") || rel.includes("..")) return null;
  try{return fs.readFileSync(path.join(root,rel));}catch{return null;}
};
const contentDigest=(root,paths)=>{
  const h=createHash("sha256");
  for(const p of sorted(paths)){
    const bytes=readSafe(root,p);
    if(!bytes) return null;
    h.update(p+"\0");h.update(bytes);h.update("\0");
  }
  return h.digest("hex");
};
const loadDocket=(root,rel,errors)=>{
  try{return JSON.parse(readSafe(root,rel)?.toString("utf8")||"");}
  catch{errors.push("CONSTITUTION: docket missing/invalid");return null;}
};
const checkIdentity=({docket,changed,casePath,base,root,errors})=>{
  const id=docket.case_id,changedOther=changed.filter(p=>p!==casePath);
  fail(errors,RE_CASE.test(id||"") && casePath==="delivery/constitutional-cases/"+id+".json","case identity/path invalid");
  fail(errors,RE_SHA.test(base||"") && docket.base_sha===base,"base SHA mismatch");
  fail(errors,docket.constitution_version==="1.0","constitutional protocol mismatch");
  const exact=docket.exact_changed_paths;
  fail(errors,Array.isArray(exact) &&
    equal(sorted(exact),sorted(changedOther)) &&
    new Set(exact).size===exact.length,"PR changed paths differ from exact approved paths");
  const digest=contentDigest(root,changedOther);
  fail(errors,digest!==null && digest===docket.candidate_digest_sha256,"PR bytes changed after approval");
  return digest;
};
const checkWhy5=(d,errors)=>{
  const valid=Array.isArray(d.why5) && d.why5.length===5 &&
    d.why5.every(x=>x && typeof x.question==="string" && x.question.length>0 &&
      typeof x.evidence_ref==="string" && x.evidence_ref.length>0 &&
      typeof x.answer==="string" && x.answer.length>0);
  fail(errors,valid,"five evidence-linked Why answers required");
};

// GOV-392 one-candidate *test-only* lane: a Draft PR can run genuine gates
// without claiming Human authorization. This never applies to push/main and
// never waives any byte, path, BASE, Five-Why or Product validation.
export const GOV392_TEST_ONLY_BASE="8a471763ab762cf486e42dd9efd52d9195113a97";
export const GOV392_TEST_ONLY_DOCKET="delivery/constitutional-cases/GOV-392-TEST-FIRST-001.json";
export const GOV392_TEST_ONLY_PATHS=Object.freeze([
  ".github/workflows/attack-dry-run.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/cloud-evidence.yml",
  ".github/workflows/codeql.yml",
  ".github/workflows/governance-gate.yml",
  "harness/scripts/final-ready-selftest.mjs",
  "harness/scripts/select-impacted-tests.mjs",
  "harness/scripts/validate-change-scope.mjs",
  "harness/scripts/validate-constitutional-change.mjs",
  "harness/scripts/w1-01-evidence-mirror.mjs"
]);
export function isGov392TestOnly({changed,base,root}){
  const event=process.env.GITHUB_EVENT_NAME;
  const scopedRun=event==="pull_request" ||
    (event==="push" && process.env.GITHUB_REF==="refs/heads/fix/gate-first-generic-evidence-20261015");
  if(!scopedRun ||
    process.env.APPF2_GOV392_TEST_PHASE!=="1" ||
    base!==GOV392_TEST_ONLY_BASE ||
    !equal(sorted(changed),sorted([...GOV392_TEST_ONLY_PATHS,GOV392_TEST_ONLY_DOCKET]))) return false;
  const errors=[];
  const docket=loadDocket(root,GOV392_TEST_ONLY_DOCKET,errors);
  if(!docket || errors.length || docket.case_id!=="GOV-392-TEST-FIRST-001" ||
    docket.human_approval!==null ||
    docket.approval_status!=="PREPARED_PENDING_HUMAN_EXACT_CANDIDATE_NOT_MERGE" ||
    docket.scope_exception?.lane!=="GOVERNANCE_REFORM" ||
    !equal(docket.scope_exception?.covered_gates,["CHANGE_SCOPE"]) ||
    docket.scope_exception?.never_converts_fail_or_untested_to_pass!==true) return false;
  checkIdentity({docket,changed,casePath:GOV392_TEST_ONLY_DOCKET,base,root,errors});
  checkWhy5(docket,errors);
  return errors.length===0;
}

// PRE-PHASE4 (Human 2026-10-11): defer Ed25519 *administrative* signatures
// and sequential R1-R5 approvals. Preserve exact diff/digest + Human decision
// evidence and independent final PR merge. CI cannot independently prove
// that an approval ref comes from a person: a Human reviewer MUST check it.
// Phase4 requires a separate policy change to restore cryptographic attestation.
const checkManualHumanApproval=(docket,digest,errors)=>{
  const approval=docket.human_approval||{};
  fail(errors,approval.case_id===docket.case_id &&
    approval.decision==="APPROVE_EXACT_CANDIDATE" &&
    approval.scope==="EXACT_PR_DIFF" &&
    approval.source_kind==="DIRECT_HUMAN_MESSAGE" &&
    typeof approval.human_message_ref==="string" &&
    approval.human_message_ref.trim().length>0 &&
    approval.candidate_digest_sha256===digest &&
    Number.isSafeInteger(approval.approved_at_unix) &&
    approval.approved_at_unix>0,
    "pre-Phase4 exact-candidate Human approval evidence required; independent manual provenance check still mandatory");
};

export function inspectConstitutionalChange({changed,base,cs,build,policy,root}){
  const errors=[],protectedChanged=changed.filter(p=>isConstitutionProtected(p,policy));
  if(!protectedChanged.length) return {errors,constitutional:false,bootstrap:false};
  if(isOneTimeConstitutionFounding({changed,base,cs,build})){
    const charter=readSafe(root,"harness/policy/APPF2-CONSTITUTION.md")?.toString("utf8")||"";
    fail(errors,charter.includes("GOV-CONST-001") &&
      charter.includes("五次獨立 Human 審議"),"founding charter identity missing");
    return {errors,constitutional:true,bootstrap:true};
  }
  const cases=changed.filter(p=>/^delivery\/constitutional-cases\/GOV-[A-Z0-9-]+\.json$/.test(p));
  fail(errors,cases.length===1,"exactly one changed human approval case docket required");
  const docket=cases.length===1?loadDocket(root,cases[0],errors):null;
  if(!docket) return {errors,constitutional:true,bootstrap:false};
  const digest=checkIdentity({docket,changed,casePath:cases[0],base,root,errors});
  checkWhy5(docket,errors);
  if(isGov392TestOnly({changed,base,root})){
    // Structural test verdict only. Human approval is still PENDING.
    return {errors,constitutional:true,bootstrap:false,pendingHumanApproval:true};
  }
  checkManualHumanApproval(docket,digest,errors);
  return {errors,constitutional:true,bootstrap:false};
}

// CI-only ephemeral manual-attestation integrity fixture. NOT a Human identity proof.
const testManualApprovalCase=()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"appf2-prephase4-test-"));
  const id="GOV-CASE-TEST-001",base="a".repeat(40);
  const casePath="delivery/constitutional-cases/"+id+".json";
  const contentPath="package.json";
  const write=(p,v)=>{
    fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});
    fs.writeFileSync(path.join(root,p),v);
  };
  const check=(ok,label)=>{if(!ok)throw Error("PREPHASE4 CASE TEST FAIL: "+label);};
  try{
    write(contentPath,JSON.stringify({name:"test",dependencies:{pg:"8.0.0"}}));
    const digest=contentDigest(root,[contentPath]);
    const docket={
      case_id:id,base_sha:base,constitution_version:"1.0",
      exact_changed_paths:[contentPath],candidate_digest_sha256:digest,
      why5:Array.from({length:5},(_,i)=>({question:"Why "+(i+1)+"?",answer:"Test observation",evidence_ref:"LOCAL-CI"})),
      human_approval:{
        case_id:id,source_kind:"DIRECT_HUMAN_MESSAGE",
        human_message_ref:"CI-ONLY-NONHUMAN-PLACEHOLDER",
        approved_at_unix:1791600000,decision:"APPROVE_EXACT_CANDIDATE",
        scope:"EXACT_PR_DIFF",candidate_digest_sha256:digest
      }
    };
    write(casePath,JSON.stringify(docket));
    const args={
      changed:[contentPath,casePath],base,
      policy:{governance_only_paths:[contentPath]},root,trustPublicKeyB64:""
    };
    check(inspectConstitutionalChange(args).errors.length===0,
      "complete manual-decision metadata passes integrity only, NOT Human provenance");
    const missing=JSON.parse(JSON.stringify(docket));delete missing.human_approval;
    write(casePath,JSON.stringify(missing));
    check(inspectConstitutionalChange(args).errors.some(x=>x.includes("Human approval evidence")),
      "missing Human decision reference must fail closed");
    const malformed=JSON.parse(JSON.stringify(docket));
    malformed.human_approval.source_kind="AI_GENERATED_COMMENT";
    write(casePath,JSON.stringify(malformed));
    check(inspectConstitutionalChange(args).errors.some(x=>x.includes("Human approval evidence")),
      "known AI-authored evidence kind must fail closed");
    write(casePath,JSON.stringify(docket));
    write(contentPath,JSON.stringify({name:"test",dependencies:{pg:"9.0.0"}}));
    check(inspectConstitutionalChange(args).errors.some(x=>x.includes("PR bytes changed")),
      "candidate byte drift after manual approval must fail closed");
    return 4;
  }finally{fs.rmSync(root,{recursive:true,force:true});}
};


// Synthetic negative and positive tests for the bounded GOV-392 lane.
const testGov392TestOnly=()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"appf2-gov392-test-only-"));
  const savedEvent=process.env.GITHUB_EVENT_NAME, savedRef=process.env.GITHUB_REF, savedPhase=process.env.APPF2_GOV392_TEST_PHASE;
  const changed=[...GOV392_TEST_ONLY_PATHS,GOV392_TEST_ONLY_DOCKET];
  const save=(p,b)=>{const dest=path.join(root,p);fs.mkdirSync(path.dirname(dest),{recursive:true});fs.writeFileSync(dest,b);};
  try{
    for(const p of GOV392_TEST_ONLY_PATHS) save(p,"fixture-for-"+p);
    const docket={case_id:"GOV-392-TEST-FIRST-001",base_sha:GOV392_TEST_ONLY_BASE,
      constitution_version:"1.0",exact_changed_paths:[...GOV392_TEST_ONLY_PATHS],
      candidate_digest_sha256:contentDigest(root,GOV392_TEST_ONLY_PATHS),
      why5:Array.from({length:5},(_,i)=>({question:"Why"+i,answer:"Evidence verified",evidence_ref:"CASE-"+i})),
      approval_status:"PREPARED_PENDING_HUMAN_EXACT_CANDIDATE_NOT_MERGE",human_approval:null,
      scope_exception:{lane:"GOVERNANCE_REFORM",covered_gates:["CHANGE_SCOPE"],never_converts_fail_or_untested_to_pass:true}};
    save(GOV392_TEST_ONLY_DOCKET,JSON.stringify(docket));
    process.env.GITHUB_EVENT_NAME="pull_request";process.env.APPF2_GOV392_TEST_PHASE="1";
    const args={changed,base:GOV392_TEST_ONLY_BASE,root};
    if(!isGov392TestOnly(args))throw Error("GOV392 TEST ONLY: exact Draft shape rejected");
    if(isGov392TestOnly({...args,changed:[...changed,"src/rogue.ts"]}))
      throw Error("GOV392 TEST ONLY: rogue Product path admitted");
    if(isGov392TestOnly({...args,base:"b".repeat(40)}))
      throw Error("GOV392 TEST ONLY: stale BASE admitted");
    process.env.GITHUB_EVENT_NAME="push";
    process.env.GITHUB_REF="refs/heads/main";
    if(isGov392TestOnly(args))throw Error("GOV392 TEST ONLY: main push admitted");
    process.env.GITHUB_REF="refs/heads/fix/gate-first-generic-evidence-20261015";
    if(!isGov392TestOnly(args))throw Error("GOV392 TEST ONLY: exact repair-branch push rejected");
    process.env.GITHUB_REF="refs/heads/other";
    if(isGov392TestOnly(args))throw Error("GOV392 TEST ONLY: rogue branch push admitted");
    process.env.GITHUB_EVENT_NAME="pull_request";
    save(GOV392_TEST_ONLY_PATHS[0],"tampered bytes");
    if(isGov392TestOnly(args))throw Error("GOV392 TEST ONLY: changed bytes admitted");
    save(GOV392_TEST_ONLY_PATHS[0],"fixture-for-"+GOV392_TEST_ONLY_PATHS[0]);
    docket.human_approval={source_kind:"BOT"};
    save(GOV392_TEST_ONLY_DOCKET,JSON.stringify(docket));
    if(isGov392TestOnly(args))throw Error("GOV392 TEST ONLY: synthetic approval admitted");
    return 8;
  }finally{
    savedEvent===undefined?delete process.env.GITHUB_EVENT_NAME:process.env.GITHUB_EVENT_NAME=savedEvent;
    savedRef===undefined?delete process.env.GITHUB_REF:process.env.GITHUB_REF=savedRef;
    savedPhase===undefined?delete process.env.APPF2_GOV392_TEST_PHASE:process.env.APPF2_GOV392_TEST_PHASE=savedPhase;
    fs.rmSync(root,{recursive:true,force:true});
  }
};

export function testConstitutionFailClosed(){
  const basic={
    base:CONSTITUTION_GENESIS_BASE,changed:[...CONSTITUTION_BOOTSTRAP_FILES],
    cs:{status:"ACTIVE",active_sprint:"SP-P1-003",active_task:"T006",active_build_spec:"BS-P1-024"},
    build:{active_baseline:"BS-P1-024",implementation_enabled:true}
  };
  const expect=(good,label)=>{if(!good) throw Error("CONSTITUTION SELF TEST FAILED: "+label);};
  expect(isOneTimeConstitutionFounding(basic),"only exact founding passes");
  let count=1;
  for(const [name,patch] of [
    ["extra-package",{changed:[...basic.changed,"package.json"]}],
    ["rogue-source",{changed:[...basic.changed,"src/edge/intent-api.ts"]}],
    ["base-drift",{base:"a".repeat(40)}],
    ["task-drift",{cs:{...basic.cs,active_task:"T009"}}],
    ["file-missing",{changed:basic.changed.slice(1)}],
    ["expired",{base:"b".repeat(40)}]
  ]){
    expect(!isOneTimeConstitutionFounding({...basic,...patch}),name);count++;
  }
  const p={governance_only_paths:["harness/","package.json","AGENTS.md","build-spec/","delivery/CURRENT-SPRINT.json"]};
  for(const target of ["package.json","package-lock.json","harness/policy/repo-policy.json"]){
    const result=inspectConstitutionalChange({
      ...basic,changed:[target],base:"a".repeat(40),
      root:"/non-existent",policy:p,trustPublicKeyB64:""
    });
    expect(result.errors.length>0,"unsigned "+target+" rejected");count++;
  }
  const routine=inspectConstitutionalChange({
    ...basic,changed:["build-spec/CURRENT.json"],
    base:"a".repeat(40),root:"/non-existent",policy:p,trustPublicKeyB64:""
  });
  expect(!routine.constitutional && !routine.errors.length,
    "ordinary control record keeps existing independent governance gates");count++;
  return count+testManualApprovalCase()+testGov392TestOnly();
}
