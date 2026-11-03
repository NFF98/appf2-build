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
 const violations=[];
 const diceCount=await frame.locator(".dice").count();
 if(diceCount!==4)violations.push("FOUR_DICE_COUNT_"+diceCount);
 const examples=[
  {dice:[2,2,6,6],expected:12,rule:"TWO_PAIRS_TWELVE"},
  {dice:[2,2,4,5],expected:9,rule:"ONE_PAIR_NINE"},
  {dice:[2,2,2,4],expected:null,rule:"TRIPLE_MUST_REROLL"},
  {dice:[1,2,3,4],expected:null,rule:"NO_PAIR_MUST_REROLL"}
 ];
 const actual=await frame.locator("#app").evaluate((node,cases)=>{
  // Compare the shipped program's own pure evaluator, never invent replacement results.
  const owner=node.ownerDocument.defaultView;
  const rule=owner?.eighteenlaRule;
  if(typeof rule!=="function")return [];
  return cases.map(c=>rule(c.dice));
 },examples);
 for(let i=0;i<examples.length;i++){
  const item=examples[i],observed=actual[i];
  const ok=observed!==undefined&&(item.expected===null?
    observed.score===0&&/無點|重擲/u.test(observed.text):observed.score===item.expected);
  console.log("AUDIT RULE "+item.rule+": "+(ok?"PASS":"FAIL")+
    " actual="+JSON.stringify(observed??null)+" expected="+JSON.stringify(item.expected));
  if(!ok)violations.push(item.rule);
 }
 for(const term of ["結果","排行","規則"]){
  const options=frame.getByRole("button",{name:new RegExp(term,"u")});
  const count=await options.count();
  console.log("AUDIT NAV OPTION "+term+": "+count);
  if(count===0)violations.push("MISSING_PAGE_"+term);
 }
 // The immutable OLD share is an expected negative regression fixture.
 // Report original failures without misrepresenting an old, already-published
 // artifact as the new candidate or suppressing the actual failure evidence.
 const expected=["TWO_PAIRS_TWELVE","TRIPLE_MUST_REROLL","MISSING_PAGE_結果","MISSING_PAGE_排行","MISSING_PAGE_規則"];
 for(const x of expected)if(!violations.includes(x))
   throw Error("OLD_DICE_REGRESSION_CHANGED:"+x);
 console.log("OLD_DICE_KNOWN_FAILURES_PRESERVED: "+violations.join(", "));
}finally{await browser.close();}
