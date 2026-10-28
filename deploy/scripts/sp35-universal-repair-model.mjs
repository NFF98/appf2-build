/* Opt-in repair adapter. Model calls are paid; no consent means ZERO requests.
 * The frozen independent plan is never regenerated from source or model feedback.
 */
const ALLOWED={
 openai:"https://api.openai.com/v1",
 xai:"https://api.x.ai/v1",
 deepseek:"https://api.deepseek.com"
};
export function createPaidRepair({provider="openai",model,apiKey,prompt,consented=false,maxRepairs=0,
 request=fetch}){
 const base=ALLOWED[provider];
 if(!base||!model||!apiKey||!prompt)throw Error("QA_REPAIR_CONFIG_INVALID");
 const limit=consented?Math.min(2,Math.max(0,Math.floor(maxRepairs))):0;
 let used=0;
 // eslint-disable-next-line complexity -- Explicit budget, consent and response guards are independent safety conditions.\n return async(draft,plan,failures,attempt)=>{
  if(attempt!==used+1||used>=limit)return null;
  used++; // Charge authorization consumed BEFORE network; failures cannot cause retry.
  const content=JSON.stringify({
   original_user_request:prompt,independent_plan:plan,prior_code:draft.javascript,
   failed_observations:failures,repair_attempt:attempt,
   contract:"Fix EVERY failed criterion without dropping already implemented user requirements. "+
    "Do not change the plan. Return only {title,javascript}, complete runnable JS. "+
    "Use <main id=app>. No external network/import/eval."
  });
  if(content.length>40000)return null;
  const r=await request(base+"/chat/completions",{
   method:"POST",headers:{"Authorization":"Bearer "+apiKey,"Content-Type":"application/json"},
   body:JSON.stringify({model,temperature:0,max_completion_tokens:8000,
    response_format:{type:"json_object"},messages:[
     {role:"system",content:"You are a bounded code repairer. Independent requirements and real browser evidence are authoritative. Output ONLY exact JSON {title,javascript}. Do not invent PASS."},
     {role:"user",content}]})
  }).catch(()=>null);
  if(!r?.ok)return null;
  const raw=await r.json().catch(()=>null);
  const choice=raw?.choices?.[0];
  if(choice?.finish_reason!=="stop"||typeof choice?.message?.content!=="string")return null;
  let parsed;
  try{parsed=JSON.parse(choice.message.content);}catch{return null;}
  if(!parsed||typeof parsed!=="object"||Array.isArray(parsed)||
   Object.keys(parsed).length!==2||typeof parsed.title!=="string"||
   typeof parsed.javascript!=="string"||!parsed.javascript||parsed.javascript.length>128*1024||
   /<\/script\b/iu.test(parsed.javascript))return null;
  return {title:parsed.title.slice(0,120),javascript:parsed.javascript};
 };
}
