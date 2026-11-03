/**
 * Isolated container-only compiled HTML/asset smoke test.
 * This is NOT a browser QA pass or permission to publish.
 */
import {readFile,readdir,lstat} from "node:fs/promises";
import {resolve,join} from "node:path";
const root=resolve(process.cwd(),"dist");
const fail=reason=>{throw Error("APPF2_WEB_SMOKE_"+reason)};
const html=await readFile(join(root,"index.html"),"utf8").catch(()=>fail("HTML_MISSING"));
if(!/<!doctype html>/iu.test(html)||!/<html[\s>]/iu.test(html))
 fail("HTML_INVALID");
const refs=Array.from(html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/gu),m=>m[1]);
if(refs.length===0)fail("NO_ASSET_REFERENCE");
if(refs.length>80)fail("TOO_MANY_ASSETS");
const names=new Set(await readdir(join(root,"assets")));
let scripts=0;
for(const ref of refs){
 if(!/^\/assets\/[A-Za-z0-9_.-]+\.(?:js|css)$/u.test(ref))
  fail("ASSET_PATH_INVALID");
 const file=ref.slice("/assets/".length);
 if(!names.has(file))fail("ASSET_MISSING");
 const stat=await lstat(join(root,"assets",file));
 if(!stat.isFile()||stat.isSymbolicLink()||stat.size<1||stat.size>2*1024*1024)
  fail("ASSET_INVALID");
 await readFile(join(root,"assets",file));
 if(file.endsWith(".js"))scripts++;
}
if(!scripts)fail("NO_COMPILED_JAVASCRIPT");
console.log("APPF2_CONTAINER_COMPILED_ASSET_SMOKE_PASS_NO_BROWSER");
