/* Generic QA engine on a real, previously-published failing artifact. No model calls. */
import {runBrowserQa} from "./sp35-universal-browser-runner.mjs";
const origin=new URL(process.env.APPF2_STAGING_URL??"https://appf2-sp35-417-staging.juiyuang69.workers.dev").origin;
if(!/^https:\/\/appf2-sp35-417-staging\.[a-z0-9-]+\.workers\.dev$/u.test(origin))
 throw Error("STAGING_ONLY");
const shareId="c7bbf132-9538-404f-9153-4ee48ee25a1b";
const prompt="幫我做一個漂亮的十八啦骰子遊戲，可以按按鈕擲四顆骰子，有骰子點數、動畫、十八啦規則判斷、計分及重新開始功能。";
const sourceResponse=await fetch(origin+"/api/v1/code-apps/"+shareId);
if(!sourceResponse.ok)throw Error("REAL_CODE_UNAVAILABLE_"+sourceResponse.status);
const data=await sourceResponse.json();
const javascript=data?.data?.artifact?.javascript;
if(typeof javascript!=="string")throw Error("NO_REAL_SOURCE");
const plan={version:"1",criteria:[
 {id:"four_values",source_quote:"擲四顆骰子",description:"四顆可視骰子",automatable:true,
  steps:[],assertions:[{kind:"element_count",selector:".dice",count:4}]},
 {id:"two_pairs",source_quote:"十八啦規則判斷",description:"兩對為剩餘兩顆相加",automatable:true,
  steps:[],assertions:[{kind:"pure_case",function_name:"eighteenlaRule",input:[[2,2,6,6]],result_path:"score",expected:12}]},
 {id:"three_same",source_quote:"十八啦規則判斷",description:"三同一異無效不計分",automatable:true,
  steps:[],assertions:[{kind:"pure_case",function_name:"eighteenlaRule",input:[[2,2,2,4]],result_path:"score",expected:0}]},
 {id:"reset",source_quote:"重新開始功能",description:"可操作重設",automatable:true,
  steps:[],assertions:[{kind:"visible",role:"button",name:"重新開始"}]}
]};
if(!plan.criteria.every(c=>prompt.includes(c.source_quote)))throw Error("REQUIREMENT_NOT_FROM_PROMPT");
const results=await runBrowserQa({title:"published App",javascript},plan);
const byId=new Map(results.map(x=>[x.id,x]));
if(byId.get("two_pairs")?.verdict!=="FAIL"||byId.get("three_same")?.verdict!=="FAIL")
 throw Error("GENERIC_QA_FAILED_TO_DETECT_REAL_SEMANTIC_BUGS: "+JSON.stringify(results));
console.log("REAL UNIVERSAL QA CORRECTLY REJECTED BROKEN APP: "+JSON.stringify(results));
