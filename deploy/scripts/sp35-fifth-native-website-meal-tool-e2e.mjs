/* eslint-disable max-depth -- bounded original-owner publish HTTP diagnostics under one existing Job */
/**
 * New DISTINCT website-native AI App: meal-split tool; PREPARED, no paid authorization.
 * Design PR #45 H-001 §0.15 is frozen before this Build implementation.
 * --preflight-only is ZERO AI / ZERO new Job; only an explicitly gated
 * one-shot workflow may execute the real paid path. No fixture counts as 3/9.
 */


const origin="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
const prompt="請做一個漂亮好用的「餐費分攤工具」，不是遊戲，也不要用之前的 App。標題顯示「餐費分攤工具」。三個數字欄位均用原生number輸入框（spinbutton）。提供標籤明確且可輸入數字的「餐費」「用餐人數」「服務費百分比」欄位，按鈕叫「計算」與「重設」。餐費1000、用餐人數4、服務費百分比10，按計算顯示「總額：1100.00」。餐費1000、用餐人數4、服務費百分比10，按計算顯示「每人：275.00」。餐費600、用餐人數3、服務費百分比0，按計算顯示「每人：200.00」。用餐人數0，按計算顯示「請輸入正整數人數」，不可顯示Infinity或NaN，也不可保留舊的成功結果。先計算餐費1000、4人、10%後按重設，顯示「尚未計算」，清除成功結果與錯誤，欄位回餐費0、人數1、服務費0。重設後填餐費600、人數3、服務費0並計算，顯示「每人：200.00」。金額以兩位小數顯示，總額等於餐費乘以一加服務費百分比再除100，每人等於總額除人數。拒絕負餐費、負服務費與非整數或非正整數人數。計算必須來自目前輸入，不得固定顯示測試答案。使用者可以連續更改輸入並重算，頁面重新整理後仍能填表計算。排版要有表單、清楚的結果區及友善錯誤訊息，手機也能完整操作。程式由AI自由設計，拆成至少三個彼此import的src/ TypeScript模組及CSS，包含計算邏輯、畫面與事件處理，不使用外部套件、網路或localStorage。";
const cases=[
 [
  "title",
  "標題顯示「餐費分攤工具」",
  [],
  {
   "kind": "text_includes",
   "text": "餐費分攤工具"
  }
 ],
 [
  "total",
  "餐費1000、用餐人數4、服務費百分比10，按計算顯示「總額：1100.00」",
  [
   {
    "action": "fill",
    "role": "spinbutton",
    "name": "餐費",
    "value": "1000"
   },
   {
    "action": "fill",
    "role": "spinbutton",
    "name": "用餐人數",
    "value": "4"
   },
   {
    "action": "fill",
    "role": "spinbutton",
    "name": "服務費百分比",
    "value": "10"
   },
   "計算"
  ],
  {
   "kind": "text_appears",
   "text": "總額：1100.00"
  }
 ],
 [
  "per_person",
  "餐費1000、用餐人數4、服務費百分比10，按計算顯示「每人：275.00」",
  [
   {
    "action": "fill",
    "role": "spinbutton",
    "name": "餐費",
    "value": "1000"
   },
   {
    "action": "fill",
    "role": "spinbutton",
    "name": "用餐人數",
    "value": "4"
   },
   {
    "action": "fill",
    "role": "spinbutton",
    "name": "服務費百分比",
    "value": "10"
   },
   "計算"
  ],
  {
   "kind": "text_appears",
   "text": "每人：275.00"
  }
 ],
 [
  "second_case",
  "餐費600、用餐人數3、服務費百分比0，按計算顯示「每人：200.00」",
  [
   {
    "action": "fill",
    "role": "spinbutton",
    "name": "餐費",
    "value": "600"
   },
   {
    "action": "fill",
    "role": "spinbutton",
    "name": "用餐人數",
    "value": "3"
   },
   {
    "action": "fill",
    "role": "spinbutton",
    "name": "服務費百分比",
    "value": "0"
   },
   "計算"
  ],
  {
   "kind": "text_appears",
   "text": "每人：200.00"
  }
 ],
 [
  "invalid",
  "用餐人數0，按計算顯示「請輸入正整數人數」",
  [
   {
    "action": "fill",
    "role": "spinbutton",
    "name": "餐費",
    "value": "1000"
   },
   {
    "action": "fill",
    "role": "spinbutton",
    "name": "用餐人數",
    "value": "4"
   },
   {
    "action": "fill",
    "role": "spinbutton",
    "name": "服務費百分比",
    "value": "10"
   },
   "計算",
   {
    "action": "fill",
    "role": "spinbutton",
    "name": "用餐人數",
    "value": "0"
   },
   "計算"
  ],
  {
   "kind": "text_appears",
   "text": "請輸入正整數人數"
  }
 ],
 [
  "reset",
  "先計算餐費1000、4人、10%後按重設，顯示「尚未計算」",
  [
   {
    "action": "fill",
    "role": "spinbutton",
    "name": "餐費",
    "value": "1000"
   },
   {
    "action": "fill",
    "role": "spinbutton",
    "name": "用餐人數",
    "value": "4"
   },
   {
    "action": "fill",
    "role": "spinbutton",
    "name": "服務費百分比",
    "value": "10"
   },
   "計算",
   "重設"
  ],
  {
   "kind": "text_appears",
   "text": "尚未計算"
  }
 ],
 [
  "reuse",
  "重設後填餐費600、人數3、服務費0並計算，顯示「每人：200.00」",
  [
   "重設",
   {
    "action": "fill",
    "role": "spinbutton",
    "name": "餐費",
    "value": "600"
   },
   {
    "action": "fill",
    "role": "spinbutton",
    "name": "用餐人數",
    "value": "3"
   },
   {
    "action": "fill",
    "role": "spinbutton",
    "name": "服務費百分比",
    "value": "0"
   },
   "計算"
  ],
  {
   "kind": "text_appears",
   "text": "每人：200.00"
  }
 ]
];
const plan={version:"1",criteria:cases.map(([id,source_quote,buttons,assertion])=>({
 id,source_quote,description:"原網站遊戲要求： "+id,
 automatable:true,steps:buttons.map(step=>typeof step==="string"?{action:"click",role:"button",name:step}:step),
 assertions:[assertion]
}))};
if(plan.criteria.length!==7||new Set(cases.map(c=>c[0])).size!==7||
 !plan.criteria.every(c=>prompt.includes(c.source_quote)))
 throw Error("SP35_G5_FROZEN_QA_INVALID_NO_PAID_POST");
