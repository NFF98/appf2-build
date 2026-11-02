/**
 * Sprint 3.5 — FREE real backend PLATFORM proof, not a new generated App PASS.
 * Fresh Chromium identities -> signed first-party Worker -> actual Staging PG.
 * Existing published share is a record namespace only; NEVER regenerate an App.
 */
import {chromium} from "@playwright/test";
import {randomUUID} from "node:crypto";
const origin="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
const share="61864019-0773-48c6-b095-4bd51391bed0";
const path="/api/v1/code-apps/"+share+"/records";
const id=randomUUID();
const valueA={kind:"unknown-workflow",sku:"experimental-"+id,quantity:4,approved:false};
const editedA={...valueA,quantity:7,approved:true};
const valueB={kind:"other-viewer",sku:"isolated-"+id,quantity:99};
const browser=await chromium.launch({headless:true});
const sessions=[];
let unexpected=0,requests=0,problem=null;
const cleanup=[];
async function install(page){
 await page.evaluate(async pathname=>{
  // IndexedDB stores only a nonextractable P-256 CryptoKey, never credentials.
  const db=await new Promise((resolve,reject)=>{
   const req=globalThis.indexedDB.open("appf2-sp35-backend-proof-v1",1);
   req.onupgradeneeded=()=>req.result.createObjectStore("identity");
   req.onsuccess=()=>resolve(req.result);
   req.onerror=()=>reject(Error("BACKEND_QA_KEYSTORE_OPEN_FAILED"));
  });
  const get=()=>new Promise((resolve,reject)=>{
   const request=db.transaction("identity","readonly").objectStore("identity").get("viewer");
   request.onsuccess=()=>resolve(request.result??null);
   request.onerror=()=>reject(Error("BACKEND_QA_KEYSTORE_READ_FAILED"));
  });
  let pair=await get();
  if(!pair){
   pair=await globalThis.crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"]);
   await new Promise((resolve,reject)=>{
    const tx=db.transaction("identity","readwrite");
    tx.objectStore("identity").put(pair,"viewer");
    tx.oncomplete=resolve;
    tx.onerror=()=>reject(Error("BACKEND_QA_KEYSTORE_SAVE_FAILED"));
   });
  }
  db.close();
  const b64=bytes=>{
   let raw="";for(const b of bytes)raw+=String.fromCharCode(b);
   return globalThis.btoa(raw).replaceAll("+","-").replaceAll("/","_").replace(/=+$/u,"");
  };
  const spki=b64(new Uint8Array(await globalThis.crypto.subtle.exportKey("spki",pair.publicKey)));
  globalThis.__appf2Sp35BackendSend=async body=>{
   const raw=new globalThis.TextEncoder().encode(JSON.stringify(body));
   const key="backend_"+globalThis.crypto.randomUUID().replaceAll("-","");
   const timestamp=Date.now();
   const digest=b64(new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256",raw)));
   const statement=new globalThis.TextEncoder().encode(JSON.stringify([
    "APPF2_MUTATION_PoP_V1","POST",pathname,digest,key,timestamp
   ]));
   const sig=b64(new Uint8Array(await globalThis.crypto.subtle.sign(
    {name:"ECDSA",hash:"SHA-256"},pair.privateKey,statement)));
   const response=await fetch(pathname,{
    method:"POST",cache:"no-store",redirect:"error",
    headers:{"Content-Type":"application/json","Idempotency-Key":key,
     "X-Appf2-PoP-Key":spki,"X-Appf2-PoP-Signature":sig,
     "X-Appf2-PoP-Timestamp":String(timestamp)},
    body:raw
   });
   const bodyText=await response.text();
   let result;
   try{result=JSON.parse(bodyText);}catch{
    throw Error("BACKEND_QA_NON_JSON_HTTP_"+response.status);
   }
   return {status:response.status,data:result?.data,error:result?.error};
  };
 },path);
}
async function open(which){
 const context=await browser.newContext({serviceWorkers:"block",acceptDownloads:false});
 sessions.push(context);
 const page=await context.newPage();
 await page.route("**/*",route=>{
  const req=route.request();
  const url=new URL(req.url());
  if(url.origin!==origin||
   !(req.method()==="GET"||req.method()==="POST"&&url.pathname===path)){
   unexpected++;
   return route.abort();
  }
  if(req.method()==="POST")requests++;
  return route.continue();
 });
 await page.goto(origin+"/",{waitUntil:"domcontentloaded",timeout:25000});
 await install(page);
 return {page,which};
}
const send=(client,payload)=>client.page.evaluate(v=>globalThis.__appf2Sp35BackendSend(v),payload);
function expectStatus(result,status,stage){
 if(result?.status!==status)throw Error("BACKEND_QA_"+stage+"_HTTP_"+result?.status+"_EXPECTED_"+status+"_ERROR_"+String(result?.error??"NONE"));
 return result.data;
}
const ensure=(bool,stage)=>{if(!bool)throw Error("BACKEND_QA_"+stage);};
let A,B;
try{
 A=await open("A");
 B=await open("B");
 const first=expectStatus(await send(A,{action:"list"}),200,"A_LIST_START");
 ensure(Array.isArray(first.records)&&first.records.length===0,"A_INITIAL_EMPTY");
 const second=expectStatus(await send(B,{action:"list"}),200,"B_LIST_START");
 ensure(Array.isArray(second.records)&&second.records.length===0,"B_INITIAL_EMPTY");
 const created=expectStatus(await send(A,{action:"create",record_id:id,value:valueA}),201,"A_CREATE");
 cleanup.push({client:A});
 ensure(created.record_id===id&&created.value?.quantity===4,"CREATE_PAYLOAD");
 const replay=expectStatus(await send(A,{action:"create",record_id:id,value:valueA}),200,"A_REPLAY");
 ensure(replay.record_id===id,"IDEMPOTENT_REPLAY");
 expectStatus(await send(A,{action:"create",record_id:id,value:editedA}),409,"A_CONFLICTING_CREATE");
 const read=expectStatus(await send(A,{action:"read",record_id:id}),200,"A_READ");
 ensure(read.value?.quantity===4,"A_READ_BYTES");
 const bList=expectStatus(await send(B,{action:"list"}),200,"B_EMPTY_AFTER_A_CREATE");
 ensure(bList.records.length===0,"B_ISOLATED_LIST");
 expectStatus(await send(B,{action:"read",record_id:id}),404,"B_CANNOT_READ_A");
 expectStatus(await send(B,{action:"update",record_id:id,value:valueB}),404,"B_CANNOT_UPDATE_A");
 expectStatus(await send(B,{action:"delete",record_id:id}),404,"B_CANNOT_DELETE_A");
 // Exact same record UUID is allowed for a different independently signed viewer.
 const bCreate=expectStatus(await send(B,{action:"create",record_id:id,value:valueB}),201,"B_OWN_ID_CREATE");
 cleanup.push({client:B});
 ensure(bCreate.value?.quantity===99,"B_OWN_DATA");
 // A real browser reload must recover the same nonextractable signing identity.
 await A.page.reload({waitUntil:"domcontentloaded",timeout:25000});
 await install(A.page);
 const afterReload=expectStatus(await send(A,{action:"read",record_id:id}),200,"A_RELOAD_READ");
 ensure(afterReload.value?.quantity===4,"P256_BROWSER_REOPEN_PG_PERSISTENCE");
 const updated=expectStatus(await send(A,{action:"update",record_id:id,value:editedA,
  expected_value:valueA}),200,"A_CAS_UPDATE");
 ensure(updated.value?.quantity===7&&updated.value?.approved===true,"CAS_VISIBLE_VALUE");
 expectStatus(await send(A,{action:"update",record_id:id,value:valueA,
  expected_value:valueA}),409,"A_STALE_CAS");
 const bIndependent=expectStatus(await send(B,{action:"read",record_id:id}),200,"B_UNAFFECTED");
 ensure(bIndependent.value?.quantity===99,"B_RECORD_NOT_CLOBBERED");
 expectStatus(await send(A,{action:"delete",record_id:id,
  expected_value:valueA}),409,"A_STALE_DELETE");
 expectStatus(await send(A,{action:"delete",record_id:id,
  expected_value:editedA}),200,"A_DELETE");
 expectStatus(await send(A,{action:"read",record_id:id}),404,"A_DELETED");
 expectStatus(await send(B,{action:"delete",record_id:id,
  expected_value:valueB}),200,"B_DELETE");
 expectStatus(await send(B,{action:"read",record_id:id}),404,"B_DELETED");
 console.log("SP35 UNKNOWN BACKEND REAL CHROMIUM+WORKER+POSTGRES PROOF PASS: 2 new unrelated browser P256 identities; real PostgreSQL CRUD, CAS stale-conflict, idempotent replay, same-UUID viewer isolation, reload persisted key and saved DB data. Not a newly AI-generated App; 0 AI jobs/paid model calls.");
}catch(e){
 problem=e;
 console.error("SP35 UNKNOWN BACKEND PLATFORM FAIL: "+String(e instanceof Error?e.message:e).slice(0,350));
}finally{
 const cleanupFailures=[];
 for(const entry of cleanup){
  try{
   const r=await send(entry.client,{action:"delete",record_id:id});
   if(![200,404].includes(r.status))cleanupFailures.push(entry.client.which+":"+r.status);
  }catch{cleanupFailures.push(entry.client.which+":UNAVAILABLE");}
 }
 for(const context of sessions)await context.close().catch(()=>undefined);
 await browser.close();
 if(unexpected)cleanupFailures.push("UNEXPECTED_NETWORK_REQUESTS_"+unexpected);
 if(cleanupFailures.length){
  console.error("SP35 UNKNOWN BACKEND CLEANUP/NETWORK FAIL: "+cleanupFailures.join(","));
  problem??=Error("BACKEND_QA_CLEANUP_OR_UNEXPECTED_NETWORK");
 }
}
if(problem)throw problem;
console.log("SP35 UNKNOWN BACKEND CLEANUP PASS: ephemeral test records removed; source untouched; signed record POSTs="+requests);
