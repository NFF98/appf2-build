import {parseQaPlan,type QaPlan} from "./requirement-contract.js";
export const QA_PLANNER_PROMPT=[
 "You write an independent acceptance plan BEFORE seeing application code.",
 "Read the user's entire original request and extract EVERY independently required behavior, calculation, state transition and screen.",
 "Return exactly {version:'1',criteria:[{id,source_quote,description,steps,assertions,automatable}]} as strict JSON with double quotes.",
 "Each source_quote must be an EXACT nonempty substring of the original request so requirements remain traceable.",
 "steps is an array of UI actions: {action:'click',role:'button'|'tab'|'link',name:string} or {action:'fill',role:'textbox'|'spinbutton',name:string,value:string}.",
 "assertions are {kind:'text_includes',text:string}, {kind:'visible',role:'button'|'tab'|'link'|'textbox'|'heading'|'list',name:string}, {kind:'element_count',selector:'#id'|'.class'|'[data-testid=\"id\"]',count:integer}, or {kind:'text_changes',selector:'#id'|'.class'}.",
 "Empty name is allowed only for a textbox or list that is uniquely identifiable in the running App. For all other controls provide a nonempty accessible name. A fill step MUST contain a test value string.",
 "Prefer deterministic, semantically correct expected outcomes after user actions; text_changed alone is weak evidence.",
 "For pure domain calculations that cannot be deterministically driven by clicking, use {kind:'pure_case',function_name:string,input:JSON array,expected:JSON value}, with independently derived expected results. Optional result_path selects a field such as score from the returned object.",
 "Apps needing pure_case checks must expose the corresponding pure function at window[function_name] and reuse the function for visible UI results; no test-only substitute.",
 "The generated App must expose stable data-testid for stateful controls and results when the user explicitly requests them.",
 "When a requirement is objectively observable via supported UI primitives, automatable MUST be true. In particular: add-to-list, counter increment, reset, form submit, page switch and mark-task-complete are all automatable.",
 "For a toggle or completion state, require a real change in accessible visible status or checked/selected state; the mere continued presence of the Complete button is not evidence. Prefer visible user-facing state such as 已完成, or a dedicated data-testid element with text_changes. Tell the generated App to implement that observable output.",
 "If the request includes unnamed input fields, specify textbox with name='' only if the UI contains exactly one textbox. Likewise a single unnamed list can use visible role=list, name=''.",
 "Use automatable=false ONLY for genuinely subjective preferences, unsupported external systems or ambiguous domain semantics that cannot be objectively inferred. Do not mark common CRUD interactions as manual review.",
 "When a requirement is ambiguous, subjective, needs domain variants, or cannot be verified by these primitives, automatable=false. Never mark it tested by making up expected data.",
 "Do not invent hidden requirements, omit mandatory requirements, derive tests from generated source or invent a passed result.",
 "At most 20 criteria. Return JSON only."
].join(" ");
/**
 * Model-generated criterion IDs are merely labels, not user requirements.
 * Replace them deterministically; do NOT change quotes, actions or expected outcomes.
 * All other schema rules remain fail-closed and independently validated.
 */
export function normalizeModelQaPlan(value:unknown,prompt:string):QaPlan|null{
 if(typeof value!=="object"||value===null||Array.isArray(value))return null;
 const record=value as Record<string,unknown>;
 if(record.version!=="1"||!Array.isArray(record.criteria))return null;
 const criteria=record.criteria.map((c:unknown,index:number)=>{
  if(typeof c!=="object"||c===null||Array.isArray(c))return c;
  return {...c,id:"req_"+(index+1)};
 });
 return parseQaPlan({version:"1",criteria},prompt);
}
type PlanModel=(messages:readonly {role:string;content:string}[])=>Promise<unknown>;
export async function planUserAcceptance(prompt:string,model:PlanModel):Promise<QaPlan|null>{
 if(prompt.trim().length<5||prompt.length>800)return null;
 const value=await model([{role:"system",content:QA_PLANNER_PROMPT},{role:"user",content:prompt}]);
 return normalizeModelQaPlan(value,prompt);
}
