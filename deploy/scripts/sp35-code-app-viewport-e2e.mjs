/* Real staging published App iframe viewport and full-screen test. No AI,
 * no database mutations, no special-cased game CSS.
 */
import {chromium} from "@playwright/test";
const origin=new URL(process.env.APPF2_STAGING_URL??"https://appf2-sp35-417-staging.juiyuang69.workers.dev").origin;
if(!/^https:\/\/appf2-sp35-417-staging\.[a-z0-9-]+\.workers\.dev$/u.test(origin))
 throw Error("STAGING_ONLY");
const id="160ade43-6ef6-4429-8737-81ae2b0d9080";
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage({viewport:{width:1764,height:900}});
 await page.goto(origin+"/code/"+id,{waitUntil:"domcontentloaded",timeout:45000});
 const iframe=page.locator(".code-app-frame iframe");
 await iframe.waitFor({state:"visible",timeout:15000});
 const game=page.frameLocator(".code-app-frame iframe");
 await game.getByRole("button",{name:"擲骰子"}).waitFor({state:"visible",timeout:12000});
 const rect=await iframe.boundingBox();
 if(!rect||rect.height<650||rect.width<1000)
  throw Error("CLIPPED_DESKTOP_FRAME:"+JSON.stringify(rect));
 if(await game.getByRole("button",{name:"結果",exact:true}).count()!==1)
  throw Error("MISSING_REAL_APP_NAV");
 const full=page.getByRole("button",{name:"全螢幕顯示"});
 await full.click();
 await page.locator(".code-app-viewer-expanded").waitFor({state:"visible"});
 const big=await iframe.boundingBox();
 if(!big||big.height<760||big.width<1600)
  throw Error("FULLSCREEN_FRAME_STILL_CLIPPED:"+JSON.stringify(big));
 await game.getByRole("button",{name:"規則",exact:true}).click();
 if(!(await game.locator("#view-rules").innerText()).includes("三顆相同"))
  throw Error("FULLSCREEN_LOST_INTERACTION");
 await page.getByRole("button",{name:"退出全螢幕"}).click();
 await page.locator(".code-app-viewer-expanded").waitFor({state:"hidden"});
 const original=await iframe.boundingBox();
 if(!original||original.height<650)throw Error("FULLSCREEN_EXIT_COLLAPSED");
 const mobile=await browser.newPage({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
 await mobile.goto(origin+"/code/"+id,{waitUntil:"domcontentloaded",timeout:45000});
 const small=mobile.locator(".code-app-frame iframe");
 await small.waitFor({state:"visible",timeout:15000});
 const m=await small.boundingBox();
 if(!m||m.width>405||m.height<600)throw Error("MOBILE_VIEWPORT_CLIPPED:"+JSON.stringify(m));
 console.log("CODE_APP_VIEWPORT_E2E_PASS: desktop full viewport, real in-game nav, fullscreen enter/exit, mobile full-height frame; NO_AI");
}finally{await browser.close();}
