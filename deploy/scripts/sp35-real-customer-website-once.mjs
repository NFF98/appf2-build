/** One real signed, owner-initiated customer WEBSITE E2E, Staging only.
 * At most one website click authorizes pre-code QA (8c), CODE (20c),
 * and optionally one proven browser-failure REPAIR (16c).
 * No test-owned model calls, no Cloudflare paid containers, no retries.
 * Abort safely if the real customer product cannot finish and publish.
 */
import {chromium} from "@playwright/test";
const origin="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
const prompt="請製作一個可操作的計數器 App，有一個「加一」按鈕。畫面起初顯示「計數：0」，點按「加一」後必須顯示「計數：1」，每次按按鈕都會增加一。";
const urlRule=/^\/code\/[0-9a-f]{8}-[0-9a-f-]{27}$/iu;
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({serviceWorkers:"block"});
const page=await context.newPage();
const mutations=[];
page.on("request",request=>{
 if(request.method()!=="GET"&&request.url().startsWith(origin+"/api/"))
  mutations.push(new URL(request.url()).pathname);
});
async function failReason(){
 const error=await page.getByRole("alert").allTextContents().catch(()=>[]);
 const status=await page.getByRole("status").allTextContents().catch(()=>[]);
 return JSON.stringify({error:error.map(s=>s.slice(0,200)),
  status:status.map(s=>s.slice(0,180)),mutations:mutations.slice(-20)});
}
try{
 const ready=await page.request.get(origin+"/api/v1/agent-readiness",{timeout:20000});
 const check=await ready.json().catch(()=>null);
 if(ready.status()!==200||check?.data?.execution_mode!=="FREE_CI_READY"||
   check?.data?.free_ci_paid_ai_available!==true)
  throw Error("STAGING_PAID_FREE_CI_NOT_ENABLED_NO_CHARGE");
 await page.goto(origin,{waitUntil:"domcontentloaded",timeout:35000});
 const creator=page.locator("#code-builder-prompt");
 await creator.waitFor({state:"visible",timeout:20000});
 await creator.fill(prompt);
 const oneClick=page.getByRole("button",{name:/一鍵真 AI 生成 App/u});
 if(!await oneClick.isDisabled())
  throw Error("LIVE_PAID_CREATOR_WITHOUT_CONSENT_NOT_BLOCKED");
 await page.getByLabel(/我同意付費 AI/u).check();
 await page.getByLabel(/我同意僅用 GitHub Actions 免費 Docker 建置/u).check();
 await page.getByLabel(/我另行核准免費 Chromium 做獨立 Browser QA/u).check();
 await page.getByLabel(/我核准將目前已保存的專案送到既有 GitHub Actions/u).check();
 await page.getByLabel(/我授權真實 Browser QA 出現 FAIL/u).check();
 await page.locator("#agent-max-cost").fill("44");
 if(!await oneClick.isEnabled())throw Error("LIVE_PAID_CREATOR_CONSENT_NOT_READY");
 let clicks=0;
 await oneClick.click();
 clicks++;
 if(clicks!==1)throw Error("NO_MULTIPLE_PAID_CLICKS");
 console.log("SP35 LIVE WEBSITE: signed one-click generation started, max approved job cap 44 cents");
 const good=page.getByText("原需求全部 Browser QA PASS",{exact:false});
 const terminal=page.getByRole("alert").first();
 const outcome=await Promise.race([
  good.waitFor({state:"visible",timeout:17*60*1000}).then(()=>"PASS"),
  terminal.waitFor({state:"visible",timeout:17*60*1000}).then(()=>"ERROR")
 ]);
 if(outcome!=="PASS")throw Error("LIVE_WEBSITE_ABORTED_"+await failReason());
 // User explicitly opts in ONLY after whole frozen QA and saved Vite preview exist.
 const consent=page.getByLabel(/我同意將目前這份經過完整 QA 的 App 公開發布/u);
 await consent.waitFor({state:"visible",timeout:15000});
 await consent.check();
 await page.getByRole("button",{name:"驗證原始 QA 並正式發布可分享 App 卡片"}).click();
 const link=page.getByRole("link",{name:"開啟／分享已發布 App"});
 await link.waitFor({state:"visible",timeout:30000});
 const href=await link.getAttribute("href");
 if(!href||!urlRule.test(href))throw Error("LIVE_WEBSITE_PUBLIC_SHARE_URL_INVALID");
 const id=href.split("/").at(-1);
 const record=await page.request.get(origin+"/api/v1/code-apps/"+id,{timeout:20000});
 const json=await record.json().catch(()=>null);
 if(record.status()!==200||json?.data?.share_id!==id)
  throw Error("LIVE_WEBSITE_PUBLIC_CARD_NOT_IN_POSTGRES");
 const fresh=async()=>{
  const ctx=await browser.newContext({serviceWorkers:"block"});
  const view=await ctx.newPage();
  await view.goto(origin+href,{waitUntil:"domcontentloaded",timeout:25000});
  const frame=view.frameLocator('iframe[sandbox="allow-scripts"]');
  const button=frame.getByRole("button",{name:"加一",exact:true});
  await button.waitFor({state:"visible",timeout:20000});
  await button.click();
  await frame.getByText("計數：1",{exact:false}).waitFor({state:"visible",timeout:10000});
  await ctx.close();
 };
 await fresh();
 await fresh();
 if(mutations.filter(p=>p.endsWith("/free-ai-stage")&&p.includes("/api/v1/agent-jobs/")).length>3)
  throw Error("LIVE_WEBSITE_MORE_THAN_THREE_PAID_PHASES");
 console.log("SP35 REAL CUSTOMER WEBSITE E2E PASS: natural language → owner signed paid QA+CODE → independent free Docker Chromium original QA → PostgreSQL private saved App → explicit PUBLIC share → two clean browsers clicked App, ID="+id);
 console.log("SP35 PAID TEST CONTROL: one generation click, no model retry, <=44c approved job budget (actual provider invoice NOT verified), no Production deploy");
}catch(e){
 console.log("SP35 REAL WEBSITE E2E FAIL_CLOSED: "+String(e).slice(0,500));
 console.log("SP35 DIAGNOSTIC "+(await failReason()).slice(0,1400));
 throw e;
}finally{await context.close();await browser.close();}
