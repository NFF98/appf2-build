/* REAL corrected source browser E2E; no AI call, no publication.
 * Assert playability and domain semantics, not merely string changes.
 */
import {chromium} from "@playwright/test";
import {readFile} from "node:fs/promises";
import {runBrowserQa} from "./sp35-universal-browser-runner.mjs";
const source=await readFile(new URL("../fixtures/sp35-dice-corrected.source",import.meta.url),"utf8");
const tests=[
 {id:"two_pairs",source_quote:"規則",description:"Two pairs",automatable:true,steps:[],
  assertions:[{kind:"pure_case",function_name:"eighteenlaRule",input:[[2,2,6,6]],result_path:"score",expected:12}]},
 {id:"single_pair",source_quote:"規則",description:"Single pair",automatable:true,steps:[],
  assertions:[{kind:"pure_case",function_name:"eighteenlaRule",input:[[2,2,4,5]],result_path:"score",expected:9}]},
 {id:"invalid_triple",source_quote:"規則",description:"Triple invalid",automatable:true,steps:[],
  assertions:[{kind:"pure_case",function_name:"eighteenlaRule",input:[[2,2,2,4]],result_path:"score",expected:0}]},
 {id:"invalid_no_pair",source_quote:"規則",description:"No pair invalid",automatable:true,steps:[],
  assertions:[{kind:"pure_case",function_name:"eighteenlaRule",input:[[1,2,3,4]],result_path:"score",expected:0}]},
 {id:"four_dice",source_quote:"四顆",description:"Four dice visible",automatable:true,steps:[],
  assertions:[{kind:"element_count",selector:".dice",count:4}]},
 {id:"results_tab",source_quote:"結果",description:"Results navigation",automatable:true,
  steps:[{action:"click",role:"button",name:"結果"}],
  assertions:[{kind:"text_includes",text:"本回合結果"}]},
 {id:"ranking_tab",source_quote:"排行",description:"Leaderboard navigation",automatable:true,
  steps:[{action:"click",role:"button",name:"排行"}],
  assertions:[{kind:"text_includes",text:"累積排行榜"}]},
 {id:"rules_tab",source_quote:"規則",description:"Rules navigation",automatable:true,
  steps:[{action:"click",role:"button",name:"規則"}],
  assertions:[{kind:"text_includes",text:"十八啦規則"}]}
];
const report=await runBrowserQa({title:"18la corrected",javascript:source},{version:"1",criteria:tests});
const failures=report.filter(r=>r.verdict!=="PASS");
console.log("REPAIRED_DICE_GENERIC_QA "+JSON.stringify(report));
if(failures.length)throw Error("REPAIRED_DICE_GENERIC_QA_FAIL: "+JSON.stringify(failures));
const browser=await chromium.launch({headless:true});
try{
 const page=await browser.newPage();
 const digest=await import("node:crypto").then(x=>x.createHash("sha256").update(source).digest("base64"));
 const csp=["default-src 'none'","script-src 'sha256-"+digest+"'","style-src 'unsafe-inline'",
 "connect-src 'none'","img-src data:","worker-src 'none'"].join("; ");
 const escape=x=>x.replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;");
 const srcdoc='<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="'+escape(csp)+'"></head><body><main id="app"></main><script>'+source+'</script></body></html>';
 await page.setContent('<iframe sandbox="allow-scripts" title="game" srcdoc="'+escape(srcdoc)+'"></iframe>');
 const frame=page.frameLocator('iframe[sandbox="allow-scripts"]');
 await frame.locator("#app").waitFor({state:"visible",timeout:6000});
 if(await frame.locator(".dice").count()!==4)throw Error("FOUR_DICE_MISSING");
 const seed=async values=>frame.locator("#app").evaluate((node,seq)=>{
  let n=0;node.ownerDocument.defaultView.Math.random=()=> (seq[n++%seq.length]-0.5)/6;
 },values);
 const roll=frame.getByRole("button",{name:"擲骰子"});
 await seed([2,2,2,4]);await roll.click();await page.waitForTimeout(1450);
 let state=await frame.locator("#game-turn").innerText();
 if(!state.includes("玩家一"))throw Error("INVALID_ROLL_CHANGED_PLAYER:"+state);
 await seed([2,2,4,5]);await roll.click();await page.waitForTimeout(1450);
 state=await frame.locator("#game-turn").innerText();
 if(!state.includes("玩家二"))throw Error("FIRST_VALID_DID_NOT_ADVANCE:"+state);
 await seed([2,2,6,6]);await roll.click();await page.waitForTimeout(1450);
 if(await frame.locator("#view-results").isHidden())throw Error("RESULT_PAGE_NOT_OPENED");
 const result=await frame.locator("#game-winner").innerText();
 if(!result.includes("玩家二"))throw Error("WRONG_WINNER:"+result);
 await frame.getByRole("button",{name:"排行"}).click();
 const rankings=await frame.locator("#game-ranking").innerText();
 if(!rankings.includes("玩家二")||!rankings.includes("1 勝"))throw Error("RANKING_WRONG:"+rankings);
 await frame.getByRole("button",{name:"結果"}).click();
 await frame.getByRole("button",{name:"開始下一回合"}).click();
 if(!(await frame.locator("#game-turn").innerText()).includes("第 2 回合"))throw Error("NEXT_ROUND_FAIL");
 await frame.getByRole("button",{name:"重新開始"}).click();
 if(!(await frame.locator("#game-turn").innerText()).includes("第 1 回合"))throw Error("RESET_NOT_CLEAR_ROUNDS");
 console.log("REPAIRED_DICE_FULL_BROWSER_PASS: triple reroll, 4 real dice, exact result, turn, winner, ranking, tabs, next round, reset; model_calls=0");
}finally{await browser.close();}
