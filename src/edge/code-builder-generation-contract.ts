/**
 * Universal contract for a SINGLE paid generation call. This improves generation quality
 * but is deliberately NOT evidence that the resulting app satisfies the user's request.
 * Every novel idea requires separate observable behavior tests / owner acceptance.
 */
export const CODE_BUILDER_COMPLETION_BUDGET=8000;
export const CODE_BUILDER_SOURCE_TARGET_BYTES=28000;
export const CODE_BUILDER_GENERATION_TIMEOUT_MS=65000;
export const CODE_BUILDER_SYSTEM_POLICY=[
 "Create a working, self-contained interactive browser App for the user request. Never produce a mockup instead of working behavior.",
 "Before coding, privately extract EVERY explicit required feature, interaction, rule, state transition, view, result, reset and calculation from the request. Implement all of them, not a representative subset.",
 "Handle edge cases and provide understandable empty/error states. Do not invent a ranking, multiplayer mode or specific business rule unless the user requested it or the domain rules demand it.",
 "For domain rules, use consistent verifiable algorithms, show the rules used to the user, and distinguish invalid/retry states from valid scores. Never assign arbitrary scores to invalid outcomes.",
 "Make controls usable on mobile and desktop. Use accessible buttons and clear labels. If the request needs multiple views, implement real navigation and state changes, not decorative tabs.",
 "Privately check code for every requested feature and control wiring before returning it. A button changing text alone is not proof of a valid outcome.",
 "Return ONLY a JSON object with EXACTLY two keys: title (nonempty string) and javascript (the complete standalone program). Do not add explanations, markdown, code fences, tests, or any extra JSON fields.",
 "javascript must be self-contained browser JavaScript without import, require, eval, dynamic import, network fetch, external dependencies, CDN, iframe, workers, document.cookie, localStorage, or parent access.",
 "The runtime creates <main id=app> inside a sandboxed document. Use document.getElementById('app') and DOM event listeners to build the real interface. Put all needed CSS in a style element or DOM styles.",
 "Keep JavaScript reasonably small (target under 28KB UTF-8). Never emit a closing script tag or rely on host privileges. Chinese UI for Chinese requests."
].join(" ");
export function codeBuilderModelRequest(model:string,prompt:string){
 return {
  model,temperature:0,max_completion_tokens:CODE_BUILDER_COMPLETION_BUDGET,
  response_format:{type:"json_object"},
  messages:[
   {role:"system",content:CODE_BUILDER_SYSTEM_POLICY},
   {role:"user",content:prompt}
  ]
 };
}
export type CodeBuilderGeneratedCode={title:string;javascript:string};
function record(x:unknown):x is Record<string,unknown>{
 return typeof x==="object"&&x!==null&&!Array.isArray(x);
}
function parseCodeObject(content:string):CodeBuilderGeneratedCode|null{
 let parsed:unknown;
 try{parsed=JSON.parse(content);}catch{return null;}
 if(!record(parsed)||Object.keys(parsed).length!==2||
   typeof parsed.title!=="string"||typeof parsed.javascript!=="string")return null;
 const title=parsed.title.trim();
 if(title.length===0||title.length>120||parsed.javascript.length===0||
   new TextEncoder().encode(parsed.javascript).byteLength>128*1024)return null;
 return {title,javascript:parsed.javascript};
}
export function readCodeBuilderCompletion(data:unknown):CodeBuilderGeneratedCode|null{
 if(!record(data)||!Array.isArray(data.choices)||data.choices.length===0)return null;
 const choice:unknown=data.choices[0];
 if(!record(choice)||choice.finish_reason!=="stop"||!record(choice.message)||
   typeof choice.message.content!=="string"||choice.message.content.length>130000)return null;
 return parseCodeObject(choice.message.content);
}
