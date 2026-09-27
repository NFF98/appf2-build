import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { validateProjectionMap } from './projection-contract.mjs';

const root=process.cwd(), errors=[];
const readJson=rel=>JSON.parse(fs.readFileSync(path.join(root,rel),'utf8'));
const sha256File=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const assert=(c,m)=>{if(!c) errors.push(m);};
const current=readJson('build-spec/CURRENT.json');
const baseRoot=path.join(root,'build-spec/baselines');
const dirs=fs.readdirSync(baseRoot,{withFileTypes:true}).filter(d=>d.isDirectory() && /^BS-P\d+-\d{3}$/.test(d.name)).map(d=>d.name).sort();
const validateActiveAcceptance=(id,e,tids)=>{
  assert(e.required_for_build_freeze===true,id+' '+e.acceptance_id+' ACTIVE must be required_for_build_freeze=true');
  assert(typeof e.test_id==='string' && e.test_id.length>0,id+' '+e.acceptance_id+' ACTIVE missing test_id');
  if(!e.test_id) return;
  if(tids.has(e.test_id)) errors.push(id+' duplicate active test_id: '+e.test_id);
  tids.add(e.test_id);
};
const validateAcceptanceEntries=(id,m,reg)=>{
  assert(Array.isArray(reg.entries),id+' acceptance registry entries must be array');
  if(!Array.isArray(reg.entries)) return;
  assert(m.acceptance_count===reg.entries.length,id+' acceptance_count mismatch');
  const aids=new Set(), tids=new Set();
  const validStatuses=new Set(['ACTIVE','SUPERSEDED']);
  for(const e of reg.entries){
    assert(typeof e.acceptance_id==='string' && e.acceptance_id.length>0,id+' acceptance entry missing acceptance_id');
    if(aids.has(e.acceptance_id)) errors.push(id+' duplicate acceptance_id: '+e.acceptance_id);
    aids.add(e.acceptance_id);
    assert(validStatuses.has(e.contract_status),id+' '+e.acceptance_id+' invalid contract_status: '+e.contract_status);
    assert(typeof e.required_for_build_freeze==='boolean',id+' '+e.acceptance_id+' required_for_build_freeze must be boolean');
    if(e.contract_status==='ACTIVE') validateActiveAcceptance(id,e,tids);
    if(e.contract_status==='SUPERSEDED'){
      assert(e.required_for_build_freeze===false,id+' '+e.acceptance_id+' SUPERSEDED must be required_for_build_freeze=false');
    }
  }
};