if(process.argv.includes("--preflight-only")){
 console.log("SP35 G5 FROZEN MEAL PLAN FREE PREFLIGHT PASS: "+
  plan.criteria.length+"/7 source quotes matched; 0 model POST; 0 new App; "+
  "product progress remains 2/9");
 process.exit(0);
}
if(process.env.APPF2_SP35_G5_EXPLICIT_PAID_OK!=="1"||
 process.env.GITHUB_ACTIONS!=="true")
 throw Error("SP35_G5_PAUSED_BUDGET_NO_EXPLICIT_SAFE_ONE_SHOT");
let newJobId=null,shareId=null,created=0,published=0;
const publishResponses=[];
let startedAt,qaReadyAt;
let createRejected=null;
const {chromium}=await import("@playwright/test");
const browser=await chromium.launch({headless:true});
const contexts=[];
let guestBrowser=null;
try{
 const creatorCtx=await browser.newContext({serviceWorkers:"block"});
 contexts.push(creatorCtx);
 const page=await creatorCtx.newPage();
 page.on("response",async response=>{
  if(response.request().method()!=="POST")return;
  const route=new URL(response.url()).pathname;
  if(route==="/api/v1/agent-jobs"&&response.status()>=400){
   createRejected=response.status();
   console.log("SP35 G5 CREATE HTTP FAILURE: "+createRejected+"; no Job admitted");
  }
  if(route==="/api/v1/agent-jobs"&&response.status()===201){
   created++;
   const data=await response.json().catch(()=>null);
   if(typeof data?.data?.job_id==="string")newJobId=data.data.job_id;
  }
  if(route.endsWith("/free-ai-stage")&&response.status()>=400){
   const body=await response.json().catch(()=>null);
   console.log("SP35 G5 CODING HTTP FAILURE: "+response.status()+" "+String(body?.error??"UNKNOWN").slice(0,100));
  }
  if(route.endsWith("/publish-code-app")){
   published++;
   const body=await response.json().catch(()=>null);
   const code=typeof body?.error?.code==="string"?body.error.code:
    typeof body?.error==="string"?body.error:"UNKNOWN";
   const evidence={http:response.status(),code:code.slice(0,85)};
   publishResponses.push(evidence);
   console.log("SP35 G5 PUBLISH HTTP: "+JSON.stringify(evidence));
  }
 });
 await page.goto(origin,{waitUntil:"domcontentloaded",timeout:60000});
 const input=page.getByRole("textbox",{name:"用一句話描述要做的 App"});
 await input.waitFor({state:"visible",timeout:30000});
 if(await page.locator("#composer-input").isVisible())
  throw Error("SP35_G5_OLD_COMPOSER_SHOULD_NOT_BE_MAIN");
 await input.fill(prompt);
 await page.locator("details").filter({
  hasText:"進階：開發前鎖定獨立 QA 驗收計畫"}).locator("summary").click();
 await page.getByRole("textbox",{name:"原始驗收計畫 JSON"})
  .fill(JSON.stringify(plan));
 await page.locator("#agent-max-cost").fill("44");
 async function consent(label){
  const input=page.locator("label.code-builder-consent")
   .filter({hasText:label}).locator('input[type="checkbox"]');
  if(await input.count()!==1)
   throw Error("SP35_G5_CONSENT_NOT_UNIQUE_"+label);
  await input.check();
 }
 await consent("我同意付費 AI");
 await consent("我同意僅用 GitHub Actions 免費 Docker");
 await consent("我另行核准免費 Chromium");
 await consent("我核准將目前已保存的專案送到既有 GitHub Actions");
 await consent("我授權真實 Browser QA 出現 FAIL 時");
 const start=page.getByRole("button",{
  name:"一鍵真 AI 生成 App → 免費 Docker → QA → 保存／分享"});
 if(!await start.isEnabled())throw Error("SP35_G5_CTA_DISABLED");
 startedAt=Date.now();
 await start.click();
 const region=page.locator('section[aria-label="通過 QA 的 App 正式分享"]');
 let lastFailure="";
 for(let poll=0;poll<170;poll++){
  if(createRejected)throw Error("SP35_G5_CREATE_HTTP_"+createRejected+"_NO_JOB");
  const alerts=(await page.getByRole("alert").allTextContents()).filter(Boolean);
  if(alerts.length)throw Error("SP35_G5_PRE_JOB_REFUSED "+alerts.join(" ").slice(0,180));
  if(await region.isVisible())break;
  const text=await page.locator("body").innerText();
  if(/PAUSED_BUDGET|原 Job QA 失敗已保存|已達三輪修復上限|SP35_REPAIR_CONTEXT_EXCEEDS_APPROVED_BUDGET|原 Job 保存，不重送付費 AI/u.test(text)){
   lastFailure=text.slice(-600);break;
  }
  await page.waitForTimeout(7000);
 }
 if(!await region.isVisible())
  throw Error("SP35_G5_SITE_FROZEN_QA_NOT_COMPLETE "+
   String(newJobId)+" "+lastFailure);
 qaReadyAt=Date.now();
 if(created!==1||!newJobId)throw Error("SP35_G5_NEW_JOB_COUNT_NOT_ONE");
 const items=page.locator('section[aria-label="QA 逐項結果"] li');
 if(await items.count()!==7)throw Error("SP35_G5_QA_COUNT_NOT_SEVEN");
 for(let i=0;i<7;i++){
  const text=await items.nth(i).innerText();
  if(!text.includes("PASS")||text.includes("FAIL"))
   throw Error("SP35_G5_QA_NOT_PASS_"+i);
 }
 await consent("我同意將目前這份經過完整 QA 的 App 公開發布");
 const publishButton=page.getByRole("button",{
  name:"驗證原始 QA 並正式發布可分享 App 卡片"});
 if(!await publishButton.isEnabled())
  throw Error("SP35_G5_PUBLICATION_BUTTON_DISABLED");
 const publishedLink=page.getByRole("link",{name:"開啟／分享已發布 App"});
 await publishButton.click();
 // No new paid model or creator identity: one existing P-256 owner only.
 let retriedFiveHundred=false;
 for(let poll=0;poll<160;poll++){
  if(await publishedLink.isVisible())break;
  const latest=publishResponses.at(-1);
  if(latest&&latest.http>=400){
   const visibleError=(await page.getByRole("alert").allTextContents())
    .filter(Boolean).join(" ").slice(0,180);
   if(latest.http>=500&&latest.http<600&&!retriedFiveHundred){
    retriedFiveHundred=true;
    await publishButton.waitFor({state:"visible",timeout:12000});
    if(!await publishButton.isEnabled())
     throw Error("SP35_G5_PUBLICATION_5XX_BUTTON_DISABLED "+
      JSON.stringify(latest)+" "+visibleError);
    console.log("SP35 G5 ONE SAME-OWNER ZERO-MODEL PUBLICATION RETRY "+
     JSON.stringify(latest));
    publishResponses.length=0;
    await publishButton.click();
    continue;
   }
   throw Error("SP35_G5_PUBLICATION_HTTP_FAILURE "+
    JSON.stringify(latest)+" UI="+visibleError);
  }
  await page.waitForTimeout(250);
 }
 if(!await publishedLink.isVisible()){
  const visibleError=(await page.getByRole("alert").allTextContents())
   .filter(Boolean).join(" ").slice(0,230);
  throw Error("SP35_G5_PUBLICATION_NO_LINK POST="+published+
   " HTTP="+JSON.stringify(publishResponses)+" UI="+visibleError);
 }
 const href=await publishedLink.getAttribute("href");
 const match=/^\/code\/([0-9a-f-]{36})$/iu.exec(href??"");
 if(!match||published<1||published>2||
    publishResponses.filter(x=>x.http===200||x.http===201).length!==1)
  throw Error("SP35_G5_PUBLICATION_NOT_SINGLE_VERIFIED_ACTIVE");
 shareId=match[1];
 guestBrowser=await chromium.launch({headless:true});
 const guestCtx=await guestBrowser.newContext({serviceWorkers:"block"});
 contexts.push(guestCtx);
 const guest=await guestCtx.newPage();
 let extraModelOrJobPosts=0;
 guest.on("request",req=>{
  if(req.method()!=="POST")return;
  const path=new URL(req.url()).pathname;
  if(path==="/api/v1/agent-jobs"||/free-ai-stage/u.test(path))
   extraModelOrJobPosts++;
 });
 await guest.goto(origin+href,{waitUntil:"domcontentloaded",timeout:60000});
 const frame=guest.frameLocator('iframe[sandbox="allow-scripts"]');
 const app=frame.locator("#app");
 async function expectText(regex,label){
  for(let t=0;t<80;t++){
   const text=await app.innerText().catch(()=>"");
   if(regex.test(text))return text;
   await guest.waitForTimeout(200);
  }
  throw Error("SP35_G5_GUEST_UI_MISSING_"+label);
 }
 async function press(name){
  await frame.getByRole("button",{name,exact:true}).click({timeout:16000});
 }

 async function calculate(total,people,service){
  await frame.getByLabel("餐費",{exact:true}).fill(total);
  await frame.getByLabel("用餐人數",{exact:true}).fill(people);
  await frame.getByLabel("服務費百分比",{exact:true}).fill(service);
  await press("計算");
 }
 await expectText(/餐費分攤工具/u,"TITLE");
 await calculate("1000","4","10");
 await expectText(/總額：1100\.00/u,"TOTAL_1100");
 await expectText(/每人：275\.00/u,"EACH_275");
 await calculate("600","3","0");
 await expectText(/每人：200\.00/u,"EACH_200");
 await calculate("1000","0","10");
 await expectText(/請輸入正整數人數/u,"ZERO_DENIED");
 if(/Infinity|NaN|每人：200\.00/u.test(await app.innerText()))
  throw Error("SP35_G5_INVALID_INPUT_LEAKS_OLD_SUCCESS");
 await press("重設");
 await expectText(/尚未計算/u,"RESET");
 await calculate("1000","4","10");
 await expectText(/每人：275\.00/u,"AFTER_RESET");
 await guest.reload({waitUntil:"domcontentloaded",timeout:45000});
 await frame.getByRole("button",{name:"計算",exact:true})
  .waitFor({state:"visible",timeout:20000});
 await calculate("600","3","0");
 await expectText(/每人：200\.00/u,"RELOAD_REUSE");
 if(extraModelOrJobPosts!==0)
  throw Error("SP35_G5_REUSE_TRIGGERED_NEW_PAID_JOB");
 console.log("SP35 G5 TRUE NEW WEBSITE GAME FULL PRODUCT E2E PASS: "+
  "3/9; NEW distinct owner-signed natural-language Job; GPT-6 authored multi-module meal-split tool; "+
  "frozen QA 7/7; free Docker/Chromium; owner publish; stranger fills real form and calculates, rejects zero, "+
  "reset/reload/recalculate; zero guest generation");
 console.log("SP35 G5 RECEIPT job_id="+newJobId+" share_id="+shareId+
  " creation_posts="+created+" publication_posts="+published+
  " qa_ready_ms="+(qaReadyAt-startedAt)+
  " end_to_end_ms="+(Date.now()-startedAt)+
  " max_job_cost_cents=44 provider_invoice=NOT_VERIFIED");
}catch(error){
 console.error("SP35 G5 TRUE NEW SITE E2E NOT PASS: "+
  String(error instanceof Error?error.message:error).slice(0,750));
 console.error("SP35 G5 PRESERVED RECEIPT job_id="+newJobId+
  " share_id="+shareId+" max_job_cents=44");
 throw error;
}finally{
 for(const context of contexts)await context.close().catch(()=>{});
 if(guestBrowser)await guestBrowser.close();
 await browser.close();
}
