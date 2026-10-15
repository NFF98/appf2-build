// Generic exact-HEAD GitHub-hosted execution evidence, not GCCA, not Human approval, and never a merge proxy.
import fs from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import crypto from "node:crypto";
import {execFileSync,spawn} from "node:child_process";
import {finished} from "node:stream/promises";
import {candidateDigestOf} from "./final-ready-preflight.mjs";
const sha=b=>crypto.createHash("sha256").update(b).digest("hex");
const json=p=>JSON.parse(fs.readFileSync(p,"utf8"));
const git=(...x)=>execFileSync("git",x,{encoding:"utf8"}).trim();
const jobs=[
  ["npm ci","npm",["ci"],240],
  ["npm run check:lint","npm",["run","check:lint"],240],
  ["npm run gate","npm",["run","gate"],420],
  ["node harness/scripts/admin-closure-cross-gate-test.mjs","node",["harness/scripts/admin-closure-cross-gate-test.mjs"],390],
  ["node harness/scripts/final-ready-selftest.mjs","node",["harness/scripts/final-ready-selftest.mjs"],150],
  ["npm run dry-run:attack","npm",["run","dry-run:attack"],900],
  ["npm run product:ci","npm",["run","product:ci"],1050]
];
const isPr=p=>Boolean(p) && [
  Number.isSafeInteger(p.number) && p.number>0,
  p.draft===true,p.state==="open",p.base?.ref==="main",
  p.head?.repo?.full_name==="NFF98/appf2-build"
].every(Boolean);
const sourceOk=(h,b)=>[
  /^[0-9a-f]{40}$/.test(h||""),/^[0-9a-f]{40}$/.test(b||""),
  git("rev-parse","HEAD")===h
].every(Boolean);
const pathsOk=paths=>paths.length>0 && new Set(paths).size===paths.length;
function admission(){
  if(process.env.GITHUB_EVENT_NAME!=="pull_request"||
    process.env.GITHUB_REPOSITORY!=="NFF98/appf2-build")
    return {ok:false,reason:"wrong event or repo"};
  const p=json(process.env.GITHUB_EVENT_PATH).pull_request;
  if(!isPr(p))return {ok:false,reason:"not an open same-repo Draft PR"};
  const head=p.head.sha,base=p.base.sha;
  if(!sourceOk(head,base))return {ok:false,reason:"not actual PR source HEAD"};
  const paths=git("diff","--name-only",base,head).split("\n").filter(Boolean);
  if(!pathsOk(paths))return {ok:false,reason:"empty/duplicated PR diff",head,base};
  let digest;
  try{
    digest=candidateDigestOf(paths.map(filename=>({filename})),
      filename=>fs.readFileSync(filename));
  }catch{
    return {ok:false,reason:"cannot read exact changed Git bytes",head,base};
  }
  if(!digest)return {ok:false,reason:"cannot compute exact candidate digest",head,base};
  if(git("status","--porcelain"))return {ok:false,reason:"checkout dirty"};
  return {ok:true,pr:p.number,head,base,digest,paths,
    approval_status:"NOT_REQUIRED_TO_RUN_TESTS",merge_authorized:false};
}
// Attack Dry-run constructs its own temporary Git repositories. Inheriting the
// parent PR's BASE_SHA/HEAD_SHA makes positive fixtures fail with "bad object".
// Preserve exact source bindings in the immutable manifest, not fixture env.
const childEnvironment=(command,binding)=>{
  const values={...process.env};
  if(command==="npm run dry-run:attack"){
    delete values.BASE_SHA;
    delete values.HEAD_SHA;
  }else{
    values.BASE_SHA=binding.base;
    values.HEAD_SHA=binding.head;
  }
  return values;
};
const testChildEnvironment=()=>{
  const binding={base:"a".repeat(40),head:"b".repeat(40)};
  for(const command of ["npm run gate","npm run product:ci"]){
    const x=childEnvironment(command,binding);
    assert.equal(x.BASE_SHA,binding.base);
    assert.equal(x.HEAD_SHA,binding.head);
  }
  const attack=childEnvironment("npm run dry-run:attack",binding);
  assert.equal(Object.hasOwn(attack,"BASE_SHA"),false);
  assert.equal(Object.hasOwn(attack,"HEAD_SHA"),false);
  assert.equal(binding.base.length,40);
  const good={number:499,draft:true,state:"open",base:{ref:"main"},head:{repo:{full_name:"NFF98/appf2-build"}}};
  assert.equal(isPr(good),true);
  assert.equal(isPr({...good,number:500}),true);
  assert.equal(isPr({...good,draft:false}),false);
  assert.equal(isPr({...good,head:{repo:{full_name:"fork/repo"}}}),false);
  console.log("Generic evidence admission and child env isolation: PASS (synthetic, NOT GCCA).");
};
async function once(spec,index,env){
  const [command,bin,args,seconds]=spec,name=String(index+1).padStart(2,"0");
  const dir="cloud-evidence";
  const stdoutPath=path.join(dir,name+"-stdout.log"),stderrPath=path.join(dir,name+"-stderr.log");
  const out=fs.createWriteStream(stdoutPath),err=fs.createWriteStream(stderrPath);
  const start=Date.now();let startError=null;
  const proc=spawn("timeout",["--signal=TERM","--kill-after=10s",seconds+"s",bin,...args],
    {env:childEnvironment(command,env),stdio:["ignore","pipe","pipe"]});
  proc.stdout.pipe(out);proc.stderr.pipe(err);
  const result=await new Promise(resolve=>{
    proc.on("error",e=>{startError=e;});
    proc.on("close",(code,signal)=>resolve({code,signal}));
  });
  if(startError)err.write("\nEXEC ERROR "+String(startError)+"\n");
  out.end();err.end();await Promise.all([finished(out),finished(err)]);
  const stdout=fs.readFileSync(stdoutPath),stderr=fs.readFileSync(stderrPath);
  const combined=Buffer.concat([Buffer.from("[STDOUT]\n"),stdout,Buffer.from("\n[STDERR]\n"),stderr]);
  const logPath=path.join(dir,name+"-combined.log");
  fs.writeFileSync(logPath,combined);
  const exit=Number.isInteger(result.code)?result.code:startError?127:result.signal==="SIGKILL"?137:125;
  const row={command,status:exit===0?"PASS":"FAIL",exit_code:exit,
    head_sha:env.head,base_sha:env.base,node_version:process.version,
    completed_at:new Date().toISOString(),duration_ms:Date.now()-start,
    stdout_file:stdoutPath,stdout_sha256:sha(stdout),stderr_file:stderrPath,
    stderr_sha256:sha(stderr),combined_file:logPath,log_sha256:sha(combined)};
  console.log(command+" exit="+exit+" sha256="+row.log_sha256);
  return row;
}
const buildManifest=a=>({
  schema:"APPF2-GENERIC-CLOUD-EVIDENCE-1",pr:a.pr,
  run_type:"NON_REQUIRED_CLOUD_EXECUTION_EVIDENCE_NOT_GCCA",
  source_head_sha:a.head||null,base_sha:a.base||null,digest_sha256:a.digest||null,
  github_run_id:process.env.GITHUB_RUN_ID,node_version:process.version,
  environment:process.platform,
  package_lock_sha256:fs.existsSync("package-lock.json")?
    sha(fs.readFileSync("package-lock.json")):null,
  prior_human_approval_required:false,merge_authorized:false,
  stages:[],not_run:jobs.map(j=>j[0]),verdict:"NOT_ADMITTED"
});
const save=m=>fs.writeFileSync("cloud-evidence/raw-evidence-manifest.json",
  JSON.stringify(m,null,2)+"\n");
