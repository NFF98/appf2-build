import fs from 'node:fs';
import path from 'node:path';

const root=process.cwd(), errors=[];
const readJson=file=>JSON.parse(fs.readFileSync(file,'utf8'));
const policy=readJson(path.join(root,'harness/policy/repo-policy.json'));
const classes=new Set(policy.finding_classifications), findingStates=new Set(policy.finding_statuses), types=new Set(policy.delta_types), deltaStates=new Set(policy.delta_statuses);
const jsonFiles=rel=>{const d=path.join(root,rel);return fs.existsSync(d)?fs.readdirSync(d).filter(f=>f.endsWith('.json')).map(f=>path.join(d,f)):[];};
const sprintTasks=new Map();
const sprintRoot=path.join(root,'delivery/sprints');
const loadSprintTasks=()=>{
  if(!fs.existsSync(sprintRoot)) return;
  for(const ent of fs.readdirSync(sprintRoot,{withFileTypes:true})){
    if(!ent.isDirectory()) continue;
    const tp=path.join(sprintRoot,ent.name,'tasks.json');
    if(!fs.existsSync(tp)) continue;
    for(const t of readJson(tp).tasks||[]) sprintTasks.set(ent.name+':'+t.task_id,t);
  }
};
const validateClosedDelta=d=>{
  if(d.status!=='CLOSED' || d.replacement_build_spec_required!==true) return;
  if(!/^BS-P\d+-\d{3}$/.test(d.replacement_build_spec||'')){
    errors.push(d.delta_id+' closed Design Delta requires replacement Build Spec');
    return;
  }
  const mp=path.join(root,'build-spec/baselines',d.replacement_build_spec,'manifest.json');
  if(!fs.existsSync(mp)) errors.push(d.delta_id+' replacement Build Spec missing');
  else if(readJson(mp).supersedes!==d.affected_build_spec) errors.push(d.delta_id+' replacement baseline does not supersede affected baseline');
};
const validGitSha=value=>/^[0-9a-f]{40}$/.test(value||'');
const validProvenanceAudit=value=>typeof value==='string' && value.startsWith('delivery/audits/') && fs.existsSync(path.join(root,value));
const validateFreezeSourceIdentity=(d,f)=>{
  if(!f || f.type!=='SCOPE_CLEAN_DERIVED') errors.push(d.delta_id+' freeze_source.type must be SCOPE_CLEAN_DERIVED');
  if(!validGitSha(f?.commit)) errors.push(d.delta_id+' freeze_source.commit must be a Git commit SHA');
  if(!validGitSha(f?.base_commit)) errors.push(d.delta_id+' freeze_source.base_commit must be a Git commit SHA');
  if(f?.commit===d.upstream_working_commit) errors.push(d.delta_id+' derived freeze source must preserve a distinct upstream Working commit');
};
const validateFreezeSource=d=>{
  const f=d.freeze_source;
  if(f===undefined) return;
  validateFreezeSourceIdentity(d,f);
  if(!validProvenanceAudit(f?.provenance_audit)) errors.push(d.delta_id+' freeze_source requires an existing delivery/audits provenance record');
};
const validateApprovedDesignDelta=d=>{
  if(!['APPROVED','IMPLEMENTING','VERIFIED','CLOSED'].includes(d.status)) return;
  if(d.user_decision?.status!=='APPROVED' || !d.user_decision?.decision_ref) errors.push(d.delta_id+' approved lifecycle requires explicit User approval reference');
  if(!/^[0-9a-f]{40}$/.test(d.upstream_working_commit||'')) errors.push(d.delta_id+' approved lifecycle requires upstream Working commit');
  validateFreezeSource(d);
  if(d.replacement_build_spec_required!==true) errors.push(d.delta_id+' approved DESIGN_DELTA must require replacement Build Spec');
};
loadSprintTasks();

