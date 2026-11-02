/**
 * FREE / NO MODEL / NO PAID CLOUD: real same-context browser reload regression.
 * Positive: a persisted user change survives. Negative: a memory-only fake does not.
 * Reuses generic independent QA runner, never a game-/App-specific verifier.
 */
import http from "node:http";
import {chromium} from "@playwright/test";
import {runBuiltAppQa} from "./sp35-built-app-independent-qa.mjs";

const originalPrompt="我需要一個可以按新增並保存計數，重新整理後仍保持計數的工具";
const plan={version:"1",criteria:[{
 id:"persist_after_refresh",source_quote:"重新整理後仍保持計數",
 description:"按新增以後，在同一使用者瀏覽器重新整理，仍顯示新的計數",
 automatable:true,
 steps:[{action:"click",role:"button",name:"新增"},{action:"reload"}],
 assertions:[{kind:"text_appears",text:"計數：1"}]
}]};
let persistent=true;
let controlsWorking=true;
const pageSource=()=>`<!doctype html><html lang="zh-Hant"><body>
<main><button type="button" id="add">新增</button>
<output id="result"></output>
<label><input type="checkbox" id="consent">同意條款</label>
<output id="consent-result">同意狀態：否</output>
<label for="delivery">配送方式</label>
<select id="delivery"><option value="standard">一般</option><option value="express">快遞</option></select>
<output id="delivery-result">配送方式：一般</output></main>
<script>
const enabled=${JSON.stringify(persistent)};
const working=${JSON.stringify(controlsWorking)};
let value=enabled?Number(localStorage.getItem("qa-counter")||0):0;
const output=document.getElementById("result");
function render(){output.textContent="計數："+value;}
render();
document.getElementById("add").addEventListener("click",()=>{
 value++;
 if(enabled)localStorage.setItem("qa-counter",String(value));
 render();
});
if(working){
 document.getElementById("consent").addEventListener("change",event=>{
  document.getElementById("consent-result").textContent=
   "同意狀態："+(event.target.checked?"是":"否");
 });
 document.getElementById("delivery").addEventListener("change",event=>{
  document.getElementById("delivery-result").textContent=
   "配送方式："+(event.target.value==="express"?"快遞":"一般");
 });
}
</script></body></html>`;
const server=http.createServer((req,res)=>{
 if(req.method!=="GET"||new URL(req.url??"/","http://127.0.0.1").pathname!=="/"){
  res.writeHead(404);res.end();return;
 }
 res.writeHead(200,{"Content-Type":"text/html; charset=utf-8","Cache-Control":"no-store"});
 res.end(pageSource());
});
let browser;
try{
 await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
 const address=server.address();
 if(!address||typeof address==="string")throw Error("BROWSER_QA_PORT_INVALID");
 const origin="http://127.0.0.1:"+address.port;
 browser=await chromium.launch({headless:true});
 const pass=await runBuiltAppQa({browser,origin,plan,prompt:originalPrompt});
 if(pass.length!==1||pass[0].verdict!=="PASS")
  throw Error("REAL_RELOAD_PERSISTED_FALSE_REJECT:"+JSON.stringify(pass));
 persistent=false; // Same input and QA plan. Only implementation changes.
 const fail=await runBuiltAppQa({browser,origin,plan,prompt:originalPrompt});
 if(fail.length!==1||fail[0].verdict!=="FAIL")
  throw Error("MEMORY_ONLY_APP_FALSE_PASS:"+JSON.stringify(fail));
 const formPrompt="我要一個表單，打勾同意條款並更新同意狀態，再選配送方式更新配送摘要";
 const formPlan={version:"1",criteria:[
  {id:"consent_flow",source_quote:"打勾同意條款並更新同意狀態",
   description:"真的打勾同意條款後，畫面更新狀態",automatable:true,
   steps:[{action:"check",role:"checkbox",name:"同意條款"}],
   assertions:[{kind:"text_appears",text:"同意狀態：是"}]},
  {id:"delivery_flow",source_quote:"選配送方式更新配送摘要",
   description:"真的更改下拉選項後，畫面更新摘要",automatable:true,
   steps:[{action:"select",role:"combobox",name:"配送方式",value:"express"}],
   assertions:[{kind:"text_appears",text:"配送方式：快遞"}]}
 ]};
 const formPass=await runBuiltAppQa({browser,origin,plan:formPlan,prompt:formPrompt});
 if(formPass.length!==2||formPass.some(c=>c.verdict!=="PASS"))
  throw Error("REAL_FORM_ACTIONS_FALSE_REJECT:"+JSON.stringify(formPass));
 controlsWorking=false;
 const formFail=await runBuiltAppQa({browser,origin,plan:formPlan,prompt:formPrompt});
 if(formFail.length!==2||formFail.some(c=>c.verdict!=="FAIL"))
  throw Error("STATIC_FORM_DECOY_FALSE_PASS:"+JSON.stringify(formFail));
 console.log("SP35 UNKNOWN BUSINESS FORM QA: PASS: real checkbox/select outcomes PASS; dead controls correctly FAIL; 0 model/paid calls");
 console.log("SP35 UNKNOWN APP PERSISTENCE QA: PASS: independent Chromium reload; saved state PASS, in-memory decoy FAIL; 0 AI/Job/paid calls");
}finally{
 if(browser)await browser.close();
 await new Promise(resolve=>server.close(resolve));
}
