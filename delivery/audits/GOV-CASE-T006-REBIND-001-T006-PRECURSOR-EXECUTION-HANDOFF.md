# GOV-CASE-T006-REBIND-001 — T006 最短可執行交接（Pre-Cursor / Review-only）

**SSOT base: `NFF98/appf2-build/main@7bf5c9466e681719463560c2676ccb82ab097f0e`.** Human R3 路線 C 僅授權隔離治理草案。T006 仍 `BLOCKED`，R4 未獲 Human 核准，R5 未授權，BS025 未 Activation，Sprint HOLD，`implementation_enabled=false`。本文件**不是** Cursor 執行指令或 Task Activation。

## 已核實、可以免重做的部分

1. T006 `SP-P1-003/tasks.json` (Git blob `be439594922f59501e30facb52055929ee32e8f8`) 的 5 個前置 T001–T005 都是 `CLOSED`。不得重開或改寫歷史。
2. 同一 Task 9 項 Acceptance/Test ID 在 BS024→BS025 registry `505a9f349e1ac245feef0374133acf275fe1db3a` → `5ba4d4031c6f38e389edd57e306242ac26d63ada` 對應物件全部無語意變更。**只需合法 baseline rebind，不因 rebind 發明新 T006 Product semantics**。BL008/BL010/BL031 的歷史 revalidation 另走正式 L3 安全規則，不能因此視為通過。
3. 真實 APP shell `src/app/shell/App.tsx` (Git blob `2e19bb8ba871dc217b67b3a270d8bb98e96d41bc`) 目前 `Surface = "DISCOVER" | "CREATE"`，不存在 S03 APP surface。Runtime core `src/platform/runtime/runtime-instance.ts` 存在、Runtime 互動測試亦存在，但**未串成自然語言 → F01 → F02 admitted → F03 READY / UI → 本機互動 commit 的真實瀏覽器垂直證明**。
4. 於 exact main 對 `tests/` 全部 **83 個** `.test.*` / `.spec.*` 源檔逐檔進行 authenticated GitHub 原始內容查核，九個正式 Test ID 字串 **0/9 出現**。完整檔案路徑/ blob 清單及掃描規則：`delivery/audits/GOV-CASE-T006-REBIND-001-T006-MAIN-9-TEST-SOURCE-SCAN.json`。這是正式指定 Test 覆蓋缺口；不能宣稱測試失敗或 9/9 實測 PASS。

## Human 核准後的 Cursor 實作範圍（9 個必交付的 executable Test）

| Acceptance / Test | 已鎖語意 / 實作驗收 | 建議 Test layer |
|---|---|---|
| `F03-AC-009` / `TEST-F03-009` | Result 只由 `result.outputs` 評估，不從 DOM/UI 反推 | behavior / runtime |
| `F03-AC-024` / `TEST-F03-AC-024` | Result sensitivity 可供未來 F16 持久化政策讀取；不實作 F16 | behavior / runtime |
| `F00-AC-007` / `TEST-F00-007` | 真 `VALIDATED` Blueprint → F03 hydrate READY → S03 APP surface；不得用 mock READY 代替完整路徑 | behavior + e2e |
| `F00-AC-009` / `TEST-F00-AC-009` | APP surface 顯示 Share / Remix / Correction 的正確入口；不擴張到 F05/F06/F16 | behavior / e2e |
| `F00-AC-010` / `TEST-F00-010` | Correction 失敗時 current App/Blueprint/已提交 Runtime 仍保存 | behavior / e2e |
| `F00-AC-011` / `TEST-F00-011` | Compare 決策明確支援 Accept New / Keep Previous / Adjust Again；不偷作完整 Correction engine | behavior / e2e |
| `F00-AC-012` / `TEST-F00-AC-012` | Keep Previous 不修改舊 Blueprint（內容/識別一致） | contract |
| `F00-AC-036` / `TEST-F00-036` | User 明選「修改這個 App」或「改成我的版本」，正確 route 到 S05A/B；不得替 User 推斷 intent | behavior / e2e |
| `F00-AC-037` / `TEST-F00-037` | S05-origin 進 S03 Inspection Mode，保留同一 session/path/draft/preview；可返回 origin，不建立第二個 S05 | behavior / e2e |

**不可用一次通用 `npm run test:behavior` 綠燈冒稱每個 ID 均 executable PASS。** 每項須有真實對應測試、實際執行記錄、正確 commit/test report、BCE 可回追的獨立 evidence。不得以 130/130 Governance 模型測試抵銷這九項。

## 建議實作順序，保留既有能力而不擴 scope

1. **S03 入口最小接線**：從 `src/app/shell/App.tsx` / `src/app/create/CreateWorkspace.tsx` 統整 F01 create session 結果、F02 admitted Blueprint 與 `src/platform/runtime/hydration-gate.ts`；使用既有 `RuntimeInstance.hydrate()` 與 `runtime-instance.ts` READY/dispatch/committed store，禁止讓 Browser 偽造 Admission/Registry/Hash。
2. **S03 App 可操作畫面**：Generated App 是主要內容；Shell 保持外層導覽與 Runtime DOM/狀態的單向邊界。至少一個真實 user event 讓 committed Runtime state 或 Result 改變，**不得額外呼叫 LLM／Server 完成該本機 interaction**。
3. **Result 與安全保留**：由 `result.outputs` 計算，sensitivity 為既有契約；Correction failure/Keep Previous 不破壞原 App。
4. **Navigation/inspection**：入口顯示、二選一 intent routing、S05-origin Inspection 返回；僅做 boundary，非完整 F05/F06/F16 新功能。
5. **逐項先補指定 9 個 Test ID**，再用真實 F01→F02→F03→S03 browser e2e 及必要 visual/responsive 回歸收斂。

