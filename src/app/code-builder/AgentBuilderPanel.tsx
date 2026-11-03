import {useEffect,useRef,useState} from "react";
import {BrowserCodingAgent,savedCandidateTarget,readSavedCandidateLibrary,
 chooseSavedCandidate,paidAgentReconciliationRequired,allFrozenFreeCiChecksPassed,
 canResumeSavedFreeCiOnly,
 type AgentBrowserOptions,
 type CandidateSnapshot,type AgentJobTimeline,type UserEditLedger} from "./agent-browser-client.js";
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
 const [fullstack,setFullstack]=useState(false);
 const [aiConsent,setAiConsent]=useState(false);
 const [containerConsent,setContainerConsent]=useState(false);
 const [browserQaConsent,setBrowserQaConsent]=useState(false);
 const [freeCiConsent,setFreeCiConsent]=useState(false);
 const [freeCiStatus,setFreeCiStatus]=useState("");
 const [publicShareConsent,setPublicShareConsent]=useState(false);
 const [autoRepairConsent,setAutoRepairConsent]=useState(false);
 const [publishedUrl,setPublishedUrl]=useState("");
 const [qaJson,setQaJson]=useState("");
 const [styleTheme,setStyleTheme]=useState<"blue"|"green"|"sand">("blue");
 const [styleResult,setStyleResult]=useState("");
 const [userEditLedger,setUserEditLedger]=useState<UserEditLedger|null>(null);
 const [userEditText,setUserEditText]=useState("");
 const [userEditExpected,setUserEditExpected]=useState("");
 const [userEditButton,setUserEditButton]=useState("");
 const [userEditQaConfirmed,setUserEditQaConfirmed]=useState(false);
 const [userEditAiApproved,setUserEditAiApproved]=useState(false);
 const [userEditSelected,setUserEditSelected]=useState("");
 const [userEditMessage,setUserEditMessage]=useState("");
 const [qaOutcome,setQaOutcome]=useState("");
 const [qaChecks,setQaChecks]=useState<readonly {criterion_id:string;verdict:string;
  failure_code?:string}[]>([]);
 const [approvedCents,setApprovedCents]=useState(60);
 const [busy,setBusy]=useState(false);
 // Duration shown to the person is THIS browser session, not a provider
 // performance promise or a complete end-to-end server-side SLA.
 const [freeAiStartedAt,setFreeAiStartedAt]=useState<number|null>(null);
 const [freeAiElapsedSec,setFreeAiElapsedSec]=useState(0);
 const [error,setError]=useState("");
 const [snapshot,setSnapshot]=useState<CandidateSnapshot|null>(null);
 const [timeline,setTimeline]=useState<AgentJobTimeline|null>(null);
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
  if(freeAiStartedAt===null)return;
  const update=()=>setFreeAiElapsedSec(Math.max(0,
   Math.floor((Date.now()-freeAiStartedAt)/1000)));
  update();
  // A five-second refresh avoids re-rendering the whole App Builder each
  // second or flooding assistive technology with timer announcements.
  const timer=window.setInterval(update,5000);
  return ()=>window.clearInterval(timer);
 },[freeAiStartedAt]);
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
 useEffect(()=>{
  if(!snapshot?.job){setTimeline(null);return;}
  let cancelled=false;
  const worker=agent.current;
  if(!worker)return;
  // Every fresh saved snapshot may include a new Runner receipt at the same
  // revision. This read is signed and zero-charge, never a model retry.
  void worker.timeline().then(result=>{
   if(!cancelled)setTimeline(result);
  }).catch(()=>{if(!cancelled)setTimeline(null);});
  return ()=>{cancelled=true;};
 },[snapshot]);
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
  allowAi:aiConsent,allowContainer:containerConsent,approvedCents,fullstack});
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
    message:job.free_ci?.preview_ready?
     "已載入保存的私人 App 卡片；同一份建置成果不用重新生成。":
     "已恢復保存的專案，不重新執行 AI 或雲端建置。",
    completed_steps:0});
   setCatalog([...readSavedCandidateLibrary()]);
   let accepted:UserEditLedger["accepted"]=null;
   try{
    const ledger=await worker.userEditLedger();
    accepted=ledger.accepted;setUserEditLedger(ledger);
   }catch{setUserEditLedger(null);}
   // An unaccepted working head NEVER masquerades as the saved product.
   // Accepted's immutable, QA-sealed old build is always preferred.
   if(accepted||job.free_ci?.preview_ready){
    try{
     const asset=accepted?await worker.acceptedFreeCiPreview(accepted):
      await worker.freeCiPreview();
     const frame=await createPrivatePreviewFrame(asset,document);
     previewHost.current?.replaceChildren(frame);
     setPreviewReady(true);
    }catch(e){
     // The private Job remains recoverable even if preview fails closed.
     setError("私人 App 建置成果無法安全重開："+failureMessage(e));
    }
   }
  }catch(e){setError(failureMessage(e));}
  finally{setBusy(false);}
 };
 const saveStyleCandidate=async()=>{
  if(busy)return;
  setBusy(true);setError("");setStyleResult("");
  try{
   const worker=agent.current??new BrowserCodingAgent();
   agent.current=worker;
   if(!await worker.restore())throw Error("原始 App 未通過簽章驗證。");
   const savedJob=await worker.safeStyleEdit(styleTheme);
   previewHost.current?.replaceChildren();setPreviewReady(false);
   setSnapshot({job:savedJob,progress:null,message:"候選版已保存，須重新完成原需求驗收。",completed_steps:0});
   setStyleResult("修改已保存；不會自動發布或花費 AI。");
  }catch(e){setError(failureMessage(e));}
  finally{setBusy(false);}
 };
 const initializeUserEdit=async()=>{
  if(busy)return;
  setBusy(true);setError("");setUserEditMessage("");
  try{
   const worker=agent.current??new BrowserCodingAgent();
   agent.current=worker;
   if(!await worker.restore())throw Error("原建立者簽章無法恢復。");
   const accepted=await worker.initializeUserEdit();
   setUserEditLedger(await worker.userEditLedger());
   setUserEditMessage("已保存的原 App 通過原始 QA；Accepted "+accepted.project_hash.slice(0,21));
  }catch(e){setError(failureMessage(e));}
  finally{setBusy(false);}
 };
 const createUserEditDraft=async()=>{
  if(busy||!userEditQaConfirmed)return;
  setBusy(true);setError("");setUserEditMessage("");
  try{
   const worker=agent.current??new BrowserCodingAgent();
   agent.current=worker;
   if(!await worker.restore())throw Error("原建立者簽章無法恢復。");
   const req=userEditText.trim(),expected=userEditExpected.trim();
   if(req.length<5||expected.length<2||expected.length>160)
    throw Error("需要一句具體修改要求，以及可在畫面驗證的預期結果。");
   const button=userEditButton.trim();
   if(button.length>120)throw Error("按鈕名稱過長，請重新確認。");
   const qa:QaPlan={version:"1",criteria:[{
    id:"edit_"+crypto.randomUUID().replace(/-/gu,"").slice(0,16),
    source_quote:req.slice(0,Math.min(req.length,160)),
    description:"新修改後應符合已確認的畫面結果",
    automatable:true,
    steps:button?[{action:"click",role:"button",name:button}]:[],
    assertions:[{kind:"text_includes",text:expected}]
   }]};
   const id=await worker.createUserEdit(req,qa);
   setUserEditSelected(id);
   setUserEditLedger(await worker.userEditLedger());
   setUserEditAiApproved(false);
   setUserEditMessage("新需求與驗收條件已保存；尚未呼叫 AI、容器或變更現行產品。");
  }catch(e){setError(failureMessage(e));}
  finally{setBusy(false);}
 };
 const runUserEditModel=async()=>{
  if(busy||!userEditAiApproved||!userEditSelected)return;
  setBusy(true);setError("");setUserEditMessage("");
  try{
   const worker=agent.current??new BrowserCodingAgent();
   agent.current=worker;
   if(!await worker.restore())throw Error("無法恢復原建立者簽章。");
   await worker.generateUserEdit(userEditSelected,true,()=>stop.current);
   setUserEditLedger(await worker.userEditLedger());
   setSnapshot({job:await worker.read(),progress:await worker.progress(),
    message:"AI 只保存了候選版。須執行原＋新需求全部 Chromium QA，尚未接受。",
    completed_steps:0});
   setUserEditMessage("AI 候選版已保存；目前 Accepted 完全未改變。");
  }catch(e){setError(failureMessage(e));}
  finally{setBusy(false);}
 };
 const acceptUserEditCandidate=async()=>{
  if(busy||!userEditLedger?.accepted||!userEditSelected)return;
  setBusy(true);setError("");setUserEditMessage("");
  try{
   const worker=agent.current??new BrowserCodingAgent();
   agent.current=worker;
   if(!await worker.restore())throw Error("無法恢復原建立者簽章。");
   const accepted=await worker.acceptUserEdit(userEditSelected,userEditLedger.accepted);
   setUserEditLedger(await worker.userEditLedger());
   setUserEditMessage("完整原＋新 QA 已由後端驗證，已接受版本 "+accepted.project_hash.slice(0,21));
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
 /** Product flow: real language → journaled paid AI → GitHub free Docker →
  * Chromium frozen-case observations → immutable private App; one optional
  * explicitly authorized repair, then optional owner-approved publication.
  */
 /* eslint-disable max-depth -- bounded receipt polling only; original requirements still fail closed. */
 // eslint-disable-next-line complexity, max-lines-per-function -- Third-round original QA provenance and cost fences cannot be elided.
 const startFreeAi=async(resume=false)=>{
  if(busy||!aiConsent||!containerConsent||!browserQaConsent||!freeCiConsent||
   approvedCents<44)return;
  setBusy(true);setError("");setQaOutcome("");setPublishedUrl("");
  setQaChecks([]);setPreviewReady(false);stop.current=false;
  setFreeAiElapsedSec(0);setFreeAiStartedAt(Date.now());
  try{
   const readiness=await fetch("/api/v1/agent-readiness",{cache:"no-store"});
   const status=await readiness.json() as {data?:{free_ci_paid_ai_available?:boolean}};
   if(!readiness.ok||status.data?.free_ci_paid_ai_available!==true)
    throw Error("Staging 真 AI 安全通道尚未部署，沒有執行付費模型。");
   const worker=new BrowserCodingAgent();agent.current=worker;
   if(resume){
    const target=await worker.restore();
    if(!target)throw Error("原建立者的保存工作或簽章已過期，禁止新建替代付費 Job。");
    const existing=await worker.read();
    // Resume the original authenticated job after CODE/REPAIR as well.
    // Neither the original prompt nor the model call is re-created.
    if(existing.revision<0)throw Error("保存工作版本無效，停止接續。");
    setPrompt(target.prompt);
   }else{
    await worker.create(prompt,{allowAi:true,allowContainer:false,
     approvedCents},acceptancePlan());
   }
   setSaved(true);setCatalog([...readSavedCandidateLibrary()]);
   setSnapshot({job:await worker.read(),progress:null,
    message:resume?
     "正在用同一個已保存的 GPT-6 Job 繼續查詢回應；不建立新工作。":
     "已保存原始需求；獨立 QA 計畫必須在編碼前凍結。",
    completed_steps:0});
   let current=await worker.read();
   // A paid CODE result may have committed only CREATED→PLANNING before
   // the original browser response was lost. Same original owner and saved
   // journal answer must finish PLANNING→CODING, never start another model.
   const resumeHalfCode=resume&&current.revision===1&&
    current.status==="PLANNING"&&current.checkpoint.step===1;
   if(current.revision===0||resumeHalfCode){
    if(current.revision===0){
     if(savedCandidateTarget()?.qaPlan&&!resume)
      await worker.freezeOriginalQaPlan();
     else await worker.freeAiStage("QA",()=>stop.current);
    }
    setSnapshot({job:current,progress:null,
     message:"GPT-6 正在編寫原需求的完整 App。模型和免費 Runner 都可能排隊；"+
      "可以停止此頁等待，日後由原 Job 接續，不需要重新生成。",
     completed_steps:0});
    const created=await worker.freeAiStage("CODE",()=>stop.current);
    current=await worker.read();
    setSnapshot({job:current,progress:null,
     message:created.status==="AI_SOURCE_SAVED_FREE_CI_QUEUED"?
      "真 AI 程式已保存並派發免費 Docker；正在等待獨立 Browser QA。":
      "AI 程式已保存，GitHub 派發未證實；不會重新付費。",
     completed_steps:0});
    if(created.status!=="AI_SOURCE_SAVED_FREE_CI_QUEUED")
     throw Error("免費 Docker 派發未獲確認；原 Job 保存，不重送付費 AI。");
   }
   // The paid model may have SUCCEEDED and saved all source bytes while
   // the initial browser/Worker HTTP response was lost. A creator-signed
   // RESUME may explicitly requeue FREE QA for the SAME saved revision,
   // without requesting a second paid model turn or re-creating a Job.
   if(resume&&canResumeSavedFreeCiOnly(current)){
    await worker.dispatchFreeCiBuild(true);
    setSnapshot({job:current,progress:null,
     message:"原 GPT-6 程式已保存；只重新派發免費 Docker／Chromium QA。沒有重做或再次付費生成。",
     completed_steps:0});
   }
   let repaired=Math.max(0,Math.floor(current.checkpoint.step/2)-1);
   let receiptSeen=false;
   for(let i=0;i<90&&!stop.current;i++){
    await new Promise<void>(resolve=>window.setTimeout(resolve,8000));
    if(stop.current)break;
    current=await worker.read();
    setSnapshot({job:current,progress:null,
     message:"正在讀取原 Job 的真正 Docker／Chromium 收據，不重新呼叫模型。",
     completed_steps:0});
    if(!current.free_ci)continue;
    receiptSeen=true;
    const checks=current.free_ci.qa_checks??[];
    setQaChecks(checks);
    // Build failure can have a signed QA receipt but no runnable preview.
    // Evaluate its failure BEFORE requiring preview_ready, or repair never runs.
    if(current.free_ci.status==="BUILD_FAILED"||
       checks.some(c=>c.verdict==="FAIL")){
     const nextRound=repaired+1;
     const required=28+16*nextRound;
     if(autoRepairConsent&&nextRound<=3&&
        current.checkpoint.budget.max_cost_cents>=required){
      // Third same-lineage failure triggers a REAL strategy change.
      // Verify the original-owner signed Staging receipt evidence BEFORE
      // authorizing paid GPT-6 REPAIR v3. An unsupported pattern is not
      // permission to spend on another identical patch.
      if(nextRound===3){
       const evidence=await worker.inspectFreeAiRepairEvidence();
       if(evidence.project_hash!==current.project_hash||
        evidence.job_revision!==current.revision||
        evidence.next_round!==3||
        evidence.repeated_failure_count!==3||
        evidence.mode!=="RETHINK_ROOT_CAUSE"||
        evidence.paid_model_requests_issued_by_inspection!==0)
        throw Error("三輪相同 QA 失敗尚未經獨立驗證；不會扣第三輪 GPT-6 修復費。");
       setQaOutcome("已證實三次真實 Chromium 失敗；將切換根因分析策略，"+
        "沿用原 Job、原驗收規格，且不得超出 76 美分總預算。");
      }else{
       setQaOutcome("原 Job 第 "+nextRound+
        " 輪真實 QA FAIL；已核准累計預算 "+required+
        " 美分，使用唯一模型工作鍵修復並重新派發免費 Docker。");
      }
      receiptSeen=false;
      if(stop.current)break;
      setSnapshot({job:current,progress:null,
       message:"第 "+nextRound+" 輪 GPT-6 根據真實 Chromium 失敗證據修復中；"+
        "仍使用原 Job 和原 QA，尚未確認新版本 PASS。",
       completed_steps:0});
      const repair=await worker.freeAiStage("REPAIR",()=>stop.current);
      if(repair.status!=="AI_SOURCE_SAVED_FREE_CI_QUEUED")
       throw Error("修復原始碼已保存，但免費 Docker 再派發未確認；停止等待。");
      repaired++;
      current=await worker.read();
      setSnapshot({job:current,progress:null,
       message:"GPT-6 修復原始碼已寫回原 Job；重新等待免費 Chromium 驗證，"+
        "目前不能視為 PASS。",completed_steps:0});
      continue;
     }
     setQaOutcome(nextRound>3?
      "已達三輪修復上限；程式、QA 證據與版本全部保留，未發布 App。":
      "原 Job QA 失敗已保存；新修復需要明確核准累計 "+
      required+" 美分，目前預算不足或未授權，不會自動扣費。");
     break;
    }
    if(!current.free_ci.preview_ready){
     // The immutable QA receipt can precede the separate saved bundle.
     // Do not stop while PASS has been proven but preview upload is pending.
     if(allFrozenFreeCiChecksPassed(savedCandidateTarget()?.qaPlan,checks)){
      setQaOutcome("Docker／Browser QA 已 PASS，等待私人 App 預覽寫入資料庫；尚未公開。");
      continue;
     }
     setQaOutcome("已收到建置收據，但沒有完整 PASS 或可驗證預覽；不發布 App。");
     break;
    }
    if(allFrozenFreeCiChecksPassed(savedCandidateTarget()?.qaPlan,checks)){
     setQaOutcome("原需求全部 Browser QA PASS；正在開啟已保存的可操作 App。");
     // A successful one-click generation should show the actual persisted
     // browser artifact, not require a second manual preview button.
     const asset=await worker.freeCiPreview();
     const frame=await createPrivatePreviewFrame(asset,document);
     previewHost.current?.replaceChildren(frame);
     if(previewHost.current)setPreviewReady(true);
     if(publicShareConsent){
      const shared=await worker.publishFreeCiApp(prompt.trim().slice(0,75),true);
      setPublishedUrl(shared.url);
     }
     break;
    }
    setQaOutcome("瀏覽器 QA 有 UNTESTED／缺漏；未發布，原 Job 保留。");
    break;
   }
   if(!stop.current&&!receiptSeen)
    setQaOutcome("尚未收到可驗證的 Docker／Browser QA 收據；工作保留，不自動重送 AI。");
  }catch(e){
   if(failureMessage(e)==="SP35_USER_PAUSED_VIEW_NO_NEW_POST"){
    setQaOutcome("已停止此頁面的等待；原 Job 與已送出的模型工作不會取消。"+
     "可關閉頁面，稍後回來用「接續已保存的 GPT-6 專案」從原紀錄恢復。"+
     "不會為同一階段再建另一個付費工作。");
   }else setError(failureMessage(e));
  }
  finally{setBusy(false);setFreeAiStartedAt(null);}
 };
 /* eslint-enable max-depth */
 const publishFreeApp=async()=>{
  if(busy||!publicShareConsent)return;
  setBusy(true);setError("");setPublishedUrl("");
  try{
   const worker=agent.current??new BrowserCodingAgent();
   agent.current=worker;
   if(!await worker.restore())
    throw Error("找不到原專案建立者的簽章金鑰。");
   const title=prompt.trim().slice(0,75)||"我的 App";
   const published=await worker.publishFreeCiApp(title,true);
   setPublishedUrl(published.url);
  }catch(e){setError("公開發布已停止："+failureMessage(e));}
  finally{setBusy(false);}
 };
 const openFreeCiPreview=async()=>{
  if(busy)return;
  setBusy(true);setError("");setPreviewReady(false);
  try{
   const worker=agent.current??new BrowserCodingAgent();
   agent.current=worker;
   if(!await worker.restore())
    throw Error("找不到原專案建立者的簽章金鑰。");
   const source=await worker.freeCiPreview();
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
  {snapshot?.job?<section aria-label="原 Job 真實伺服器進度">
   <h3>原 Job 伺服器時間線（唯讀、不扣 AI 費用）</h3>
   <p className="saved-apps-note">
    資料庫保存原始 Job：
    {timeline?.job_saved_at_ms!==null&&timeline?.job_saved_at_ms!==undefined?
     new Date(timeline.job_saved_at_ms).toLocaleString():"NOT_MEASURED"}；
    首次程式寫回：
    {timeline?.time_to_first_source_ms!==null&&timeline?.time_to_first_source_ms!==undefined?
     Math.round(timeline.time_to_first_source_ms/1000)+" 秒":"NOT_MEASURED"}；
    首份通過 QA 的私人預覽：
    {timeline?.time_to_first_qa_pass_preview_ms!==null&&
     timeline?.time_to_first_qa_pass_preview_ms!==undefined?
     Math.round(timeline.time_to_first_qa_pass_preview_ms/1000)+" 秒":"NOT_MEASURED"}。
    原 Job 真模型記錄 {timeline?.model_calls_recorded??"NOT_MEASURED"} 次，
    免費 QA 收據 {timeline?.qa_receipts_recorded??"NOT_MEASURED"} 份。
    真正使用者首次操作耗時：NOT_MEASURED。
   </p>
   <p className="saved-apps-note">此處只顯示原 Job 已保存的 PostgreSQL 里程碑；
    並非一般使用者速度 P50/P95 或產品已通過驗收。
    可用下方「查詢已保存的產品進度」讀取最新時間。</p>
  </section>:null}
  {freeAiStartedAt!==null?
   <p className="saved-apps-note" aria-live="off">
    本次畫面已等待 {Math.floor(freeAiElapsedSec/60)} 分
    {freeAiElapsedSec%60} 秒；目前在使用既有 GPT-6／免費 Runner 流程。
    可停止畫面等待並稍後接續同一 Job，不必守在頁面前。
    關閉頁面後，已派發的模型或 Docker 仍會執行；
    但後續自動修復與驗收需要回來按「接續已保存的 GPT-6 專案」。
   </p>:null}
  <p className="saved-apps-note">真正的多檔案程式專案；AI 可以編寫、保存、要求隔離建置與修復。
   Staging 已實測免費 GitHub Actions Docker＋Chromium、逐項 QA 收據、私人建置資產保存和零 AI 重開。
   可操作的私人 App 要以該 Job 的「已保存 App」按鈕及真實測試為準；
   <strong>尚未完成真 AI 自主生成、自動修復或正式公開分享</strong>。</p>
  {catalog.length>0?<section aria-label="已保存的 Agent 專案">
   <h3>我的私人 App 卡片／多檔案專案（此瀏覽器）</h3>
   <p className="saved-apps-note">選擇原專案繼續開發或下載程式，
    不會重新生成或支付 AI 費用。新版 Agent 原始簽章金鑰最長有效 30 天；
    舊專案仍以建立時的原金鑰期限為準。這是私人候選清單，並非已發布 App。</p>
   <ul>{catalog.map(item=><li key={item.jobId}>
    <button className="btn btn-secondary" type="button" disabled={busy}
     onClick={()=>{void openSavedCandidate(item.jobId);}}>
     開啟／重用：{item.prompt.slice(0,65)}
    </button>
   </li>)}</ul>
  </section>:null}
  {snapshot?.job.status==="CODING"&&snapshot.job.free_ci?.preview_ready&&
   allFrozenFreeCiChecksPassed(savedCandidateTarget()?.qaPlan,
    snapshot.job.free_ci.qa_checks)?
   <section aria-label="修改已驗收的 App">
    <h3>修改現有 App 的背景（免費）</h3>
    <label htmlFor="agent-safe-style-colour">背景顏色</label>
    <select id="agent-safe-style-colour" value={styleTheme} disabled={busy}
     onChange={e=>setStyleTheme(e.target.value as "blue"|"green"|"sand")}>
     <option value="blue">淺藍</option>
     <option value="green">淺綠</option>
     <option value="sand">米色</option>
    </select>
    <button type="button" className="btn btn-secondary" disabled={busy}
     onClick={()=>{void saveStyleCandidate();}}>保存外觀修改候選版（不扣 AI）</button>
    <p className="saved-apps-note">新版本須重新通過原始 QA，舊公開 App 不會被修改。</p>
    {styleResult?<p role="status">{styleResult}</p>:null}
   </section>:null}
  {saved&&snapshot?.job?
   <section aria-label="同一 App 的 USER_EDIT 安全修改">
    <h3>持續修改同一個 App（USER_EDIT）</h3>
    <p className="saved-apps-note">已接受版本與候選版本分開保存。新要求先確認再保存；任何未完成 QA 的候選版不能取代 Accepted。</p>
    {userEditLedger?.accepted?
     <p>現行 Accepted：<code>{userEditLedger.accepted.project_hash.slice(0,24)}</code>
      （已接受 {userEditLedger.accepted.generation} 輪修改）</p>:
     <button type="button" className="btn btn-secondary" disabled={busy}
      onClick={()=>{void initializeUserEdit();}}>依原 App 完整 QA 建立已接受版本（免費）</button>}
    {userEditLedger?.accepted?<>
     <label htmlFor="agent-user-edit-text">對這個 App 要修改甚麼？</label>
     <textarea id="agent-user-edit-text" className="composer-input" disabled={busy}
      maxLength={800} value={userEditText} onChange={e=>setUserEditText(e.target.value)}
      placeholder="例如：新增「匯出清單」按鈕，點擊後顯示「匯出完成」。" />
     <label htmlFor="agent-user-edit-expected">修改成功後，畫面應顯示的文字</label>
     <input id="agent-user-edit-expected" disabled={busy} maxLength={160}
      value={userEditExpected} onChange={e=>setUserEditExpected(e.target.value)}
      placeholder="例如：匯出完成" />
     <label htmlFor="agent-user-edit-button">要先按哪個按鈕？（選填）</label>
     <input id="agent-user-edit-button" disabled={busy} maxLength={120}
      value={userEditButton} onChange={e=>setUserEditButton(e.target.value)}
      placeholder="例如：匯出清單" />
     <label className="code-builder-consent"><input type="checkbox"
      disabled={busy} checked={userEditQaConfirmed}
      onChange={e=>setUserEditQaConfirmed(e.target.checked)}/>
      我已確認這項新需求與預期操作／結果。所有原有驗收條件必須保留。</label>
     <button type="button" className="btn btn-secondary"
      disabled={busy||!userEditQaConfirmed}
      onClick={()=>{void createUserEditDraft();}}>先保存 USER_EDIT 需求及 QA（免費，不改舊版）</button>
     {userEditLedger.edits.length>0?<>
      <label htmlFor="agent-user-edit-select">已保存的修改需求</label>
      <select id="agent-user-edit-select" disabled={busy}
       value={userEditSelected} onChange={e=>setUserEditSelected(e.target.value)}>
       <option value="">請選擇一筆修改</option>
       {userEditLedger.edits.map(x=><option key={x.edit_id} value={x.edit_id}>
        {x.user_request.slice(0,55)}（{x.state}）</option>)}
      </select>
      <p className="saved-apps-note">候選版：{userEditLedger.edits.find(x=>x.edit_id===userEditSelected)?.candidate_project_hash??"尚未產生"}。
       新舊 QA 必須在免費 Chromium 全部 PASS 才可按下接受。</p>
      <label className="code-builder-consent"><input type="checkbox"
       checked={userEditAiApproved} disabled={busy}
       onChange={e=>setUserEditAiApproved(e.target.checked)}/>
       本次明確核准 USER_EDIT 付費 AI（單次預留最高 20 美分，仍受伺服器累計預算限制；不使用付費 Container）。</label>
      <button type="button" className="btn btn-secondary"
       disabled={busy||!userEditSelected||!userEditAiApproved}
       onClick={()=>{void runUserEditModel();}}>對原 App 執行一次 AI 修改（只建候選）</button>
      <button type="button" className="btn btn-secondary"
       disabled={busy||!userEditSelected}
       onClick={()=>{void acceptUserEditCandidate();}}>完整 QA 通過後，確認接受候選版本</button>
     </>:null}
    </>:null}
    {userEditMessage?<p role="status">{userEditMessage}</p>:null}
   </section>:null}
  <label htmlFor="code-builder-prompt">用一句話描述要做的 App</label>
  <textarea id="code-builder-prompt" className="composer-input" value={prompt}
   maxLength={800} disabled={busy} onChange={e=>setPrompt(e.target.value)}
   placeholder="例如：製作能四人同時玩的十八啦骰子遊戲，有計分、動畫、規則與排行榜。" />
  <label className="code-builder-consent"><input type="checkbox" checked={fullstack}
   disabled={busy||saved} onChange={e=>setFullstack(e.target.checked)}/>
   這個 App 需要專屬後端：同一個專案產生前端及 Node 伺服器程式。
   目前可在隔離 Sandbox 建置與測試，但後端正式上線前不會宣稱 App 已完整發布。
  </label>
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
   我同意付費 AI：免費 Docker 路徑的 QA 規劃最多 8 美分、編碼最多 20 美分；修復另行授權最多 16 美分，全部受下方總預算限制。
  </label>
  <label className="code-builder-consent"><input type="checkbox" checked={containerConsent}
   disabled={busy} onChange={e=>setContainerConsent(e.target.checked)}/>
   我同意僅用 GitHub Actions 免費 Docker 建置；不授權 Cloudflare Containers 或新費用。
  </label>
  <label className="code-builder-consent"><input type="checkbox" checked={browserQaConsent}
   disabled={busy} onChange={e=>setBrowserQaConsent(e.target.checked)}/>
   我另行核准免費 Chromium 做獨立 Browser QA；不會使用付費 Cloudflare Browser Run，不自動發布。
  </label>
  <label className="code-builder-consent"><input type="checkbox"
   checked={freeCiConsent} disabled={busy}
   onChange={e=>setFreeCiConsent(e.target.checked)}/>
   我核准將目前已保存的專案送到既有 GitHub Actions 免費隔離 Docker；
   不公開原始碼、不呼叫模型、不自動發布。
  </label>
  {saved&&snapshot?.job&&snapshot.job.revision>0?
   <button type="button" className="btn btn-secondary"
    disabled={busy||!freeCiConsent} onClick={()=>{void (async()=>{
     setBusy(true);setError("");setFreeCiStatus("");
     try{
      const worker=agent.current??new BrowserCodingAgent();
      agent.current=worker;
      await worker.restore();
      await worker.dispatchFreeCiBuild(freeCiConsent);
      const job=await worker.read();
      setSnapshot({job,progress:null,
       message:"免費 Docker 已請求排程；重新查詢會從 PostgreSQL 讀取真實建置收據。",
       completed_steps:0});
      setFreeCiStatus("已提交安全免費 Runner 排程；尚未收到真實結果，請用「查詢已保存的產品進度」更新。");
     }catch(e){setError(failureMessage(e));}
     finally{setBusy(false);}
    })();}}>
    將已保存多檔案專案送至免費 Docker 建置
   </button>:null}
  {freeCiStatus?<p className="saved-apps-note">{freeCiStatus}</p>:null}
  <label htmlFor="agent-max-cost">整個專案核准的 AI 費用上限（美分，自動 QA 最低 16；最多 100）</label>
  <input id="agent-max-cost" type="number" min={8} max={100} step={1}
   value={approvedCents} disabled={busy}
   onChange={e=>setApprovedCents(Number(e.target.value))}/>
  <p className="saved-apps-note">每按一次開發加修復總計最多六個 Agent 步驟，另可依授權做一次獨立 QA；費用仍受伺服器總預算限制。
   已測通建立者簽章、免費 Docker、Chromium QA 收據及私人 App 重開；
   另有獨立真 AI 生成測試，但網站自主閉環仍需驗收。Staging 僅開放明確核准的付費 AI → 免費 Docker 路徑，
   Cloudflare 付費容器維持關閉，未通過全部 QA 不會發布。</p>
  <label className="code-builder-consent">
   <input type="checkbox" checked={autoRepairConsent} disabled={busy}
    onChange={e=>setAutoRepairConsent(e.target.checked)}/>
   我授權真實 Browser QA 出現 FAIL 時，依原專案已核准總額最多修復三輪：
   44／60／76 美分；第三輪若連續失敗則分析根因、改變方案。每輪保存完整原始碼，
   費用不足、模型結果不明或三輪仍失敗即停止，不重複扣費。
  </label>
  <button type="button" className="btn btn-primary"
   disabled={busy||!aiConsent||!containerConsent||!browserQaConsent||
    !freeCiConsent||approvedCents<44||prompt.trim().length<5}
   onClick={()=>{void startFreeAi();}}>
   {busy?"真 AI／免費 Docker／Browser QA 正在執行…":
    "一鍵真 AI 生成 App → 免費 Docker → QA → 保存／分享"}
  </button>
  {saved?<button type="button" className="btn btn-secondary"
   disabled={busy||!aiConsent||!containerConsent||!browserQaConsent||
    !freeCiConsent||approvedCents<44}
   onClick={()=>{void startFreeAi(true);}}>
   接續已保存的 GPT-6 專案（保留原版本與已核准預算）
  </button>:null}
  <p className="saved-apps-note">
   新版免費 Runner AI 模式使用 GPT-6.1 Sol（不是 gpt-4.1-mini）：最多 8 美分原始 QA 規劃、20 美分編碼，
   另可選擇最多三輪各 16 美分修復（累計核准 44／60／76 美分）；
   每輪有獨立付費紀錄，連續失敗第三輪換策略，全程沿用同一原 Job。
   預留費用是上限，不是實際帳單。網路出錯後須先查已保存狀態，
   不會自動重複扣費。公開分享仍需另外勾選明確同意。
  </p>
  <button type="button" className="btn btn-secondary"
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
    {"failure_code" in c&&c.failure_code?
     "（"+({TARGET_MISSING_OR_AMBIGUOUS:"找不到指定按鈕或操作目標",
       STEP_FAILED:"操作無法完成",ASSERTION_FAILED:"操作後畫面未符合需求",
       BROWSER_ERROR:"瀏覽器操作發生錯誤"} as Record<string,string>)[
      String(c.failure_code)]+"）":null}
   </li>)}</ul>
  </section>:null}
  {snapshot?.job.free_ci?.preview_ready&&
   allFrozenFreeCiChecksPassed(savedCandidateTarget()?.qaPlan,
    snapshot.job.free_ci.qa_checks)?
   <section aria-label="通過 QA 的 App 正式分享">
    <h3>正式 App 卡片與分享（需建立者明確同意）</h3>
    <p className="saved-apps-note">僅當開發前凍結的每條 Browser QA 均為 PASS，
     原 Job、專案雜湊及已保存建置資產完全一致，伺服器才會建立公開卡片。
     FAIL 或 UNTESTED 不可公開。</p>
    <label className="code-builder-consent">
     <input type="checkbox" checked={publicShareConsent} disabled={busy}
      onChange={e=>setPublicShareConsent(e.target.checked)}/>
     我同意將目前這份經過完整 QA 的 App 公開發布，允許他人使用與分享。
    </label>
    <button type="button" className="btn btn-secondary"
     disabled={busy||!publicShareConsent} onClick={()=>{void publishFreeApp();}}>
     驗證原始 QA 並正式發布可分享 App 卡片
    </button>
    {publishedUrl?<p role="status">
     App 已建立：<a href={publishedUrl} target="_blank"
      rel="noopener noreferrer">開啟／分享已發布 App</a>
    </p>:null}
   </section>:null}
  {snapshot&&(["TESTING","REPAIRING"].includes(snapshot.job.status)||
   Boolean(snapshot.job.free_ci))?
   <section aria-label="私人多檔案 App 互動預覽">
    {snapshot.job.free_ci?.preview_ready?
     <button type="button" className="btn btn-primary" disabled={busy}
      onClick={()=>{void openFreeCiPreview();}}>
      開啟已保存的免費 Docker App（私人、零 AI、可操作）
     </button>:null}
    {["TESTING","REPAIRING"].includes(snapshot.job.status)?
    <button type="button" className="btn btn-secondary"
     disabled={busy||!containerConsent}
     onClick={()=>{void openPrivatePreview();}}>
     開啟已建置 App 互動預覽（需雲端存取授權）
    </button>:null}
    <p className="saved-apps-note">只顯示已通過隔離建置與測試的私人候選 App；
     免費 Docker 已保存的建置產物可直接從 PostgreSQL 開啟，不需容器；
     另一個舊版雲端建置預覽可能喚醒 Cloudflare 容器，但不會重新呼叫 AI、編譯或發布。
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
    onClick={()=>{
     stop.current=true;
     if(freeAiStartedAt!==null)
      setQaOutcome("已要求停止此頁面的等待，原 Job 已保存；"+
       "目前已派發的 GPT-6／免費 Runner 不會因此取消或再次扣費。");
    }}>{freeAiStartedAt!==null?
     "停止畫面等待（保留原 Job、不重新扣費）":
     "完成目前步驟後停止"}</button>:null}
  {error?<p role="alert">{error}</p>:null}
  {snapshot?<section aria-label="Agent 專案進度" role="status">
   <h3>已保存專案 · {snapshot.job.status}</h3>
   <p>{snapshot.message}</p>
   <p>版本 {snapshot.job.revision} · 本次處理 {snapshot.completed_steps} 步
    · {snapshot.job.files.length} 個檔案 · 尚未發布</p>
   {snapshot.job.free_ci?
    <section aria-label="原工作免費 Docker 建置收據" role="status">
     <h4>{snapshot.job.free_ci.status==="BUILD_FAILED"?
      "免費 Docker／Chromium 失敗證據（已儲存 PostgreSQL）":
      "免費 Docker／Chromium 建置收據（已儲存 PostgreSQL）"}</h4>
     <p>來源版本：{snapshot.job.project_hash.slice(0,19)}… ·
      {snapshot.job.free_ci.status==="BUILD_FAILED"?"診斷指紋":"建置產物"}：
      {snapshot.job.free_ci.artifact_hash.slice(0,19)}…</p>
     {snapshot.job.free_ci.qa_checks?.length?
      <ul>{snapshot.job.free_ci.qa_checks.map(c=>
       <li key={c.criterion_id}>{c.criterion_id}：{c.verdict}</li>)}</ul>:null}
     {snapshot.job.free_ci.status==="BUILD_FAILED"?
      <p role="alert">編譯或渲染失敗；這不是 QA PASS，也沒有可分享 App。
       已保存診斷供授權後的 AI 修復：
       {String(snapshot.job.free_ci.diagnostic_excerpt??"未提供診斷").slice(0,600)}</p>:
      <>
       <p>{snapshot.job.free_ci.preview_ready?
        "建置 App 已完整保存，可直接免費重新開啟。":
        "Runner 已驗證建置，但 App 產物仍待保存，暫時不能開啟。"}</p>
       <p>已完成禁網路 Docker 建置及 Chromium 基本頁面檢查；
        <strong>尚須原始需求 QA 完整 PASS 才能公開分享</strong>。</p>
      </>}
     {/^[0-9]{6,20}$/u.test(snapshot.job.free_ci.run_id)?
      <a href={"https://github.com/NFF98/appf2-build/actions/runs/"+
       snapshot.job.free_ci.run_id} target="_blank" rel="noopener noreferrer">
       查看 GitHub Actions #{snapshot.job.free_ci.run_id} 真實執行紀錄
      </a>:null}
    </section>:
    <p className="saved-apps-note">此版本尚無已保存的免費 Docker／Chromium 收據；
     可能未派發、仍在執行，或建置失敗。不要把排程當作完成。</p>}
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
