// APPF2-16P-ACCEPTANCE-LEASE: Product HOLD-compatible, time-boxed Task lease for 16P REAL E2E.
// Authority requires Main-ref lease + approved Activation docket. Local CURRENT.json alone never grants.
// Does not activate Sprint4, does not mutate T006/T008/T009, does not flip connector proven=true.
import fs from "node:fs";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {GOVERNANCE_REFORM_POLICY_PATH} from "./human-exception.mjs";

export const LEASE_REL="delivery/16p-acceptance-lease/CURRENT.json";
export const LEASE_SCHEMA="APPF2-16P-ACCEPTANCE-LEASE-1";
export const DEFAULT_PERMITTED_WRITE_PREFIXES=Object.freeze([
  "delivery/16p-acceptance-lease/",
  "delivery/audits/",
  "harness/scripts/"
]);
const RE_TASK=/^T\d{3}$/;
const RE_CASE=/^GOV-[A-Z0-9-]{3,90}$/;
const nonEmpty=v=>typeof v==="string"&&v.trim().length>0;
const isUnix=v=>Number.isSafeInteger(v)&&v>0;

export function loadLeasePolicy(root=process.cwd()){
  try{
    const full=JSON.parse(fs.readFileSync(path.join(root,GOVERNANCE_REFORM_POLICY_PATH),"utf8"));
    return full.sixteen_p_acceptance_lease||null;
  }catch{return null;}
}

/** Local read for inspection only — never sufficient for Task authority by itself. */
export function readSixteenPLease(root=process.cwd()){
  const p=path.join(root,LEASE_REL);
  if(!fs.existsSync(p)) return null;
  try{return JSON.parse(fs.readFileSync(p,"utf8"));}catch{return null;}
}

const pathEscapes=p=>!nonEmpty(p)||p.includes("\0")||p.includes("..")||p.startsWith("/")||
  /^[A-Za-z]:/.test(p)||p.includes("\\");

/** Every lease allowed_write_paths entry must sit under a policy-permitted prefix. */
export function writePathErrors(paths,permittedPrefixes){
  const prefixes=permittedPrefixes?.length?permittedPrefixes:DEFAULT_PERMITTED_WRITE_PREFIXES;
  if(!Array.isArray(paths)||!paths.length||!paths.every(nonEmpty)) return ["allowed_write_paths required"];
  const errors=[];
  for(const p of paths){
    if(pathEscapes(p)){errors.push("allowed_write_paths unsafe: "+p);continue;}
    if(!prefixes.some(pre=>p===pre||(pre.endsWith("/")&&p.startsWith(pre))||p===pre.replace(/\/$/,"")))
      errors.push("allowed_write_paths not under permitted prefix: "+p);
    if(p.startsWith("src/")||p.startsWith("delivery/sprints/")||p==="delivery/CURRENT-SPRINT.json"||
       p.startsWith("build-spec/")||p==="package.json"||p.startsWith("delivery/backlog/")||
       p.startsWith("delivery/evidence/"))
      errors.push("allowed_write_paths opens forbidden Product/Sprint/Build area: "+p);
  }
  return errors;
}

