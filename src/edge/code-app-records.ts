/** Sprint 3.5 C1: fixed, owner-key-scoped CRUD for published App records.
 * No generated SQL, no model privileges, and no access to another viewer.
 */
import {verifyMutationProof} from "./create-proof.js";
import {WorkerPostgresExecutor} from "../platform/blueprint/worker-postgres-executor.js";
import type {Appf2WorkerEnv} from "./worker-composition.js";
const ROUTE=/^\/api\/v1\/code-apps\/([0-9a-f-]{36})\/records$/iu;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const KEY=/^[A-Za-z0-9_-]{8,128}$/u;
type RecordDb={query:<T>(sql:string,values:readonly unknown[])=>Promise<{rows:readonly T[]}>;close:()=>Promise<void>};
type Input={action:"list"|"read"|"create"|"update"|"delete";record_id?:string;value?:Record<string,unknown>};
type Row={record_id:string;value:Record<string,unknown>;created_at?:string;updated_at?:string};
export type CodeAppRecordDeps={db?:(env:Appf2WorkerEnv,thumbprint:string)=>RecordDb};
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{
 "Content-Type":"application/json; charset=utf-8","Cache-Control":"private, no-store"}});
const denied=()=>reply(404,{error:"CODE_RECORD_NOT_FOUND"});
function object(x:unknown):x is Record<string,unknown>{
 return typeof x==="object"&&x!==null&&!Array.isArray(x);
}
export function validCodeRecordInput(x:unknown):x is Input{
 if(!object(x)||typeof x.action!=="string")return false;
 const keys=Object.keys(x).sort().join(",");
 if(x.action==="list")return keys==="action";
 if(!UUID.test(String(x.record_id)))return false;
 if(x.action==="read"||x.action==="delete")return keys==="action,record_id";
 if(x.action!=="create"&&x.action!=="update")return false;
 return keys==="action,record_id,value"&&object(x.value)&&
  new TextEncoder().encode(JSON.stringify(x.value)).length<=4096;
}
const ACTIVE="SELECT share_id::text FROM public.appf2_code_app "+
 "WHERE share_id=$1::uuid AND status='ACTIVE' LIMIT 1";
const CREATE=`INSERT INTO public.appf2_code_app_record
 (share_id,viewer_key_thumbprint,record_id,payload)
 SELECT $1::uuid,$2::text,$3::uuid,$4::jsonb
 WHERE (SELECT COUNT(*) FROM public.appf2_code_app_record
  WHERE share_id=$1::uuid AND viewer_key_thumbprint=$2::text)<100
 ON CONFLICT DO NOTHING
 RETURNING record_id::text,payload AS value,created_at,updated_at`;
const LIST=`SELECT record_id::text,payload AS value,created_at,updated_at
 FROM public.appf2_code_app_record WHERE share_id=$1::uuid
 AND viewer_key_thumbprint=$2::text ORDER BY created_at,record_id LIMIT 100`;
const READ=`SELECT record_id::text,payload AS value,created_at,updated_at
 FROM public.appf2_code_app_record WHERE share_id=$1::uuid
 AND viewer_key_thumbprint=$2::text AND record_id=$3::uuid LIMIT 1`;
const UPDATE=`UPDATE public.appf2_code_app_record SET payload=$4::jsonb,
 updated_at=now() WHERE share_id=$1::uuid
 AND viewer_key_thumbprint=$2::text AND record_id=$3::uuid
 RETURNING record_id::text,payload AS value,created_at,updated_at`;
const DELETE=`DELETE FROM public.appf2_code_app_record WHERE share_id=$1::uuid
 AND viewer_key_thumbprint=$2::text AND record_id=$3::uuid
 RETURNING record_id::text`;
export async function routeCodeAppRecords(ctx:{request:Request;url:URL;
 env:Appf2WorkerEnv;nowMs:number;deps?:CodeAppRecordDeps}):Promise<Response|undefined>{
 const found=ROUTE.exec(ctx.url.pathname);
 if(!found)return undefined;
 if(ctx.env.APPF2_CODE_RECORDS_ENABLED!=="1")return denied();
 const {request,url,env}=ctx;
 if(request.method!=="POST"||url.search!==""||
  request.headers.get("Origin")!==url.origin||
  ![null,"same-origin"].includes(request.headers.get("Sec-Fetch-Site"))||
  request.headers.get("Content-Type")?.split(";",1)[0]?.trim().toLowerCase()!=="application/json")
  return denied();
 const key=request.headers.get("Idempotency-Key");
 if(!key||!KEY.test(key))return denied();
 const raw=new Uint8Array(await request.arrayBuffer());
 if(raw.byteLength<10||raw.byteLength>5500)return reply(413,{error:"CODE_RECORD_BODY_LIMIT"});
 let data:unknown;
 try{data=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));}
 catch{return reply(400,{error:"CODE_RECORD_INVALID_BODY"});}
 if(!validCodeRecordInput(data))return reply(400,{error:"CODE_RECORD_INVALID_BODY"});
 const proof=await verifyMutationProof({method:"POST",path:url.pathname,
  body:raw,idempotencyKey:key,headers:request.headers},ctx.nowMs);
 if(!proof)return denied();
 const share=found[1]??"";
 if(!UUID.test(share))return denied();
 const client=ctx.deps?.db?.(env,proof.keyThumbprint)??
  new WorkerPostgresExecutor(env.HYPERDRIVE_FRESH,{
   anonymousId:null,intentId:null,codeRecordThumbprint:proof.keyThumbprint});
 try{
  const exists=(await client.query<{share_id:string}>(ACTIVE,[share])).rows[0];
  if(!exists)return denied();
  const args=[share,proof.keyThumbprint,data.record_id??null,
   data.value===undefined?null:JSON.stringify(data.value)];
  if(data.action==="list"){
   const rows=(await client.query<Row>(LIST,args.slice(0,2))).rows;
   return reply(200,{data:{records:rows}});
  }
  const statement=data.action==="read"?READ:data.action==="create"?CREATE:
   data.action==="update"?UPDATE:DELETE;
  const values=data.action==="create"||data.action==="update"?args:args.slice(0,3);
  const row=(await client.query<Row>(statement,values)).rows[0];
  return row?reply(data.action==="create"?201:200,{data:row}):denied();
 }catch{return reply(503,{error:"CODE_RECORD_DB_UNAVAILABLE"});}
 finally{await client.close().catch(()=>undefined);}
}
