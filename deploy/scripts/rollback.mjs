import fs from "node:fs";
import path from "node:path";
import {parseArgs,requireEnv,loadRelease,run,renderWorkerConfig,wranglerArgs,statePath,writeJson,outputDir} from "./common.mjs";

const a=parseArgs(process.argv.slice(2));
const releaseId=a.release, environment=a.environment||"production";
if(environment!=="production") throw new Error("Automated rollback is production-only");
const manifest=loadRelease(releaseId);
const sp=statePath(releaseId,environment);
const state=fs.existsSync(sp)?JSON.parse(fs.readFileSync(sp,"utf8")):{release_id:releaseId,environment,targets:[]};
const manualPrevious=Boolean(a["auto-previous"]);
const cfEnv={...process.env,CLOUDFLARE_API_TOKEN:requireEnv("CLOUDFLARE_API_TOKEN"),CLOUDFLARE_ACCOUNT_ID:requireEnv("CLOUDFLARE_ACCOUNT_ID")};
const report={release_id:releaseId,environment,started_at:new Date().toISOString(),mode:manualPrevious?"MANUAL_PREVIOUS":"AUTOMATED_FAILED_RELEASE",targets:[]};

for(const t of [...manifest.targets.filter(x=>x.enabled)].reverse()){
  const deployed=state.targets.find(x=>x.target_id===t.target_id && x.status==="DEPLOYED");
  if(t.type==="CLOUDFLARE_PAGES"){
    if(!deployed && !manualPrevious){
      report.targets.push({target_id:t.target_id,type:t.type,status:"SKIPPED",reason:"TARGET_NOT_DEPLOYED_IN_FAILED_RELEASE"});
      continue;
    }
    const project=requireEnv("CLOUDFLARE_PAGES_PROJECT");
    let previous=deployed?.previous_deployment_id||null;
    if(!previous && manualPrevious){
      const arr=JSON.parse(run("npx",[...wranglerArgs(),"pages","deployment","list","--project-name",project,"--environment","production","--json"],{env:cfEnv,capture:true}));
      const second=Array.isArray(arr)?arr[1]:null; previous=second?.id||second?.Id||null;
    }
    if(!previous) throw new Error("No previous Pages deployment id available for rollback");
    const url="https://api.cloudflare.com/client/v4/accounts/"+encodeURIComponent(process.env.CLOUDFLARE_ACCOUNT_ID)+"/pages/projects/"+encodeURIComponent(project)+"/deployments/"+encodeURIComponent(previous)+"/rollback";
    const r=await fetch(url,{method:"POST",headers:{Authorization:"Bearer "+process.env.CLOUDFLARE_API_TOKEN,"Content-Type":"application/json"},body:"{}"});
    if(!r.ok) throw new Error("Pages rollback failed HTTP "+r.status);
    report.targets.push({target_id:t.target_id,type:t.type,status:"ROLLED_BACK",deployment_id:previous});
  } else if(t.type==="CLOUDFLARE_WORKER"){
    if(!deployed && !manualPrevious){
      report.targets.push({target_id:t.target_id,type:t.type,status:"SKIPPED",reason:"TARGET_NOT_DEPLOYED_IN_FAILED_RELEASE"});
      continue;
    }
    const name=requireEnv("CLOUDFLARE_WORKER_NAME");
    const config=renderWorkerConfig(t.config_path,path.join(outputDir(releaseId,environment),"rollback-wrangler.generated.json"),cfEnv);
    run("npx",[...wranglerArgs(),"rollback","--name",name,"--config",config,"--message","Rollback "+releaseId],{env:cfEnv});
    report.targets.push({target_id:t.target_id,type:t.type,status:"ROLLED_BACK"});
  } else if(t.type==="SUPABASE_MIGRATIONS"){
    report.targets.push({target_id:t.target_id,type:t.type,status:"NOT_ROLLED_BACK",reason:"FORWARD_ONLY_DATABASE"});
  }
}
report.completed_at=new Date().toISOString();
writeJson(path.join(outputDir(releaseId,environment),"rollback-report.json"),report);
console.log("ROLLBACK: PASS");
