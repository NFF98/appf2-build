// Fail-closed importer for original 16P Acceptance provider / protected proofs.
// CHECK_PASS, NOT_RUN, AUTHORITY_REQUIRED, synthetic fixtures NEVER promote PASS.
// Only live-verified APPF2-16P-PROVIDER-ADMISSION-1 receipts may admit PASS.
// Receipts NEVER trigger GitHub write methods (GET/read-only verification only).
// Merge ≠ Closure. Batch is all-or-nothing. No live Task ⇒ no Task-lifecycle PASS.
import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";

const SCHEMA="APPF2-16P-PROVIDER-ADMISSION-1";
const RE_SHA=/^[a-f0-9]{40}$/;
const RE_DIGITS=/^\d+$/;
const BLOCKED_VERDICTS=new Set(["FAIL","NOT_RUN","AUTHORITY_REQUIRED"]);
const WRITE_METHODS=new Set(["POST","PUT","PATCH","DELETE"]);
const SOLE_INSUFFICIENT=new Set(["GITHUB_API_DENIAL_RECEIPT"]);
/** Items whose PASS would imply a live Task lifecycle. Historical T008 ≠ live Task. */
const TASK_LIFECYCLE_ITEMS=new Set(["1","2","4","5","6","A","B","E"]);
const emptyReport=dir=>({schema:"APPF2-16P-PROVIDER-ADMISSION-REPORT-1",
  directory:dir||null,scanned:0,admitted:[],rejected:[],main_closure_admitted:0});
const nonEmpty=v=>typeof v==="string"&&v.trim().length>0;
const sha256=buf=>createHash("sha256").update(buf).digest("hex");
const numEq=(a,b)=>Number(a)===Number(b);

/** Canonical digest of a row's real operations — required per-item PASS evidence. */
export function itemOperationsDigest(operations){
  const norm=(operations||[]).map(o=>({command:o?.command??null,exit:o?.exit??null}));
  return sha256(JSON.stringify(norm));
}

const jobIdentityOk=(proof,doc,ctx)=>
  proof.bound_item_id===doc.item_id &&
  RE_SHA.test(proof.required_head_sha||"")&&proof.required_head_sha===ctx.head &&
  numEq(proof.required_pr_number,ctx.prNumber);

const verifyJobBody=(proof,ctx)=>{
  const job=ctx.gh("actions/jobs/"+proof.job_id);
  const body=ctx.parse(job);
  if(job.exit!==0||!body)return "job "+proof.job_id+" not readable";
  if(String(body.run_id)!==String(proof.run_id))return "job/run mismatch";
  const want=proof.required_conclusion||"success";
  if(body.status!=="completed"||body.conclusion!==want)return "job conclusion not "+want;
  if(proof.required_name&&body.name!==proof.required_name)return "job name mismatch";
  return null;
};

const verifyJobRun=(proof,ctx)=>{
  const run=ctx.gh("actions/runs/"+proof.run_id);
  const runBody=ctx.parse(run);
  if(run.exit!==0||!runBody)return "actions run not readable";
  if(runBody.head_sha!==ctx.head)return "actions run head_sha mismatch";
  const repoName=runBody.head_repository?.full_name||runBody.repository?.full_name||"";
  if(repoName&&repoName!==ctx.repo)return "actions run repository mismatch";
  const prs=runBody.pull_requests;
  if(Array.isArray(prs)&&prs.length>0&&!prs.some(p=>numEq(p.number,ctx.prNumber)))
    return "actions run not linked to candidate PR";
  return null;
};

const verifyActionsJob=(proof,doc,ctx)=>{
  if(!RE_DIGITS.test(String(proof.run_id||""))||!RE_DIGITS.test(String(proof.job_id||"")))
    return "GITHUB_ACTIONS_JOB requires numeric run_id and job_id";
  if(!jobIdentityOk(proof,doc,ctx))
    return "GITHUB_ACTIONS_JOB must bind item_id/head/PR to candidate";
  return verifyJobBody(proof,ctx)||verifyJobRun(proof,ctx);
};

