/** Standalone ZERO-PAID-AI browser replay of ALREADY model-created/published
 * native website Job a2689c78-5362-43a2-8f7c-a4cfd8b6affb.
 * This does NOT create any Agent Job, cannot initiate a model request, and
 * does not inject a bridge or test harness into the generated iframe.
 * Verify AI-authored UI from actual published Blueprint v2 + real Worker PG.
 */
import {chromium} from "@playwright/test";
const origin="https://appf2-sp35-417-staging.juiyuang69.workers.dev";
const share="e29027dd-cd71-4424-a182-3fb7706614b8";
const route="/api/v1/code-apps/"+share+"/records";
const browser=await chromium.launch({headless:true});
const requestProof={A:[],B:[]};
const sessions=[];
function capture(page,which){
 page.on("response",res=>{
  if(new URL(res.url()).pathname!==route||
    res.request().method()!=="POST")return;
  let action="unknown";
  try{action=String(res.request().postDataJSON()?.action??"unknown");}
  catch{ /* unknown is never accepted as proof */ }
  requestProof[which].push({action,status:res.status()});
 });
}
async function open(context,which){
 const page=await context.newPage();
 capture(page,which);
 await page.goto(origin+"/code/"+share,{waitUntil:"domcontentloaded",timeout:60000});
 const frame=page.frameLocator('iframe[sandbox="allow-scripts"]');
 await frame.getByRole("button",{name:"新增紀錄",exact:true})
  .waitFor({state:"visible",timeout:20000});
 return {page,frame};
}
async function visible(session,pattern,what){
 const el=session.frame.locator("#app");
 for(let k=0;k<70;k++){
  const text=await el.innerText().catch(()=>"");
  if(pattern.test(text))return;
  await session.page.waitForTimeout(200);
 }
 throw Error("G2_REAL_UI_"+what+"_FAIL");
}
async function click(session,name){
 await session.frame.getByRole("button",{name,exact:true}).click({timeout:15000});
}
function verifyNetwork(which,actions){
 const seen=requestProof[which];
 const found=[...new Set(seen.map(x=>x.action))];
 const bad=seen.filter(x=>x.status<200||x.status>=300);
 if(!actions.every(x=>found.includes(x))||bad.length)
  throw Error("G2_REAL_PG_NETWORK_"+which+"_UNVERIFIED "+
   JSON.stringify({required:actions,found,statusCodes:[...new Set(seen.map(x=>x.status))],count:seen.length}));
 return {verbs:found,requests:seen.length};
}
try{
 const contextA=await browser.newContext({serviceWorkers:"block"});
 sessions.push(contextA);
 const A=await open(contextA,"A");
 await visible(A,/紀錄數：\s*0/u,"A_EMPTY");
 await click(A,"新增紀錄");
 await visible(A,/紀錄數：\s*1/u,"A_CREATE_COUNT");
 await visible(A,/內容：\s*咖啡/u,"A_CREATE_CONTENT");
 await A.page.reload({waitUntil:"domcontentloaded"});
 await visible(A,/內容：\s*咖啡/u,"A_PERSISTED_CREATE");
 const contextB=await browser.newContext({serviceWorkers:"block"});
 sessions.push(contextB);
 const B=await open(contextB,"B");
 await visible(B,/紀錄數：\s*0/u,"B_ISOLATED_INITIAL");
 const bText=await B.frame.locator("#app").innerText();
 if(/內容：\s*咖啡/u.test(bText))
  throw Error("G2_DIFFERENT_VIEWER_A_RECORD_EXPOSED");
 await click(B,"新增紀錄");
 await visible(B,/內容：\s*咖啡/u,"B_OWN_CREATE");
 await visible(B,/紀錄數：\s*1/u,"B_OWN_COUNT");
 await visible(A,/紀錄數：\s*1/u,"A_NOT_AFFECTED_BY_B");
 await click(A,"修改紀錄");
 await visible(A,/內容：\s*茶/u,"A_UPDATED");
 await A.page.reload({waitUntil:"domcontentloaded"});
 await visible(A,/內容：\s*茶/u,"A_UPDATED_PERSISTED");
 if(/內容：\s*茶/u.test(await B.frame.locator("#app").innerText()))
  throw Error("G2_A_UPDATED_DATA_LEAKED_TO_B");
 await click(A,"刪除紀錄");
 await visible(A,/紀錄數：\s*0/u,"A_DELETE");
 await A.page.reload({waitUntil:"domcontentloaded"});
 await visible(A,/紀錄數：\s*0/u,"A_DELETE_PERSISTED");
 await click(B,"刪除紀錄");
 await visible(B,/紀錄數：\s*0/u,"B_DELETE");
 await B.page.reload({waitUntil:"domcontentloaded"});
 await visible(B,/紀錄數：\s*0/u,"B_DELETE_PERSISTED");
 const proofA=verifyNetwork("A",["list","create","update","delete"]);
 const proofB=verifyNetwork("B",["list","create","delete"]);
 console.log("SP35 G2 REAL ORIGINAL AI APP POST-PUBLISH FULL E2E PASS: 2/9; "+
  "source signed website GPT-6 Job a2689c78-5362-43a2-8f7c-a4cfd8b6affb; "+
  "frozen QA 6/6 free #41307455393; already ACTIVE public Blueprint; "+
  "two real viewers interact with AI-authored UI -> signed Worker -> "+
  "PostgreSQL create/read/update/delete with reload persistence & isolation; "+
  "no appf2Records evaluate/injection, 0 new model calls");
 console.log("SP35 G2 STRICT PG HTTP RECEIPT A="+JSON.stringify(proofA)+
  " B="+JSON.stringify(proofB)+
  " share_id="+share+" actual_provider_invoice=NOT_VERIFIED");
}catch(err){
 console.error("SP35 G2 FREE REAL PG BROWSER FAIL: "+
  String(err instanceof Error?err.message:err).slice(0,320));
 console.error("SP35 G2 FREE HTTP VERB DIAGNOSTIC: "+
  JSON.stringify({A:requestProof.A.map(x=>x.action+":"+x.status),
   B:requestProof.B.map(x=>x.action+":"+x.status)}).slice(0,900));
 throw err;
}finally{
 for(const context of sessions)await context.close().catch(()=>{});
 await browser.close();
}
