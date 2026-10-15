// GOV-REFORM-20261013: Task-PR Evidence ledger as an automatic,
 // read-only report. No Evidence or Task files are mutated. The report is not a PASS.
import fs from "node:fs";
import {spawnSync} from "node:child_process";
import {pathToFileURL} from "node:url";

export function reportContext(event, current){
  const body=event?.pull_request?.body||"";
  const match=/^Task:\s*(T\d{3})\b/m.exec(body);
  if(!event?.pull_request || !match) return {status:"NOT_RUN_NO_TASK_PR"};
  const id=match[1];
  if(!current.active_sprint) return {status:"NOT_RUN_NO_ACTIVE_SPRINT",task_id:id};
  return {status:"READY_TO_REPORT",task_id:id,sprint_id:current.active_sprint};
}
function cli(args){
  const index=args.indexOf("--event"), outIndex=args.indexOf("--out");
  if(index<0 || outIndex<0 || !args[index+1] || !args[outIndex+1])
    throw Error("usage: evidence-ledger-report.mjs --event EVENT_JSON --out REPORT_JSON");
  const event=JSON.parse(fs.readFileSync(args[index+1],"utf8"));
  const sprint=JSON.parse(fs.readFileSync("delivery/CURRENT-SPRINT.json","utf8"));
  const ctx=reportContext(event,sprint);
  let report=ctx;
  if(ctx.status==="READY_TO_REPORT"){
    const child=spawnSync(process.execPath,["harness/scripts/evidence-ledger.mjs",
      "--sprint",ctx.sprint_id,"--task",ctx.task_id,"--json"],
      {encoding:"utf8",timeout:30000});
    report=child.status===0?{...ctx,...JSON.parse(child.stdout)}:
      {...ctx,status:"REPORT_ERROR",error:(child.stderr||"unknown").slice(0,500)};
  }
  fs.writeFileSync(args[outIndex+1],JSON.stringify(report,null,2)+"\n");
  console.log("EVIDENCE AUTO-REPORT: "+(report.evidence_readiness||report.status)+
    " (not a Task Closure or Product PASS)");
  return report.status==="REPORT_ERROR"?1:0;
}
if(import.meta.url===pathToFileURL(process.argv[1]||"").href)
  process.exit(cli(process.argv.slice(2)));
