/**
 * H1 experimental v2 single-file code artifact contract, NOT a promotion of
 * F02 Blueprint v1 and NOT authority to publish or execute from an artifact hash.
 * The full production v2 F02 admission, R2 storage and trusted build provenance
 * require independent evidence.
 */
export const CODE_ARTIFACT_PROFILE="WEB_STATIC_V1" as const;
export const CODE_ARTIFACT_SCHEMA="2.0.0" as const;
export const CODE_ARTIFACT_MAX_BYTES=128*1024;
export const CODE_ARTIFACT_FILE="app.js" as const;
const HASH=/^sha256:[0-9a-f]{64}$/u;
const MIME="text/javascript" as const;

export interface CodeArtifactManifestV2 {
  readonly manifest_version:"1.0.0";
  readonly sandbox_profile:typeof CODE_ARTIFACT_PROFILE;
  readonly files:readonly [{
    readonly path:typeof CODE_ARTIFACT_FILE;
    readonly mime:typeof MIME;
    readonly bytes:number;
    readonly hash:string;
  }];
  readonly dependency_mode:"SELF_CONTAINED";
  readonly permission_profile:"NO_NETWORK";
}
export interface CodeArtifactEnvelopeV2 {
  readonly schema_version:typeof CODE_ARTIFACT_SCHEMA;
  readonly kind:"APP";
  readonly meta:{readonly title:string};
  readonly execution:{
    readonly kind:"CODE_ARTIFACT";
    readonly artifact_id:string;
    readonly manifest_hash:string;
    readonly entrypoint:typeof CODE_ARTIFACT_FILE;
    readonly sandbox_profile:typeof CODE_ARTIFACT_PROFILE;
    readonly host_protocol:"NONE_V1";
  };
}
export interface CodeArtifactPackageV2 {
  readonly envelope:CodeArtifactEnvelopeV2;
  readonly manifest:CodeArtifactManifestV2;
  /** Proof-only prototype. In production this comes from authorized immutable R2 bytes. */
  readonly javascript:string;
}

function record(value:unknown):value is Record<string,unknown>{
  return typeof value==="object"&&value!==null&&!Array.isArray(value);
}
function keys(value:unknown,expected:readonly string[]):value is Record<string,unknown>{
  return record(value)&&Object.keys(value).length===expected.length&&
    Object.keys(value).every(key=>expected.includes(key));
}
/** Deterministic sorted JSON for the prototype. Production v2 canonicalization requires F02 spec freeze. */
export function canonicalArtifactJson(value:unknown):string{
  if(Array.isArray(value))return "["+value.map(canonicalArtifactJson).join(",")+"]";
  if(record(value)){
    const keys=Object.keys(value).sort();
    return "{"+keys.map(key=>JSON.stringify(key)+":"+canonicalArtifactJson(value[key])).join(",")+"}";
  }
  if(value===null||typeof value==="string"||typeof value==="boolean"||
    (typeof value==="number"&&Number.isFinite(value)))return JSON.stringify(value);
  throw new Error("CODE_ARTIFACT_UNSERIALIZABLE");
}
function utf8(value:string):Uint8Array{return new TextEncoder().encode(value);}
export async function sha256CodeBytes(bytes:BufferSource):Promise<string>{
  const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
  return "sha256:"+Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("");
}
function trustedJavaScript(source:unknown):source is string{
  if(typeof source!=="string")return false;
  const bytes=utf8(source);
  return bytes.length>0&&bytes.length<=CODE_ARTIFACT_MAX_BYTES&&
    !/<\/script\b/iu.test(source)&&!source.includes("\u0000");
}
async function packageHash(script:string):Promise<string>{
  // Domain separate package digest from naked file content digest.
  return sha256CodeBytes(utf8("APPF2_WEB_STATIC_V1\u0000app.js\u0000"+script));
}
/** For local proofs only; does not admit arbitrary source for user-facing F05. */
export async function makePrototypeCodeArtifact(title:string,javascript:string):Promise<CodeArtifactPackageV2>{
  if(title.trim().length<1||title.length>120||!trustedJavaScript(javascript))
    throw new Error("CODE_ARTIFACT_INVALID_SOURCE");
  const bytes=utf8(javascript);
  const fileHash=await sha256CodeBytes(bytes);
  const manifest:CodeArtifactManifestV2={
    manifest_version:"1.0.0",sandbox_profile:CODE_ARTIFACT_PROFILE,
    files:[{path:CODE_ARTIFACT_FILE,mime:MIME,bytes:bytes.length,hash:fileHash}],
    dependency_mode:"SELF_CONTAINED",permission_profile:"NO_NETWORK"
  };
  const envelope:CodeArtifactEnvelopeV2={
    schema_version:CODE_ARTIFACT_SCHEMA,kind:"APP",meta:{title:title.trim()},
    execution:{
      kind:"CODE_ARTIFACT",artifact_id:await packageHash(javascript),
      manifest_hash:await sha256CodeBytes(utf8(canonicalArtifactJson(manifest))),
      entrypoint:CODE_ARTIFACT_FILE,sandbox_profile:CODE_ARTIFACT_PROFILE,host_protocol:"NONE_V1"
    }
  };
  return {envelope,manifest,javascript};
}
export type PrototypeAdmissionResult =
  | {readonly ok:true;readonly blueprint_hash:string;readonly artifact:CodeArtifactPackageV2}
  | {readonly ok:false;readonly reason:"INVALID_SHAPE"|"HASH_MISMATCH"|"UNSUPPORTED_PROFILE"};
