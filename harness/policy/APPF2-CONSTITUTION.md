# APPf2 憲法：重大治理變更五審與 Human 主權（GOV-CONST-001）

> **規範性 SSOT 候選案**。僅在本文件經獨立 CI／BCE、Human 明確 merge 核准並合併到 `NFF98/appf2-build/main` 後生效。PR/Issue/Chat 不等於已生效憲法。
>
> Canonical owner：`NFF98/appf2-build/harness/policy/APPF2-CONSTITUTION.md`，上位於 `AGENTS.md` 的一般執行約定；不得推翻 `NFF98/appf2-design/working/` 的 Product Truth、已鎖定的 Build Spec、既有更嚴格的安全 Gate。法律與 Gate 衝突，採較嚴格者並停止執行。

## 0. 制憲權與第一案

Human 2026-10-10 授權啟動本法入庫流程；本次是「制憲候選案」，**不是**未來任一修憲案的豁免先例。制憲候選 PR 必須獲正式 Human merge 核准才生效。制憲流程不能為自身創造額外的 Task/Cursor 實作權限；只准限縮治理檔案。

第一件適用本法的審議案為 GOV-CASE-PG-001（Issue #345）。它在本法生效前的所有討論、案卷、AI BCE **都不算**五個 Human 核准中的任何一個。本法生效後可重審；Human 保有否決權。

## 1. 強制觸發（Fail-closed）

任何涉及下列變更者均為「憲法級」：
- 既有 `harness/policy/repo-policy.json` 所列**安全政策或執行規則類** `governance_only_paths`，包含 `harness/`、`AGENTS.md`、`.github/`、`ci/`、`deploy/`、`tooling/`、`package.json`、品質/測試設定及規則。**既有合法的純控制狀態／交付紀錄**（例如 `build-spec/CURRENT.json`、既有 baseline/activation、`delivery/CURRENT-SPRINT.json`、Backlog、Sprint、Delta、Evidence、Finding、審核紀錄和 Release manifests）仍由各自既有獨立的 Lifecycle/Scope/Evidence/Activation Gates 嚴格管控，不因本法額外要求五審；但如果它們被用來擴張安全政策或修改 Agent 權限，本法仍須適用，不能藉此逃避。
- `package-lock.json` 和 `package.json` 的依賴/版本變更視為同一憲法級單位，不許拆分或提前先裝後審。
- 任何可更改 Cursor lease、角色分工、Human approval、SSOT、授權界線、驗收與 CI 安全 Gate 的行為，無論檔名。
- 不確定是否觸發，依憲法級處理，禁止 AI 自行放行。

不得以調整 `allowed_write_paths`、臨時例外、工作樹、合併小 PR、使用外部 Node 專案、腳本、fork 或「測試用途」迴避。外部 PoC 必須有自己的權限，不等於正式產品修改的授權。locked baselines 永不可原地編輯。

## 1A. 三級變更分類：Build／SPEC／憲法（不得混淆）

**先判斷改變了什麼權威與語意，不以資料夾名稱、PR 標籤或 AI 主觀命名分類。** 每一變更提案在任何 implementation lease 之前，需列出「變更前後語意、檔案、Product/Contract 影響、治理權限影響、證據與最終核准者」。未能證明類型時，HARD STOP，由 Human 定性。

| 層級 | 判準 | 唯一真相與合法執行路徑 | 核准／驗收 |
| --- | --- | --- | --- |
| **L1 一般 Build（行政／執行）** | 不改 Product semantics、已鎖定的 SPEC/Acceptance、Agent 權限或安全 Gate；只按既有契約實作、修 Bug、測試 | `NFF98/appf2-build`：active locked Build Spec → 已批准 Sprint/Task → `src/`、`tests/` 等 Task `allowed_write_paths`；`validate-change-scope.mjs` + `validate-sprint.mjs` + CI | Human Sprint/Task 權限；Cursor 執行後獨立 BCE、Evidence、另行 Human merge／closure |
| **L2 SPEC／REBIND（修法／產品契約）** | 改需求、行為、架構契約、Acceptance／Test 的規範意義、Baseline 綁定或 Design-to-Build 投影；不改上位安全治理 | **先** `NFF98/appf2-design/working/`（Product Truth）→ Human Design/Delta 審查 → Build Freeze → `appf2-build/build-spec/baselines/BS-*` **新建** immutable Baseline → `build-spec/activations/`、Backlog/Sprint 正式 REBIND | Design Human approval + Freeze/Activation Gate + 獨立 CI/BCE；舊 locked baseline 永不改寫 |
| **L3 憲法級（修憲／上位治理）** | 改 AI/Human 權限、安全政策、Gate、CI 保護、受保護依賴（包含 `package.json`／`package-lock.json`）或憲法本身 | 本檔 `harness/policy/APPF2-CONSTITUTION.md` 為 Build/Delivery 治理 owner，`AGENTS.md` 通知 Agent；`validate-constitutional-change.mjs`、`governance-gate.mjs` 在 CI 執行 | 強制 5 Why + 依序五次 Human 核准 R1–R5 + 獨立 CI/BCE + **另一筆** Human merge approval |

**跨層處理**：同一變更若同時涉及 L2 產品契約和 L3 安全規則，**兩組獨立核准鏈均須完成**，不得只走最高層就豁免 Product Design；也不得以一般 REBIND 包裝修憲。L1 實作衍生的 SPEC gap 只能先建 Finding，退回 L2；不能把 code 反向當 Product truth。

