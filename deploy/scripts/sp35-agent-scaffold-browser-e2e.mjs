/**
 * Real browser test of the exact trusted multi-file candidate template returned by
 * the new Agent Job API. Fixed test prompt only; no model-produced code is executed
 * by CI, no provider network call, and nothing is deployed or published.
 */
import {createInitialAgentProject} from "../../dist/src/edge/agent-jobs.js";
import {verifyProjectSnapshot} from "../../dist/src/platform/agent/project-workspace.js";
import {build} from "vite";
import {chromium} from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import http from "node:http";
const prompt='建立日常計時器 <img src=x onerror=alert(1)> 測試安全顯示';
const project=await createInitialAgentProject(prompt);
if(!(await verifyProjectSnapshot(project))||project.files.length!==4)
 throw Error("AGENT_SCAFFOLD_INTEGRITY_FAILED");
const root=await fs.mkdtemp(path.join(os.tmpdir(),"appf2-agent-scaffold-"));
let server,browser;
try{
 for(const file of project.files){
  const dest=path.join(root,file.path);
  await fs.mkdir(path.dirname(dest),{recursive:true});
  await fs.writeFile(dest,file.content,"utf8");
 }
 const outDir=path.join(root,"dist");
 await build({root,configFile:false,logLevel:"error",
  build:{outDir,emptyOutDir:true,minify:false}});
 const html=await fs.readFile(path.join(outDir,"index.html"),"utf8");
 if(!html.includes("/assets/"))throw Error("AGENT_SCAFFOLD_NO_BUNDLE");
 server=http.createServer(async(req,res)=>{
  const target=decodeURIComponent(new URL(req.url??"/","http://127.0.0.1").pathname);
  if(!/^\/(?:index\.html|assets\/[A-Za-z0-9_.-]+)?$/u.test(target)){
   res.writeHead(404);res.end();return;
  }
  const file=path.join(outDir,target==="/"?"index.html":target.slice(1));
  try{
   const body=await fs.readFile(file);
   const mime=file.endsWith(".js")?"text/javascript":
    file.endsWith(".css")?"text/css":"text/html";
   res.writeHead(200,{"Content-Type":mime,"X-Content-Type-Options":"nosniff"});
   res.end(body);
  }catch{res.writeHead(404);res.end();}
 });
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const port=server.address().port;
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();
 page.on("dialog",dialog=>{throw Error("AGENT_SCAFFOLD_SCRIPT_EXECUTED:"+dialog.message());});
 await page.goto("http://127.0.0.1:"+port+"/",{waitUntil:"networkidle"});
 if(await page.getByRole("heading",{name:"APPf2 候選專案"}).count()!==1)
  throw Error("AGENT_SCAFFOLD_HEADING_MISSING");
 if(await page.getByText(prompt,{exact:true}).count()!==1)
  throw Error("AGENT_SCAFFOLD_PROMPT_LOST");
 if(await page.locator("img").count()!==0)
  throw Error("AGENT_SCAFFOLD_HTML_INJECTION");
 if(await page.getByText("已保存初始專案；AI 生成尚未開始").count()!==1)
  throw Error("AGENT_SCAFFOLD_MISLEADING_AI_STATUS");
 console.log("SP35 REAL CANDIDATE API SCAFFOLD BUILD + CHROMIUM: PASS (NO MODEL, NO CLOUD)");
}finally{
 if(browser)await browser.close();
 if(server)await new Promise(resolve=>server.close(resolve));
 await fs.rm(root,{recursive:true,force:true});
}
