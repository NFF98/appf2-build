/**
 * Independent multi-file acceptance verifier. Runs in a separate trusted
 * Chromium process against an already isolated, immutable build artifact.
 * The QA plan is frozen from the ORIGINAL user prompt before coding.
 *
 * Important: CI can call this only with committed trusted fixtures. In actual
 * service this must live in a separately isolated trusted verifier, NOT the
 * model worker or an ordinary GitHub job executing model-authored code.
 */
import {createHash} from "node:crypto";
import {parseQaPlan} from "../../dist/src/platform/qa/requirement-contract.js";
const SAFE_STATIC=/^\/(?:|index\.html|assets\/[A-Za-z0-9_.-]+)$/u;
const digest=s=>"sha256:"+createHash("sha256").update(s).digest("hex");
async function one(frame,role,name){
 const found=name===""?frame.getByRole(role):frame.getByRole(role,{name,exact:true});
 if(await found.count()!==1)throw Error("QA_MISSING_OR_AMBIGUOUS_CONTROL");
 return found;
}
async function perform(frame,step){
 const control=await one(frame,step.role,step.name);
 if(step.action==="click")await control.click({timeout:3000});
 else if(step.action==="fill")await control.fill(step.value,{timeout:3000});
 else throw Error("QA_ACTION_NOT_ALLOWED");
}
async function assertExpected(page,check,before){
 if(check.kind==="text_includes")
  return (await page.locator("body").innerText()).includes(check.text);
 if(check.kind==="text_appears")
  return !before.visibleText.includes(check.text)&&
   (await page.locator("body").innerText()).includes(check.text);
 if(check.kind==="visible")
  return await (await one(page,check.role,check.name)).isVisible();
 if(check.kind==="element_count")
  return await page.locator(check.selector).count()===check.count;
 if(check.kind==="text_changes")
  return before.values.get(check.selector)!==
   await page.locator(check.selector).first().innerText();
 if(check.kind==="pure_case"){
  const value=await page.evaluate(probe=>{
   const fn=globalThis[probe.function_name];
   return typeof fn==="function"?fn(...probe.input):null;
  },check);
  return JSON.stringify(check.result_path?value?.[check.result_path]:value)===
   JSON.stringify(check.expected);
 }
 return false;
}
async function observe(browser,origin,criterion){
 if(!criterion.automatable)return {id:criterion.id,verdict:"UNTESTED",
  detail:"MANUAL_REQUIREMENT"};
 const context=await browser.newContext({serviceWorkers:"block",acceptDownloads:false});
 const page=await context.newPage();let pageErrors=0;
 page.on("pageerror",()=>{pageErrors++;});
 page.on("popup",p=>{void p.close();});
 await page.route("**/*",route=>{
  const request=route.request();
  let allowed;
  try{
   const url=new URL(request.url());
   allowed=url.origin===origin&&request.method()==="GET"&&
    SAFE_STATIC.test(url.pathname)&&url.search===""&&url.hash==="";
  }catch{allowed=false;}
  return allowed?route.continue():route.abort();
 });
 try{
  await page.goto(origin+"/",{waitUntil:"domcontentloaded",timeout:9000});
  const before={visibleText:await page.locator("body").innerText(),values:new Map()};
  for(const assertion of criterion.assertions)
   if(assertion.kind==="text_changes")
    before.values.set(assertion.selector,await page.locator(assertion.selector)
     .first().innerText());
  for(const step of criterion.steps)await perform(page,step);
  if(pageErrors>0)throw Error("BROWSER_SCRIPT_EXCEPTION");
  for(const assertion of criterion.assertions){
   if(!(await assertExpected(page,assertion,before)))
    throw Error("BROWSER_ASSERTION_FAILED_"+assertion.kind);
  }
  return {id:criterion.id,verdict:"PASS",detail:"BROWSER_INDEPENDENTLY_OBSERVED"};
 }catch(error){
  return {id:criterion.id,verdict:"FAIL",
   detail:String(error).slice(0,300)};
 }finally{await context.close();}
}
export async function runBuiltAppQa({browser,origin,plan,prompt}){
 if(typeof origin!=="string"||!/^http:\/\/127\.0\.0\.1:\d+$/u.test(origin))
  throw Error("QA_ORIGIN_MUST_BE_LOOPBACK");
 const verified=parseQaPlan(plan,prompt);
 if(!verified)throw Error("QA_ORIGINAL_PLAN_INVALID");
 const outcomes=[];
 for(const criterion of verified.criteria)
  outcomes.push(await observe(browser,origin,criterion));
 return outcomes.map((result,i)=>({
  criterion_id:result.id,category:"BROWSER",
  verdict:result.verdict,
  evidence_hash:result.verdict==="PASS"?digest(JSON.stringify({
   version:1,criterion:verified.criteria[i],
   browser_observation:result.detail,build_origin:"LOOPBACK_ONLY"
  })):null
 }));
}
