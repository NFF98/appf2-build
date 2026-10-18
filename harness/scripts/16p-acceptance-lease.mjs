// APPF2-16P-ACCEPTANCE-LEASE: Product HOLD-compatible, time-boxed Task lease for 16P REAL E2E.
// Does not activate Sprint4, does not mutate T006/T008/T009, does not flip connector proven=true.
import fs from "node:fs";
import path from "node:path";
import {GOVERNANCE_REFORM_POLICY_PATH} from "./human-exception.mjs";

export const LEASE_REL="delivery/16p-acceptance-lease/CURRENT.json";
export const LEASE_SCHEMA="APPF2-16P-ACCEPTANCE-LEASE-1";
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

export function readSixteenPLease(root=process.cwd()){
  const p=path.join(root,LEASE_REL);
  if(!fs.existsSync(p)) return null;
  try{return JSON.parse(fs.readFileSync(p,"utf8"));}catch{return null;}
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
  if(!isUnix(lease.expires_at_unix)) errors.push("expires_at_unix required");
  if(!isUnix(lease.activated_at_unix)&&lease.status==="ACTIVE") errors.push("ACTIVE lease requires activated_at_unix");
  if(lease.status==="ACTIVE"){
    if(lease.expires_at_unix<=(lease.activated_at_unix||0)) errors.push("expiry must be after activation");
    const maxTtl=pol.max_ttl_seconds||1209600;
    if((lease.expires_at_unix-(lease.activated_at_unix||0))>maxTtl) errors.push("TTL exceeds policy max_ttl_seconds");
    if(now>lease.expires_at_unix) errors.push("lease expired");
  }
  if(!Array.isArray(lease.allowed_write_paths)||!lease.allowed_write_paths.length||
     !lease.allowed_write_paths.every(nonEmpty))
    errors.push("allowed_write_paths required");
  const badPath=(lease.allowed_write_paths||[]).find(p=>
    p.startsWith("src/")||p.startsWith("delivery/sprints/")||p==="delivery/CURRENT-SPRINT.json"||
    p.startsWith("build-spec/")||p==="package.json");
  if(badPath) errors.push("allowed_write_paths may not open Product/Sprint/Build pointers: "+badPath);
  if(!RE_CASE.test(lease.activation_case_id||"")) errors.push("activation_case_id required");
  if(lease.direct_connector_prewrite_proven===true)
    errors.push("lease must not self-attest direct_connector_prewrite_proven=true");
  return errors;
}

export function isActiveSixteenPLease(lease,opts={}){
  return validateSixteenPLeaseDocument(lease,opts).length===0 && lease?.status==="ACTIVE";
}

/** Synthetic Task row for preflight/guarded-write when Product CURRENT stays HOLD. */
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
