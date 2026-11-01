import {describe,it,expect} from "vitest";
import {aiProjectSchema,parseAiProjectFiles}
 from "../../src/edge/free-ai-project-files.js";
import {createProjectSnapshot,applyProjectEdits,verifyProjectSnapshot}
 from "../../src/platform/agent/project-workspace.js";

const main="import './style.css'; import {render} from './features/view'; render(document.querySelector('#app')!);";
const css="body { font-family: system-ui; margin: 0; }";
const view="export function render(root:Element){const b=document.createElement('button');b.textContent='開始';root.replaceChildren(b);}";
const good=[
 {path:"src/main.ts",content:main},
 {path:"src/style.css",content:css},
 {path:"src/features/view.ts",content:view}
];
describe("Sprint 3.5 GPT-6 one-sentence App multi-module source contract",()=>{
 it("accepts genuinely different structures without App-type-specific templates",()=>{
  for(const domain of ["tasks","habits","calculator","creative-game"]){
   const extra={path:"src/domain/"+domain+".ts",
    content:"export const productKind="+JSON.stringify(domain)+";"};
   const result=parseAiProjectFiles({files:[...good,extra]});
   expect(result?.map(f=>f.path)).toContain(extra.path);
   expect(result?.length).toBe(4);
  }
  expect(aiProjectSchema.required).toEqual(["files"]);
 });
 it("preserves already paid two-field GPT-6 model responses for same-Job recovery",()=>{
  const saved=parseAiProjectFiles({main_ts:main,style_css:css});
  expect(saved?.map(f=>f.path)).toEqual(["src/main.ts","src/style.css"]);
 });
 it("rejects incomplete, unsafe, poisoned, or fake source before committing Job",()=>{
  const invalid=[
   {files:good.slice(0,1)}, {files:good.slice(1)},
   {files:[...good,{path:"src/MAIN.ts",content:main}]},
   {files:[...good,{path:"src/../payload.ts",content:view}]},
   {files:[...good,{path:".github/workflows/publish.yml",content:view}]},
   {files:[...good,{path:"package.json",content:view}]},
   {files:[...good,{path:"src/server.js",content:view}]},
   {files:[...good,{path:"src/external.ts",content:"fetch('https://example.com')"}]},
   {files:[...good,{path:"src/null.ts",content:"export const x='\\u0000';"}]},
   {files:[...good,{path:"src/no.ts",content:"</script>"}]},
   {files:[...good,{path:"src/secret.env",content:view}]},
   {files:Array.from({length:13},(_,i)=>({path:"src/mod"+i+".ts",content:view}))},
   {files:[...good,{path:"src/illegal.ts",content:"x".repeat(65001)}]},
   {main_ts:main,style_css:css,success:true},
   {files:good,passed:true}
  ];
  for(const v of invalid)expect(parseAiProjectFiles(v)).toBeNull();
 });
 it("creates an immutable real Project V1 snapshot with nested modules and safe repair",async()=>{
  const base=await createProjectSnapshot("VITE_WEB","index.html",[
   {path:"index.html",content:"<div id='app'></div>"},
   {path:"package.json",content:'{"private":true,"type":"module"}'},
   {path:"src/main.ts",content:"document.body.textContent='OLD';"},
   {path:"src/style.css",content:"body { color: black; }"},
   {path:"src/legacy.ts",content:"export const old = 1;"}
  ]);
  const generated=parseAiProjectFiles({files:good})!;
  const prior=new Map(base.files.map(f=>[f.path,f]));
  const edits=[
   ...generated.map(file=>({operation:prior.has(file.path)?"replace" as const:"add" as const,
    path:file.path,content:file.content,
    ...(prior.has(file.path)?{previous_hash:prior.get(file.path)!.hash}:{})})),
   {operation:"delete" as const,path:"src/legacy.ts",
    previous_hash:prior.get("src/legacy.ts")!.hash}
  ];
  const result=await applyProjectEdits(base,base.project_hash,
   edits as Parameters<typeof applyProjectEdits>[2]);
  expect(await verifyProjectSnapshot(result)).toBe(true);
  expect(result.files.some(f=>f.path==="src/features/view.ts")).toBe(true);
  expect(result.files.some(f=>f.path==="src/legacy.ts")).toBe(false);
  expect(result.files.some(f=>f.path==="package.json")).toBe(true);
  expect(result.parent_hash).toBe(base.project_hash);
  expect(result.revision).toBe(2);
 });
});
