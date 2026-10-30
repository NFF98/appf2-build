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
