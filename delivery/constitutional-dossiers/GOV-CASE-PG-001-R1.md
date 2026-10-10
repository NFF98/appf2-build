# GOV-CASE-PG-001 — R1 必要性與 5 Why 正式待審案卷 v2.1

**日期**：2026-10-10（Asia/Tokyo）  
**狀態**：`PROPOSED / R1 HUMAN PENDING / 0-of-5 / NON-EXECUTABLE`  
**Build SSOT**：`NFF98/appf2-build/main` @ `c4ef766d127dd04ad101e358b52b295beca5ba3f`  
**Design SSOT（唯讀錨）**：`NFF98/appf2-design/main` @ `7a69bdab36db34618a1904a637587a01148ee138`  
**憲法**：`GOV-CONST-001`；Build PR #346 MERGED；PG Case Issue #345 OPEN  
**T006**：`SP-P1-003 / BS-P1-024 / T006 IN_PROGRESS`；九項 completion evidence 為空；Issue #301 舊 lease 已消耗。  
**關聯方案**：`APPf2-Complete-Integration-Plan-v1.0-PROPOSED.md`，SHA-256 `b6f35bcb6a72e4bf3c9e025f0c3aa59c963302183fdac49b09a39981a962effc`。

## 0. 本次 Human 意思與核准界線

2026-10-10 Human 已在對話表示「ok我批准這套方案，繼續」，可視為**技術規劃方向的選擇**：優先研究依正式 Design 基線，把 Cloudflare API、PostgreSQL 傳輸、模型、F01→F02→F03→S03 整條流程接通。**不是 R1 的明確階段核准**：該訊息未指定 `GOV-CASE-PG-001 / R1 / dossier_version v2.1`，而且本案卷當時尚未完成。亦不是 R3 替代方案決選、R4 exact diff、R5 限縮實作授權或 Cursor lease。

原 Issue #345 著重 `pg`／LOCAL Server；本次技術方案較廣。R1 僅提議**審查此較廣整合缺口的必要性**；是否應拆成獨立受保護變更 Case、哪些範圍屬 L2、哪些屬 L3，仍須依憲法逐項判定。不得藉「整合」一詞將全部未審範圍混入單一實作 PR。

## 1. 確定的事實與來源分類

| 議題 | 已證事實 | 尚未證明 |
|---|---|---|
| HTTP | Browser `f01-client.ts` 會 POST `/api/v1/intents`；Vite preview 4173 無 API proxy；`src/edge/intent-api.ts` 是待注入的 handler 工廠 | 本輪未直接連線 Human 本機，原 `POST 404` 由 Human 回報；需後續 runtime trace |
| DB | `PostgresExecutor.query()` 與 SQL repos 已存在，`package.json` 未宣告 `pg`；Human 曾以 psql 對 Supabase SQL PASS | APPf2 Worker 對 DB 的真實連線／交易／讀回／身分隔離未通過驗收 |
| AI | OpenAI-compatible Model Gateway 原始碼存在；Human 獨立模型 smoke PASS | 真 F01 analyze→compose + validation + persist 未整合實測 |
| Runtime | E01–E08 ExecutionAdmission、F03 Runtime 程式及 fixture 測試存在 | 由真實 DB Blueprint 完成 fresh admission→READY→S03 committed local interaction |
| CI | 四項合併後 main checks PASS；有 release pipeline | T006 九項證據為空；現有 release smoke 只看 HTTP status；不是全產品 PASS |
| Design | Phase 1 Working 明訂 Browser + Cloudflare edge + Supabase PostgreSQL | 特定 `pg` 是唯一可行選擇沒有被證明；Pages+Worker 的同源路由尚未實際部署驗收 |

主要 Repo 證據：
- Build main: https://github.com/NFF98/appf2-build/tree/c4ef766d127dd04ad101e358b52b295beca5ba3f
- Browser: https://github.com/NFF98/appf2-build/blob/c4ef766d127dd04ad101e358b52b295beca5ba3f/src/app/create/f01-client.ts
- Vite host: https://github.com/NFF98/appf2-build/blob/c4ef766d127dd04ad101e358b52b295beca5ba3f/tooling/web/vite.config.ts
- API handler: https://github.com/NFF98/appf2-build/blob/c4ef766d127dd04ad101e358b52b295beca5ba3f/src/edge/intent-api.ts
- DB query interface: https://github.com/NFF98/appf2-build/blob/c4ef766d127dd04ad101e358b52b295beca5ba3f/src/platform/blueprint/postgres-blueprint-repository.ts
- T006: https://github.com/NFF98/appf2-build/issues/301
- Case: https://github.com/NFF98/appf2-build/issues/345
- Design: https://github.com/NFF98/appf2-design/blob/7a69bdab36db34618a1904a637587a01148ee138/working/common-core/INFRA-ARCHITECTURE.md

## 2. 五個 WHY：證據與反證

**W1：為何現在按 CREATE 得不到真實可操作 App？**  Human 回報 `POST http://127.0.0.1:4173/api/v1/intents = 404`，UI 沒收到預期 JSON data。這僅是本機觀測，未由本輪直接重測。