const verifyEnvironment=(proof,ctx)=>{
  const envName=proof.environment||"appf2-task-human-approval";
  const e=ctx.gh("environments/"+encodeURIComponent(envName));
  const body=ctx.parse(e);
  if(e.exit!==0||!body)return "environment unreadable";
  if(body.can_admins_bypass!==false)return "environment still allows admin bypass";
  const ok=(body.protection_rules||[]).some(x=>x.type==="required_reviewers"&&
    (x.reviewers||[]).some(y=>y.type==="User"&&y.reviewer?.login==="NFF98"));
  return ok?null:"NFF98 required reviewer missing";
};

const verifyRuleset=(proof,ctx)=>{
  const id=String(proof.ruleset_id||"");
  if(!RE_DIGITS.test(id))return "ruleset_id required";
  const rs=ctx.gh("rulesets/"+id);
  const body=ctx.parse(rs);
  if(rs.exit!==0||!body)return "ruleset unreadable";
  const checks=body.rules?.find(x=>x.type==="required_status_checks");
  if(checks?.parameters?.strict_required_status_checks_policy!==true)
    return "ruleset strict_required_status_checks_policy not true";
  const name=proof.required_context;
  if(name&&!(checks?.parameters?.required_status_checks||[]).some(x=>x.context===name))
    return "required context missing: "+name;
  return null;
};

/** Denial is supporting evidence only; never executes write methods from receipt. */
const verifyDenial=(proof,ctx)=>{
  if(![403,404,405,422].includes(Number(proof.http_status)))
    return "denial http_status not a real provider rejection class";
  if(!nonEmpty(proof.path)||!nonEmpty(proof.captured_at))
    return "denial receipt path/captured_at required";
  if(nonEmpty(proof.method)&&WRITE_METHODS.has(String(proof.method).toUpperCase()))
    return "denial receipt must not request GitHub write methods";
  if(proof.live_reprobe!==true)return null;
  const route=String(proof.path).replace(/^\/+/,"");
  if(!/^[A-Za-z0-9_./?&=%-]+$/.test(route))return "denial reprobe path unsafe";
  return ctx.gh(route).exit===0?"live reprobe unexpectedly succeeded":null;
};

const verifyMergeCommitReadable=(proof,ctx)=>{
  const c=ctx.gh("commits/"+proof.merge_commit_sha);
  const body=ctx.parse(c);
  if(c.exit!==0||!body?.sha)return "merge commit unreadable";
  if(!String(body.commit?.message||"").includes("#"+ctx.prNumber))
    return "merge commit does not reference candidate PR";
  return null;
};

const verifyMergePrState=(proof,ctx)=>{
  const pr=ctx.gh("pulls/"+ctx.prNumber);
  const prBody=ctx.parse(pr);
  if(pr.exit!==0||!prBody)return "candidate PR unreadable for merge proof";
  if(prBody.merged!==true)return "candidate PR is not merged on provider";
  if(prBody.merge_commit_sha!==proof.merge_commit_sha)
    return "merge_commit_sha does not match provider PR merge_commit_sha";
  if(prBody.base?.repo?.full_name&&prBody.base.repo.full_name!==ctx.repo)
    return "merged PR base repo mismatch";
  return null;
};

/** Protected Main merge proof — never counts as Closure by itself. */
const verifyMerge=(proof,ctx)=>{
  if(!RE_SHA.test(proof.merge_commit_sha||""))return "merge_commit_sha required";
  if(!numEq(proof.required_pr,ctx.prNumber))
    return "MAIN_MERGE_COMMIT required_pr must equal candidate PR";
  return verifyMergeCommitReadable(proof,ctx)||verifyMergePrState(proof,ctx);
};

const closureIdentityOk=(proof,ctx)=>{
  if(!RE_SHA.test(proof.closure_commit_sha||""))return "closure_commit_sha required";
  if(!numEq(proof.required_pr,ctx.prNumber))
    return "MAIN_CLOSURE_ATTESTATION required_pr must equal candidate PR";
  if(RE_SHA.test(proof.merge_commit_sha||"")&&proof.merge_commit_sha===proof.closure_commit_sha)
    return "closure_commit_sha must not equal merge_commit_sha; Merge≠Closure";
  return null;
};

