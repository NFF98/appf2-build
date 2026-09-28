import fs from "node:fs";
import path from "node:path";

const readJson=(root,rel)=>JSON.parse(fs.readFileSync(path.join(root,rel),"utf8"));
const manifestPath=id=>"build-spec/baselines/"+id+"/manifest.json";

export const isBaselineAncestor=(root,ancestorId,currentId)=>{
  if(ancestorId===currentId) return true;
  const seen=new Set();
  let id=currentId;
  while(id){
    if(seen.has(id)) return false;
    seen.add(id);
    const mp=path.join(root,manifestPath(id));
    if(!fs.existsSync(mp)) return false;
    const m=readJson(root,manifestPath(id));
    id=m.supersedes;
    if(id===ancestorId) return true;
  }
  return false;
};

const stable=(value)=>{
  if(Array.isArray(value)) return value.map(stable);
  if(value && typeof value==="object"){
    return Object.fromEntries(Object.keys(value).sort().map(k=>[k,stable(value[k])]));
  }
  return value;
};

export const acceptanceRegistryMap=(root,baselineId)=>{
  const m=readJson(root,manifestPath(baselineId));
  const reg=readJson(root,"build-spec/baselines/"+baselineId+"/"+m.acceptance_registry);
  return new Map((reg.entries||[]).map(e=>[e.acceptance_id,e]));
};

export const acceptanceSemanticsEqual=(a,b)=>
  JSON.stringify(stable(a))===JSON.stringify(stable(b));

export const canPreserveCompletedBaseline=(root,legacyBaselineId,currentBaselineId,acceptanceLinks)=>{
  if(legacyBaselineId===currentBaselineId) return true;
  if(!isBaselineAncestor(root,legacyBaselineId,currentBaselineId)) return false;
  const oldMap=acceptanceRegistryMap(root,legacyBaselineId);
  const newMap=acceptanceRegistryMap(root,currentBaselineId);
  for(const link of acceptanceLinks||[]){
    const oldEntry=oldMap.get(link.acceptance_id), newEntry=newMap.get(link.acceptance_id);
    if(!oldEntry || !newEntry) return false;
    if(oldEntry.test_id!==link.test_id || newEntry.test_id!==link.test_id) return false;
    if(!acceptanceSemanticsEqual(oldEntry,newEntry)) return false;
  }
  return true;
};
