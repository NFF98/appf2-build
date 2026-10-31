/** Encrypted, short-lived FREE CI source ticket.
 * Workflow inputs contain NO private source, prompt, owner UUID or hash.
 * Only a GitHub OIDC-authenticated workflow can redeem a ticket.
 */
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu;
const SHA=/^sha256:[a-f0-9]{64}$/u;
export type FreeCiTicket={
 readonly v:1;readonly job_id:string;readonly owner:string;
 readonly project_hash:string;readonly expires:number;
};
const encode=(b:Uint8Array)=>btoa(String.fromCharCode(...b))
 .replaceAll("+","-").replaceAll("/","_").replaceAll("=","");
function decode(s:string):Uint8Array<ArrayBuffer>{
 if(!/^[A-Za-z0-9_-]+$/u.test(s)||s.length>3000||s.length<24)
  throw Error("FREE_CI_TICKET_INVALID");
 const bytes=atob(s.replaceAll("-","+").replaceAll("_","/"));
 return Uint8Array.from(bytes,c=>c.charCodeAt(0));
}
async function cipher(secret:string):Promise<CryptoKey>{
 if(secret.length<32)throw Error("FREE_CI_SECRET_INVALID");
 const data=new TextEncoder().encode("APPF2_FREE_CI_TICKET_KEY_V1\\0"+secret);
 const hashed=await crypto.subtle.digest("SHA-256",data);
 return crypto.subtle.importKey("raw",hashed,{name:"AES-GCM"},false,
  ["encrypt","decrypt"]);
}
export async function sealFreeCiTicket(input:Omit<FreeCiTicket,"v"|"expires">,
 secret:string,nowMs:number):Promise<string>{
 if(!UUID.test(input.job_id)||!UUID.test(input.owner)||
    !SHA.test(input.project_hash))throw Error("FREE_CI_TICKET_SCOPE");
 const token:FreeCiTicket={...input,v:1,expires:nowMs+30*60_000};
 const iv=crypto.getRandomValues(new Uint8Array(12));
 const plain=new TextEncoder().encode(JSON.stringify(token));
 const encrypted=new Uint8Array(await crypto.subtle.encrypt({
  name:"AES-GCM",iv},await cipher(secret),plain));
 const all=new Uint8Array(iv.length+encrypted.length);
 all.set(iv);all.set(encrypted,iv.length);
 return encode(all);
}
// eslint-disable-next-line complexity -- AES scope and time bounds all fail closed independently.
export async function openFreeCiTicket(value:string,secret:string,
 nowMs:number):Promise<FreeCiTicket|null>{
 try{
  const bytes=decode(value);
  if(bytes.length<32)return null;
  const data=await crypto.subtle.decrypt({name:"AES-GCM",iv:bytes.slice(0,12)},
   await cipher(secret),bytes.slice(12));
  const x:unknown=JSON.parse(new TextDecoder().decode(data));
  if(typeof x!=="object"||x===null||Array.isArray(x))return null;
  const t=x as Record<string,unknown>;
  if(Object.keys(t).sort().join(",")!=="expires,job_id,owner,project_hash,v"||
   t.v!==1||typeof t.job_id!=="string"||!UUID.test(t.job_id)||
   typeof t.owner!=="string"||!UUID.test(t.owner)||
   typeof t.project_hash!=="string"||!SHA.test(t.project_hash)||
   typeof t.expires!=="number"||!Number.isSafeInteger(t.expires)||
   t.expires<nowMs||t.expires>nowMs+30*60_000+60_000)return null;
  return t as FreeCiTicket;
 }catch{return null;}
}