const closurePrPrerequisite=(proof,ctx)=>{
  const pr=ctx.gh("pulls/"+ctx.prNumber);
  const prBody=ctx.parse(pr);
  if(pr.exit!==0||!prBody)return "candidate PR unreadable for closure proof";
  if(prBody.merged!==true)return "closure attestation requires merged PR prerequisite";
  if(prBody.merge_commit_sha===proof.closure_commit_sha)
    return "provider merge_commit_sha cannot serve as closure_commit_sha";
  return null;
};

const closureCommitMessage=(proof,ctx)=>{
  const c=ctx.gh("commits/"+proof.closure_commit_sha);
  const body=ctx.parse(c);
  if(c.exit!==0||!body?.sha)return "closure commit unreadable";
  const msg=String(body.commit?.message||"");
  if(!/APPROVE_CLOSURE|TASK_CLOSURE/i.test(msg))
    return "closure commit message missing APPROVE_CLOSURE/TASK_CLOSURE attestation";
  if(!msg.includes("#"+ctx.prNumber))
    return "closure commit does not reference candidate PR";
  return null;
};

/** Distinct Closure attestation. Merge commit SHA must never serve as closure SHA. */
const verifyMainClosure=(proof,ctx)=>
  closureIdentityOk(proof,ctx)||closurePrPrerequisite(proof,ctx)||closureCommitMessage(proof,ctx);

/** Per-item real operation evidence bound to the live 16P row.operations. */
const verifyItemOpEvidence=(proof,doc,row)=>{
  if(proof.bound_item_id!==doc.item_id)
    return "ITEM_OPERATION_EVIDENCE bound_item_id must equal receipt item_id";
  if(!Array.isArray(row.operations)||!row.operations.length)
    return "row has no real operations to bind";
  const exits=row.operations.map(o=>o.exit);
  if(!Array.isArray(proof.observed_exits)||proof.observed_exits.length!==exits.length)
    return "ITEM_OPERATION_EVIDENCE observed_exits length mismatch";
  if(!proof.observed_exits.every((e,i)=>Number(e)===Number(exits[i])))
    return "ITEM_OPERATION_EVIDENCE observed_exits mismatch row.operations";
  const want=itemOperationsDigest(row.operations);
  if(proof.operations_digest!==want)
    return "ITEM_OPERATION_EVIDENCE operations_digest mismatch for this item";
  return null;
};

const verifyProof=(proof,doc,ctx,row)=>{
  if(!proof||typeof proof!=="object"||!proof.kind)return "proof.kind required";
  if(proof.kind==="ITEM_OPERATION_EVIDENCE")return verifyItemOpEvidence(proof,doc,row);
  if(proof.kind==="GITHUB_ACTIONS_JOB")return verifyActionsJob(proof,doc,ctx);
  if(proof.kind==="GITHUB_ENVIRONMENT_NO_ADMIN_BYPASS")return verifyEnvironment(proof,ctx);
  if(proof.kind==="GITHUB_RULESET_STRICT_CONTEXT")return verifyRuleset(proof,ctx);
  if(proof.kind==="GITHUB_API_DENIAL_RECEIPT")return verifyDenial(proof,ctx);
  if(proof.kind==="MAIN_MERGE_COMMIT")return verifyMerge(proof,ctx);
  if(proof.kind==="MAIN_CLOSURE_ATTESTATION")return verifyMainClosure(proof,ctx);
  return "unknown proof.kind: "+proof.kind;
};

const validateIdentity=(doc,ctx)=>{
  if(doc?.schema!==SCHEMA)return "schema must be "+SCHEMA;
  if(!ctx.required.includes(doc.item_id))return "unknown item_id";
  if(doc.claimed_complete_real_e2e!=="PASS")return "only claimed PASS admissions are accepted";
  if(!RE_SHA.test(doc.bound_head_sha||"")||doc.bound_head_sha!==ctx.head)
    return "bound_head_sha required and must equal candidate HEAD";
  if(!Number.isInteger(Number(doc.bound_pr_number))||!numEq(doc.bound_pr_number,ctx.prNumber))
    return "bound_pr_number required and must equal candidate PR";
  if(!nonEmpty(doc.bound_repo)||doc.bound_repo!==ctx.repo)
    return "bound_repo required and must equal candidate repo";
  return null;
};

