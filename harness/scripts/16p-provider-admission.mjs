// Fail-closed importer for original 16P Acceptance provider / protected proofs.
// CHECK_PASS and synthetic fixtures NEVER promote complete_real_e2e to PASS.
// Only live-verified APPF2-16P-PROVIDER-ADMISSION-1 receipts may admit PASS.
import fs from "node:fs";
import path from "node:path";

const SCHEMA="APPF2-16P-PROVIDER-ADMISSION-1";
const emptyReport=dir=>({schema:"APPF2-16P-PROVIDER-ADMISSION-REPORT-1",
  directory:dir||null,scanned:0,admitted:[],rejected:[],main_closure_admitted:0});
const nonEmpty=v=>typeof v==="string"&&v.trim().length>0;

const verifyActionsJob=(proof,gh,parse)=>{
  if(!/^\d+$/.test(String(proof.run_id||""))||!/^\d+$/.test(String(proof.job_id||"")))
    return "GITHUB_ACTIONS_JOB requires numeric run_id and job_id";
  const job=gh("actions/jobs/"+proof.job_id);
  const body=parse(job);
  if(job.exit!==0||!body)return "job "+proof.job_id+" not readable";
  if(String(body.run_id)!==String(proof.run_id))return "job/run mismatch";
  const want=proof.required_conclusion||"success";
  if(body.status!=="completed"||body.conclusion!==want)return "job conclusion not "+want;
  if(proof.required_name&&body.name!==proof.required_name)return "job name mismatch";
  return null;
};

const verifyEnvironment=(proof,gh,parse)=>{
  const envName=proof.environment||"appf2-task-human-approval";
  const e=gh("environments/"+encodeURIComponent(envName));
  const body=parse(e);
  if(e.exit!==0||!body)return "environment unreadable";
  if(body.can_admins_bypass!==false)return "environment still allows admin bypass";
  const ok=(body.protection_rules||[]).some(x=>x.type==="required_reviewers"&&
    (x.reviewers||[]).some(y=>y.type==="User"&&y.reviewer?.login==="NFF98"));
  return ok?null:"NFF98 required reviewer missing";
};

const verifyRuleset=(proof,gh,parse)=>{
  const id=String(proof.ruleset_id||"");
  if(!/^\d+$/.test(id))return "ruleset_id required";
  const rs=gh("rulesets/"+id);
  const body=parse(rs);
  if(rs.exit!==0||!body)return "ruleset unreadable";
  const checks=body.rules?.find(x=>x.type==="required_status_checks");
  if(checks?.parameters?.strict_required_status_checks_policy!==true)
    return "ruleset strict_required_status_checks_policy not true";
  const ctx=proof.required_context;
  if(ctx&&!(checks?.parameters?.required_status_checks||[]).some(x=>x.context===ctx))
    return "required context missing: "+ctx;
  return null;
};

const verifyDenial=(proof,exec,repo)=>{
  if(![403,404,405,422].includes(Number(proof.http_status)))
    return "denial http_status not a real provider rejection class";
  if(!nonEmpty(proof.path)||!nonEmpty(proof.captured_at))
    return "denial receipt path/captured_at required";
  if(proof.live_reprobe===true){
    const method=(proof.method||"GET").toUpperCase();
    const r=exec("gh",["api","-X",method,"repos/"+repo+"/"+proof.path],60000);
    if(r.exit===0)return "live reprobe unexpectedly succeeded";
  }
  return null;
};

const verifyMerge=(proof,gh,parse)=>{
  if(!/^[a-f0-9]{40}$/.test(proof.merge_commit_sha||""))return "merge_commit_sha required";
  const c=gh("commits/"+proof.merge_commit_sha);
  const body=parse(c);
  if(c.exit!==0||!body?.sha)return "merge commit unreadable";
  if(proof.required_pr&&!String(body.commit?.message||"").includes("#"+proof.required_pr))
    return "merge commit does not reference required PR";
  return null;
};

const verifyProof=(proof,ctx)=>{
  if(!proof||typeof proof!=="object"||!proof.kind)return "proof.kind required";
  if(proof.kind==="GITHUB_ACTIONS_JOB")return verifyActionsJob(proof,ctx.gh,ctx.parse);
  if(proof.kind==="GITHUB_ENVIRONMENT_NO_ADMIN_BYPASS")
    return verifyEnvironment(proof,ctx.gh,ctx.parse);
  if(proof.kind==="GITHUB_RULESET_STRICT_CONTEXT")return verifyRuleset(proof,ctx.gh,ctx.parse);
  if(proof.kind==="GITHUB_API_DENIAL_RECEIPT")return verifyDenial(proof,ctx.exec,ctx.repo);
  if(proof.kind==="MAIN_MERGE_COMMIT")return verifyMerge(proof,ctx.gh,ctx.parse);
  return "unknown proof.kind: "+proof.kind;
};

