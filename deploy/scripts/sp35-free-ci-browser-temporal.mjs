/** Sprint3.5 independent Chromium frozen-QA temporal evidence.
 * A return to the initial displayed state (0 -> 1 -> 0) must be tested
 * against actual intermediate browser observations, not rejected simply
 * because the final text was already visible before any clicks.
 * All source runs in the isolated browser; this observer uses only DOM UI.
 */
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
     await target.waitForFunction(expected=>
      !globalThis.document.body?.innerText.includes(expected),assertion.text,
     {timeout:2500});
    }catch{ /* No observed transition: final check stays FAIL-closed. */ }
   }
  }
  observed.push(await target.locator("body").innerText());
 }
 // Wait for asynchronous final visible state, not a single immediate read
 // after the click. Failure is still detected by exact final text check.
 for(const assertion of criterion.assertions){
  if(assertion.kind==="text_appears"){
   try{
    await target.waitForFunction(expected=>
     globalThis.document.body?.innerText.includes(expected),assertion.text,
    {timeout:4000});
   }catch{ /* final predicate below is the source of truth */ }
  }
 }
 return {stepBodies:observed,
  after:await target.locator("body").innerText()};
}
