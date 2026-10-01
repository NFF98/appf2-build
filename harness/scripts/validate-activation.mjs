import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root=process.cwd(), errors=[];
const readJson=p=>JSON.parse(fs.readFileSync(path.join(root,p),"utf8"));
const exists=p=>fs.existsSync(path.join(root,p));
const current=readJson("build-spec/CURRENT.json");
const activationDir=path.join(root,"build-spec/activations");
const activationFiles=fs.existsSync(activationDir)
  ? fs.readdirSync(activationDir).filter(f=>/^BS-P\d+-\d{3}\.json$/.test(f))
  : [];

const getActivation=id=>{
  const rel="build-spec/activations/"+id+".json";
  return exists(rel)?readJson(rel):null;
};
const getBaseline=id=>{
  const rel="build-spec/baselines/"+id+"/manifest.json";
  return exists(rel)?readJson(rel):null;
};
const getDelta=id=>{
  const rel="delivery/deltas/"+id+".json";
  return exists(rel)?readJson(rel):null;
};
const deltaMatchesActivationSource=(d,sourceCommit)=>{
  if(d.upstream_working_commit===sourceCommit) return true;
  const f=d.freeze_source;
  if(!f || f.type!=="SCOPE_CLEAN_DERIVED") return false;
  if(f.commit!==sourceCommit) return false;
  if(!/^[0-9a-f]{40}$/.test(f.base_commit||"")) return false;
  if(typeof f.provenance_audit!=="string" || !f.provenance_audit.startsWith("delivery/audits/") || !exists(f.provenance_audit)) return false;
  return /^[0-9a-f]{40}$/.test(d.upstream_working_commit||"") && d.upstream_working_commit!==sourceCommit;
};
const showJsonAt=(base,rel)=>{
  try{return JSON.parse(execFileSync("git",["show",base+":"+rel],{encoding:"utf8"}));}
  catch{return null;}
};
const activationTouched=(base,head,baselineId)=>{
  let diff="";
  try{diff=execFileSync("git",["diff","--name-status","-M",base,head],{encoding:"utf8"});}
  catch{errors.push("Unable to inspect CURRENT activation diff");}
  const activationPath="build-spec/activations/"+baselineId+".json";
  const touched=diff.split("\n").some(line=>line.split("\t").slice(1).includes(activationPath));
  if(!touched) errors.push("CURRENT transition requires Activation Record in the same change: "+activationPath);
};
const validateRebaseline=(base,oldCurrent,current,a)=>{
  if(a.type!=="REBASELINE" || a.previous_baseline!==oldCurrent.active_baseline){
    errors.push("CURRENT rebaseline must supersede previous active baseline");
  }
  const oldSprint=showJsonAt(base,"delivery/CURRENT-SPRINT.json");
  if(oldSprint && oldSprint.active_sprint!==null && oldSprint.status!=="BLOCKED"){
    errors.push("Rebaseline while a Sprint exists requires previous Sprint state BLOCKED");
  }
};
const validateCurrentTransition=(base,head,current)=>{
  const oldCurrent=showJsonAt(base,"build-spec/CURRENT.json");
  if(!oldCurrent || oldCurrent.active_baseline===current.active_baseline) return;
  if(current.active_baseline===null){
    errors.push("CURRENT active_baseline cannot be cleared; supersede with a new approved baseline");
    return;
  }

  const a=getActivation(current.active_baseline);
  const m=getBaseline(current.active_baseline);
  if(!a||!m) errors.push("CURRENT transition requires valid Activation Record and baseline");
  else if(oldCurrent.active_baseline===null){
    if(a.type!=="INITIAL_FREEZE" || a.previous_baseline!==null) errors.push("First CURRENT activation must be INITIAL_FREEZE");
  }else validateRebaseline(base,oldCurrent,current,a);
  activationTouched(base,head,current.active_baseline);
};

