import { describe,expect,it } from "vitest";
import { issueBlueprintAccessGrant } from "../../src/edge/blueprint-access-grant.js";
import { routePublishedApps } from "../../src/edge/published-apps.js";
import type { BlueprintDeliveryComposition } from "../../src/edge/blueprint-delivery.js";
import type { Appf2WorkerEnv } from "../../src/edge/worker-composition.js";
import type { PostgresExecutor } from "../../src/platform/blueprint/postgres-blueprint-repository.js";

const ORIGIN="https://appf2.test";
const HASH="sha256:"+"b".repeat(64),ID="0199f5d0-53e8-7505-adf6-bc4c744fe0c7";
const ANON="0199f5d0-53e8-7505-adf6-bc4c744fe0c8";
const SECRET="a".repeat(64);
const env={APPF2_IDENTITY_COOKIE_SECRET:SECRET} as Appf2WorkerEnv;
function setup(){
 const rows:{share_id:string;title:string;content_hash:string;owner:string;key:string}[]=[];
 const modelCalls=0;
 const dbFactory=()=>{
  const db:PostgresExecutor&{close:()=>Promise<void>}={
   close:async()=>undefined,
   query:async <T>(sql:string,parameters:readonly unknown[])=>{
    const found=sql.includes("INSERT INTO")?(()=>{
      const [share,owner,,hash,title,key]=parameters as string[];
      if(rows.some(row=>row.owner===owner&&row.key===key))return [];
      const item={share_id:share,title,content_hash:hash,owner,key};rows.push(item);return [item];
    })():sql.includes("WHERE source_intent_id=$1")?
      rows.filter(row=>row.owner===parameters[0]&&row.key===parameters[1]):
      sql.includes("WHERE share_id=$1")?
      rows.filter(row=>row.share_id===parameters[0]):
      rows;
    return {rows:found as T[]};
   }
  };
  return db;
 };
 const delivery=():BlueprintDeliveryComposition=>({
   executor:{close:async()=>undefined},
   lineage:{
    verifyLineage:async hash=>({verified:true,content_hash:hash,own_validation_run_id:"valid",registry_digest:"valid",trust_status:"VALIDATED"}),
    readCanonicalBody:async()=>({kind:"NOT_ADMITTED"})
   },
   admission:{admit:async hash=>({executable:true,admission:{content_hash:hash}})} as BlueprintDeliveryComposition["admission"]
 });
 const call=async(path:string,method="GET",body?:object,token?:string,key="retry-key-0001")=>{
  const request=new Request(ORIGIN+path,{
   method,headers:method==="POST"?{
    "Content-Type":"application/json","Origin":ORIGIN,"Sec-Fetch-Site":"same-origin",
    "Idempotency-Key":key,...(token===undefined?{}:{Authorization:"Bearer "+token})
   }:{"Sec-Fetch-Site":"same-origin"},
   ...(body===undefined?{}:{body:JSON.stringify(body)})
  });
  const result=await routePublishedApps({request,url:new URL(request.url),env,nowMs:Date.now(),delivery,dbFactory});
  return {status:result?.status,body:result===undefined?null:await result.json()};
 };
 return {call,rows,modelCalls:()=>modelCalls};
}
describe("SP3.5 F05 publicly published card API contract (scripted, no paid model)",()=>{
 it("denies unsigned known-hash share CREATE and does not publish",async()=>{
  const t=setup();
  const input={source_intent_id:ID,blueprint_hash:HASH,title:"Family Tasks"};
  expect((await t.call("/api/v1/shares","POST",input)).status).toBe(404);
  expect((await t.call("/api/v1/published-apps")).body).toEqual({data:{apps:[]}});
  expect(t.modelCalls()).toBe(0);
 });
 it("signed exact original holder publishes once; live catalog and resolve return a real immutable hash, no AI",async()=>{
  const t=setup();
  const grant=await issueBlueprintAccessGrant({intentId:ID,anonymousId:ANON,contentHash:HASH,keyThumbprint:"x".repeat(43)},SECRET,Date.now());
  const input={source_intent_id:ID,blueprint_hash:HASH,title:"Family Tasks"};
  const made=await t.call("/api/v1/shares","POST",input,grant.token);
  expect(made.status).toBe(201);
  const share=(made.body as {data:{share_id:string}}).data.share_id;
  expect((await t.call("/api/v1/shares/"+share)).status).toBe(200);
  expect((await t.call("/api/v1/published-apps")).body).toMatchObject({data:{apps:[{title:"Family Tasks",content_hash:HASH}]}});
  expect((await t.call("/api/v1/shares","POST",input,grant.token)).status).toBe(201);
  expect(t.rows).toHaveLength(1);
  expect(t.modelCalls()).toBe(0);
  expect((await t.call("/api/v1/shares/00000000-0000-4000-8000-000000000000")).status).toBe(404);
 });
});