const findings=new Map();
for(const file of jsonFiles('delivery/findings')){
  const f=readJson(file), base=path.basename(file,'.json');
  if(!/^BF-\d{3,}$/.test(f.finding_id||'')) errors.push('Invalid finding ID: '+file);
  if(base!==f.finding_id) errors.push('Finding filename must equal finding_id: '+file);
  if(findings.has(f.finding_id)) errors.push('Duplicate finding ID: '+f.finding_id); findings.set(f.finding_id,f);
  if(!classes.has(f.classification)) errors.push('Invalid classification: '+f.finding_id);
  if(!findingStates.has(f.status)) errors.push('Invalid finding status: '+f.finding_id);
  for(const k of ['build_spec_id','sprint_id','task_id','expected','actual']) if(!f[k]) errors.push(f.finding_id+' missing '+k);
  if(!Array.isArray(f.evidence)||!f.evidence.length) errors.push(f.finding_id+' requires evidence');
  if(!Array.isArray(f.attempts)) errors.push(f.finding_id+' attempts must be array');
  const strategyCounts=new Map();
  for(const a of f.attempts||[]){
    for(const k of ['attempt_id','strategy','result','evidence']) if(!a?.[k]) errors.push(f.finding_id+' attempt missing '+k);
    if(a?.strategy){const n=(strategyCounts.get(a.strategy)||0)+1; strategyCounts.set(a.strategy,n); if(n>policy.max_same_strategy_failures_before_escalation) errors.push(f.finding_id+' strategy '+a.strategy+' exceeded retry ceiling');}
  }
  const contractBlocking=['SPEC_AMBIGUITY','DESIGN_DELTA_CANDIDATE'].includes(f.classification) || (f.classification==='BUILD_BLOCKER' && f.contract_affecting===true);
  if(contractBlocking && ['OPEN','ASSESSING','BLOCKED'].includes(f.status)){
    const task=sprintTasks.get(f.sprint_id+':'+f.task_id);
    if(task && task.status!=='BLOCKED') errors.push(f.finding_id+' requires affected Task '+f.task_id+' to be BLOCKED');
  }
}

const deltas=new Map();
for(const file of jsonFiles('delivery/deltas')){
  const d=readJson(file), base=path.basename(file,'.json');
  if(!/^BD-\d{3,}$/.test(d.delta_id||'')) errors.push('Invalid delta ID: '+file);
  if(base!==d.delta_id) errors.push('Delta filename must equal delta_id: '+file);
  if(deltas.has(d.delta_id)) errors.push('Duplicate delta ID: '+d.delta_id); deltas.set(d.delta_id,d);
  if(!types.has(d.type)) errors.push('Invalid delta type: '+d.delta_id);
  if(!deltaStates.has(d.status)) errors.push('Invalid delta status: '+d.delta_id);
  if(!Array.isArray(d.source_finding_ids)||!d.source_finding_ids.length) errors.push(d.delta_id+' requires source Finding');
  for(const fid of d.source_finding_ids||[]) if(!findings.has(fid)) errors.push(d.delta_id+' references missing Finding '+fid);
  if(typeof d.changes_contract_semantics!=='boolean') errors.push(d.delta_id+' missing changes_contract_semantics');
  if(d.type!=='DESIGN_DELTA' && d.changes_contract_semantics===true) errors.push(d.delta_id+' non-DESIGN_DELTA cannot change contract semantics');
  if(d.type==='DESIGN_DELTA'){
    if(d.owner!=='HUMAN_GOVERNANCE') errors.push(d.delta_id+' DESIGN_DELTA owner invalid');
    if(d.user_decision_required!==true) errors.push(d.delta_id+' requires User decision');
    validateApprovedDesignDelta(d);
    validateClosedDelta(d);
  }
  if(d.status==='CLOSED' && (!Array.isArray(d.verification)||!d.verification.length)) errors.push(d.delta_id+' CLOSED requires verification evidence');
}

for(const [fid,f] of findings){
  if(f.delta_id!==null){
    const d=deltas.get(f.delta_id);
    if(!d) errors.push(fid+' references missing delta '+f.delta_id);
    else if(!(d.source_finding_ids||[]).includes(fid)) errors.push(fid+' delta '+f.delta_id+' does not point back to source Finding');
  }
}

if(errors.length){console.error('FINDING/DELTA GATE: FAIL'); errors.forEach(e=>console.error('- '+e)); process.exit(1);}
console.log('FINDING/DELTA GATE: PASS');
