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
type Input={action:"list"|"read"|"create"|"update"|"delete";record_id?:string;
 value?:Record<string,unknown>;expected_value?:Record<string,unknown>};
type Row={record_id:string;value:Record<string,unknown>;created_at?:string;updated_at?:string};
export type CodeAppRecordDeps={db?:(env:Appf2WorkerEnv,thumbprint:string)=>RecordDb};
const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{
 "Content-Type":"application/json; charset=utf-8","Cache-Control":"private, no-store"}});
const denied=()=>reply(404,{error:"CODE_RECORD_NOT_FOUND"});
const conflict=()=>reply(409,{error:"CODE_RECORD_CONFLICT"});
function object(x:unknown):x is Record<string,unknown>{
 return typeof x==="object"&&x!==null&&!Array.isArray(x);
}
function validPayload(value:unknown):boolean{
 if(!object(value))return false;
 try{return new TextEncoder().encode(JSON.stringify(value)).byteLength<=4096;}
 catch{return false;}
}
// eslint-disable-next-line complexity -- Strict per-action JSON shape checks prevent arbitrary column or SQL injection.
export function validCodeRecordInput(x:unknown):x is Input{
 if(!object(x)||typeof x.action!=="string")return false;
 const keys=Object.keys(x).sort().join(",");
 if(x.action==="list")return keys==="action";
 if(!UUID.test(String(x.record_id)))return false;
 if(x.action==="read")return keys==="action,record_id";
 if(x.action==="create")return keys==="action,record_id,value"&&validPayload(x.value);
 if(x.action==="delete")return keys==="action,record_id"||
  keys==="action,expected_value,record_id"&&validPayload(x.expected_value);
 if(x.action!=="update"||!validPayload(x.value))return false;
 if(keys==="action,record_id,value")return true;
 if(keys!=="action,expected_value,record_id,value"||
  !validPayload(x.expected_value))return false;
 return new TextEncoder().encode(JSON.stringify({value:x.value,expected_value:x.expected_value})).byteLength<=4800;
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
const MATCH=`SELECT record_id::text,payload AS value,created_at,updated_at
 FROM public.appf2_code_app_record WHERE share_id=$1::uuid
 AND viewer_key_thumbprint=$2::text AND record_id=$3::uuid
 AND payload=$4::jsonb LIMIT 1`;
const UPDATE=`UPDATE public.appf2_code_app_record SET payload=$4::jsonb,
 updated_at=now() WHERE share_id=$1::uuid
 AND viewer_key_thumbprint=$2::text AND record_id=$3::uuid
 AND ($5::jsonb IS NULL OR payload=$5::jsonb)
 RETURNING record_id::text,payload AS value,created_at,updated_at`;
const DELETE=`DELETE FROM public.appf2_code_app_record WHERE share_id=$1::uuid
 AND viewer_key_thumbprint=$2::text AND record_id=$3::uuid
 AND ($4::jsonb IS NULL OR payload=$4::jsonb)
 RETURNING record_id::text`;
function validRequest(request:Request,url:URL):boolean{
 return request.method==="POST"&&url.search===""&&
  request.headers.get("Origin")===url.origin&&
  [null,"same-origin"].includes(request.headers.get("Sec-Fetch-Site"))&&
  request.headers.get("Content-Type")?.split(";",1)[0]?.trim().toLowerCase()==="application/json";
}
async function parseSignedBody(request:Request,url:URL,nowMs:number):Promise<{
 input:Input;thumbprint:string}|null>{
 const key=request.headers.get("Idempotency-Key");
 if(!key||!KEY.test(key))return null;
 const raw=new Uint8Array(await request.arrayBuffer());
 if(raw.byteLength<10||raw.byteLength>5500)return null;
 let input:unknown;
 try{input=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(raw));}
 catch{return null;}
 if(!validCodeRecordInput(input))return null;
 const proof=await verifyMutationProof({method:"POST",path:url.pathname,
  body:raw,idempotencyKey:key,headers:request.headers},nowMs);
 return proof?{input,thumbprint:proof.keyThumbprint}:null;
}
/** Trusted record operation; route must authenticate a signed viewer key BEFORE entering. */
export async function operateCodeRecord(client:RecordDb,share:string,thumbprint:string,
 data:Input):Promise<Response>{
 const active=(await client.query<{share_id:string}>(ACTIVE,[share])).rows[0];
 if(!active)return denied();
 const id=data.record_id??null;
 const target=[share,thumbprint,id];
 if(data.action==="list"){
  const rows=(await client.query<Row>(LIST,target.slice(0,2))).rows;
  return reply(200,{data:{records:rows}});
 }
 if(data.action==="read"){
  const row=(await client.query<Row>(READ,target)).rows[0];
  return row?reply(200,{data:row}):denied();
 }
 const expected=data.expected_value===undefined?null:JSON.stringify(data.expected_value);
 const value=data.value===undefined?null:JSON.stringify(data.value);
 if(data.action==="create"){
  const created=(await client.query<Row>(CREATE,[...target,value])).rows[0];
  if(created)return reply(201,{data:created});
  // A lost create response is safely recovered without a second insert. The
  // payload must be semantically equal as PostgreSQL JSONB, not JS key-order.
  const replay=(await client.query<Row>(MATCH,[...target,value])).rows[0];
  if(replay)return reply(200,{data:replay});
  const prior=(await client.query<Row>(READ,target)).rows[0];
  return prior?conflict():denied();
 }
 const statement=data.action==="update"?UPDATE:DELETE;
 const args=data.action==="update"?[...target,value,expected]:[...target,expected];
 const row=(await client.query<Row>(statement,args)).rows[0];
 if(row)return reply(200,{data:row});
 if(expected===null)return denied();
 // An exact owner/record-scoped read distinguishes stale values from absent
 // rows without leaking whether another viewer has the same record UUID.
 const prior=(await client.query<Row>(READ,target)).rows[0];
 return prior?conflict():denied();
}
export async function routeCodeAppRecords(ctx:{request:Request;url:URL;
 env:Appf2WorkerEnv;nowMs:number;deps?:CodeAppRecordDeps}):Promise<Response|undefined>{
 const found=ROUTE.exec(ctx.url.pathname);
 if(!found)return undefined;
 if(ctx.env.APPF2_CODE_RECORDS_ENABLED!=="1"||
  !validRequest(ctx.request,ctx.url))return denied();
 const share=found[1]??"";
 if(!UUID.test(share))return denied();
 const signed=await parseSignedBody(ctx.request,ctx.url,ctx.nowMs);
 if(!signed)return denied();
 const client=ctx.deps?.db?.(ctx.env,signed.thumbprint)??
  new WorkerPostgresExecutor(ctx.env.HYPERDRIVE_FRESH,{
   anonymousId:null,intentId:null,codeRecordThumbprint:signed.thumbprint});
 try{return await operateCodeRecord(client,share,signed.thumbprint,signed.input);}
 catch{return reply(503,{error:"CODE_RECORD_DB_UNAVAILABLE"});}
 finally{await client.close().catch(()=>undefined);}
}
