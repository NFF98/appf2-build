/* eslint-disable max-depth, complexity -- bounded trusted original-requirement browser acceptance, never App implementation */
/**
 * Eight SPEC-frozen distinct website-native requests; one selected Job only.
 * Design PR #45 H-001 §0.19 is frozen before this Build implementation.
 * --preflight-only is ZERO AI / ZERO new Job; only an explicitly gated
 * one-shot workflow may execute the real paid path. No fixture counts as 3/9.
 */


const origin="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
import {scenarios} from "./sp35-remaining-scenarios.mjs";
const selected=process.env.APPF2_SP35_SAMPLE;
function validate(candidate){
 if(!candidate||candidate.prompt.length>800||candidate.cases.length!==7||
  new Set(candidate.cases.map(c=>c[0])).size!==7||
  !candidate.cases.every(c=>candidate.prompt.includes(c[1])&&c[2].length<=8))
  throw Error("SP35_REMAINING_FROZEN_CONFIG_INVALID");
}
if(process.argv.includes("--preflight-all")){
 for(const item of Object.values(scenarios))validate(item);
 console.log("SP35 EIGHT FROZEN REQUIREMENT PLANS PASS: 56 source-bound criteria; zero Job/model");
 process.exit(0);
}
const candidate=scenarios[selected];
validate(candidate);
const {prompt,cases}=candidate;
console.log("SP35 REMAINING selected_sample="+selected+" max_job_cents=44");
const plan={version:"1",criteria:cases.map(([id,source_quote,buttons,assertion])=>({
 id,source_quote,description:"原網站遊戲要求： "+id,
 automatable:true,steps:buttons.map(step=>typeof step==="string"?{action:"click",role:"button",name:step}:step),
 assertions:[assertion]
}))};
if(plan.criteria.length!==7||new Set(cases.map(c=>c[0])).size!==7||
 !plan.criteria.every(c=>prompt.includes(c.source_quote)))
 throw Error("SP35_REMAINING_FROZEN_QA_INVALID_NO_PAID_POST");
