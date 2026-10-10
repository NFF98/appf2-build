# GOV-CASE-PG-001 — R2 獨立事實、歷史與治理覆核案卷 v1.0

**日期**：2026-10-10（JST）  
**性質**：`R2 INDEPENDENT READ-ONLY EVIDENCE AUDIT / HUMAN R2 PENDING / NON-EXECUTABLE`  
**Build SSOT**：`NFF98/appf2-build/main` @ `c4ef766d127dd04ad101e358b52b295beca5ba3f`  
**Design SSOT**：`NFF98/appf2-design/main` @ `7a69bdab36db34618a1904a637587a01148ee138`  
**上位規則**：`harness/policy/APPF2-CONSTITUTION.md`（PR #346 merged）  
**Case**：Build Issue #345；T006 唯一 Watcher/Execution Issue #301  
**R1 標的**：`GOV-CASE-PG-001-R1-v2.1-PROPOSED.md` SHA-256 `8bb42d9be8cc14ae9b9cfab5b753faf00229cdbc8eb20fcfcff7d86b1d764276`  
**R1 Human 訊息**：2026-10-10 Human 於 ChatGPT 直接發送獨立訊息，明列 Case、R1、v2.1、SHA-256，限准進入 R2 唯讀；AI 誠實轉錄 GitHub Issue #345 [comment #6091502842](https://github.com/NFF98/appf2-build/issues/345#issuecomment-6091502842)。

> **簽章狀態**：已收到 Human 的 R1 直接意思表示；R1 Ed25519 信任簽章尚未由獨立 Human 私鑰提供或驗證。AI/GitHub 同名使用者留言不是 Human 簽章。故這份 R2 只允許唯讀研究、資訊呈報；不得把 `R1` 誤寫成「機器驗證簽章 PASS」或以此解鎖受保護檔案執行。R2 尚未批准，R3～R5 未獲任何核准。

## 1. R2 所覆核的四個事實主張

### C1｜404 是前端同源 HTTP Host/Router 缺口，不是 pg driver 的故障

- 原始碼：`src/app/create/f01-client.ts` 會使用 browser `fetch` POST `/api/v1/intents`，JSON envelope 預期是 `{request_id,data}` / 規定錯誤結構。
- `tooling/web/vite.config.ts` 只設定靜態 Web build 與 `preview` 127.0.0.1:4173，沒有 API proxy 或 Worker mount。
- `src/edge/intent-api.ts` 提供 `createIntentApiHandler(dependencies)` 工廠與 F01 POST route matching；該工廠不是可直接啟動的 Cloudflare Worker 入口，也不會自行掛到 Vite。
- `tests/e2e/support/f01-browser-host.ts` 自述：production handler 仍透過 **F01 fakes + scripted model gateway** 模擬掛載；正式 Edge mount（供 trusted anonymous context）尚未存在。測試成功不代表正式 API Server 存在。
- Human 既有本機回報：`POST /api/v1/intents -> 404`；本輪未遠端控制其 PC，無法獨立取得新 HTTP wire trace。故「配置與 404 因果一致」可確認，**不是**「已直接在本機完整重現」。
- 反證條件：取得一筆從真 Worker 入口至 F01 Service 的帶 `X-Request-Id` JSON 回應、有效同源 POST，才能排除 Host 缺口。光加 `pg` 後 POST 仍可能 404。

### C2｜Design 已決定 PostgreSQL durable truth，但沒有決定一定使用 pg

- Design `working/common-core/INFRA-ARCHITECTURE.md`：Phase 1 = Browser + Cloudflare Edge/Workers + Supabase PostgreSQL + Model adapter。
- Design `working/common-core/DATA-MODEL.md` DM-P01 / DM-P06：PostgreSQL 為 durable truth，透過 APPf2-owned Repository/Service interface，LegoSpec 不能直接綁 Supabase API。
- `src/platform/blueprint/postgres-blueprint-repository.ts` 定義 `PostgresExecutor.query(statement, parameters)`，與 `src/platform/compiler/postgres-compiler-repository.ts` 已有 SQL；這是 repository implementation + port，不是 driver transport。
- main `package.json` 的 runtime dependencies 只有 `react`、`react-dom`；無 `pg`、`postgres` 或 `@types/pg`，scripts 無正式 Worker server 啟動。
- Supabase migrations 包含 `anonymous_identity`、`validation_run`、`blueprint_content`、`intent_record`、`compiler_run`、`idempotency_operation`。RLS 已被啟用，但 **「已啟用 RLS」≠「已確認最小權限 DB role/GRANT/每張表的有效政策」**。
- Human 曾以 `psql` 經 Supabase Session Pooler SQL PASS，只驗證本機客戶端對該 DB 的認證/查詢，不能證明 Hyperdrive/Worker 已經可以連線、transaction/read-after-write 正確、權限受限。
- 官方 Cloudflare [Supabase Hyperdrive Guide](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/) 明確建議 Hyperdrive 使用 Supabase **Direct connection**（Hyperdrive 自己 pooling），不能照搬 Session Pooler 字串。
- 官方 [node-postgres](https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/) 推薦 `pg`，最低版本 `8.16.3`；官方也支援 Postgres.js。**這證實建議路線可行，不證明 `pg` 唯一、特定版本 lockfile/全系統兼容已驗收**。

