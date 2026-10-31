/**
 * Narrow output-only handshake between isolated Vite builder and separately
 * trusted Browser QA. No source, private logs, generated shell, or public URL.
 */
export type BuiltAssetRequest={
 readonly job_id:string;readonly project_hash:string;
 readonly build_call_id:string;readonly path:string;
};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA=/^sha256:[a-f0-9]{64}$/u;
const CALL=/^call_[A-Za-z0-9_-]{4,74}$/u;
const ASSET=/^assets\/[A-Za-z0-9_-]{1,96}\.(?:js|css)$/u;
export const MAX_BUILT_ASSET_BYTES=2*1024*1024;
export function validBuiltAssetRequest(raw:unknown):raw is BuiltAssetRequest{
 if(typeof raw!=="object"||raw===null||Array.isArray(raw))return false;
 const v=raw as Record<string,unknown>;
 return Object.keys(v).sort().join(",")===
  "build_call_id,job_id,path,project_hash"&&
  typeof v.job_id==="string"&&UUID.test(v.job_id)&&
  typeof v.project_hash==="string"&&SHA.test(v.project_hash)&&
  typeof v.build_call_id==="string"&&CALL.test(v.build_call_id)&&
  typeof v.path==="string"&&(v.path==="index.html"||ASSET.test(v.path));
}
export function builtAssetContentType(path:string):string{
 return path==="index.html"?"text/html; charset=utf-8":
  path.endsWith(".js")?"text/javascript; charset=utf-8":"text/css; charset=utf-8";
}

/** Cloudflare DO SQLite limits one value to 2 MB. Store bounded slices so
 * private compiled apps remain usable after container idle shutdown, without
 * waking paid infrastructure or executing generated source again.
 */
export const BUILT_CACHE_CHUNK_BYTES=64*1024;
export const MAX_BUILT_CACHE_FILES=12;
export function viteCompiledAssetPaths(html:string):readonly string[]{
 if(typeof html!=="string"||html.length<1||html.length>300000)
  throw Error("BUILT_CACHE_INDEX_INVALID");
 const paths=["index.html"];
 const references=html.matchAll(/\b(?:src|href)=["']\/?(assets\/[A-Za-z0-9_-]{1,96}\.(?:js|css))["']/gu);
 for(const match of references){
  const name=match[1];
  if(name&&!paths.includes(name))paths.push(name);
  if(paths.length>MAX_BUILT_CACHE_FILES)throw Error("BUILT_CACHE_TOO_MANY_FILES");
 }
 if(!paths.some(path=>path.endsWith(".js")))
  throw Error("BUILT_CACHE_SCRIPT_MISSING");
 return paths;
}
export function splitBuiltAsset(bytes:Uint8Array):readonly Uint8Array[]{
 if(!(bytes instanceof Uint8Array)||bytes.byteLength===0||
  bytes.byteLength>MAX_BUILT_ASSET_BYTES)throw Error("BUILT_CACHE_ASSET_TOO_LARGE");
 const out:Uint8Array[]=[];
 for(let offset=0;offset<bytes.byteLength;offset+=BUILT_CACHE_CHUNK_BYTES)
  out.push(bytes.slice(offset,offset+BUILT_CACHE_CHUNK_BYTES));
 return out;
}
export function assembleBuiltAsset(chunks:readonly Uint8Array[]):Uint8Array{
 if(chunks.length<1||
  chunks.length>Math.ceil(MAX_BUILT_ASSET_BYTES/BUILT_CACHE_CHUNK_BYTES))
  throw Error("BUILT_CACHE_CHUNK_COUNT");
 const total=chunks.reduce((n,x)=>n+x.byteLength,0);
 if(total<1||total>MAX_BUILT_ASSET_BYTES||
  chunks.some((x,i)=>!(x instanceof Uint8Array)||x.byteLength===0||
   x.byteLength>BUILT_CACHE_CHUNK_BYTES||
   (i<chunks.length-1&&x.byteLength!==BUILT_CACHE_CHUNK_BYTES)))
  throw Error("BUILT_CACHE_CHUNKS_INVALID");
 const output=new Uint8Array(total);let offset=0;
 for(const chunk of chunks){output.set(chunk,offset);offset+=chunk.byteLength;}
 return output;
}
