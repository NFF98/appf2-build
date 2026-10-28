// H3: real Chromium executes two unrelated CodeArtifact JS sources via the
// same generic iframe host. Security boundaries are tested, not asserted from markup.
// This is an isolated prototype, NOT production F05/F02 v2 card delivery.
import { createServer } from "vite";
import { chromium } from "@playwright/test";

const server=await createServer({
  root:process.cwd(),configFile:false,appType:"spa",logLevel:"error",
  server:{host:"127.0.0.1",port:0,strictPort:false,hmr:false}
});
let browser;
try{
  await server.listen();
  const address=server.httpServer?.address();
  if(address===null||typeof address!=="object")throw Error("HYBRID_TEST_SERVER_NOT_READY");
  const origin="http://127.0.0.1:"+address.port;
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  await page.route("**/__hybrid_test__",route=>route.fulfill({
    contentType:"text/html; charset=utf-8",status:200,
    body:'<!doctype html><html><head><meta charset="utf-8"></head><body><h1 id="host">APPf2 trusted Shell</h1></body></html>'
  }));
  let outgoing=0;
  await page.route("https://example.org/**",route=>{outgoing++;return route.abort();});
  await page.goto(origin+"/__hybrid_test__");
  await page.evaluate(()=>globalThis.localStorage.setItem("APPF2_HOST_SECRET","PRIVATE_HOST_STATE"));

  const dice=String.raw`
let parentState="ACCESS";
try { parentState=globalThis.parent.document.querySelector("#host").textContent; }
catch { parentState="BLOCKED"; }
let secret="ACCESS";
try { secret=globalThis.localStorage.getItem("APPF2_HOST_SECRET"); }
catch { secret="BLOCKED"; }
const root=document.getElementById("app");
root.innerHTML='<button id="act">擲骰</button><output id="score">1</output><p id="parent-access"></p><p id="storage-access"></p><p id="net-access">PENDING</p>';
document.getElementById("parent-access").textContent=parentState;
document.getElementById("storage-access").textContent=secret;
document.getElementById("act").addEventListener("click",()=>{
  document.getElementById("score").textContent=String(Number(document.getElementById("score").textContent)+1);
});
fetch("https://example.org/collect", {mode:"no-cors"})
 .then(()=>document.getElementById("net-access").textContent="ALLOWED")
 .catch(()=>document.getElementById("net-access").textContent="BLOCKED");
`;
  const counter=String.raw`
document.getElementById("app").innerHTML='<h2>counter</h2><button id="add">+</button><output id="total">0</output>';
document.getElementById("add").addEventListener("click",()=>{
  const out=document.getElementById("total");
  out.textContent=String(Number(out.textContent)+5);
});
`;
  for(const [title,code] of [["Dice",dice],["Counter",counter]]){
    const result=await page.evaluate(async ({title,javascript})=>{
      const contract=await import("/src/platform/blueprint/code-artifact-v2.ts");
      const host=await import("/src/app/runtime/code-artifact-frame.ts");
      const prototype=await contract.makePrototypeCodeArtifact(title,javascript);
      const checked=await contract.verifyPrototypeCodeArtifact(prototype);
      if(!checked.ok)throw Error("HYBRID_ARTIFACT_HASH_REJECTED");
      const mounted=await host.createPrototypeCodeFrame(prototype,document);
      document.body.append(mounted.iframe);
      return {hash:mounted.blueprintHash,sandbox:mounted.iframe.getAttribute("sandbox"),
        srcdoc:mounted.iframe.srcdoc};
    },{title,javascript:code});
    if(!/^sha256:[a-f0-9]{64}$/u.test(result.hash))throw Error("HYBRID_INVALID_BLUEPRINT_HASH");
    if(result.sandbox!=="allow-scripts"||!result.srcdoc.includes("connect-src 'none'"))
      throw Error("HYBRID_SANDBOX_WEAKENED");
  }
  const diceFrame=page.frameLocator('iframe[title="Dice"]');
  await diceFrame.locator("#act").waitFor({state:"visible",timeout:12000});
  if(await diceFrame.locator("#parent-access").innerText()!=="BLOCKED")throw Error("HOST_DOM_LEAK");
  if(await diceFrame.locator("#storage-access").innerText()!=="BLOCKED")throw Error("HOST_STORAGE_LEAK");
  await diceFrame.locator("#act").click();
  if(await diceFrame.locator("#score").innerText()!=="2")throw Error("DICE_NOT_INTERACTIVE");
  await diceFrame.locator("#net-access").getByText("BLOCKED").waitFor({timeout:6000}).catch(async()=>{
    if(await diceFrame.locator("#net-access").innerText()!=="BLOCKED")throw Error("CSP_NETWORK_NOT_BLOCKED");
  });
  if(outgoing!==0)throw Error("CSP_CAUSED_OUTBOUND:"+outgoing);
  const counterFrame=page.frameLocator('iframe[title="Counter"]');
  await counterFrame.locator("#add").click();
  if(await counterFrame.locator("#total").innerText()!=="5")throw Error("COUNTER_NOT_INTERACTIVE");
  const title=await page.locator("#host").innerText();
  if(title!=="APPf2 trusted Shell")throw Error("HOST_TAMPERED");
  console.log("HYBRID H1/H3 REAL BROWSER PASS: two arbitrary JS artifacts, immutable hashes, distinct interactions, parent DOM denied, host storage denied, outbound network 0, host unmodified; AI_CALLS=0");
  console.log("HYBRID LIMIT: no actual AI generation, R2, F02v2 production admission, F05 v2 public card or persistent state bridge.");
}finally{
  await browser?.close();
  await server.close();
}
