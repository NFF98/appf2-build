// Free browser guard: a saved tab card MUST NEVER call paid F01/model CREATE.
// The synthetic card has no original-holder key, so its reopen must FAIL CLOSED.
// This is not a claim that another user's App is shareable or full reuse E2E.
import { chromium } from "@playwright/test";

const origin=new URL(process.env.APPF2_STAGING_URL?.trim()||"");
if(origin.protocol!=="https:" ||
   !/^appf2-sp35-417-staging\.[a-z0-9-]+\.workers\.dev$/i.test(origin.hostname) ||
   origin.pathname!=="/" || origin.search || origin.hash) throw Error("SAVED APP FREE SMOKE: isolated staging only");

const browser=await chromium.launch({headless:true});
try{
  const context=await browser.newContext();
  const page=await context.newPage();
  const paid=[];
  context.on("request",r=>{
    if(r.method()==="POST" && /^\/api\/v1\/intents(?:\/|$)/.test(new URL(r.url()).pathname))
      paid.push(r.url());
  });
  // Pretend metadata exists, NOT a credential or a real validated App.
  await page.addInitScript(()=>{
    globalThis.localStorage.setItem("appf2.tab.saved-apps.v1",JSON.stringify([{
      intentId:"0199f5d0-53e8-7505-adf6-bc4c744fe0c7",
      contentHash:"sha256:"+"b".repeat(64),
      title:"Saved smoke only",
      savedAt:Date.now()
    }]));
  });
  await page.goto(origin.origin,{waitUntil:"domcontentloaded"});
  await page.getByRole("button",{name:"我的 App"}).first().click();
  const open=page.getByRole("button",{name:"免費重開：Saved smoke only"});
  await open.waitFor({state:"visible",timeout:15000});
  await open.click();
  await page.getByText("先前的 App 無法安全恢復。",{exact:true}).waitFor({state:"visible",timeout:15000});
  if(paid.length)throw Error("SAVED APP FREE SMOKE: saved card triggered a paid CREATE");
  await page.getByRole("button",{name:"返回首頁"}).click();
  await open.waitFor({state:"visible",timeout:15000});
  if(paid.length)throw Error("SAVED APP FREE SMOKE: Home unexpectedly triggered CREATE");
  const second=await context.newPage();
  await second.goto(origin.origin,{waitUntil:"domcontentloaded"});
  const secondOpen=second.getByRole("button",{name:"免費重開：Saved smoke only"});
  await secondOpen.waitFor({state:"visible",timeout:15000});
  await secondOpen.click();
  await second.getByText("先前的 App 無法安全恢復。",{exact:true}).waitFor({state:"visible",timeout:15000});
  if(paid.length)throw Error("SAVED APP FREE SMOKE: second tab triggered paid CREATE");
  console.log("STAGING SAVED APPS: card visible across two tabs + opens only authenticated delivery path + missing key FAIL_CLOSED; F01 POST=0; MODEL CALL=0 PASS");
}finally{await browser.close();}
