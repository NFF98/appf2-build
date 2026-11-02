import {describe,it,expect} from "vitest";
import {validCodeRecordInput,operateCodeRecord} from "../../src/edge/code-app-records.js";
const share="6bd142ea-98fb-47d7-becb-a4af16f52e77";
const id="fa15390b-c625-4cbf-a6ea-9be581d84a07";
const owner="owner-p256-thumbprint-aaa";
const visitor="visitor-p256-thumbprint-bbb";
const body=async(r:Response)=>r.json() as Promise<{error?:string;data?:{value?:unknown;records?:unknown[]}}>;
type Entry={record_id:string;value:Record<string,unknown>;created_at:string;updated_at:string};
const canonical=(value:unknown):string=>JSON.stringify(value,(_,v:unknown)=>
 v&&typeof v==="object"&&!Array.isArray(v)?
 Object.fromEntries(Object.entries(v as Record<string,unknown>).sort()):v);
class MockScopedRecordSql{
 readonly rows=new Map<string,Entry>();
 readonly statements:string[]=[];
 readonly key=(thumb:string,record:string)=>thumb+":"+record;
 private selectRows<T>(sql:string,thumb:string,record:string,raw:string,existing:Entry|undefined)
  :{rows:readonly T[]}{
  if(sql.includes("ORDER BY"))
   return {rows:[...this.rows.entries()].filter(([k])=>k.startsWith(thumb+":"))
    .map(([,v])=>v) as T[]};
  const matches=existing&&(!sql.includes("payload=$4::jsonb")||
   canonical(existing.value)===canonical(JSON.parse(raw)));
  return {rows:(matches?[existing]:[]) as T[]};
 }
 private insertRow<T>(thumb:string,record:string,raw:string,existing:Entry|undefined)
  :{rows:readonly T[]}{
  if(existing)return {rows:[]};
  const row:Entry={record_id:record,value:JSON.parse(raw),created_at:"2026-11-03",updated_at:"2026-11-03"};
  this.rows.set(this.key(thumb,record),row);
  return {rows:[row] as T[]};
 }
 private updateRow<T>(thumb:string,record:string,raw:string,expectedRaw:string,existing:Entry|undefined)
  :{rows:readonly T[]}{
  if(!existing||expectedRaw!=="null"&&canonical(existing.value)!==canonical(JSON.parse(expectedRaw)))
   return {rows:[]};
  const next={...existing,value:JSON.parse(raw),updated_at:"2026-11-04"};
  this.rows.set(this.key(thumb,record),next);
  return {rows:[next] as T[]};
 }
 private deleteRow<T>(thumb:string,record:string,raw:string,existing:Entry|undefined)
  :{rows:readonly T[]}{
  if(!existing||raw!=="null"&&canonical(existing.value)!==canonical(JSON.parse(raw)))
   return {rows:[]};
  this.rows.delete(this.key(thumb,record));
  return {rows:[{record_id:record}] as T[]};
 }
 async query<T>(sql:string,args:readonly unknown[]):Promise<{rows:readonly T[]}>{
  this.statements.push(sql);
  const [requestedShare,thumb,record,raw,expectedRaw]=args.map(String);
  if(sql.startsWith("SELECT share_id::text"))
   return {rows:(requestedShare===share?[{share_id:share}]:[]) as T[]};
  const existing=this.rows.get(this.key(thumb,record));
  if(sql.startsWith("SELECT record_id::text"))
   return this.selectRows<T>(sql,thumb,record,raw,existing);
  if(sql.startsWith("INSERT INTO public.appf2_code_app_record"))
   return this.insertRow<T>(thumb,record,raw,existing);
  if(sql.startsWith("UPDATE public.appf2_code_app_record"))
   return this.updateRow<T>(thumb,record,raw,expectedRaw,existing);
  if(sql.startsWith("DELETE FROM public.appf2_code_app_record"))
   return this.deleteRow<T>(thumb,record,raw,existing);
  throw Error("UNKNOWN_SQL_IN_MOCK");
 }
 close=async()=>undefined;
}

describe("Sprint 3.5 generic backend CRUD reliability — SQL-shaped integration (no cloud)",()=>{
 it("requires exact bounded signed-body shape for optional CAS",()=>{
  expect(validCodeRecordInput({action:"update",record_id:id,value:{v:2},expected_value:{v:1}})).toBe(true);
  expect(validCodeRecordInput({action:"delete",record_id:id,expected_value:{v:1}})).toBe(true);
  expect(validCodeRecordInput({action:"create",record_id:id,value:{v:1}})).toBe(true);
  for(const bad of [
   {action:"create",record_id:id,value:{v:1},expected_value:{v:1}},
   {action:"update",record_id:id,value:{v:2},expected_value:{v:1},sql:"DROP TABLE"},
   {action:"delete",record_id:id,expected_value:"v1"},
   {action:"update",record_id:id,value:{v:2},expected_value:{secret:"x".repeat(4900)}},
   {action:"update",record_id:id,value:{v:2},expected_value:{v:1},url:"https://example.com"}
  ])expect(validCodeRecordInput(bad)).toBe(false);
 });
 it("replays identical create but conflicts on reused UUID with different payload",async()=>{
  const db=new MockScopedRecordSql();
  const call=(value:Record<string,unknown>)=>operateCodeRecord(db,share,owner,{action:"create",record_id:id,value});
  expect((await call({v:1,kind:"notes"})).status).toBe(201);
  expect((await call({kind:"notes",v:1})).status).toBe(200);
  const rejected=await call({kind:"notes",v:9});
  expect(rejected.status).toBe(409);
  expect((await body(rejected)).error).toBe("CODE_RECORD_CONFLICT");
  expect(db.rows.size).toBe(1);
  expect(db.statements.some(sql=>sql.includes("payload=$4::jsonb"))).toBe(true);
 });
 it("atomically prevents stale tab update and delete; foreign viewer is still 404",async()=>{
  const db=new MockScopedRecordSql();
  const query=(thumb:string,action:"read"|"create"|"update"|"delete",value?:Record<string,unknown>,expected_value?:Record<string,unknown>)=>
   operateCodeRecord(db,share,thumb,{action,record_id:id,value,expected_value});
  expect((await query(owner,"create",{count:1})).status).toBe(201);
  const firstRead=await body(await query(owner,"read"));
  expect(firstRead.data?.value).toEqual({count:1});
  const oldValue={count:1},winner={count:2},loser={count:3};
  expect((await query(owner,"update",winner,oldValue)).status).toBe(200);
  const stale=await query(owner,"update",loser,oldValue);
  expect(stale.status).toBe(409);
  expect((await body(stale)).error).toBe("CODE_RECORD_CONFLICT");
  expect((await body(await query(owner,"read"))).data?.value).toEqual(winner);
  expect((await query(owner,"delete",undefined,oldValue)).status).toBe(409);
  expect((await query(visitor,"read")).status).toBe(404);
  expect((await query(visitor,"update",loser,oldValue)).status).toBe(404);
  expect((await query(visitor,"delete",undefined,winner)).status).toBe(404);
  expect((await query(owner,"delete",undefined,winner)).status).toBe(200);
  expect((await query(owner,"read")).status).toBe(404);
  expect(db.rows.size).toBe(0);
  expect(db.statements.some(sql=>sql.includes("AND ($5::jsonb IS NULL OR payload=$5::jsonb)"))).toBe(true);
  expect(db.statements.some(sql=>sql.includes("AND ($4::jsonb IS NULL OR payload=$4::jsonb)"))).toBe(true);
 });
});
