/** One real NEW natural-language user creation through the ACTUAL Staging UI.
 * User authorized US$1 aggregate. Historical CODE max 20c each x2; this
 * single new Job's cumulative approved cap is 44c (maximum 84c across three).
 * No local/API-bypass project creation; all owner identity remains in Chromium.
 * This script has zero hidden model calls when run without exact paid marker.
 */
import {chromium} from "@playwright/test";
const origin="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
const prompt="請製作一個真正可操作的即時計數工具 App。標題顯示「即時計數工具」，首次開啟顯示「計數：0」。按「增加一次」按鈕後畫面顯示「計數：1」，連續按兩次「增加一次」後顯示「計數：2」。按「重新歸零」後再顯示「計數：0」。請讓兩個不同瀏覽器都能使用互動按鈕，畫面清楚易讀。使用多個互相匯入的 TypeScript src/ 模組，不能用假按鈕或外部網路。";
const criteria=[
 ["initial","首次開啟顯示「計數：0」",[],{kind:"text_includes",text:"計數：0"}],
 ["title","標題顯示「即時計數工具」",[],{kind:"text_includes",text:"即時計數工具"}],
 ["increment","按「增加一次」按鈕後畫面顯示「計數：1」",["增加一次"],{kind:"text_appears",text:"計數：1"}],
 ["twice","連續按兩次「增加一次」後顯示「計數：2」",["增加一次","增加一次"],{kind:"text_appears",text:"計數：2"}],
 ["reset","按「重新歸零」後再顯示「計數：0」",["增加一次","重新歸零"],{kind:"text_appears",text:"計數：0"}]
];
const plan={version:"1",criteria:criteria.map(([id,source_quote,buttons,assertion])=>({
 id,source_quote,description:"真 Chromium 原始需求："+id,
 automatable:true,
 steps:buttons.map(name=>({action:"click",role:"button",name})),
 assertions:[assertion]
}))};
if(!plan.criteria.every(c=>prompt.includes(c.source_quote)))
 throw Error("G1_SITE_FROZEN_PLAN_NOT_FROM_ORIGINAL_PROMPT");
