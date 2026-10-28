import {runBrowserQa,runRepairQa} from "./sp35-universal-browser-runner.mjs";
// Both programs are deliberately different. The engine must not know their category.
const newIdea="我發明了一種收藏星球標本的新工具，按新增要累計，按瀏覽顯示清單";
const plan={version:"1",criteria:[
 {id:"collect",source_quote:"按新增要累計",description:"收藏累計",automatable:true,
  steps:[{action:"click",role:"button",name:"新增"}],
  assertions:[{kind:"text_includes",text:"收藏數：1"}]},
 {id:"browse",source_quote:"按瀏覽顯示清單",description:"換頁瀏覽",automatable:true,
  steps:[{action:"click",role:"button",name:"瀏覽"}],
  assertions:[{kind:"text_includes",text:"標本清單"}]}
]};
if(!plan.criteria.every(c=>newIdea.includes(c.source_quote)))throw Error("QA_FIXTURE_INVALID");
plan.criteria.push({id:"score_math",source_quote:"增加",description:"deterministic math",automatable:true,
 steps:[],assertions:[{kind:"pure_case",function_name:"specimenScore",input:[[2,4,6]],expected:12}]});
const good=`
const root=document.getElementById("app");let n=0;
root.innerHTML='<p id="score">收藏數：0</p><button>新增</button><button>瀏覽</button><div id="view"></div>';
const buttons=root.querySelectorAll("button");
buttons[0].onclick=()=>{n++;root.querySelector("#score").textContent="收藏數："+n;};
buttons[1].onclick=()=>root.querySelector("#view").textContent="標本清單";
window.specimenScore=(items)=>items.reduce((sum,x)=>sum+x,0);
`;
const broken=good.replace('root.querySelector("#view").textContent="標本清單"','root.querySelector("#view").textContent="歡迎"');
const pass=await runBrowserQa({title:"novel",javascript:good},plan);
if(!pass.every(x=>x.verdict==="PASS"))throw Error("QA_VALID_APP_FALSE_REJECT:"+JSON.stringify(pass));
const fail=await runBrowserQa({title:"broken",javascript:broken},plan);
if(!fail.some(x=>x.id==="browse"&&x.verdict==="FAIL"))throw Error("QA_MISSING_VIEW_FALSE_PASS:"+JSON.stringify(fail));
let repairs=0;
const repaired=await runRepairQa({draft:{title:"novel",javascript:broken},plan,maxRepairs:2,
 repair:async()=>{repairs++;return {title:"novel",javascript:good};}});
if(repaired.status!=="VERIFIED"||repairs!==1)throw Error("QA_REPAIR_FAIL");
const blocked=await runRepairQa({draft:{title:"broken",javascript:broken},plan});
if(blocked.status!=="FAILED")throw Error("QA_BROKEN_PUBLISHED");
const review={...plan,criteria:[{...plan.criteria[0],automatable:false}]};
const untested=await runRepairQa({draft:{title:"x",javascript:good},plan:review,maxRepairs:2});
if(untested.status!=="NEEDS_HUMAN")throw Error("QA_UNTESTED_FALSE_PASS");
console.log("UNIVERSAL QA PASS: 2 distinct requirements, broken view rejected, corrected code verified; "+
 "no-AI repair adapter bounded, human-only requirements blocked; model calls=0");
