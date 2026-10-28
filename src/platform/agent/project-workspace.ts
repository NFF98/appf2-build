/**
 * Sprint 3.5 candidate workspace. Source bytes are data, NEVER executable in the Worker.
 * Trusted CI fixture only; untrusted builds require a separately verified cloud broker.
 * Legacy WEB_STATIC_V1 envelopes remain completely unchanged.
 */
export const PROJECT_SCHEMA="APPF2_PROJECT_V1" as const;
export const MAX_PROJECT_FILES=256;
export const MAX_PROJECT_FILE_BYTES=256*1024;
export const MAX_PROJECT_BYTES=4*1024*1024;
const HASH=/^sha256:[a-f0-9]{64}$/u;
const PATH=/^[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*$/u;
const DENY_SEGMENTS=new Set([".","..",".git",".env",".github","node_modules","dist","build",".wrangler","secrets"]);
export type ProjectProfile="VITE_WEB"|"NODE"|"PYTHON";
export type ProjectFile={readonly path:string;readonly content:string;readonly bytes:number;readonly hash:string};
export type ProjectSnapshot={
 readonly schema_version:typeof PROJECT_SCHEMA;
 readonly profile:ProjectProfile;
 readonly entrypoint:string;
 readonly revision:number;
 readonly parent_hash:string|null;
 readonly files:readonly ProjectFile[];
 readonly project_hash:string;
};
export type ProjectEdit=
 | {readonly operation:"add";readonly path:string;readonly content:string}
 | {readonly operation:"replace";readonly path:string;readonly previous_hash:string;readonly content:string}
 | {readonly operation:"delete";readonly path:string;readonly previous_hash:string};

function object(x:unknown):x is Record<string,unknown>{
 return typeof x==="object"&&x!==null&&!Array.isArray(x);
}
function exact(x:unknown,fields:readonly string[]):x is Record<string,unknown>{
 return object(x)&&Object.keys(x).length===fields.length&&
  Object.keys(x).every(k=>fields.includes(k));
}
export function assertWorkspacePath(path:string):void{
 if(path.length===0||path.length>180||!PATH.test(path)||
   path.split("/").some(s=>DENY_SEGMENTS.has(s.toLowerCase())||s.endsWith(".")||
     s.startsWith(".")||s===".."||s===".")||
   /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu.test(path.split("/").at(-1)??""))
   throw Error("PROJECT_UNSAFE_PATH");
}
function canonical(value:unknown):string{
 if(Array.isArray(value))return "["+value.map(canonical).join(",")+"]";
 if(object(value)){
  const ks=Object.keys(value).sort();
  return "{"+ks.map(k=>JSON.stringify(k)+":"+canonical(value[k])).join(",")+"}";
 }
 if(value===null||typeof value==="string"||typeof value==="boolean"||
   (typeof value==="number"&&Number.isFinite(value)))return JSON.stringify(value);
 throw Error("PROJECT_UNSERIALIZABLE");
}
async function digest(s:string):Promise<string>{
 const data=new TextEncoder().encode(s);
 const buffer=new ArrayBuffer(data.byteLength);
 new Uint8Array(buffer).set(data);
 const d=new Uint8Array(await crypto.subtle.digest("SHA-256",buffer));
 return "sha256:"+Array.from(d,x=>x.toString(16).padStart(2,"0")).join("");
}
async function assemble(profile:ProjectProfile,entrypoint:string,revision:number,
 parent_hash:string|null,files:readonly {path:string;content:string}[]):Promise<ProjectSnapshot>{
 if(!["VITE_WEB","NODE","PYTHON"].includes(profile)||!Number.isSafeInteger(revision)||
    revision<1||(revision===1?parent_hash!==null:!parent_hash||!HASH.test(parent_hash)))
    throw Error("PROJECT_INVALID_REVISION");
 assertWorkspacePath(entrypoint);
 if(files.length===0||files.length>MAX_PROJECT_FILES)throw Error("PROJECT_FILE_COUNT");
 const used=new Set<string>();
 let total=0;
 const indexed:ProjectFile[]=[];
 for(const f of files){
  assertWorkspacePath(f.path);
  const lower=f.path.toLowerCase();
  if(used.has(lower))throw Error("PROJECT_DUPLICATE_PATH");
  used.add(lower);
  if(typeof f.content!=="string"||f.content.includes("\u0000"))throw Error("PROJECT_INVALID_CONTENT");
  const bytes=new TextEncoder().encode(f.content).byteLength;
  total+=bytes;
  if(bytes>MAX_PROJECT_FILE_BYTES||total>MAX_PROJECT_BYTES)throw Error("PROJECT_SIZE_LIMIT");
  indexed.push({path:f.path,content:f.content,bytes,hash:await digest(f.content)});
 }
 if(!used.has(entrypoint.toLowerCase())||!indexed.some(f=>f.path===entrypoint))
  throw Error("PROJECT_ENTRYPOINT_MISSING");
 indexed.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 const metadata={schema_version:PROJECT_SCHEMA,profile,entrypoint,revision,parent_hash,
  files:indexed.map(({path,bytes,hash})=>({path,bytes,hash}))};
 const project_hash=await digest("APPF2_PROJECT_V1\u0000"+canonical(metadata));
 return {schema_version:PROJECT_SCHEMA,profile,entrypoint,revision,parent_hash,files:indexed,project_hash};
}
/** Immutable content-addressed source tree. No host file writes, installs, or execution. */
export async function createProjectSnapshot(profile:ProjectProfile,entrypoint:string,
 sources:readonly {path:string;content:string}[]):Promise<ProjectSnapshot>{
 return assemble(profile,entrypoint,1,null,sources);
}
export async function verifyProjectSnapshot(input:unknown):Promise<boolean>{
 if(!exact(input,["schema_version","profile","entrypoint","revision","parent_hash","files","project_hash"])||
   input.schema_version!==PROJECT_SCHEMA||typeof input.profile!=="string"||
   typeof input.entrypoint!=="string"||!Array.isArray(input.files)||
   typeof input.revision!=="number"||typeof input.project_hash!=="string"||
   !HASH.test(input.project_hash)||(input.parent_hash!==null&&
     (typeof input.parent_hash!=="string"||!HASH.test(input.parent_hash))))return false;
 const files: {path:string;content:string}[]=[];
 for(const f of input.files){
  if(!exact(f,["path","content","bytes","hash"])||typeof f.path!=="string"||
    typeof f.content!=="string"||typeof f.bytes!=="number"||
    typeof f.hash!=="string"||!HASH.test(f.hash))return false;
  files.push({path:f.path,content:f.content});
 }
 try{
  const recomputed=await assemble(input.profile as ProjectProfile,input.entrypoint,input.revision,
    input.parent_hash as string|null,files);
  return canonical(recomputed)===canonical(input);
 }catch{return false;}
}
export async function applyProjectEdits(previous:ProjectSnapshot,expected_hash:string,
 edits:readonly ProjectEdit[]):Promise<ProjectSnapshot>{
 if(!(await verifyProjectSnapshot(previous))||expected_hash!==previous.project_hash)
  throw Error("PROJECT_STALE_REVISION");
 if(edits.length===0||edits.length>64)throw Error("PROJECT_EDIT_COUNT");
 const map=new Map(previous.files.map(f=>[f.path,{path:f.path,content:f.content,hash:f.hash}]));
 const touched=new Set<string>();
 for(const edit of edits){
  assertWorkspacePath(edit.path);
  if(touched.has(edit.path.toLowerCase()))throw Error("PROJECT_DUPLICATE_EDIT");
  touched.add(edit.path.toLowerCase());
  const prior=map.get(edit.path);
  if(edit.operation==="add"){
   if(prior||Object.keys(edit).sort().join(",")!=="content,operation,path")
    throw Error("PROJECT_ADD_CONFLICT");
   map.set(edit.path,{path:edit.path,content:edit.content,hash:""});
  }else if(edit.operation==="replace"||edit.operation==="delete"){
   if(!prior||edit.previous_hash!==prior.hash||
     Object.keys(edit).sort().join(",")!==(edit.operation==="delete"?
       "operation,path,previous_hash":"content,operation,path,previous_hash"))
    throw Error("PROJECT_EDIT_CONFLICT");
   if(edit.operation==="delete")map.delete(edit.path);
   else map.set(edit.path,{path:edit.path,content:edit.content,hash:""});
  }else{throw Error("PROJECT_UNKNOWN_OPERATION");}
 }
 return assemble(previous.profile,previous.entrypoint,previous.revision+1,previous.project_hash,
  Array.from(map.values()).map(({path,content})=>({path,content})));
}
