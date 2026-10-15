// GOV-392 cross-gate integration regression for the ADMINISTRATIVE_WITH_CARRY_FORWARD control
// transition. Builds disposable commits on the repository's real SP-P1-003 data inside a
// throw-away clone of this checkout, then runs the REAL validate-change-scope.mjs,
// governance-gate.mjs and validate-sprint.mjs with BASE_SHA/HEAD_SHA. Every Human approval in a
// fixture is synthetic and labelled; nothing is pushed and this checkout is never modified.
// Not part of `npm run gate` (needs a local git clone). Run: node harness/scripts/admin-closure-cross-gate-test.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const SID="SP-P1-003",CASE="GOV-XGATE-SP-P1-003-ADMIN-CLOSE-001";
const DOCKET="delivery/constitutional-cases/"+CASE+".json";
const FIXTURE_REF="xgate-fixture://throwaway-clone/no-real-decision-recorded";
const EXTRA="delivery/audits/GOV-XGATE-EXTRA.md";
const P={manifest:"delivery/sprints/"+SID+"/manifest.json",tasks:"delivery/sprints/"+SID+"/tasks.json",
  register:"delivery/PROJECT-OPEN-ITEMS.json",sprint:"delivery/CURRENT-SPRINT.json",build:"build-spec/CURRENT.json"};
const REJECT="ADMINISTRATIVE_WITH_CARRY_FORWARD control transition rejected: ";
const CASES=[
  ["valid",true,/control transition recognized/],
  ["missing-gap",false,/carry-forward row missing or not APPF2-CARRY-FORWARD-1: GAP-REVAL/],
  ["no-human-approval",false,/exact Human closure approval missing or invalid/],
  ["bot-human-evidence",false,/exact Human closure approval missing or invalid/],
  ["extra-path",false,/path outside the exact closure set: delivery\/audits\/GOV-XGATE-EXTRA\.md/],
  ["t006-fake-pass",false,/path outside the exact closure set: delivery\/sprints\/SP-P1-003\/tasks\.json/],
  ["hold-impl-enabled",false,/build-spec\/CURRENT\.json may only set implementation_enabled=false/]
];
const GATES=["validate-change-scope","governance-gate","validate-sprint"];
const DEADLINE=Date.now()+280000;

const git=(cwd,...args)=>execFileSync("git",["-c","core.autocrlf=false",...args],{cwd,encoding:"utf8",stdio:["ignore","pipe","pipe"]}).trim();
const commit=(cwd,msg)=>git(cwd,"-c","user.name=xgate-fixture","-c","user.email=xgate-fixture@invalid","commit","-q","--no-verify","-m",msg);

