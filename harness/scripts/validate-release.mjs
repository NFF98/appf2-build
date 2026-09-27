import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const root=process.cwd(), errors=[];
const args={};
for(let i=2;i<process.argv.length;i++) if(process.argv[i].startsWith("--")) args[process.argv[i].slice(2)]=process.argv[i+1]&&!process.argv[i+1].startsWith("--")?process.argv[++i]:true;
const allowedTypes=new Set(["CLOUDFLARE_PAGES","CLOUDFLARE_WORKER","SUPABASE_MIGRATIONS"]);
const manifestsDir=path.join(root,"releases/manifests");
const files=fs.existsSync(manifestsDir)?fs.readdirSync(manifestsDir).filter(f=>/^REL-P\d+-\d{3}\.json$/.test(f)):[];
const selected=args.release?[args.release+".json"]:files;
const validatePromotionHead=(id,m,head)=>{
  if(!head) return;
  try{
    execFileSync("git",["cat-file","-e",m.source_commit+"^{commit}"],{stdio:"ignore"});
    const changed=execFileSync("git",["diff","--name-only",m.source_commit,head],{encoding:"utf8"}).trim().split("\n").filter(Boolean);
    for(const f of changed){
      if(!f.startsWith("releases/")) errors.push(id+" release promotion head differs from source_commit outside releases/: "+f);
    }
  }catch{errors.push(id+" source_commit is not available / comparable to promotion head");}
};

for(const file of selected){
  const p=path.join(manifestsDir,file);
  if(!fs.existsSync(p)){errors.push("Release manifest missing: "+file);continue;}
  const m=JSON.parse(fs.readFileSync(p,"utf8"));
  const id=file.replace(/\.json$/,"");
  if(m.release_id!==id) errors.push(id+" release_id mismatch");
  if(m.schema_version!==1) errors.push(id+" schema_version must be 1");
  if(m.status!=="RELEASE_READY") errors.push(id+" must be RELEASE_READY");
  if(!/^BS-P\d+-\d{3}$/.test(m.build_spec_id||"")) errors.push(id+" invalid build_spec_id");
  const bmp=path.join(root,"build-spec/baselines",m.build_spec_id||"","manifest.json");
  if(!fs.existsSync(bmp)) errors.push(id+" Build Spec missing");
  else if(JSON.parse(fs.readFileSync(bmp,"utf8")).status!=="LOCKED") errors.push(id+" Build Spec not LOCKED");
  if(!/^[0-9a-f]{40}$/.test(m.source_commit||"")) errors.push(id+" invalid source_commit");
  if(m.approval?.status!=="USER_APPROVED" || !m.approval?.decision_ref) errors.push(id+" missing User Release approval");
  if(!Array.isArray(m.sprint_ids)||!m.sprint_ids.length) errors.push(id+" requires sprint_ids");
  for(const sid of m.sprint_ids||[]){
    const gr=path.join(root,"delivery/sprints",sid,"gate-result.json");
    if(!fs.existsSync(gr)){errors.push(id+" missing Sprint gate result "+sid);continue;}
    const g=JSON.parse(fs.readFileSync(gr,"utf8"));
    if(g.status!=="PASS" || g.build_spec_id!==m.build_spec_id || g.required_acceptance_passed!==true || g.regression_passed!==true) errors.push(id+" Sprint "+sid+" not release-ready");
    if((g.blocking_findings||[]).length || (g.open_design_deltas||[]).length) errors.push(id+" Sprint "+sid+" has blockers");
  }
  if(!Array.isArray(m.targets)||!m.targets.some(t=>t.enabled)) errors.push(id+" requires at least one enabled target");
  const targetIds=new Set();
  for(const t of m.targets||[]){
    if(targetIds.has(t.target_id)) errors.push(id+" duplicate target_id "+t.target_id); targetIds.add(t.target_id);
    if(!allowedTypes.has(t.type)) errors.push(id+" unsupported target type "+t.type);
    for(const bad of ["command","shell","script","run"]) if(Object.hasOwn(t,bad)) errors.push(id+" target may not contain arbitrary "+bad);
    if(t.enabled && t.type==="CLOUDFLARE_PAGES" && (!t.artifact_path || t.artifact_path.includes(".."))) errors.push(id+" invalid Pages artifact_path");
    if(t.enabled && t.type==="CLOUDFLARE_WORKER" && (!t.config_path || t.config_path.includes(".."))) errors.push(id+" invalid Worker config_path");
    if(t.enabled && t.type==="SUPABASE_MIGRATIONS"){
      if(t.migration_policy!=="FORWARD_COMPATIBLE_EXPAND_ONLY" || t.human_reviewed!==true) errors.push(id+" Production-capable DB target requires reviewed expand-only migration policy");
      if(!t.migrations_path || t.migrations_path.includes("..")) errors.push(id+" invalid migrations_path");
    }
  }
  if(!Array.isArray(m.health_checks)||!m.health_checks.length) errors.push(id+" requires health_checks");
  for(const h of m.health_checks||[]){
    if(!h.name || !h.base_url_env || typeof h.path!=="string" || !Array.isArray(h.expected_status)||!h.expected_status.length) errors.push(id+" invalid health check");
  }
  if(m.rollback?.cloudflare_code_auto!==true || m.rollback?.database_auto!==false || m.rollback?.database_strategy!=="FORWARD_ONLY") errors.push(id+" invalid rollback policy");

  validatePromotionHead(id,m,args.head);
}
if(errors.length){console.error("RELEASE GATE: FAIL");errors.forEach(e=>console.error("- "+e));process.exit(1);}
console.log("RELEASE GATE: PASS"+(selected.length?" ("+selected.length+" manifest(s))":""));