/** Pure structural + policy validation. Does not grant GitHub write authority. */
export function validateSixteenPLeaseDocument(lease,{now=Math.floor(Date.now()/1000),policy=null}={}){
  const errors=[],pol=policy||{};
  if(!lease||typeof lease!=="object") return ["lease document missing"];
  if(lease.schema!==(pol.lease_schema||LEASE_SCHEMA)) errors.push("lease.schema mismatch");
  if(!nonEmpty(lease.lease_id)) errors.push("lease_id required");
  if(!RE_TASK.test(lease.task_id||"")) errors.push("task_id must match T###");
  const forbidden=new Set(pol.forbidden_reuse_task_ids||["T006","T008","T009"]);
  if(forbidden.has(lease.task_id)) errors.push("task_id reuses forbidden historical Task: "+lease.task_id);
  if(pol.canonical_task_id && lease.task_id!==pol.canonical_task_id)
    errors.push("task_id must be canonical "+pol.canonical_task_id+" for 16P acceptance lease");
  if((pol.forbidden_sprint_ids||[]).includes(lease.bound_sprint_id))
    errors.push("bound_sprint_id forbids Sprint4 / listed sprint: "+lease.bound_sprint_id);
  if(lease.bound_sprint_id!=null) errors.push("bound_sprint_id must be null (Product HOLD preserved; no Sprint activation)");
  if(lease.product_hold_preserved!==true) errors.push("product_hold_preserved must be true");
  if(lease.never_converts_fail_or_untested_to_pass!==true)
    errors.push("never_converts_fail_or_untested_to_pass must be true");
  if(lease.sprint4_forbidden!==true) errors.push("sprint4_forbidden must be true");
  if(!["PENDING","ACTIVE","EXPIRED","REVOKED"].includes(lease.status))
    errors.push("status invalid");
  if(lease.status==="REVOKED") errors.push("lease revoked");
  if(lease.status==="EXPIRED") errors.push("lease expired (status)");
  errors.push(...writePathErrors(lease.allowed_write_paths,
    pol.permitted_allowed_write_path_prefixes||DEFAULT_PERMITTED_WRITE_PREFIXES));
  if(!RE_CASE.test(lease.activation_case_id||"")) errors.push("activation_case_id required");
  if(lease.direct_connector_prewrite_proven===true)
    errors.push("lease must not self-attest direct_connector_prewrite_proven=true");

  if(lease.status==="ACTIVE"){
    if(!isUnix(lease.activated_at_unix)) errors.push("ACTIVE lease requires activated_at_unix");
    if(!isUnix(lease.expires_at_unix)) errors.push("expires_at_unix required");
    if(isUnix(lease.activated_at_unix)&&isUnix(lease.expires_at_unix)){
      if(!(lease.activated_at_unix<=now && now<lease.expires_at_unix))
        errors.push("ACTIVE lease requires activated_at_unix <= now < expires_at_unix");
      const maxTtl=pol.max_ttl_seconds||1209600;
      const ttl=lease.expires_at_unix-lease.activated_at_unix;
      if(!(ttl>0&&ttl<=maxTtl)) errors.push("TTL must be >0 and <= policy max_ttl_seconds (14d)");
    }
  }else if(lease.status==="PENDING"){
    // PENDING may omit window; still reject absurd future windows if both set.
    if(isUnix(lease.activated_at_unix)&&isUnix(lease.expires_at_unix)){
      const maxTtl=pol.max_ttl_seconds||1209600;
      const ttl=lease.expires_at_unix-lease.activated_at_unix;
      if(!(ttl>0&&ttl<=maxTtl)) errors.push("TTL must be >0 and <= policy max_ttl_seconds (14d)");
    }
  }else if(!isUnix(lease.expires_at_unix)&&lease.status!=="PENDING"){
    errors.push("expires_at_unix required");
  }
  return errors;
}

/** Activation docket on Main must be Human exact-candidate for 16P_ACCEPTANCE_LEASE. */
export function validateSixteenPActivationDocket(activationDocket,lease,{now=Math.floor(Date.now()/1000)}={}){
  const errors=[];
  if(!activationDocket||typeof activationDocket!=="object") return ["activation docket missing on Main"];
  if(activationDocket.case_id!==lease?.activation_case_id)
    errors.push("activation docket case_id must equal lease.activation_case_id");
  const s=activationDocket.scope_exception||{};
  if(s.schema!=="APPF2-HUMAN-EXCEPTION-1") errors.push("activation scope_exception.schema invalid");
  if(s.lane!=="16P_ACCEPTANCE_LEASE") errors.push("activation lane must be 16P_ACCEPTANCE_LEASE");
  if(s.never_converts_fail_or_untested_to_pass!==true)
    errors.push("activation must declare never_converts_fail_or_untested_to_pass");
  if(s.product_hold_preserved!==true) errors.push("activation product_hold_preserved must be true");
  if(s.sprint4_forbidden!==true) errors.push("activation sprint4_forbidden must be true");
  if(s.affected_sprint!=null) errors.push("activation affected_sprint must be null");
  const tasks=s.affected_tasks||[];
  if(tasks.length!==1||tasks[0]!=="T016") errors.push("activation affected_tasks must be [\"T016\"]");
  const a=activationDocket.human_approval;
  if(!a||a.decision!=="APPROVE_EXACT_CANDIDATE"||a.scope!=="EXACT_PR_DIFF")
    errors.push("activation requires Human APPROVE_EXACT_CANDIDATE / EXACT_PR_DIFF");
  if(a&&a.case_id!==activationDocket.case_id) errors.push("activation approval case_id mismatch");
  if(a&&a.candidate_digest_sha256!==activationDocket.candidate_digest_sha256)
    errors.push("activation approval digest mismatch");
  if(isUnix(s.expires_at_unix)&&now>s.expires_at_unix) errors.push("activation exception expired");
  if(activationDocket.status==="REVOKED"||lease?.status==="REVOKED") errors.push("activation/lease revoked");
  const paths=activationDocket.exact_changed_paths||[];
  if(!paths.includes(LEASE_REL)) errors.push("activation exact_changed_paths must include "+LEASE_REL);
  return errors;
}

