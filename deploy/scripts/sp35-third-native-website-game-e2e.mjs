/**
 * Third distinct NEW website-native AI App: interactive two-player tic-tac-toe.
 * Design PR #45 H-001 §0.12 is frozen before this Build implementation.
 * --preflight-only is ZERO AI / ZERO new Job; only an explicitly gated
 * one-shot workflow may execute the real paid path. No fixture counts as 3/9.
 */
import {chromium} from "@playwright/test";

const origin="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
const prompt=[
 "請製作真正可操作的雙人井字棋 App，使用一套通用 AI Code Builder 自行產生程式，不可使用現成井字棋模板。",
 "標題顯示「雙人井字棋」。首次開啟顯示「輪到：X」。",
 "按「第1格」後顯示「第1格：X」。按「第1格」後顯示「輪到：O」。",
 "按「第1格」再按「第5格」後顯示「第5格：O」。",
 "依序按「第1格」「第5格」「第2格」「第8格」「第3格」後顯示「勝者：X」。",
 "按「第1格」後再按「重新開始」顯示「輪到：X」。",
 "九個有明確可存取 button 名稱「第1格」到「第9格」的棋盤按鈕；依序 X/O 雙人輪流，",
 "所有落子顯示例如「第1格：X」「第5格：O」這種清楚的文字狀態。",
 "已落子格禁止覆寫，任一方連成三子立即宣告勝者，勝利後不能繼續下子，",
 "「重新開始」必須清空棋盤並重新輪到 X。禁止假按鈕或固定預設勝利。",
 "使用至少三個彼此 import 的 src/ TypeScript 模組與 CSS，不使用外部網路、外部套件或 localStorage。"
].join("");
const cases=[
 ["title","標題顯示「雙人井字棋」",[],{kind:"text_includes",text:"雙人井字棋"}],
 ["initial","首次開啟顯示「輪到：X」",[],{kind:"text_includes",text:"輪到：X"}],
 ["first_x","按「第1格」後顯示「第1格：X」",["第1格"],{kind:"text_appears",text:"第1格：X"}],
 ["turn_o","按「第1格」後顯示「輪到：O」",["第1格"],{kind:"text_appears",text:"輪到：O"}],
 ["first_o","按「第1格」再按「第5格」後顯示「第5格：O」",["第1格","第5格"],{kind:"text_appears",text:"第5格：O"}],
 ["win_x","依序按「第1格」「第5格」「第2格」「第8格」「第3格」後顯示「勝者：X」",
  ["第1格","第5格","第2格","第8格","第3格"],{kind:"text_appears",text:"勝者：X"}],
 ["reset","按「第1格」後再按「重新開始」顯示「輪到：X」",
  ["第1格","重新開始"],{kind:"text_appears",text:"輪到：X"}]
];
const plan={version:"1",criteria:cases.map(([id,source_quote,buttons,assertion])=>({
 id,source_quote,description:"原網站遊戲要求： "+id,
 automatable:true,steps:buttons.map(name=>({action:"click",role:"button",name})),
 assertions:[assertion]
}))};
if(plan.criteria.length!==7||new Set(cases.map(c=>c[0])).size!==7||
 !plan.criteria.every(c=>prompt.includes(c.source_quote)))
 throw Error("SP35_G3_FROZEN_QA_INVALID_NO_PAID_POST");
if(process.argv.includes("--preflight-only")){
 console.log("SP35 G3 FROZEN GAME PLAN FREE PREFLIGHT PASS: "+
  plan.criteria.length+"/7 source quotes matched; 0 model POST; 0 new App; "+
  "product progress remains 2/9");
 process.exit(0);
}
if(process.env.APPF2_SP35_G3_EXPLICIT_PAID_OK!=="1"||
 process.env.GITHUB_ACTIONS!=="true")
 throw Error("SP35_G3_PAUSED_BUDGET_NO_EXPLICIT_SAFE_ONE_SHOT");
