/**
 * Universal, pre-code acceptance contract. A verifier never derives expected
 * outcomes from generated source. Unknown or ambiguous criteria stay UNTESTED.
 */
export type QaStep =
 | {readonly action:"click";readonly role:"button"|"tab"|"link";readonly name:string}
 | {readonly action:"fill";readonly role:"textbox"|"spinbutton";readonly name:string;readonly value:string};
export type QaAssertion =
 | {readonly kind:"text_includes";readonly text:string}
 | {readonly kind:"element_count";readonly selector:string;readonly count:number}
 | {readonly kind:"text_changes";readonly selector:string}
 | {readonly kind:"visible";readonly role:"button"|"tab"|"link"|"textbox"|"heading";readonly name:string}
 | {readonly kind:"pure_case";readonly function_name:string;readonly input:readonly unknown[];readonly expected:unknown;readonly result_path?:string};
export type QaCriterion={
 readonly id:string;readonly source_quote:string;readonly description:string;
 readonly steps:readonly QaStep[];readonly assertions:readonly QaAssertion[];
 readonly automatable:boolean;
};
export type QaPlan={readonly version:"1";readonly criteria:readonly QaCriterion[]};
const RECORD=(x:unknown):x is Record<string,unknown>=>typeof x==="object"&&x!==null&&!Array.isArray(x);
const NAME=(x:unknown):x is string=>typeof x==="string"&&x.length>0&&x.length<=120;
const ALLOWED_SELECTOR=/^(#[a-z][\w-]{0,63}|\.[a-z][\w-]{0,63}|\[data-testid="[a-z][\w-]{0,63}"\])$/iu;
function step(x:unknown):x is QaStep{
 if(!RECORD(x)||!NAME(x.name))return false;
 return x.action==="click"?["button","tab","link"].includes(String(x.role)):
  x.action==="fill"&&["textbox","spinbutton"].includes(String(x.role))&&
  typeof x.value==="string"&&x.value.length<=120;
}
// eslint-disable-next-line complexity -- Every independent assertion variant must fail closed on malformed input.
function assertion(x:unknown):x is QaAssertion{
 if(!RECORD(x))return false;
 if(x.kind==="text_includes")return typeof x.text==="string"&&x.text.length>=1&&x.text.length<=160;
 if(x.kind==="visible")return NAME(x.name)&&["button","tab","link","textbox","heading"].includes(String(x.role));
 if(x.kind==="pure_case")return NAME(x.function_name)&&
   /^[A-Za-z_$][\\w$]{0,63}$/u.test(x.function_name)&&
   Array.isArray(x.input)&&x.input.length<=8&&
   typeof JSON.stringify(x.input)==="string"&&JSON.stringify(x.input).length<=300&&
   typeof JSON.stringify(x.expected)==="string"&&JSON.stringify(x.expected).length<=300&&
   (x.result_path===undefined||typeof x.result_path==="string"&&
     /^[a-z][a-z0-9_]{0,63}$/u.test(x.result_path));
 if(!ALLOWED_SELECTOR.test(String(x.selector)))return false;
 if(x.kind==="element_count")return Number.isInteger(x.count)&&Number(x.count)>=0&&Number(x.count)<=200;
 return x.kind==="text_changes";
}
// eslint-disable-next-line complexity -- Mandatory schema and provenance checks are independent fail-closed conditions.
function criterion(x:unknown,prompt:string):x is QaCriterion{
 if(!RECORD(x)||!NAME(x.id)||!/^[a-z][a-z0-9_]{0,39}$/u.test(x.id)||
  !NAME(x.description)||typeof x.source_quote!=="string"||
  x.source_quote.length<2||x.source_quote.length>180||!prompt.includes(x.source_quote)||
  typeof x.automatable!=="boolean"||!Array.isArray(x.steps)||!Array.isArray(x.assertions)||
  x.steps.length>8||x.assertions.length>6)return false;
 return x.steps.every(step)&&x.assertions.every(assertion)&&
  (!x.automatable||x.assertions.length>0);
}
export function parseQaPlan(value:unknown,prompt:string):QaPlan|null{
 if(!RECORD(value)||value.version!=="1"||!Array.isArray(value.criteria)||
   value.criteria.length<1||value.criteria.length>20)return null;
 const seen=new Set<string>();
 for(const c of value.criteria){
  if(!criterion(c,prompt)||seen.has(c.id))return null;
  seen.add(c.id);
 }
 return value as QaPlan;
}
export type QaVerdict="PASS"|"FAIL"|"UNTESTED";
export type QaEvidence={readonly id:string;readonly verdict:QaVerdict;readonly detail:string};
export function summarizeQa(plan:QaPlan,evidence:readonly QaEvidence[]){
 const byId=new Map(evidence.map(e=>[e.id,e]));
 const results=plan.criteria.map(c=>({
  id:c.id,verdict:!c.automatable?"UNTESTED" as const:
   (byId.get(c.id)?.verdict??"UNTESTED"),
  detail:byId.get(c.id)?.detail??"NO_INDEPENDENT_EVIDENCE"
 }));
 return {passed:results.every(r=>r.verdict==="PASS"),results};
}