/**
 * Single authority evaluation used by Gate, preflight, guarded-write, and 16p-real-e2e.
 * source must be "main" — local working-tree lease alone is never ok.
 */
export function evaluateSixteenPLeaseAuthority({
  lease,activationDocket,now=Math.floor(Date.now()/1000),policy=null,source=null
}={}){
  const errors=[];
  if(source!=="main") errors.push("16P lease authority requires source=main (local CURRENT.json is insufficient)");
  const pol=policy||{};
  errors.push(...validateSixteenPLeaseDocument(lease,{now,policy:pol}));
  if(lease?.status!=="ACTIVE") errors.push("lease must be ACTIVE for authority");
  errors.push(...validateSixteenPActivationDocket(activationDocket,lease,{now}));
  return {ok:errors.length===0,errors,lease:errors.length===0?lease:null,source};
}

export function isActiveSixteenPLease(lease,opts={}){
  // Structural ACTIVE check only — not authority. Prefer evaluateSixteenPLeaseAuthority for grants.
  return validateSixteenPLeaseDocument(lease,opts).length===0 && lease?.status==="ACTIVE";
}

function ghMainJson(relPath){
  const repo=process.env.GITHUB_REPOSITORY||"NFF98/appf2-build";
  if(!process.env.GH_TOKEN&&!process.env.GITHUB_TOKEN) return {ok:false,error:"no GitHub token"};
  try{
    const raw=execFileSync("gh",["api","repos/"+repo+"/contents/"+relPath+"?ref=main"],{
      encoding:"utf8",timeout:60000,maxBuffer:8000000,env:process.env
    });
    const entry=JSON.parse(raw);
    if(entry?.type!=="file"||!entry.content) return {ok:false,error:"not a file on Main"};
    const text=Buffer.from(String(entry.content).replace(/\s/g,""),"base64").toString("utf8");
    return {ok:true,json:JSON.parse(text)};
  }catch(e){
    return {ok:false,error:String(e.message||e)};
  }
}

/** Load lease+activation from GitHub Main only. Never reads local CURRENT.json for authority. */
export function loadMainSixteenPLeaseAuthority({now=Math.floor(Date.now()/1000),policy=null,root=process.cwd()}={}){
  const pol=policy||loadLeasePolicy(root)||{};
  const leaseRes=ghMainJson(LEASE_REL);
  if(!leaseRes.ok) return {ok:false,errors:["Main lease missing/unreadable: "+leaseRes.error],lease:null,source:"main"};
  const lease=leaseRes.json;
  const actRel="delivery/constitutional-cases/"+(lease.activation_case_id||"MISSING")+".json";
  const actRes=ghMainJson(actRel);
  if(!actRes.ok) return {ok:false,errors:["Main activation docket missing/unreadable: "+actRes.error],lease:null,source:"main"};
  return evaluateSixteenPLeaseAuthority({lease,activationDocket:actRes.json,now,policy:pol,source:"main"});
}

/** Synthetic Task row for preflight when Main authority is ok and Product CURRENT stays HOLD. */
export function syntheticTaskFromLease(lease){
  if(!lease) return null;
  return {
    task_id:lease.task_id,
    status:"IN_PROGRESS",
    build_spec_id:lease.build_spec_id||null,
    allowed_write_paths:lease.allowed_write_paths,
    acceptance_links:lease.acceptance_links||[{acceptance_id:"16P-AC-LEASE",test_id:"TEST-16P-LEASE"}],
    title:lease.title||"16P acceptance lease",
    sixteen_p_acceptance_lease:true
  };
}
