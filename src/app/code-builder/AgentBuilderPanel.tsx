import {useEffect,useRef,useState} from "react";
import {BrowserCodingAgent,savedCandidateTarget,type AgentBrowserOptions,
 type CandidateSnapshot} from "./agent-browser-client.js";
import {parseQaPlan,type QaPlan} from "../../platform/qa/requirement-contract.js";

type Props={readonly suggestedPrompt?:{text:string;revision:number}|null};
function failureMessage(e:unknown):string{
 return e instanceof Error?e.message:"Agent 已停止；請先檢查已保存的工作。";
}
/** Real multi-file Agent entry, not the legacy single-file code-app publisher.
 * Candidate is viewable as source only until independent QA/publishing exists.
 */
// eslint-disable-next-line complexity, max-lines-per-function -- Signed authoring, QA and repair controls share the immutable candidate state.
export function AgentBuilderPanel({suggestedPrompt}:Props){
 const [prompt,setPrompt]=useState(suggestedPrompt?.text??"");
 const [aiConsent,setAiConsent]=useState(false);
 const [containerConsent,setContainerConsent]=useState(false);
 const [browserQaConsent,setBrowserQaConsent]=useState(false);
 const [qaJson,setQaJson]=useState("");
 const [qaOutcome,setQaOutcome]=useState("");
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
 const acceptancePlan=():QaPlan|undefined=>{
  if(!qaJson.trim())return undefined;
  let parsed:unknown;
  try{parsed=JSON.parse(qaJson) as unknown;}
  catch{throw Error("QA 計畫必須是有效 JSON；不能根據程式事後編造測試。");}
  const plan=parseQaPlan(parsed,prompt.trim());
  if(!plan)throw Error("QA 計畫無法對應原始需求，請確認引用文字、動作及預期結果。");
  return plan;
 };
 const options=():AgentBrowserOptions=>({
  allowAi:aiConsent,allowContainer:containerConsent,approvedCents});
 const extend=async()=>{
  if(busy||!saved)return;
  setBusy(true);setError("");
  try{
   const worker=agent.current??new BrowserCodingAgent();
   agent.current=worker;
   if(!await worker.restore())throw Error("找不到原始專案的簽章金鑰。");
   const job=await worker.extendStepsSameCost();
   setSnapshot({job,progress:await worker.progress(),
    message:"已簽章延長 16 步；沿用原核准的費用上限，沒有呼叫 AI 或容器。",
    completed_steps:0});
  }catch(e){setError(failureMessage(e));}
  finally{setBusy(false);}
 };
 const execute=async(resume:boolean)=>{
  if(busy||!aiConsent)return;
  setBusy(true);setError("");stop.current=false;
  try{
   const worker=agent.current??new BrowserCodingAgent();
   agent.current=worker;
   if(resume){
    if(!await worker.restore())throw Error("找不到已保存的 Agent 工作。");
    const [job,progress]=await Promise.all([worker.read(),worker.progress()]);
    // Never resend first paid model call after PLANNING was journaled or
    // may be in an unknown state (e.g. browser closed mid-call).
    if(job.revision===0&&progress.calls.length===0){
     const target=savedCandidateTarget();
     if(target?.qaPlan)await worker.freezeOriginalQaPlan();
     await worker.plan();
    }
   }else{
    await worker.create(prompt,options(),acceptancePlan());
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
 const runQa=async(repair:boolean)=>{
  if(busy)return;
  setBusy(true);setError("");setQaOutcome("");
  try{
   const worker=agent.current??new BrowserCodingAgent();
   agent.current=worker;
   if(!await worker.restore())throw Error("找不到原專案的簽章授權。");
   if(repair){
    if(!aiConsent)throw Error("必須另外同意本次付費 AI 修復。");
    await worker.repairFailedQa(true);
    setQaOutcome("修復模型回應已保存。請點「繼續上次保存的 Agent 工作」套用修復、重新建置和測試。");
   }else{
    if(!browserQaConsent)throw Error("必須另外授權本次獨立瀏覽器 QA。");
    const result=await worker.independentQa(true);
    setQaOutcome(result.ready_for_review?
     "原始需求的獨立 QA 已通過，可供後續人工審核；App 尚未發布。":
     "獨立 QA 未通過。檢查已保存的失敗條件後，可另行授權 AI 修復。");
   }
   setSnapshot({job:await worker.read(),progress:await worker.progress(),
    message:"獨立 QA / 修復結果已保存，尚未發布 App。",completed_steps:0});
  }catch(e){setError(failureMessage(e));}
  finally{setBusy(false);}
 };
 const frozenPlan=savedCandidateTarget()?.qaPlan;
 return <section className="code-builder-panel" aria-labelledby="agent-builder-title">
  <h2 id="agent-builder-title">AI App Builder · 多檔案 Agent</h2>
  <p className="saved-apps-note">真正的多檔案程式專案；AI 可以編寫、保存、要求隔離建置與修復。
   功能是否能操作需獨立驗證；目前生成的是私人候選原始碼，<strong>尚未自動發布成可用 App</strong>。</p>
  <label htmlFor="code-builder-prompt">用一句話描述要做的 App</label>
  <textarea id="code-builder-prompt" className="composer-input" value={prompt}
   maxLength={800} disabled={busy} onChange={e=>setPrompt(e.target.value)}
   placeholder="例如：製作能四人同時玩的十八啦骰子遊戲，有計分、動畫、規則與排行榜。" />
  <details>
   <summary>進階：開發前鎖定獨立 QA 驗收計畫（選填）</summary>
   <p className="saved-apps-note">此計畫需在 AI 開始寫程式前保存。每項 source_quote 必須取自原始需求，且需列出實際操作及預期結果。未提供時不會聲稱已通過獨立 QA。</p>
   <label htmlFor="agent-qa-plan-json">原始驗收計畫 JSON</label>
   <textarea id="agent-qa-plan-json" className="composer-input" value={qaJson}
    disabled={busy} onChange={e=>setQaJson(e.target.value)}
    placeholder='{"version":"1","criteria":[{"id":"check_button","source_quote":"按鈕","description":"點擊後顯示結果","steps":[{"action":"click","role":"button","name":"開始"}],"assertions":[{"kind":"text_appears","text":"完成"}],"automatable":true}]}' />
  </details>
  <label className="code-builder-consent"><input type="checkbox" checked={aiConsent}
   disabled={busy} onChange={e=>setAiConsent(e.target.checked)}/>
   我同意本次使用付費 AI，單次模型請求上限 8 美分；停止或網路出錯不自動重試。
  </label>
  <label className="code-builder-consent"><input type="checkbox" checked={containerConsent}
   disabled={busy} onChange={e=>setContainerConsent(e.target.checked)}/>
   我另外授權 Cloudflare 隔離建置／測試（單次上限 5 美分）；若雲端尚未啟用則安全停止。
  </label>
  <label className="code-builder-consent"><input type="checkbox" checked={browserQaConsent}
   disabled={busy} onChange={e=>setBrowserQaConsent(e.target.checked)}/>
   我另外核准本次獨立雲端瀏覽器 QA；可能產生 Cloudflare 費用，不自動重試。
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
  {snapshot?.job.status==="TESTING"&&frozenPlan?
   <button type="button" className="btn btn-secondary"
    disabled={busy||!browserQaConsent}
    onClick={()=>{void runQa(false);}}>開始獨立瀏覽器 QA（需另行授權）</button>:null}
  {snapshot?.job.status==="REPAIRING"&&frozenPlan?
   <button type="button" className="btn btn-secondary"
    disabled={busy||!aiConsent}
    onClick={()=>{void runQa(true);}}>根據 QA 失敗結果要求 AI 修復（需另行授權）</button>:null}
  {snapshot?.job.status==="TESTING"&&!frozenPlan?
   <p className="saved-apps-note">此專案未在開發前鎖定 QA 驗收計畫；不能事後補測試並宣稱已通過獨立 QA。</p>:null}
  {qaOutcome?<p role="status">{qaOutcome}</p>:null}
  {snapshot&&snapshot.job.checkpoint?.budget.max_steps<512?
   <button type="button" className="btn btn-secondary"
    disabled={busy} onClick={()=>{void extend();}}>延長 16 步（費用上限不變）</button>:null}
  {busy?<button type="button" className="btn btn-secondary"
    onClick={()=>{stop.current=true;}}>完成目前步驟後停止</button>:null}
  {error?<p role="alert">{error}</p>:null}
  {snapshot?<section aria-label="Agent 專案進度" role="status">
   <h3>已保存專案 · {snapshot.job.status}</h3>
   <p>{snapshot.message}</p>
   <p>版本 {snapshot.job.revision} · 本次處理 {snapshot.completed_steps} 步
    · {snapshot.job.files.length} 個檔案 · 尚未發布</p>
   {snapshot.job.checkpoint?
    <p>累計步數 {snapshot.job.checkpoint.step}/
     {snapshot.job.checkpoint.budget.max_steps}
     · 原核准總費用上限 {snapshot.job.checkpoint.budget.max_cost_cents} 美分</p>:null}
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
