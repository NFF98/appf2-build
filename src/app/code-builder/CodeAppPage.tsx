import {useEffect,useRef,useState} from "react";
import {createPrototypeCodeFrame} from "../runtime/code-artifact-frame.js";
import type {PrototypeCodeFrame} from "../runtime/code-artifact-frame.js";
const ID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
export function CodeAppPage({shareId,onHome}:{shareId:string;onHome:()=>void}){
 const mount=useRef<HTMLDivElement>(null);
 const [status,setStatus]=useState<"LOADING"|"READY"|"FAILED">("LOADING");
 const [title,setTitle]=useState("正在開啟 App");
 useEffect(()=>{
  const abort=new AbortController();let frame:PrototypeCodeFrame|null=null;
  const open=async()=>{
   try{
    if(!ID.test(shareId))throw Error("INVALID_ID");
    const response=await fetch("/api/v1/code-apps/"+shareId,{cache:"no-store",signal:abort.signal});
    if(!response.ok)throw Error("NOT_AVAILABLE");
    const payload:unknown=await response.json();
    const data=typeof payload==="object"&&payload!==null&&"data" in payload?
      (payload as {data:unknown}).data:null;
    if(typeof data!=="object"||data===null)throw Error("INVALID_BODY");
    const obj=data as {artifact?:unknown;title?:unknown;blueprint_hash?:unknown};
    frame=await createPrototypeCodeFrame(obj.artifact,document);
    if(frame.blueprintHash!==obj.blueprint_hash||abort.signal.aborted)throw Error("INVALID_HASH");
    mount.current?.append(frame.iframe);
    if(typeof obj.title==="string")setTitle(obj.title);
    setStatus("READY");
   }catch{if(!abort.signal.aborted)setStatus("FAILED");}
  };
  void open();
  return ()=>{abort.abort();frame?.destroy();};
 },[shareId]);
 return <main className="code-app-page">
  <header className="code-app-header"><button type="button" className="btn btn-secondary" onClick={onHome}>返回 APPf2</button>
    <h1>{title}</h1></header>
  {status==="LOADING"?<p role="status">正在驗證 Blueprint v2 並開啟 App…</p>:null}
  {status==="FAILED"?<p role="alert">這個 App 無法安全開啟。原有 App 不受影響，也不會重新呼叫 AI。</p>:null}
  {status==="READY"?<p className="saved-apps-note">程式封裝已驗證，功能尚待逐項驗收 · 隔離執行 · 重新開啟不花 AI 生成費</p>:null}
  <div ref={mount} className="code-app-frame"/>
 </main>;
}
