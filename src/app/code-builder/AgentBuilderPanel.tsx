import {useEffect,useRef,useState} from "react";
import {BrowserCodingAgent,savedCandidateTarget,readSavedCandidateLibrary,
 chooseSavedCandidate,paidAgentReconciliationRequired,type AgentBrowserOptions,
 type CandidateSnapshot} from "./agent-browser-client.js";
import {parseQaPlan,type QaPlan} from "../../platform/qa/requirement-contract.js";
import {advanceWithApprovedQaRepair} from "./agent-lifecycle.js";
import {savedAgentProjectZip} from "./agent-project-zip.js";
import {createPrivatePreviewFrame} from "./agent-private-preview.js";
import {requireAgentBuildReadiness} from "./agent-readiness.js";

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
 const [qaChecks,setQaChecks]=useState<readonly {criterion_id:string;verdict:string}[]>([]);
 const [approvedCents,setApprovedCents]=useState(60);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState("");
 const [snapshot,setSnapshot]=useState<CandidateSnapshot|null>(null);
 const [saved,setSaved]=useState(()=>savedCandidateTarget()!==null);
 const [catalog,setCatalog]=useState(()=>readSavedCandidateLibrary());
 const agent=useRef<BrowserCodingAgent|null>(null);
 const stop=useRef(false);
 const previewHost=useRef<HTMLDivElement>(null);
 const previewShell=useRef<HTMLDivElement>(null);
 const nativeFullscreen=useRef(false);
 const [previewReady,setPreviewReady]=useState(false);
 const [previewExpanded,setPreviewExpanded]=useState(false);
 const [previewFullscreenError,setPreviewFullscreenError]=useState("");
 useEffect(()=>{
  const onChange=()=>{
   if(document.fullscreenElement===previewShell.current){
    nativeFullscreen.current=true;setPreviewExpanded(true);
   }else if(nativeFullscreen.current){
    nativeFullscreen.current=false;setPreviewExpanded(false);
   }
  };
  document.addEventListener("fullscreenchange",onChange);
  return ()=>document.removeEventListener("fullscreenchange",onChange);
 },[]);
 useEffect(()=>{
  if(!previewExpanded)return;
  const previous=document.body.style.overflow;
  document.body.style.overflow="hidden";
  const onEscape=(event:KeyboardEvent)=>{
   if(event.key==="Escape"&&document.fullscreenElement!==previewShell.current)
    setPreviewExpanded(false);
  };
  document.addEventListener("keydown",onEscape);
  return ()=>{
   document.body.style.overflow=previous;
   document.removeEventListener("keydown",onEscape);
  };
 },[previewExpanded]);
 const togglePreviewFullscreen=()=>{
  if(!previewReady||!previewShell.current)return;
  setPreviewFullscreenError("");
  if(previewExpanded){
   setPreviewExpanded(false);
   if(document.fullscreenElement===previewShell.current)
    void document.exitFullscreen().catch(()=>undefined);
   return;
  }
  setPreviewExpanded(true);
  if(typeof previewShell.current.requestFullscreen==="function")
   void previewShell.current.requestFullscreen().catch(()=>{
    setPreviewFullscreenError("瀏覽器不支援原生全螢幕；已使用視窗填滿模式。");
   });
 };
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
 /** No paid dispatch: select a stored card then verify the original owner
  * signing key against the current persisted DB head before showing source.
  */
 const openSavedCandidate=async(jobId:string)=>{
  if(busy)return;
  setBusy(true);setError("");setQaOutcome("");setQaChecks([]);
  previewHost.current?.replaceChildren();setPreviewReady(false);
  try{
   if(!chooseSavedCandidate(jobId))throw Error("已保存的專案指標已過期。");
   // A previous live agent may hold a DIFFERENT job's signing key.
   const worker=new BrowserCodingAgent();
   agent.current=worker;
   const target=await worker.restore();
   if(!target||target.jobId!==jobId)
    throw Error("無法恢復原建立者的專案簽章。");
   const job=await worker.read();
   if(job.job_id!==jobId)throw Error("已保存專案身分不一致。");
   setPrompt(target.prompt);setQaJson("");setSaved(true);
   setSnapshot({job,progress:await worker.progress(),
    message:"已恢復保存的專案，不重新執行 AI 或雲端建置。",
    completed_steps:0});
   setCatalog([...readSavedCandidateLibrary()]);
  }catch(e){setError(failureMessage(e));}
  finally{setBusy(false);}
 };
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
 // eslint-disable-next-line complexity -- Explicit one-click AI, browser QA and repair require separate consent gates.
 const execute=async(resume:boolean)=>{
  if(busy||!aiConsent||!containerConsent||(!resume&&!browserQaConsent))return;
  // Never carry one project's QA or preview into a new immutable snapshot.
  setQaChecks([]);setQaOutcome("");setPreviewReady(false);
  previewHost.current?.replaceChildren();
  setBusy(true);setError("");stop.current=false;
  try{
   const worker=agent.current??new BrowserCodingAgent();
   agent.current=worker;
   // Recheck current live service config for initial AND resumed paid steps.
   await requireAgentBuildReadiness();
   if(resume){
    if(!await worker.restore())throw Error("找不到已保存的 Agent 工作。");
    const job=await worker.read();
    // Never resend first paid model call after PLANNING was journaled or
    // may be in an unknown state (e.g. browser closed mid-call).
    if(job.revision===0){
     // A planner response may already be journaled at revision zero.
     // Same job-scoped key safely reuses it without a second model charge.
     await worker.generateOriginalQaPlan();
     // Do not silently replan coding when a previous model call is uncertain.
     const renewed=await worker.progress();
     if(paidAgentReconciliationRequired(renewed))
      throw Error("已有模型付費結果未確認，已停止，不會重新付費。");
     await worker.plan();
    }
   }else{
    await worker.create(prompt,options(),acceptancePlan());
    setSaved(true);setCatalog([...readSavedCandidateLibrary()]);
    const initial=await worker.read();
    setSnapshot({job:initial,progress:null,
     message:"專案已保存；正在驗證並凍結開發前的原始 QA 計畫…",completed_steps:0});
    // If no JSON is supplied, generate the plan automatically from the
    // original natural-language request, never from produced source code.
    await worker.generateOriginalQaPlan();
    setCatalog([...readSavedCandidateLibrary()]);
    setSnapshot({job:await worker.read(),progress:null,
     message:"原始 QA 計畫已凍結；現在才開始 AI 編碼。",completed_steps:0});
    await worker.plan();
   }
   // One approved click now continues into private Browser QA and, on a
   // proven failure, at most one bounded AI repair. Never publishes an App.
   const done=await advanceWithApprovedQaRepair(worker,options(),
    browserQaConsent&&savedCandidateTarget()?.qaPlan!==undefined,
    setSnapshot,()=>stop.current);
   setSnapshot(done.snapshot);
   if(done.qa){
    setQaChecks(done.qa.checks);
    setQaOutcome(done.qa.ready_for_review?
     "獨立 QA 已通過；App 尚未獲發布授權。":
     done.repairStarted?
      "獨立 QA 失敗，已依本次授權修復一次並保存結果；下次 QA 需重新核准。":
      "獨立 QA 失敗，已保存證據；可於下一次授權後接續修復。");
   }
  }catch(e){
   setError(failureMessage(e));
   // A failed call can have charged; do not retry automatically.
   if(agent.current!==null){
    try{
     const job=await agent.current.read();
     // A read-only signed progress lookup can recover the durable head,
     // but NEVER retries an uncertain paid AI, container or QA request.
     const progress=await agent.current.progress().catch(()=>null);
     const needsReconciliation=progress!==null&&
      (paidAgentReconciliationRequired(progress)||
       progress.qa_attempt_state==="BLOCKED_UNCERTAIN"||
       progress.qa_attempt_state==="IN_FLIGHT");
     setSnapshot({job,progress,completed_steps:0,
      message:needsReconciliation?
       "已保存工作，付費執行結果仍不明；停止重試，等待查核。":
       "已保留資料庫專案；只讀取實際進度，沒有再次呼叫付費服務。"});
    }catch{ /* Creator proof or service may be unavailable. */ }
   }
  }finally{setBusy(false);}
 };
 /** Read-only recovery: never dispatches AI, containers or QA. */
 const refreshSavedProgress=async()=>{
  if(busy||!saved)return;
  setBusy(true);setError("");
  try{
   const worker=agent.current??new BrowserCodingAgent();
   agent.current=worker;
   if(!await worker.restore())
    throw Error("找不到原專案的簽章金鑰，無法讀取已保存進度。");
   const job=await worker.read();
   const progress=await worker.progress();
   setSnapshot({job,progress,completed_steps:0,
    message:"已從資料庫讀取最新工作與獨立 QA 紀錄，沒有重新呼叫 AI、容器或瀏覽器 QA。"});
  }catch(e){setError(failureMessage(e));}
  finally{setBusy(false);}
 };
 const openPrivatePreview=async()=>{
  if(busy||!containerConsent)return;
  setBusy(true);setError("");setPreviewReady(false);
  try{
   const worker=agent.current??new BrowserCodingAgent();
   agent.current=worker;
   if(!await worker.restore())throw Error("找不到原專案的簽章金鑰。");
   const source=await worker.privatePreview(true);
   const frame=await createPrivatePreviewFrame(source,document);
   previewHost.current?.replaceChildren(frame);
   setPreviewReady(true);
  }catch(e){previewHost.current?.replaceChildren();setError(failureMessage(e));}
  finally{setBusy(false);}
 };
 const downloadSource=async()=>{
  if(busy||!saved)return;
  setBusy(true);setError("");
  try{
   const worker=agent.current??new BrowserCodingAgent();
   agent.current=worker;
   const target=await worker.restore();
   if(!target)throw Error("找不到已保存專案的簽章金鑰。");
   // Fetch the latest PoP-protected DB head; never export an old UI snapshot.
   const latest=await worker.read();
   if(latest.job_id!==target.jobId)throw Error("專案身分不一致，停止匯出。");
   const zip=await savedAgentProjectZip(latest);
   const url=URL.createObjectURL(new Blob([zip],{type:"application/zip"}));
   const link=document.createElement("a");
   link.href=url;link.download="appf2-agent-"+target.jobId+"-v"+latest.revision+".zip";
   document.body.append(link);link.click();link.remove();
   setTimeout(()=>URL.revokeObjectURL(url),2000);
   setSnapshot({job:latest,progress:null,
    message:"已匯出資料庫最新版本的完整原始碼 ZIP；沒有重新呼叫 AI、建置或部署。",
    completed_steps:0});
  }catch(e){setError(failureMessage(e));}
  finally{setBusy(false);}
 };
 const runQa=async(repair:boolean,reconcileOnly=false)=>{
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
    if(!reconcileOnly&&!browserQaConsent)
     throw Error("必須另外授權本次獨立瀏覽器 QA。");
    const result=await worker.independentQa(true,reconcileOnly);
    setQaChecks(result.checks);
    setQaOutcome(result.ready_for_review?
     "原始需求的獨立 QA 已通過，可供後續人工審核；App 尚未發布。":
     reconcileOnly?
      "已從資料庫恢復 QA 失敗結果，不重新呼叫雲端瀏覽器；可授權 AI 修復。":
      "獨立 QA 未通過。檢查已保存的失敗條件後，可另行授權 AI 修復。");
   }
   setSnapshot({job:await worker.read(),progress:await worker.progress(),
    message:"獨立 QA / 修復結果已保存，尚未發布 App。",completed_steps:0});
  }catch(e){setError(failureMessage(e));}
  finally{setBusy(false);}
 };
 const frozenPlan=savedCandidateTarget()?.qaPlan;
 const qaAttemptState=snapshot?.progress?.qa_attempt_state;
 // Prefer evidence bound to the current signed DB project over in-tab results.
 // Neither a saved PASS check nor its digest grants publication authority.
 const visibleQaChecks=snapshot?.progress?.qa_observed_checks?.length?
  snapshot.progress.qa_observed_checks:qaChecks;
 return <section className="code-builder-panel" aria-labelledby="agent-builder-title">
  <h2 id="agent-builder-title">AI App Builder · 多檔案 Agent</h2>
  <p className="saved-apps-note">真正的多檔案程式專案；AI 可以編寫、保存、要求隔離建置與修復。
   免費替代方案使用 GitHub Actions 隔離 Docker＋Chromium 驗收（需把新作品流程接入）；
   尚未接通之前，不會假裝已產生可操作 App。功能是否能操作需獨立驗證；目前生成的是私人候選原始碼，<strong>尚未自動發布成可用 App</strong>。</p>
  {catalog.length>0?<section aria-label="已保存的 Agent 專案">
   <h3>已保存的多檔案 App 專案（此瀏覽器）</h3>
   <p className="saved-apps-note">選擇原專案繼續開發或下載程式，
    不會重新生成或支付 AI 費用。新版 Agent 原始簽章金鑰最長有效 30 天；
    舊專案仍以建立時的原金鑰期限為準。這是私人候選清單，並非已發布 App。</p>
   <ul>{catalog.map(item=><li key={item.jobId}>
    <button className="btn btn-secondary" type="button" disabled={busy}
     onClick={()=>{void openSavedCandidate(item.jobId);}}>
     開啟：{item.prompt.slice(0,65)}
    </button>
   </li>)}</ul>
  </section>:null}
  <label htmlFor="code-builder-prompt">用一句話描述要做的 App</label>
  <textarea id="code-builder-prompt" className="composer-input" value={prompt}
   maxLength={800} disabled={busy} onChange={e=>setPrompt(e.target.value)}
   placeholder="例如：製作能四人同時玩的十八啦骰子遊戲，有計分、動畫、規則與排行榜。" />
  <details>
   <summary>進階：開發前鎖定獨立 QA 驗收計畫（選填）</summary>
   <p className="saved-apps-note">一般使用者不必寫 JSON：留白會在 AI 編碼前，自動花費最多 8 美分產生並凍結驗收計畫。只在需要自行指定測試時貼上 JSON。AI 計畫仍需通過引用原始需求、操作與預期結果的驗證。</p>
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
   我另行核准本次獨立雲端瀏覽器 QA；建置測試完成後自動驗收，若失敗且仍有步數，依本次 AI 授權修復一次。不重試、不自動發布。
  </label>
  <label htmlFor="agent-max-cost">整個專案核准的 AI 費用上限（美分，自動 QA 最低 16；最多 100）</label>
  <input id="agent-max-cost" type="number" min={8} max={100} step={1}
   value={approvedCents} disabled={busy}
   onChange={e=>setApprovedCents(Number(e.target.value))}/>
  <p className="saved-apps-note">每按一次開發加修復總計最多六個 Agent 步驟，另可依授權做一次獨立 QA；費用仍受伺服器總預算限制。
   建立前先唯讀檢查 AI／Sandbox／Browser QA 是否配置，缺服務不先扣 AI 費；
   不會自動部署、不會把模擬測試標成真實 QA PASS。</p>
  <button type="button" className="btn btn-primary"
   disabled={busy||!aiConsent||!containerConsent||!browserQaConsent||
    prompt.trim().length<5||
    !Number.isSafeInteger(approvedCents)||
    approvedCents<(qaJson.trim()?8:16)||approvedCents>100}
   onClick={()=>{void execute(false);}}>
   {busy?"正在執行並保存 Agent 工作…":"建立新多檔案 App 專案"}
  </button>
  {saved?<button type="button" className="btn btn-secondary"
    disabled={busy||!aiConsent||!containerConsent}
    onClick={()=>{void execute(true);}}>繼續上次保存的 Agent 工作</button>:null}
  {saved?<button type="button" className="btn btn-secondary"
    disabled={busy} onClick={()=>{void refreshSavedProgress();}}>
    查詢已保存的產品進度與 QA 紀錄（不扣費）
   </button>:null}
  {snapshot?.job.status==="TESTING"&&frozenPlan&&
   qaAttemptState==="NOT_RUN"?
   <button type="button" className="btn btn-secondary"
    disabled={busy||!browserQaConsent}
    onClick={()=>{void runQa(false);}}>開始獨立瀏覽器 QA（需另行授權）</button>:null}
  {snapshot?.job.status==="TESTING"&&qaAttemptState==="RESULT_RECORDED"?
   <p role="status" className="saved-apps-note">
    資料庫已保存此版本的獨立 Browser QA 回應。這不是重新驗證的 PASS，
    不可直接發布；禁止重送同一次付費 QA，請依已保存結果接續審核。
    <button type="button" className="btn btn-secondary"
     disabled={busy} onClick={()=>{void runQa(false,true);}}>
     依已保存 QA 證據恢復專案狀態（不重跑、不扣費）
    </button>
   </p>:null}
  {snapshot?.job.status==="TESTING"&&
   (qaAttemptState==="IN_FLIGHT"||qaAttemptState==="BLOCKED_UNCERTAIN")?
   <p role="status" className="saved-apps-note">
    獨立 Browser QA 的執行結果仍不確定；已停止重試以避免重複費用。
   </p>:null}
  {snapshot?.job.status==="REPAIRING"&&frozenPlan?
   <button type="button" className="btn btn-secondary"
    disabled={busy||!aiConsent}
    onClick={()=>{void runQa(true);}}>根據 QA 失敗結果要求 AI 修復（需另行授權）</button>:null}
  {snapshot?.job.status==="TESTING"&&!frozenPlan?
   <p className="saved-apps-note">此專案未在開發前鎖定 QA 驗收計畫；不能事後補測試並宣稱已通過獨立 QA。</p>:null}
  {qaOutcome?<p role="status">{qaOutcome}</p>:null}
  {visibleQaChecks.length>0?<section aria-label="QA 逐項結果">
   <h3>已保存的 QA 逐項操作結果</h3>
   <p className="saved-apps-note">以下為目前專案的瀏覽器操作觀察，
    不是最終產品發布 PASS。FAIL／UNTESTED 必須修復後再次驗收。</p>
   <ul>{visibleQaChecks.map(c=><li key={c.criterion_id}>
    {frozenPlan?.criteria.find(x=>x.id===c.criterion_id)?.description??c.criterion_id}
    ：{c.verdict}
   </li>)}</ul>
  </section>:null}
  {snapshot&&["TESTING","REPAIRING"].includes(snapshot.job.status)?
   <section aria-label="私人多檔案 App 互動預覽">
    <button type="button" className="btn btn-secondary"
     disabled={busy||!containerConsent}
     onClick={()=>{void openPrivatePreview();}}>
     開啟已建置 App 互動預覽（需雲端存取授權）
    </button>
    <p className="saved-apps-note">只顯示已通過隔離建置與測試的私人候選 App；
     預覽可能喚醒 Cloudflare 容器，但不會重新呼叫 AI、編譯或發布。
     瀏覽器以隔離、禁止網路的 iframe 執行，不能讀取 APPf2 帳戶。
     此預覽不代表獨立 QA PASS。</p>
    {previewReady?<p role="status">正在顯示已保存建置成果；尚未正式發布。</p>:null}
    <div ref={previewShell}
     className={"code-app-viewer"+(previewExpanded?" code-app-viewer-expanded":"")}
     aria-label="私人候選 App 全螢幕檢視">
     <div className="code-app-viewer-toolbar">
      <span>私人候選 App · 操作測試不代表正式驗收通過</span>
      <button type="button" className="btn btn-secondary"
       disabled={!previewReady} aria-pressed={previewExpanded}
       onClick={togglePreviewFullscreen}>
       {previewExpanded?"退出全螢幕":"全螢幕顯示"}
      </button>
     </div>
     {previewFullscreenError?<p className="code-app-display-note" role="status">
      {previewFullscreenError}
     </p>:null}
     <div ref={previewHost} className="code-app-frame" />
    </div>
   </section>:null}
  {snapshot&&snapshot.job.files.length>0?
   <button type="button" className="btn btn-secondary"
    disabled={busy} onClick={()=>{void downloadSource();}}>
    下載目前已保存的多檔案專案 ZIP（不花 AI 費用）
   </button>:null}
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
