/** Verify signature AND claim boundaries for a single GitHub-hosted
 * FREE runner workflow. Never trust decoded JWT without RS256/JWKS verification.
 */
const ISSUER="https://token.actions.githubusercontent.com";
const WORKFLOW="NFF98/appf2-build/.github/workflows/sp35-staging-only.yml@"+
 "refs/heads/product/sprint-3.5-complex-intent-recovery-20261026";
export const FREE_CI_AUDIENCE="appf2-sp35-free-ci-private-source-v1";
function decoded(s:string):Uint8Array<ArrayBuffer>{
 if(!/^[A-Za-z0-9_-]+$/u.test(s)||s.length>7500)return new Uint8Array();
 const b=atob(s.replaceAll("-","+").replaceAll("_","/"));
 return Uint8Array.from(b,c=>c.charCodeAt(0));
}
function json(bytes:Uint8Array):Record<string,unknown>|null{
 try{
  const x:unknown=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  return typeof x==="object"&&x!==null&&!Array.isArray(x)?
   x as Record<string,unknown>:null;
 }catch{return null;}
}
// eslint-disable-next-line complexity -- Each GitHub OIDC claim is a required independent trust boundary.
export async function verifiedFreeCiOidcRunId(token:string,nowMs:number,
 loadKeys:()=>Promise<unknown>):Promise<string|null>{
 try{
  if(token.length>12000)return null;
  const parts=token.split(".");
  if(parts.length!==3)return null;
  const header=json(decoded(parts[0])),claims=json(decoded(parts[1]));
  if(!header||!claims||header.alg!=="RS256"||
   typeof header.kid!=="string"||header.kid.length>180)return null;
  const now=Math.floor(nowMs/1000);
  if(claims.iss!==ISSUER||claims.aud!==FREE_CI_AUDIENCE||
   claims.repository!=="NFF98/appf2-build"||
   claims.ref!=="refs/heads/product/sprint-3.5-complex-intent-recovery-20261026"||
   claims.workflow_ref!==WORKFLOW||
   claims.event_name!=="workflow_dispatch"||
   claims.runner_environment!=="github-hosted"||
   claims.repository_visibility!=="public"||
   typeof claims.iat!=="number"||typeof claims.exp!=="number"||
   claims.iat>now+60||claims.exp<now||claims.exp>now+900||
   typeof claims.run_id!=="string"||!/^[0-9]{6,20}$/u.test(claims.run_id))
   return null;
  const keys=await loadKeys();
  if(typeof keys!=="object"||keys===null||!("keys" in keys)||
   !Array.isArray(keys.keys))return null;
  const jwk=keys.keys.find((k:unknown)=>typeof k==="object"&&k!==null&&
   "kid" in k&&k.kid===header.kid&&"kty" in k&&k.kty==="RSA"&&
   "use" in k&&k.use==="sig"&&"alg" in k&&k.alg==="RS256");
  if(!jwk)return null;
  const key=await crypto.subtle.importKey("jwk",jwk,{
   name:"RSASSA-PKCS1-v1_5",hash:"SHA-256"},false,["verify"]);
  const verified=await crypto.subtle.verify("RSASSA-PKCS1-v1_5",key,decoded(parts[2]),
   new TextEncoder().encode(parts[0]+"."+parts[1]));
  return verified?claims.run_id as string:null;
 }catch{return null;}
}
export async function verifyFreeCiOidc(token:string,nowMs:number,
 loadKeys:()=>Promise<unknown>):Promise<boolean>{
 return (await verifiedFreeCiOidcRunId(token,nowMs,loadKeys))!==null;
}
export async function verifiedLiveFreeCiOidcRunId(token:string,nowMs:number):
 Promise<string|null>{
 return verifiedFreeCiOidcRunId(token,nowMs,async()=>{
  const r=await globalThis.fetch(ISSUER+"/.well-known/jwks",{
   method:"GET",signal:globalThis.AbortSignal.timeout(7000)});
  if(!r.ok)throw Error("FREE_CI_JWKS_UNAVAILABLE");
  return r.json();
 });
}
export async function verifyLiveFreeCiOidc(token:string,nowMs:number):
 Promise<boolean>{
 return (await verifiedLiveFreeCiOidcRunId(token,nowMs))!==null;
}