if(process.argv.includes("--preflight-only")){
 console.log("SP35 REMAINING FROZEN SELECTED PLAN FREE PREFLIGHT PASS: "+
  plan.criteria.length+"/7 source quotes matched; 0 model POST; 0 new App; "+
  "this free check adds zero product points");
 process.exit(0);
}
if(process.env.APPF2_SP35_REMAINING_EXPLICIT_PAID_OK!=="1"||
 process.env.GITHUB_ACTIONS!=="true")
 throw Error("SP35_REMAINING_PAUSED_BUDGET_NO_EXPLICIT_SAFE_ONE_SHOT");
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
   console.log("SP35 REMAINING CREATE HTTP FAILURE: "+createRejected+"; no Job admitted");
  }
  if(route==="/api/v1/agent-jobs"&&response.status()===201){
   created++;
   const data=await response.json().catch(()=>null);
   if(typeof data?.data?.job_id==="string")newJobId=data.data.job_id;
  }
  if(route.endsWith("/free-ai-stage")&&response.status()>=400){
   const body=await response.json().catch(()=>null);
   console.log("SP35 REMAINING CODING HTTP FAILURE: "+response.status()+" "+String(body?.error??"UNKNOWN").slice(0,100));
  }
  if(route.endsWith("/publish-code-app")){
   published++;
   const body=await response.json().catch(()=>null);
   const code=typeof body?.error?.code==="string"?body.error.code:
    typeof body?.error==="string"?body.error:"UNKNOWN";
   const evidence={http:response.status(),code:code.slice(0,85)};
   publishResponses.push(evidence);
   console.log("SP35 REMAINING PUBLISH HTTP: "+JSON.stringify(evidence));
  }
 });
 await page.goto(origin,{waitUntil:"domcontentloaded",timeout:60000});
 const input=page.getByRole("textbox",{name:"用一句話描述要做的 App"});
 await input.waitFor({state:"visible",timeout:30000});
 if(await page.locator("#composer-input").isVisible())
  throw Error("SP35_REMAINING_OLD_COMPOSER_SHOULD_NOT_BE_MAIN");
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
   throw Error("SP35_REMAINING_CONSENT_NOT_UNIQUE_"+label);
  await input.check();
 }
 await consent("我同意付費 AI");
 await consent("我同意僅用 GitHub Actions 免費 Docker");
 await consent("我另行核准免費 Chromium");
 await consent("我核准將目前已保存的專案送到既有 GitHub Actions");
 await consent("我授權真實 Browser QA 出現 FAIL 時");
 const start=page.getByRole("button",{
  name:"一鍵真 AI 生成 App → 免費 Docker → QA → 保存／分享"});
 if(!await start.isEnabled())throw Error("SP35_REMAINING_CTA_DISABLED");
 startedAt=Date.now();
 await start.click();
 const region=page.locator('section[aria-label="通過 QA 的 App 正式分享"]');
 let lastFailure="";
 for(let poll=0;poll<170;poll++){
  if(createRejected)throw Error("SP35_REMAINING_CREATE_HTTP_"+createRejected+"_NO_JOB");
  const alerts=(await page.getByRole("alert").allTextContents()).filter(Boolean);
  if(alerts.length)throw Error( "SP35_REMAINING_SITE_REFUSED "+alerts.join(" ").slice(0,180));
  if(await region.isVisible())break;
  const text=await page.locator("body").innerText();
  if(/PAUSED_BUDGET|原 Job QA 失敗已保存|已達三輪修復上限|SP35_REPAIR_CONTEXT_EXCEEDS_APPROVED_BUDGET|原 Job 保存，不重送付費 AI/u.test(text)){
   lastFailure=text.slice(-600);break;
  }
  await page.waitForTimeout(7000);
 }
 if(!await region.isVisible())
  throw Error("SP35_REMAINING_SITE_FROZEN_QA_NOT_COMPLETE "+
   String(newJobId)+" "+lastFailure);
 qaReadyAt=Date.now();
 if(created!==1||!newJobId)throw Error("SP35_REMAINING_NEW_JOB_COUNT_NOT_ONE");
 const items=page.locator('section[aria-label="QA 逐項結果"] li');
 if(await items.count()!==7)throw Error("SP35_REMAINING_QA_COUNT_NOT_SEVEN");
 for(let i=0;i<7;i++){
  const text=await items.nth(i).innerText();
  if(!text.includes("PASS")||text.includes("FAIL"))
   throw Error("SP35_REMAINING_QA_NOT_PASS_"+i);
 }
 await consent("我同意將目前這份經過完整 QA 的 App 公開發布");
 const publishButton=page.getByRole("button",{
  name:"驗證原始 QA 並正式發布可分享 App 卡片"});
 if(!await publishButton.isEnabled())
  throw Error("SP35_REMAINING_PUBLICATION_BUTTON_DISABLED");
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
     throw Error("SP35_REMAINING_PUBLICATION_5XX_BUTTON_DISABLED "+
      JSON.stringify(latest)+" "+visibleError);
    console.log("SP35 REMAINING ONE SAME-OWNER ZERO-MODEL PUBLICATION RETRY "+
     JSON.stringify(latest));
    publishResponses.length=0;
    await publishButton.click();
    continue;
   }
   throw Error("SP35_REMAINING_PUBLICATION_HTTP_FAILURE "+
    JSON.stringify(latest)+" UI="+visibleError);
  }
  await page.waitForTimeout(250);
 }
 if(!await publishedLink.isVisible()){
  const visibleError=(await page.getByRole("alert").allTextContents())
   .filter(Boolean).join(" ").slice(0,230);
  throw Error("SP35_REMAINING_PUBLICATION_NO_LINK POST="+published+
   " HTTP="+JSON.stringify(publishResponses)+" UI="+visibleError);
 }
 const href=await publishedLink.getAttribute("href");
 const match=/^\/code\/([0-9a-f-]{36})$/iu.exec(href??"");
 if(!match||published<1||published>2||
    publishResponses.filter(x=>x.http===200||x.http===201).length!==1)
  throw Error("SP35_REMAINING_PUBLICATION_NOT_SINGLE_VERIFIED_ACTIVE");
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
 async function expectText(expected,label){
  for(let t=0;t<80;t++){
   const text=await app.innerText().catch(()=>"");
   if(text.includes(expected))return text;
   await guest.waitForTimeout(200);
  }
  throw Error("SP35_REMAINING_GUEST_UI_MISSING_"+label);
 }
 async function press(name){
  await frame.getByRole("button",{name,exact:true}).click({timeout:16000});
 }


 const peerBrowsers=[];
 async function verifyOtherViewer(expected,forbidden){
  const peerBrowser=await chromium.launch({headless:true});
  peerBrowsers.push(peerBrowser);
  const peerContext=await peerBrowser.newContext({serviceWorkers:"block"});
  contexts.push(peerContext);
  const peer=await peerContext.newPage();
  peer.on("request",req=>{
   if(req.method()==="POST"&&
    (/free-ai-stage/u.test(new URL(req.url()).pathname)||
     new URL(req.url()).pathname==="/api/v1/agent-jobs"))extraModelOrJobPosts++;
  });
  await peer.goto(origin+href,{waitUntil:"domcontentloaded",timeout:60000});
  const view=peer.frameLocator('iframe[sandbox="allow-scripts"]').locator("#app");
  let observed="";
  for(let n=0;n<80;n++){
   observed=await view.innerText().catch(()=>"");
   if(observed.includes(expected))break;
   await peer.waitForTimeout(200);
  }
  if(!observed.includes(expected)||observed.includes(forbidden))
   throw Error("SP35_REMAINING_CROSS_VIEWER_LEAK_"+selected);
  console.log("SP35 REAL APP SECOND VIEWER ISOLATED sample="+selected);
 }
 try{
  for(const step of candidate.guest){
   const [a,b]=step.args;
   switch(step.action){
    case "fill":
     await frame.getByLabel(a,{exact:true}).fill(b);
     break;
    case "click":
     await press(a);
     break;
    case "expect":
     await expectText(a,selected);
     break;
    case "absent":
     if((await app.innerText()).includes(a))throw Error("UNEXPECTED_VISIBLE_"+a);
     break;
    case "reload":
     await guest.reload({waitUntil:"domcontentloaded",timeout:45000});
     await frame.locator("#app").waitFor({state:"visible",timeout:20000});
     break;
    case "blocked": {
     const before=await app.innerText();
     for(const name of a){
      const button=frame.getByRole("button",{name,exact:true});
      if(!await button.isDisabled())await button.click({timeout:10000});
     }
     if(await app.innerText()!==before)
      throw Error("SP35_REMAINING_MOVE_AFTER_COMPLETE_CHANGED_STATE");
     break;
    }
    case "isolated":
     await verifyOtherViewer(a,b);
     break;
    default: throw Error("UNKNOWN_FROZEN_GUEST_ACTION");
   }
   console.log("SP35 GUEST VERIFIED sample="+selected+" action="+step.action);
  }
 }finally{
  for(const peer of peerBrowsers)await peer.close().catch(()=>{});
 }
 if(extraModelOrJobPosts!==0)
  throw Error("SP35_REMAINING_REUSE_TRIGGERED_NEW_PAID_JOB");
 console.log("SP35 REMAINING CANDIDATE FULL PRODUCT PROOF PASS: "+
  selected+"; new GPT-6 original website owner; frozen 7/7; ACTIVE share; "+
  "separate Chromium actual App/reload/reuse; zero guest generation; count requires PG reconciliation");
 console.log("SP35 REMAINING RECEIPT job_id="+newJobId+" share_id="+shareId+
  " creation_posts="+created+" publication_posts="+published+
  " qa_ready_ms="+(qaReadyAt-startedAt)+
  " end_to_end_ms="+(Date.now()-startedAt)+
  " max_job_cost_cents=44 provider_invoice=NOT_VERIFIED");
}catch(error){
 console.error("SP35 REMAINING TRUE NEW SITE E2E NOT PASS: "+
  String(error instanceof Error?error.message:error).slice(0,750));
 console.error("SP35 REMAINING PRESERVED RECEIPT job_id="+newJobId+
  " share_id="+shareId+" max_job_cents=44");
 throw error;
}finally{
 for(const context of contexts)await context.close().catch(()=>{});
 if(guestBrowser)await guestBrowser.close();
 await browser.close();
}
