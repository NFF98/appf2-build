import { useEffect,useState } from "react";
import type { FetchLike } from "../create/f01-client.js";

export interface PublicAppCard {readonly share_id:string;readonly title:string;readonly content_hash:string}
type Props={readonly onOpen:(id:string)=>void;readonly fetchImpl?:FetchLike};
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
function trustedCard(v:unknown):v is PublicAppCard {
  if(v===null||typeof v!=="object")return false;
  const c=v as Partial<PublicAppCard>;
  return typeof c.share_id==="string"&&ID.test(c.share_id)&&
    typeof c.title==="string"&&c.title.length>0&&c.title.length<=80&&
    typeof c.content_hash==="string"&&/^sha256:[a-f0-9]{64}$/u.test(c.content_hash);
}
/** Published means explicit creator opt-in and live backend share. Inspiration prompts are NOT Apps. */
export function PublicApps({onOpen,fetchImpl=globalThis.fetch}:Props) {
  const [items,setItems]=useState<readonly PublicAppCard[]>([]);
  const [failed,setFailed]=useState(false);
  useEffect(()=>{
    const abort=new AbortController();
    const read=async()=>{
      try{
        const response=await fetchImpl("/api/v1/published-apps",{method:"GET",credentials:"same-origin",
          cache:"no-store",signal:abort.signal});
        if(!response.ok)throw Error("catalog unavailable");
        const payload:unknown=await response.json();
        const data=typeof payload==="object"&&payload!==null&&"data" in payload
          ?(payload as {data:unknown}).data:null;
        const apps=data!==null&&typeof data==="object"&&"apps" in data?
          (data as {apps:unknown}).apps:null;
        if(!Array.isArray(apps))throw Error("catalog malformed");
        if(!abort.signal.aborted)setItems(apps.filter(trustedCard));
      }catch{if(!abort.signal.aborted)setFailed(true);}
    };
    void read();return ()=>abort.abort();
  },[fetchImpl]);
  return <section className="saved-apps" aria-labelledby="published-apps-title">
    <h2 className="inspiration-title" id="published-apps-title">公開現成 App</h2>
    <p className="saved-apps-note">這些由原作者明確公開的 App，直接執行，無需重新生成或付 AI 費用。每人使用自己的資料。</p>
    {failed?<p role="status">目前無法讀取公開 App，沒有重新呼叫 AI。</p>:null}
    {items.length===0&&!failed?<p className="saved-apps-empty">目前尚未有原作者授權發布的 App。</p>:null}
    <ul className="saved-apps-grid">
      {items.map(item=><li className="saved-app-card" key={item.share_id}>
        <h3 className="capsule-title">{item.title}</h3>
        <p className="saved-apps-note">已公開原版 · 每人獨立使用</p>
        <button type="button" className="btn btn-primary" onClick={()=>onOpen(item.share_id)}>
          直接使用（不用 AI）
        </button>
      </li>)}
    </ul>
  </section>;
}