for(const id of dirs){
  const dir=path.join(baseRoot,id), manifestPath=path.join(dir,'manifest.json');
  assert(fs.existsSync(manifestPath),id+' missing manifest.json');
  if(!fs.existsSync(manifestPath)) continue;
  const m=JSON.parse(fs.readFileSync(manifestPath,'utf8'));
  assert(m.schema_version===1,id+' schema_version must be 1');
  assert(m.baseline_id===id,id+' baseline_id mismatch');
  assert(m.status==='LOCKED',id+' must be LOCKED');
  assert(m.source_repo==='NFF98/appf2-design',id+' source_repo invalid');
  assert(/^[0-9a-f]{40}$/.test(m.source_working_commit||''),id+' invalid source_working_commit');
  assert(typeof m.created_at==='string' && !Number.isNaN(Date.parse(m.created_at)),id+' invalid created_at');
  assert(m.supersedes===null || /^BS-P\d+-\d{3}$/.test(m.supersedes||''),id+' invalid supersedes');
  assert(Array.isArray(m.approved_delta_ids),id+' approved_delta_ids must be array');
  assert(m.approval?.status==='USER_APPROVED' && typeof m.approval?.decision_ref==='string' && m.approval.decision_ref.length>0,id+' missing User approval reference');
  assert(m.projection_map==='projection-map.json',id+' projection_map must be projection-map.json');
  assert(Array.isArray(m.file_inventory),id+' file_inventory must be array');
  if(!Array.isArray(m.file_inventory)) continue;

  const inventory=new Map();
  for(const x of m.file_inventory){
    assert(x && typeof x.path==='string' && x.path && !x.path.startsWith('/') && !x.path.includes('..'),id+' invalid inventory path');
    assert(/^[0-9a-f]{64}$/.test(x?.sha256||''),id+' invalid inventory sha256 for '+x?.path);
    if(inventory.has(x?.path)) errors.push(id+' duplicate inventory path: '+x?.path);
    inventory.set(x?.path,x?.sha256);
  }

  const actual=[];
  const walk=(dirPath,prefix='')=>{
    for(const ent of fs.readdirSync(dirPath,{withFileTypes:true})){
      const rel=prefix?prefix+'/'+ent.name:ent.name;
      const abs=path.join(dirPath,ent.name);
      if(rel==='manifest.json') continue;
      if(ent.isSymbolicLink()){errors.push(id+' symlink not allowed: '+rel); continue;}
      if(ent.isDirectory()) walk(abs,rel);
      else if(ent.isFile()) actual.push(rel);
    }
  };
  walk(dir);
  actual.sort();
  const expected=[...inventory.keys()].sort();
  assert(JSON.stringify(actual)===JSON.stringify(expected),id+' file_inventory does not exactly match baseline files');
  for(const rel of actual){
    const digest=sha256File(path.join(dir,rel));
    assert(inventory.get(rel)===digest,id+' sha256 mismatch: '+rel);
  }
  const aggregate=crypto.createHash('sha256').update(actual.map(rel=>rel+':'+inventory.get(rel)+'\n').join('')).digest('hex');
  assert(m.content_sha256===aggregate,id+' content_sha256 mismatch');

  const projectionPath=m.projection_map?path.join(dir,m.projection_map):null;
  assert(projectionPath && fs.existsSync(projectionPath),id+' projection map file missing');
  if(projectionPath && fs.existsSync(projectionPath)){
    const projection=JSON.parse(fs.readFileSync(projectionPath,'utf8'));
    const projectionErrors=validateProjectionMap(projection,{
      expectedBaselineId:id,
      expectedSourceRepo:m.source_repo,
      expectedSourceCommit:m.source_working_commit
    });
    projectionErrors.forEach(e=>errors.push(id+' projection map: '+e));
    assert(inventory.has(m.projection_map),id+' projection map missing from file_inventory');

    if(Array.isArray(projection.entries)){
      const projected=projection.entries.filter(e=>e.mode!=='REFERENCE_ONLY' && typeof e.target_path==='string');
      const targetPaths=projected.map(e=>e.target_path).sort();
      const accounted=[m.projection_map,...targetPaths].sort();
      assert(JSON.stringify(actual)===JSON.stringify(accounted),id+' baseline contains files not accounted for by projection map');
      for(const entry of projected){
        assert(inventory.get(entry.target_path)===entry.output_sha256,id+' projection output hash mismatch in manifest inventory: '+entry.target_path);
      }
    }
  }

  assert(typeof m.acceptance_registry==='string' && m.acceptance_registry.length>0,id+' acceptance_registry missing');
  const ar=m.acceptance_registry?path.join(dir,m.acceptance_registry):null;
  assert(ar && fs.existsSync(ar),id+' acceptance registry file missing');
  if(ar && fs.existsSync(ar)){
    const reg=JSON.parse(fs.readFileSync(ar,'utf8'));
    validateAcceptanceEntries(id,m,reg);
  }
}

assert(typeof current.implementation_enabled==='boolean','CURRENT missing implementation_enabled');
if(current.active_baseline===null){
  assert(current.implementation_enabled===false,'Implementation cannot be enabled without active baseline');
}else{
  assert(dirs.includes(current.active_baseline),'Active baseline missing: '+current.active_baseline);
}

if(errors.length){console.error('BASELINE GATE: FAIL'); errors.forEach(e=>console.error('- '+e)); process.exit(1);}
console.log('BASELINE GATE: PASS');
if(current.active_baseline===null) console.log('- No active Build Spec: implementation HOLD.');
