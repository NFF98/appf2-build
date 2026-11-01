/** C1 real staging: already GPT-6-created public App sandbox ->
 * fixed bridge -> P-256-signed Worker -> PostgreSQL CRUD, two viewer profiles.
 * NO model calls, NO Cloudflare paid Containers, clean up temporary rows.
 * Uses a browser-injected test harness because the historical counter App
 * was authored without persistent storage. Do not claim model-written CRUD.
 */
import {chromium} from "@playwright/test";
const origin="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
const share="1f19887e-7029-40f1-b445-660cd3aff40f";
const browser=await chromium.launch({headless:true});
let first,second,createdA,createdB;
async function view(context){
 const page=await context.newPage();
 await page.goto(origin+"/code/"+share,{waitUntil:"domcontentloaded",timeout:30000});
 const frame=page.frameLocator('iframe[sandbox="allow-scripts"]');
 await frame.getByRole("button",{name:"加一",exact:true})
  .waitFor({state:"visible",timeout:20000});
 const internal=page.frames().find(f=>f!==page.mainFrame()&&f.url()==="about:srcdoc");
 if(!internal)throw Error("C1_NO_OPAQUE_APP_IFRAME");
 await internal.waitForFunction(()=>typeof window.appf2Records==="object",null,{timeout:10000});
 return {page,internal};
}
async function action(view,method,...args){
 return view.internal.evaluate(async ({method,args})=>{
  const api=window.appf2Records;
  return api[method](...args);
 },{method,args});
}
try{
 first=await browser.newContext({serviceWorkers:"block"});
 second=await browser.newContext({serviceWorkers:"block"});
 const a=await view(first);
 const b=await view(second);
 const beforeA=await action(a,"list");
 const beforeB=await action(b,"list");
 if(!Array.isArray(beforeA.records)||!Array.isArray(beforeB.records))
  throw Error("C1_LIST_SCHEMA_INVALID");
 createdA=await action(a,"create",{title:"C1 proof",count:1});
 if(createdA?.value?.count!==1||!createdA.record_id)
  throw Error("C1_CREATE_NOT_SAVED");
 const readA=await action(a,"read",createdA.record_id);
 if(readA?.value?.count!==1)throw Error("C1_READ_NOT_PERSISTED");
 const bList=await action(b,"list");
 if(bList.records.some(x=>x.record_id===createdA.record_id))
  throw Error("C1_CROSS_VIEWER_LIST_LEAK");
 let denied=false;
 try{await action(b,"read",createdA.record_id);}catch{denied=true;}
 if(!denied)throw Error("C1_CROSS_VIEWER_READ_LEAK");
 createdB=await action(b,"create",{title:"C1 separate viewer",count:8});
 if(!createdB?.record_id||createdB.record_id===createdA.record_id)
  throw Error("C1_SECOND_VIEWER_CREATE_FAILED");
 const aList=await action(a,"list");
 if(aList.records.some(x=>x.record_id===createdB.record_id))
  throw Error("C1_CROSS_VIEWER_REVERSE_LEAK");
 await a.page.close();
 const reopened=await view(first);
 const saved=await action(reopened,"read",createdA.record_id);
 if(saved?.value?.count!==1)throw Error("C1_BROWSER_REOPEN_LOST_DATA");
 const updated=await action(reopened,"update",createdA.record_id,
  {title:"C1 proof updated",count:2});
 if(updated?.value?.count!==2)throw Error("C1_UPDATE_FAILED");
 const verified=await action(reopened,"read",createdA.record_id);
 if(verified?.value?.count!==2)throw Error("C1_UPDATED_READ_FAILED");
 const deleted=await action(reopened,"delete",createdA.record_id);
 if(deleted?.record_id!==createdA.record_id)throw Error("C1_DELETE_FAILED");
 createdA=null;
 const after=await action(reopened,"list");
 if(after.records.some(x=>x.record_id===saved.record_id))
  throw Error("C1_DELETED_RECORD_VISIBLE");
 await action(b,"delete",createdB.record_id);
 createdB=null;
 console.log("SP35 C1 REAL GENERATED-CARD SANDBOX BRIDGE -> WORKER -> PG: "+
  "CREATE READ UPDATE DELETE LIST, BROWSER REOPEN, 2 VIEWER RLS ISOLATION PASS");
 console.log("LIMIT: historical GPT-6 counter has a browser-injected CRUD harness; "+
  "new AI-authored persistent CRUD UI remains separately unproven");
}finally{
 // No fake PASS if cleanup fails; leave no expensive background work.
 await first?.close().catch(()=>{});
 await second?.close().catch(()=>{});
 await browser.close();
}
