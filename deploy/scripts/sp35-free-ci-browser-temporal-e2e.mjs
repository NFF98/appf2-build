/** REAL Chromium zero-cost proof for the same frozen QA temporal evaluator
 * used by untrusted AI App's isolated Docker/browser runner.
 * This is a generic runner regression fixture, NOT a re-test of the saved
 * private GPT-6 App nor a replacement for PostgreSQL RLS browser E2E.
 */
import {chromium} from "@playwright/test";
import {executeFrozenQaSteps,observedTextAppears}
 from "./sp35-free-ci-browser-temporal.mjs";
const positiveHtml=`<!doctype html><html><body>
 <h1>獨立 QA 時序驗收</h1><p id="count">紀錄數：0</p>
 <button id="add">新增紀錄</button><button id="delete">刪除紀錄</button>
 <script>
 const label=document.querySelector('#count');
 document.querySelector('#add').onclick=()=>{
  setTimeout(()=>{label.textContent='紀錄數：1';},110);
 };
 document.querySelector('#delete').onclick=()=>{
  setTimeout(()=>{label.textContent='紀錄數：0';},120);
 };
 </script></body></html>`;
const brokenHtml=`<!doctype html><html><body>
 <h1>無效果 App</h1><p>紀錄數：0</p>
 <button>新增紀錄</button><button>刪除紀錄</button>
 </body></html>`;
const browser=await chromium.launch({headless:true});
try{
 async function run(html,criterion){
  const context=await browser.newContext();
  try{
   const page=await context.newPage();
   await page.goto("data:text/html;charset=utf-8,"+
    encodeURIComponent(html),{waitUntil:"load"});
   const before=await page.locator("body").innerText();
   const {stepBodies,after}=await executeFrozenQaSteps(page,criterion,before);
   return observedTextAppears(before,stepBodies.slice(0,-1),
    after,criterion.assertions[0].text);
  }finally{await context.close();}
 }
 const returnToZero={steps:[
  {action:"click",role:"button",name:"新增紀錄"},
  {action:"click",role:"button",name:"刪除紀錄"}],
 assertions:[{kind:"text_appears",text:"紀錄數：0"}]};
 if(!await run(positiveHtml,returnToZero))
  throw Error("CHROMIUM_REAL_0_1_0_FALSE_NEGATIVE");
 if(await run(brokenHtml,returnToZero))
  throw Error("CHROMIUM_NO_OP_UNJUSTIFIED_PASS");
 const increase={steps:[{action:"click",role:"button",name:"新增紀錄"}],
  assertions:[{kind:"text_appears",text:"紀錄數：1"}]};
 if(!await run(positiveHtml,increase))
  throw Error("CHROMIUM_ASYNC_COUNT_INCREASE_FALSE_NEGATIVE");
 if(await run(brokenHtml,increase))
  throw Error("CHROMIUM_NO_OP_COUNT_INCREASE_FALSE_PASS");
 const missing={steps:[{action:"click",role:"button",name:"新增紀錄"}],
  assertions:[{kind:"text_appears",text:"未經授權的資料"}]};
 if(await run(positiveHtml,missing))
  throw Error("CHROMIUM_MISSING_EXPECTED_FALSE_PASS");
 if(await run(brokenHtml,{steps:increase.steps,
  assertions:[{kind:"text_appears",text:"紀錄數：0"}]}))
  throw Error("CHROMIUM_SINGLE_NO_OP_BASELINE_FALSE_PASS");
 console.log("SP35 REAL CHROMIUM TEMPORAL QA: 6/6 PASS; 0 -> 1 -> 0 observed with async updates; no-op/missing FAIL-closed; model calls=0");
}finally{await browser.close();}
