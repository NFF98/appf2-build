import {describe,it,expect} from "vitest";
import {validBuiltAssetRequest,builtAssetContentType,MAX_BUILT_ASSET_BYTES}
 from "../../src/platform/agent/private-built-artifact.js";
const request={job_id:"ba45436c-c3f1-44f1-adc6-bdd0fb1592e7",
 project_hash:"sha256:"+"f".repeat(64),
 build_call_id:"call_build_123456",path:"index.html"};
describe("private read-only built artifact handoff to independent QA",()=>{
 it("only admits immutable Vite index and bounded static build output",()=>{
  expect(validBuiltAssetRequest(request)).toBe(true);
  for(const path of ["assets/index-Bdb2e1.js","assets/app-7df.css"])
   expect(validBuiltAssetRequest({...request,path})).toBe(true);
  expect(MAX_BUILT_ASSET_BYTES).toBe(2097152);
  expect(builtAssetContentType("index.html")).toContain("text/html");
  expect(builtAssetContentType("assets/a.js")).toContain("text/javascript");
 });
 it("refuses source, traversal, dotfile, network URL and extra fields",()=>{
  for(const path of ["src/main.ts","package.json","../secret",
   "dist/index.html","/index.html","assets/../file.js",
   "assets/a.js?secret=1","assets/.env","assets/a.png",
   "https://other.example/x.js","assets/a%2f..%2fkey.js"]){
   expect(validBuiltAssetRequest({...request,path})).toBe(false);
  }
  expect(validBuiltAssetRequest({...request,extra:"anything"})).toBe(false);
  expect(validBuiltAssetRequest({...request,build_call_id:"call_not-signed/"})).toBe(false);
  expect(validBuiltAssetRequest({...request,job_id:"any"})).toBe(false);
  expect(validBuiltAssetRequest({...request,project_hash:"sha256:bad"})).toBe(false);
 });
});
