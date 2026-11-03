/** Real Staging Chromium creator entry smoke. GET-only; NEVER spends AI.
 * A live, consentless user must be unable to start paid model generation.
 * This is a website-first-hop proof, NOT an AI-generated App E2E PASS.
 */
import {chromium} from "@playwright/test";
const origin="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({serviceWorkers:"block"});
 let unsafe=0;
 await context.route("**/*",route=>{
  const req=route.request();
  if(req.method()!=="GET"||!req.url().startsWith(origin+"/")){
   unsafe++;
   return route.abort();
  }
  return route.continue();
 });
 const page=await context.newPage();
 await page.goto(origin,{waitUntil:"domcontentloaded",timeout:25000});
 const input=page.locator("#code-builder-prompt");
 await input.waitFor({state:"visible",timeout:15000});
 const button=page.getByRole("button",{name:/一鍵真 AI 生成 App/u});
 await button.waitFor({state:"visible",timeout:10000});
 if(!await button.isDisabled())
  throw Error("SP35_NO_CONSENT_GENERATION_BUTTON_ENABLED");
 const prompt="製作可操作的任務 App，新增、完成及清除任務都要正常運作";
 await input.fill(prompt);
 if(await input.inputValue()!==prompt||!await button.isDisabled())
  throw Error("SP35_NO_CONSENT_POST_FILL_GUARD_FAILED");
 const readiness=await page.request.get(origin+"/api/v1/agent-readiness");
 const data=await readiness.json().catch(()=>null);
 if(readiness.status()!==200||
    data?.data?.execution_mode!=="FREE_CI_READY")
  throw Error("SP35_LIVE_CREATOR_BACKEND_NOT_FREE_CI_READY");
 if(unsafe!==0)throw Error("SP35_UNAUTHORIZED_NETWORK_REQUESTS_"+unsafe);
 console.log("SP35 LIVE STAGING CREATOR UI PASS: Chromium real homepage, "+
  "natural-language input, paid start denied without consent, GET-only, "+
  "readiness FREE_CI_READY, zero AI requests");
 console.log("LIMIT: no paid model, no unknown-code auto-repair, no public release tested");
 await context.close();
}finally{await browser.close();}