const validateDoc=(doc,required,head)=>{
  if(doc?.schema!==SCHEMA)return "schema must be "+SCHEMA;
  if(!required.includes(doc.item_id))return "unknown item_id";
  if(doc.claimed_complete_real_e2e!=="PASS")return "only claimed PASS admissions are accepted";
  if(doc.bound_head_sha&&doc.bound_head_sha!==head)return "bound_head_sha mismatch";
  if(doc.forbids_check_pass_promotion!==true)return "must declare forbids_check_pass_promotion=true";
  if(doc.never_converts_fail_or_untested_to_pass!==true)
    return "must declare never_converts_fail_or_untested_to_pass=true";
  if(!Array.isArray(doc.provider_proofs)||!doc.provider_proofs.length)
    return "provider_proofs required";
  return null;
};

const applyAdmission=(row,doc,file,evidenceDir)=>{
  row.complete_real_e2e="PASS";
  row.protected_mutation_performed=doc.protected_mutation_performed===true;
  row.provider_prewrite_authority_verified=doc.provider_proofs.some(p=>
    p.kind==="GITHUB_API_DENIAL_RECEIPT"||p.kind==="GITHUB_ENVIRONMENT_NO_ADMIN_BYPASS");
  row.provider_admission={file,schema:doc.schema,proof_kinds:doc.provider_proofs.map(p=>p.kind)};
  fs.writeFileSync(path.join(evidenceDir,doc.item_id+".json"),JSON.stringify(row,null,2)+"\n");
};

const admitOne=(file,dir,ctx)=>{
  const full=path.join(dir,file);
  let doc;
  try{doc=JSON.parse(fs.readFileSync(full,"utf8"));}
  catch{return {ok:false,file,reason:"invalid JSON"};}
  const schemaErr=validateDoc(doc,ctx.required,ctx.head);
  if(schemaErr)return {ok:false,file,item_id:doc?.item_id||null,reason:schemaErr};
  const row=ctx.rows.find(r=>r.id===doc.item_id);
  if(!row)return {ok:false,file,item_id:doc.item_id,reason:"row missing"};
  if(row.operation_verdict==="FAIL")
    return {ok:false,file,item_id:doc.item_id,reason:"cannot admit FAIL operation row"};
  const proofErrors=doc.provider_proofs.map(p=>verifyProof(p,ctx)).filter(Boolean);
  if(proofErrors.length)
    return {ok:false,file,item_id:doc.item_id,reason:proofErrors.join("; ")};
  applyAdmission(row,doc,file,ctx.evidenceDir);
  return {ok:true,file,item_id:doc.item_id,counts_as_main_closure:doc.counts_as_main_closure===true};
};

/** @param {object} ctx {required,rows,head,repo,gh,parse,exec,evidenceDir,fatal} */
export function admitProviderReceipts(ctx){
  const dir=process.env.APPF2_16P_PROVIDER_RECEIPTS_DIR||"";
  const report=emptyReport(dir||null);
  if(!dir){
    console.log("16P PROVIDER ADMISSION: no APPF2_16P_PROVIDER_RECEIPTS_DIR; 0 imports");
    return report;
  }
  if(!fs.existsSync(dir)||!fs.statSync(dir).isDirectory()){
    ctx.fatal.push("APPF2_16P_PROVIDER_RECEIPTS_DIR missing or not a directory: "+dir);
    return report;
  }
  const files=fs.readdirSync(dir).filter(n=>n.endsWith(".json")).sort();
  report.scanned=files.length;
  for(const file of files){
    const r=admitOne(file,dir,ctx);
    if(!r.ok){
      report.rejected.push({file:r.file,item_id:r.item_id||null,reason:r.reason});
      ctx.fatal.push("provider receipt "+r.file+": "+r.reason);
      continue;
    }
    report.admitted.push(r.item_id);
    if(r.counts_as_main_closure)report.main_closure_admitted++;
    console.log("16P "+r.item_id+" | PROVIDER_ADMITTED complete_real_e2e=PASS | "+r.file);
  }
  return report;
}
