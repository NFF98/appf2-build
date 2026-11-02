/** Zero-cost Chromium test of the REAL hashed opaque-iframe record client.
 * Parent is an allowlisted simulator, NOT PostgreSQL or a signed Staging Worker.
 * Tests frame wire messages, stable create ID, CAS payload and conflict visibility.
 */
import {chromium} from "@playwright/test";
import {CODE_RECORD_IFRAME_SCRIPT} from "../../dist/src/app/runtime/code-record-bridge.js";
const escape=s=>s.replaceAll("&","&amp;").replaceAll('"',"&quot;").replaceAll("<","&lt;")
 .replaceAll(">","&gt;");
const source='<!doctype html><html><body><div id="app"></div><script>'+
 CODE_RECORD_IFRAME_SCRIPT+'</script></body></html>';
let browser;
try{
 browser=await chromium.launch({headless:true});
 const page=await browser.newPage();
 await page.setContent('<iframe title="trusted-record-client" sandbox="allow-scripts" '+
  'srcdoc="'+escape(source)+'"></iframe>');
 await page.evaluate(()=>{
  window.__recordMessages=[];
  window.addEventListener("message",event=>{
   const data=event.data;
   if(data?.kind!=="APPF2_RECORD_REQUEST_V1"||!event.source)return;
   window.__recordMessages.push(data);
   event.source.postMessage({
    kind:"APPF2_RECORD_REPLY_V1",id:data.id,
    ok:data.action!=="update",
    ...(data.action==="update"?{error:"CODE_RECORD_CONFLICT"}:
     {value:{record_id:data.record_id,ack:true}})
   },"*");
  });
 });
 const frame=page.frameLocator('iframe[sandbox="allow-scripts"]');
 await frame.locator("body").waitFor({state:"visible",timeout:8000});
 const result=await frame.locator("body").evaluate(async()=>{
  const api=window.appf2Records;
  const id=api.newId();
  const created=await api.create({item:"bookmark",status:"draft"},id);
  let conflict="";
  try{
   await api.update(id,{item:"bookmark",status:"done"},
    {item:"bookmark",status:"draft"});
  }catch(error){conflict=String(error?.message??error);}
  const deleted=await api.delete(id,{item:"bookmark",status:"draft"});
  return {id,created,deleted,conflict};
 });
 const requests=await page.evaluate(()=>window.__recordMessages);
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(result.id))
  throw Error("BRIDGE_GUEST_NEW_UUID_INVALID");
 if(requests.length!==3||
    requests[0].action!=="create"||requests[0].record_id!==result.id||
    requests[1].action!=="update"||requests[1].expected_value?.status!=="draft"||
    requests[2].action!=="delete"||requests[2].expected_value?.status!=="draft"||
    result.conflict!=="CODE_RECORD_CONFLICT"||
    result.created.record_id!==result.id||
    result.deleted.record_id!==result.id)
  throw Error("BRIDGE_REAL_BROWSER_CAS_WIRE_INCORRECT:"+JSON.stringify({result,requests}));
 if(requests.some(r=>"thumbprint" in r||"signature" in r||"sql" in r))
  throw Error("BRIDGE_LEAKED_TRUSTED_IDENTITY");
 console.log("SP35 UNKNOWN APP IFRAME RECORD BRIDGE: Chromium PASS: stable UUID, create, CAS update 409, scoped delete message; no secrets; 0 AI/cloud");
}finally{if(browser)await browser.close();}
