/* eslint-disable complexity, max-depth -- trusted frozen UI acceptance only; never generated App logic */
import {scenarios} from "./sp35-remaining-scenarios.mjs";
const meal=[{"action":"fill","args":["餐費","1000"]},{"action":"fill","args":["用餐人數","4"]},{"action":"fill","args":["服務費百分比","10"]},{"action":"click","args":["計算"]},{"action":"expect","args":["總額：1100.00"]},{"action":"expect","args":["每人：275.00"]},{"action":"fill","args":["餐費","600"]},{"action":"fill","args":["用餐人數","3"]},{"action":"fill","args":["服務費百分比","0"]},{"action":"click","args":["計算"]},{"action":"expect","args":["每人：200.00"]},{"action":"fill","args":["用餐人數","0"]},{"action":"click","args":["計算"]},{"action":"expect","args":["請輸入正整數人數"]},{"action":"absent","args":["Infinity"]},{"action":"absent","args":["NaN"]},{"action":"absent","args":["每人：200.00"]},{"action":"click","args":["重設"]},{"action":"expect","args":["尚未計算"]},{"action":"fill","args":["餐費","100"]},{"action":"fill","args":["用餐人數","3"]},{"action":"fill","args":["服務費百分比","5"]},{"action":"click","args":["計算"]},{"action":"expect","args":["每人：35.00"]},{"action":"reload","args":[]},{"action":"fill","args":["餐費","600"]},{"action":"fill","args":["用餐人數","3"]},{"action":"fill","args":["服務費百分比","0"]},{"action":"click","args":["計算"]},{"action":"expect","args":["每人：200.00"]}];
const sample=process.env.APPF2_SP35_SAMPLE;
const candidate=sample==="g5-meal"?{id:sample,category:"tool",guest:meal}:scenarios[sample];
if(process.argv.includes("--preflight-only")){
 if(Object.keys(scenarios).length!==8||meal.length<20)throw Error("FROZEN_GUESTS_MISSING");
 console.log("NINE_FROZEN_PUBLISHED_GUEST_FLOWS_READY_ZERO_MODEL");
 process.exit(0);
}
const share=process.env.APPF2_EXISTING_SHARE_ID??"";
if(process.env.GITHUB_ACTIONS!=="true"||process.env.APPF2_RECIPIENT_FREE_OK!=="1"||
 !candidate||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(share))
 throw Error("PUBLISHED_ONLY_FIXED_SHARE_REQUIRED_NO_MODEL");
const {chromium}=await import("@playwright/test");
const origin="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
const browsers=[];
let generationPosts=0;
async function launchViewer(){
 const browser=await chromium.launch({headless:true});browsers.push(browser);
 const context=await browser.newContext({serviceWorkers:"block"});
 const page=await context.newPage();
 const stats={list:0,actions:new Set()};
 page.on("request",request=>{
  const path=new URL(request.url()).pathname;
  if(request.method()==="POST"&&
   (path==="/api/v1/agent-jobs"||path.includes("/free-ai-stage")||
    path==="/api/v1/intents"))generationPosts++;
 });
 page.on("response",response=>{
  if(new URL(response.url()).pathname!=="/api/v1/code-apps/"+share+"/records"||
   ![200,201].includes(response.status()))return;
  try{
   const action=response.request().postDataJSON()?.action;
   if(typeof action==="string")stats.actions.add(action);
   if(action==="list")stats.list++;
  }catch{ /* no body content is logged */ }
 });
 await page.goto(origin+"/code/"+share,{waitUntil:"domcontentloaded",timeout:60000});
 const frame=page.frameLocator('iframe[sandbox="allow-scripts"]');
 const app=frame.locator("#app");
 await app.waitFor({state:"visible",timeout:25000});
 return {page,frame,app,stats};
}
async function waitText(view,text,absent=false){
 for(let n=0;n<90;n++){
  const found=(await view.app.innerText().catch(()=>"")).includes(text);
  if(found!==absent)return;
  await view.page.waitForTimeout(200);
 }
 throw Error("REAL_PUBLISHED_UI_ASSERTION_"+(absent?"ABSENT_":"MISSING_")+text);
}
async function waitList(view,after=0){
 for(let n=0;n<90;n++){
  if(view.stats.list>after)return;
  await view.page.waitForTimeout(200);
 }
 throw Error("REAL_PG_LIST_RESPONSE_REQUIRED");
}
try{
 const view=await launchViewer();
 if(candidate.category==="postgres")await waitList(view);
 for(const step of candidate.guest){
  const [a,b]=step.args;
  switch(step.action){
   case "fill":await view.frame.getByLabel(a,{exact:true}).fill(b);break;
   case "click":await view.frame.getByRole("button",{name:a,exact:true}).click({timeout:15000});break;
   case "expect":await waitText(view,a);break;
   case "absent":await waitText(view,a,true);break;
   case "reload": {
    const before=view.stats.list;
    await view.page.reload({waitUntil:"domcontentloaded",timeout:45000});
    await view.app.waitFor({state:"visible",timeout:25000});
    if(candidate.category==="postgres")await waitList(view,before);
    break;
   }
   case "blocked": {
    const before=await view.app.innerText();
    for(const name of a){
     const button=view.frame.getByRole("button",{name,exact:true});
     if(!await button.isDisabled())await button.click();
    }
    if(before!==await view.app.innerText())throw Error("PLAY_AFTER_COMPLETION_CHANGED_STATE");
    break;
   }
   case "isolated": {
    const stranger=await launchViewer();
    await waitList(stranger);
    await waitText(stranger,a);await waitText(stranger,b,true);
    console.log("REAL_PG_SECOND_CHROMIUM_PROCESS_VIEWER_ISOLATION_PASS");
    break;
   }
   default:throw Error("UNKNOWN_FROZEN_OPERATION");
  }
  console.log("REAL_PUBLISHED_ACTION_PASS sample="+sample+" action="+step.action);
 }
 if(generationPosts!==0)throw Error("PUBLISHED_REUSE_CAUSED_NEW_GENERATION");
 if(candidate.category==="postgres"&&
  !["list","create","update","delete"].every(x=>view.stats.actions.has(x)))
  throw Error("REAL_HTTP_PG_CRUD_NOT_ALL_OBSERVED");
 await view.page.screenshot({path:process.env.RUNNER_TEMP+"/sp35-recipient-"+sample+".png",fullPage:true});
 console.log("REAL_PUBLISHED_RECIPIENT_FULL_PASS sample="+sample+" share_id="+share+
  " new_Chromium_processes="+browsers.length+" model_or_job_POST=0; original UI, refresh, reuse verified");
}finally{
 for(const browser of browsers)await browser.close().catch(()=>{});
}
