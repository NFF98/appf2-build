import {describe,it,expect} from "vitest";
import {selectBoundedRepairContext}
 from "../../src/edge/free-ci-ai-code.js";

const files=[
 {path:"index.html",content:"<div id='app'></div>"},
 {path:"package.json",content:'{"name":"safe"}'},
 {path:"src/main.ts",content:"import {render} from './ui'; render();"},
 {path:"src/ui.ts",content:"export function render(){console.log('hi')}\n".repeat(120)},
 {path:"src/data.ts",content:"export async function deleteRecord(){return true}"},
 {path:"src/style.css",content:"body{margin:0;padding:0}\n".repeat(450)}
];
describe("SP35 paid model context for real QA-triggered repairs",()=>{
 it("excludes irrelevant huge CSS only for attested state-assertion failures",()=>{
  const previous=JSON.stringify(files);
  const ctx=selectBoundedRepairContext(files,["ASSERTION_FAILED"]);
  expect(ctx.omittedStyle).toBe(true);
  expect(ctx.files.map(f=>f.path)).toContain("src/data.ts");
  expect(ctx.files.map(f=>f.path)).not.toContain("src/style.css");
  expect(ctx.files.map(f=>f.path)).not.toContain("package.json");
  expect(JSON.stringify(files)).toBe(previous);
  expect(ctx.files.length).toBe(3);
 });
 it("keeps CSS when the real failure may require layout or runtime diagnostics",()=>{
  for(const codes of [[],["BROWSER_ERROR"],["ASSERTION_FAILED","BROWSER_ERROR"],
   ["UNKNOWN"],["STEP_FAILED"]]){
   const ctx=selectBoundedRepairContext(files,codes);
   expect(ctx.omittedStyle).toBe(false);
   expect(ctx.files.map(f=>f.path)).toContain("src/style.css");
  }
 });
 it("shrinks only the model input, never original saved project files",()=>{
  const qaFiles=selectBoundedRepairContext(files,["ASSERTION_FAILED"]).files;
  expect(JSON.stringify(qaFiles).length).toBeLessThan(
   JSON.stringify(files).length-6000);
  expect(files.some(f=>f.path==="src/style.css")).toBe(true);
 });
});
