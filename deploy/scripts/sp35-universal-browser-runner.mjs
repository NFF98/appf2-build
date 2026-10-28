/* Isolated Chromium evaluator of a pre-code, frozen requirement plan.
 * No eval in Worker/host. Generated code runs ONLY in a sandboxed opaque-origin iframe.
 * All assertions come from the independent acceptance plan, not the generated source.
 */
import {chromium} from "@playwright/test";
import {createHash} from "node:crypto";
const escapeAttr=value=>String(value).replaceAll("&","&amp;").replaceAll('"',"&quot;")
 .replaceAll("<","&lt;").replaceAll(">","&gt;");
function frameHtml(script){
 if(typeof script!=="string"||!script||Buffer.byteLength(script,"utf8")>128*1024||
  /<\/script\b/iu.test(script)||script.includes("\0"))throw Error("QA_SOURCE_INVALID");
 const digest=createHash("sha256").update(script,"utf8").digest("base64");
 const csp=["default-src 'none'","script-src 'sha256-"+digest+"'",
  "script-src-attr 'none'","style-src 'unsafe-inline'","connect-src 'none'",
  "img-src data:","worker-src 'none'","frame-src 'none'","form-action 'none'",
  "navigate-to 'none'","base-uri 'none'"].join("; ");
 const doc='<!doctype html><html><head><meta charset="utf-8">'+
  '<meta http-equiv="Content-Security-Policy" content="'+escapeAttr(csp)+'"></head>'+
  '<body><main id="app"></main><script>'+script+'</script></body></html>';
 return '<!doctype html><html><body><iframe title="isolated-code-candidate" '+
  'referrerpolicy="no-referrer" sandbox="allow-scripts" srcdoc="'+escapeAttr(doc)+'"></iframe></body></html>';
}
async function locator(frame,role,name){
 const found=name===""?frame.getByRole(role):frame.getByRole(role,{name,exact:true});
 if(await found.count()!==1)throw Error("QA_ROLE_AMBIGUOUS_OR_MISSING");
 return found.first();
}
async function perform(frame,step){
 const target=await locator(frame,step.role,step.name);
 if(step.action==="click")await target.click({timeout:2500});
 else if(step.action==="fill")await target.fill(step.value,{timeout:2500});
 else throw Error("QA_UNSUPPORTED_ACTION");
}
async function check(frame,assertion,before){
 if(assertion.kind==="text_includes")
  return (await frame.locator("#app").innerText()).includes(assertion.text);
 if(assertion.kind==="text_appears")
  return !before.__visibleText.includes(assertion.text)&&
   (await frame.locator("#app").innerText()).includes(assertion.text);
 if(assertion.kind==="element_count")
  return await frame.locator(assertion.selector).count()===assertion.count;
 if(assertion.kind==="visible")
  return await (await locator(frame,assertion.role,assertion.name)).isVisible();
 if(assertion.kind==="pure_case"){
  const value=await frame.locator("#app").evaluate((node,probe)=>{
   const win=node.ownerDocument.defaultView;
   const fn=win?.[probe.function_name];
   if(typeof fn!=="function")return {error:"NO_PURE_FUNCTION"};
   return fn(...probe.input);
  },assertion);
  const actual=assertion.result_path===undefined?value:value?.[assertion.result_path];
  return JSON.stringify(actual)===JSON.stringify(assertion.expected);
 }
 if(assertion.kind==="text_changes")
  return before[assertion.selector]!==await frame.locator(assertion.selector).first().innerText();
 return false;
}
async function verifyCase(browser,javascript,criterion){
 if(!criterion.automatable)return {id:criterion.id,verdict:"UNTESTED",detail:"HUMAN_DECISION_REQUIRED"};
 const page=await browser.newPage();
 const errors=[];
 page.on("pageerror",error=>{errors.push(String(error).slice(0,120));});
 try{
  // All network requests are denied, including requests the untrusted App might initiate.
  await page.route("**/*",route=>route.abort());
  await page.setContent(frameHtml(javascript),{waitUntil:"domcontentloaded",timeout:5000});
  const frame=page.frameLocator('iframe[sandbox="allow-scripts"]');
  await frame.locator("#app").waitFor({state:"visible",timeout:3500});
  const before={__visibleText:await frame.locator("#app").innerText()};
  for(const a of criterion.assertions)
   if(a.kind==="text_changes")
    before[a.selector]=await frame.locator(a.selector).first().innerText();
  for(const step of criterion.steps)await perform(frame,step);
  if(errors.length)return {id:criterion.id,verdict:"FAIL",detail:"BROWSER_EXCEPTION:"+errors[0]};
  for(const assertion of criterion.assertions){
   if(!(await check(frame,assertion,before)))
    return {id:criterion.id,verdict:"FAIL",detail:"ASSERTION_FAILED:"+assertion.kind};
  }
  return {id:criterion.id,verdict:"PASS",detail:"INDEPENDENT_BROWSER_OBSERVED"};
 }catch(e){
  return {id:criterion.id,verdict:"FAIL",detail:"BROWSER_ERROR:"+String(e).slice(0,120)};
 }finally{await page.close().catch(()=>undefined);}
}
export async function runBrowserQa(draft,plan,options={}){
 const launch=options.launch??(()=>chromium.launch({headless:true}));
 const browser=await launch();
 try{
  const results=[];
  for(const criterion of plan.criteria)
   results.push(await verifyCase(browser,draft.javascript,criterion));
  return results;
 }finally{await browser.close();}
}
export async function runRepairQa({draft,plan,repair,maxRepairs=0,launch}){
 const max=Math.min(2,Math.max(0,Math.floor(maxRepairs)));
 const attempts=[];
 for(let round=0;round<=max;round++){
  const results=await runBrowserQa(draft,plan,{launch}).catch(()=>[]);
  const complete=plan.criteria.every(c=>results.some(r=>r.id===c.id&&r.verdict==="PASS"));
  const untested=plan.criteria.some(c=>!c.automatable)||
   results.some(x=>x.verdict==="UNTESTED")||results.length!==plan.criteria.length;
  attempts.push({round,results,passed:complete});
  if(complete)return {status:"VERIFIED",draft,attempts};
  if(untested)return {status:"NEEDS_HUMAN",draft,attempts};
  if(round>=max||!repair)return {status:"FAILED",draft,attempts};
  // Caller explicitly owns the paid-model budget and must pass a consented repair.
  const next=await repair(draft,plan,results,round+1).catch(()=>null);
  if(!next||next.javascript===draft.javascript)return {status:"FAILED",draft,attempts};
  draft=next;
 }
 return {status:"FAILED",draft,attempts};
}