### C3｜完整 F01→F02→F03→S03 還沒有真實可重現證據

- `src/platform/compiler/intent-operation.ts` 之 service dependencies 至少包含 `intents`、`runs`、`outcomes`、`idempotency`、`identities`、`admission`、`gateway` 等，需由真 server host 注入，禁止 browser 提供 trustedAnonymousId 或暴露 secret。
- `src/platform/compiler/openai-compatible-gateway.ts` 可用 server-side model configuration 呼叫 API，但 Human 獨立 OpenAI smoke 沒有驗證 APPf2 兩階段 Intent Analyze / Blueprint Compose 與資料持久化。
- `src/platform/blueprint/execution-admission.ts` 要求以 **真實持久化** Blueprint / validation lineage 執行 E01-E08，fresh admission TTL 為 30 秒；fixture READY 不可冒充。
- `delivery/sprints/SP-P1-003/tasks.json` T006 `IN_PROGRESS`、九個 Acceptance→Test mapping、`completion_evidence=[]`；`build-spec/CURRENT.json` implementation_enabled=true 但不代表新 Cursor lease。
- `deploy/scripts/smoke.mjs` 只檢查 manifest health_checks 的 HTTP `expected_status`；不足以證明完整 App 真生成/持久化/READY/local state commit。現有 `ci/run-product-ci.mjs` 對真正 implementation 要求映射測試，但憲法 PR 的四項綠燈不算 T006 測試綠燈。
- 反證條件：staging 真 same-origin API + 真 OpenAI analyze/compose + durable SQL read-after-write + F02 validation/admission + F03 READY + S03 genuine local event commit，逐步帶原始 trace、DB row/key/hash/registry pinned version、CI 與負測證據，才算完成。

### C4｜Hyperdrive 快取、身份與權限是獨立的阻斷風險

