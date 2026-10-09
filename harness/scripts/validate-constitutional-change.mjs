// APPf2 憲法級重大變更 Gate：Human R1..R5 非自簽證明、不可重播、一次性制憲例外。
import { createHash, createPublicKey, verify as verifySignature } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

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
const SHA256=/^[a-f0-9]{64}$/;
const BASE=/^[a-f0-9]{40}$/;
const CASE=/^GOV-[A-Z0-9-]{3,90}$/;
const sorted=xs=>[...xs].sort();
const eql=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sha=buf=>createHash("sha256").update(buf).digest("hex");
const isProtected=(p,policy)=>p==="package-lock.json" ||
  (policy.governance_only_paths||[]).some(x=>x.endsWith("/")?p.startsWith(x):p===x);

export function isOneTimeConstitutionFounding({changed,base,cs,build}){
  return base===CONSTITUTION_GENESIS_BASE &&
    eql(sorted(changed),sorted(CONSTITUTION_BOOTSTRAP_FILES)) &&
    cs?.status==="ACTIVE" && cs.active_sprint==="SP-P1-003" &&
    cs.active_task==="T006" && cs.active_build_spec==="BS-P1-024" &&
    build?.active_baseline==="BS-P1-024" && build.implementation_enabled===true;
}

const readSafe=(root,rel)=>{
  if(!/^[a-zA-Z0-9/_.-]+$/.test(rel) || rel.startsWith("/") || rel.includes("..")) return null;
  try{return fs.readFileSync(path.join(root,rel));}catch{return null;}
};
const contentDigest=(root,paths)=>{
  const digest=createHash("sha256");
  for(const p of sorted(paths)){
    const content=readSafe(root,p);
    if(!content) return null;
    digest.update(p+"\0","utf8");digest.update(content);digest.update("\0","utf8");
  }
  return digest.digest("hex");
};

export function inspectConstitutionalChange({changed,base,cs,build,policy,root,trustPublicKeyB64}){
  const errors=[];
  const protectedChanged=changed.filter(p=>isProtected(p,policy));
  if(!protectedChanged.length) return {errors,constitutional:false,bootstrap:false};
  if(isOneTimeConstitutionFounding({changed,base,cs,build})){
    const charter=readSafe(root,"harness/policy/APPF2-CONSTITUTION.md")?.toString("utf8")||"";
    if(!charter.includes("GOV-CONST-001") || !charter.includes("五次獨立 Human 審議") ||
        !charter.includes("R5")) errors.push("CONSTITUTION: founding charter required and exact identity missing");
    return {errors,constitutional:true,bootstrap:true};
  }

  // Fail closed: a self-authored label/Issue comment cannot authenticate Human. Require
  // five Ed25519 signatures against a public key from trusted GitHub Actions variables,
  // NOT a public key supplied by the candidate PR itself.
  if(!BASE.test(base||"")) errors.push("CONSTITUTION: valid canonical base SHA required");
  const cases=changed.filter(p=>/^delivery\/constitutional-cases\/GOV-[A-Z0-9-]+\.json$/.test(p));
  if(cases.length!==1) errors.push("CONSTITUTION: exactly one changed constitutional case docket required");
  let docket=null;
  if(cases.length===1){
    try{docket=JSON.parse(readSafe(root,cases[0])?.toString("utf8")||"");}
    catch{errors.push("CONSTITUTION: docket JSON missing or invalid");}
  }
  if(!docket) return {errors,constitutional:true,bootstrap:false};

  const expectedCasePath="delivery/constitutional-cases/"+docket.case_id+".json";
  if(!CASE.test(docket.case_id||"") || cases[0]!==expectedCasePath)
    errors.push("CONSTITUTION: case_id/path invalid");
  if(docket.base_sha!==base) errors.push("CONSTITUTION: dossier base SHA differs from PR base");
  if(docket.constitution_version!=="1.0") errors.push("CONSTITUTION: unsupported constitution version");
  const changedExceptCase=changed.filter(p=>!cases.includes(p));
  if(!Array.isArray(docket.exact_changed_paths) ||
     !eql(sorted(docket.exact_changed_paths),sorted(changedExceptCase)) ||
     new Set(docket.exact_changed_paths).size!==docket.exact_changed_paths.length)
    errors.push("CONSTITUTION: exact_changed_paths must match complete PR diff");
  const actualDiffDigest=contentDigest(root,changedExceptCase);
  if(!actualDiffDigest || docket.candidate_digest_sha256!==actualDiffDigest)
    errors.push("CONSTITUTION: PR content digest mismatch (dossier/scope drift)");
  if(!Array.isArray(docket.why5) || docket.why5.length!==5 ||
     docket.why5.some(x=>!x || typeof x.question!=="string" || !x.question ||
       typeof x.evidence_ref!=="string" || !x.evidence_ref ||
       typeof x.answer!=="string" || !x.answer))
    errors.push("CONSTITUTION: five evidence-linked Whys required");

  let trustedKey=null;
  try{
    if(!trustPublicKeyB64) throw Error("unset");
    trustedKey=createPublicKey(Buffer.from(trustPublicKeyB64,"base64").toString("utf8"));
    if(trustedKey.asymmetricKeyType!=="ed25519") throw Error("not Ed25519");
  }catch{errors.push("CONSTITUTION: trusted human Ed25519 public key missing/invalid; deny by default");}
  if(!Array.isArray(docket.stages) || docket.stages.length!==5)
    errors.push("CONSTITUTION: exactly five independent signed human stages required");
  else{
    let previous="GENESIS",lastTime=0;
    for(let i=0;i<5;i++){
      const stage=CONSTITUTION_STAGES[i],rec=docket.stages[i]||{};
      const rel="delivery/constitutional-dossiers/"+docket.case_id+"-"+stage+".md";
      const actualDossierHash=sha(readSafe(root,rel)||Buffer.alloc(0));
      const action=i===4?"AUTHORIZE_EXACT_CANDIDATE":"CONTINUE_REVIEW";
      const payload={
        protocol:"APPF2-CONSTITUTION-1.0",
        case_id:docket.case_id,
        stage,
        stage_number:i+1,
        canonical_base_sha:base,
        dossier_sha256:rec.dossier_sha256,
        previous_signature_sha256:previous,
        candidate_digest_sha256:i===4?actualDiffDigest:null,
        decision:action
      };
      if(rec.stage!==stage || rec.dossier_sha256!==actualDossierHash ||
         !SHA256.test(rec.dossier_sha256||"") || !Array.isArray(docket.exact_changed_paths) ||
         !docket.exact_changed_paths.includes(rel))
        errors.push("CONSTITUTION: "+stage+" signed dossier not present/matching exact PR scope");
      if(typeof rec.human_message_ref!=="string" || !rec.human_message_ref.trim())
        errors.push("CONSTITUTION: "+stage+" lacks separate Human approval evidence reference");
      if(!Number.isInteger(rec.approved_at_unix) || rec.approved_at_unix<=lastTime)
        errors.push("CONSTITUTION: "+stage+" timestamps must strictly increase");
      lastTime=rec.approved_at_unix||lastTime;
      const sig=rec.signature_base64;
      if(!sig || !/^[A-Za-z0-9+/=]+$/.test(sig) || !trustedKey ||
        !verifySignature(null,Buffer.from(JSON.stringify(payload)),trustedKey,Buffer.from(sig||"","base64")))
        errors.push("CONSTITUTION: "+stage+" missing/invalid independent Human signature");
      previous=typeof sig==="string"?sha(Buffer.from(sig,"base64")):"INVALID";
    }
  }
  return {errors,constitutional:true,bootstrap:false};
}

