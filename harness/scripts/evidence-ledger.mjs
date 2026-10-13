// GOV-REFORM-20261013: read-only Evidence aggregation, dedupe, staleness and
// closure-readiness report for one Task. It never writes Evidence and never
// upgrades a status: FAIL/INFO/UNCLASSIFIED stay what they are.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const pairKey=e=>(e.acceptance_ids||[]).map((a,i)=>a+"::"+(e.test_ids||[])[i]).sort().join(",");
const dedupeKey=e=>[e.kind,e.status,pairKey(e),e.command||"",e.source_commit].join("|");

const groupDuplicates=list=>{
  const groups=new Map();
  for(const e of list){
    const k=dedupeKey(e);
    if(!groups.has(k)) groups.set(k,[]);
    groups.get(k).push(e.evidence_id);
  }
  return [...groups.values()].filter(ids=>ids.length>1).map(ids=>ids.sort());
};

const proofLevelCounts=(list,levels)=>{
  const out=Object.fromEntries([...levels,"UNCLASSIFIED"].map(l=>[l,0]));
  for(const e of list.filter(x=>x.kind==="TEST_RESULT")){
    const level=levels.includes(e.proof_level)?e.proof_level:"UNCLASSIFIED";
    out[level]++;
  }
  return out;
};

const missingForClosure=({task,usable,requiredCommands})=>{
  const pass=usable.filter(e=>e.status==="PASS");
  const passedPairs=new Set(pass.filter(e=>e.kind==="TEST_RESULT").flatMap(e=>pairKey(e).split(",")));
  const passedCommands=new Set(pass.filter(e=>e.kind==="COMMAND_RESULT").map(e=>e.command));
  return {
    missing_pairs:(task.acceptance_links||[]).map(l=>l.acceptance_id+"::"+l.test_id).filter(p=>!passedPairs.has(p)),
    missing_commands:[...requiredCommands].filter(c=>!passedCommands.has(c)),
    missing_review:!pass.some(e=>e.kind==="REVIEW" && Array.isArray(e.blocking_findings) && !e.blocking_findings.length)
  };
};

/** Pure ledger: inject evidence list and an ancestry predicate. */
export function buildEvidenceLedger({task,sprintId,evidenceList,requiredCommands,isAncestor,proofLevels}){
  const own=evidenceList.filter(e=>e.sprint_id===sprintId && e.task_id===task.task_id);
  const ids=new Set(own.map(e=>e.evidence_id)),referenced=new Set(task.completion_evidence||[]);
  const stale=own.filter(e=>e.build_spec_id!==task.build_spec_id || !isAncestor(e.source_commit)).map(e=>e.evidence_id).sort();
  const duplicates=groupDuplicates(own);
  const redundant=new Set(duplicates.flatMap(g=>g.slice(1)));
  const usable=own.filter(e=>!stale.includes(e.evidence_id) && !redundant.has(e.evidence_id));
  const missing=missingForClosure({task,usable,requiredCommands});
  const ready=!missing.missing_pairs.length && !missing.missing_commands.length && !missing.missing_review;
  return {
    task_id:task.task_id,sprint_id:sprintId,
    evidence_readiness:ready?"EVIDENCE_COMPLETE_FOR_CLOSURE_CONTROL":"NOT_READY",
    ...missing,
    duplicates,stale,
    unreferenced:[...ids].filter(id=>!referenced.has(id)).sort(),
    dangling_refs:[...referenced].filter(id=>!ids.has(id)).sort(),
    suggested_completion_evidence:usable.map(e=>e.evidence_id).sort(),
    proof_levels:proofLevelCounts(own,proofLevels),
    note:"Evidence completeness only. Closure still needs procedural gates, Reviewer PASS and Human closure approval; UNCLASSIFIED proof level is not upgraded."
  };
}

const ancestryChecker=()=>{
  const cache=new Map();
  return sha=>{
    if(!/^[0-9a-f]{40}$/.test(sha||"")) return false;
    if(!cache.has(sha)){
      try{execFileSync("git",["merge-base","--is-ancestor",sha,"HEAD"],{stdio:"ignore"});cache.set(sha,true);}
      catch{cache.set(sha,false);}
    }
    return cache.get(sha);
  };
};

function cli(argv){
  const arg=name=>{const i=argv.indexOf("--"+name);return i>=0?argv[i+1]:null;};
  const sprintId=arg("sprint"),taskId=arg("task");
  if(!sprintId || !taskId){console.error("usage: evidence-ledger.mjs --sprint SP-P1-003 --task T008 [--json]");return 2;}
  const read=rel=>JSON.parse(fs.readFileSync(rel,"utf8"));
  const task=(read("delivery/sprints/"+sprintId+"/tasks.json").tasks||[]).find(t=>t.task_id===taskId);
  if(!task){console.error("Task not found: "+sprintId+"/"+taskId);return 2;}
  const dir="delivery/evidence";
  const evidenceList=fs.readdirSync(dir).filter(f=>f.endsWith(".json")).map(f=>read(path.join(dir,f)));
  const ci=read("ci/policy.json"),reform=read("harness/policy/governance-reform.json");
  const requiredCommands=new Set([...(ci.required_on_every_implementation_change||[]).map(x=>"npm run "+x),...(task.required_commands||[])]);
  const ledger=buildEvidenceLedger({task,sprintId,evidenceList,requiredCommands,isAncestor:ancestryChecker(),proofLevels:reform.evidence_proof_levels});
  if(argv.includes("--json")) console.log(JSON.stringify(ledger,null,2));
  else{
    console.log("EVIDENCE LEDGER "+sprintId+"/"+taskId+": "+ledger.evidence_readiness);
    for(const k of ["missing_pairs","missing_commands","duplicates","stale","unreferenced","dangling_refs"]) console.log("- "+k+": "+JSON.stringify(ledger[k]));
    console.log("- missing_review: "+ledger.missing_review);
    console.log("- proof_levels: "+JSON.stringify(ledger.proof_levels));
    console.log(ledger.note);
  }
  return 0;
}
if(import.meta.url===pathToFileURL(process.argv[1]||"").href) process.exit(cli(process.argv.slice(2)));
