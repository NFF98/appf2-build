/* eslint max-lines-per-function: off -- one real browser paid generation then durable no-AI reuse. */
import {chromium} from "@playwright/test";
const endpoint=process.env.APPF2_STAGING_URL?.trim();
if(!endpoint||!/^https:\/\/appf2-sp35-417-staging\.[a-z0-9-]+\.workers\.dev$/iu.test(endpoint))throw Error("CODE_BUILDER_STAGING_ONLY");
const origin=new URL(endpoint).origin;
const browser=await chromium.launch({headless:true});
const prompt="建立一個可用的計數器 App，顯示標題「測試計數器」、起始數字 0 和「增加」按鈕。按一次數字變 1，按兩次變 2。用完整、可互動、無外部網路或套件的 JavaScript 製作。";
let charged=0;
try{
 const ctx=await browser.newContext();
 ctx.on("request",req=>{if(req.method()==="POST"&&new URL(req.url()).pathname==="/api/v1/code-apps")charged++;});
 const page=await ctx.newPage();
 await page.goto(origin,{waitUntil:"domcontentloaded"});
 // The default product is the multi-file P-256 Agent; legacy single-file
 // Code Builder remains a separate *closed* compatibility accordion.
 await page.getByRole("textbox",{name:"用一句話描述要做的 App"}).waitFor({state:"visible",timeout:12000});
 if(await page.locator("#composer-input").isVisible())
  throw Error("LEGACY_F01_COMPOSER_STILL_DEFAULT");
 const legacy=page.locator("details.legacy-composer").filter({hasText:"舊版單檔 Code Builder"});
 if(await legacy.count()!==1)throw Error("LEGACY_CODE_BUILDER_COMPAT_ENTRY_NOT_UNIQUE");
 await legacy.locator("summary").click();
 await page.getByRole("textbox",{name:"描述你想做的 App"}).waitFor({state:"visible",timeout:12000});
 const api=await page.request.get(origin+"/api/v1/code-apps-public");
 if(api.status()!==200)throw Error("CODE_APP_CATALOG_HTTP_"+api.status());
 const list=await api.json();
 let entry=list?.data?.apps?.find(a=>a.title?.includes("測試計數器"));
 if(!entry){
  // This staging-only regression runs on ordinary deploys. Creating missing
  // artifacts would charge a model WITHOUT the new aggregate $1 consent guard.
  // Fail visibly; only the explicitly authorized paid E2E may create new Jobs.
  if(process.env.APPF2_SP35_LEGACY_PAID_ONCE!=="1")
   throw Error("NO_REUSABLE_LEGACY_CODE_APP_NO_NEW_AI_SPEND");
  const box=page.getByRole("textbox",{name:"描述你想做的 App"});
  await box.fill(prompt);
  await page.getByLabel(/我同意產生一次付費 AI 請求/).check();
  await page.getByRole("button",{name:"生成 Blueprint v2 App"}).click();
  await page.waitForURL(/\/code\/[0-9a-f-]{36}$/iu,{timeout:75000});
  const id=page.url().split("/").at(-1);
  const created=await page.request.get(origin+"/api/v1/code-apps/"+id);
  if(created.status()!==200)throw Error("CODE_APP_NOT_DURABLY_SAVED");
  const record=await created.json();
  entry={share_id:id,title:record.data.title};
 }
 const direct=origin+"/code/"+entry.share_id;
 await page.goto(direct,{waitUntil:"domcontentloaded"});
 const frame=page.frameLocator('iframe[sandbox="allow-scripts"]');
 await frame.locator("button").first().waitFor({state:"visible",timeout:15000});
 const count=frame.locator("#app").first();
 const before=await count.innerText();
 await frame.locator("button").first().click();
 const after=await count.innerText();
 if(before===after)throw Error("CODE_APP_CLICK_NO_VISIBLE_CHANGE");
 const fresh=await browser.newContext();
 const visitor=await fresh.newPage();
 await visitor.goto(direct,{waitUntil:"domcontentloaded"});
 const visitorFrame=visitor.frameLocator('iframe[sandbox="allow-scripts"]');
 await visitorFrame.locator("button").first().waitFor({state:"visible",timeout:15000});
 const freshBefore=await visitorFrame.locator("#app").innerText();
 await visitorFrame.locator("button").first().click();
 const freshAfter=await visitorFrame.locator("#app").innerText();
 if(freshBefore===freshAfter)throw Error("CODE_APP_NOT_INTERACTIVE_OTHER_BROWSER");
 await visitor.reload();
 await visitorFrame.locator("button").first().waitFor({state:"visible",timeout:15000});
 if(charged>1)throw Error("CODE_BUILDER_DUPLICATE_PAID_REQUEST");
 console.log("CODE BUILDER REAL STAGING PASS: live AI="+(charged===1?"ONE_CALL":"EXISTING_ARTIFACT")+
  ", durable Blueprint v2="+entry.share_id+", two fresh browsers interactive, reload verified, generation-on-reuse=0");
 await fresh.close();await ctx.close();
}finally{await browser.close();}
