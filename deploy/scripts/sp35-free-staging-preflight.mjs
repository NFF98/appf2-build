/** Read-only, zero-new-fee reuse of existing Hyperdrive and Worker.
 * Never creates databases, Containers, Browser Run sessions or model calls.
 */
import fs from "node:fs";
import {createHmac} from "node:crypto";
const token=process.env.CLOUDFLARE_API_TOKEN?.trim()||"";
const account=process.env.CLOUDFLARE_ACCOUNT_ID?.trim()||"";
if(token.length<20||!/^[0-9a-f]{32}$/iu.test(account))
 throw Error("FREE_DEPLOY_MISSING_EXISTING_CLOUDFLARE_CREDENTIALS");
const headers={Authorization:"Bearer "+token,Accept:"application/json"};
const verify=await fetch("https://api.cloudflare.com/client/v4/user/tokens/verify",{
 headers,signal:AbortSignal.timeout(15000)});
const auth=await verify.json().catch(()=>null);
if(!verify.ok||!auth?.success||auth?.result?.status!=="active")
 throw Error("FREE_DEPLOY_TOKEN_NOT_ACTIVE_HTTP_"+verify.status);
const workerName="appf2-sp35-417-staging";
const names={
 "appf2-sp35-417-staging-fresh":"APPF2_HYPERDRIVE_FRESH_ID",
 "appf2-sp35-417-staging-f02":"APPF2_HYPERDRIVE_F02_ADMISSION_ID",
 "appf2-sp35-417-staging-f07":"APPF2_HYPERDRIVE_F07_EVENTS_ID"
};
const endpoint="https://api.cloudflare.com/client/v4/accounts/"+account+"/hyperdrive/configs";
const response=await fetch(endpoint,{headers,signal:AbortSignal.timeout(15000)});
const data=await response.json().catch(()=>null);
if(!response.ok||data?.success!==true||!Array.isArray(data.result))
 throw Error("FREE_DEPLOY_CANNOT_READ_EXISTING_HYPERDRIVES_HTTP_"+response.status);
const resolved=Object.entries(names).map(([name,env])=>{
 const hit=data.result.find(x=>x.name===name);
 if(!hit||typeof hit.id!=="string"||hit.id.length<8)
  throw Error("FREE_DEPLOY_EXISTING_HYPERDRIVE_NOT_FOUND_"+env);
 return {env,id:hit.id};
});
const path=process.env.GITHUB_ENV;
if(!path)throw Error("FREE_DEPLOY_GITHUB_ENV_UNAVAILABLE");
for(const pair of resolved)fs.appendFileSync(path,pair.env+"="+pair.id+"\n");
const cookie=process.env.APPF2_IDENTITY_COOKIE_SECRET?.trim()||
 createHmac("sha256",token).update("appf2-sp35-staging-identity-secret-v1")
 .digest("hex");
if(cookie.length<32)throw Error("FREE_DEPLOY_COOKIE_SECRET_INVALID");
console.log("::add-mask::"+cookie);
fs.appendFileSync(path,"APPF2_IDENTITY_COOKIE_SECRET="+cookie+"\n");
fs.appendFileSync(path,"APPF2_STAGING_WORKER_NAME="+workerName+"\n");
fs.appendFileSync(path,"APPF2_STAGING_URL=https://"+workerName+".juiyuang69.workers.dev\n");
console.log("SP35 FREE DEPLOY PREFLIGHT: existing Cloudflare token verified; 3 EXISTING Hyperdrives reused");
console.log("SP35 FREE DEPLOY PREFLIGHT: no Cloudflare Containers, Browser Run or AI key required");
