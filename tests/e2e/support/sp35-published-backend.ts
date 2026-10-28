import type { Request as PlaywrightRequest } from "@playwright/test";
import { routeBlueprintDelivery, type BlueprintDeliveryComposition } from "../../../src/edge/blueprint-delivery.js";
import { routePublishedApps } from "../../../src/edge/published-apps.js";
import { createExecutionAdmissionService } from "../../../src/platform/blueprint/execution-admission.js";
import { PostgresPublishedShareRepository, READ_PUBLIC_SHARE_SQL } from "../../../src/platform/blueprint/published-share-repository.js";
import { createBundledReleaseSource } from "../../../src/platform/capabilities/bundled-release.js";
import { BLUEPRINT_SCHEMA_RANGE, RUNTIME_VERSION } from "../../../src/platform/capabilities/registry.js";
import { CORE_CAPABILITY_HANDLERS } from "../../../src/platform/runtime/core-handlers.js";
import type { PostgresExecutor } from "../../../src/platform/blueprint/postgres-blueprint-repository.js";
import { composeBlueprintDelivery } from "../../../src/edge/worker-composition.js";
import { FakeLineageExecutor } from "../../api/s03-worker-backend.js";
import { S03WorkerHost } from "./s03-worker-host.js";

type Share={share_id:string;title:string;content_hash:string;source_intent_id:string;idempotency_key:string;status:"ACTIVE"|"REVOKED"};
type PublicView={share_id:string;title:string;content_hash:string};
function visible(s:Share):PublicView{return {share_id:s.share_id,title:s.title,content_hash:s.content_hash};}

export class PublishedBrowserBackend {
  private readonly shares:Share[]=[];
  public readonly host:S03WorkerHost;
  private constructor(host:S03WorkerHost){this.host=host;}
  public static async create():Promise<PublishedBrowserBackend>{
    const host=await S03WorkerHost.start();
    const item=new PublishedBrowserBackend(host);
    host.setApiOverride(request=>item.route(request));
    return item;
  }
  public revoke(id:string):void{
    const row=this.shares.find(s=>s.share_id===id);
    if(row)row.status="REVOKED";
  }
  public activeShares():readonly PublicView[]{return this.shares.filter(s=>s.status==="ACTIVE").map(visible);}
  public readonly modelCalls=():number=>this.host.backend.modelCalls();
  public readonly apiCalls=():string[]=>this.host.apiCalls();

  /** Same production SQL query texts, fixture-only DB. No Supabase/LLM use in this browser E2E. */
  private executor(shareId?:string):PostgresExecutor&{close():Promise<void>}{
    const query:PostgresExecutor["query"]=async <T>(sql:string,values:readonly unknown[])=>{
      if(sql.includes("INSERT INTO public.appf2_published_app")){
        const [id,source,,hash,title,key]=values as string[];
        if(this.shares.some(s=>s.source_intent_id===source&&s.idempotency_key===key))return {rows:[] as T[]};
        const row:Share={share_id:id,source_intent_id:source,content_hash:hash,title,idempotency_key:key,status:"ACTIVE"};
        this.shares.push(row);
        return {rows:[visible(row)] as T[]};
      }
      if(sql.includes("source_intent_id=$1"))return {rows:this.shares
        .filter(s=>s.source_intent_id===values[0]&&s.idempotency_key===values[1]).map(visible) as T[]};
      if(sql.includes("WHERE share_id=$1"))return {rows:this.shares
        .filter(s=>s.status==="ACTIVE"&&s.share_id===values[0]).map(visible) as T[]};
      if(sql.includes("FROM public.appf2_published_app"))return {rows:this.activeShares() as T[]};
      if(sql===READ_PUBLIC_SHARE_SQL){
        const hash=String(values[1]);
        if(!this.shares.some(s=>s.status==="ACTIVE"&&s.share_id===shareId&&s.content_hash===hash))
          return {rows:[] as T[]};
        const body=this.host.backend.harness.db.blueprint.contents.get(hash);
        if(body===undefined)return {rows:[] as T[]};
        const report=this.host.backend.harness.db.blueprint.runs.get(body.admitted_by_validation_run_id)?.report;
        const digest=typeof report==="object"&&report!==null&&"registry_digest" in report
          ?(report as {registry_digest:unknown}).registry_digest:null;
        return {rows:[{content_hash:hash,canonical_blueprint:body.canonical_blueprint,
          schema_version:body.schema_version,registry_version:body.registry_version,
          trust_status:body.trust_status,admitted_registry_digest:digest}] as T[]};
      }
      throw Error("Unexpected F05 SQL: "+sql.slice(0,90));
    };
    return {query,close:async()=>undefined};
  }
  private publishedComposition(shareId:string):BlueprintDeliveryComposition{
    const executor=this.executor(shareId);
    const content=new PostgresPublishedShareRepository(executor,shareId);
    return {
      executor,
      lineage:{
        verifyLineage:async hash=>{
          const row=await content.readContent(hash);
          return row===undefined
            ?{verified:false as const,content_hash:hash,failure:"CONTENT_UNKNOWN" as const}
            :{verified:true as const,content_hash:hash,own_validation_run_id:shareId,
              registry_digest:row.admitted_registry_digest,trust_status:row.trust_status};
        },
        readCanonicalBody:hash=>content.readCanonicalBody(hash)
      },
      admission:createExecutionAdmissionService({
        content,releases:createBundledReleaseSource({bundledHandlers:CORE_CAPABILITY_HANDLERS}),
        runtimeVersion:RUNTIME_VERSION,supportedBlueprintSchemaRange:BLUEPRINT_SCHEMA_RANGE
      })
    };
  }
  private async route(request:Request):Promise<Response|undefined>{
    const url=new URL(request.url),env=this.host.backend.env,nowMs=Date.now();
    const delivery=(_env:typeof env,context:{anonymousId:string|null;intentId:string|null})=>
      composeBlueprintDelivery(new FakeLineageExecutor(this.host.backend.harness.db,context));
    if(url.pathname.startsWith("/api/v1/shares")||url.pathname==="/api/v1/published-apps")
      return routePublishedApps({request,url,env,nowMs,delivery,dbFactory:()=>this.executor()});
    if(request.headers.has("X-Appf2-Share-Id"))
      return routeBlueprintDelivery({request,url,env,nowMs,factory:delivery,
        publicShareFactory:(_env,id)=>this.publishedComposition(id)});
    return undefined;
  }
}