let launchedAt=Date.now(),newJobId=null,shareId=null;
const browser=await chromium.launch({headless:true});
try{
 const context=await browser.newContext({serviceWorkers:"block"});
 const page=await context.newPage();
 let newJobs=0,sharePosts=0;
 page.on("response",async response=>{
  if(response.request().method()!=="POST")return;
  const pathname=new URL(response.url()).pathname;
  if(pathname==="/api/v1/agent-jobs"&&response.status()===201){
   newJobs++;
   const result=await response.json().catch(()=>null);
   if(typeof result?.data?.job_id==="string")newJobId=result.data.job_id;
   console.log("SP35 NEW SITE USER JOB: "+
    String(newJobId)+"; real browser POST=1; cost cap 44c NOT invoice");
  }
  if(pathname.endsWith("/publish-code-app"))sharePosts++;
 });
 await page.goto(origin,{waitUntil:"domcontentloaded",timeout:60000});
 await page.getByRole("textbox",{name:"用一句話描述要做的 App"})
  .waitFor({state:"visible",timeout:30000});
 // The main product is the multi-file Agent, not the closed legacy composer.
 if(await page.locator("#composer-input").isVisible())
  throw Error("G1_SITE_LEGACY_NOT_CLOSED");
 await page.getByRole("textbox",{name:"用一句話描述要做的 App"}).fill(prompt);
 await page.locator("details").filter({
  hasText:"進階：開發前鎖定獨立 QA 驗收計畫"}).locator("summary").click();
 await page.getByRole("textbox",{name:"原始驗收計畫 JSON"})
  .fill(JSON.stringify(plan));
 await page.locator("#agent-max-cost").fill("44");
 async function consent(label){
  const checkbox=page.locator("label.code-builder-consent")
   .filter({hasText:label}).locator('input[type="checkbox"]');
  if(await checkbox.count()!==1)throw Error("G1_SITE_CONSENT_NOT_UNIQUE_"+label);
  await checkbox.check();
 }
 await consent("我同意付費 AI");
 await consent("我同意僅用 GitHub Actions 免費 Docker");
 await consent("我另行核准免費 Chromium");
 await consent("我核准將目前已保存的專案送到既有 GitHub Actions");
 await consent("我授權真實 Browser QA 出現 FAIL 時");
 const start=page.getByRole("button",{name:"一鍵真 AI 生成 App → 免費 Docker → QA → 保存／分享"});
 if(!await start.isEnabled())throw Error("G1_SITE_CTA_NOT_ENABLED");
 await start.click();
 // An exact frozen QA PASS and saved preview must unlock consented public
 // sharing on the WEBSITE. AI source or CI smoke alone cannot unlock it.
 const region=page.locator('section[aria-label="通過 QA 的 App 正式分享"]');
 let failedReason="";
 for(let poll=0;poll<170;poll++){
  if(await region.isVisible())break;
  const text=await page.locator("body").innerText();
  if(text.includes("已達三輪修復上限")||
     text.includes("原 Job QA 失敗已保存；新修復需要明確核准")||
     text.includes("SP35_REPAIR_CONTEXT_EXCEEDS_APPROVED_BUDGET")||
     text.includes("原 Job 保存，不重送付費 AI")){
   failedReason=text.slice(-1000);break;
  }
  await page.waitForTimeout(7000);
 }
 if(!await region.isVisible())
  throw Error("G1_SITE_NEW_APP_QA_NOT_COMPLETE_NO_FALSE_PASS "+
   String(newJobId)+" "+failedReason.slice(0,350));
 const completeAt=Date.now();
 if(newJobs!==1||!newJobId)throw Error("G1_SITE_NEW_JOB_COUNT_NOT_EXACTLY_ONE");
 const qaItems=page.locator('section[aria-label="QA 逐項結果"] li');
 if(await qaItems.count()!==plan.criteria.length)
  throw Error("G1_SITE_ORIGINAL_QA_WRONG_COUNT");
 for(let i=0;i<plan.criteria.length;i++){
  if(!(await qaItems.nth(i).innerText()).includes("PASS"))
   throw Error("G1_SITE_ORIGINAL_QA_NOT_ALL_PASS_"+String(i));
 }
 // User's permission to publish this one test App is explicit and
 // enacted through the website checkbox, never bypassed at the API.
 await consent("我同意將目前這份經過完整 QA 的 App 公開發布");
 await page.getByRole("button",{name:"驗證原始 QA 並正式發布可分享 App 卡片"}).click();
 const published=page.getByRole("link",{name:"開啟／分享已發布 App"});
 await published.waitFor({state:"visible",timeout:45000});
 const href=await published.getAttribute("href");
 const match=/^\/code\/([0-9a-f-]{36})$/iu.exec(href??"");
 if(!match)throw Error("G1_SITE_SHARE_URL_MISSING");
 shareId=match[1];
 if(sharePosts!==1)throw Error("G1_SITE_PUBLIC_SHARE_NOT_EXACTLY_ONCE");
 const visitor=await browser.newContext({serviceWorkers:"block"});
 const guest=await visitor.newPage();
 await guest.goto(origin+href,{waitUntil:"domcontentloaded",timeout:60000});
 const frame=guest.frameLocator('iframe[sandbox="allow-scripts"]');
 const counter=frame.getByText("計數：0",{exact:true});
 await counter.waitFor({state:"visible",timeout:20000});
 await frame.getByRole("button",{name:"增加一次",exact:true}).click();
 await frame.getByText("計數：1",{exact:true})
  .waitFor({state:"visible",timeout:12000});
 await frame.getByRole("button",{name:"增加一次",exact:true}).click();
 await frame.getByText("計數：2",{exact:true})
  .waitFor({state:"visible",timeout:12000});
 await frame.getByRole("button",{name:"重新歸零",exact:true}).click();
 await counter.waitFor({state:"visible",timeout:12000});
 await guest.reload({waitUntil:"domcontentloaded"});
 await frame.getByRole("button",{name:"增加一次",exact:true})
  .waitFor({state:"visible",timeout:15000});
 await frame.getByRole("button",{name:"增加一次",exact:true}).click();
 await frame.getByText("計數：1",{exact:true})
  .waitFor({state:"visible",timeout:12000});
 console.log("SP35 G1 FIRST TRUE WEBSITE NEW-GENERATION E2E PASS: "+
  "1/9; native textarea->one new original signed Job->paid GPT-6->"+
  "network-denied Docker->frozen Chromium QA "+
  plan.criteria.length+"/"+plan.criteria.length+
  "->private preview->explicit owner website publication->"+
  "second fresh Chromium context real 0/1/2/reset/reload interaction");
 console.log("SP35 G1 RECEIPT: job_id="+newJobId+
  " share_id="+shareId+" since_browser_click_ms="+
  String(completeAt-launchedAt)+" until_share_and_guest_ms="+
  String(Date.now()-launchedAt)+
  " newJobs="+newJobs+" site_share_posts="+sharePosts+
  " max_new_job_cents=44 actual_provider_invoice=NOT_VERIFIED");
 await visitor.close();await context.close();
}catch(err){
 console.error("SP35 G1 FIRST TRUE SITE E2E FAIL, NEVER COUNT PASS: "+
  String(err instanceof Error?err.message:err).slice(0,480));
 console.error("SP35 G1 SAFE RECEIPT job_id="+String(newJobId)+
  " public_share_id="+String(shareId)+
  " max_job_cost_cents=44 invoice=NOT_VERIFIED");
 throw err;
}finally{await browser.close();}
