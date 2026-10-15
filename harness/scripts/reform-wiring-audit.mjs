// GOV-REFORM-20261013: exact 9+6+mid-Sprint wiring inventory.
// This audit checks that an expected executable/CI entry point exists.
// Marker scan is diagnostic ONLY. Never count it as an implemented reform or actual acceptance.
// Project Design SSOT requires Traditional Chinese for ALL authoritative Human-facing explanations.
import fs from "node:fs";
import path from "node:path";
const EXPECTED=Object.freeze([
 ["1","Task one-PR lifecycle","harness/scripts/task-pr-lifecycle.mjs","DRAFT_DEVELOPMENT"],
 ["2","same lease / no redundant approval","harness/scripts/gpt-preflight.mjs","REDUNDANT_APPROVAL_DENIED"],
 ["3","impacted-test fast loop","harness/scripts/select-impacted-tests.mjs","resolveRunnablePlan"],
 ["4","Activation when authority changes","harness/scripts/task-pr-lifecycle.mjs","requiresActivation"],
 ["5","Rebind only when mappings change","harness/scripts/task-pr-lifecycle.mjs","requiresRebind"],
 ["6","automatic Evidence aggregation report","harness/scripts/evidence-ledger-report.mjs","reportContext"],
 ["7","generic Human procedural exception","harness/scripts/human-exception.mjs","resolveRepoException"],
 ["8","preflight command","harness/scripts/gpt-preflight.mjs","function stateCli"],
 ["9","automated measurement cadence",".github/workflows/governance-metrics.yml","schedule:"],
 ["A","PR proliferation required-check guard",".github/workflows/governance-gate.yml","pr-guard --event"],
 ["B","repeated-approval refusal","harness/scripts/gpt-preflight.mjs","REDUNDANT_APPROVAL_DENIED"],
 ["C","no-test-file NOT_RUN policy","harness/scripts/select-impacted-tests.mjs","NOT_RUN_NO_TEST_FILES"],
 ["D","proof levels with no false PASS","harness/scripts/evidence-ledger.mjs","UNCLASSIFIED"],
 ["E","Evidence aggregation as CI artifact",".github/workflows/governance-gate.yml","task-evidence-ledger"],
 ["F","GPT orchestration preflight","harness/scripts/gpt-preflight.mjs","function stateCli"],
 ["16","Human mid-Sprint rebaseline guard","harness/scripts/validate-activation.mjs","midSprintActivationCovered"]
]);
// 原始 Human 批准的 Issue #389 十六項；下列是缺少真實端到端證明的
// 客觀限制，不可被字串查找、模擬測試或 CI 四綠自動轉為 DONE。
const BLOCKERS=Object.freeze({
  "1":"PR 建立前沒有獨立工具權限攔截，只有事後 Gate。",
  "2":"Final Ready、Merge、Closure 仍由獨立 Human 權限控制。",
  "3":"需驗證真實 Draft/Ready 轉換、完整 CI 與測試目錄判斷。",
  "4":"需驗證真實 Task 變動及 Activation 批准，而非只測純函式。",
  "5":"需驗證正式 Baseline/Acceptance Rebind，不得拿模擬資料冒充。",
  "6":"Evidence 彙整目前只產生唯讀報告，不會自動完成合法歸檔。",
  "7":"獨立可信 Human 核准身分來源尚未接線，不能用布林值冒充。",
  "8":"GPT 工具可在執行預檢前操作，Repo 腳本不能阻止這種行為。",
  "9":"每週統計尚未在 Main 排程執行，沒有真實改善前後比較。",
  "A":"PR 重複攔截主要在建立之後，未達工具呼叫前強制。",
  "B":"Task 持續執行有檢查，但 Human Merge／Closure 尚不能只用一次授權。",
  "C":"需在 Main 上觀察真實有／無測試檔的 Fast-loop 與 NOT_RUN。",
  "D":"完整 Phase 1 真實 PostgreSQL／Browser Acceptance 政策另需 Human 確認。",
  "E":"Evidence 報告非合法 Evidence 自動寫入／Closure，不能標完成。",
  "F":"GPT 工具層的強制預檢尚未接線，僅文字與 CI 無法保證。",
  "16":"Build Repo 的中途修訂機制不等於 Design Repo 的權限與 CI 接線。"
});
export function reformAcceptanceReality(){
  const items=EXPECTED.map(([id,label])=>({id,label,status:"UNVERIFIED_E2E",blocker:BLOCKERS[id]}));
  return {decision:"NOT_FULLY_IMPLEMENTED",authoritative_language:"繁體中文",
    expected:16,verified_end_to_end:0,items};
}
export function inspectReformWiring(read){
  const checks=EXPECTED.map(([id,label,file,marker])=>{
    const body=read(file);
    return {id,label,file,status:typeof body==="string"&&body.includes(marker)?
      "STATIC_WIRED":"MISSING_OR_UNWIRED"};
  });
  return {checks,errors:checks.filter(c=>c.status!=="STATIC_WIRED"),
    acceptance:reformAcceptanceReality()};
}
export function auditReformWiring(root=process.cwd()){
  const result=inspectReformWiring(file=>{
    try{return fs.readFileSync(path.join(root,file),"utf8");}catch{return null;}
  });
  if(result.errors.length)throw Error("REFORM16 WIRING MISSING: "+
    result.errors.map(x=>x.id+" "+x.file).join(", "));
  return result;
}
export function testReformWiring(){
  const source=p=>EXPECTED.filter(x=>x[2]===p).map(x=>x[3]).join("\n")||null;
  const baseline=inspectReformWiring(source);
  if(baseline.errors.length)throw Error("wiring test baseline broken");
  for(const row of EXPECTED){
    const failed=inspectReformWiring(p=>p===row[2]?null:source(p));
    if(!failed.errors.some(e=>e.id===row[0]))throw Error("wiring missing-path attack not caught "+row[0]);
  }
  const truth=reformAcceptanceReality();
  if(truth.decision!=="NOT_FULLY_IMPLEMENTED" || truth.items.length!==16 ||
    truth.items.some(x=>!x.blocker || x.status==="PASS"))
    throw Error("unproven reform incorrectly marked implemented");
  return EXPECTED.length+2;
}