let newJobId=null,shareId=null,created=0,published=0;
const publishResponses=[];
let startedAt,qaReadyAt;
const browser=await chromium.launch({headless:true});
const contexts=[];
try{
 const creatorCtx=await browser.newContext({serviceWorkers:"block"});
 contexts.push(creatorCtx);
 const page=await creatorCtx.newPage();
 page.on("response",async response=>{
  if(response.request().method()!=="POST")return;
  const route=new URL(response.url()).pathname;
  if(route==="/api/v1/agent-jobs"&&response.status()===201){
   created++;
   const data=await response.json().catch(()=>null);
   if(typeof data?.data?.job_id==="string")newJobId=data.data.job_id;
  }
  if(route.endsWith("/publish-code-app")){
   published++;
   const body=await response.json().catch(()=>null);
   const code=typeof body?.error?.code==="string"?body.error.code:
    typeof body?.error==="string"?body.error:"UNKNOWN";
   const evidence={http:response.status(),code:code.slice(0,85)};
   publishResponses.push(evidence);
   console.log("SP35 G3 PUBLISH HTTP: "+JSON.stringify(evidence));
  }
 });
 await page.goto(origin,{waitUntil:"domcontentloaded",timeout:60000});
 const input=page.getByRole("textbox",{name:"用一句話描述要做的 App"});
 await input.waitFor({state:"visible",timeout:30000});
 if(await page.locator("#composer-input").isVisible())
  throw Error("SP35_G3_OLD_COMPOSER_SHOULD_NOT_BE_MAIN");
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
   throw Error("SP35_G3_CONSENT_NOT_UNIQUE_"+label);
  await input.check();
 }
 await consent("我同意付費 AI");
 await consent("我同意僅用 GitHub Actions 免費 Docker");
 await consent("我另行核准免費 Chromium");
 await consent("我核准將目前已保存的專案送到既有 GitHub Actions");
 await consent("我授權真實 Browser QA 出現 FAIL 時");
 const start=page.getByRole("button",{
  name:"一鍵真 AI 生成 App → 免費 Docker → QA → 保存／分享"});
 if(!await start.isEnabled())throw Error("SP35_G3_CTA_DISABLED");
 startedAt=Date.now();
 await start.click();
 const region=page.locator('section[aria-label="通過 QA 的 App 正式分享"]');
 let lastFailure="";
 for(let poll=0;poll<170;poll++){
  if(await region.isVisible())break;
  const text=await page.locator("body").innerText();
  if(/PAUSED_BUDGET|原 Job QA 失敗已保存|已達三輪修復上限|SP35_REPAIR_CONTEXT_EXCEEDS_APPROVED_BUDGET|原 Job 保存，不重送付費 AI/u.test(text)){
   lastFailure=text.slice(-600);break;
  }
  await page.waitForTimeout(7000);
 }
 if(!await region.isVisible())
  throw Error("SP35_G3_SITE_FROZEN_QA_NOT_COMPLETE "+
   String(newJobId)+" "+lastFailure);
 qaReadyAt=Date.now();
 if(created!==1||!newJobId)throw Error("SP35_G3_NEW_JOB_COUNT_NOT_ONE");
 const items=page.locator('section[aria-label="QA 逐項結果"] li');
 if(await items.count()!==7)throw Error("SP35_G3_QA_COUNT_NOT_SEVEN");
 for(let i=0;i<7;i++){
  const text=await items.nth(i).innerText();
  if(!text.includes("PASS")||text.includes("FAIL"))
   throw Error("SP35_G3_QA_NOT_PASS_"+i);
 }
 await consent("我同意將目前這份經過完整 QA 的 App 公開發布");
 const publishButton=page.getByRole("button",{
  name:"驗證原始 QA 並正式發布可分享 App 卡片"});
 if(!await publishButton.isEnabled())
  throw Error("SP35_G3_PUBLICATION_BUTTON_DISABLED");
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
     throw Error("SP35_G3_PUBLICATION_5XX_BUTTON_DISABLED "+
      JSON.stringify(latest)+" "+visibleError);
    console.log("SP35 G3 ONE SAME-OWNER ZERO-MODEL PUBLICATION RETRY "+
     JSON.stringify(latest));
    publishResponses.length=0;
    await publishButton.click();
    continue;
   }
   throw Error("SP35_G3_PUBLICATION_HTTP_FAILURE "+
    JSON.stringify(latest)+" UI="+visibleError);
  }
  await page.waitForTimeout(250);
 }
 if(!await publishedLink.isVisible()){
  const visibleError=(await page.getByRole("alert").allTextContents())
   .filter(Boolean).join(" ").slice(0,230);
  throw Error("SP35_G3_PUBLICATION_NO_LINK POST="+published+
   " HTTP="+JSON.stringify(publishResponses)+" UI="+visibleError);
 }
 const href=await publishedLink.getAttribute("href");
 const match=/^\/code\/([0-9a-f-]{36})$/iu.exec(href??"");
 if(!match||published<1||published>2||
    publishResponses.filter(x=>x.http===200).length!==1)
  throw Error("SP35_G3_PUBLICATION_NOT_SINGLE_VERIFIED_ACTIVE");
 shareId=match[1];
 const guestCtx=await browser.newContext({serviceWorkers:"block"});
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
  throw Error("SP35_G3_GUEST_UI_MISSING_"+label);
 }
 async function press(name){
  await frame.getByRole("button",{name,exact:true}).click({timeout:16000});
 }
 await expectText(/輪到：\s*X/u,"INITIAL_X");
 for(const [button,visible] of [
  ["第1格",/第1格：\s*X/u],
  ["第5格",/第5格：\s*O/u],
  ["第2格",/第2格：\s*X/u],
  ["第8格",/第8格：\s*O/u],
  ["第3格",/勝者：\s*X/u]
 ]){
  await press(button);
  await expectText(visible,"MOVE_"+button);
 }
 const before=await app.innerText();
 const blocked=frame.getByRole("button",{name:"第9格",exact:true});
 if(!await blocked.isDisabled())await blocked.click({timeout:10000});
 const after=await app.innerText();
 if(!/勝者：\s*X/u.test(after)||/第9格：\s*[XO]/u.test(after)||
    (!/第9格：\s*[XO]/u.test(before)&&/第9格：\s*[XO]/u.test(after)))
  throw Error("SP35_G3_GUEST_PLAY_AFTER_WIN_NOT_BLOCKED");
 await press("重新開始");
 await expectText(/輪到：\s*X/u,"RESET_X");
 await press("第1格");
 await expectText(/第1格：\s*X/u,"NEW_GAME_CLICK");
 await guest.reload({waitUntil:"domcontentloaded",timeout:45000});
 await frame.getByRole("button",{name:"第2格",exact:true})
  .waitFor({state:"visible",timeout:20000});
 if(extraModelOrJobPosts!==0)
  throw Error("SP35_G3_REUSE_TRIGGERED_NEW_PAID_JOB");
 console.log("SP35 G3 TRUE NEW WEBSITE GAME FULL PRODUCT E2E PASS: "+
  "3/9; new owner-signed natural-language Job; paid GPT-6 authored multi-module game; "+
  "frozen QA 7/7; free Docker/Chromium; owner publish; stranger game X/O/win/"+
  "no move after win/reset/reload; zero guest generation");
 console.log("SP35 G3 RECEIPT job_id="+newJobId+" share_id="+shareId+
  " creation_posts="+created+" publication_posts="+published+
  " qa_ready_ms="+(qaReadyAt-startedAt)+
  " end_to_end_ms="+(Date.now()-startedAt)+
  " max_job_cost_cents=44 provider_invoice=NOT_VERIFIED");
}catch(error){
 console.error("SP35 G3 TRUE NEW SITE E2E NOT PASS: "+
  String(error instanceof Error?error.message:error).slice(0,750));
 console.error("SP35 G3 PRESERVED RECEIPT job_id="+newJobId+
  " share_id="+shareId+" max_job_cents=44");
 throw error;
}finally{
 for(const context of contexts)await context.close().catch(()=>{});
 await browser.close();
}
