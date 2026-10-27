// Proves Cloudflare Worker routing, not completion of model/PG execution.
const raw=process.env.APPF2_STAGING_URL;
if(!raw) throw new Error("STAGING SMOKE: missing APPF2_STAGING_URL");
const base=new URL(raw);
if(base.protocol!=="https:"||base.username||base.password||base.search||base.hash) throw new Error("STAGING SMOKE: require HTTPS origin");
// workers.dev hostname activation can lag a successful upload; test the live
// API repeatedly rather than treating the first DNS/edge 404 as final proof.
const sleep = ms => new Promise(resolve => setTimeout(resolve,ms));
let get, getText="";
const delays=[0,2500,5000,7500,10000,15000,20000];
for(let i=0;i<delays.length;i++){
  if(delays[i]) await sleep(delays[i]);
  try {
    get=await fetch(new URL("/api/v1/health",base),{redirect:"error"});
    getText=await get.text();
    const ok=get.status===200 && get.headers.get("content-type")?.includes("application/json");
    console.log("STAGING HEALTH TRY "+(i+1)+": HTTP "+get.status+" content-type="+(get.headers.get("content-type")||"NONE"));
    if(ok)break;
  } catch(e){
    console.error("STAGING HEALTH TRY "+(i+1)+": NETWORK ERROR "+String(e?.name||"unknown"));
  }
}
if(!get)throw new Error("STAGING SMOKE: health request never reached an HTTP server");
if(get.status!==200 || !get.headers.get("content-type")?.includes("application/json")){
  throw new Error("STAGING SMOKE: health not Worker JSON; status="+get.status+
    " content-type="+(get.headers.get("content-type")||"NONE")+
    " body-prefix="+getText.slice(0,120).replaceAll(/[^\\x20-\\x7e]/g,"?"));
}
let json;try{json=JSON.parse(getText)}catch{throw new Error("STAGING SMOKE: health JSON parse failed")}
if(json?.data?.status!=="UP")throw new Error("STAGING SMOKE: Worker health invalid");
console.log("STAGING SMOKE: GET /api/v1/health 200 JSON UP");
// Worker must also deliver the real SPA on the SAME origin; checking API alone
// can falsely pass while Browser still loads an unrelated Vite static preview.
const home=await fetch(new URL("/",base),{redirect:"error"});
const html=await home.text();
if(home.status!==200 || !home.headers.get("content-type")?.includes("text/html") ||
   !html.includes('id="root"')){
  throw new Error("STAGING SMOKE: real SPA not delivered on same Worker origin (status "+home.status+")");
}
console.log("STAGING SMOKE: GET / 200 real SPA on SAME origin");
// A newly deployed edge may reset one connection during activation. Retry
// TRANSPORT failures only; an actual HTTP response is never retried or accepted
// unless the exact unsigned-PoP 400/F01-ERR-001 contract holds below.
let post,body="";
for(let i=0;i<3;i++){
  try {
    post=await fetch(new URL("/api/v1/intents",base),{
      method:"POST",headers:{"Content-Type":"application/json","Origin":base.origin},
      body:JSON.stringify({intent_kind:"CREATE",raw_intent:"smoke unauthorized"}),
      signal:AbortSignal.timeout(10000)
    });
    body=await post.text();
    break;
  }catch(error) {
    if(i===2) throw new Error("STAGING SMOKE: unsigned POST transport unavailable after 3 bounded tries");
    console.warn("STAGING SMOKE: unsigned POST temporary transport error attempt="+(i+1)+
      " kind="+(error instanceof Error ? error.name : "UNKNOWN"));
    await sleep(1200*(i+1));
  }
}
if(post===undefined) throw Error("STAGING SMOKE: unsigned POST never received HTTP");
let parsed;
try{parsed=JSON.parse(body)}catch{throw new Error("STAGING SMOKE: intents response not JSON, status "+post.status)}
if (!post.headers.get("content-type")?.includes("application/json")
    || post.status !== 400
    || parsed?.error?.code !== "F01-ERR-001") {
 throw new Error("STAGING SMOKE: unsigned intents must reach Worker's F01 proof guard (400/F01-ERR-001), got status "+post.status+" code "+(parsed?.error?.code||"NONE"));
}
console.log("STAGING SMOKE: POST /api/v1/intents JSON denied as expected; status "+post.status+", code "+parsed.error.code);
console.log("STAGING SMOKE: API FIRST-HOP PASS ONLY; LIVE MODEL/POSTGRES/CREATION NOT VERIFIED");
