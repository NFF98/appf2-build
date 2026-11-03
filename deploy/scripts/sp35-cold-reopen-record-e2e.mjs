/** Genuine Staging browser-process stop/start proof, NOT a page reload.
 * Existing published App only. Generated model posts = ZERO.
 * Private viewer P-256 key remains non-extractable and is never logged.
 */
import {chromium} from "@playwright/test";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {randomUUID} from "node:crypto";
const origin="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
const share="1f19887e-7029-40f1-b445-660cd3aff40f";
const root=await fs.mkdtemp(path.join(os.tmpdir(),"sp35-cold-reopen-"));
const profileA=path.join(root,"viewer-a"),profileB=path.join(root,"viewer-b");
let a=null,b=null,recordA=null,recordB=null,holderA=null,holderB=null;
let coldRestarts=0;
async function newSession(profile){
 return chromium.launchPersistentContext(profile,{headless:true,serviceWorkers:"block"});
}
async function openViewer(context){
 const page=await context.newPage();
 await page.goto(origin+"/code/"+share,{
  waitUntil:"domcontentloaded",timeout:50000});
 const frame=page.frameLocator('iframe[sandbox="allow-scripts"]');
 await frame.getByRole("button",{name:"加一",exact:true})
  .waitFor({state:"visible",timeout:25000});
 const internal=page.frames().find(f=>f!==page.mainFrame()&&
  f.url()==="about:srcdoc");
 if(!internal)throw Error("COLD_NO_OPAQUE_APP_IFRAME");
 await internal.waitForFunction(()=>typeof globalThis.window.appf2Records==="object",
  null,{timeout:12000});
 return {page,internal};
}
async function action(holder,method,...args){
 return holder.internal.evaluate(async ({method,args})=>
  globalThis.window.appf2Records[method](...args),{method,args});
}
async function stopA(){
 await a?.close();a=null;holderA=null;
}
try{
 a=await newSession(profileA);
 holderA=await openViewer(a);
 const initial=await action(holderA,"list");
 if(!Array.isArray(initial.records))throw Error("COLD_INITIAL_LIST_INVALID");
 const unique="SP35 cold-reopen "+randomUUID();
 recordA=await action(holderA,"create",{title:unique,count:1});
 if(!recordA?.record_id||recordA.value?.count!==1)
  throw Error("COLD_CREATE_NOT_SAVED");
 if((await action(holderA,"read",recordA.record_id)).value?.title!==unique)
  throw Error("COLD_READ_AFTER_CREATE_FAILED");
 // Close the browser *process* and restart from its on-disk profile.
 await stopA();
 a=await newSession(profileA);coldRestarts++;
 holderA=await openViewer(a);
 const first=await action(holderA,"read",recordA.record_id);
 if(first?.value?.title!==unique||first?.value?.count!==1)
  throw Error("COLD_RESTART_1_SIGNED_IDENTITY_OR_PG_LOST");
 if(!(await action(holderA,"list")).records.some(x=>
  x.record_id===recordA.record_id))
  throw Error("COLD_RESTART_1_LIST_LOST");
 // A DIFFERENT cold profile must not see A's signed viewer-private data.
 b=await newSession(profileB);
 holderB=await openViewer(b);
 const other=await action(holderB,"list");
 if(other.records.some(x=>x.record_id===recordA.record_id))
  throw Error("COLD_CROSS_VIEWER_LIST_LEAK");
 let denied=false;
 try{await action(holderB,"read",recordA.record_id);}catch{denied=true;}
 if(!denied)throw Error("COLD_CROSS_VIEWER_READ_LEAK");
 recordB=await action(holderB,"create",{title:"other-"+unique,count:2});
 if(!recordB?.record_id)throw Error("COLD_SECOND_VIEWER_CREATE_FAILED");
 if((await action(holderA,"list")).records.some(x=>
  x.record_id===recordB.record_id))
  throw Error("COLD_CROSS_VIEWER_REVERSE_LEAK");
 const updated=await action(holderA,"update",recordA.record_id,
  {title:unique,count:3});
 if(updated?.value?.count!==3)throw Error("COLD_UPDATE_NOT_SAVED");
 await stopA();
 a=await newSession(profileA);coldRestarts++;
 holderA=await openViewer(a);
 const second=await action(holderA,"read",recordA.record_id);
 if(second?.value?.count!==3||second?.value?.title!==unique)
  throw Error("COLD_RESTART_2_UPDATED_DATA_OR_OWNER_LOST");
 const deleted=await action(holderA,"delete",recordA.record_id);
 if(deleted?.record_id!==recordA.record_id)
  throw Error("COLD_DELETE_NOT_SAVED");
 recordA=null;
 const after=await action(holderA,"list");
 if(after.records.some(x=>x.value?.title===unique))
  throw Error("COLD_DELETED_ROW_STILL_VISIBLE");
 await action(holderB,"delete",recordB.record_id);recordB=null;
 console.log("SP35 COLD BROWSER REOPEN REAL STAGING PG: PASS; browser process closed and restarted twice, P-256 viewer identity retained, PG create/read/update/delete/list, 2 viewer isolation, no model POST");
 console.log("SP35 COLD TEST LIMIT: existing published App with injected records API test harness; NOT a GPT-6 new natural language DB App E2E and NOT a first interactive latency sample");
 if(coldRestarts!==2)throw Error("COLD_BROWSER_RESTART_COUNT_INCOMPLETE");
}finally{
 // Cleanup is viewer-authorized only. Never use privileged DB admin writes.
 if(recordA&&holderA)
  await action(holderA,"delete",recordA.record_id).catch(()=>{});
 if(recordB&&holderB)
  await action(holderB,"delete",recordB.record_id).catch(()=>{});
 await a?.close().catch(()=>{});
 await b?.close().catch(()=>{});
 await fs.rm(root,{recursive:true,force:true}).catch(()=>{});
}
