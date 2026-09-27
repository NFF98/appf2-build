import fs from "node:fs";
import { spawnSync } from "node:child_process";

const current=JSON.parse(fs.readFileSync("build-spec/CURRENT.json","utf8"));
const policy=JSON.parse(fs.readFileSync("ci/policy.json","utf8"));
const pkg=JSON.parse(fs.readFileSync("package.json","utf8"));

const npmExecPath=process.env.npm_execpath;
const runNpmScript=script=>spawnSync(
  npmExecPath?process.execPath:"npm",
  npmExecPath?[npmExecPath,"run",script]:["run",script],
  {stdio:"inherit",shell:false,env:process.env}
);

if(!current.implementation_enabled){
  console.log("RELEASE BROWSER CI: HOLD — implementation not enabled.");
  process.exit(0);
}
if(!fs.existsSync("package-lock.json")){
  console.error("RELEASE BROWSER CI: FAIL\n- package-lock.json is required.");
  process.exit(1);
}
if(!process.env.PLAYWRIGHT_BASE_URL){
  console.error("RELEASE BROWSER CI: FAIL\n- PLAYWRIGHT_BASE_URL is required.");
  process.exit(1);
}
const scripts=policy.required_before_release_on_staging||[];
const missing=scripts.filter(s=>!pkg.scripts?.[s]);
if(missing.length){
  console.error("RELEASE BROWSER CI: FAIL");
  missing.forEach(s=>console.error("- Missing required npm script: "+s));
  process.exit(1);
}
for(const script of scripts){
  console.log("\n> npm run "+script);
  const r=runNpmScript(script);
  if(r.status!==0) process.exit(r.status||1);
}
console.log("RELEASE BROWSER CI: PASS");
