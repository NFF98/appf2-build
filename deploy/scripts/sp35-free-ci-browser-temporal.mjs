/** Sprint3.5 independent Chromium frozen-QA temporal evidence.
 * A return to the initial displayed state (0 -> 1 -> 0) must be tested
 * against actual intermediate browser observations, not rejected simply
 * because the final text was already visible before any clicks.
 * All source runs in the isolated browser; this observer uses only DOM UI.
 */
/** Canonical *visible* DOM text for one frozen QA observation.
 * Browser innerText introduces layout-only separators between flex children:
 * "計數：" + "0" is one visible counter, not two unrelated page sentences.
 * A sentinel may be added ONLY when a short, visible, single DOM component's
 * own textContent is exactly the expected words after whitespace folding.
 * The raw body is always retained; hidden content and whole-body joins fail.
 */
export async function observedQaBody(target,assertions=[]){
 let body=await target.locator("body").innerText();
 const expectations=[...new Set(assertions.filter(x=>
  (x.kind==="text_includes"||x.kind==="text_appears")&&
  typeof x.text==="string"&&x.text.length>0).map(x=>x.text))];
 for(const expected of expectations){
  if(body.includes(expected))continue;
  // eslint-disable-next-line complexity -- Exact single-component visibility needs all ancestor and layout checks.
  const observed=await target.evaluate(value=>{
   const normalized=text=>String(text??"").replace(/[\s\u200b\u200c\u200d]/gu,"");
   const want=normalized(value);
   if(!want||want.length>160)return false;
   const root=globalThis.document.body;
   if(!root)return false;
   for(const element of root.querySelectorAll("*")){
    if(element.children.length>6||element.textContent?.length>220||
       normalized(element.textContent)!==want)continue;
    if(element.closest('[hidden],[aria-hidden="true"],[inert]'))continue;
    let visible=true,node=element;
    while(node&&node!==root.parentElement){
     const style=globalThis.getComputedStyle(node);
     if(style.display==="none"||style.visibility==="hidden"||
        style.visibility==="collapse"||style.opacity==="0"){
      visible=false;break;
     }
     node=node.parentElement;
    }
    if(!visible)continue;
    const rect=element.getBoundingClientRect();
    if(rect.width<=0||rect.height<=0||
       element.getClientRects().length===0)continue;
    return true;
   }
   return false;
  },expected);
  if(observed)body+="\n[APPF2_VISIBLE_COMPONENT]"+expected;
 }
 return body;
}
async function awaitObservedQaState(target,assertions,expected,present,ms){
 const start=Date.now();
 while(Date.now()-start<ms){
  const state=await observedQaBody(target,assertions);
  if(state.includes(expected)===present)return;
  await target.waitForTimeout(80);
 }
}

export function observedTextAppears(initial,intermediate,final,expected){
 if(typeof initial!=="string"||typeof final!=="string"||
  !Array.isArray(intermediate)||typeof expected!=="string"||
  expected.length===0)return false;
 if(!final.includes(expected))return false;
 // Normal result: newly visible text after actions.
 if(!initial.includes(expected))return true;
 // A return-to-baseline assertion requires proof the expected text was
 // genuinely absent *between* actions, not just the initial/final equality.
 return intermediate.some(text=>typeof text==="string"&&
  !text.includes(expected));
}
/** Execute frozen click/fill steps, collecting truthful browser observations.
 * The await for disappearance is limited to criteria whose initial text is
 * also their expected final text; it does not alter the frozen QA contract.
 */
export async function executeFrozenQaSteps(target,criterion,initial){
 const observed=[];
 const returning=criterion.assertions.filter(a=>
  a.kind==="text_appears"&&initial.includes(a.text));
 for(let i=0;i<criterion.steps.length;i++){
  const step=criterion.steps[i];
  const loc=target.getByRole(step.role,{name:step.name,exact:true});
  if(await loc.count()!==1)throw Error("QA_TARGET_MISSING_OR_AMBIGUOUS");
  if(step.action==="click")await loc.click({timeout:2500});
  else if(step.action==="fill")await loc.fill(step.value,{timeout:2500});
  else throw Error("QA_STEP_UNSUPPORTED");
  // When a multi-action QA returns to its initial value, the intermediate
  // transition might be asynchronous. Observe it before the next click.
  if(i<criterion.steps.length-1){
   for(const assertion of returning){
    if(observed.some(t=>!t.includes(assertion.text)))continue;
    try{
     await awaitObservedQaState(target,criterion.assertions,
      assertion.text,false,2500);
    }catch{ /* No observed transition: final check stays FAIL-closed. */ }
   }
  }
  observed.push(await observedQaBody(target,criterion.assertions));
 }
 // Wait for asynchronous final visible state, not a single immediate read
 // after the click. Failure is still detected by exact final text check.
 for(const assertion of criterion.assertions){
  if(assertion.kind==="text_appears"){
   try{
    await awaitObservedQaState(target,criterion.assertions,
     assertion.text,true,4000);
   }catch{ /* final predicate below is the source of truth */ }
  }
 }
 return {stepBodies:observed,
  after:await observedQaBody(target,criterion.assertions)};
}