// Regressions run inside standard Governance Gate. No secret key and no Human
// approval means no path should be able to slip through except exact genesis PR.
export function testConstitutionFailClosed(){
  const basic={base:CONSTITUTION_GENESIS_BASE,
    changed:[...CONSTITUTION_BOOTSTRAP_FILES],
    cs:{status:"ACTIVE",active_sprint:"SP-P1-003",active_task:"T006",active_build_spec:"BS-P1-024"},
    build:{active_baseline:"BS-P1-024",implementation_enabled:true}};
  const expect=(truth,label)=>{if(!truth) throw Error("CONSTITUTION SELF TEST FAIL: "+label);};
  let count=0;
  expect(isOneTimeConstitutionFounding(basic),"valid exact genesis");count++;
  for(const [label,patch] of [
    ["extra-package",{changed:[...basic.changed,"package.json"]}],
    ["rogue-source",{changed:[...basic.changed,"src/edge/intent-api.ts"]}],
    ["new-base",{base:"a".repeat(40)}],
    ["another-task",{cs:{...basic.cs,active_task:"T009"}}],
    ["not-all-files",{changed:basic.changed.slice(1)}],
    ["after-merge",{base:"b".repeat(40)}]
  ]){expect(!isOneTimeConstitutionFounding({...basic,...patch}),label);count++;}
  const policy={governance_only_paths:["harness/","package.json","AGENTS.md"]};
  const r=inspectConstitutionalChange({
    ...basic,base:"a".repeat(40),changed:["package.json"],
    root:"/non-existent",policy,trustPublicKeyB64:""
  });
  expect(r.errors.length>0,"unsigned package.json must fail");count++;
  const r2=inspectConstitutionalChange({
    ...basic,base:"a".repeat(40),changed:["package-lock.json"],
    root:"/non-existent",policy,trustPublicKeyB64:""
  });
  expect(r2.errors.length>0,"unsigned package-lock.json must fail");count++;
  const r3=inspectConstitutionalChange({
    ...basic,base:"a".repeat(40),changed:["src/example.ts"],
    root:"/non-existent",policy,trustPublicKeyB64:""
  });
  expect(!r3.errors.length,"unprotected ordinary task not subject to constitution");count++;
  return count;
}
