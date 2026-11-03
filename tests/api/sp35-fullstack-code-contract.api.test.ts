import {describe,it,expect} from "vitest";
import {createInitialAgentProject} from "../../src/edge/agent-jobs.js";
import {parseAiProjectFiles} from "../../src/edge/free-ai-project-files.js";
import {applyProjectEdits,verifyProjectSnapshot}
 from "../../src/platform/agent/project-workspace.js";
const frontend=[
 {path:"src/main.ts",content:"import './style.css';document.body.textContent='Business App';"},
 {path:"src/style.css",content:"body { font-family: system-ui; margin: 0; }"}
];
const server=[
 {path:"server/index.mjs",content:"export const allocate=(n)=>n*2;"},
 {path:"server/test.mjs",content:"import {test} from 'node:test';test('true backend',()=>{if(2+2!==4)throw Error('FAILED');});"}
];
describe("one author-owned full-stack Agent source, no paid calls",()=>{
 it("creates a durable selectable full-stack Job scaffold while legacy remains VITE_WEB",async()=>{
  const old=await createInitialAgentProject("make a business tracker");
  expect(old.profile).toBe("VITE_WEB");
  const full=await createInitialAgentProject("make a business tracker","VITE_NODE");
  expect(full.profile).toBe("VITE_NODE");
  expect(full.files.some(x=>x.path==="server/index.mjs")).toBe(true);
  expect(full.files.some(x=>x.path==="server/test.mjs")).toBe(true);
  expect(full.files.some(x=>x.path==="package.json")).toBe(false);
  expect(await verifyProjectSnapshot(full)).toBe(true);
 });
 it("keeps full-stack code in same revision and denies frontend-only model output",async()=>{
  const original=await createInitialAgentProject("new unfamiliar business system","VITE_NODE");
  const generated=parseAiProjectFiles({files:[...frontend,...server]},"VITE_NODE");
  expect(generated).toHaveLength(4);
  expect(parseAiProjectFiles({files:frontend},"VITE_NODE")).toBeNull();
  expect(parseAiProjectFiles({files:[...frontend,...server]},"VITE_WEB")).toBeNull();
  const edits=generated!.map(file=>{
   const prior=original.files.find(x=>x.path===file.path);
   return prior?{operation:"replace" as const,path:file.path,content:file.content,
    previous_hash:prior.hash}:{operation:"add" as const,path:file.path,content:file.content};
  });
  const next=await applyProjectEdits(original,original.project_hash,edits);
  expect(next.revision).toBe(2);
  expect(next.profile).toBe("VITE_NODE");
  expect(next.parent_hash).toBe(original.project_hash);
  expect(await verifyProjectSnapshot(next)).toBe(true);
 });
});