/** Test and shell prototype admission: strict shapes, allowlisted permission and verified every byte.
 * This does NOT replace DB-backed F02 v2 build provenance or original-holder share authorization. */
export async function verifyPrototypeCodeArtifact(input:unknown):Promise<PrototypeAdmissionResult>{
  const bad=(reason:Extract<PrototypeAdmissionResult,{ok:false}>["reason"]):PrototypeAdmissionResult=>({ok:false,reason});
  if(!keys(input,["envelope","manifest","javascript"])||!trustedJavaScript(input.javascript))
    return bad("INVALID_SHAPE");
  const e=input.envelope,m=input.manifest;
  if(!keys(e,["schema_version","kind","meta","execution"])||
    !keys(e.meta,["title"])||!keys(e.execution,[
      "kind","artifact_id","manifest_hash","entrypoint","sandbox_profile","host_protocol"
    ])||!keys(m,["manifest_version","sandbox_profile","files","dependency_mode","permission_profile"])||
    !Array.isArray(m.files)||m.files.length!==1||!keys(m.files[0],["path","mime","bytes","hash"]))
    return bad("INVALID_SHAPE");
  const x=e.execution,f=m.files[0] as Record<string,unknown>;
  if(e.schema_version!==CODE_ARTIFACT_SCHEMA||e.kind!=="APP"||
    typeof e.meta.title!=="string"||e.meta.title.trim().length<1||e.meta.title.length>120||
    x.kind!=="CODE_ARTIFACT"||x.entrypoint!==CODE_ARTIFACT_FILE||
    x.sandbox_profile!==CODE_ARTIFACT_PROFILE||x.host_protocol!=="NONE_V1"||
    m.sandbox_profile!==CODE_ARTIFACT_PROFILE||m.manifest_version!=="1.0.0"||
    m.dependency_mode!=="SELF_CONTAINED"||m.permission_profile!=="NO_NETWORK")
    return bad("UNSUPPORTED_PROFILE");
  if(f.path!==CODE_ARTIFACT_FILE||f.mime!==MIME||
    typeof f.bytes!=="number"||f.bytes!==utf8(input.javascript).length||
    typeof f.hash!=="string"||!HASH.test(f.hash)||
    typeof x.artifact_id!=="string"||!HASH.test(x.artifact_id)||
    typeof x.manifest_hash!=="string"||!HASH.test(x.manifest_hash))
    return bad("INVALID_SHAPE");
  if(f.hash!==await sha256CodeBytes(utf8(input.javascript))||
    x.artifact_id!==await packageHash(input.javascript)||
    x.manifest_hash!==await sha256CodeBytes(utf8(canonicalArtifactJson(m))))
    return bad("HASH_MISMATCH");
  const blueprint_hash=await sha256CodeBytes(utf8(canonicalArtifactJson(e)));
  return {ok:true,blueprint_hash,artifact:input as unknown as CodeArtifactPackageV2};
}
