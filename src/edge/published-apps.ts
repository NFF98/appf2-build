import { isUuid } from "../platform/evidence/evidence-validator.js";
import { WorkerPostgresExecutor, NO_REQUEST_DB_CONTEXT, type WorkerRequestDbContext } from "../platform/blueprint/worker-postgres-executor.js";
import type { PostgresExecutor } from "../platform/blueprint/postgres-blueprint-repository.js";
import { CONTENT_HASH_PATTERN, readBlueprintAccessGrant } from "./blueprint-access-grant.js";
import type { BlueprintDeliveryFactory } from "./blueprint-delivery.js";
import type { Appf2WorkerEnv, ClosableExecutor } from "./worker-composition.js";

export const PUBLISHED_APPS_ROUTE="/api/v1/published-apps";
const CREATE_SHARE_ROUTE="/api/v1/shares";
const SHARE_ROUTE=/^\/api\/v1\/shares\/([^/]+)$/u;
const LIST_SQL=`SELECT share_id::text,title,blueprint_hash AS content_hash
  FROM public.appf2_published_app WHERE listed AND status='ACTIVE'
  AND (expires_at IS NULL OR expires_at>now())
  ORDER BY created_at DESC LIMIT 20`;
const RESOLVE_SQL=`SELECT share_id::text,title,blueprint_hash AS content_hash
  FROM public.appf2_published_app WHERE share_id=$1::uuid AND status='ACTIVE'
  AND (expires_at IS NULL OR expires_at>now()) LIMIT 1`;
const INSERT_SQL=`INSERT INTO public.appf2_published_app
  (share_id,source_intent_id,creator_anonymous_id,blueprint_hash,title,idempotency_key)
  VALUES($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text)
  ON CONFLICT(source_intent_id,idempotency_key) DO NOTHING
  RETURNING share_id::text,title,blueprint_hash AS content_hash`;
const RETRY_SQL=`SELECT share_id::text,title,blueprint_hash AS content_hash
  FROM public.appf2_published_app
  WHERE source_intent_id=$1::uuid AND idempotency_key=$2::text LIMIT 1`;

