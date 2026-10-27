// Bounded, explicit one-shot paid regression: original ordinary-language moving request.\n// Assertions remain fail-closed through F01, F02, F03 interactions and reload.\nimport { chromium } from "@playwright/test";
const origin = new URL(process.env.APPF2_STAGING_URL?.trim() || "");
if (origin.protocol !== "https:" || !/^appf2-sp35-417-staging\.[a-z0-9-]+\.workers\.dev$/i.test(origin.hostname) || origin.pathname!=="/" || origin.search || origin.hash) throw Error("isolated staging only");
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
 if(!validated) {
   const info=output?.error?.details||{};
   const coverage=typeof info.coverage_status==="string" &&
      /^(FULLY_SUPPORTED|PARTIALLY_SUPPORTED|UNSUPPORTED|EXTERNAL_OR_HEAVY_REQUIRED)$/.test(info.coverage_status)?
      info.coverage_status:"UNKNOWN";
   const missing=Number.isInteger(info.unsupported_count)&&info.unsupported_count>=0?
     info.unsupported_count:-1;
   console.log("STAGING MOVING F04: COVERAGE="+coverage+" UNSUPPORTED_COUNT="+missing);
   throw Error("natural Chinese moving app F02 not validated");
 }
 await page.locator(".s03-app").waitFor({state:"visible",timeout:60000});
 const inputs=await page.locator(".s03-app input").count();
 const buttons=await page.locator(".s03-app button").count();
 const stats=await page.locator(".s03-app .rt-stat-value").count();
 console.log("STAGING MOVING APP: INTERACTIVE_RENDERED="+(inputs>0&&buttons>0&&stats>0)+
   " INPUTS="+inputs+" BUTTONS="+buttons+" STATS="+stats);
 if(inputs===0 || buttons===0 || stats===0) throw Error("moving app has no executable controls");
 // Independent, real user actions on the actual AI-generated F03 controls.
 // Detect typed module surfaces by input/number structure rather than forcing
 // the model to copy fixed English LifePilot section titles.
 const sections=await page.locator(".s03-app .rt-text-HEADING").count();
 const roots=[];
 for(let i=0;i<sections;i++){
   const root=page.locator(".s03-app .rt-text-HEADING").nth(i)
     .locator("xpath=ancestor::div[contains(concat(' ', normalize-space(@class), ' '), ' rt-container ')][1]");
   roots.push({root,text:await root.locator('input[type="text"]').count(),
     num:await root.locator('input[type="number"]').count(),
     buttons:await root.locator(".rt-button").count()});
 }
 console.log("STAGING MOVING MODULE SIGNATURES: "+
   roots.map(x=>x.text+"T"+x.num+"N"+x.buttons+"B").join("|").slice(0,150));
 const task=roots.find(x=>x.text>=2 && x.num===0 && x.buttons>=1)?.root;
 const shopping=roots.find(x=>x.text===1 && x.num===1 && x.buttons>=1)?.root;
 const budget=roots.find(x=>x.text===0 && x.num===2 && x.buttons>=1)?.root;
 if(!task || !shopping || !budget) throw Error("MOVING REQUIRED MODULE MISSING: "+[
   task?"":"TASKS",shopping?"":"SHOPPING",budget?"":"BUDGET"].filter(Boolean).join(","));
 const numeric=async root=>(await root.locator(".rt-stat-value").allTextContents())
   .map(s=>Number(s.replace(/[^0-9.-]/g,""))).filter(Number.isFinite);
 const taskInput=task.locator('input[type="text"]').first();
 const priority=task.getByRole("combobox",{name:"Task priority"});
 if(await priority.count()===1) await priority.selectOption("Low");
 await taskInput.fill("MOVE-TASK-A");
 await task.locator(".rt-button").first().click();
 const tasks=task.locator(".rt-list").first().locator(".rt-list-item");
 if(await tasks.filter({hasText:"MOVE-TASK-A"}).count()!==1)
   throw Error("MOVING TASKS: create A failed");
 if(await priority.count()===1) await priority.selectOption("High");
 await taskInput.fill("MOVE-TASK-B");
 await task.locator(".rt-button").first().click();
 if(await tasks.filter({hasText:"MOVE-TASK-B"}).count()!==1)
   throw Error("MOVING TASKS: create B failed");
 await task.locator('input[type="text"]').nth(1).fill("MOVE-TASK-B-EDITED");
 await tasks.filter({hasText:"MOVE-TASK-B"}).locator(".rt-button").nth(1).click();
 if(await tasks.filter({hasText:"MOVE-TASK-B-EDITED"}).count()!==1)
   throw Error("MOVING TASKS: edit B failed");
 const beforeTask=await numeric(task);
 await tasks.filter({hasText:"MOVE-TASK-B-EDITED"}).locator(".rt-button").first().click();
 const afterTask=await numeric(task);
 if(!beforeTask.some((v,i)=>v!==afterTask[i]))
   throw Error("MOVING TASKS: completion metric not updated");
 await tasks.filter({hasText:"MOVE-TASK-A"}).locator(".rt-button").nth(2).click();
 if(await tasks.filter({hasText:"MOVE-TASK-A"}).count()!==0 ||
   await tasks.filter({hasText:"MOVE-TASK-B-EDITED"}).count()!==1)
   throw Error("MOVING TASKS: wrong row deleted");
 const filter=task.getByRole("combobox",{name:"Priority filter"});
 if(await priority.count()===1 && await filter.count()!==1)
   throw Error("MOVING TASKS: priority filter missing");
 if(await filter.count()===1){
   await filter.selectOption("High");
   if(await task.locator(".rt-list").last().getByText("MOVE-TASK-B-EDITED",{exact:true}).count()!==1)
     throw Error("MOVING TASKS: high-priority filter failed");
 }
 console.log("STAGING MOVING REAL TASKS: ADD_EDIT_DONE_DELETE_PRIORITY PASS");
 await shopping.locator('input[type="text"]').first().fill("MOVE-BOX");
 await shopping.locator('input[type="number"]').first().fill("3");
 await shopping.locator(".rt-button").first().click();
 const items=shopping.locator(".rt-list-item");
 const box=items.filter({hasText:"MOVE-BOX"});
 if(await box.count()!==1) throw Error("MOVING SHOPPING: create item failed");
 await shopping.locator('input[type="number"]').first().fill("5");
 await box.locator(".rt-button").nth(1).click();
 if(!(await box.locator(".rt-stat-value").allTextContents()).some(s=>Number(s)===5))
   throw Error("MOVING SHOPPING: quantity edit failed");
 const beforeShopping=await numeric(shopping);
 await box.locator(".rt-button").first().click();
 const afterShopping=await numeric(shopping);
 if(!beforeShopping.some((v,i)=>v!==afterShopping[i]))
   throw Error("MOVING SHOPPING: purchased count not updated");
 console.log("STAGING MOVING REAL SHOPPING: ADD_QUANTITY_PURCHASE PASS");
 await budget.locator('input[type="number"]').nth(0).fill("200");
 await budget.locator('input[type="number"]').nth(1).fill("37");
 await budget.locator(".rt-button").first().click();
 const money=await numeric(budget);
 if(!money.includes(37)||!money.includes(163))
   throw Error("MOVING BUDGET: spent/remaining arithmetic incorrect");
 console.log("STAGING MOVING REAL MONEY: BUDGET_200_EXPENSE_37_REMAINING_163 PASS");
 await page.reload({waitUntil:"domcontentloaded"});
 await page.locator(".s03-app").waitFor({state:"visible",timeout:30000});
 if(await page.locator(".s03-app").getByText("MOVE-TASK-B-EDITED",{exact:true}).count()===0)
   throw Error("MOVING RELOAD: edited completed task lost");
 const loadedBox=page.locator(".s03-app .rt-list-item").filter({hasText:"MOVE-BOX"});
 if(await loadedBox.count()!==1 ||
   !(await loadedBox.locator(".rt-stat-value").allTextContents()).some(s=>Number(s)===5))
   throw Error("MOVING RELOAD: shopping item/edited quantity lost");
 const allMoney=(await page.locator(".s03-app .rt-stat-value").allTextContents())
   .map(s=>Number(s.replace(/[^0-9.-]/g,""))).filter(Number.isFinite);
 if(!allMoney.includes(37)||!allMoney.includes(163))
   throw Error("MOVING RELOAD: budget/expense lost");
 console.log("STAGING MOVING: REAL CHINESE TASKS + SHOPPING + BUDGET + RELOAD ACTIONS PASS");

}finally{await browser.close()}
