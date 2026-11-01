/** ONE new real native WEBSITE GPT-6 PostgreSQL CRUD App E2E.
 * New user request and original-browser owner, NOT an injected bridge harness.
 * Human authorized the incremental $0.28 cap notified in this conversation:
 * historical job ceilings 40+44 and this one 44 => $1.28 aggregate max.
 * All model calls run through the signed Staging Worker and original journal.
 */
import {chromium} from "@playwright/test";
const origin="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
const prompt="幫我做一個真正接 PostgreSQL 的「客戶備忘錄」App，使用平台 window.appf2Records 的 Promise list/create/read/update/delete，不可用假資料、localStorage 或網路 fetch。標題顯示「客戶備忘錄」。首次開啟顯示「紀錄數：0」。按「新增紀錄」後顯示「紀錄數：1」。按「新增紀錄」後顯示「內容：咖啡」。按「新增紀錄」再按「修改紀錄」後顯示「內容：茶」。按「新增紀錄」再按「刪除紀錄」後回到「紀錄數：0」。必須把每次真資料存取結果顯示於畫面，重新整理資料仍保留，不同瀏覽器使用者只能看自己的紀錄，使用至少三個互相匯入的 src/ TypeScript 模組，按鈕名稱必須一樣。";
const criteria=[["initial","首次開啟顯示「紀錄數：0」",[],{"kind":"text_includes","text":"紀錄數：0"}],["title","標題顯示「客戶備忘錄」",[],{"kind":"text_includes","text":"客戶備忘錄"}],["create","按「新增紀錄」後顯示「紀錄數：1」",["新增紀錄"],{"kind":"text_appears","text":"紀錄數：1"}],["read","按「新增紀錄」後顯示「內容：咖啡」",["新增紀錄"],{"kind":"text_appears","text":"內容：咖啡"}],["update","按「新增紀錄」再按「修改紀錄」後顯示「內容：茶」",["新增紀錄","修改紀錄"],{"kind":"text_appears","text":"內容：茶"}],["delete","按「新增紀錄」再按「刪除紀錄」後回到「紀錄數：0」",["新增紀錄","刪除紀錄"],{"kind":"text_appears","text":"紀錄數：0"}]];
const plan={version:"1",criteria:criteria.map(([id,source_quote,buttons,assertion])=>({
 id,source_quote,description:"真瀏覽器原始網站驗收："+id,
 automatable:true,
 steps:buttons.map(name=>({action:"click",role:"button",name})),
 assertions:[assertion]
}))};
if(!plan.criteria.every(c=>prompt.includes(c.source_quote)))
 throw Error("G2_NEW_SITE_QA_NOT_FROM_ORIGINAL_PROMPT");
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
   console.log("SP35 G2 NEW WEBSITE JOB: "+
    String(newJobId)+"; real browser POST=1; cost cap 44c NOT invoice (batch 128c)");
  }
  if(pathname.endsWith("/publish-code-app"))sharePosts++;
 });
 await page.goto(origin,{waitUntil:"domcontentloaded",timeout:60000});
 await page.getByRole("textbox",{name:"用一句話描述要做的 App"})
  .waitFor({state:"visible",timeout:30000});
 // The main product is the multi-file Agent, not the closed legacy composer.
 if(await page.locator("#composer-input").isVisible())
  throw Error("G2_SITE_LEGACY_NOT_CLOSED");
 await page.getByRole("textbox",{name:"用一句話描述要做的 App"}).fill(prompt);
 await page.locator("details").filter({
  hasText:"進階：開發前鎖定獨立 QA 驗收計畫"}).locator("summary").click();
 await page.getByRole("textbox",{name:"原始驗收計畫 JSON"})
  .fill(JSON.stringify(plan));
 await page.locator("#agent-max-cost").fill("44");
 async function consent(label){
  const checkbox=page.locator("label.code-builder-consent")
   .filter({hasText:label}).locator('input[type="checkbox"]');
  if(await checkbox.count()!==1)throw Error("G2_SITE_CONSENT_NOT_UNIQUE_"+label);
  await checkbox.check();
 }
 await consent("我同意付費 AI");
 await consent("我同意僅用 GitHub Actions 免費 Docker");
 await consent("我另行核准免費 Chromium");
 await consent("我核准將目前已保存的專案送到既有 GitHub Actions");
 await consent("我授權真實 Browser QA 出現 FAIL 時");
 const start=page.getByRole("button",{name:"一鍵真 AI 生成 App → 免費 Docker → QA → 保存／分享"});
 if(!await start.isEnabled())throw Error("G2_SITE_CTA_NOT_ENABLED");
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
  throw Error("G2_SITE_NEW_APP_QA_NOT_COMPLETE_NO_FALSE_PASS "+
   String(newJobId)+" "+failedReason.slice(0,350));
 const completeAt=Date.now();
 if(newJobs!==1||!newJobId)throw Error("G2_SITE_NEW_JOB_COUNT_NOT_EXACTLY_ONE");
 const qaItems=page.locator('section[aria-label="QA 逐項結果"] li');
 if(await qaItems.count()!==plan.criteria.length)
  throw Error("G2_SITE_ORIGINAL_QA_WRONG_COUNT");
 for(let i=0;i<plan.criteria.length;i++){
  if(!(await qaItems.nth(i).innerText()).includes("PASS"))
   throw Error("G2_SITE_ORIGINAL_QA_NOT_ALL_PASS_"+String(i));
 }
 // User's permission to publish this one test App is explicit and
 // enacted through the website checkbox, never bypassed at the API.
 await consent("我同意將目前這份經過完整 QA 的 App 公開發布");
 await page.getByRole("button",{name:"驗證原始 QA 並正式發布可分享 App 卡片"}).click();
 const published=page.getByRole("link",{name:"開啟／分享已發布 App"});
 await published.waitFor({state:"visible",timeout:45000});
 const href=await published.getAttribute("href");
 const match=/^\/code\/([0-9a-f-]{36})$/iu.exec(href??"");
 if(!match)throw Error("G2_SITE_SHARE_URL_MISSING");
 shareId=match[1];
 if(sharePosts!==1)throw Error("G2_SITE_PUBLIC_SHARE_NOT_EXACTLY_ONCE");
 const visitor=await browser.newContext({serviceWorkers:"block"});
 const guest=await visitor.newPage();
 const recordResponses=[];
 const capture=async response=>{
  const u=new URL(response.url());
  if(u.pathname!=="/api/v1/code-apps/"+shareId+"/records"||
     response.request().method()!=="POST")return;
  recordResponses.push({status:response.status()});
 };
 guest.on("response",capture);
 await guest.goto(origin+href,{waitUntil:"domcontentloaded",timeout:60000});
 const frame=guest.frameLocator('iframe[sandbox="allow-scripts"]');
 const ui=frame.locator("#app");
 async function visible(pattern,reason){
  for(let i=0;i<60;i++){
   const text=await ui.innerText().catch(()=>"");
   if(pattern.test(text))return;
   await guest.waitForTimeout(250);
  }
  throw Error("G2_"+reason+"_VISIBLE_UI_NOT_CONFIRMED");
 }
 async function press(name){
  await frame.getByRole("button",{name,exact:true}).click({timeout:12000});
 }
 await visible(/紀錄數：\\s*0/u,"INITIAL_ZERO");
 await press("新增紀錄");
 await visible(/紀錄數：\\s*1/u,"CREATE_COUNTER");
 await visible(/內容：\\s*咖啡/u,"CREATED_CONTENT");
 await guest.reload({waitUntil:"domcontentloaded",timeout:30000});
 await visible(/內容：\\s*咖啡/u,"PERSISTED_AFTER_RELOAD");
 await visible(/紀錄數：\\s*1/u,"PERSISTED_COUNT");
 const contextB=await browser.newContext({serviceWorkers:"block"});
 const other=await contextB.newPage();
 const otherResponses=[];
 other.on("response",r=>{
  if(new URL(r.url()).pathname==="/api/v1/code-apps/"+shareId+"/records"&&
     r.request().method()==="POST")otherResponses.push(r.status());
 });
 await other.goto(origin+href,{waitUntil:"domcontentloaded",timeout:50000});
 const otherFrame=other.frameLocator('iframe[sandbox="allow-scripts"]');
 const otherUi=otherFrame.locator("#app");
 await otherFrame.getByRole("button",{name:"新增紀錄",exact:true})
  .waitFor({state:"visible",timeout:25000});
 if(!/紀錄數：\\s*0/u.test(await otherUi.innerText())||
    /內容：\\s*咖啡/u.test(await otherUi.innerText()))
  throw Error("G2_DIFFERENT_VIEWER_PRIVATE_RECORD_LEAK");
 await press("修改紀錄");
 await visible(/內容：\\s*茶/u,"UPDATED_CONTENT");
 await guest.reload({waitUntil:"domcontentloaded",timeout:30000});
 await visible(/內容：\\s*茶/u,"UPDATED_PERSISTENCE_AFTER_RELOAD");
 if(/內容：\\s*(茶|咖啡)/u.test(await otherUi.innerText()))
  throw Error("G2_CROSS_VIEWER_UPDATED_RECORD_LEAK");
 await press("刪除紀錄");
 await visible(/紀錄數：\\s*0/u,"DELETE_ZERO");
 await guest.reload({waitUntil:"domcontentloaded",timeout:30000});
 await visible(/紀錄數：\\s*0/u,"DELETE_PERSISTED_AFTER_RELOAD");
 if((recordResponses.length<8)||(recordResponses.some(r=>r.status!==200))||
    otherResponses.length<1||otherResponses.some(status=>status!==200))
  throw Error("G2_REAL_SIGNED_PG_WORKER_REQUESTS_NOT_VERIFIED");
 console.log("SP35 G2 REAL WEBSITE POSTGRES APP E2E PASS: "+
  "2/9; native website new GPT-6 author 6/6 frozen QA; owner published; "+
  "guest UI CREATE/READ/UPDATE/DELETE -> real signed Worker/Postgres; "+
  "reload persisted; distinct viewer isolated with no injected JS harness");
 console.log("SP35 G2 RECEIPT job_id="+newJobId+" share_id="+shareId+
  " elapsed_until_QA_ms="+String(completeAt-launchedAt)+
  " total_to_published_CRUD_ms="+String(Date.now()-launchedAt)+
  " newJobs="+newJobs+" sharePosts="+sharePosts+
  " pg_A_http_responses="+recordResponses.length+
  " pg_B_http_responses="+otherResponses.length+
  " max_new_job_cents=44 batch_cap_cents=128 actual_provider_invoice=NOT_VERIFIED");
 await contextB.close();await visitor.close();await context.close();
}catch(err){
 console.error("SP35 G2 NEW REAL SITE PG E2E FAIL, DO NOT COUNT 2/9: "+
  String(err instanceof Error?err.message:err).slice(0,480));
 console.error("SP35 G2 SAFE RECEIPT job_id="+String(newJobId)+
  " share_id="+String(shareId)+" max_new_job_cents=44");
 throw err;
}finally{await browser.close();}
