import {useEffect,useState} from "react";
import {createBrowserIdentityDependencies,ensureAnonymousId} from "../../platform/identity/browser-identity.js";
import {mutationProofTranscript} from "../../edge/create-proof.js";
import {PopKeyring} from "../create/pop-keyring.js";
type Card={share_id:string;title:string;blueprint_hash:string};
const fetchCards=async():Promise<Card[]>=>{
 const r=await fetch("/api/v1/code-apps-public",{cache:"no-store"});
 if(!r.ok)return [];
 const payload:unknown=await r.json();
 if(typeof payload!=="object"||payload===null||!("data" in payload))return [];
 const data=(payload as {data:unknown}).data;
 if(typeof data!=="object"||data===null||!("apps" in data))return [];
 const apps=(data as {apps:unknown}).apps;
 if(!Array.isArray(apps))return [];
 return apps.filter((x:unknown)=>typeof x==="object"&&x!==null&&
   typeof (x as Card).share_id==="string"&&typeof (x as Card).title==="string") as Card[];
};
export function CodeBuilderPanel({onOpen}:{onOpen:(id:string)=>void}){
 const [prompt,setPrompt]=useState("");
 const [consent,setConsent]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [cards,setCards]=useState<Card[]>([]);
 useEffect(()=>{void fetchCards().then(setCards).catch(()=>undefined);},[]);
 const generate=async()=>{
  if(busy||prompt.trim().length<5||!consent)return;
  setBusy(true);setError("");
  try{
   const anonymousId=ensureAnonymousId(createBrowserIdentityDependencies());
   const keyring=new PopKeyring({subtle:crypto.subtle,now:Date.now});
   const keyId=crypto.randomUUID(),key=await keyring.keyForCreate(keyId);
   const idempotencyKey="code-"+crypto.randomUUID();
   const path="/api/v1/code-apps";
   const body=JSON.stringify({anonymous_id:anonymousId,prompt:prompt.trim(),public_opt_in:true});
   const headers=await key.proofHeaders(timestamp=>mutationProofTranscript({
    method:"POST",path,body:new TextEncoder().encode(body),idempotencyKey
   },timestamp));
   const response=await fetch(path,{
    method:"POST",credentials:"same-origin",
    headers:{...headers,"Content-Type":"application/json","Idempotency-Key":idempotencyKey},
    body
   });
   const payload:unknown=await response.json();
   if(!response.ok)throw Error(response.status===429?"今日免費測試額度已用完；不會自動重試。":"App 尚未通過建置或驗證，沒有公開，也沒有自動重試。");
   const data=typeof payload==="object"&&payload!==null&&"data" in payload?(payload as {data:unknown}).data:null;
   const id=data!==null&&typeof data==="object"&&"share_id" in data?(data as {share_id:unknown}).share_id:null;
   if(typeof id!=="string")throw Error("App 回應格式不符，沒有重新呼叫 AI。");
   onOpen(id);
  }catch(e){setError(e instanceof Error?e.message:"網路暫時無法完成，沒有自動重試。");}
  finally{setBusy(false);}
 };
 return <section className="code-builder-panel" aria-labelledby="code-builder-title">
   <h2 id="code-builder-title">AI Code Builder · Blueprint v2</h2>
   <p className="saved-apps-note">用一句話產生真正的互動網頁 App。此 Staging 初版僅支援不連網的單檔程式；結果封裝為可分享的 Blueprint 卡片。</p>
   <label htmlFor="code-builder-prompt">描述你想做的 App</label>
   <textarea id="code-builder-prompt" className="composer-input" value={prompt} maxLength={800}
     onChange={e=>setPrompt(e.target.value)} placeholder="例如：做一個有骰子和計分功能的十八啦遊戲" />
   <label className="code-builder-consent"><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>
     我同意產生一次付費 AI 請求，並把完成的 App 程式公開成可分享卡片（不包含我的操作資料）。
   </label>
   <button type="button" className="btn btn-primary" disabled={busy||!consent||prompt.trim().length<5}
     onClick={()=>{void generate();}}>{busy?"AI 正在產生與驗證…":"生成 Blueprint v2 App"}</button>
   {error?<p role="alert">{error}</p>:null}
   <h3>已完成的 Code Builder App</h3>
   {cards.length===0?<p className="saved-apps-note">尚無已驗證的 Code App。</p>:null}
   <ul className="saved-apps-grid">{cards.map(card=><li className="saved-app-card" key={card.share_id}>
     <h4>{card.title}</h4><button type="button" className="btn btn-secondary" onClick={()=>onOpen(card.share_id)}>直接使用（不用 AI）</button>
   </li>)}</ul>
  </section>;
}