**SSOT 邊界**：本文件是 `appf2-build` 的 Build/Delivery 上位治理，不取得 `appf2-design` Product Truth 修改權。`appf2-design/SSOT.md` 與 `working/` 仍是 Design 的唯一 Current Truth；若要讓 Design repo 的自身 CI 也讀到此三級分類與修憲 Gate，必須另行提出經 Human 批准的 Design governance PR。**單在 Build Repo 加規則，不得宣稱已跨 Repo 機器執行。**

## 2. 五層防 AI 誤判

1. **談論 ≠ 核准**。問題、建議、假設、問句、「OK」「差不多」「那就裝」「核准下一步」「批准執行」等未含特定 Case＋階段＋案卷版本者，一律不算「修憲階段」核准。當人明示「目前沒批准」時，不得反向推論。
2. **一關一訊息**。R1…R5 必須有五個彼此獨立、按序、人類主動提交的核准。Human 看完當關定稿案卷後，在**後續**訊息批准；不能一次打包、不能事前預批。任一關退回、撤銷則 HARD STOP。
3. **綁定精確標的**。每次 Human 審批明列 `case_id`、`R1..R5`、`dossier_version`、Hash／SHA 或對應 GitHub 審議文件、批准範圍與排除事項。AI 不能只依語感補足，不能把一次核准拿去另一個 Case。
4. **Human 來源驗證**。AI 用工具貼的 GitHub Issue comment、PR review、Bot/Watcher RESULT、Agent 生成文本，即使使用 Human 的 GitHub 身分，都**不算** Human 獨立核准。模型不准自簽、代簽、代貼後自判；核准須由 Human 的直接訊息或 Human 親自操作的、可與 AI 操作區分的可信身分路徑建立。**GitHub API 的顯示帳號本身無法辨認人類與共用憑證的 AI**，故不得單靠此通過審核。
5. **失效與重審**。若 dossier、5 Why、依賴版本、路徑、PR diff、base SHA、執行邊界、風險或影響有重大變化，先前適用的許可失效，退回相關關卡；不可由 AI 自判「不重大」。若無法驗明真偽，狀態一律 `BLOCKED`。

## 3. 五次獨立 Human 審議

| 關卡 | 必備案卷、審查目標 | 核准效力 |
|---|---|---|
| R1 根因必要性 | 5 Why（逐問附證據；未知明列）、問題可重現、不修的後果 | 同意繼續調查 |
| R2 事實覆核 | 重抓 canonical main/Design SSOT、路徑和 Gate、證據反駁、風險 | 接受事實基礎 |
| R3 替代方案 | 至少不變更、隔離 PoC、最小正式變更；權衡安全、成本、可回退性 | 選擇路線 |
| R4 修訂草案 | 精確檔案 diff、相依/lock、版本與 SHA、回滾方案、負面攻擊測試、獨立 BCE | 同意提交最終審議 |
| R5 最終授權 | 逐檔限定權限、dossier/PR 的精確版本、時效、允許與禁止事項 | 僅批准提出限縮候選修改 |

**五次批准以外還必須**：GitHub CI 全 PASS、獨立 BCE audit、Human 明確 `merge` 核准、合併後重新驗 canonical main。R5 絕不授權 Cursor 擅自實作、合併、部署、啟動下一 Task、觸碰別案，必須另行具體授權。

## 4. 每案強制 5 WHY 模板

W1 可觀測症狀（測試/記錄）；
W2 直接原因（程式碼或執行路徑）；
W3 所缺能力或流程（排除偽因）；
W4 最初形成缺口的證據（無歷史佐證則標 UNKNOWN，**不得編造**）；
W5 為何現行正常授權流程不能在不放寬保護下解決（引用明確 Gate）。
逐項另列：不改的代價、最小解法、no-change 對照、權限攻擊面、rollback、未解風險。

## 5. 可機器強制與不可假稱的範圍

- Repo CI 的 constitutional validator 必須偵測 governance-only 變更和 `package-lock.json`，對缺少五關案卷證據的案件一律 FAIL；不可因文件中寫 `APPROVED`、模型產生的五段文字或 Issue 標籤而自動判定 Human 身分。
- CI 可驗證檔案/範圍、結構、版本、5 個步驟的存在、變更 digest 與 base SHA，**不能**單憑同一個 GitHub 帳號證明審批者不是 AI。對 provenance 有疑慮時必須 Human 親自覆核。未建立可信的獨立簽章/保護規則前，不得宣稱達到不可偽造的人類身分證明。
- 一般 ACTIVE Sprint 的 `validate-change-scope.mjs` 限制**繼續有效**；驗完五關也不會自動繞過。需要額外合法治理 transition，絕不可先跳過 Gate。
- 本制憲候選案的一次性 bootstrap 只限 2026-10-10 指定 main SHA 與有限路徑；**不得**授權後續 `pg` 或 `package.json` 例外。
- 任何變更本憲法、其 CI Gate、核准身份驗證或安全例外，亦須遵守本法，不能自我赦免。

## 6. 機關職責及個案狀態

**立法院 = Human 最終決策 + ChatGPT 議案整理與反方審核（無表決權） + GitHub 真實紀錄/CI + Cursor 僅實作已合法獲授權 Task。**
Human 可以否決、退回任何一關。GitHub 唯一 canonical source，不把 Chat、Issue、草稿 PR 當成已合併法律。

- 制憲來源：Issue #344，制憲 Human 授權：本案對話中的 2026-10-10「批准，執行啊！」，只授權建立本候選案，**不表示已批准 merge**。
- pg 第一案：Issue #345；截至本文件入庫候選時 R1…R5 **0 / 5**，NOT APPROVED。
- 唯一 T006 執行通道：Issue #301；Cursor 原 lease 已使用，不得重用。