**W2：為何 POST 404？**  現有 `web:preview` 是 Vite 靜態服務，配置沒有 API proxy；Edge Handler 工廠沒有自動掛到該伺服器。這是當前 404 的最有力直接原因，需在 R2 以真 host 路由追蹤確認。**單裝 `pg` 不會建立 API route**。

**W3：即使接通 API，為何仍不能認定完成？**  真 Service 需驗證可信 anonymous ID、模型兩階段分析/生成、PostgreSQL 持久化及必要交易、F02 admission、從 DB 讀回、fresh E01–E08、F03 READY 與 S03 本機 committed interaction；各缺口獨立存在。`psql PASS`、OpenAI smoke PASS、測試 fixture PASS 都不能冒充全鏈 E2E。

**W4：最初為何留下 host/driver/integration 缺口？**  **UNKNOWN。** 目前只能證實代碼介面、SQL、測試及正式 host 尚未接通；不能推論原設計者本意、疏漏責任或歷史決策。R2 應閱讀 Design freeze、GitHub commit/PR 歷史；若沒有證據，持續 UNKNOWN。

**W5：為何不能直接安裝/修改？**  `package.json`/`package-lock.json`、Cloudflare config、治理與 CI/部署保護路徑涉及 L3，`tooling/` 治理路徑不能因 Task allowlist 而自動放行；如有 Product/Architecture semantics 更動，還須 L2 Design→新 immutable Baseline→REBIND。`GOV-CONST-001` 要求逐關五次可信 Human 核准，R5 後仍須獨立 CI/BCE 與 Human merge permission。

## 3. 技術必要性與保守選項

- **已證需求**：對真 F01/F02 durable truth，需要合法的 server-owned API + PostgreSQL 傳輸 + Model Gateway + 完整 E2E。
- **尚未證需求**：`pg` 是唯一資料庫 driver；Cloudflare Pages 和獨立 Worker 是唯一同源 host 組合。R3 必須保留不修改、隔離 PoC、Pages+Workers、Pages Functions、單一 Worker Static Assets 等方案比較，不可因技術方向同意而跳過。
- **官方新增查證 1**：Cloudflare Hyperdrive 的 Supabase 連線文件建議 **Direct connection**，不應直接把本機 `psql` 所用的 Session Pooler 字串交給 Hyperdrive。來源：https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/
- **官方新增查證 2**：Hyperdrive 讀取快取預設啟用、寫入不會自動清除；身分驗證、read-after-write、fresh admission 的 SQL 讀取必須走 cache-disabled 配置。來源：https://developers.cloudflare.com/hyperdrive/concepts/query-caching/
- **官方新增查證 3**：Cloudflare 推薦 `pg`，driver 專頁寫最低 `8.16.3`；另有 Postgres.js；具體安全版本/Node compatibility/lockfile 留 R4。來源：https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/
- **官方新增查證 4**：單一 Worker Static Assets 有 `run_worker_first=["/api/*"]` 形式的受支援方案，可減少靜態 HTML fallback 的路由風險；是否更好留 R3。來源：https://developers.cloudflare.com/workers/static-assets/binding/

## 4. 不處理的代價與後續必過 Gate

不處理：F01 live CREATE、持久化、F02 Admission、F03 READY、S03 committed interaction 無法在真端到端驗收中證成；T006 繼續 BLOCKED，不能閉環。處理前必須確認 host/route、server-owned identity、driver/DB transaction correctness、DB read-after-write、模型憑證與兩階段、Blueprint content hash、Registry trusted release、E01–E08 fresh TTL、安全負測、staging full E2E、code rollback / DB forward-only migration+restore、安全政策簽章及審查人保障。未通過不得部署。

## 5. BCE 審查結論與請求 Human 的明確決定

- **R1 dossier evidence quality**：`PASS WITH OPEN W4 UNKNOWN`。此 PASS 只表示案卷有足夠證據讓 Human 判斷「是否值得繼續調查」，**不是整合成功或施工許可**。
- **PG 人類審議**：`R1=PENDING; R2–R5=LOCKED; 0/5`。
- **希望 Human 審議的唯一 R1 問題**：是否接受上述已證事實、W4 UNKNOWN、完整整合審查必要性，並准許進入 **R2 的唯讀獨立證據覆核**？不預先決定 R3 的架構比較結果或任何 exact diff。
- **即使 Human 批准 R1**：仍不得安裝 `pg`、寫入 repo、修改 CI/治理、設定雲端憑證、發 Cursor lease、合併或部署。可信五審簽章依憲法後續辦理；公鑰/required Human reviewer 尚未有獨立完成證據，受保護修改一律 fail-closed。
- R1 若要算數，須在**閱讀本 v2.1 案卷後的另一則直接 Human 訊息**明確列出 `GOV-CASE-PG-001 / R1 / v2.1` 及授權僅限繼續 R2。此 Markdown 是本機待審材料，尚未寫入 Issue #345 或改變 canonical SSOT。
