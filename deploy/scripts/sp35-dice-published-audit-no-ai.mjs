/* Read and inspect the already published AI artifact only. Never initiate any AI request. */
import {chromium} from "@playwright/test";
const origin=new URL(process.env.APPF2_STAGING_URL??"https://appf2-sp35-417-staging.juiyuang69.workers.dev").origin;
if(!/^https:\/\/appf2-sp35-417-staging\.[a-z0-9-]+\.workers\.dev$/u.test(origin))
  throw Error("AUDIT_STAGING_ONLY");
const shareId="c7bbf132-9538-404f-9153-4ee48ee25a1b";
const response=await fetch(origin+"/api/v1/code-apps/"+shareId);
if(!response.ok)throw Error("AUDIT_EXISTING_APP_UNAVAILABLE_HTTP_"+response.status);
const json=await response.json();
const source=json?.data?.artifact?.javascript;
if(typeof source!=="string")throw Error("AUDIT_MISSING_CODE");
console.log("AUDIT EXISTING SOURCE BYTES: "+Buffer.byteLength(source,"utf8"));
console.log("AUDIT EXISTING SOURCE JSON: "+JSON.stringify(source).slice(0,18000));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();
 await page.goto(origin+"/code/"+shareId,{waitUntil:"domcontentloaded"});
 const frame=page.frameLocator('iframe[sandbox="allow-scripts"]');
 await frame.locator("#app").waitFor({state:"visible",timeout:12000});
 const app=frame.locator("#app");
 console.log("AUDIT STARTING UI TEXT: "+JSON.stringify((await app.innerText()).slice(0,5000)));
 console.log("AUDIT STARTING UI HTML: "+JSON.stringify((await app.innerHTML()).slice(0,9000)));
 const buttons=await frame.locator("button").allTextContents();
 console.log("AUDIT VISIBLE BUTTONS: "+JSON.stringify(buttons.map(s=>s.trim()).slice(0,40)));
 const roll=frame.getByRole("button",{name:/擲|搖|投|roll/iu}).first();
 if(await roll.isVisible().catch(()=>false)){
  await roll.click();
  await page.waitForTimeout(1350);
  console.log("AUDIT AFTER ONE ROLL TEXT: "+JSON.stringify((await app.innerText()).slice(0,5000)));
  console.log("AUDIT AFTER ONE ROLL HTML: "+JSON.stringify((await app.innerHTML()).slice(0,9000)));
 }
 for(const term of ["結果","排行","規則","下一頁"]){
  const options=frame.getByRole("button",{name:new RegExp(term,"u")});
  console.log("AUDIT NAV OPTION "+term+": "+await options.count());
 }
}finally{await browser.close();}
