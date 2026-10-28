import {parseQaPlan,type QaPlan} from "./requirement-contract.js";
export const QA_PLANNER_PROMPT=[
 "You write an independent acceptance plan BEFORE seeing application code.",
 "Read the user's entire original request and extract EVERY independently required behavior, calculation, state transition and screen.",
 "Return exactly {version:'1',criteria:[{id,source_quote,description,steps,assertions,automatable}]} as strict JSON with double quotes.",
 "Each source_quote must be an EXACT nonempty substring of the original request so requirements remain traceable.",
 "steps is an array of UI actions: {action:'click',role:'button'|'tab'|'link',name:string} or {action:'fill',role:'textbox'|'spinbutton',name:string,value:string}.",
 "assertions are {kind:'text_includes',text:string}, {kind:'visible',role:'button'|'tab'|'link'|'textbox'|'heading',name:string}, {kind:'element_count',selector:'#id'|'.class'|'[data-testid=\"id\"]',count:integer}, or {kind:'text_changes',selector:'#id'|'.class'}.",
 "Prefer deterministic, semantically correct expected outcomes after user actions; text_changed alone is weak evidence.",
 "The generated App must expose stable data-testid for stateful controls and results when the user explicitly requests them.",
 "When a requirement is ambiguous, subjective, needs domain variants, or cannot be verified by these primitives, automatable=false. Never mark it tested by making up expected data.",
 "Do not invent hidden requirements, omit mandatory requirements, derive tests from generated source or invent a passed result.",
 "At most 20 criteria. Return JSON only."
].join(" ");
type PlanModel=(messages:readonly {role:string;content:string}[])=>Promise<unknown>;
export async function planUserAcceptance(prompt:string,model:PlanModel):Promise<QaPlan|null>{
 if(prompt.trim().length<5||prompt.length>800)return null;
 const value=await model([{role:"system",content:QA_PLANNER_PROMPT},{role:"user",content:prompt}]);
 return parseQaPlan(value,prompt);
}
