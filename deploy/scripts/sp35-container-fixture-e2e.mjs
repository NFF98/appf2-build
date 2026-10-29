/**
 * Build the private Sandbox image and compile ONLY a trusted committed fixture
 * in a real Docker container with --network none. Never runs AI-generated code.
 * This validates the Vite binary/image build that Wrangler dry-run does not test.
 */
import {spawnSync} from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const image="appf2-sp35-sandbox:ci";
const tmp=await fs.mkdtemp(path.join(os.tmpdir(),"appf2-sp35-container-"));
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
 console.log("SP35 REAL ISOLATED DOCKER VITE + ASSET SMOKE: PASS (trusted fixture, NO AI, NO Cloudflare Container)");
}finally{
 await fs.rm(tmp,{recursive:true,force:true});
}
