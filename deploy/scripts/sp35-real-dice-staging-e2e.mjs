/* One-shot real staging dice creation. Never use fixtures as proof of generated app behavior. */
import {chromium} from "@playwright/test";
const endpoint=process.env.APPF2_STAGING_URL?.trim();
if(!endpoint||!/^https:\/\/appf2-sp35-417-staging\.[a-z0-9-]+\.workers\.dev$/iu.test(endpoint))
  throw Error("DICE_STAGING_ONLY");
const origin=new URL(endpoint).origin;
const prompt="幫我做一個漂亮的十八啦骰子遊戲，可以按按鈕擲四顆骰子，有骰子點數、動畫、十八啦規則判斷、計分及重新開始功能。";
const browser=await chromium.launch({headless:true});
let generations=0;
try{
 const owner=await browser.newContext();
 owner.on("request",request=>{
   if(request.method()==="POST"&&new URL(request.url()).pathname==="/api/v1/code-apps")generations++;
 });
 const page=await owner.newPage();
 await page.goto(origin,{waitUntil:"domcontentloaded"});
 const catalog=await page.request.get(origin+"/api/v1/code-apps-public");
 if(catalog.status()!==200)throw Error("DICE_CATALOG_HTTP_"+catalog.status());
 const existing=(await catalog.json())?.data?.apps?.find(x=>typeof x.title==="string"&&x.title.includes("十八啦"));
 let id=existing?.share_id;
 if(!id){
   await page.getByRole("textbox",{name:"描述你想做的 App"}).fill(prompt);
   await page.getByLabel(/我同意產生一次付費 AI 請求/).check();
   await page.getByRole("button",{name:"生成 Blueprint v2 App"}).click();
   // Exactly one paid generation attempt. A failure must be reported, never silently retried.
   await page.waitForURL(/\/code\/[0-9a-f-]{36}$/iu,{timeout:75000}).catch(async()=>{
     const visible=await page.getByRole("alert").allTextContents().catch(()=>[]);
     throw Error("DICE_GENERATION_FAILED_ONCE: "+visible.join(" ").slice(0,160));
   });
   id=page.url().split("/").at(-1);
 }
 const direct=origin+"/code/"+id;
 const saved=await page.request.get(origin+"/api/v1/code-apps/"+id);
 if(saved.status()!==200)throw Error("DICE_APP_NOT_DURABLE");
 await page.goto(direct,{waitUntil:"domcontentloaded"});
 const frame=page.frameLocator('iframe[sandbox="allow-scripts"]');
 const app=frame.locator("#app");
 await app.waitFor({state:"visible",timeout:15000});
 const before=await app.innerText();
 const roll=frame.getByRole("button",{name:/擲|搖|投|roll/i}).first();
 await roll.waitFor({state:"visible",timeout:10000});
 const snapshots=[];
 for(let n=0;n<4;n++){
   await roll.click();
   await page.waitForTimeout(1200);
   snapshots.push(await app.innerText());
 }
 if(!snapshots.some(s=>s!==before)||new Set(snapshots).size<2)
   throw Error("DICE_ROLL_NO_OBSERVABLE_CHANGE");
 const last=snapshots.at(-1);
 if(!/(得分|分數|計分|積分|點數|score|points)/iu.test(last))
   throw Error("DICE_SCORE_NOT_VISIBLE");
 const reset=frame.getByRole("button",{name:/重新|重置|再來|新遊戲|reset|restart/i}).first();
 await reset.waitFor({state:"visible",timeout:10000});
 await reset.click();
 const cleared=await app.innerText();
 if(cleared===last)throw Error("DICE_RESET_DID_NOT_CHANGE_STATE");
 const guest=await browser.newContext();
 const guestPage=await guest.newPage();
 await guestPage.goto(direct,{waitUntil:"domcontentloaded"});
 const guestFrame=guestPage.frameLocator('iframe[sandbox="allow-scripts"]');
 const guestRoll=guestFrame.getByRole("button",{name:/擲|搖|投|roll/i}).first();
 await guestRoll.waitFor({state:"visible",timeout:15000});
 await guestRoll.click();
 await guestPage.reload();
 await guestFrame.getByRole("button",{name:/擲|搖|投|roll/i}).first()
   .waitFor({state:"visible",timeout:15000});
 if(generations>1)throw Error("DICE_MULTIPLE_MODEL_REQUESTS");
 console.log("DICE STAGING BROWSER INTERACTION PASS: "+id+
   "; generated="+(generations===1?"ONE_PAID_CALL":"REUSED_PUBLISHED_CARD")+
   "; roll changed UI, score text present, reset changed UI, stranger click and reload; "+
   "FOUR_DICE_COUNT_ANIMATION_AND_RULE_CORRECTNESS_NOT_YET_SEMANTICALLY_VERIFIED");
 await guest.close();await owner.close();
}finally{await browser.close();}