type PublicRow={readonly share_id:string;readonly title:string;readonly content_hash:string};
type Context={readonly request:Request;readonly url:URL;readonly env:Appf2WorkerEnv;readonly nowMs:number;readonly delivery:BlueprintDeliveryFactory;readonly dbFactory?: (context:WorkerRequestDbContext)=>PostgresExecutor&ClosableExecutor};
const HEADERS={"Cache-Control":"private, no-store","Content-Type":"application/json; charset=utf-8"};
function response(status:number,data:Readonly<Record<string,unknown>>):Response{
  return new Response(JSON.stringify(data),{status,headers:HEADERS});
}
const unavailable=()=>response(503,{error:{code:"PUBLISHED-APP-UNAVAILABLE"}});
const notFound=()=>response(404,{error:{code:"PUBLISHED-APP-NOT-FOUND"}});
async function db<T>(ctx:Context,identity:WorkerRequestDbContext,fn:(executor:PostgresExecutor)=>Promise<T>):Promise<T>{
  const executor=ctx.dbFactory?.(identity)??new WorkerPostgresExecutor(ctx.env.HYPERDRIVE_FRESH,identity);
  try{return await fn(executor);}finally{await executor.close().catch(()=>undefined);}
}
function validRow(row:unknown):row is PublicRow {
  if(typeof row!=="object"||row===null)return false;
  const v=row as Partial<PublicRow>;
  return isUuid(v.share_id) && typeof v.title==="string" && v.title.length>0 &&
    typeof v.content_hash==="string" && CONTENT_HASH_PATTERN.test(v.content_hash);
}
function isRead(request:Request,url:URL):boolean{
  return request.method==="GET" && url.search==="" &&
    request.headers.get("Sec-Fetch-Site")!=="cross-site";
}
async function list(ctx:Context):Promise<Response>{
  if(!isRead(ctx.request,ctx.url))return notFound();
  return db(ctx,NO_REQUEST_DB_CONTEXT,async executor=>{
    const rows=(await executor.query<PublicRow>(LIST_SQL,[])).rows.filter(validRow);
    return response(200,{data:{apps:rows}});
  });
}
async function resolve(ctx:Context,id:string):Promise<Response>{
  if(!isUuid(id)||!isRead(ctx.request,ctx.url))return notFound();
  return db(ctx,NO_REQUEST_DB_CONTEXT,async executor=>{
    const row=(await executor.query<PublicRow>(RESOLVE_SQL,[id])).rows[0];
    return validRow(row)?response(200,{data:{share_id:row.share_id,status:"ACTIVE",blueprint_hash:row.content_hash,title:row.title}})
      :notFound();
  });
}
function titleAndTarget(body:unknown):{source_intent_id:string;blueprint_hash:string;title:string}|null{
  if(typeof body!=="object"||body===null||Array.isArray(body))return null;
  const record=body as Record<string,unknown>;
  const keys=Object.keys(record);
  if(keys.length!==3||keys.some(k=>!["source_intent_id","blueprint_hash","title"].includes(k)))return null;
  if(!isUuid(record.source_intent_id)||typeof record.blueprint_hash!=="string"||
    !CONTENT_HASH_PATTERN.test(record.blueprint_hash)||typeof record.title!=="string")return null;
  const title=record.title.trim();
  if(title.length===0||title.length>80||/[\u0000-\u001f]/u.test(title))return null;
  return {source_intent_id:record.source_intent_id,blueprint_hash:record.blueprint_hash,title};
}
function validWrite(ctx:Context):boolean{
  const r=ctx.request,u=ctx.url,site=r.headers.get("Sec-Fetch-Site");
  return r.method==="POST" && u.search==="" && (site===null||site==="same-origin") &&
    r.headers.get("Origin")===u.origin && r.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()==="application/json";
}
/** Only the exact original holder + already independently executable F02 output can publish. */
async function publish(ctx:Context):Promise<Response>{
  if(!validWrite(ctx))return notFound();
  const idempotencyKey=ctx.request.headers.get("Idempotency-Key");
  if(idempotencyKey===null||!/^[a-zA-Z0-9_-]{8,128}$/u.test(idempotencyKey))return response(400,{error:{code:"PUBLISHED-APP-INVALID-KEY"}});
  let target:ReturnType<typeof titleAndTarget>=null;
  try{
    if(Number(ctx.request.headers.get("Content-Length"))>2048)return response(413,{error:{code:"PUBLISHED-APP-LARGE"}});
    target=titleAndTarget(await ctx.request.json());
  }catch{/* fail closed */}
  if(target===null)return response(400,{error:{code:"PUBLISHED-APP-INVALID-REQUEST"}});
  const claims=await readBlueprintAccessGrant(ctx.request.headers.get("Authorization"),target.blueprint_hash,ctx.env.APPF2_IDENTITY_COOKIE_SECRET,ctx.nowMs);
  if(claims===null||claims.intentId!==target.source_intent_id)return notFound();
  const identity={anonymousId:claims.anonymousId,intentId:claims.intentId};
  const checks=ctx.delivery(ctx.env,identity);
  try{
    if(!(await checks.lineage.verifyLineage(target.blueprint_hash)).verified)return notFound();
    const decision=await checks.admission.admit(target.blueprint_hash);
    if(!decision.executable)return response(422,{error:{code:"PUBLISHED-APP-NOT-EXECUTABLE"}});
  }finally{await checks.executor.close().catch(()=>undefined);}
  const row=await db(ctx,identity,async executor=>{
    const inserted=(await executor.query<PublicRow>(INSERT_SQL,[
      crypto.randomUUID(),claims.intentId,claims.anonymousId,target.blueprint_hash,target.title,idempotencyKey
    ])).rows[0];
    if(inserted!==undefined)return inserted;
    const previous=(await executor.query<PublicRow>(RETRY_SQL,[claims.intentId,idempotencyKey])).rows[0];
    return previous??null;
  });
  if(row===null)return unavailable();
  if(!validRow(row)||row.title!==target.title||row.content_hash!==target.blueprint_hash)
    return response(409,{error:{code:"PUBLISHED-APP-IDEMPOTENCY-CONFLICT"}});
  return response(201,{data:{share_id:row.share_id,share_url:`/share/${row.share_id}`,status:"ACTIVE"}});
}
/** All public reads/creates are model-free. Only the owner may invoke F05 publish. */
export async function routePublishedApps(ctx:Context):Promise<Response|undefined>{
  const path=ctx.url.pathname;
  if(path!==PUBLISHED_APPS_ROUTE && path!==CREATE_SHARE_ROUTE && !SHARE_ROUTE.test(path))return undefined;
  try{
    if(path===PUBLISHED_APPS_ROUTE)return await list(ctx);
    if(path===CREATE_SHARE_ROUTE)return await publish(ctx);
    return await resolve(ctx,SHARE_ROUTE.exec(path)?.[1]??"");
  }catch{return unavailable();}
}