for(const file of activationFiles){
  const a=readJson("build-spec/activations/"+file);
  const id=file.replace(/\.json$/,"");
  if(a.schema_version!==1) errors.push(id+" activation schema_version must be 1");
  if(a.baseline_id!==id) errors.push(id+" activation baseline_id mismatch");
  if(!["INITIAL_FREEZE","REBASELINE"].includes(a.type)) errors.push(id+" activation type invalid");
  if(a.status!=="USER_APPROVED" || !a.decision_ref) errors.push(id+" activation requires User approval reference");
  if(!Array.isArray(a.approved_delta_ids)) errors.push(id+" approved_delta_ids must be array");
  if(!/^[0-9a-f]{40}$/.test(a.source_working_commit||"")) errors.push(id+" activation source_working_commit invalid");
  if(!a.activated_at || Number.isNaN(Date.parse(a.activated_at))) errors.push(id+" activation activated_at invalid");

  const m=getBaseline(id);
  if(!m){errors.push(id+" activation points to missing baseline"); continue;}
  if(m.status!=="LOCKED") errors.push(id+" activated baseline must be LOCKED");
  if(m.source_working_commit!==a.source_working_commit) errors.push(id+" activation/source Working commit mismatch");
  if(m.approval?.status!=="USER_APPROVED" || !m.approval?.decision_ref) errors.push(id+" baseline must have explicit User-approved Build Freeze evidence");
  if(a.status!=="USER_APPROVED" || !a.decision_ref) errors.push(id+" activation must have its own explicit User approval reference");

  const md=[...(m.approved_delta_ids||[])].sort();
  const ad=[...(a.approved_delta_ids||[])].sort();
  if(JSON.stringify(md)!==JSON.stringify(ad)) errors.push(id+" activation approved_delta_ids must exactly match baseline manifest");

  if(a.type==="INITIAL_FREEZE"){
    if(a.previous_baseline!==null) errors.push(id+" INITIAL_FREEZE previous_baseline must be null");
    if(m.supersedes!==null) errors.push(id+" INITIAL_FREEZE baseline supersedes must be null");
  }else{
    if(!/^BS-P\d+-\d{3}$/.test(a.previous_baseline||"")) errors.push(id+" REBASELINE requires previous_baseline");
    if(m.supersedes!==a.previous_baseline) errors.push(id+" REBASELINE supersedes mismatch");
    const previousManifest=getBaseline(a.previous_baseline);
    const inherited=new Set(previousManifest?.approved_delta_ids||[]);
    const introduced=ad.filter(did=>!inherited.has(did));
    if(!introduced.length) errors.push(id+" REBASELINE requires at least one newly approved DESIGN_DELTA");
    for(const did of ad){
      const d=getDelta(did);
      if(!d){errors.push(id+" activation references missing Delta "+did); continue;}
      if(d.type!=="DESIGN_DELTA") errors.push(id+" activation Delta "+did+" must be DESIGN_DELTA");
      if(!["APPROVED","IMPLEMENTING","VERIFIED","CLOSED"].includes(d.status)) errors.push(id+" activation Delta "+did+" is not approved");
      if(d.user_decision?.status!=="APPROVED" || !d.user_decision?.decision_ref) errors.push(id+" activation Delta "+did+" lacks explicit User approval");
      if(d.replacement_build_spec_required!==true) errors.push(id+" activation Delta "+did+" must require replacement Build Spec");
      if(inherited.has(did)) continue;
      if(d.affected_build_spec!==a.previous_baseline) errors.push(id+" newly introduced Delta "+did+" affected_build_spec mismatch");
      if(!deltaMatchesActivationSource(d,a.source_working_commit)) errors.push(id+" newly introduced Delta "+did+" source provenance does not match activation source");
      if(d.replacement_build_spec && d.replacement_build_spec!==id) errors.push(id+" newly introduced Delta "+did+" replacement_build_spec mismatch");
    }
  }
}

if(current.active_baseline!==null && !getActivation(current.active_baseline)){
  errors.push("CURRENT active_baseline lacks Activation Record: "+current.active_baseline);
}

const base=process.env.BASE_SHA, head=process.env.HEAD_SHA||"HEAD";
if(base && !/^0+$/.test(base)){
  validateCurrentTransition(base,head,current);
}

if(errors.length){console.error("ACTIVATION GATE: FAIL");errors.forEach(e=>console.error("- "+e));process.exit(1);}
console.log("ACTIVATION GATE: PASS");
