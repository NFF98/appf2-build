/**
 * Triggered from a creator-P256 signed Worker dispatch. GitHub receives only
 * a 30-minute encrypted ticket; never source/prompt/DB credential. Runner
 * obtains GitHub OIDC and Worker verifies signature, repository and workflow.
 * Untrusted source may ONLY compile in network-denied Docker and then render
 * in a browser with third-party network requests blocked. No publishing.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {spawnSync} from "node:child_process";
import {chromium} from "@playwright/test";
import {verifyProjectSnapshot} from "../../dist/src/platform/agent/project-workspace.js";
import {stageVerifiedFreeCiProject} from "./sp35-free-ci-stage-project.mjs";
const host="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
const ticket=process.env.APPF2_FREE_CI_TICKET??"";
const audience="appf2-sp35-free-ci-private-source-v1";
if(!/^[A-Za-z0-9_-]{80,3000}$/u.test(ticket))
 throw Error("FREE_CI_DISPATCH_TICKET_INVALID");
if(process.env.GITHUB_REPOSITORY!=="NFF98/appf2-build"||
 process.env.GITHUB_EVENT_NAME!=="workflow_dispatch"||
 process.env.GITHUB_REF!=="refs/heads/product/sprint-3.5-complex-intent-recovery-20261026")
 throw Error("FREE_CI_UNTRUSTED_RUN");
const requestUrl=process.env.ACTIONS_ID_TOKEN_REQUEST_URL??"";
const requestToken=process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN??"";
if(!requestUrl.startsWith("https://pipelines.actions.githubusercontent.com/")||
 requestToken.length<20)throw Error("FREE_CI_OIDC_NOT_PROVIDED");
const endpoint=new URL(requestUrl);
endpoint.searchParams.set("audience",audience);
const assertion=await fetch(endpoint,{headers:{
 Authorization:"Bearer "+requestToken},signal:globalThis.AbortSignal.timeout(12000)});
const oidc=await assertion.json().catch(()=>null);
if(!assertion.ok||typeof oidc?.value!=="string")
 throw Error("FREE_CI_OIDC_ISSUANCE_FAILED");
const source=await fetch(host+"/api/v1/internal/free-ci/source",{
 method:"POST",headers:{"Authorization":"Bearer "+oidc.value,
  "Content-Type":"application/json"},body:JSON.stringify({ticket}),
 signal:globalThis.AbortSignal.timeout(25000),redirect:"error"});
const data=await source.json().catch(()=>null);
if(source.status!==200||!data?.data?.project)
 throw Error("FREE_CI_SECURE_SOURCE_UNAVAILABLE_HTTP_"+source.status);
const project=data.data.project;
if(!await verifyProjectSnapshot(project))throw Error("FREE_CI_SOURCE_HASH_INVALID");
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"sp35-oidc-free-ci-"));
let browser,server;
function docker(args){
 const result=spawnSync("docker",args,{
  encoding:"utf8",timeout:140000,maxBuffer:512*1024});
 if(result.error||result.status!==0)
  throw Error("FREE_CI_BUILD_FAILED:"+String(result.status));
}
try{
 const staged=await stageVerifiedFreeCiProject(project,tmp);
 if(staged.project_hash!==project.project_hash)
  throw Error("FREE_CI_STAGED_HASH_CHANGED");
 docker(["build","-t","appf2-sp35-free-ci:oidc",
  "-f","deploy/free-ci/Dockerfile","deploy"]);
 const uid=process.getuid?.()??1000,gid=process.getgid?.()??1000;
 docker(["run","--rm","--network","none","--cap-drop","ALL",
  "--security-opt","no-new-privileges","--pids-limit","100",
  "--memory","768m","--cpus","1","--user",uid+":"+gid,
  "--tmpfs","/tmp:rw,nosuid,size=64m",
  "-v",tmp+":/workspace/agent:rw","-w","/workspace/agent",
  "appf2-sp35-free-ci:oidc","node","/opt/appf2/build-locked.mjs"]);
 const html=await fs.readFile(path.join(tmp,"dist/index.html"),"utf8");
 if(html.length<50)throw Error("FREE_CI_BUILD_HTML_EMPTY");
 server=http.createServer(async(req,res)=>{
  const p=new URL(req.url??"/","http://127.0.0.1").pathname;
  if(!/^\/(?:index\.html|assets\/[A-Za-z0-9_.-]+)?$/u.test(p)){
   res.writeHead(404);res.end();return;}
  try{
   const data=await fs.readFile(path.join(tmp,"dist",p==="/"
    ?"index.html":p.slice(1)));
   res.setHeader("Content-Type",p.endsWith(".js")?"text/javascript":
    p.endsWith(".css")?"text/css":"text/html");
   res.end(data);
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const origin="http://127.0.0.1:"+server.address().port;
 browser=await chromium.launch({headless:true});
 const ctx=await browser.newContext({serviceWorkers:"block"});
 await ctx.route("**/*",route=>route.request().url().startsWith(origin+"/")?
  route.continue():route.abort());
 const page=await ctx.newPage();
 await page.goto(origin,{waitUntil:"load",timeout:15000});
 await page.locator("body").waitFor({state:"visible",timeout:12000});
 console.log("SP35 PRIVATE FREE CI: OIDC verified by Worker, DB snapshot hash verified, Docker build + Chromium render PASS");
 console.log("SP35 LIMIT: smoke only; original-requirement independent QA/receipt and v2 publication NOT VERIFIED");
 await ctx.close();
}finally{
 await browser?.close().catch(()=>{});
 if(server)await new Promise(resolve=>server.close(resolve));
 await fs.rm(tmp,{force:true,recursive:true});
}
