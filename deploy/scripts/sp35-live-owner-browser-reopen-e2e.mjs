/** Sprint3.5 C2 actual Staging PostgreSQL and browser PROCESS restart.
 * Zero AI consent / zero model budget: creates a true Worker Job under a
 * nonextractable browser-profile P-256 signer, closes Chromium, reopens it,
 * then reads the SAME PostgreSQL Job with a NEW signed owner request.
 * A stranger with the UUID but the wrong signing key MUST get 404.
 */
import {chromium} from "@playwright/test";
import {mkdtemp,rm} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const origin="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
const profile=await mkdtemp(path.join(os.tmpdir(),"sp35-real-owner-reopen-"));
let browser=null;
function installHelpers(){
 const dbName="appf2.c2.real.key.v1";
 const ownerKeySlot="original-owner";
 const openDb=()=>new Promise((resolve,reject)=>{
  const request=globalThis.indexedDB.open(dbName,1);
  request.onupgradeneeded=()=>{
   if(!request.result.objectStoreNames.contains("keys"))
    request.result.createObjectStore("keys");
  };
  request.onsuccess=()=>resolve(request.result);
  request.onerror=()=>reject(Error("C2_IDB_OPEN_FAILED"));
 });
 const write=async(material)=>{
  const db=await openDb();
  try{
   await new Promise((resolve,reject)=>{
    const tx=db.transaction("keys","readwrite");
    tx.objectStore("keys").put(material,ownerKeySlot);
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(Error("C2_IDB_COMMIT_FAILED"));
   });
  }finally{db.close();}
 };
 const read=async()=>{
  const db=await openDb();
  try{
   return await new Promise((resolve,reject)=>{
    const tx=db.transaction("keys","readonly");
    const request=tx.objectStore("keys").get(ownerKeySlot);
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(Error("C2_IDB_READ_FAILED"));
   });
  }finally{db.close();}
 };
 const encoded=bytes=>{
  let text="";
  for(const byte of bytes)text+=String.fromCharCode(byte);
  return globalThis.btoa(text).replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
 };
 const send=async(material,url,body)=>{
  const bytes=new globalThis.TextEncoder().encode(JSON.stringify(body));
  const bodyHash=encoded(new Uint8Array(
   await globalThis.crypto.subtle.digest("SHA-256",bytes)));
  const nonce="real_c2_"+globalThis.crypto.randomUUID().replaceAll("-","");
  const now=Date.now();
  const transcript=new globalThis.TextEncoder().encode(JSON.stringify([
   "APPF2_MUTATION_PoP_V1","POST",url,bodyHash,nonce,now]));
  const signature=encoded(new Uint8Array(await globalThis.crypto.subtle.sign(
   {name:"ECDSA",hash:"SHA-256"},material.privateKey,transcript)));
  const response=await fetch(url,{method:"POST",redirect:"error",cache:"no-store",
   headers:{"Content-Type":"application/json","Idempotency-Key":nonce,
    "X-Appf2-PoP-Key":encoded(new Uint8Array(material.spki)),
    "X-Appf2-PoP-Signature":signature,
    "X-Appf2-PoP-Timestamp":String(now)},
   body:bytes});
  return {status:response.status,json:await response.json().catch(()=>null)};
 };
 globalThis.appf2C2OwnerTest={
  async create(){
   if(!globalThis.isSecureContext)throw Error("C2_NOT_SECURE_ORIGIN");
   const owner=globalThis.crypto.randomUUID();
   const pair=await globalThis.crypto.subtle.generateKey(
    {name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"]);
   const spki=new Uint8Array(await globalThis.crypto.subtle.exportKey(
    "spki",pair.publicKey));
   await write({owner,privateKey:pair.privateKey,spki,created:Date.now()});
   const material=await read();
   if(material.privateKey.extractable||material.owner!==owner)
    throw Error("C2_ORIGINAL_OWNER_KEY_NOT_DURABLE");
   const prompt="C2 真實重新開啟測試：保存原 Job，不呼叫付費 AI";
   const created=await send(material,"/api/v1/agent-jobs",{
    anonymous_id:owner,prompt});
   if(created.status!==201||created.json?.data?.ai_started!==false||
    created.json.data.approved_max_cost_cents!==0||
    created.json.data.revision!==0)
    throw Error("C2_CREATE_NOT_PERSISTED_HTTP_"+created.status);
   const jobId=created.json.data.job_id;
   globalThis.localStorage.setItem("appf2.c2.live.checkpoint.v1",JSON.stringify({
    jobId,owner,projectHash:created.json.data.project_hash}));
   if(!globalThis.localStorage.getItem("appf2.c2.live.checkpoint.v1"))
    throw Error("C2_JOB_POINTER_NOT_DURABLE");
   return {jobId,sourceHash:created.json.data.project_hash};
  },
  async recover(){
   const material=await read();
   const raw=globalThis.localStorage.getItem("appf2.c2.live.checkpoint.v1");
   const pointer=raw?JSON.parse(raw):null;
   if(!pointer||material?.owner!==pointer.owner||
    material.privateKey.extractable!==false)
    throw Error("C2_ORIGINAL_OWNER_OR_POINTER_LOST");
   const reopened=await send(material,"/api/v1/agent-jobs/"+pointer.jobId,{
    anonymous_id:pointer.owner});
   if(reopened.status!==200||reopened.json?.data?.job_id!==pointer.jobId||
    reopened.json.data.project_hash!==pointer.projectHash||
    reopened.json.data.revision!==0||
    reopened.json.data.checkpoint?.step!==0||
    reopened.json.data.ai_started!==false)
    throw Error("C2_REOPENED_POSTGRES_JOB_MISMATCH_HTTP_"+reopened.status);
   const outsider=await globalThis.crypto.subtle.generateKey(
    {name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"]);
   const outsiderMaterial={
    privateKey:outsider.privateKey,
    spki:new Uint8Array(await globalThis.crypto.subtle.exportKey(
     "spki",outsider.publicKey))};
   const denied=await send(outsiderMaterial,
    "/api/v1/agent-jobs/"+pointer.jobId,{anonymous_id:pointer.owner});
   if(denied.status!==404)throw Error("C2_OTHER_KEY_READ_WAS_NOT_DENIED");
   return {jobId:pointer.jobId,confirmed:true};
  }
 };
}
try{
 browser=await chromium.launchPersistentContext(profile,{
  headless:true,serviceWorkers:"block"});
 await browser.addInitScript(installHelpers);
 let page=await browser.newPage();
 await page.goto(origin+"/",{waitUntil:"domcontentloaded",timeout:35000});
 const created=await page.evaluate(()=>globalThis.appf2C2OwnerTest.create());
 if(!created.jobId||!created.sourceHash)
  throw Error("C2_SIGNED_STAGING_JOB_NOT_CREATED");
 await page.close();
 await browser.close();browser=null;
 browser=await chromium.launchPersistentContext(profile,{
  headless:true,serviceWorkers:"block"});
 await browser.addInitScript(installHelpers);
 page=await browser.newPage();
 await page.goto(origin+"/",{waitUntil:"domcontentloaded",timeout:35000});
 const restored=await page.evaluate(()=>globalThis.appf2C2OwnerTest.recover());
 if(!restored.confirmed||restored.jobId!==created.jobId)
  throw Error("C2_ORIGINAL_JOB_ID_CHANGED_AFTER_CHROMIUM_RESTART");
 console.log("SP35 C2 REAL STAGING PostgreSQL: same browser profile → "+
  "fully closed Chromium → new Chromium → same original P-256 signer → "+
  "same Job/revision/source hash; stranger key 404; ZERO AI charge: PASS");
}finally{
 if(browser)await browser.close();
 await rm(profile,{recursive:true,force:true});
}
