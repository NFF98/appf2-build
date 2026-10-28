import {verifyMutationProof} from "./create-proof.js";
import {makePrototypeCodeArtifact,verifyPrototypeCodeArtifact} from "../platform/blueprint/code-artifact-v2.js";
import {WorkerPostgresExecutor,NO_REQUEST_DB_CONTEXT} from "../platform/blueprint/worker-postgres-executor.js";
import type {Appf2WorkerEnv} from "./worker-composition.js";
import {appf2ModelProviderConfig} from "../platform/compiler/appf2-model-provider.js";
import {codeBuilderModelRequest,readCodeBuilderCompletion,CODE_BUILDER_GENERATION_TIMEOUT_MS} from "./code-builder-generation-contract.js";
import {qualityGateCode} from "./code-builder-quality.js";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const JSON_HEADERS={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store"};
const CREATE="/api/v1/code-apps",ITEM=/^\/api\/v1\/code-apps\/([^/]+)$/u;
const START=`INSERT INTO public.appf2_code_app
 (share_id,creator_anonymous_id,creator_key_thumbprint,idempotency_key,title,prompt,public_opt_in)
 VALUES($1::uuid,$2::uuid,$3::text,$4::text,'新 App',$5::text,true)
 ON CONFLICT(creator_key_thumbprint,idempotency_key) DO NOTHING
 RETURNING share_id::text,status`;
const PRIOR=`SELECT share_id::text,status,blueprint_hash FROM public.appf2_code_app
 WHERE creator_key_thumbprint=$1::text AND idempotency_key=$2::text AND creator_anonymous_id=$3::uuid`;
const FINISH=`UPDATE public.appf2_code_app SET status='ACTIVE',title=$2,blueprint_hash=$3,artifact=$4::jsonb
 WHERE share_id=$1::uuid AND status='BUILDING' RETURNING share_id::text`;
const FAIL=`UPDATE public.appf2_code_app SET status='FAILED' WHERE share_id=$1::uuid AND status='BUILDING'`;
const GET=`SELECT share_id::text,title,blueprint_hash,artifact FROM public.appf2_code_app
 WHERE share_id=$1::uuid AND status='ACTIVE' LIMIT 1`;
const LIST=`SELECT share_id::text,title,blueprint_hash FROM public.appf2_code_app
 WHERE status='ACTIVE' ORDER BY created_at DESC LIMIT 12`;
type Identity={anonymousId:string|null;intentId:string|null};
export type CodeBuilderDb={query:<T>(sql:string,args:readonly unknown[])=>Promise<{rows:readonly T[]}>;close:()=>Promise<void>};
export type CodeBuilderDeps={db?:(env:Appf2WorkerEnv,identity:Identity)=>CodeBuilderDb;generate?:(env:Appf2WorkerEnv,prompt:string)=>Promise<{title:string;javascript:string}|null>;quality?:(env:Appf2WorkerEnv,prompt:string,draft:{title:string;javascript:string},allowRepair:boolean)=>Promise<{title:string;javascript:string}|null>};
const answer=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:JSON_HEADERS});
const denied=()=>answer(404,{error:"CODE_APP_NOT_FOUND"});
const unavailable=()=>answer(503,{error:"CODE_APP_UNAVAILABLE"});
function dbFor(env:Appf2WorkerEnv,identity:Identity,deps:CodeBuilderDeps):CodeBuilderDb{
 return deps.db?.(env,identity)??new WorkerPostgresExecutor(env.HYPERDRIVE_FRESH,identity);
}
async function db<T>(env:Appf2WorkerEnv,identity:Identity,deps:CodeBuilderDeps,run:(db:CodeBuilderDb)=>Promise<T>):Promise<T>{
 const client=dbFor(env,identity,deps);
 try{return await run(client);}finally{await client.close().catch(()=>undefined);}
}
/** One bounded paid call; no hidden retries, fallback, JS execution, or automatic publishing if validation fails. */
export async function generateCodeApp(env:Appf2WorkerEnv,prompt:string):Promise<{title:string;javascript:string}|null>{
 const config=appf2ModelProviderConfig({
   APPF2_MODEL_BASE_URL:env.APPF2_MODEL_BASE_URL,APPF2_MODEL_API_KEY:env.APPF2_MODEL_API_KEY,
   APPF2_MODEL_NAME:env.APPF2_MODEL_NAME,APPF2_MODEL_PROVIDER:env.APPF2_MODEL_PROVIDER,
   APPF2_XAI_API_KEY:env.APPF2_XAI_API_KEY,APPF2_XAI_MODEL_NAME:env.APPF2_XAI_MODEL_NAME,
   APPF2_DEEPSEEK_API_KEY:env.APPF2_DEEPSEEK_API_KEY,APPF2_DEEPSEEK_MODEL_NAME:env.APPF2_DEEPSEEK_MODEL_NAME
 }).config;
 const request=codeBuilderModelRequest(config.model,prompt);
 const response=await fetch(config.baseUrl+"/chat/completions",{
   method:"POST",headers:{"Authorization":"Bearer "+config.apiKey,"Content-Type":"application/json"},
   body:JSON.stringify(request),signal:AbortSignal.timeout(CODE_BUILDER_GENERATION_TIMEOUT_MS)
 });
 if(!response.ok)return null;
 const data:unknown=await response.json();
 return readCodeBuilderCompletion(data);
}
// eslint-disable-next-line complexity -- Signed creation, single charge, fail-closed admission and idempotency each require an independent guard.
async function generate(ctx:{request:Request;url:URL;env:Appf2WorkerEnv;deps:CodeBuilderDeps}):Promise<Response>{
 const {request,url,env,deps}=ctx,origin=request.headers.get("Origin"),site=request.headers.get("Sec-Fetch-Site");
 if(request.method!=="POST"||url.search||origin!==url.origin||(site!==null&&site!=="same-origin")||
 request.headers.get("Content-Type")?.split(";")[0]!.trim().toLowerCase()!=="application/json")return denied();
 const key=request.headers.get("Idempotency-Key");
 if(!key||!/^[A-Za-z0-9_-]{8,128}$/u.test(key))return answer(400,{error:"INVALID_KEY"});
 const body=new Uint8Array(await request.arrayBuffer());
 if(body.byteLength>1400)return answer(413,{error:"TOO_LONG"});
 let data:unknown;try{data=JSON.parse(new TextDecoder().decode(body));}catch{return answer(400,{error:"INVALID_INPUT"});}
 if(typeof data!=="object"||data===null||Array.isArray(data))return answer(400,{error:"INVALID_INPUT"});
 const raw=data as Record<string,unknown>;
 if((Object.keys(raw).length!==3&&Object.keys(raw).length!==4)||!UUID.test(String(raw.anonymous_id))||
 typeof raw.prompt!=="string"||raw.prompt.trim().length<5||raw.prompt.length>800||raw.public_opt_in!==true||
 (Object.keys(raw).length===4&&(raw.allow_auto_repair!==true||!Object.hasOwn(raw,"allow_auto_repair"))))
 return answer(400,{error:"INVALID_INPUT_OR_PUBLIC_CONSENT"});
 const proof=await verifyMutationProof({method:"POST",path:CREATE,body,
   idempotencyKey:key,headers:request.headers},Date.now());
 if(proof===null)return denied();
 const anonymousId=String(raw.anonymous_id),prompt=String(raw.prompt).trim(),identity={anonymousId,intentId:null};
 // No paid model call and no public card when the independent browser cannot run.
 if(!env.APPF2_QA_BROWSER&&!deps.quality)return answer(503,{error:"QA_BROWSER_UNAVAILABLE_NO_CHARGE"});
 const previous=await db(env,identity,deps,async executor=>
   (await executor.query<{share_id:string;status:string;blueprint_hash:string|null}>(PRIOR,[proof.keyThumbprint,key,anonymousId])).rows[0]);
 if(previous!==undefined){
  if(previous.status==="ACTIVE")return answer(200,{data:{share_id:previous.share_id,blueprint_hash:previous.blueprint_hash,url:"/code/"+previous.share_id,status:"ACTIVE"}});
  return answer(409,{error:"ALREADY_ATTEMPTED"});
 }
 // Server-only quota keyed by a secret-derived network pseudonym, never the untrusted anonymous UUID.
 const ip=request.headers.get("CF-Connecting-IP")??"unknown";
 const digest=new Uint8Array(await crypto.subtle.digest("SHA-256",new TextEncoder().encode(env.APPF2_IDENTITY_COOKIE_SECRET+"|"+ip)));
 const networkDigest=Array.from(digest,b=>b.toString(16).padStart(2,"0")).join("");
 const allowed=await db(env,NO_REQUEST_DB_CONTEXT,deps,async executor=>(await executor.query<{allowed:boolean}>(
   "SELECT appf2_internal.consume_code_daily_budget($1::text) AS allowed",[networkDigest])).rows[0]?.allowed===true);
 if(!allowed)return answer(429,{error:"DAILY_CODE_BUILD_LIMIT_2"});
 const shareId=crypto.randomUUID();
 const created=await db(env,identity,deps,async executor=>(await executor.query<{share_id:string}>(START,
   [shareId,anonymousId,proof.keyThumbprint,key,prompt])).rows[0]);
 if(created===undefined)return answer(409,{error:"ALREADY_ATTEMPTED"});
 try{
  const code=await (deps.generate??generateCodeApp)(env,prompt);
  if(code===null)throw Error("MODEL_INVALID");
  // Never promote a merely-hashed draft. This step uses independently planned
  // requirements and actual isolated-browser evidence before ACTIVE.
  const checked=await (deps.quality??qualityGateCode)(env,prompt,code,raw.allow_auto_repair===true);
  if(checked===null)throw Error("QA_NOT_VERIFIED");
  const pkg=await makePrototypeCodeArtifact(checked.title,checked.javascript);
  const verified=await verifyPrototypeCodeArtifact(pkg);
  if(!verified.ok)throw Error("ARTIFACT_NOT_ADMITTED");
  const saved=await db(env,identity,deps,async executor=>(await executor.query<{share_id:string}>(FINISH,
   [shareId,checked.title,verified.blueprint_hash,JSON.stringify(pkg)])).rows[0]);
  if(saved===undefined)throw Error("ARTIFACT_SAVE_FAILED");
  return answer(201,{data:{share_id:shareId,blueprint_hash:verified.blueprint_hash,url:"/code/"+shareId,status:"ACTIVE"}});
 }catch{
  await db(env,identity,deps,async executor=>{await executor.query(FAIL,[shareId]);}).catch(()=>undefined);
  return answer(422,{error:"CODE_BUILD_FAILED_NO_PUBLISHED_APP"});
 }
}
async function read(ctx:{url:URL;env:Appf2WorkerEnv;deps:CodeBuilderDeps},id:string):Promise<Response>{
 if(!UUID.test(id)||ctx.url.search)return denied();
 const item=await db(ctx.env,NO_REQUEST_DB_CONTEXT,ctx.deps,async executor=>
   (await executor.query<{share_id:string;title:string;blueprint_hash:string;artifact:unknown}>(GET,[id])).rows[0]);
 if(item===undefined)return denied();
 const verified=await verifyPrototypeCodeArtifact(item.artifact);
 if(!verified.ok||item.blueprint_hash!==verified.blueprint_hash)return denied();
 return answer(200,{data:{share_id:item.share_id,title:item.title,blueprint_hash:item.blueprint_hash,artifact:verified.artifact}});
}
export async function routeCodeBuilder(ctx:{request:Request;url:URL;env:Appf2WorkerEnv;deps?:CodeBuilderDeps}):Promise<Response|undefined>{
 const {request,url,env}=ctx,deps=ctx.deps??{},path=url.pathname;
 if(path!==CREATE&&path!=="/api/v1/code-apps-public"&&!ITEM.test(path))return undefined;
 try{
  if(path===CREATE)return await generate({request,url,env,deps});
  if(request.method!=="GET"||request.headers.get("Sec-Fetch-Site")==="cross-site")return denied();
  if(path==="/api/v1/code-apps-public"){
    const items=await db(env,NO_REQUEST_DB_CONTEXT,deps,async executor=>
      (await executor.query<{share_id:string;title:string;blueprint_hash:string}>(LIST,[])).rows);
    return answer(200,{data:{apps:items}});
  }
  return await read({url,env,deps},ITEM.exec(path)?.[1]??"");
 }catch{return unavailable();}
}