以上是實作順序候選，不擅自新增 Product contract、檔案授權或依賴。當既有 API／S05 semantic 無法實現時，Cursor 必須報 `SPEC_AMBIGUITY` / `BUILD_BLOCKER`，由 Human 決策，不得 invent。

## 精確批准／執行關卡（目前尚未滿足）

1. **ChatGPT Governance**：R4 獨立 BCE、完整受保護 L3 candidate / 5 Why / protected CI 與 GitHub proof 可信來源，提供明確可審議標的。R4 尚未批准，**不能自批**。
2. **Human**：另訊息決議 R4，依正式憲法進行 R5 的獨立審議與真 Human 授權（不可一次預批准）。
3. **Governance，Human 批准後才做**：獲准的 protected changes 經 separate Human merge approval 與 CI/BCE，BS025 激活/來源 Registry/Backlog revalidation 安全變更完成後，合法 rebind T006 + Sprint。
4. **Human**：明確核准 Cursor **T006 execution**（Activation 與 Execution 兩件事不得合併）；Issue #301 既有 Cursor lease 已用，不可重用。
5. **Cursor**：只在 T006 `allowed_write_paths` 內實作/測試；如需 `harness/`、`ci/`、`.github/`、`package.json`，必須獨立治理核准。
6. **ChatGPT BCE → Human**：真實 9 項 test/acceptance，10 個 required commands（`npm run gate`、`check:types`、`check:lint`、`build`、`test:contract`、`test:behavior`、`test:runtime`、`test:e2e`、`test:visual`、`test:responsive`），Independent implementation audit；Human 分別核准 merge 和 final closure。

**STOP RULE:** R4/R5/Human signatures 未完備、BS025 Activation 或 Task lease 未成立，T006 不得由 `BLOCKED` 改為執行；不創建實作 PR；不改 T001–T005/T007 CLOSED；不把 Audit-only GitHub Actions SUCCESS 當產品 PASS。

**NEXT ACTION OWNER = ChatGPT Governance。** 這份交接已把 Product 語意重新設計、前置 Task 與測試搜查三種重工排除；真正剩餘工作是可信治理放行與九項產品實作/驗收。

## 核驗現行 Gate 的合法 BS025 Activation 最小構型（**提案，沒有套用**）

來自 exact main `harness/scripts/validate-change-scope.mjs` (blob `ce5ce96fd460895f874eb9dae10e81db8b785340`)、`harness/scripts/validate-sprint.mjs` (blob `d46ed2a4d9eb216ad59ee6d7eb7f0fa1ec0330eb`) 及 `validate-activation.mjs` (blob `9ae99f0f808ab2b97a47304481062150424ba787`) 的直接來源覆核：

- 「HOLD → rebaseline」特例要求 **原** `delivery/CURRENT-SPRINT.json` 為 HOLD、`active_sprint/build_spec/task` 均 null；**新** `build-spec/CURRENT.json` 指向 BS025，並在同一次精確候選變更中出現 `build-spec/activations/BS-P1-025.json`；`delivery/CURRENT-SPRINT.json` 的目標狀態須符合既有 BLOCKED/ACTIVE 守衛。不可只換 baseline 而不寫 Activation Record。
- 該 rebaseline 允許的控制檔是 `build-spec/CURRENT.json`、`delivery/CURRENT-SPRINT.json`、`delivery/backlog/QUEUE.json`、精確目標 Sprint 的 `manifest.json`／`tasks.json`、`build-spec/activations/BS-P1-025.json`；若含 BD/BF lifecycle，僅限 replacement baseline 實際新增 Delta 及其 source Finding，不能借用一般例外。
- `validate-activation.mjs` 要求新的 Activation Record 對應已鎖 Baseline、已核准源頭、舊 BS024 → BS025 REBASELINE，以及 exact source commit／approved Delta 的一致性。不可人工把 `implementation_enabled=true` 當核准。
- `validate-sprint.mjs` 要求新的 active Sprint / manifest / Build CURRENT 同一 BS025，`entry_gate.user_approved===true` 且 `approval_ref` 來自真正 Human；同時最多一個 `IN_PROGRESS/REVIEW` Task。沒有 active Sprint 時 `implementation_enabled` 必須維持 false。
- `validate-sprint.mjs` 的 CLOSED Task 舊 baseline 容許只在 semantic drift = 0 且所選 Backlog/歷史 revalidation 合法時 preserved；**不能直接把 T001–T005/T007 歷史重寫為 BS025**。
- 新 Sprint ID／新的執行通道／Task owner 欄位需由正式 Human+Governance 決議，**本審核不創建新 Sprint、不把「SP004/T008」PoC 假代號當真人 Task**。先經 R4/R5 安全授權解決 BL008/BL010/BL031 才能證明 BS025 的 Backlog 完整覆蓋 Gate，不得跳過失敗條件。

**快速結論：** 這是受控且需要 Human approval 的 L2 Activation/rebind，而不是 9 項 AC 語意重設計；它目前不能執行的直接原因是 R4/R5 L3 安全 gate 仍未解、Human 授權鏈與真實 CI trust 待補齊。