const validateTaskBinding=(doc,ctx)=>{
  if(nonEmpty(ctx.taskId)){
    if(!nonEmpty(doc.bound_task_id)||doc.bound_task_id!==ctx.taskId)
      return "bound_task_id required and must equal live Main active_task";
  }else if(nonEmpty(doc.bound_task_id)){
    return "bound_task_id present but runner has no live Main active_task";
  }else if(TASK_LIFECYCLE_ITEMS.has(doc.item_id)){
    return "no live Main active_task; cannot admit Task lifecycle item "+doc.item_id;
  }
  return null;
};

const validateFlagsAndProofs=(doc)=>{
  if(doc.forbids_check_pass_promotion!==true)
    return "must declare forbids_check_pass_promotion=true";
  if(doc.never_converts_fail_or_untested_to_pass!==true)
    return "must declare never_converts_fail_or_untested_to_pass=true";
  if(Object.hasOwn(doc,"counts_as_main_closure"))
    return "counts_as_main_closure self-declaration forbidden; use MAIN_CLOSURE_ATTESTATION proof";
  if(!Array.isArray(doc.provider_proofs)||!doc.provider_proofs.length)
    return "provider_proofs required";
  const kinds=doc.provider_proofs.map(p=>p?.kind);
  if(!kinds.includes("ITEM_OPERATION_EVIDENCE"))
    return "ITEM_OPERATION_EVIDENCE required for each PASS admission";
  if(kinds.every(k=>SOLE_INSUFFICIENT.has(k)||k==="ITEM_OPERATION_EVIDENCE"))
    return "ITEM_OPERATION_EVIDENCE alone (or with denial only) cannot admit PASS; need protected provider proof";
  if(kinds.every(k=>SOLE_INSUFFICIENT.has(k)))
    return "HTTP denial alone cannot admit PASS; need protected non-denial proof";
  if(kinds.includes("GITHUB_ACTIONS_JOB")&&
     !doc.provider_proofs.some(p=>p?.kind==="GITHUB_ACTIONS_JOB"&&p.bound_item_id===doc.item_id))
    return "GITHUB_ACTIONS_JOB must bind bound_item_id to this item";
  return null;
};

const validateBinding=(doc,ctx)=>
  validateIdentity(doc,ctx)||validateTaskBinding(doc,ctx)||validateFlagsAndProofs(doc);

const validateRow=(row)=>{
  if(!row)return "row missing";
  if(BLOCKED_VERDICTS.has(row.operation_verdict))
    return "cannot admit blocked operation_verdict="+row.operation_verdict;
  if(row.complete_real_e2e==="PASS")
    return "item already PASS; replay/duplicate admission forbidden";
  return null;
};

const applyAdmission=(row,doc,file,evidenceDir,flags)=>{
  row.complete_real_e2e="PASS";
  row.protected_mutation_performed=flags.hasMerge===true;
  row.provider_prewrite_authority_verified=doc.provider_proofs.some(p=>
    p.kind==="GITHUB_ENVIRONMENT_NO_ADMIN_BYPASS");
  row.provider_admission={file,schema:doc.schema,
    proof_kinds:doc.provider_proofs.map(p=>p.kind),
    bound_head_sha:doc.bound_head_sha,bound_pr_number:doc.bound_pr_number,
    bound_repo:doc.bound_repo,bound_task_id:doc.bound_task_id||null,
    main_closure_attested:flags.hasClosure===true};
  fs.writeFileSync(path.join(evidenceDir,doc.item_id+".json"),JSON.stringify(row,null,2)+"\n");
};

const readReceipt=(full)=>{
  try{const raw=fs.readFileSync(full);return {raw,doc:JSON.parse(raw.toString("utf8"))};}
  catch{return null;}
};

