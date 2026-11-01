/** C1: tiny allowlisted bridge for a published App's opaque-origin iframe.
 * Generated JS never receives an identity key, cookie, URL capability or SQL.
 */
import {encodeBase64Url,mutationProofTranscript} from "../../edge/create-proof.js";
import {keyThumbprint} from "../../edge/create-proof.js";
import {createBrowserPopKeyPersistence} from "../shell/tab-app-recovery.js";
import type {StoredPopMaterial} from "../create/pop-keyring.js";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DAYS=3650*24*60*60*1000;
const identityCache=new Map<string,Promise<StoredPopMaterial>>();
type Operation={action:"list"|"read"|"create"|"update"|"delete";
 record_id?:string;value?:Record<string,unknown>};
const ACTIONS=new Set(["list","read","create","update","delete"]);

async function recordIdentity(shareId:string):Promise<StoredPopMaterial>{
 const existing=identityCache.get(shareId);
 if(existing)return existing;
 const load=async()=>{
  const persistence=createBrowserPopKeyPersistence(DAYS);
  if(!persistence)throw Error("CODE_RECORD_SECURE_STORAGE_REQUIRED");
  const slot="code-record:"+shareId;
  const previous=await persistence.load(slot);
  if(previous&&previous.privateKey.extractable===false&&
    previous.privateKey.usages.includes("sign")&&
    previous.thumbprint===await keyThumbprint(previous.spki))
   return previous;
  const pair=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},
   false,["sign","verify"]);
  const spki=new Uint8Array(await crypto.subtle.exportKey("spki",pair.publicKey));
  const material:StoredPopMaterial={privateKey:pair.privateKey,spki,
   thumbprint:await keyThumbprint(spki),expiresAt:Date.now()+DAYS};
  await persistence.save(slot,material);
  return material;
 };
 const promise=load().catch(error=>{identityCache.delete(shareId);throw error;});
 identityCache.set(shareId,promise);
 return promise;
}
async function signedRecord(shareId:string,operation:Operation):Promise<unknown>{
 const material=await recordIdentity(shareId);
 const path="/api/v1/code-apps/"+shareId+"/records";
 const bytes=new TextEncoder().encode(JSON.stringify(operation));
 const key="record_"+crypto.randomUUID().replaceAll("-","");
 const now=Date.now();
 const transcript=await mutationProofTranscript({
  method:"POST",path,body:bytes,idempotencyKey:key},now);
 const signature=await crypto.subtle.sign({name:"ECDSA",hash:"SHA-256"},
  material.privateKey,transcript);
 const response=await fetch(path,{method:"POST",cache:"no-store",redirect:"error",
  headers:{"Content-Type":"application/json","Idempotency-Key":key,
   "X-Appf2-PoP-Key":encodeBase64Url(material.spki),
   "X-Appf2-PoP-Signature":encodeBase64Url(new Uint8Array(signature)),
   "X-Appf2-PoP-Timestamp":String(now)},
  body:bytes});
 if(!response.ok)throw Error("CODE_RECORD_HTTP_"+response.status);
 const result:unknown=await response.json();
 if(!result||typeof result!=="object"||!("data" in result))
  throw Error("CODE_RECORD_INVALID_REPLY");
 return (result as {data:unknown}).data;
}
function operationOf(message:Record<string,unknown>):Operation|null{
 if(typeof message.action!=="string"||!ACTIONS.has(message.action))return null;
 const action=message.action as Operation["action"];
 if(action==="list")return {action};
 if(action==="create"||action==="update"){
  const value=message.value;
  if(!value||typeof value!=="object"||Array.isArray(value))return null;
  const json=JSON.stringify(value);
  if(json.length>4096||new TextEncoder().encode(json).length>4096)return null;
  const recordId=action==="create"?crypto.randomUUID():message.record_id;
  if(!UUID.test(String(recordId)))return null;
  return {action,record_id:String(recordId),value:value as Record<string,unknown>};
 }
 if(!UUID.test(String(message.record_id)))return null;
 return {action,record_id:String(message.record_id)};
}
/** Called only after verifying a published App's immutable artifact hash.
 * Each frame has an independent rate limit; its data is isolated per viewer.
 */
export function attachCodeRecordBridge(iframe:HTMLIFrameElement,shareId:string):()=>void{
 if(!UUID.test(shareId))throw Error("CODE_RECORD_SHARE_ID_INVALID");
 let active=true,inFlight=0,total=0;
 const onMessage=(event:MessageEvent)=>{
  if(!active||event.source!==iframe.contentWindow||event.origin!=="null")return;
  const message:unknown=event.data;
  if(!message||typeof message!=="object"||Array.isArray(message))return;
  const data=message as Record<string,unknown>;
  if(data.kind!=="APPF2_RECORD_REQUEST_V1"||
   typeof data.id!=="string"||!/^[0-9]{1,8}$/u.test(data.id))return;
  const operation=operationOf(data);
  if(!operation||inFlight>=4||total>=200)return;
  inFlight++;total++;
  void signedRecord(shareId,operation).then(value=>{
   if(active)iframe.contentWindow?.postMessage({
    kind:"APPF2_RECORD_REPLY_V1",id:data.id,ok:true,value},"*");
  }).catch(()=>{
   if(active)iframe.contentWindow?.postMessage({
    kind:"APPF2_RECORD_REPLY_V1",id:data.id,ok:false,error:"CODE_RECORD_UNAVAILABLE"},"*");
  }).finally(()=>{inFlight--;});
 };
 window.addEventListener("message",onMessage);
 return ()=>{active=false;window.removeEventListener("message",onMessage);};
}
/** Trusted script is hashed into CSP alongside the immutable generated bundle.
 * No fetch, iframe storage, credentials or parent DOM access exposed.
 */
export const CODE_RECORD_IFRAME_SCRIPT=`(()=>{
 const pending=new Map();let count=0;
 window.addEventListener("message",event=>{
  if(event.source!==parent||event.data?.kind!=="APPF2_RECORD_REPLY_V1")return;
  const reply=event.data,entry=pending.get(reply.id);
  if(!entry)return;
  pending.delete(reply.id);clearTimeout(entry.timer);
  if(reply.ok)entry.resolve(reply.value);
  else entry.reject(Error("CODE_RECORD_UNAVAILABLE"));
 });
 const run=(action,record_id,value)=>new Promise((resolve,reject)=>{
  if(pending.size>=4){reject(Error("CODE_RECORD_BUSY"));return;}
  const id=String(++count);
  const timer=setTimeout(()=>{pending.delete(id);reject(Error("CODE_RECORD_TIMEOUT"));},20000);
  pending.set(id,{resolve,reject,timer});
  parent.postMessage({kind:"APPF2_RECORD_REQUEST_V1",id,action,record_id,value},"*");
 });
 Object.defineProperty(window,"appf2Records",{configurable:false,writable:false,
  value:Object.freeze({
   list:()=>run("list"),
   create:value=>run("create",undefined,value),
   read:id=>run("read",id),
   update:(id,value)=>run("update",id,value),
   delete:id=>run("delete",id)
  })});
})();`;
