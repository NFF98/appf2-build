import fs from "node:fs";
import path from "node:path";
import {
  parseArgs,requireEnv,safePath,loadRelease,ensureDir,writeJson,run,renderWorkerConfig,
  wranglerArgs,supabaseArgs,parseWranglerOutput,statePath,outputDir
} from "./common.mjs";

const a=parseArgs(process.argv.slice(2));
const environment=a.environment;
const releaseId=a.release;
if(!["staging","production"].includes(environment)) throw new Error("--environment must be staging or production");
const manifest=loadRelease(releaseId);
if(manifest.status!=="RELEASE_READY" || manifest.approval?.status!=="USER_APPROVED") throw new Error("Release is not approved / ready");
const outDir=outputDir(releaseId,environment); ensureDir(outDir);
const state={release_id:releaseId,environment,source_commit:manifest.source_commit,started_at:new Date().toISOString(),targets:[]};

const cfEnv=()=>({
  ...process.env,
  CLOUDFLARE_API_TOKEN:requireEnv("CLOUDFLARE_API_TOKEN"),
  CLOUDFLARE_ACCOUNT_ID:requireEnv("CLOUDFLARE_ACCOUNT_ID")
});

for(const t of manifest.targets.filter(x=>x.enabled)){
  if(t.type==="SUPABASE_MIGRATIONS"){
    if(environment==="production"){
      if(t.migration_policy!=="FORWARD_COMPATIBLE_EXPAND_ONLY" || t.human_reviewed!==true) throw new Error("Production DB migration requires reviewed expand-only policy");
    }
    const migrations=safePath(t.migrations_path);
    if(!fs.existsSync(migrations)) throw new Error("Migrations path missing: "+t.migrations_path);
    const env={...process.env,
      SUPABASE_ACCESS_TOKEN:requireEnv("SUPABASE_ACCESS_TOKEN"),
      SUPABASE_DB_PASSWORD:requireEnv("SUPABASE_DB_PASSWORD")
    };
    const project=requireEnv("SUPABASE_PROJECT_ID");
    run("npx",[...supabaseArgs(),"link","--project-ref",project],{env});
    run("npx",[...supabaseArgs(),"db","push","--dry-run","--linked"],{env});
    run("npx",[...supabaseArgs(),"db","push","--yes","--linked"],{env});
    state.targets.push({target_id:t.target_id,type:t.type,status:"DEPLOYED",rollback:"FORWARD_ONLY"});
    writeJson(statePath(releaseId,environment),state);
  } else if(t.type==="CLOUDFLARE_WORKER"){
    const template=safePath(t.config_path);
    if(!fs.existsSync(template)) throw new Error("Worker config template missing: "+t.config_path);
    const name=requireEnv("CLOUDFLARE_WORKER_NAME");
    const env=cfEnv();
    const config=renderWorkerConfig(t.config_path,path.join(outDir,"wrangler.generated.json"),env);
    let previous=null;
    if(environment==="production"){
      try{previous=JSON.parse(run("npx",[...wranglerArgs(),"deployments","status","--name",name,"--config",config,"--json"],{env,capture:true}));}
      catch{previous=null;}
    }
    const output=path.join(outDir,"worker.ndjson");
    const depEnv={...env,WRANGLER_OUTPUT_FILE_PATH:output};
    run("npx",[...wranglerArgs(),"deploy","--name",name,"--config",config],{env:depEnv});
    const events=parseWranglerOutput(output);
    const deployEvent=[...events].reverse().find(e=>e.type==="deploy" || e.type==="version-deploy");
    state.targets.push({target_id:t.target_id,type:t.type,status:"DEPLOYED",previous_deployment:previous,new_deployment:deployEvent||null});
    writeJson(statePath(releaseId,environment),state);
  } else if(t.type==="CLOUDFLARE_PAGES"){
    const artifact=safePath(t.artifact_path);
    if(!fs.existsSync(artifact)) throw new Error("Pages artifact missing: "+t.artifact_path);
    const project=requireEnv("CLOUDFLARE_PAGES_PROJECT");
    const env=cfEnv();
    let previous_id=null;
    if(environment==="production"){
      try{
        const arr=JSON.parse(run("npx",[...wranglerArgs(),"pages","deployment","list","--project-name",project,"--environment","production","--json"],{env,capture:true}));
        const first=Array.isArray(arr)?arr[0]:null;
        previous_id=first?.id||first?.Id||null;
      }catch{previous_id=null;}
    }
    const output=path.join(outDir,"pages.ndjson");
    const depEnv={...env,WRANGLER_OUTPUT_FILE_PATH:output};
    const branch=environment==="production" ? (process.env.CLOUDFLARE_PAGES_PRODUCTION_BRANCH||"main") : "staging-"+releaseId.toLowerCase();
    run("npx",[...wranglerArgs(),"pages","deploy",artifact,"--project-name",project,"--branch",branch,"--commit-hash",manifest.source_commit,"--commit-dirty","false"],{env:depEnv});
    const events=parseWranglerOutput(output);
    const deployEvent=[...events].reverse().find(e=>e.type==="pages-deploy");
    state.targets.push({target_id:t.target_id,type:t.type,status:"DEPLOYED",previous_deployment_id:previous_id,new_deployment:deployEvent||null});
    writeJson(statePath(releaseId,environment),state);
  } else {
    throw new Error("Unsupported deployment target type: "+t.type);
  }
}
state.completed_at=new Date().toISOString();
writeJson(statePath(releaseId,environment),state);
console.log("DEPLOY: PASS "+releaseId+" "+environment);
