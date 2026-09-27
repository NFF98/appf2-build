import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root=process.cwd(), fail=[], note=[];
const readJson=rel=>JSON.parse(fs.readFileSync(path.join(root,rel),'utf8'));
const exists=rel=>fs.existsSync(path.join(root,rel));
const assert=(c,m)=>{if(!c) fail.push(m);};
const policy=readJson('harness/policy/repo-policy.json');

const existsAtRef=(ref,rel)=>{
  try{execFileSync('git',['cat-file','-e',ref+':'+rel],{stdio:'ignore'}); return true;}
  catch{return false;}
};
const inspectProtectedChange=(base,status,changed)=>{
  const baseline=changed.match(/^build-spec\/baselines\/(BS-P\d+-\d{3})(?:\/|$)/);
  if(baseline && existsAtRef(base,'build-spec/baselines/'+baseline[1]+'/manifest.json')){
    fail.push('Locked baseline changed after merge: '+changed);
  }
  const activation=changed.match(/^build-spec\/activations\/(BS-P\d+-\d{3})\.json$/);
  if(!activation) return;
  const existed=existsAtRef(base,changed);
  if(existed) fail.push('Activation Record is append-only and cannot be modified/deleted: '+changed);
  if(!existed && !status.startsWith('A')) fail.push('New Activation Record must be added, not renamed into place: '+changed);
};

for(const dir of policy.forbidden_top_level_directories) assert(!exists(dir),'Forbidden shadow directory: '+dir+'/');
const current=readJson('build-spec/CURRENT.json');
assert(typeof current.implementation_enabled==='boolean','CURRENT build state missing implementation_enabled');

const br=path.join(root,'build-spec/baselines');
const dirs=fs.readdirSync(br,{withFileTypes:true}).filter(d=>d.isDirectory() && /^BS-P\d+-\d{3}$/.test(d.name)).map(d=>d.name);
if(current.active_baseline===null){
  assert(current.implementation_enabled===false,'Implementation cannot be enabled without active baseline');
  note.push('No active Build Spec: implementation HOLD.');
}else{
  assert(dirs.includes(current.active_baseline),'Active baseline missing: '+current.active_baseline);
}

const base=process.env.BASE_SHA, head=process.env.HEAD_SHA||'HEAD';
if(base && !/^0+$/.test(base)){
  let diff='';
  try{diff=execFileSync('git',['diff','--name-status','-M',base,head],{encoding:'utf8'}).trim();}
  catch{fail.push('Unable to calculate governance diff.');}

  for(const line of diff.split('\n').filter(Boolean)){
    const cols=line.split('\t'), status=cols[0], paths=cols.slice(1);
    for(const changed of paths) inspectProtectedChange(base,status,changed);
  }
}

if(fail.length){console.error('GOVERNANCE GATE: FAIL'); fail.forEach(x=>console.error('- '+x)); process.exit(1);}
console.log('GOVERNANCE GATE: PASS'); note.forEach(x=>console.log('- '+x));
