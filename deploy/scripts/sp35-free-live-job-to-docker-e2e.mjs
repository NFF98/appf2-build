/** Actual staging Worker/PG multi-file bytes -> FREE Docker -> real Chromium.
 * Does not call AI, use provider secrets or trigger any paid service.
 * This proves real private owner-signed source transfer, not autonomous AI
 * user-job dispatch, v2 publication, or generated backend CRUD.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {spawnSync} from "node:child_process";
import {randomUUID,webcrypto} from "node:crypto";
import {chromium} from "@playwright/test";
import {createProjectSnapshot} from "../../dist/src/platform/agent/project-workspace.js";
import {stageVerifiedFreeCiProject} from "./sp35-free-ci-stage-project.mjs";

const origin="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
const crypto=webcrypto,uuid=randomUUID(),prompt="幫我做一個具有互動計分功能的骰子遊戲";
const key=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},
 false,["sign","verify"]);
const b64=bytes=>Buffer.from(bytes).toString("base64url");
const spki=b64(await crypto.subtle.exportKey("spki",key.publicKey));
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"sp35-live-db-free-docker-"));
let browser,server;
async function signed(pathname,payload){
 const raw=new TextEncoder().encode(JSON.stringify(payload));
 const hash=b64(await crypto.subtle.digest("SHA-256",raw));
 const nonce="sp35LiveFreeCi_"+randomUUID().replaceAll("-","");
 const now=Date.now();
 const message=new TextEncoder().encode(JSON.stringify([
  "APPF2_MUTATION_PoP_V1","POST",pathname,hash,nonce,now]));
 const sig=b64(await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},
  key.privateKey,message));
 const response=await fetch(origin+pathname,{
  method:"POST",redirect:"error",
  headers:{"Content-Type":"application/json","Origin":origin,
   "Sec-Fetch-Site":"same-origin","Idempotency-Key":nonce,
   "X-Appf2-PoP-Key":spki,"X-Appf2-PoP-Signature":sig,
   "X-Appf2-PoP-Timestamp":String(now)},
  body:raw,signal:AbortSignal.timeout(25000)});
 const result=await response.json().catch(()=>null);
 if(!response.ok||!result?.data)
  throw Error("FREE_CI_LIVE_WORKER_HTTP_"+response.status);
 return result.data;
}
function docker(args){
 const res=spawnSync("docker",args,{encoding:"utf8",timeout:120000});
 if(res.error||res.status!==0)
  throw Error("FREE_CI_DOCKER_FAILED:"+String(res.status)+":"+
   (res.stderr??"").slice(-350));
}
try{
 const created=await signed("/api/v1/agent-jobs",
  {anonymous_id:uuid,prompt});
 if(created.status!=="CREATED"||created.ai_started!==false||
  created.app_published!==false)
  throw Error("FREE_CI_LIVE_CREATE_INVALID");
 const read=await signed("/api/v1/agent-jobs/"+created.job_id,
  {anonymous_id:uuid});
 if(read.job_id!==created.job_id||read.project_hash!==created.project_hash||
  read.ai_started!==false||!Array.isArray(read.files)||read.files.length!==4)
  throw Error("FREE_CI_LIVE_READ_MISMATCH");
 const snapshot=await createProjectSnapshot("VITE_WEB","index.html",
  read.files.map(f=>({path:f.path,content:f.content})));
 if(snapshot.project_hash!==read.project_hash)
  throw Error("FREE_CI_DB_SOURCE_HASH_MISMATCH");
 await stageVerifiedFreeCiProject(snapshot,tmp);
 const uid=process.getuid?.()??1000,gid=process.getgid?.()??1000;
 docker(["run","--rm","--network","none","--cap-drop","ALL",
  "--security-opt","no-new-privileges","--pids-limit","100",
  "--memory","768m","--cpus","1","--user",uid+":"+gid,
  "--tmpfs","/tmp:rw,nosuid,size=64m",
  "-v",tmp+":/workspace/live:rw","-w","/workspace/live",
  "appf2-sp35-free-ci:ci","node","/opt/appf2/build-locked.mjs"]);
 const html=await fs.readFile(path.join(tmp,"dist/index.html"),"utf8");
 if(!html.includes("/assets/"))throw Error("FREE_CI_LIVE_BUILD_NO_ASSETS");
 // Compiled output is served only on ephemeral localhost; never published.
 server=http.createServer(async(req,res)=>{
  const p=new URL(req.url??"/","http://127.0.0.1").pathname;
  if(!/^\/(?:index\.html|assets\/[A-Za-z0-9_.-]+)?$/u.test(p)){
   res.writeHead(404);res.end();return;}
  const file=path.join(tmp,"dist",p==="/"
   ?"index.html":p.slice(1));
  try{
   const data=await fs.readFile(file);
   res.setHeader("Content-Type",file.endsWith(".js")?
    "text/javascript":file.endsWith(".css")?"text/css":"text/html");
   res.end(data);
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const address="http://127.0.0.1:"+server.address().port;
 browser=await chromium.launch({headless:true});
 const context=await browser.newContext();
 await context.route("**/*",route=>
  route.request().url().startsWith(address+"/")?
   route.continue():route.abort());
 const page=await context.newPage();
 await page.goto(address,{waitUntil:"load",timeout:15000});
 await page.getByRole("heading",{name:"APPf2 候選專案"})
  .waitFor({timeout:15000});
 await page.getByText(prompt,{exact:true}).waitFor({timeout:15000});
 console.log("SP35 LIVE POSTGRES JOB → FREE DOCKER VITE → REAL CHROMIUM: PASS");
 console.log("SP35 LIVE JOB SOURCE VERIFIED: four files, same project hash, zero model calls; no publish");
 await context.close();
}finally{
 await browser?.close().catch(()=>{});
 if(server)await new Promise(resolve=>server.close(resolve));
 await fs.rm(tmp,{recursive:true,force:true});
}
