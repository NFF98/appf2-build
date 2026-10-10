import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

export const root=process.cwd();
export const toolchain=JSON.parse(fs.readFileSync(path.join(root,"deploy/TOOLCHAIN.json"),"utf8"));

export function parseArgs(argv){
  const out={};
  for(let i=0;i<argv.length;i++){
    const a=argv[i];
    if(a.startsWith("--")) out[a.slice(2)]=argv[i+1] && !argv[i+1].startsWith("--") ? argv[++i] : true;
  }
  return out;
}
export function requireEnv(name){
  const v=process.env[name];
  if(!v) throw new Error("Missing required environment variable: "+name);
  return v;
}
export function safePath(rel){
  if(typeof rel!=="string" || !rel || path.isAbsolute(rel) || rel.includes("..")) throw new Error("Unsafe repository path: "+rel);
  const p=path.resolve(root,rel);
  if(!p.startsWith(root+path.sep)) throw new Error("Path escapes repository: "+rel);
  return p;
}
export function loadRelease(id){
  if(!/^REL-P\d+-\d{3}$/.test(id||"")) throw new Error("Invalid release id");
  const p=path.join(root,"releases/manifests",id+".json");
  if(!fs.existsSync(p)) throw new Error("Release manifest not found: "+id);
  return JSON.parse(fs.readFileSync(p,"utf8"));
}
export function ensureDir(p){fs.mkdirSync(p,{recursive:true});}
export function writeJson(p,obj){ensureDir(path.dirname(p));fs.writeFileSync(p,JSON.stringify(obj,null,2)+"\n");}
export function run(cmd,args,{env=process.env,cwd=root,capture=false,input=null}={}){
  const r=spawnSync(cmd,args,{cwd,env,encoding:"utf8",stdio:capture?["pipe","pipe","pipe"]:"inherit",input});
  if(r.status!==0){
    if(capture){ if(r.stdout) console.error(r.stdout); if(r.stderr) console.error(r.stderr); }
    throw new Error(cmd+" exited "+r.status);
  }
  return capture ? (r.stdout||"") : "";
}
export function wranglerArgs(){return ["--yes","wrangler@"+toolchain.wrangler];}
export function supabaseArgs(){return ["--yes","supabase@"+toolchain.supabase_cli];}
export function parseWranglerOutput(file){
  if(!fs.existsSync(file)) return [];
  return fs.readFileSync(file,"utf8").split("\n").filter(Boolean).map(line=>{try{return JSON.parse(line);}catch{return null;}}).filter(Boolean);
}
export function statePath(releaseId,environment){
  return path.join(root,".release-state",releaseId,environment,"deployment-state.json");
}
export function outputDir(releaseId,environment){
  return path.join(root,".deploy-output",releaseId,environment);
}

export function renderWorkerConfig(templateRel,destination,env=process.env){
  const template=JSON.parse(fs.readFileSync(safePath(templateRel),"utf8"));
  const required=name=>{
    const value=env[name];
    if(typeof value!=="string" || value.trim()==="") throw new Error("Missing required environment variable: "+name);
    return value.trim();
  };
  const replacements={
    "__APPF2_WORKER_NAME__":required("CLOUDFLARE_WORKER_NAME"),
    "__APPF2_HYPERDRIVE_ID__":required("APPF2_HYPERDRIVE_ID"),
    "__APPF2_API_ROUTE__":required("APPF2_API_ROUTE"),
    "__APPF2_ZONE_NAME__":required("APPF2_ZONE_NAME")
  };
  if(!replacements.__APPF2_API_ROUTE__.endsWith("/api/v1/*")) throw new Error("APPF2_API_ROUTE must end with /api/v1/*");
  const replace=value=>{
    if(Array.isArray(value)) return value.map(replace);
    if(value && typeof value==="object") return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,replace(item)]));
    return typeof value==="string" && Object.hasOwn(replacements,value) ? replacements[value] : value;
  };
  const config=replace(template);
  if(typeof config.main!=="string") throw new Error("Worker config main is missing");
  config.main=safePath(config.main);
  const serialized=JSON.stringify(config);
  if(serialized.includes("__APPF2_")) throw new Error("Worker config contains unresolved placeholders");
  writeJson(destination,config);
  return destination;
}
