// REAL browser journey against isolated staging: Discover -> Create -> Generated App -> Home.
// One bounded paid model run; no mocks, no use of production, no key/response-body logging.
import { chromium } from "@playwright/test";
import path from "node:path";

const origin=new URL(process.env.APPF2_STAGING_URL?.trim()||"");
if(origin.protocol!=="https:" ||
   !/^appf2-sp35-417-staging\.[a-z0-9-]+\.workers\.dev$/i.test(origin.hostname) ||
   origin.pathname!=="/" || origin.search || origin.hash){
  throw Error("STAGING BROWSER: isolated workers.dev HTTPS target required");
}
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1365,height:900}});
const page=await context.newPage();
const screenshot=path.join(process.env.RUNNER_TEMP||"/tmp","appf2-sp35-browser.png");
try {
  await page.goto(origin.origin,{waitUntil:"domcontentloaded",timeout:40_000});
  const input=page.locator("#composer-input");
  await input.waitFor({state:"visible",timeout:15_000});
  console.log("STAGING BROWSER: REAL Discover React UI rendered");
  await input.fill("Create a read-only one-screen welcome app titled Hello World. Show the text Hello World. No user input, payments, accounts, or external services.");
  await page.locator(".composer-create").click();
  console.log("STAGING BROWSER: clicked actual Create App button");
  await page.locator(".s03-app").waitFor({state:"visible",timeout:210_000});
  const content=await page.locator(".s03-app").textContent();
  const hasText=Boolean(content?.includes("Hello World"));
  console.log("STAGING BROWSER: generated S03 app mounted; EXPECTED_HELLO_TEXT="+hasText);
  if(!hasText)throw Error("STAGING BROWSER: Generated App visible but requested text not rendered");
  await page.screenshot({path:screenshot,fullPage:true});
  await page.getByRole("button",{name:"更多選項"}).click();
  await page.getByRole("menuitem",{name:"回到首頁 / 建立新的 App"}).click();
  await input.waitFor({state:"visible",timeout:15_000});
  console.log("STAGING BROWSER: runtime app + home navigation PASS; screenshot saved");
} catch(error) {
  await page.screenshot({path:screenshot,fullPage:true}).catch(()=>{});
  throw Error("STAGING BROWSER: real user journey FAILED ("+String(error?.name||"unknown")+
    "); review browser screenshot and step evidence",{cause:error});
} finally {
  await browser.close();
}
