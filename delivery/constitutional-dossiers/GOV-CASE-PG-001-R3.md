# GOV-CASE-PG-001 — R3 替代方案比較與架構選擇待審案卷 v1.0

**日期**：2026-10-10（JST）  
**地位**：`R3 READ-ONLY COMPARATIVE BCE / HUMAN R3 PENDING / NON-EXECUTABLE`  
**Case**：`GOV-CASE-PG-001`，Build GitHub Issue [#345](https://github.com/NFF98/appf2-build/issues/345)  
**Build main**：`c4ef766d127dd04ad101e358b52b295beca5ba3f`  
**Design main**：`7a69bdab36db34618a1904a637587a01148ee138`  
**T006**：SP-P1-003 / BS-P1-024 / T006 `IN_PROGRESS`；9 項 mapped acceptance completion evidence `[]`；唯一 watcher Issue #301；舊 lease #6077067017 已消耗。  
**Human approval 路徑**：R1 v2.1 Human direct decision 已收到、AI 轉錄 [#6091502842](https://github.com/NFF98/appf2-build/issues/345#issuecomment-6091502842)；R2 v1.0 Human direct decision 已收到、AI 轉錄 [#6091546434](https://github.com/NFF98/appf2-build/issues/345#issuecomment-6091546434)。均**未獨立驗證 Ed25519 簽章**；不得冒稱憲法 PR machine-ready。R3 未批准。

## 1. 問題、目的及不可違背條件

Human 已批准**完整正式整合的方向**，不是「先裝 pg 試試」。需要將現有 Browser/F01/F02/F03/S03、Model Gateway、Supabase PostgreSQL、正式 HTTP host 組合成可部署、可持續維護的端到端產品：使用者輸入自然語言 → F01 真模型兩階段 → F02 驗證與耐久資料 → fresh E01–E08 admission → F03 READY → S03 真實本地 state/result commit。既有 localhost Vite 靜態 preview 沒掛載 API，POST `/api/v1/intents` 曾由 Human 報 404。解決 404 不等於全流程成功。`pg` 只是一種 Node/Workers Postgres driver。

- 必須採 Design 已選擇的 Browser Runtime + Cloudflare Edge/Serverless API + Supabase PostgreSQL durable truth + Server-only LLM。
- 不讓 Browser 直連資料庫或攜帶 server credential；identity、idempotency、error envelope、trust status、registry hash、fresh admission 均須守已鎖定契約。
- 避免重複或高權限 DB 服務；F01/F02 關鍵路徑對 DB SELECT 讀寫後一致性採 **Hyperdrive cache-disabled** 或同等有證據的 no-cache 傳輸；全員最小權限 DB role，拒絕越權。
- 不新增無授權的 Product semantics；如出現 L2 變動，先 Design Working+Human+immutable baseline+REBIND；受保護依賴、tooling、CI、deployment 走 L3 五審與獨立簽章。
- R3 只選後續 R4 **精確設計草案**的路線；不授權依賴安裝、帳戶/DB/Worker/網域變更、PR、Cursor lease、merge 或上線。

## 2. 比較基準

比較 ① 對既有 Design/Build 改動量；② 404/同源路由可證明性；③ DB/模型安全與 read-after-write；④ 開發與長期維護成本；⑤ 測試、回滾能力；⑥ 額外治理路徑及風險。以下是基於 Repo+官方文件的**定性工程評估**，不是量測性能/報價，也不能當成 live PASS。

| 方案 | 做法 | 優點 | 缺點與仍需證明 | R3 建議 |
|---|---|---|---|---|
| **A 維持現狀** | 不新增 host/driver、不修改部署 | 目前無新依賴或實作風險 | POST 404 與 full E2E 缺口持續；T006 不能完成 | **不選**，保留作無變更基準 |
| **B 隔離 PoC** | 經另一筆 Human 明確授權的 Repo 外隔離環境證明 Worker/Driver/DB 可連，不寫入正式 Repo；禁用正式 secrets | 可以在不碰核心 Repo 情況下降低部分技術不確定性 | 不是真 APPf2、不能當 T006/production acceptance；不能藉 PoC 規避 L3 | **僅風險降低選項，不是最終方案** |
| **C 保留 Pages 靜態站 + 獨立 Worker API，同一網站域名上精確配 `/api/v1/*` 路由；Worker+Hyperdrive+pg+Supabase** | 最貼近已批准 Design/既有 Release targets (Pages、Worker、Supabase)；不另造常駐 Node 伺服器；可分開回滾 Web/Worker | 同源網域與 Route 配置需要按 Cloudflare Zone/Domain/Routes 狀態精確驗證；可能發生 Pages fallback 吃掉 API 的配置錯；兩個部署目標較複雜 | **R3 首選正式方案** |
| **D 單一 Worker + Static Assets (`run_worker_first` 精確攔 `/api/*`) + Hyperdrive+pg** | 網站和 API 由同一個 Worker/路由部署，減少跨服務配置，官方支援 SPA fallback 與 Worker-first selective patterns | 必須審查並調整既有 Pages/Worker 部署工作流與 rollback；不能先宣稱一定比 C 便宜或省事，可能涉及更多 L3 修改 | **備選**；R4 只有證明 C 不可穩定路由/總變更較大時才提替換，但需 Human 重新確認路線 |
| **E Pages Functions + bindings + Supabase** | 由 Pages Functions 提供同站點 API，Cloudflare 官方有 file-based routing | **官方已確認 Pages Functions 支援 Hyperdrive bindings**，但此 APPf2 的 Node/pg bundle、DB transport、安全與現有 deployment 相容性仍須逐項核對；與既有 `src/edge`／Workers Release 形狀不完全同構，可能增加遷移 | **非首選**，不可不經審查替代 C |

**資料庫 driver 子選項（僅 C/D/E 內比較，不混同 host 決策）**：
- **`pg` (node-postgres)**：Cloudflare Hyperdrive 官方推薦，最低 `8.16.3`；`PostgresExecutor.query(statement, parameters)` 的 SQL/parameter API 與其 adapter 容易吻合；R4 必須鎖定 exact tested version、必要的 `@types/pg`、nodejs compatibility、lockfile 與負測。**推薦**但不宣稱已 bundle PASS。
- **Postgres.js**：Hyperdrive 官方也支援，可作替代，需避免 `prepare: false` 造成不穩定；現有 `PostgresExecutor` 需另外驗證 parameter/transaction adapter；不以猜測冒充更省事。
- **直接 DB 連線/HTTP API 等**：需對交易/並發/快取/安全與 Worker TCP 支援有對等證據；不能因 `psql` 成功推論 Worker 可以直接沿用連線字串。Supabase JavaScript table API 不能直接取代既有 APPf2 SQL repository / vendor-neutral contract。保留可反駁路線，不優先。

## 3. R3 預定決策（只供 Human 批准）

**推薦 C：Cloudflare Pages 靜態 Web + 同一公開網域下的獨立 Cloudflare Worker `/api/v1/*` + 正式 Model Gateway + Hyperdrive cache-disabled + `pg` + Supabase PostgreSQL + Browser F03/S03。**

選擇理由：維持已核准 Design、已有 Pages/Worker/DB release targets、減少部署拓撲重新設計。不選 B 當 production；也不立即由 C 換 D，以免為了「看似一體化」反而先改掉現有流程。假如 R4 實際 Route/Zone 相容性證據顯示 C 不可行，先回 Human 修訂 R3，而不是 Cursor 自動換 D。

**需明確排除**：沒有「裝完 pg 就會成功」的承諾。方案 C 還需要 worker bundle/相容性、資料庫最小權限帳號、資料列權限（RLS/GRANT）、DB migration 一致性、真 API route、模型 secret、讀回 Blueprint、fresh admission、Runtime local commit 的全鏈測試。

## 4. 不改、成本、回退及權限風險

- **不改**：最少短期支出，但 POST 404／無真 E2E／T006 堵塞；不能達成本期 playable App 目標。
- **成本**：C 可能需要 Cloudflare Workers/Hyperdrive/Supabase 服務費與模型 token；不能在沒有帳戶配額、流量、DB 規模證據時編造金額。雙部署目標需維護路由。D 單一 Worker 可能減少路由面，但有 Release pipeline 改造成本；B PoC 只降低風險，不替代 production 工作。
- **回退**：Worker 與 Pages 程式可以按既有經核准 Release 系統執行程式碼回退；DB schema migration 為 forward-only/expand-only，不能說「按一下就還原資料庫」，須 DB restore/forward remediation 預案與測試。
- **安全攻擊面**：偷改 package/lock、調整 `tooling/`、合併小 PR、用外部 PoC 或 fake 測試代替受保護變更，均禁止；Browser 自述 anonymous identity 不得直接提升成可信 Server identity；DB role 不能預設用管理員帳號。
- **Hyperdrive**：官方建議連 Supabase **Direct connection**（Hyperdrive 自己池化），不是 Human 先前 `psql` 用的 Session Pooler。官方 Query cache 預設 max_age 60s、stale_while_revalidate 15s，寫入不自動清 SELECT 結果；**建議第一階段所有 F01/F02 身分/耐久/驗收查詢皆經 cache-disabled binding**，未來性能測試後再有界開快取。

## 5. R4 逐檔審查前必須補足的驗證清單（目前尚未授權執行）

1. **真實 Cloudflare route**：確認 Domains/Zone/Worker Route/Pages project 是否可在**同一公開網域**由 Pages 發 static、Worker 攔 `/api/v1/*`；本機 Vite preview 不是證據。要有待部署配置清單、路由衝突負例、JSON Content-Type / 404 fallback 規格。若 C 的路由拓撲不可在現有帳戶/網域落地，退回 R3。
2. **真正的 Worker entrypoint & injection**：既有 F01 handler 與 server-owned identity、API errors、service dependencies、DB gateway、model adapter 必須有可測組裝設計，不能把 Playwright mock 當 Worker host。
3. **`pg`/Hyperdrive**：exact version & lock + `nodejs_compat` runtime/compat date + Wrangler bundling、prepared parameter query/transaction、Direct DB endpoint/TLS/IPv4-v6 與 Workers 連線可達性；禁止 secrets 進 PR/Issue。
4. **DB 安全與新鮮度**：最小權限角色/RLS/GRANT/讀寫 SQL、讀後立刻讀回、cross-identity isolation、idempotency concurrency；Supabase 原有表的 migration 順序和 FK constraints/immutability triggers；所有外部資源更動待 Human 單獨批准。
5. **真模型**：F01 analyze + compose 兩階段而不是單獨 smoke，timeout/額度/error 辨識、server-only secrets、敏感 log 脫敏。
6. **產品真 E2E**：經 DB 讀回 persisted content hash+validation lineage，E01–E08 admission fresh TTL≤30秒、F03 READY、S03 UI/真互動 local committed state/result、互動期間零 server/LLM roundtrip；不可用 in-memory fake。
7. **GitHub CI與人類證據**：T006 9/9 mapped executable tests、Product CI、Security/BCE、負面攻擊測試；appf2-build 五審 `APPF2_CONSTITUTION_PUBKEY_B64` 可信鑰與每關獨立 Ed25519 簽章；NFF Build Ruleset `required_approving_review_count=0` 未補強；受保護 PR 繼續 fail-closed。
8. **精確變更邊界**：R4 必須提出逐檔候選、版本、base SHA、PR/CI/回退方案，依 L1/L2/L3 各自合規；若涉及 Design semantic delta，先 Design Working+Human，再另建 immutable Build baseline 與 REBIND，不能在本審自行修改。

## 6. R3 獨立 BCE／反方觀點

| 審核問題 | 反方質疑／已查證內容 | 結論 |
|---|---|---|
| C 是否只因之前選過才推薦？ | C 與 Design Phase 1 和 Build Release target 現況一致；D 的確可能降低 route complexity，但需要改現有 Release 架構，無測試可證成本更低 | **有理由首選 C，但非絕對最優** |
| 掛 Worker 是否保證 404/整條流程都解決？ | API 404 直因為無正式 mount，但 route、可信 identity、DB、模型、Runtime 都仍有獨立失敗面 | **否；需 R4 證據與 staging E2E** |
| 為何不是立刻裝 `pg`？ | 只補 DB transport、仍無 Server mount，且為 L3 protected dependency | **不得提前安裝** |
| Hyperdrive 預設快取可否照用？ | 官方寫明寫入不清 SELECT cache、短暫舊資料風險 | **關鍵路徑先關快取** |
| `pg` 是唯一選擇？ | Postgres.js 亦獲官方支援；`pg` 是官方推薦且配合介面易，但不具獨占性 | **不主張唯一** |
| 原始 W4 歷史真因是否已查明？ | commit 只能證明階段引入，無明確決策原因 | **UNKNOWN 保留** |
| R1/R2 已核准是否准許進 R4 施工？ | 直接 Human 決議只允許逐關調查；簽章/可信來源、後續階段和 merge 授權未齊 | **不可** |

**R3 BCE：研究品質 `PASS WITH EXPLICIT OPEN GATES`；本案卷 `PROPOSED`；Human R3 = PENDING；機器可驗簽章仍 0/5。** 無任何 Worker/Hyperdrive/DB/Repo 寫入、安裝、部署、lease、merge。本次主張的是「最符合目前設計與治理的方案」，不是「已驗收成功」。

## 7. R3 提請 Human 的唯一決定

是否正式批准：`GOV-CASE-PG-001 / R3 / dossier_version=v1.0 / exact dossier SHA-256`，**選 C 為進 R4 精確設計與安全審查的候選架構**，保留 A/B/D/E 的比較與 R4 退回權限？若批准僅可進入 R4 **唯讀審查**（逐檔、依賴、風險、回滾、負測），不得裝套件、修改 Repo、部署、發 Cursor lease、合併或預批 R5。任何後續關鍵事實/候選拓撲更動均回 Human 重新審議相應階段。

## 8. 訊源（本輪 2026-10-10 重新核對）

- Build main：https://github.com/NFF98/appf2-build/tree/c4ef766d127dd04ad101e358b52b295beca5ba3f
- Design main：https://github.com/NFF98/appf2-design/tree/7a69bdab36db34618a1904a637587a01148ee138
- R2 Human AI-transcribed decision：https://github.com/NFF98/appf2-build/issues/345#issuecomment-6091546434
- Design Infra：https://github.com/NFF98/appf2-design/blob/7a69bdab36db34618a1904a637587a01148ee138/working/common-core/INFRA-ARCHITECTURE.md
- Build Release script：https://github.com/NFF98/appf2-build/blob/c4ef766d127dd04ad101e358b52b295beca5ba3f/deploy/scripts/deploy.mjs
- Cloudflare Supabase Hyperdrive：https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-database-providers/supabase/
- Cloudflare `pg` driver：https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/node-postgres/
- Cloudflare Postgres.js：https://developers.cloudflare.com/hyperdrive/examples/connect-to-postgres/postgres-drivers-and-libraries/postgres-js/
- Cloudflare Cache：https://developers.cloudflare.com/hyperdrive/concepts/query-caching/
- Cloudflare Worker Static Assets：https://developers.cloudflare.com/workers/static-assets/
- Cloudflare Pages Functions：https://developers.cloudflare.com/pages/functions/
- Cloudflare Pages Hyperdrive binding：https://developers.cloudflare.com/pages/functions/bindings/
- Cloudflare Worker Routes：https://developers.cloudflare.com/workers/configuration/routing/routes/

**HARD STOP：這是一份待審文本，不是權限、執行指令、完整審核通過的代碼或已簽署的憲法案卷。**
