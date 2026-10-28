import {chromium} from "@playwright/test";
const origin=new URL(process.env.APPF2_STAGING_URL??"https://appf2-sp35-417-staging.juiyuang69.workers.dev").origin;
if(!/^https:\/\/appf2-sp35-417-staging\.[a-z0-9-]+\.workers\.dev$/u.test(origin))throw Error("STAGING_ONLY");
const old="c7bbf132-9538-404f-9153-4ee48ee25a1b";
const id="160ade43-6ef6-4429-8737-81ae2b0d9080";
const res=await fetch(origin+"/api/v1/code-apps/"+id);
if(!res.ok)throw Error("CORRECTED_PUBLIC_NOT_SERVED_"+res.status);
const record=(await res.json()).data;
if(record.share_id!==id||record.blueprint_hash!=="sha256:295a0b23c3d14760ea54df9b76a0fa2fe619753842200183cafeac36b645256e")
 throw Error("CORRECTED_PUBLIC_BLUEPRINT_HASH_MISMATCH");
const before=await fetch(origin+"/api/v1/code-apps/"+old);
if(!before.ok||((await before.json()).data.blueprint_hash===record.blueprint_hash))
 throw Error("ORIGINAL_BLUEPRINT_NOT_PRESERVED");
const browser=await chromium.launch({headless:true});
async function openPublished(url){
 let lastError=null;
 for(let attempt=0;attempt<2;attempt++){
  const page=await browser.newPage();
  try{
   await page.goto(url,{waitUntil:"commit",timeout:45000});
   return page;
  }catch(e){lastError=e;await page.close().catch(()=>undefined);}
 }
 throw Error("PUBLISHED_CARD_NAVIGATION_UNAVAILABLE",{cause:lastError});
}
try{
 const page=await openPublished(origin+"/code/"+id);
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 const frame=page.frameLocator('iframe[sandbox="allow-scripts"]');
 await frame.locator("#app").waitFor({state:"visible",timeout:15000});
 for(const label of ["遊戲","結果","排行","規則"])
  if(await frame.getByRole("button",{name:label,exact:true}).count()!==1)
   throw Error("LIVE_MISSING_TAB_"+label);
 await frame.getByRole("button",{name:"規則",exact:true}).click();
 if(!(await frame.locator("#view-rules").innerText()).includes("三顆相同"))
  throw Error("LIVE_RULE_PAGE_FAILED");
 await frame.getByRole("button",{name:"遊戲",exact:true}).click();
 await frame.getByRole("button",{name:"擲骰子"}).click();
 await page.waitForTimeout(1500);
 if(await frame.locator(".dice").count()!==4)
  throw Error("LIVE_DICE_COUNT_FAIL");
 const checks=await frame.locator("#app").evaluate(node=>{
  const rule=node.ownerDocument.defaultView?.eighteenlaRule;
  if(typeof rule!=="function")return null;
  return [rule([2,2,6,6]).score,rule([2,2,4,5]).score,rule([2,2,2,4]).score,rule([1,2,3,4]).score];
 });
 if(JSON.stringify(checks)!==JSON.stringify([12,9,0,0]))
  throw Error("LIVE_SEMANTICS_INCORRECT:"+JSON.stringify(checks));
 await frame.getByRole("button",{name:"重新開始"}).click();
 if(!(await frame.locator("#game-turn").innerText()).includes("第 1 回合"))
  throw Error("LIVE_RESET_FAILED");
 if(errors.length)throw Error("LIVE_BROWSER_EXCEPTION:"+JSON.stringify(errors));
 const visitor=await openPublished(origin+"/code/"+id);
 await visitor.frameLocator('iframe[sandbox="allow-scripts"]').getByRole("button",{name:"遊戲",exact:true}).waitFor({state:"visible",timeout:12000});
 console.log("CORRECTED_DICE_LIVE_PUBLISHED_PASS: real PostgreSQL+signed hash+two fresh browsers+actual dice+rules+navigation+reset");
}finally{await browser.close();}
