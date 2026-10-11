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

export const acceptanceSemanticDriftIds=(root,legacyBaselineId,currentBaselineId,acceptanceLinks)=>{
  if(legacyBaselineId===currentBaselineId) return [];
  if(!isBaselineAncestor(root,legacyBaselineId,currentBaselineId)) return (acceptanceLinks||[]).map(x=>x.acceptance_id);
  const oldMap=acceptanceRegistryMap(root,legacyBaselineId);
  const newMap=acceptanceRegistryMap(root,currentBaselineId);
  const drift=[];
  for(const link of acceptanceLinks||[]){
    const oldEntry=oldMap.get(link.acceptance_id), newEntry=newMap.get(link.acceptance_id);
    if(!oldEntry || !newEntry || oldEntry.test_id!==link.test_id || newEntry.test_id!==link.test_id || !acceptanceSemanticsEqual(oldEntry,newEntry)){
      drift.push(link.acceptance_id);
    }
  }
  return drift;
};

export const canPreserveCompletedBaseline=(root,legacyBaselineId,currentBaselineId,acceptanceLinks)=>
  acceptanceSemanticDriftIds(root,legacyBaselineId,currentBaselineId,acceptanceLinks).length===0;

const sameIdSet=(values,expected)=>{
  const ids=new Set(Array.isArray(values)?values:[]);
  const wanted=new Set(expected);
  return ids.size===wanted.size && [...wanted].every(x=>ids.has(x));
};

// Each record is paired with the chain point it revalidated from: history entries in order, then the current slot.
export const revalidationRecords=item=>{
  const out=[];
  let from=item.build_spec_id;
  for(const r of Array.isArray(item.revalidation_history)?item.revalidation_history:[]){
    out.push({r,from});
    from=r?.target_build_spec_id;
  }
  if(item.revalidation) out.push({r:item.revalidation,from});
  return out;
};

// Append-only CLOSED revalidations of a DONE item across successive rebaselines; entry k must cover exactly
// the semantic drift from the previous chain point to its own target. Returns null when no history exists.
const historyEntryError=(root,item,r,from)=>{
  const target=r?.target_build_spec_id;
  if(r?.status!=="CLOSED") return "must be CLOSED";
  if(!target || target===from || !isBaselineAncestor(root,from,target)) return "target must strictly descend from "+from;
  const drift=acceptanceSemanticDriftIds(root,from,target,item.acceptance_links);
  if(!drift.length || !sameIdSet(r.acceptance_ids,drift)) return "must cover exactly the drift "+from+" -> "+target;
  return null;
};
export const revalidationHistoryChain=(root,item,currentBaselineId)=>{
  const history=item.revalidation_history;
  if(history===undefined) return null;
  if(!Array.isArray(history) || !history.length) return {errors:["revalidation_history must be a non-empty array"],end:null,entries:[]};
  let from=item.build_spec_id;
  for(const [i,r] of history.entries()){
    const error=historyEntryError(root,item,r,from);
    if(error) return {errors:["revalidation_history["+i+"] "+error],end:null,entries:history};
    from=r.target_build_spec_id;
  }
  const errors=from===currentBaselineId || !isBaselineAncestor(root,from,currentBaselineId)
    ?["revalidation_history must end at a strict ancestor of "+currentBaselineId]:[];
  return {errors,end:from,entries:history};
};
