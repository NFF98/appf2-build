// W1-01 #395: exact-HEAD, Human-gated GH runner; not GCCA and never a PASS proxy.
import fs from "node:fs";
import assert from "node:assert/strict";
import path from "node:path";
import crypto from "node:crypto";
import {execFileSync,spawn} from "node:child_process";
import {finished} from "node:stream/promises";
import {candidateDigestOf} from "./final-ready-preflight.mjs";
const docket="delivery/constitutional-cases/GOV-392-CARRY-FORWARD-001.json";
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
const isPr=p=>Boolean(p)&&[
  p.number===395,p.draft===true,p.state==="open",p.base?.ref==="main",
  p.head?.repo?.full_name==="NFF98/appf2-build"
].every(Boolean);
const sourceOk=(h,b)=>[
  /^[0-9a-f]{40}$/.test(h||""),/^[0-9a-f]{40}$/.test(b||""),
  git("rev-parse","HEAD")===h
].every(Boolean);
const pathsOk=paths=>[
  paths.includes(docket),paths.length>=2,new Set(paths).size===paths.length
].every(Boolean);
const bytesOk=(d,paths,base,digest)=>[
  Boolean(digest),d.base_sha===base,d.candidate_digest_sha256===digest,
  JSON.stringify(paths.filter(x=>x!==docket).sort())===
    JSON.stringify([...(d.exact_changed_paths||[])].sort())
].every(Boolean);
const approvalMetaOk=(a,d,digest)=>[
  a.case_id===d.case_id,a.approver==="NFF98",
  a.source_kind==="DIRECT_HUMAN_MESSAGE",a.decision==="APPROVE_EXACT_CANDIDATE",
  a.scope==="EXACT_PR_DIFF",a.candidate_digest_sha256===digest,
  /^https:\/\/github\.com\/NFF98\/appf2-build\/pull\/395#issuecomment-[0-9]+$/.test(a.human_message_ref||""),
  d.scope_exception?.lane==="GOVERNANCE_REFORM"
].every(Boolean);
const approvalTimeOk=(a,d)=>{
  const now=Math.floor(Date.now()/1000),expiry=d.scope_exception?.expires_at_unix;
  return [
    Number.isSafeInteger(a.approved_at_unix),a.approved_at_unix>0,
    a.approved_at_unix<=now+300,Number.isSafeInteger(expiry),
    expiry>now,expiry-a.approved_at_unix>0,
    expiry-a.approved_at_unix<=1209600
  ].every(Boolean);
};
function admission(){
  if(process.env.GITHUB_EVENT_NAME!=="pull_request"||
    process.env.GITHUB_REPOSITORY!=="NFF98/appf2-build")
    return {ok:false,reason:"wrong event or repo"};
  const p=json(process.env.GITHUB_EVENT_PATH).pull_request;
  if(!isPr(p))return {ok:false,reason:"not same-repo Draft PR #395"};
  const head=p.head.sha,base=p.base.sha;
  if(!sourceOk(head,base))return {ok:false,reason:"not actual PR source HEAD"};
  const paths=git("diff","--name-only",base,head).split("\n").filter(Boolean);
  if(!pathsOk(paths))return {ok:false,reason:"missing docket or duplicate diff paths"};
  const d=json(docket),digest=candidateDigestOf(paths.map(filename=>({filename})),
    filename=>fs.readFileSync(filename));
  if(!bytesOk(d,paths,base,digest))
    return {ok:false,reason:"unapproved exact candidate diff",head,base,digest};
  const a=d.human_approval||{};
  if(!approvalMetaOk(a,d,digest)||!approvalTimeOk(a,d))
    return {ok:false,reason:"fresh exact SHA256 Human decision pending",head,base,digest};
  if(git("status","--porcelain"))return {ok:false,reason:"checkout dirty"};
  return {ok:true,head,base,digest,paths,approval_ref:a.human_message_ref};
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
  console.log("W1-01 child env isolation selftest: PASS (synthetic, NOT Attack PASS).");
};
async function once(spec,index,env){
  const [command,bin,args,seconds]=spec,name=String(index+1).padStart(2,"0");
  const dir="w1-01-evidence";
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
  schema:"APPF2-W1-01-CLOUD-EVIDENCE-1",pr:395,
  run_type:"NON_REQUIRED_CLOUD_LOCAL_MIRROR_NOT_GCCA",
  source_head_sha:a.head||null,base_sha:a.base||null,digest_sha256:a.digest||null,
  github_run_id:process.env.GITHUB_RUN_ID,node_version:process.version,
  environment:process.platform,
  package_lock_sha256:fs.existsSync("package-lock.json")?
    sha(fs.readFileSync("package-lock.json")):null,
  stages:[],not_run:jobs.map(j=>j[0]),verdict:"NOT_ADMITTED"
});
const save=m=>fs.writeFileSync("w1-01-evidence/raw-evidence-manifest.json",
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
  fs.mkdirSync("w1-01-evidence",{recursive:true});
  const m=buildManifest(a);save(m);
  if(!a.ok){process.exitCode=2;return;}
  fs.writeFileSync("w1-01-evidence/source.json",JSON.stringify(a,null,2)+"\n");
  await executeAll(m,a);finish(m);
}
async function main(){
  const mode=process.argv[2];
  if(mode==="env-selftest"){testChildEnvironment();return;}
  const a=admission();
  console.log("W1-01 "+(a.ok?"ADMITTED":"NOT_ADMITTED")+" "+(a.reason||a.digest));
  if(mode==="admit"){
    if(process.env.GITHUB_OUTPUT)
      fs.appendFileSync(process.env.GITHUB_OUTPUT,"approved="+(a.ok?"true":"false")+"\n");
    return;
  }
  if(mode!=="run")throw Error("Unknown mode");
  await runMirror(a);
}
main().catch(e=>{console.error("CLOUD MIRROR HARD STOP "+String(e.stack||e));process.exitCode=2;});
