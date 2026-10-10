import path from "node:path";
import {parseArgs,requireEnv,loadRelease,writeJson,outputDir} from "./common.mjs";

const a=parseArgs(process.argv.slice(2));
const environment=a.environment, releaseId=a.release;
if(!["staging","production"].includes(environment)) throw new Error("--environment must be staging or production");
const manifest=loadRelease(releaseId);
const results=[];
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

for(const h of manifest.health_checks){
  const base=requireEnv(h.base_url_env);
  const url=new URL(h.path,base).toString();
  const attempts=Number.isInteger(h.attempts)?h.attempts:6;
  const interval=Number.isInteger(h.interval_ms)?h.interval_ms:5000;
  let ok=false,last=null;
  for(let i=1;i<=attempts;i++){
    try{
      const r=await fetch(url,{method:h.method||"GET",redirect:"manual"});
      const contentType=(r.headers.get("content-type")||"").split(";",1)[0].trim().toLowerCase();
      const statusOk=(h.expected_status||[200]).includes(r.status);
      const redirectOk=h.reject_redirects!==true || r.status<300 || r.status>=400;
      const contentTypeOk=typeof h.expected_content_type!=="string" || contentType===h.expected_content_type.toLowerCase();
      last={attempt:i,status:r.status,content_type:contentType||null,status_ok:statusOk,redirect_ok:redirectOk,content_type_ok:contentTypeOk};
      if(statusOk && redirectOk && contentTypeOk){ok=true;break;}
    }catch(e){last={attempt:i,error:String(e.message||e)};}
    if(i<attempts) await sleep(interval);
  }
  results.push({name:h.name,url,ok,last});
}
const report={release_id:releaseId,environment,checked_at:new Date().toISOString(),results};
writeJson(path.join(outputDir(releaseId,environment),"smoke-report.json"),report);
if(results.some(x=>!x.ok)){
  console.error("SMOKE: FAIL");
  results.filter(x=>!x.ok).forEach(x=>console.error("- "+x.name+" "+JSON.stringify(x.last)));
  process.exit(1);
}
console.log("SMOKE: PASS");
