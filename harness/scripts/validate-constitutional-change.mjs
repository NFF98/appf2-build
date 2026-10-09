// GOV-CONST-001: fail-closed constitutional review, real Human signatures,
// and SHA-locked, exact-path, once-only founding bootstrap.
import { createHash, createPublicKey, generateKeyPairSync, sign as signApproval, verify as verifySignature } from "node:crypto";
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

const RE_SHA256=/^[0-9a-f]{64}$/;
const RE_SHA=/^[0-9a-f]{40}$/;
const RE_CASE=/^GOV-[A-Z0-9-]{3,90}$/;
const sorted=xs=>[...xs].sort();
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sha=bytes=>createHash("sha256").update(bytes).digest("hex");
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
const humanKey=(raw,errors)=>{
  try{
    if(!raw) throw Error("missing");
    const key=createPublicKey(Buffer.from(raw,"base64").toString("utf8"));
    if(key.asymmetricKeyType!=="ed25519") throw Error("not Ed25519");
    return key;
  }catch{errors.push("CONSTITUTION: independently configured Human Ed25519 public key missing or invalid");return null;}
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

const approvalPayload=({docket,rec,stage,i,base,previous,digest})=>({
  protocol:"APPF2-CONSTITUTION-1.0",
  case_id:docket.case_id,
  stage,
  stage_number:i+1,
  canonical_base_sha:base,
  dossier_sha256:rec.dossier_sha256,
  previous_signature_sha256:previous,
  candidate_digest_sha256:i===4?digest:null,
  decision:i===4?"AUTHORIZE_EXACT_CANDIDATE":"CONTINUE_REVIEW",
  human_message_ref:rec.human_message_ref,
  approved_at_unix:rec.approved_at_unix
});
const checkOneStage=({docket,rec,stage,i,base,previous,digest,key,root,errors})=>{
  const rel="delivery/constitutional-dossiers/"+docket.case_id+"-"+stage+".md";
  const blob=readSafe(root,rel);
  fail(errors,rec.stage===stage &&
    blob!==null && rec.dossier_sha256===sha(blob) &&
    RE_SHA256.test(rec.dossier_sha256||"") &&
    docket.exact_changed_paths?.includes(rel),
    stage+" must bind an immutable evidence dossier in the exact PR");
  fail(errors,typeof rec.human_message_ref==="string" && rec.human_message_ref.trim().length>0,
    stage+" requires separate direct Human evidence reference");
  fail(errors,Number.isSafeInteger(rec.approved_at_unix) && rec.approved_at_unix>0,
    stage+" requires chronological signed Human approval time");
  const sig=typeof rec.signature_base64==="string"?rec.signature_base64:"";
  const encoded=Buffer.from(JSON.stringify(approvalPayload({
    docket,rec,stage,i,base,previous,digest
  })));
  const validSig=/^[A-Za-z0-9+/=]+$/.test(sig) && Boolean(key) &&
    verifySignature(null,encoded,key,Buffer.from(sig,"base64"));
  fail(errors,validSig,stage+" must have a valid independent Human Ed25519 signature");
  return sha(Buffer.from(sig,"base64"));
};
const checkStages=({docket,base,digest,key,root,errors})=>{
  if(!Array.isArray(docket.stages) || docket.stages.length!==5){
    errors.push("CONSTITUTION: exactly five signed, independent Human decisions required");
    return;
  }
  let prev="GENESIS",last=0;
  for(let i=0;i<5;i++){
    const rec=docket.stages[i]||{};
    prev=checkOneStage({
      docket,rec,stage:CONSTITUTION_STAGES[i],i,base,previous:prev,
      digest,key,root,errors
    });
    fail(errors,Number.isSafeInteger(rec.approved_at_unix) &&
      rec.approved_at_unix>last,CONSTITUTION_STAGES[i]+" approval order must increase");
    last=rec.approved_at_unix||last;
  }
};

export function inspectConstitutionalChange({changed,base,cs,build,policy,root,trustPublicKeyB64}){
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
  const key=humanKey(trustPublicKeyB64,errors);
  checkStages({docket,base,digest,key,root,errors});
  return {errors,constitutional:true,bootstrap:false};
}

// CI-only ephemeral signing key; never the Human's real private key.
const testSignedFiveStageCase=()=>{
  const {publicKey,privateKey}=generateKeyPairSync("ed25519");
  const trusted=Buffer.from(publicKey.export({format:"pem",type:"spki"})).toString("base64");
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"appf2-constitutional-test-"));
  const id="GOV-CASE-TEST-001",base="a".repeat(40);
  const casePath="delivery/constitutional-cases/"+id+".json";
  const docPaths=CONSTITUTION_STAGES.map(stage=>
    "delivery/constitutional-dossiers/"+id+"-"+stage+".md");
  const changed=["package.json",...docPaths,casePath];
  const makeFile=(p,value)=>{
    fs.mkdirSync(path.dirname(path.join(root,p)),{recursive:true});
    fs.writeFileSync(path.join(root,p),value);
  };
  const check=(ok,label)=>{if(!ok) throw Error("CONSTITUTION SIGNATURE TEST FAIL: "+label);};
  try{
    makeFile("package.json",JSON.stringify({name:"test",dependencies:{pg:"8.0.0"}}));
    for(const [i,p] of docPaths.entries()) makeFile(p,"Human finalised R"+(i+1)+" dossier v1");
    const digest=contentDigest(root,changed.filter(p=>p!==casePath));
    const docket={
      case_id:id,base_sha:base,constitution_version:"1.0",
      exact_changed_paths:changed.filter(p=>p!==casePath),
      candidate_digest_sha256:digest,
      why5:CONSTITUTION_STAGES.map(stage=>({
        question:"Why "+stage+"?",answer:"Evidence-led test",evidence_ref:"CI-ONLY"
      })),
      stages:[]
    };
    let previous="GENESIS";
    for(let i=0;i<5;i++){
      const stage=CONSTITUTION_STAGES[i];
      const rec={
        stage,
        dossier_sha256:sha(readSafe(root,docPaths[i])),
        human_message_ref:"TEST-ONLY-DIRECT-HUMAN-R"+(i+1),
        approved_at_unix:1791600000+i*120
      };
      const payload=approvalPayload({docket,rec,stage,i,base,previous,digest});
      rec.signature_base64=signApproval(
        null,Buffer.from(JSON.stringify(payload)),privateKey
      ).toString("base64");
      docket.stages.push(rec);
      previous=sha(Buffer.from(rec.signature_base64,"base64"));
    }
    makeFile(casePath,JSON.stringify(docket));
    const args={
      changed,base,policy:{governance_only_paths:["package.json"]},
      root,trustPublicKeyB64:trusted,cs:null,build:null
    };
    check(inspectConstitutionalChange(args).errors.length===0,
      "five real independent chained stage signatures must pass");
    const altered=structuredClone(docket);
    altered.stages[2].human_message_ref="AI-DESCRIBED-SIGNATURE";
    makeFile(casePath,JSON.stringify(altered));
    check(inspectConstitutionalChange(args).errors.some(x=>x.includes("R3")),
      "AI must not change meaning/evidence of prior Human signature");
    makeFile(casePath,JSON.stringify(docket));
    makeFile("package.json",JSON.stringify({name:"test",dependencies:{pg:"9.0.0"}}));
    check(inspectConstitutionalChange(args).errors.some(x=>x.includes("PR bytes changed after approval")),
      "candidate dependency drift after R5 signature must fail");
    return 3;
  }finally{fs.rmSync(root,{recursive:true,force:true});}
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
  return count+testSignedFiveStageCase();
}
