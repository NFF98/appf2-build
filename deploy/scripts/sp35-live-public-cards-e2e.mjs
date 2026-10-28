import { chromium } from "@playwright/test";
const origin=new URL(process.env.APPF2_STAGING_URL?.trim()||"");
if(origin.protocol!=="https:"||!/^appf2-sp35-417-staging\.[a-z0-9-]+\.workers\.dev$/i.test(origin.hostname))throw Error("STAGING only");
const expected=[
 {name:"LifePilot",share:"aa0930e0-22c5-4603-95e2-39021a06aae1",modules:["My Today","Smart Tasks","Shopping List","Money Snapshot","Healthy Habits"]},
 {name:"Moving",share:"5d52e64f-b237-48d0-a28a-25dded034106",modules:[]}
];
const browser=await chromium.launch({headless:true});
try{
 // eslint-disable-next-line max-depth -- Real live-card F03 actions, no AI calls, and strict cross-user isolation.
 for(const item of expected){
  const context=await browser.newContext();
  const page=await context.newPage();const f01=[];
  context.on("request",request=>{
    const path=new URL(request.url()).pathname;
    if(request.method()==="POST"&&path.startsWith("/api/v1/intents"))f01.push(path);
  });
  await page.goto(origin.origin,{waitUntil:"domcontentloaded"});
  const gallery=page.locator(".saved-app-card").filter({hasText:item.name==="LifePilot"?"LifePilot":"搬家管理"});
  await gallery.getByRole("button",{name:"直接使用（不用 AI）"}).click();
  await page.locator(".s03-app").waitFor({state:"visible",timeout:30000});
  if(!page.url().endsWith("/share/"+item.share))throw Error(item.name+" WRONG SHARE URL");
  if(item.modules.length){
    for(const name of item.modules){
      if(await page.locator(".s03-app").getByText(name,{exact:true}).count()===0)
        throw Error(item.name+" missing section "+name);
    }
  }
  const numbers=page.locator('.s03-app input[type="number"]');
  const allInputs=page.locator(".s03-app input");
  const before=await allInputs.count();
  if(before<2)throw Error(item.name+" NOT INTERACTIVE: "+before);
  const textInputs=page.locator('.s03-app input[type="text"]');
  if(await textInputs.count()){
    const first=textInputs.first();
    await first.fill("SP35-PUBLIC-"+item.name);
    const section=first.locator("xpath=ancestor::div[contains(concat(' ',normalize-space(@class),' '),' rt-container ')][1]");
    await section.locator(".rt-button").first().click();
    await page.locator(".s03-app").getByText("SP35-PUBLIC-"+item.name,{exact:true}).first().waitFor({state:"visible",timeout:12000});
  } else if(await numbers.count()){
    await numbers.first().fill("200");
  }
  await page.reload({waitUntil:"domcontentloaded"});
  await page.locator(".s03-app").waitFor({state:"visible",timeout:30000});
  if(await textInputs.count()){
    if(await page.locator(".s03-app").getByText("SP35-PUBLIC-"+item.name,{exact:true}).count()===0)
      throw Error(item.name+" EDIT LOST AFTER RELOAD");
  }
  const link=origin.origin+"/share/"+item.share;
  const second=await browser.newContext();
  const direct=await second.newPage();
  await direct.goto(link,{waitUntil:"domcontentloaded"});
  await direct.locator(".s03-app").waitFor({state:"visible",timeout:30000});
  if(await direct.locator(".s03-app").getByText("SP35-PUBLIC-"+item.name,{exact:true}).count())
    throw Error(item.name+" RECIPIENT STATE LEAKED");
  if(f01.length)throw Error(item.name+" PAID F01 CALL "+f01.length);
  console.log("STAGING PUBLIC REAL "+item.name+": CARD+F03_ACTION+RELOAD+DIRECT_LINK+ISOLATION PASS; F01_POST=0");
  await second.close();await context.close();
 }
}finally{await browser.close();}
