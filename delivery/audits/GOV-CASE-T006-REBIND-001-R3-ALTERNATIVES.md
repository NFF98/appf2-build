# GOV-CASE-T006-REBIND-001 — R3 替代方案實證（非修法、非執行）

**Human 已明確批准 R2 v1.0 進入 R3，沒有批准 R3 選路線。** R2 原文件 commit `17851adaff39bbd004e3235d7ed153edae7315ea`、SHA256 `88134edf64b5ddf2a61c1fed1a56dc73c8a58a32b654276b54380f37101ce141`。本紀錄是 read-only 復現實驗，不是任何 Ed25519 簽章或運行真正 `npm run gate`。

## 1. 現行資料與精確 Gate

以 GitHub Build main `aaf1af0fe55199bd142b33425227459f40338b97` 實際讀取：
- `delivery/sprints/SP-P1-003/manifest.json` 綁 `BS-P1-024`，有 `revalidation_item_ids: ["BL-P1-008"]`。
- `delivery/backlog/QUEUE.json` 中 `BL-P1-008` 的唯一 `revalidation` 指向 `BS-P1-024 / SP-P1-003 / T007 / F01-AC-004`，`status=CLOSED`；T007 歷史 CLOSED。
- 新 `BS-P1-025` 對此 DONE BL008 的**新**漂移是 `F01-AC-017`；舊 F01-AC-004 已由 T007 驗過，不能重複假稱為新工作。
- `harness/scripts/validate-sprint.mjs` 對每個舊 Sprint 都查 `r.target_build_spec_id===m.build_spec_id && r.sprint_id===sid`，且驗舊 T007 原 Task 綁定。
- `harness/scripts/validate-backlog.mjs` 針對新 active baseline 的每一個 DONE 項目先計算後續 drift：若舊證據 target→current 有後續漂移，歷史 carry-forward 不成立；隨後只接受 `item.revalidation.target_build_spec_id===currentBaseline`。
- `validate-change-scope.mjs` 即使允許符合條件的 atomic rebaseline 控制變更，也**不會自動替 BL008 新增第二個 revalidation 紀錄**。
- 另外 BL010 F01-AC-013/016、BL031 F07-AC-004 必須另有新 owner 和證據。BL032 的舊 F07-AC-008 已有有效 carry-forward，不能列入新範圍。

## 2. Read-only 決定性測試結果（**非完整 CLI Gate**）

直接以現行實際 JSON 與驗證程式條件做分支復現，五個已執行的來源條件 assertions 為 **5/5 MATCH**：

| Case | 假設 | 實測條件結果 | 判讀 |
|---|---|---|---|
| L2-001 | 只保留既有 T007 pointer | 舊 SP003 身分匹配，新 BS025 target 不匹配 | 舊史可保留，但不能過新 Backlog |
| L2-002 | 把唯一 pointer 改到 BS025/SP004 | 新 target 匹配，舊 SP003 不匹配，舊 T007 指向被覆寫 | 篡改歷史，不可接受 |
| L2-003 | 新增 SP004、不改 BL008 | BL008 pointer 仍是 BS024，新 target 檢查失敗 | 單純開新 Sprint 不解決 |
| L2-004 | 新增不同 BL 做 F01-AC-017 | 原 BL008 仍保有自己 F01-AC-017 的漂移義務，驗證每筆仍失敗 | 新增 alias 不解決原項目 |
| SAFE-005 | 完全維持現狀 HOLD | 舊 T007 和舊 BS024 不變；不能啟用 BS025 | 合法、安全但無進度 |

**這些是實際在程式分支條件及 canonical JSON 上跑過的靜態復現，並非已跑 `npm run gate`、修過 Gate、或新的 Playwright/DB 驗收 PASS。** L3-006 的 append-only ledger 是尚未執行的構想。

## 3. 至少三種路線及代價

**A — 不變更，繼續 HOLD。** 零治理修改、零越權或歷史風險，任何時候都能維持。但 T006、BS025 rebind 不會改善。可作為任何後續失敗的保護性回退。

**B — 純 L2 新 Sprint 或新 BL 項目。** 方案的優點是避免修憲、原理上可回退，但對目前這組單一 pointer／舊 Sprint 約束，四種已測來源條件均失敗。若 Human 選 B，至少需要更強的可執行隔離 PoC；目前沒有 PASS 證據，不能推進正式 rebind。

**C — 先選「只做隔離 PoC」**。建議先在**不合併、不可執行 Cursor 的受控隔離分支**上設計最小 append-only 兩輪 revalidation 模型與攻擊矩陣，證明既有 PASS、身份綁定、缺失 drift、重複認領都能 fail closed。PoC 不能繞過 Constitution，也不能落地到 main。只有未來精確 R4/R5 核准後才能修改受保護程式。

**D — 限縮 L3 修正（R4 候選）。** 最小必要語意：保留舊 `item.revalidation` 和已結案 Sprint／Task 原位不動；新增不可重寫的 next-round evidence 鏈，old→new baseline source/target 精確綁定，每輪只驗新增語意漂移；新的 ACTIVE coverage 不可用 PLANNED 當 PASS；保留所有原有負面安全規則。候選可能涉及 `validate-backlog.mjs`、`validate-sprint.mjs` 和必需的 change-scope／Activation 稽核（哪些路徑實際要改由 R4 精確確定）；**目前未修改任何程式，也未獲 R3 批准。** 需逐關簽 R1–R5、獨立 CI/BCE、另一次 Human merge approval。

**回退：** 在修法未合併前，維持 `CURRENT=BS-P1-024`、`Sprint=HOLD`、`implementation_enabled=false`。若未來需要撤回已合併且使用中的治理程式，應經新獨立審批並停止後續 activation；絕不回寫／刪除舊簽章與閉環證據。

## 4. R3 待 Human 的實際路線決策

**建議的 R3 選項為 C（先隔離 PoC，之後才評估最小 D），而不是現在直接動 L3。** 相對純 B 的既有四項阻斷，這條路提供可證偽的最小修正範圍；A 是不變更回退選項。選 C 的 Human R3 核准 **僅授權 R4 準備精確 PoC／差異與攻擊測試**，不授權受保護路徑 merge、改 CI/harness、執行 Cursor、補 PG 生產權限或開始下一 Task。

**R3 HUMAN SELECTION = PENDING。R4/R5 = NOT APPROVED。**