async function buildFixture(repo,base,variant){
  const mod=rel=>import(pathToFileURL(path.join(repo,rel)).href+"?v="+variant);
  const {exceptionDigest}=await mod("harness/scripts/human-exception.mjs");
  const {taskSnapshotDigest,CARRY_FORWARD_SCHEMA,ADMIN_CLOSURE}=await mod("harness/scripts/validate-special-approvals-and-carry-forward.mjs");
  const read=rel=>JSON.parse(fs.readFileSync(path.join(repo,rel),"utf8"));
  const write=(rel,v)=>fs.writeFileSync(path.join(repo,rel),typeof v==="string"?v:JSON.stringify(v,null,2)+"\n");
  const now=Math.floor(Date.now()/1000);
  const td=read(P.tasks),m=read(P.manifest),queue=read("delivery/backlog/QUEUE.json");
  const task=id=>td.tasks.find(t=>t.task_id===id);
  const decision={case_id:CASE,human_message_ref:FIXTURE_REF,approved_at_unix:now-60,expires_at_unix:null};
  const gap=(id,title,status,source,...details)=>({
    row_schema:CARRY_FORWARD_SCHEMA,id,title,status,source:{...source,refs:[DOCKET,"https://github.com/NFF98/appf2-build/issues/392"]},
    acceptance:details[0],human_decision:decision,waived_gate:null,reason:details[1],risk:"Unverified scope could be mistaken for shipped Product behaviour.",
    owner:"Human + Planning",next_phase:{target:"PENDING_PRODUCT_ALIGNMENT",decided_by_human:false},completion_criterion:details[2],
    history:[{at_unix:now-60,event:"REGISTERED_AT_ADMINISTRATIVE_CLOSURE",ref:DOCKET}],resolution:null
  });
  const t006=task("T006").acceptance_links.find(l=>l.acceptance_id==="F00-AC-037");
  const taskSrc={kind:"TASK",sprint_id:SID,task_id:"T006",backlog_item_ids:[]};
  const rows=[
    gap("GAP-T006-01","F00-AC-037 F06 Preview-origin path UNTESTED","UNTESTED",taskSrc,
      [{acceptance_id:t006.acceptance_id,test_id:t006.test_id,evidence_status:"UNTESTED",evidence_refs:[]}],
      "F06 Preview-origin path not implemented in Stage A.","TEST-F00-037 PASS Evidence independently reviewed."),
    gap("GAP-T006-02","T006 independent review Evidence missing","BLOCKED",taskSrc,[],"T006 never reached REVIEW PASS.","Independent T006 review PASS recorded."),
    gap("GAP-T006-03","T006 lifecycle BLOCKED at Sprint close","BLOCKED",taskSrc,[],"T006 frozen BLOCKED by administrative closure.","T006 CLOSED through an ordinary lifecycle."),
    gap("GAP-BL-015","BL-P1-015 not DONE","BLOCKED",{kind:"BACKLOG",sprint_id:SID,task_id:null,backlog_item_ids:["BL-P1-015"]},[],"Selected but not completed.","BL-P1-015 DONE with PASS Evidence."),
    gap("GAP-BL-018","BL-P1-018 not DONE","BLOCKED",{kind:"BACKLOG",sprint_id:SID,task_id:null,backlog_item_ids:["BL-P1-018"]},[],"Selected but not completed.","BL-P1-018 DONE with PASS Evidence."),
    gap("GAP-REVAL","T008 revalidations BL-P1-008/010/031 open","OPEN",{kind:"REVALIDATION",sprint_id:SID,task_id:"T008",backlog_item_ids:["BL-P1-008","BL-P1-010","BL-P1-031"]},[],
      "T008 REVIEW frozen; revalidations IN_PROGRESS.","T008 and revalidations CLOSED under Human-approved sequencing.")
  ];
  const byId=new Map(queue.items.map(x=>[x.backlog_item_id,x]));
  const closure={schema:"APPF2-ADMIN-CLOSURE-1",case_id:CASE,carry_forward_ids:rows.map(r=>r.id),
    open_tasks:td.tasks.filter(t=>t.status!=="CLOSED").map(t=>({id:t.task_id,status:t.status,snapshot_sha256:taskSnapshotDigest(t)})),
    open_backlog:m.backlog_item_ids.filter(id=>byId.get(id)?.status!=="DONE").map(id=>({id,status:byId.get(id).status})),
    open_revalidations:m.revalidation_item_ids.filter(id=>!["VERIFIED","CLOSED"].includes(byId.get(id)?.revalidation?.status)).map(id=>({id,status:byId.get(id).revalidation.status})),
    historical_procedural_dispositions:[{gate_id:"BACKLOG_T008_REVIEW_AFTER_T006_VERIFIED",task_id:"T008"}]};
  const register=read(P.register);
  register.items.push(...rows.filter(r=>variant!=="missing-gap" || r.id!=="GAP-REVAL"));
  Object.assign(m,{status:"CLOSED",closure_disposition:ADMIN_CLOSURE,administrative_closure:closure});
  const sprint={...read(P.sprint),active_sprint:null,active_build_spec:null,active_task:null,status:"HOLD",
    reason:"XGATE FIXTURE: SP-P1-003 administratively CLOSED with carry-forward; not Product PASS."};
  const build={...read(P.build),implementation_enabled:variant==="hold-impl-enabled",reason:"XGATE FIXTURE: HOLD after administrative closure."};
  const changed=[P.build,P.register,P.sprint,P.manifest];
  if(variant==="t006-fake-pass"){task("T006").status="CLOSED";write(P.tasks,td);changed.push(P.tasks);}
  if(variant==="extra-path"){write(EXTRA,"# XGATE FIXTURE extra path\n");changed.push(EXTRA);}
  write(P.register,register);write(P.manifest,m);write(P.sprint,sprint);write(P.build,build);
  const digest=exceptionDigest(rel=>{try{return fs.readFileSync(path.join(repo,rel));}catch{return null;}},changed);
  const docket={case_id:CASE,base_sha:base,constitution_version:"1.0",
    title:"XGATE FIXTURE ONLY: SP-P1-003 ADMINISTRATIVE_WITH_CARRY_FORWARD (not a real Human decision)",
    closure_disposition:ADMIN_CLOSURE,sprint_id:SID,build_spec_id:m.build_spec_id,never_converts_fail_or_untested_to_pass:true,
    administrative_closure:JSON.parse(JSON.stringify(closure)),exact_changed_paths:[...changed].sort(),candidate_digest_sha256:digest,
    why5:Array.from({length:5},(_,i)=>({question:"Fixture why "+(i+1),answer:"Disposable fixture answer "+(i+1),evidence_ref:"https://github.com/NFF98/appf2-build/issues/392"})),
    human_approval:{case_id:CASE,source_kind:"DIRECT_HUMAN_MESSAGE",decision:"APPROVE_EXACT_CANDIDATE",scope:"EXACT_PR_DIFF",
      human_message_ref:FIXTURE_REF,approver:"NFF98",approved_at_unix:now-60,candidate_digest_sha256:digest}};
  if(variant==="no-human-approval") delete docket.human_approval;
  if(variant==="bot-human-evidence") docket.human_approval.source_kind="AI_GENERATED_COMMENT";
  write(DOCKET,docket);
}

