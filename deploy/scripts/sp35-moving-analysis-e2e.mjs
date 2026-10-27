import { chromium } from "@playwright/test";
const origin = new URL(process.env.APPF2_STAGING_URL?.trim() || "");
if (origin.protocol !== "https:" || !origin.hostname.startsWith("appf2-sp35-417-staging.")) throw Error("isolated staging only");
const input = [
 "我下個月要搬家，事情好多，常常忘記自己做了什麼、還有什麼沒做。你可以幫我做一個簡單好用的搬家管理 App 嗎？",
 "我想隨時記下要做的事情，可以修改、刪除、打勾完成，還能分成高、中、低優先順序，方便先處理重要的事。最好也能看到今天完成了幾件事。",
 "另外我需要一張採購清單，像紙箱、膠帶、清潔用品這些東西，可以填數量、改數量，買到了就勾起來。",
 "搬家費用也想順便管理。我希望能設定自己的預算，每花一筆錢就記下來，隨時知道花了多少、還剩多少。",
 "畫面不要太複雜，手機和電腦看起來都要清楚。重新整理網頁後，我記下的東西也不要消失。"
].join("\n\n");
const browser=await chromium.launch();
try {
 const page=await browser.newPage();
 await page.goto(origin.origin,{waitUntil:"domcontentloaded"});
 await page.locator("#composer-input").fill(input);
 const pending=page.waitForResponse(r=>r.request().method()==="POST" && new URL(r.url()).pathname==="/api/v1/intents",{timeout:110000});
 const compiling=page.waitForResponse(r=>r.request().method()==="POST" &&
   /^\/api\/v1\/intents\/[^/]+\/compile$/.test(new URL(r.url()).pathname),
   {timeout:180000}).catch(()=>null);
 await page.locator(".composer-create").click();
 const response=await pending;
 const json=await response.json().catch(()=>({}));
 const status=json?.data?.status || "NONE", code=json?.error?.code || "NONE";
 console.log("STAGING MOVING F01: HTTP="+response.status()+" STATUS="+status+" CODE="+code);
 if(response.status()!==200) throw Error("natural Chinese F01 failed: "+code);
 console.log("STAGING MOVING: real natural Chinese F01 PASS");
 if(status!=="READY") throw Error("natural Chinese F01 needs user clarification: "+status);
 const compile=await compiling;
 if(compile===null) throw Error("moving app F02 never requested");
 const output=await compile.json().catch(()=>({}));
 const validated=compile.status()===200 && output?.data?.status==="VALIDATED";
 console.log("STAGING MOVING F02: HTTP="+compile.status()+" VALIDATED="+validated+
   " CODE="+(output?.error?.code||"NONE"));
 if(!validated) throw Error("natural Chinese moving app F02 not validated");
 await page.locator(".s03-app").waitFor({state:"visible",timeout:60000});
 const inputs=await page.locator(".s03-app input").count();
 const buttons=await page.locator(".s03-app button").count();
 const stats=await page.locator(".s03-app .rt-stat-value").count();
 console.log("STAGING MOVING APP: INTERACTIVE_RENDERED="+(inputs>0&&buttons>0&&stats>0)+
   " INPUTS="+inputs+" BUTTONS="+buttons+" STATS="+stats);
 if(inputs===0 || buttons===0 || stats===0) throw Error("moving app has no executable controls");
 await page.reload({waitUntil:"domcontentloaded"});
 await page.locator(".s03-app").waitFor({state:"visible",timeout:30000});
 console.log("STAGING MOVING: real natural Chinese F01 + F02 + F03 + secure reload PASS");

}finally{await browser.close()}