- 官方 [Hyperdrive Query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/)：cacheable SELECT 預設 max_age 60s、SWR 15s；寫入不會自動清掉先前讀取快取。對 user identity、fresh E01-E08、read-after-write 必須透過 **cache-disabled** Hyperdrive binding（或經審查的無快取路線），不能以 SQL 註解來假裝控制快取。
- RLS/migrations 無法替代 credential partition、least privilege、SQL injection 防護、idempotency/atomicity 併發測試。正式 Worker 不得用資料庫管理員帳號做應用程式存取；任何新 role/GRANT 都需獨立 Human/治理審查與隔離環境驗證。
- 官方 [Workers Static Assets](https://developers.cloudflare.com/workers/static-assets/) 支援 selective `run_worker_first` 將 `/api/*` 導到 Worker。它是可選擇的同源替代架構，**R2 不提前作 R3 選擇**。
- Worker 與應用模組所用 Node APIs / bundling / runtime date 的相容性必須在 R4 實際 Wrangler bundle 與 staging smoke 佐證。官方範例/文件不等於此專案實際 bundle PASS。

## 2. 形成歷史（W4）再審：目前仍 UNKNOWN

- GitHub commit history：`tooling/web/vite.config.ts` 與 `package.json` 在 [PFR-06 readiness #281 commit 7b4c850](https://github.com/NFF98/appf2-build/commit/7b4c850a36899fb5e310bd8002dbd5f3c386e5cf) 已加入 React/Web 預覽與依賴；它證明 Web build readiness 的來源，不證明當初「刻意永久不設 API」的原因。
- Postgres Blueprint SQL repository 早在 [T002 commit 7b0a640](https://github.com/NFF98/appf2-build/commit/7b0a640334b4f6d33f7f39e09aa9666667765ef2) 有修改，後續 [T005 commit 3fd91f7](https://github.com/NFF98/appf2-build/commit/3fd91f77326a93663f643db9fdd741f3ac14d3c8) 更新；代表先建資料層契約，但不能倒推出缺 driver 的歷史動機或責任。
- Design Infra Working 的 [Phase 1 freeze marker commit 259f1e1](https://github.com/NFF98/appf2-design/commit/259f1e1b2277cf062611108c48112573ddc72cf0) 證明產品架構基線存在。
- **根本歷史原因 W4 = UNKNOWN（維持）**。不可編造已查明；R3 可在不知道個人歷史動機的前提下選擇以現況為證據的方案。

## 3. 三級治理與安全覆核

- **L1**：`src/`、`tests/` 等在 locked semantics、Task allowlist 且 Human 執行 lease 下才能實作。
- **L2**：涉及設計中的 architecture/product semantics、Acceptance 或既有 baseline 改動，先改 `appf2-design/working/` 並獨立 Human Design approval，再建新 immutable Build baseline/REBIND。不得改舊 baseline。
- **L3**：`package.json` + `package-lock.json`、`tooling/`、`.github/`、`harness/`、`ci/`、`deploy/` 的受保護修改要走本 Case 逐關 R1~R5 簽章、獨立 BCE/CI 及 Human merge。原 T006 allowlist 雖含 `tooling/web/vite.config.ts`，`harness/policy/repo-policy.json` 仍分類 `tooling/` governance-only，Scope Gate 優先拒絕，一律不得用 Task allowlist 繞過。
- **公鑰**：`validate-constitutional-change.mjs` 從獨立 `APPF2_CONSTITUTION_PUBKEY_B64` 取得 Ed25519 公鑰，逐階驗 R1..R5 dossier SHA、鏈狀簽章、candidate digest、base SHA 等；未設定或未簽章必須 fail-closed。現有 GitHub 唯讀 API 無法檢視 Actions variable 設置，**無法宣告已配置**；依交接來源，截至制憲合併尚未配置。
- **GitHub Ruleset**：active `NFF Build` #23969502，要求 CI、attack、governance、CodeQL 四項 checks，但 `required_approving_review_count=0`、`required_reviewers=[]`。不能宣稱 GitHub 已強制 Human reviewer。
- 本輪未變更 Repo、package/lock、Cloudflare/Supabase account、secrets、Watcher/lease、CI、DB，也未做 staging/live API test。

## 4. R2 未解、留待下一關與安全前置條件

1. 真 Workers routing、同源 URL、Worker bindings、`pg`/Postgres.js 實際可運行測試：未做（需後續合法授權）。
2. Supabase Direct endpoint 的 IPv4/IPv6、網路可達性、應用 DB least-privilege role、RLS/GRANT/trigger 真實政策：尚無獨立非秘密現場證據。
3. 模型在 Worker 真 environment 下的可用性、credentials、timeouts、response schema：尚無 end-to-end evidence。
4. F02 durable read-after-write、併發 idempotency、跨 DB operations 的交易語意、Runtime E01-E08 TTL：尚未真環境驗證。
5. 精確新增檔案、driver 版本/lock、Worker 靜態檔案 vs Pages 同源 host、回滾與部署順序：**R3 決策＋R4 exact diff**；現在不可預選。
6. Human R1 的獨立簽章、可信 Actions 公鑰、GitHub Required Human Reviewer 尚未獨立完成核實。**任何受保護變更 PR 均維持 HARD STOP**。

## 5. R2 獨立 BCE 結論（本案卷不是 Human 核准）

- **FACT-AUDIT = PASS WITH EXPLICIT GAPS**：Repo、Design、歷史與官方相容性證據可支持「完整整合有必要、必須嚴格控權、不能只安裝 pg」；不是全系統成功證明。
- **W4 = UNKNOWN**：歷史因果仍不明，不自行猜測。
- **SIGNATURE = NOT VERIFIED**：R1 Human 直接決定已接收並轉錄；尚未由可信 Ed25519 公鑰驗證獨立 Human 簽名。
- **R2 Human decision = PENDING**：本案只提請接受「目前技術事實、風險、未知」作為 R3 方案比較之基礎，不選方案、不改程式、不裝套件。
- **R3~R5 仍未批准**。不得發新 Cursor lease、重用 #6077067017、修改任何受保護檔、merge 或 deploy。

**Human R2 本次唯一決策問題**：是否接受以上已證事實及未證實清單，授權開始 R3 的**唯讀替代方案比較**（至少 no change、隔離 PoC、最小正式方案、單一 Worker/Pages 路由方案），並承認 R1 獨立簽章/公鑰/Reviewer 尚需合規補足？此按鈕僅記錄 Human 意思表示，不產生簽章或修改權。

## 來源索引（2026-10-10 唯讀核對）

- Build main：https://github.com/NFF98/appf2-build/tree/c4ef766d127dd04ad101e358b52b295beca5ba3f
- Build 憲法：https://github.com/NFF98/appf2-build/blob/c4ef766d127dd04ad101e358b52b295beca5ba3f/harness/policy/APPF2-CONSTITUTION.md
- Build Gate：https://github.com/NFF98/appf2-build/blob/c4ef766d127dd04ad101e358b52b295beca5ba3f/harness/scripts/validate-constitutional-change.mjs
- Build Task：https://github.com/NFF98/appf2-build/blob/c4ef766d127dd04ad101e358b52b295beca5ba3f/delivery/sprints/SP-P1-003/tasks.json
- Design Infra：https://github.com/NFF98/appf2-design/blob/7a69bdab36db34618a1904a637587a01148ee138/working/common-core/INFRA-ARCHITECTURE.md
- Design Data：https://github.com/NFF98/appf2-design/blob/7a69bdab36db34618a1904a637587a01148ee138/working/common-core/DATA-MODEL.md
- Cloudflare Supabase：https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/
- Cloudflare driver：https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/
- Cloudflare cache：https://developers.cloudflare.com/hyperdrive/concepts/query-caching/
- Cloudflare assets：https://developers.cloudflare.com/workers/static-assets/