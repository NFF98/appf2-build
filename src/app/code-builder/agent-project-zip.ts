/** Offline export of the owner's saved multi-file Agent project.
 * No model, network, deployment, or package-install step is performed here.
 * ZIP uses STORE (no compression) for predictable, auditable byte-for-byte
 * source reproduction. Each file must match the Postgres-returned SHA-256.
 */
import type {CandidateJob} from "./agent-browser-client.js";

const SHA=/^sha256:[0-9a-f]{64}$/u;
const PATH=/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*$/u;
const enc=new TextEncoder();
const u16=(v:DataView,o:number,n:number)=>v.setUint16(o,n,true);
const u32=(v:DataView,o:number,n:number)=>v.setUint32(o,n>>>0,true);
function crc32(bytes:Uint8Array):number{
 let crc=0xffffffff;
 for(const byte of bytes){
  crc^=byte;
  for(let k=0;k<8;k++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);
 }
 return (crc^0xffffffff)>>>0;
}
function validPath(path:string):boolean{
 return path.length>0&&path.length<=180&&PATH.test(path)&&
  path.split("/").every(p=>p!=="."&&p!==".."&&!p.startsWith(".")&&
   !["node_modules","dist","build","secrets"].includes(p.toLowerCase()));
}
type Entry={name:Uint8Array<ArrayBuffer>;data:Uint8Array<ArrayBuffer>;crc:number};
function entry(path:string,content:string):Entry{
 const name=enc.encode(path),data=enc.encode(content);
 return {name,data,crc:crc32(data)};
}
function makeZip(entries:readonly Entry[]):Uint8Array<ArrayBuffer>{
 const locals:number[]=[],central:number[]=[];
 let size=22;
 for(const f of entries){
  locals.push(size);size+=30+f.name.length+f.data.length;
 }
 const cdStart=size;
 for(const f of entries){central.push(size);size+=46+f.name.length;}
 const bytes=new Uint8Array(new ArrayBuffer(size)),view=new DataView(bytes.buffer);
 let pos=22;
 for(const [i,f] of entries.entries()){
  u32(view,pos,0x04034b50);u16(view,pos+4,20);u16(view,pos+6,0x0800);
  u16(view,pos+8,0);u16(view,pos+10,0);u16(view,pos+12,0);
  u32(view,pos+14,f.crc);u32(view,pos+18,f.data.length);
  u32(view,pos+22,f.data.length);u16(view,pos+26,f.name.length);
  u16(view,pos+28,0);
  bytes.set(f.name,pos+30);bytes.set(f.data,pos+30+f.name.length);
  pos=central[i];
  u32(view,pos,0x02014b50);u16(view,pos+4,20);u16(view,pos+6,20);
  u16(view,pos+8,0x0800);u16(view,pos+10,0);
  u16(view,pos+12,0);u16(view,pos+14,0);
  u32(view,pos+16,f.crc);u32(view,pos+20,f.data.length);
  u32(view,pos+24,f.data.length);u16(view,pos+28,f.name.length);
  u16(view,pos+30,0);u16(view,pos+32,0);u16(view,pos+34,0);
  u16(view,pos+36,0);u32(view,pos+38,0);u32(view,pos+42,locals[i]);
  bytes.set(f.name,pos+46);
 }
 // Append end-of-central-directory at the beginning to avoid another
 // allocation; rotate the completed ZIP into standard local→CD→EOCD order.
 const out=new Uint8Array(new ArrayBuffer(size));
 out.set(bytes.subarray(22),0);
 const end=size-22,dv=new DataView(out.buffer);
 u32(dv,end,0x06054b50);u16(dv,end+4,0);u16(dv,end+6,0);
 u16(dv,end+8,entries.length);u16(dv,end+10,entries.length);
 u32(dv,end+12,size-22-(cdStart-22));u32(dv,end+16,cdStart-22);
 u16(dv,end+20,0);
 // Central-directory offsets were calculated with the 22-byte scratch
 // prefix; correct the offset fields when copying to the final archive.
 let centralAt=cdStart-22;
 for(const f of entries){
  const oldLocal=dv.getUint32(centralAt+42,true);
  u32(dv,centralAt+42,oldLocal-22);
  centralAt+=46+f.name.length;
 }
 return out;
}
export async function savedAgentProjectZip(job:CandidateJob):Promise<Uint8Array<ArrayBuffer>>{
 if(!SHA.test(job.project_hash)||!Number.isSafeInteger(job.revision)||
  job.revision<0||!Array.isArray(job.files)||
  job.files.length<1||job.files.length>256)throw Error("AGENT_ZIP_PROJECT_INVALID");
 const taken=new Set<string>();
 let total=0;
 const entries:Entry[]=[];
 for(const file of job.files){
  if(!validPath(file.path)||file.path==="APPF2-PROJECT.json"||
   taken.has(file.path.toLowerCase())||!SHA.test(file.hash))
   throw Error("AGENT_ZIP_PATH_INVALID");
  taken.add(file.path.toLowerCase());
  const data=enc.encode(file.content);
  total+=data.length;
  if(data.length>256*1024||total>4*1024*1024||data.length!==file.bytes)
   throw Error("AGENT_ZIP_SIZE_INVALID");
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",data));
  const sha="sha256:"+Array.from(digest,x=>x.toString(16).padStart(2,"0")).join("");
  if(sha!==file.hash)throw Error("AGENT_ZIP_SOURCE_HASH_MISMATCH");
  entries.push(entry(file.path,file.content));
 }
 const manifest=JSON.stringify({schema:"APPF2_AGENT_EXPORT_V1",
  job_id:job.job_id,project_hash:job.project_hash,revision:job.revision,
  status:job.status,app_published:false,
  note:"Source snapshot only; not a verified production deployment.",
  files:job.files.map(f=>({path:f.path,bytes:f.bytes,hash:f.hash}))},null,2);
 entries.push(entry("APPF2-PROJECT.json",manifest));
 return makeZip(entries);
}