async function executeAll(m,a){
  for(let i=0;i<jobs.length;i++){
    m.stages.push(await once(jobs[i],i,a));
    m.not_run=jobs.slice(i+1).map(j=>j[0]);m.verdict="RUNNING";save(m);
    if(i===0&&m.stages[0].exit_code!==0)break;
  }
}
const finish=m=>{
  m.completed_at=new Date().toISOString();
  m.verdict=m.not_run.length?"INCOMPLETE":
    m.stages.every(x=>x.exit_code===0)?"ALL_STAGES_PASS":"STAGES_FAILED";
  save(m);console.log("CLOUD MIRROR RESULT "+m.verdict);
  if(m.verdict!=="ALL_STAGES_PASS")process.exitCode=1;
};
async function runMirror(a){
  fs.mkdirSync("cloud-evidence",{recursive:true});
  const m=buildManifest(a);save(m);
  if(!a.ok){process.exitCode=2;return;}
  fs.writeFileSync("cloud-evidence/source.json",JSON.stringify(a,null,2)+"\n");
  await executeAll(m,a);finish(m);
}
async function main(){
  const mode=process.argv[2];
  if(mode==="env-selftest"){testChildEnvironment();return;}
  const a=admission();
  console.log("CLOUD EVIDENCE "+(a.ok?"ADMITTED":"NOT_ADMITTED")+" "+(a.reason||a.digest));
  if(mode==="admit"){
    if(process.env.GITHUB_OUTPUT)
      fs.appendFileSync(process.env.GITHUB_OUTPUT,"admitted="+(a.ok?"true":"false")+"\n");
    return;
  }
  if(mode!=="run")throw Error("Unknown mode");
  await runMirror(a);
}
main().catch(e=>{console.error("CLOUD MIRROR HARD STOP "+String(e.stack||e));process.exitCode=2;});
