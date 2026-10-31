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
import {sealCandidateQaReceipt,verifySignedCandidateQa,
 admitsPublicationFromCandidateReceipt} from "../../dist/src/platform/agent/qa-receipt.js";
import {createHash,randomBytes} from "node:crypto";
import {runBuiltAppQa} from "./sp35-built-app-independent-qa.mjs";
import {sealAgentQaPacket,verifyAgentQaPacket}
 from "../../dist/src/platform/agent/qa-packet.js";
import {sha256CodeBytes} from "../../dist/src/platform/blueprint/code-artifact-v2.js";
import {viteCompiledAssetPaths,splitBuiltAsset,assembleBuiltAsset}
 from "../../dist/src/platform/agent/private-built-artifact.js";


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
 const cachedAssetPaths=viteCompiledAssetPaths(compiled);
 for(const asset of cachedAssetPaths){
  const bytes=await fs.readFile(path.join(tmp,"dist",asset));
  const stored=assembleBuiltAsset(splitBuiltAsset(new Uint8Array(bytes)));
  if(Buffer.compare(Buffer.from(stored),bytes)!==0)
   throw Error("APPF2_COMPILED_ASSET_DURABILITY_MISMATCH:"+asset);
 }
 console.log("SP35 REAL VITE OUTPUT -> BOUNDED DURABLE-ASSET SNAPSHOT: PASS");
 // Independent Chromium QA consumes only the image-built trusted fixture.
 server=http.createServer(async(req,res)=>{
  const target=decodeURIComponent(new URL(req.url??"/","http://127.0.0.1").pathname);
  if(!/^\/(?:index\.html|assets\/[A-Za-z0-9_.-]+)?$/u.test(target)){
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

 // The separately trusted verifier consumes the ORIGINAL requirements and the
 // actual image-produced multi-file build, not success text from run_test.
 const originalPrompt="按 Add 按鈕後，顯示 APPF2_MULTIFILE_COMPILED_42";
 const originalPlan={version:"1",criteria:[{
  id:"add_button",source_quote:"Add 按鈕",description:"新增操作可按",
  steps:[],assertions:[{kind:"visible",role:"button",name:"Add"}],
  automatable:true
 },{
  id:"changed_result",source_quote:"顯示 APPF2_MULTIFILE_COMPILED_42",
  description:"實際點擊後結果更新",
  steps:[{action:"click",role:"button",name:"Add"}],
  assertions:[{kind:"text_appears",text:"APPF2_MULTIFILE_COMPILED_42"}],
  automatable:true
 }]};
 const independent=await runBuiltAppQa({browser,origin:"http://127.0.0.1:"+port,
  plan:originalPlan,prompt:originalPrompt});
 if(independent.length!==2||independent.some(x=>x.verdict!=="PASS"))
  throw Error("QA_REAL_BUILT_APP_REQUIREMENT_FAILED:"+JSON.stringify(independent));
 const qaKey=randomBytes(48).toString("base64url");
 const promptHash=await sha256CodeBytes(new globalThis.TextEncoder().encode(
  "APPF2_AGENT_REQUEST_V1\u0000"+originalPrompt));
 const artifactHash="sha256:"+createHash("sha256")
  .update(compiled).digest("hex");
 const qaJobId="f7a04bc2-e260-4e1c-b17c-fc43101a46dd";
 const qaRunId="call_docker_multifile_123456";
 const qaInput={version:"APPF2_AGENT_QA_PACKET_V1",
  job_id:qaJobId,original_prompt:originalPrompt,original_plan:originalPlan,
  receipt:{version:"APPF2_CANDIDATE_QA_V1",
   source_project_hash:"sha256:"+"c".repeat(64),
   built_artifact_hash:artifactHash,sandbox_execution_id:qaRunId,
   checks:independent,runner_attestation:null
  }};
 const packet=await sealAgentQaPacket(qaInput,qaKey);
 const qaIdentity={job_id:qaJobId,original_prompt_hash:promptHash,
  project_hash:qaInput.receipt.source_project_hash,
  sandbox_execution_id:qaRunId};
 const reviewed=await verifyAgentQaPacket(packet,qaIdentity,qaKey);
 if(!reviewed.ready_for_review)throw Error("QA_BUILT_ARTIFACT_PACKET_REJECTED");
 const oldRequirement={...packet,original_plan:{...originalPlan,
  criteria:originalPlan.criteria.slice(0,1)}};
 if((await verifyAgentQaPacket(oldRequirement,qaIdentity,qaKey)).ready_for_review)
  throw Error("QA_MISSING_ORIGINAL_REQUIREMENT_WAS_ACCEPTED");
 const malformed={...packet,receipt:{...packet.receipt,
  checks:[{...packet.receipt.checks[1],verdict:"FAIL"}]}};
 if((await verifyAgentQaPacket(malformed,qaIdentity,qaKey)).ready_for_review)
  throw Error("QA_BAD_BROWSER_EVIDENCE_WAS_ACCEPTED");
 const impossible={...originalPlan,criteria:[{...originalPlan.criteria[1],
  assertions:[{kind:"text_appears",text:"IMPOSSIBLE_RESULT_999999"}]}]};
 const negative=await runBuiltAppQa({browser,origin:"http://127.0.0.1:"+port,
  plan:impossible,prompt:originalPrompt});
 if(negative.length!==1||negative[0].verdict!=="FAIL"||
  negative[0].evidence_hash!==null)
  throw Error("QA_INDEPENDENT_BROWSER_DID_NOT_REJECT_WRONG_BEHAVIOR");
 console.log("SP35 DOCKER MULTI-FILE BUILD → INDEPENDENT BROWSER ORIGINAL REQUIREMENTS → DUAL HMAC PACKET: PASS (TRUSTED FIXTURE, NO CLOUD, NO PUBLICATION)");

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
  if(!/^\/(?:index\.html|assets\/[A-Za-z0-9_.-]+)?$/u.test(target)){
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
 // Independent verifier runs OUTSIDE the untrusted sandbox. Produce a bounded
 // evidence hash only after observing the real compile and browser behavior.
 const builtFiles=["index.html",...(await fs.readdir(path.join(candidateRoot,"dist","assets")))
  .map(name=>"assets/"+name)].sort();
 const digest=createHash("sha256");
 for(const name of builtFiles){
  const bytes=await fs.readFile(path.join(candidateRoot,"dist",name));
  digest.update(name+"\u0000"+bytes.length+"\u0000");digest.update(bytes);
 }
 const artifact_hash="sha256:"+digest.digest("hex");
 const evidence=s=> "sha256:"+createHash("sha256").update(s).digest("hex");
 const rendered=await candidatePage.getByText(prompt,{exact:true}).textContent();
 const receipt={
  version:"APPF2_CANDIDATE_QA_V1",
  source_project_hash:candidate.project_hash,
  built_artifact_hash:artifact_hash,
  sandbox_execution_id:"ci_isolated_docker_qa_"+process.pid,
  runner_attestation:null,
  checks:[
   {criterion_id:"build",category:"BUILD",verdict:"PASS",
    evidence_hash:artifact_hash},
   {criterion_id:"browser_render",category:"BROWSER",verdict:"PASS",
    evidence_hash:evidence("TEXT:"+rendered)},
   {criterion_id:"no_html_injection",category:"BROWSER",verdict:"PASS",
    evidence_hash:evidence("IMG_COUNT:0;PROMPT_RENDERED_AS_TEXT")}
  ]
 };
 const verifierSecret=randomBytes(40).toString("base64url");
 const sealed=await sealCandidateQaReceipt(receipt,verifierSecret);
 const identity={project_hash:candidate.project_hash,artifact_hash,
  sandbox_execution_id:receipt.sandbox_execution_id};
 const accepted=await verifySignedCandidateQa(sealed,
  ["build","browser_render","no_html_injection"],identity,verifierSecret);
 if(!accepted.ready_for_review)throw Error("QA_INDEPENDENT_EVIDENCE_NOT_VERIFIED");
 const forged={...sealed,built_artifact_hash:evidence("forged artifact")};
 const rejected=await verifySignedCandidateQa(forged,
  ["build","browser_render","no_html_injection"],identity,verifierSecret);
 if(rejected.ready_for_review||admitsPublicationFromCandidateReceipt(sealed))
  throw Error("QA_FALSE_PUBLICATION_OR_FORGED_PROOF");
 console.log("SP35 INDEPENDENT DOCKER + CHROMIUM QA HMAC VERIFIED: PASS (trusted fixture, NOT PUBLISHED)");

}finally{
 if(browser)await browser.close();
 if(candidateServer)await new Promise(resolve=>candidateServer.close(resolve));
 if(server)await new Promise(resolve=>server.close(resolve));
 await fs.rm(tmp,{recursive:true,force:true});
}
