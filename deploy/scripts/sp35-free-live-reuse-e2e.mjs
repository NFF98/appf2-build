/**
 * FREE ONLY: REAL Staging legacy Code App reuse in two Chromium sessions.
 * GET-only traffic. No provider, no create, no DB write, no paid containers.
 * This proves an existing published App still works, NOT new Agent five-core E2E.
 */
import {chromium} from "@playwright/test";
const origin="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
const preferred="32205d58-b07f-4e8d-9d0c-4881178b02d4";
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const browser=await chromium.launch({headless:true});
let forbidden=0;
try{
 const request=await fetch(origin+"/api/v1/code-apps-public",{
  method:"GET",signal:AbortSignal.timeout(10000)});
 if(!request.ok)throw Error("FREE_CARD_CATALOG_HTTP_"+request.status);
 const data=await request.json();
 const apps=data?.data?.apps;
 if(!Array.isArray(apps))throw Error("FREE_CARD_CATALOG_INVALID");
 const chosen=apps.find(x=>x.share_id===preferred)||
  apps.find(x=>uuid.test(x?.share_id??"")&&/計數器/u.test(x?.title??""));
 if(!chosen||!uuid.test(chosen.share_id))
  throw Error("FREE_STAGING_INTERACTIVE_COUNTER_NOT_FOUND");
 const address=origin+"/code/"+chosen.share_id;
 const fresh=async()=>{
  const context=await browser.newContext({serviceWorkers:"block",
   acceptDownloads:false});
  await context.route("**/*",route=>{
   const req=route.request(),method=req.method(),url=req.url();
   if(method!=="GET"){
    forbidden++;
    return route.abort();
   }
   if(!url.startsWith(origin+"/"))return route.abort();
   return route.continue();
  });
  const page=await context.newPage();
  await page.goto(address,{waitUntil:"domcontentloaded",timeout:15000});
  const frame=page.frameLocator('iframe[sandbox="allow-scripts"]');
  await frame.locator("button").first().waitFor({state:"visible",timeout:15000});
  const before=await frame.locator("body").innerText();
  await frame.locator("button").first().click();
  const after=await frame.locator("body").innerText();
  if(before===after)throw Error("FREE_STAGING_APP_NOT_INTERACTIVE");
  return {context,page,frame};
 };
 const first=await fresh();
 await first.page.reload({waitUntil:"domcontentloaded"});
 await first.frame.locator("button").first().waitFor({state:"visible",timeout:15000});
 await first.context.close();
 const second=await fresh();
 await second.context.close();
 if(forbidden>0)throw Error("FREE_REUSE_ATTEMPTED_MUTATION:"+forbidden);
 console.log("SP35 FREE LIVE STAGING LEGACY CODE CARD PASS: "+
  "2 FRESH CHROMIUM CONTEXTS, CLICK+RELOAD, NO MODEL/DB WRITE, ID="+chosen.share_id);
 console.log("LIMIT: legacy Code Builder only; new multi-file Agent full E2E NOT VERIFIED");
}finally{await browser.close();}