const validateOne=(file,dir,ctx,seenItems,seenDigests)=>{
  const parsed=readReceipt(path.join(dir,file));
  if(!parsed)return {ok:false,file,reason:"invalid JSON"};
  const {raw,doc}=parsed;
  const digest=sha256(raw);
  if(seenDigests.has(digest))
    return {ok:false,file,item_id:doc?.item_id||null,reason:"replay: duplicate receipt digest"};
  seenDigests.add(digest);
  const schemaErr=validateBinding(doc,ctx);
  if(schemaErr)return {ok:false,file,item_id:doc?.item_id||null,reason:schemaErr};
  if(seenItems.has(doc.item_id))
    return {ok:false,file,item_id:doc.item_id,reason:"replay: duplicate item_id in batch"};
  seenItems.add(doc.item_id);
  const row=ctx.rows.find(r=>r.id===doc.item_id);
  const rowErr=validateRow(row);
  if(rowErr)return {ok:false,file,item_id:doc.item_id,reason:rowErr};
  const proofErrors=doc.provider_proofs.map(p=>verifyProof(p,doc,ctx,row)).filter(Boolean);
  if(proofErrors.length)
    return {ok:false,file,item_id:doc.item_id,reason:proofErrors.join("; ")};
  return {ok:true,file,item_id:doc.item_id,doc,row,digest,
    hasMerge:doc.provider_proofs.some(p=>p.kind==="MAIN_MERGE_COMMIT"),
    hasClosure:doc.provider_proofs.some(p=>p.kind==="MAIN_CLOSURE_ATTESTATION")};
};

const rejectOne=(report,fatal,r)=>{
  report.rejected.push({file:r.file,item_id:r.item_id||null,reason:r.reason});
  fatal.push("provider receipt "+r.file+": "+r.reason);
};

const applyAccepted=(accepted,report)=>{
  for(const r of accepted){
    applyAdmission(r.row,r.doc,r.file,r.evidenceDir,
      {hasMerge:r.hasMerge,hasClosure:r.hasClosure});
    report.admitted.push(r.item_id);
    // Merge never increments closure count; only MAIN_CLOSURE_ATTESTATION does.
    if(r.hasClosure)report.main_closure_admitted++;
    console.log("16P "+r.item_id+" | PROVIDER_ADMITTED complete_real_e2e=PASS | "+r.file);
  }
};

/** All-or-nothing: any rejection aborts the entire batch; zero PASS writes. */
const commitBatch=(accepted,report,ctx)=>{
  if(report.rejected.length>0){
    for(const r of accepted){
      rejectOne(report,ctx.fatal,{file:r.file,item_id:r.item_id,
        reason:"batch aborted: sibling receipt rejected (all-or-nothing)"});
    }
    return;
  }
  applyAccepted(accepted,report);
};

const ctxReady=ctx=>RE_SHA.test(ctx.head||"")&&Number.isInteger(Number(ctx.prNumber))&&
  Number(ctx.prNumber)>0&&nonEmpty(ctx.repo);

/**
 * Two-phase admit: validate ALL receipts first; commit only if zero rejects.
 * @param {object} ctx {required,rows,head,prNumber,repo,taskId,gh,parse,evidenceDir,fatal}
 *   taskId must be live Main active_task only (never historical HOLD T008).
 */
export function admitProviderReceipts(ctx){
  const dir=process.env.APPF2_16P_PROVIDER_RECEIPTS_DIR||"";
  const report=emptyReport(dir||null);
  if(!dir){
    console.log("16P PROVIDER ADMISSION: no APPF2_16P_PROVIDER_RECEIPTS_DIR; 0 imports");
    return report;
  }
  if(!ctxReady(ctx)){
    ctx.fatal.push("provider admission ctx missing required head/prNumber/repo");
    return report;
  }
  if(!fs.existsSync(dir)||!fs.statSync(dir).isDirectory()){
    ctx.fatal.push("APPF2_16P_PROVIDER_RECEIPTS_DIR missing or not a directory: "+dir);
    return report;
  }
  const files=fs.readdirSync(dir).filter(n=>n.endsWith(".json")).sort();
  report.scanned=files.length;
  const seenItems=new Set(),seenDigests=new Set(),accepted=[];
  for(const file of files){
    const r=validateOne(file,dir,ctx,seenItems,seenDigests);
    if(!r.ok){rejectOne(report,ctx.fatal,r);continue;}
    accepted.push({...r,evidenceDir:ctx.evidenceDir});
  }
  commitBatch(accepted,report,ctx);
  return report;
}
