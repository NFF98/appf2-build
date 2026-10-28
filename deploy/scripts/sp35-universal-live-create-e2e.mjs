/* eslint max-depth: off -- bounded no-cost connection retries are nested in two sample cases. */
/* One explicitly bounded, user-authorized real E2E across TWO different new App categories.
 * Only runs on [SP35-QA-ONCE] commit; not a periodic paid model test.
 */
import {chromium} from "@playwright/test";
const origin=new URL(process.env.APPF2_STAGING_URL??"https://appf2-sp35-417-staging.juiyuang69.workers.dev").origin;
if(!/^https:\/\/appf2-sp35-417-staging\.[a-z0-9-]+\.workers\.dev$/u.test(origin))throw Error("QA_STAGING_ONLY");
const samples=[
 {kind:"counter",prompt:"請建立一個完全可操作的星空計數器 App，有標題「星空計數器」、起始數字 0、「加一」按鈕和「歸零」按鈕。每按一次加一，數字真的增加一；歸零要回到 0。介面清楚適合手機。"},
 {kind:"notes",prompt:"請建立一個可操作的任務便條 App，有文字輸入框、「新增任務」按鈕和任務清單。輸入「買牛奶」後按新增，清單要出現「買牛奶」；每一個任務可以按「完成」切換完成狀態。"}
];
const browser=await chromium.launch({headless:true});const outcomes=[];
try{
 for(const sample of samples){
  const ctx=await browser.newContext(),page=await ctx.newPage();
  let calls=0;
  page.on("request",r=>{if(r.method()==="POST"&&new URL(r.url()).pathname==="/api/v1/code-apps")calls++;});
  // The staging hostname can intermittently hang during Chromium navigation;
  // retry only the NO-AI homepage read, never the paid POST.
  let ready=false;
  for(let probe=0;probe<2&&!ready;probe++){
   try{
    await page.goto(origin,{waitUntil:"domcontentloaded",timeout:55000});
    await page.getByRole("textbox",{name:"描述你想做的 App"}).waitFor({state:"visible",timeout:12000});
    ready=true;
   }catch(e){
    if(probe===1)throw Error("STAGING_HOMEPAGE_UNREACHABLE_NO_AI_CHARGED",{cause:e});
   }
  }
  const textarea=page.getByRole("textbox",{name:"描述你想做的 App"});
  await textarea.fill(sample.prompt);
  await page.getByLabel(/我同意 AI 先規劃驗收條件/).check();
  // No auto repair: exactly one requirements plan and one generation completion.
  await page.getByRole("button",{name:"生成 Blueprint v2 App"}).click();
  let generated=false,reason="";
  try{
   await Promise.race([
    page.waitForURL(/\/code\/[0-9a-f-]{36}$/iu,{timeout:165000}).then(()=>{generated=true;}),
    page.getByRole("alert").waitFor({state:"visible",timeout:165000})
      .then(async()=>{reason=(await page.getByRole("alert").innerText()).slice(0,160);})
   ]);
  }catch(e){reason="TIMEOUT_OR_BROWSER_FAIL:"+String(e).slice(0,80);}
  if(calls!==1)throw Error("UNEXPECTED_CODE_CREATE_COUNT:"+calls);
  if(!generated){outcomes.push({kind:sample.kind,status:"FAIL_CLOSED",detail:reason});await ctx.close();continue;}
  const id=page.url().split("/").at(-1);
  const response=await page.request.get(origin+"/api/v1/code-apps/"+id);
  if(!response.ok)throw Error("NEW_QUALITY_APP_NOT_SERVED_"+sample.kind);
  const record=(await response.json())?.data;
  if(record?.share_id!==id||typeof record.blueprint_hash!=="string"||
     record.artifact?.envelope?.execution?.kind!=="CODE_ARTIFACT")
   throw Error("NEW_QUALITY_APP_NOT_PERSISTED_"+sample.kind);
  const frame=page.frameLocator('iframe[sandbox="allow-scripts"]');
  await frame.locator("#app").waitFor({state:"visible",timeout:10000});
  if(await frame.locator("button").count()===0)throw Error("NO_INTERACTIVE_APP_"+sample.kind);
  outcomes.push({kind:sample.kind,status:"VERIFIED_AND_PUBLIC",id,hash:record.blueprint_hash});
  await ctx.close();
 }
 console.log("GENERIC_ONLINE_QA_2_CATEGORIES: "+JSON.stringify(outcomes));
 if(outcomes.some(x=>x.status!=="VERIFIED_AND_PUBLIC"))
  throw Error("GENERIC_QUALITY_PIPELINE_NOT_READY");
}finally{await browser.close();}
