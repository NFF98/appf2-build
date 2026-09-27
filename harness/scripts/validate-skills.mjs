import fs from "node:fs";
import path from "node:path";

const root=process.cwd(), errors=[];
const registry=JSON.parse(fs.readFileSync(path.join(root,"skills/REGISTRY.json"),"utf8"));
if(registry.schema_version!==1) errors.push("Skill registry schema_version must be 1");
if(!Array.isArray(registry.skills)||!registry.skills.length) errors.push("Skill registry must contain skills");
const ids=new Set();
const validateSkillFile=s=>{
  if(typeof s.path!=="string" || !s.path.startsWith("skills/") || s.path.includes("..")){
    errors.push(s.id+" invalid path");
    return;
  }
  const p=path.join(root,s.path);
  if(!fs.existsSync(p)){
    errors.push(s.id+" SKILL.md missing");
    return;
  }
  const body=fs.readFileSync(p,"utf8");
  for(const marker of ["# Skill:","## Purpose"]){
    if(!body.includes(marker)) errors.push(s.id+" missing required section "+marker);
  }
  if(!body.includes("Stop") && !body.includes("Forbidden")) errors.push(s.id+" must define Stop or Forbidden boundary");
};

for(const s of registry.skills||[]){
  if(!/^[a-z][a-z0-9-]*$/.test(s.id||"")) errors.push("Invalid skill id: "+s.id);
  if(ids.has(s.id)) errors.push("Duplicate skill id: "+s.id); ids.add(s.id);
  if(!/^\d+\.\d+\.\d+$/.test(s.version||"")) errors.push(s.id+" invalid version");
  validateSkillFile(s);
  if(!s.actor || !s.phase) errors.push(s.id+" missing actor/phase");
}
if(errors.length){console.error("SKILL GATE: FAIL");errors.forEach(e=>console.error("- "+e));process.exit(1);}
console.log("SKILL GATE: PASS ("+ids.size+" skills)");
