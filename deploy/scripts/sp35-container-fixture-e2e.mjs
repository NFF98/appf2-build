/**
 * Build the private Sandbox image and compile ONLY a trusted committed fixture
 * in a real Docker container with --network none. Never runs AI-generated code.
 * This validates the Vite binary/image build that Wrangler dry-run does not test.
 */
import {spawnSync} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import {chromium} from "@playwright/test";
import {createInitialAgentProject} from "../../dist/src/edge/agent-jobs.js";
import {verifyProjectSnapshot} from "../../dist/src/platform/agent/project-workspace.js";

const image="appf2-sp35-sandbox:ci";
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"appf2-sp35-container-"));
let server,candidateServer,browser;
function run(command,args,maxMinutes=8){
 const result=spawnSync(command,args,{stdio:"inherit",timeout:maxMinutes*60000});
 if(result.error)throw result.error;
 if(result.status!==0)throw Error("APPF2_CONTAINER_STEP_FAILED:"+command+":"+result.status);
}
try{
 await fs.cp(path.resolve("tests/fixtures/sp35-multifile"),tmp,{recursive:true});
 await fs.symlink("/opt/appf2/node_modules",path.join(tmp,"node_modules"),"dir");
 // Container image and commands are fixed; this repo fixture is trusted code.
 run("docker",["build","-t",image,"-f","deploy/sandbox/Dockerfile","deploy/sandbox"]);
 const uid=process.getuid?.()??1000,gid=process.getgid?.()??1000;
 const isolation=[
  "run","--rm","--network","none","--cap-drop","ALL",
  "--security-opt","no-new-privileges","--pids-limit","100",
  "--memory","768m","--cpus","1","--user",uid+":"+gid,
  "--tmpfs","/tmp:rw,nosuid,size=64m",
  "-v",tmp+":/workspace/trusted:rw","-w","/workspace/trusted",image
 ];
 run("docker",[...isolation,"node","/opt/appf2/node_modules/vite/bin/vite.js",
  "build",".","--outDir","dist","--emptyOutDir"],3);
 run("docker",[...isolation,"node","/opt/appf2/web-smoke.mjs"],2);
 const compiled=await fs.readFile(path.join(tmp,"dist","index.html"),"utf8");
 if(!compiled.includes("/assets/"))throw Error("APPF2_CONTAINER_VITE_OUTPUT_MISSING");
 // Independent Chromium QA consumes only the image-built trusted fixture.
 server=http.createServer(async(req,res)=>{
  const target=decodeURIComponent(new URL(req.url??"/","http://127.0.0.1").pathname);
  if(!/^\\/(?:index\\.html|assets\\/[A-Za-z0-9_.-]+)?$/u.test(target)){
   res.writeHead(404);res.end();return;
  }
  const file=path.join(tmp,"dist",target==="/"
   ?"index.html":target.slice(1));
  try{
   const data=await fs.readFile(file);
   const type=file.endsWith(".js")?"text/javascript":
    file.endsWith(".css")?"text/css":"text/html";
   res.writeHead(200,{"Content-Type":type,"X-Content-Type-Options":"nosniff"});
   res.end(data);
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const port=server.address().port;
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();
 await page.goto("http://127.0.0.1:"+port+"/",{waitUntil:"networkidle"});
 await page.getByRole("button",{name:"Add"}).click();
 const observed=await page.locator("#result").textContent();
 if(observed!=="APPF2_MULTIFILE_COMPILED_42")
  throw Error("APPF2_CONTAINER_BROWSER_QA_FAILED:"+observed);
 console.log("SP35 REAL ISOLATED DOCKER VITE → CHROMIUM CLICK: PASS (trusted fixture, NO AI/Cloudflare)");
 // Compile the actual Worker API starter project through the same isolated image.
 const prompt='繁體中文骰子遊戲 <img src=x onerror=alert(1)> 安全測試';
 const candidate=await createInitialAgentProject(prompt);
 if(!(await verifyProjectSnapshot(candidate)))throw Error("CANDIDATE_HASH_INVALID");
 const candidateRoot=path.join(tmp,"candidate");
 await fs.mkdir(candidateRoot,{recursive:true});
 for(const file of candidate.files){
  const dest=path.join(candidateRoot,file.path);
  await fs.mkdir(path.dirname(dest),{recursive:true});
  await fs.writeFile(dest,file.content,"utf8");
 }
 await fs.symlink("/opt/appf2/node_modules",path.join(candidateRoot,"node_modules"),"dir");
 const candidateIsolation=[...isolation.slice(0,-2),"/workspace/trusted/candidate",image];
 run("docker",[...candidateIsolation,"node","/opt/appf2/node_modules/vite/bin/vite.js",
  "build",".","--outDir","dist","--emptyOutDir"],3);
 run("docker",[...candidateIsolation,"node","/opt/appf2/web-smoke.mjs"],2);
 candidateServer=http.createServer(async(req,res)=>{
  const target=decodeURIComponent(new URL(req.url??"/","http://127.0.0.1").pathname);
  if(!/^\\/(?:index\\.html|assets\\/[A-Za-z0-9_.-]+)?$/u.test(target)){
   res.writeHead(404);res.end();return;
  }
  const file=path.join(candidateRoot,"dist",target==="/"
   ?"index.html":target.slice(1));
  try{
   const data=await fs.readFile(file);
   const type=file.endsWith(".js")?"text/javascript":
    file.endsWith(".css")?"text/css":"text/html";
   res.writeHead(200,{"Content-Type":type,"X-Content-Type-Options":"nosniff"});
   res.end(data);
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>candidateServer.listen(0,"127.0.0.1",resolve));
 const candidatePort=candidateServer.address().port;
 const candidatePage=await browser.newPage();
 candidatePage.on("dialog",dialog=>{throw Error("CANDIDATE_SCRIPT_INJECTION:"+dialog.message());});
 await candidatePage.goto("http://127.0.0.1:"+candidatePort+"/",{waitUntil:"networkidle"});
 if(await candidatePage.getByText(prompt,{exact:true}).count()!==1||
   await candidatePage.locator("img").count()!==0||
   await candidatePage.getByText("已保存初始專案；AI 生成尚未開始").count()!==1)
  throw Error("ISOLATED_CANDIDATE_BROWSER_QA_FAILED");
 console.log("SP35 REAL API CANDIDATE → ISOLATED DOCKER VITE → CHROMIUM: PASS (no model)");

}finally{
 if(browser)await browser.close();
 if(candidateServer)await new Promise(resolve=>candidateServer.close(resolve));
 if(server)await new Promise(resolve=>server.close(resolve));
 await fs.rm(tmp,{recursive:true,force:true});
}
