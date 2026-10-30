import {useEffect,useRef,useState} from "react";
import {BrowserCodingAgent,savedCandidateTarget,type AgentBrowserOptions,
 type CandidateSnapshot} from "./agent-browser-client.js";

type Props={readonly suggestedPrompt?:{text:string;revision:number}|null};
function failureMessage(e:unknown):string{
 return e instanceof Error?e.message:"Agent 已停止；請先檢查已保存的工作。";
}
/** Real multi-file Agent entry, not the legacy single-file code-app publisher.
 * Candidate is viewable as source only until independent QA/publishing exists.
 */
export function AgentBuilderPanel({suggestedPrompt}:Props){
 const [prompt,setPrompt]=useState(suggestedPrompt?.text??"");
 const [aiConsent,setAiConsent]=useState(false);
 const [containerConsent,setContainerConsent]=useState(false);
 const [approvedCents,setApprovedCents]=useState(60);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [snapshot,setSnapshot]=useState<CandidateSnapshot|null>(null);
 const [saved,setSaved]=useState(()=>savedCandidateTarget()!==null);
 const agent=useRef<BrowserCodingAgent|null>(null);
 const stop=useRef(false);
 useEffect(()=>{
  if(suggestedPrompt!==null&&suggestedPrompt!==undefined)setPrompt(suggestedPrompt.text);
 },[suggestedPrompt]);
 const options=():AgentBrowserOptions=>({
  allowAi:aiConsent,allowContainer:containerConsent,approvedCents});
 // eslint-disable-next-line complexity -- Each stage writes only signed durable state.
 const execute=async(resume:boolean)=>{
  if(busy||!aiConsent)return;
  setBusy(true);setError("");stop.current=false;
  try{
   const worker=agent.current??new BrowserCodingAgent();
   agent.current=worker;
   if(resume){
    if(!await worker.restore())throw Error("找不到已保存的 Agent 工作。");
   }else{
    await worker.create(prompt,options());
    setSaved(true);
    const initial=await worker.read();
    setSnapshot({job:initial,progress:null,message:"專案已永久保存，正在呼叫 AI…",completed_steps:0});
    await worker.plan();
   }
   const done=await worker.advance(options(),setSnapshot,()=>stop.current);
   setSnapshot(done);
  }catch(e){
   setError(failureMessage(e));
   // A failed call can have charged; do not retry automatically.
   if(agent.current!==null){
    try{
     const job=await agent.current.read();
     setSnapshot({job,progress:null,
      message:"已保留資料庫專案。若呼叫結果不明，請先查詢再繼續。",completed_steps:0});
    }catch{ /* Creator proof or service may be unavailable. */ }
   }
  }finally{setBusy(false);}
 };
 return <section className="code-builder-panel" aria-labelledby="agent-builder-title">
  <h2 id="agent-builder-title">AI App Builder · 多檔案 Agent</h2>
  <p className="saved-apps-note">真正的多檔案程式專案；AI 可以編寫、保存、要求隔離建置與修復。
   功能是否能操作需獨立驗證；目前生成的是私人候選原始碼，<strong>尚未自動發布成可用 App</strong>。</p>
  <label htmlFor="code-builder-prompt">用一句話描述要做的 App</label>
  <textarea id="code-builder-prompt" className="composer-input" value={prompt}
   maxLength={800} disabled={busy} onChange={e=>setPrompt(e.target.value)}
   placeholder="例如：製作能四人同時玩的十八啦骰子遊戲，有計分、動畫、規則與排行榜。" />
  <label className="code-builder-consent"><input type="checkbox" checked={aiConsent}
   disabled={busy} onChange={e=>setAiConsent(e.target.checked)}/>
   我同意本次使用付費 AI，單次模型請求上限 8 美分；停止或網路出錯不自動重試。
  </label>
  <label className="code-builder-consent"><input type="checkbox" checked={containerConsent}
   disabled={busy} onChange={e=>setContainerConsent(e.target.checked)}/>
   我另外授權 Cloudflare 隔離建置／測試（單次上限 5 美分）；若雲端尚未啟用則安全停止。
  </label>
  <label htmlFor="agent-max-cost">整個專案核准的 AI 費用上限（美分，8～100）</label>
  <input id="agent-max-cost" type="number" min={8} max={100} step={1}
   value={approvedCents} disabled={busy}
   onChange={e=>setApprovedCents(Number(e.target.value))}/>
  <p className="saved-apps-note">每按一次最多自動處理六步；費用還受伺服器總預算限制。
   不會自動部署、不會把模擬測試標成真實 QA PASS。</p>
  <button type="button" className="btn btn-primary"
   disabled={busy||!aiConsent||prompt.trim().length<5||
    !Number.isSafeInteger(approvedCents)||approvedCents<8||approvedCents>100}
   onClick={()=>{void execute(false);}}>
   {busy?"正在執行並保存 Agent 工作…":"建立新多檔案 App 專案"}
  </button>
  {saved?<button type="button" className="btn btn-secondary"
    disabled={busy||!aiConsent} onClick={()=>{void execute(true);}}>繼續上次保存的 Agent 工作</button>:null}
  {busy?<button type="button" className="btn btn-secondary"
    onClick={()=>{stop.current=true;}}>完成目前步驟後停止</button>:null}
  {error?<p role="alert">{error}</p>:null}
  {snapshot?<section aria-label="Agent 專案進度" role="status">
   <h3>已保存專案 · {snapshot.job.status}</h3>
   <p>{snapshot.message}</p>
   <p>版本 {snapshot.job.revision} · 本次處理 {snapshot.completed_steps} 步
    · {snapshot.job.files.length} 個檔案 · 尚未發布</p>
   <p className="saved-apps-note">接續狀態：{snapshot.progress?.next_action??"待查詢"}
    · 獨立 QA 尚未授予發布權限。</p>
   <details><summary>查看已保存原始碼（{snapshot.job.files.length} 個檔案）</summary>
    {snapshot.job.files.map(f=><details key={f.path}>
     <summary>{f.path}</summary><pre style={{whiteSpace:"pre-wrap",
      overflowWrap:"anywhere",maxHeight:"420px",overflowY:"auto"}}>{f.content}</pre>
    </details>)}
   </details>
  </section>:null}
 </section>;
}