const runGate=(repo,gate,base,head)=>{
  const r=spawnSync(process.execPath,["harness/scripts/"+gate+".mjs"],{cwd:repo,encoding:"utf8",timeout:120000,
    env:{...process.env,BASE_SHA:base,HEAD_SHA:head}});
  return {gate,pass:r.status===0,out:(r.stdout||"")+(r.stderr||"")};
};

function prepareClone(root,tmp){
  const repo=path.join(tmp,"repo"),common=git(root,"rev-parse","--path-format=absolute","--git-common-dir");
  const srcHead=git(root,"rev-parse","HEAD");
  execFileSync("git",["clone","-q","--shared","--no-checkout","-c","core.autocrlf=false",common,repo],{stdio:"ignore"});
  git(repo,"-c","advice.detachedHead=false","checkout","-q","--detach",srcHead);
  const overlay=[...new Set([...git(root,"diff","--name-only","HEAD").split("\n"),
    ...git(root,"ls-files","--others","--exclude-standard").split("\n")].filter(Boolean))];
  for(const rel of overlay){
    const src=path.join(root,rel),dst=path.join(repo,rel);
    if(fs.existsSync(src)){fs.mkdirSync(path.dirname(dst),{recursive:true});fs.copyFileSync(src,dst);}
    else fs.rmSync(dst,{force:true});
  }
  if(overlay.length){git(repo,"add","-A");commit(repo,"XGATE: candidate working-tree snapshot as BASE");}
  return {repo,srcHead,overlay,base:git(repo,"rev-parse","HEAD")};
}

function finalReport(notComplete,failures){
  if(notComplete){console.log("XGATE cross-gate administrative closure: NOT_COMPLETE (time limit reached before "+notComplete+")");process.exit(2);}
  console.log("XGATE cross-gate administrative closure: "+(failures.length?"FAIL "+failures.join(","):CASES.length+"/"+CASES.length+" PASS (synthetic fixtures, NOT Human approval)"));
  process.exit(failures.length?1:0);
}
async function main(){
  const root=process.cwd(),tmp=fs.mkdtempSync(path.join(os.tmpdir(),"appf2-gov392-xgate-"));
  const failures=[];
  let notComplete=null;
  try{
    const {repo,srcHead,overlay,base}=prepareClone(root,tmp);
    console.log("XGATE source HEAD "+srcHead+(overlay.length?" + "+overlay.length+" uncommitted path(s)":"")+"; fixture BASE "+base);
    for(const [variant,want,reason] of CASES){
      if(Date.now()>DEADLINE){notComplete=variant;break;}
      git(repo,"reset","-q","--hard",base);git(repo,"clean","-qfd");
      await buildFixture(repo,base,variant);
      git(repo,"add","-A");commit(repo,"XGATE FIXTURE ONLY ("+variant+"): not a real Human decision");
      const head=git(repo,"rev-parse","HEAD");
      const results=GATES.map(g=>runGate(repo,g,base,head));
      const scope=results[0];
      const ok=want?results.every(r=>r.pass) && reason.test(scope.out):
        !scope.pass && scope.out.split(/\r?\n/).some(l=>l.includes(REJECT) && reason.test(l));
      if(!ok) failures.push(variant);
      console.log((ok?"PASS":"FAIL")+" | "+variant+" | expect "+(want?"ACCEPT":"REJECT by change-scope")+" | "+
        results.map(r=>r.gate+"="+(r.pass?"PASS":"FAIL")).join(" "));
      for(const l of scope.out.split(/\r?\n/).filter(l=>l.includes(REJECT) || /control transition recognized/.test(l))) console.log("    "+l.trim());
      if(!ok) for(const r of results) console.log("  --- "+r.gate+"\n"+r.out.split(/\r?\n/).filter(l=>/FAIL|PASS|^- /.test(l)).join("\n"));
    }
  }finally{
    fs.rmSync(tmp,{recursive:true,force:true,maxRetries:3});
  }
  finalReport(notComplete,failures);
}
await main();
