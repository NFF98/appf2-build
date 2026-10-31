import {chromium} from "@playwright/test";
const origin=new URL(process.env.APPF2_STAGING_URL?.trim()??"");
if(origin.protocol!=="https:"||!/^appf2-sp35-417-staging\.[a-z0-9-]+\.workers\.dev$/i.test(origin.hostname))
 throw Error("F16 S03 ENTRY TEST STAGING ONLY");
const browser=await chromium.launch({headless:true});
try{
 const ctx=await browser.newContext();
 const requests=[];
 ctx.on("request",r=>{
  const path=new URL(r.url()).pathname;
  if(r.method()==="POST"&&path.startsWith("/api/v1/intents"))requests.push(path);
 });
 const page=await ctx.newPage();
 await page.goto(origin.origin+"/share/5d52e64f-b237-48d0-a28a-25dded034106",{waitUntil:"domcontentloaded"});
 await page.locator(".s03-app").waitFor({state:"visible",timeout:30000});
 const correction=page.locator(".s03-result-action");
 await correction.click();
 const dialog=page.getByRole("dialog",{name:"調整結果"});
 await dialog.waitFor({state:"visible"});
 if(await dialog.locator(".s03-result-item").count()===0)throw Error("S03 F16 did not capture before result");
 await dialog.getByRole("button",{name:"計算規則不對，描述需要修正的地方"}).click();
 await dialog.getByLabel("結果或計算規則哪裡錯了？").fill("搬家預算要把未付款項也算入，計算規則需要修正");
 if(await dialog.getByText("真正修正必須產生並驗證新的 App 版本").count()===0)
  throw Error("S03 F16 silently advertises semantic rule correction");
 await dialog.getByRole("button",{name:"返回選擇"}).click();
 await dialog.getByRole("button",{name:"修改輸入值，立即重新計算（不用 AI）"}).click();
 await dialog.waitFor({state:"hidden"});
 // The product intentionally moves focus in requestAnimationFrame after the dialog unmounts.
 // Wait for that frame, rather than racing React's state commit.
 await page.waitForFunction(()=>globalThis.document.activeElement?.matches(
   ".s03-app input, .s03-app textarea, .s03-app select"
 )===true,null,{timeout:5000});
 const headings=page.locator(".s03-app .rt-text-HEADING");
 const roots=[];
 for(let i=0;i<await headings.count();i++){
  const root=headings.nth(i).locator("xpath=ancestor::div[contains(concat(' ',normalize-space(@class),' '),' rt-container ')][1]");
  roots.push({root,text:await root.locator('input[type="text"]').count(),
    num:await root.locator('input[type="number"]').count(),buttons:await root.locator(".rt-button").count()});
 }
 const budget=roots.find(x=>x.text===0&&x.num===2&&x.buttons>=1)?.root;
 if(!budget)throw Error("F03 MOVING budget input module unavailable");
 const money=budget.locator('input[type="number"]');
 await money.nth(0).fill("200");
 await money.nth(1).fill("37");
 await budget.locator(".rt-button").first().click();
 const stat=await page.locator(".s03-app .rt-stat-value").allTextContents();
 if(!stat.includes("37")||!stat.includes("163"))
  throw Error("F03 result update did not recompute budget expected 200-37=163: "+stat.join(","));
 await page.reload({waitUntil:"domcontentloaded"});
 await page.locator(".s03-app").waitFor({state:"visible",timeout:30000});
 const recovered=await page.locator(".s03-app .rt-stat-value").allTextContents();
 if(!recovered.includes("37")||!recovered.includes("163"))
  throw Error("F03 result correction input change lost on reload");
 if(requests.length)throw Error("Result entry triggered AI/F01: "+requests.length);
 console.log("STAGING RESULT ENTRY: BEFORE SNAPSHOT+NO-AI F03 INPUT EDIT+200-37=163+RELOAD+LOGIC-CORRECTION-HONEST-GATE PASS; F01_POST=0");
 await ctx.close();
}finally{await browser.close();}
