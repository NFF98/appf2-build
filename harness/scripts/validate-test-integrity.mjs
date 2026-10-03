import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import ts from "typescript";

const root=process.cwd(), errors=[];
const read=r=>JSON.parse(fs.readFileSync(path.join(root,r),"utf8"));
const current=read("delivery/CURRENT-SPRINT.json");
const requireActive=process.env.REQUIRE_ACTIVE_TASK_TESTS==="1";
const testRoots=["tests/unit","tests/contract","tests/behavior","tests/api","tests/runtime","tests/state-machine","tests/e2e","tests/accessibility","tests/responsive","tests/visual","tests/regression"];
const testFiles=[];
const walk=dir=>{
  if(!fs.existsSync(dir)) return;
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    const p=path.join(dir,ent.name);
    if(ent.isDirectory()) walk(p);
    else if(/\.(?:test|spec)\.(?:ts|tsx)$/.test(ent.name)) testFiles.push(p);
  }
};
for(const d of testRoots) walk(path.join(root,d));

const declared=new Map();
const testDeclarationsIn=(text,fileName="test.ts")=>{
  const sf=ts.createSourceFile(fileName,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TS);
  const out=new Map();
  const visit=node=>{
    if(ts.isCallExpression(node) && ts.isIdentifier(node.expression) && (node.expression.text==="test" || node.expression.text==="it")){
      const first=node.arguments[0];
      const title=first && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) ? first.text : "";
      const m=title.match(/TEST-[A-Z0-9-]+/);
      if(m){
        const arr=out.get(m[0])||[];
        arr.push(node.getText(sf));
        out.set(m[0],arr);
      }
    }
    ts.forEachChild(node,visit);
  };
  visit(sf);
  return out;
};
const idsIn=text=>[...testDeclarationsIn(text).keys()];
const declarationsAtRef=(ref,rel)=>{
  try{return testDeclarationsIn(execFileSync("git",["show",ref+":"+rel],{encoding:"utf8"}),rel);}
  catch{return new Map();}
};
const declarationsAtHead=rel=>{
  try{return testDeclarationsIn(fs.readFileSync(path.join(root,rel),"utf8"),rel);}
  catch{return new Map();}
};
const changedFilesFrom=(base,head)=>{
  try{return execFileSync("git",["diff","--name-only",base,head],{encoding:"utf8"}).trim().split("\n").filter(Boolean);}
  catch{return [];}
};
for(const abs of testFiles){
  const rel=path.relative(root,abs).replaceAll("\\","/");
  const text=fs.readFileSync(abs,"utf8");
  for(const id of idsIn(text)){
    const arr=declared.get(id)||[]; arr.push(rel); declared.set(id,arr);
  }
}
for(const [id,files] of declared) if(files.length>1) errors.push("Executable Test ID declared more than once: "+id+" :: "+files.join(", "));

let activeTask=null;
if(current.active_sprint && current.active_task){
  const td=read("delivery/sprints/"+current.active_sprint+"/tasks.json");
  activeTask=(td.tasks||[]).find(t=>t.task_id===current.active_task)||null;
}
if(requireActive){
  if(!activeTask) errors.push("Active Task required for executable Test integrity check.");
  else{
    for(const link of activeTask.acceptance_links||[]){
      const files=declared.get(link.test_id)||[];
      if(files.length!==1) errors.push("Active Task mapped Test ID must have exactly one executable test(): "+link.test_id+" (found "+files.length+")");
    }
  }
}

// A later Task may not silently rewrite executable tests owned by another Task.
const base=process.env.BASE_SHA;
if(activeTask && base && !/^0+$/.test(base)){
  const changed=changedFilesFrom(base,process.env.HEAD_SHA||"HEAD");
  const activeIds=new Set((activeTask.acceptance_links||[]).map(x=>x.test_id));
  const maintenanceKeys=new Set((activeTask.test_maintenance_authorizations||[])
    .filter(a=>a?.mode==="BASELINE_FIXTURE_REBIND" && a?.to_build_spec===activeTask.build_spec_id)
    .map(a=>a.test_id+"::"+a.file));
  for(const rel of changed.filter(p=>p.startsWith("tests/") && /\.(?:test|spec)\.(?:ts|tsx)$/.test(p))){
    const before=declarationsAtRef(base,rel);
    const after=declarationsAtHead(rel);
    for(const [id,beforeDecls] of before){
      const afterDecls=after.get(id)||[];
      const declarationChanged=JSON.stringify(beforeDecls)!==JSON.stringify(afterDecls);
      if(!declarationChanged) continue;
      const maintenanceAuthorized=maintenanceKeys.has(id+"::"+rel);
      if(!activeIds.has(id) && !maintenanceAuthorized) errors.push("Active Task may not modify previously existing mapped Test "+id+" in "+rel);
    }
  }
}

if(errors.length){console.error("TEST INTEGRITY GATE: FAIL");errors.forEach(e=>console.error("- "+e));process.exit(1);}
console.log("TEST INTEGRITY GATE: PASS");
if(requireActive && activeTask) console.log("- Executable mapped tests verified for "+activeTask.task_id);
