# SP35-FIVE-CORE-PRODUCT-CLOSEOUT — Sprint 3.5 五核產品閉環收尾計畫

> **版本**：2026-10-31（使用者指定的交接識別，持續更新此檔，不開重複計畫）
> **狀態**：執行計畫已建立；產品 **NOT_DONE / LIVE E2E NOT_VERIFIED**；不代表已完成修復、雲端部署或付費 E2E。
> **產品語意唯一來源**：Design PR #45 `working/architecture-evolution/BLUEPRINT-CODE-ARTIFACT-HYBRID.md` §0（Design commit `a9651594baf79753a05b1f608466cbc93a316c51`），以及各現行 Phase 1 Fxx Working owner。**本檔只管 HOW／執行次數／證據，絕不取代 Design SSOT。**
> **唯一產品開發 PR**：[Build #419](https://github.com/NFF98/appf2-build/pull/419)；Design 只沿用 [#45](https://github.com/NFF98/appf2-design/pull/45)。不開 Sprint 4，不建立平行的 Product Spec 或其他開發 PR。

## 0. 2026-10-31 Free-only 執行決議（Human 最新指示）

**只改成本／隔離執行方式，不降低五核產品 Gate，不開 Sprint 4，不建立新 Product SSOT。**
- **不購買／不部署 Cloudflare Containers 或 Cloudflare Sandbox SDK 雲端私有 Worker**，也不以 Cloudflare 付費 Browser Run 作為本期新作品的必須前提。既有 Workers Free、既有 PostgreSQL/Hyperdrive **在現有免額外付費配額內**可繼續使用，但須先驗證能正常工作，不能推定。
- 使用目前**公開**的 `NFF98/appf2-build` Repository 的**標準 Linux GitHub Actions runner**，Docker `--network none`／cap-drop／no-new-privileges／memory/cpu 限額做隔離建置，另一個可信 Chromium 程序根據原始需求逐項驗收；**只在 CI 受限環境處理不含秘密的程式原始碼**，不能把不受信任的 AI code 在 GitHub 主 Runner 或 Cloudflare Worker 同權限執行。
- 既有 `sp35-agent-foundation.yml` 免費測試是**可信 fixture**，不是任意新 AI 生成專案的雲端驗收。把生成專案交給隔離 CI runner、取得來源 digest／QA packet、回寫既有 PostgreSQL→v2 發布／卡片**目前仍未接通**；在真正部署且證明同一 Job 之前，C1–C5 full-chain E2E 仍為 **0/5**。
- 已發布的既有 App 直接開啟／使用**不需 AI 再生成**；產品首頁增設可見的免費重用入口。不能把現有單檔卡片當成新多檔案 v2 全端能力。
- 新 AI 呼叫仍可能耗用 **原有 API 額度**；在「不新增費用」要求下，未核對可用預算與每次明確同意前，**不觸發新的付費模型請求**。公開 Repo 的標準 GitHub-hosted Actions 已含免費額度；不使用 larger runner、外部付費 runner、雲端容器或新訂閱。
- 此 Free-only 決議覆蓋本檔早期對「必須是 Cloudflare Container」「D1 要新建 Cloudflare 私有 Sandbox」的敘述，其他受控 Full-stack/DB、獨立 QA、失敗修復、v2 卡片與 0 再生成的產品要求**完整保留**。GitHub CI 通過只是建置階段，不是網站五核 E2E PASS。

**已知本輪根因**：前次 [Foundation run #41167865524](https://github.com/NFF98/appf2-build/actions/runs/41167865524) 在 Chromium reload 後的「繼續已保存工作」按鈕被新增的三項獨立授權正確禁用，測試沒有補齊授權便按下造成 timeout。已在原 E2E fixture 補齊三種授權與明確取消再驗的反向用例，**保留產品端防扣費安全檢查**。

## A. 唯一產品終點：五核閉環與 App 卡片

使用者輸入自然語言，不需要會程式；一套**通用、沒有 App 類型特例**的 AI Code Builder 自主生成真實多檔案前端／互動邏輯及需求所需的受控後端／資料庫；Blueprint v2 綁定不可變的建置產物、版本身分、權限、資料參照和分享身分；Cloudflare 隔離 Sandbox 實際建置，獨立 Browser QA 對原始需求逐項操作，失敗保存診斷→AI 修復→重建→再測；成功才在產品內建立可操作 App 卡片。建立者可保存／重開／明確同意分享，接收者可重開同一個核准版本，**不再次付生成 AI 費用**。

### 必驗五項（不可任選子集冒充全部完成）

| 項目 | 真實產品 Gate | 不能冒充的東西 |
| --- | --- | --- |
| C1 多檔案／Full-stack | 真模型從兩種非模板的自然語言生成多檔案；至少一個含**實際受控後端＋DB**，經 Browser CREATE/READ/UPDATE/DELETE、刷新後資料仍存在；前端功能真能互動 | 靜態 HTML、只有 API 路由文字、平台自己的 Job PostgreSQL |
| C2 保存／接續 | PostgreSQL 保存 Job 原文、版本化來源檔、checkpoint、已付呼叫／工具收據；關站後恢復**同一 Job** 並接續；完成作品以卡片重開、同 hash 0 再生成 | 本機暫存、下載 ZIP、登入後的 Phase 2 永久資產庫 |
| C3 Sandbox | **免費路線 GitHub Actions 隔離 Docker** 對**實際 AI 寫的原始碼**真實 build/test，留下 exit、hash、診斷、限權與產物證據 | 可信 Docker fixture／Wrangler dry-run／HTTP 200 |
| C4 QA／自動修復 | 獨立 Chromium 根據原需求在實際 App 做操作與資料驗證、截證；失敗→模型修復→重編→整套 QA 重測；必備 FAIL／UNTESTED 不能宣稱通過／發布 | 模型自評、只看字串改變、F02 hash PASS |
| C5 有限重試／換策略 | 失敗資料保留且可讀；重複失敗辨認無進展並改修復方法、經核准加步數／預算後接續，未知付費結果不重送；狀態如實回報 | 無限 Retry、自動換未授權模型、假「100%」 |

**Blueprint v2／卡片共用出貨 Gate**：AI source→可信 build manifest／artifact bytes→F02 v2 受控 admission→明確建立者分享同意→F05 一個 LIVE/ACTIVE share reference→另一個乾淨 Browser 取得**同一 hash**並操作；刷新、原卡重開均 0 AI 生成呼叫。版本需不可變且原版本不被覆寫；不做 Phase 2 帳號家族歷史管理。

**Phase 界線**：Sprint 3.5 交付 C1–C5 + 上述**基本** v2 可用卡片／F05 Share／Restore；Phase 1 舊 v1 F05/F06/F16 保留且另列原驗收缺口。Phase 2 F08 帳號級 Save/History/Ownership、F10 Semantic Reuse，Phase 3+ 進階服務／商業，Phase 4+ Evolution **不納入本期**。基本 App 卡片保存不得宣稱「永久／跨裝置所有權」，實際有效期限與授權需要在 UI 明確告知。部署 Profiles 未核准前不直接開放生成程式任意 SQL、任意外網、APPf2 secret 或平台 DB。

## B. 真實 BLOCKER（依最早故障 Hop 修復）

| ID | 最早可確認現況 | 本次動作／解除證據 |
| --- | --- | --- |
| B01 雲端能力與部署 | Cloudflare 唯讀訂閱 GET 回 HTTP 403，**方案／權限未知**；PR #419 的 Staging private Agent services 是選配，不能因 CI SUCCESS 認為已佈署 | 唯讀查授權／既有 Staging Worker、service binding、Container、Browser；明確分成 CREDENTIAL／ENTITLEMENT／DEPLOYMENT／ROUTE；有實際 worker route 與 broker 回應才解除 |
| B02 真 AI／PG／模型接線 | 多檔案 foundation test 使用 mock／trusted source；未證明 AI→DB→cloud container 同一 Job | 真 Staging Request ID、模型收據、owner-scoped PG project hash／資料庫讀回、可重播 Job 進度 |
| B03 真 Sandbox＋QA | 私有 Worker 定義與本地 Docker／Chromium 通過，但無新 Agent 的完整 paid Cloud E2E PASS 證據 | 模型新生成的多檔案 build/test 收據與原要求逐項 Browser QA PASS/FAIL |
| B04 v2 發布斷鏈 | Agent 僅有私人 candidate，Worker 回 `app_published:false`；現有 `code-artifact-v2.ts` 仍是單檔 prototype | 多檔案 compiled artifact 以不可變 manifest/version hash 存放，F02 v2 read/admission 通過後可建 LIVE card；不能 QA 過就自動分享 |
| B05 卡片／分享／重用 | 舊單檔 `/code/:id` 是另一條已實測路；新的多檔案 Job 尚未接 F05 正式可操作卡片 | 建立者同意 Publish→實際新分享連結→乾淨瀏覽器操作／刷新→0 new model calls，同版本 hash |
| B06 真後端／DB | 新 Agent 的 Sandbox profile `VITE_WEB` 可建置，`NODE` 目前只有受控測試；對外執行的 generated backend／DB Profile 尚未具備 | 設計受限 server function／受控 DB 權限與工作隔離，真實 App CRUD／驗證越權拒絕；**這是本期必要 GAP，未完成不能報五項 PASS** |
| B07 長任務／策略 | Journal/CAS/step budget 已實作，完整雲端中斷接續、重試後根因切換的真實流程未驗證；Agent model 適配目前單一 Provider | 真雲端中斷恢復，同 Job 不重複計費；失敗根因改方案且重新通過；模型切換必須另有明確核准，不能冒充既成能力 |
| B08 正式發布 Gate | Design #45/Build #419 都未合併，main 的 Sprint/Release HOLD，部分 legacy CI/Governance checks FAIL | 單獨列治理／發版阻斷；不可用舊 16P 強迫產品繞圈，也不能擅自 Merge／Production 發布 |

## C. 固定「4 次交付關卡」與「2 輪集中修復」

**總規劃 4 個交付節點：D0 查證、D1 修復、D2 修復、D3 真實驗收。**
其中 **實際程式集中修復最多 2 輪（D1、D2）**；D0 不動產品碼，D3 不變更功能、只做獨立真實驗收。**4 次是計畫節點，不是「保證 4 次便修好」；若遇硬性外部權限、費用或安全契約障礙，必須停止、保留已完成成果、明列需要的授權或缺口，不能偷偷追加第三輪修補。**

| 關卡 | 工作範圍／允許的變更 | 交付必備可觀察證據 |
| --- | --- | --- |
| **D0 / 1 次：真實阻斷定位（唯讀）** | 查 Design/Build 精確 HEAD、Staging 實際 URL、Worker route、Cloudflare private Broker/Browser binding、AI／PG／費用權限；依 Browser→Worker→AI→PG→Sandbox→QA→Card 排出**第一個**失敗 Hop。既有 evidence 可用就不付費重跑 | Root Cause Sheet：首個失敗點、URL/status／脫敏 Request ID、證據、最多修復兩輪清單和初始 C1–C5 NOT_DONE |
| **D1 / 第 1 輪集中產品修復** | **只**對 B01/B02/B03 的第一個真實失敗 Hop 施工；**用隔離 GitHub Actions Docker＋Chromium 取代需付費的 Cloud Containers**，接新 AI 多檔案、PG checkpoint、QA／修復證據，不重寫原引擎；對 B06 提交受限後端／DB Profile 實作所需安全契約 | 同一 Staging Job 真的 source→PG→隔離 CI Docker→獨立 Chromium QA→預覽可操作，保留 source SHA 和 before/after；若後端 Profile 尚未通過，C1 仍 NOT_DONE |
| **D2 / 第 2 輪集中產品修復** | 在 D1 證據上**只補實際未完成**的 B04/B05/B06/B07：完成受控後端＋DB；v2 build artifact/admission→卡片／基本分享／重開；Job 中斷續作／失敗策略；不做 Phase 2 資產帳號或新引擎 | 一個新多檔案 full-stack App 真 CRUD；已核准 Share 能另瀏覽器操作且重開 0 AI；故意不合格的候選不發布；同源及 hash／權限比對 |
| **D3 / 1 次：正式 REAL E2E 驗收（不修功能）** | 同一 Build HEAD、Staging 主網址跑 2 個自然語言 Prompt、1 個負面越權場景、1 個中斷復原及 1 個分享重開；保留獨立截圖／logs／收據。必要時跑相關完整 CI、安全測試，不把治理 PASS 當產品 E2E | 真實產品 C1–C5、v2 卡片每項 PASS/FAIL/UNTESTED，受控費用、可核查來源 hash、部署版本；全部 PASS 才標 **SP35 FIVE-CORE PRODUCT REAL E2E PASS** |

**D0 失敗或成本／Cloudflare 403／service binding 不確定時，不得跳過 D0 開始 D1 盲修。** D1/D2 任一輪沒有實測 before/after 改善，即立即 HARD STOP；D3 未過不新增第三輪，向使用者報告精確剩餘阻斷並等待新的明確決策。

## D. Acceptance case 固定，不以 Fixture 代替

- **AC-01 任意創意／骰子**：人話提出「做一個漂亮的十八啦骰子遊戲，四顆骰子、擲骰動畫、規則判斷、計分、重來」；同一通用 Agent 生成多檔案。真實 Chromium 逐步驗證四骰／具可重現測值的規則／分數／重新開始、操作前後狀態。規則有歧義需先顯示約定，不得捏造 PASS。
- **AC-02 全端／DB**：人話提出「做能新增、編輯、完成與刪除待辦的 App，資料存到後端資料庫，重新整理還在」；驗證真正 server function／受控 DB 的 CREATE→READ→UPDATE→DELETE→重新整理、不同使用者隔離。沒有安全後端 Profile 就維持 BLOCKED。
- **AC-03 App 卡片**：AC-01/02 通過獨立驗收後，建立者同意分享、完成 immutable v2 admission；本瀏覽器 Home→卡片→Open、刷新，另一個新瀏覽器持分享 URL 開啟且正常互動；trace 證明 re-open **0 新 AI 生成請求**，同版 hash 不變；沒有默默暴露建立者的資料。
- **AC-04 中斷／預算**：建立 Job 中途斷線／新分頁重新讀回原 project hash、檔案、step、receipt；超預算 PAUSED 可申請擴充；未知 paid request 絕不自動重送，重複三次沒改善會分析根因及換策略（仍受每次批准的預算限制）。
- **AC-05 負面／安全**：模擬生成程式惡意 fetch/secret/SQL、跨使用者讀取、竄改 artifact hash、QA FAIL／UNTESTED、創作者未核准 Publish，全部拒絕且無任何公開 ACTIVE 卡片。

最少兩個**不同** App 類型成功、其中一個真實 full-stack；任何 required acceptance 未通過，**產品 100% = NO**。不可拿「本機 Docker 能編譯」或 GitHub Actions Foundation SUCCESS 替代以上測試。

## E. 授權、成本與狀態寫法

- 不合併 Design PR #45／Build PR #419、不部署 Production，除非取得明確授權；原 main HOLD 不偽造解鎖。
- Cloudflare Container、Browser Run 及 API AI 可能付費；只在可驗證權限與單次費用上限、使用者明確同意下執行。未核准時可做不收費的唯讀定位／本地測試，不得假稱 cloud PASS。
- 計畫每輪原位更新本檔 **F. 執行交接紀錄**，寫入真實 GitHub SHA、測試 URL／request、成本和唯一首要 BLOCK；不把假定進度當證據，不重問人類已提供的需求。
- 原 user 指示「五項改造完成到產品」優先於舊 16P 治理繞圈；但安全隔離、資料權限、顯式付費同意與真實驗收不可省。

## F. 三日成果保全基線（2026-10-28～31，**不得歸零或重寫**）

本節是已提交程式與實際測試的「已做工作清單」，**不是 C1–C5 全部產品驗收 PASS**。跨對話／下一輪必須先讀這裡與現行 GitHub HEAD，再只補未接上的產品能力，不能重新造五項引擎。

| 日期／已做成果 | 現存程式／驗證（保留利用） | 真實產品邊界 |
| --- | --- | --- |
| **10/28 舊單檔 Code Builder 真 Staging** | [run 40661201647 SUCCESS](https://github.com/NFF98/appf2-build/actions/runs/40661201647)，Staging Worker + PostgreSQL + Browser；logs 確認 `CODE BUILDER REAL STAGING PASS`、公開 LifePilot／Moving 卡片開啟互動／刷新／直連無重生；一個 notes 線上模型生成 QA／公開驗證通過。這條舊單檔產品鏈不能拆掉。 | 這不是「多檔案 AI → Cloud Container → 完整後端／DB → 新 v2 卡片」整鏈成功。 |
| **10/29 多檔案 AI Agent 基礎** | PR #419 已有 `src/platform/agent/project-workspace.ts`、`durable-agent-service.ts`、`postgres-project-snapshots.ts`、`journaled-model-gateway.ts`、`src/edge/agent-model-*.ts`、`agent-sandbox-run.ts` 等。含 PoP 簽名、檔案雜湊／CAS、工具調用、付費 at-most-once 收據、預算接續、編譯錯誤續作。[run 40874813214 SUCCESS](https://github.com/NFF98/appf2-build/actions/runs/40874813214)。 | 此為已開發程式和 free/offline 反覆驗證，**當時付費 Cloud E2E 跳過**。 |
| **10/30–31 真實測試／QA 基礎** | PR #419 已有 Cloudflare private Sandbox/Browser Worker 定義、獨立 QA plan／review／run、QA 失敗後模型修復、progress／preview、`src/app/code-builder/AgentBuilderPanel.tsx`。 [run 41163976209 SUCCESS](https://github.com/NFF98/appf2-build/actions/runs/41163976209) 的實際日志包括 network-denied Docker Vite + Chromium、signed independent QA，以及 Agent Browser-wire mock E2E。 | 官方日志明示 `NO AI, NO CLOUD SANDBOX` 或 `MOCK QA/MODEL`；不得稱五核 Cloud E2E PASS。 |
| **仍未接完** | 新 Agent `src/edge/agent-qa-review.ts` 回 `app_published:false`，多檔案候選與舊 `/code/:id` 的分享／重開鏈分離；受控生成後端／DB 尚缺；Cloudflare subscription readonly 查詢 403／部署可用性未證實。 | 這是**在保留全部前三天成果的前提下**要處理的 B01–B07，不是從零重做。 |

**實際下一步**：先查「哪一段已能在真 Staging 使用」，沿用 10/28 成功的單檔 F05／卡片、10/29–31 新 Agent Journal／Sandbox／QA 程式，**只接新多檔案→可信建置/QA→v2 分享卡片與受控後端**。未找到第一個 live 故障 Hop 前，不修改五項核心的正常部分。

**口徑更正**：以前交接把 D0–D2 全標 `NOT_RUN` 造成「三天歸零」誤解。D0–D3 只指**這份收尾計畫尚未完成的專項驗收**，不代表 10/28–31 的功能、Git commit、Staging 真實歷史、測試都沒有完成。另需在每次交接同時報「已存在的工程資產」及「剩餘產品驗收」。

## F.1 本輪 D0 直接觀察（2026-10-31）

- 已核對既有真 Staging [run 40661201647](https://github.com/NFF98/appf2-build/actions/runs/40661201647) 在 **2026-10-28** 部署舊單檔路線，健康 GET JSON 200 並有真 AI／PG／Browser 卡片 PASS；不能證明 **2026-10-31 新 Agent** 已佈署。
- 新 Agent 原始碼確實在 PR #419 HEAD；Staging 發版 Workflow 需要獨立 `workflow_dispatch`、私有服務選配 `APPF2_STAGING_AGENT_PRIVATE_SERVICES_ENABLED=1`、模型部署開關，**GitHub push 不會自動佈署**。沒有真實 URL／request 證據前，不能把新五核標 E2E PASS。
- Cloudflare [readonly check 41166333586](https://github.com/NFF98/appf2-build/actions/runs/41166333586) SUCCESS 僅代表無付費的查詢流程執行；訂閱 API `403` 不等於 Workers 訂閱未開通。
- 外部觀測接口目前無法直接連到 Staging（工具回網路／DNS 不可及），**不是**證明 Staging 本身離線。已在既有免費 `sp35-cloudflare-readonly.yml` 增加 GitHub runner 的**只讀** Staging `GET /api/v1/health` 及 Cloudflare Scripts 列舉檢查；不觸發佈署、付費 AI、容器或 Browser。
- 本輪查到可重現於 [CI 41166333596](https://github.com/NFF98/appf2-build/actions/runs/41166333596) 的非產品核心回歸：427 API PASS、單一 2 MiB 編譯資產深度比較超 5 秒。將 Vitest 巨型 typed-array deep diff 改為**逐位元組 native Buffer equality**，保留真正 bytes 不變；需以新的 GitHub run 再驗證。**這只修工程測試信號，不冒充產品 E2E 改善。**

**最早尚未排除的產品 BLOCK**：目前 Staging 是否跑到新的 Agent API、是否具備私有 Sandbox/QA Worker binding，與真 AI/PG 可用證據。待上述只讀結果排除後才啟動任何需授權的雲端測試／集中產品程式修復。

## F.2 D0 真實 Cloudflare Read-only 結論，D1 付費前保護

- 真實 GitHub runner [run #41167547686](https://github.com/NFF98/appf2-build/actions/runs/41167547686)：`SP35 STAGING LIVE HEALTH: PASS_JSON_UP`；`SP35 STAGING AGENT CODE: NOT_VERIFIED_HTTP_404`；`SP35 WORKER appf2-sp35-private-sandbox: NOT_LISTED`；`SP35 WORKER appf2-sp35-private-browser-qa: NOT_LISTED`。兩個私有服務**並未出現在可讀的 Workers script 清單**；未證明帳號無法部署，Cloudflare plan read `403` 仍是 UNKNOWN。
- D0 已確認目前**舊 Staging Worker 正常，新多檔案 Agent 版尚未有部署證據**。不要再重做前三天原有 Agent/Journal/Sandbox/QA 程式。
- D1 第一道產品修補已在 PR #419：新增 `GET /api/v1/agent-readiness`（不呼叫模型／DB／容器）；`AgentBuilderPanel` 新建前要求 AI、Sandbox、Browser QA 三種分開核准，並驗證完整服務設定；不存在新版 API、缺授權或缺私有服務時**先停止，不建立付費 App Job**。現有候選／續作相關權限仍依原 PoP 與 Budget。
- Staging 專用部署腳本將新的 `APPF2_AGENT_MODEL_EXECUTION_ENABLED` 與私有服務條件一起鎖住：未配置 Cloud Sandbox／QA 不會先啟用付費多檔案模型。此改動不影響舊單檔 F01/Code Builder。
- 這些是**程式與真實 Read-only 證據**，不是新 Agent cloud AI／Container／Browser QA 通過；完整五核產品 E2E 仍 **0/5**。

**下一個硬阻斷**：須驗證 Cloudflare Sandbox／Browser QA 私有 Worker 實際部署與 Service Binding、受控付費權限，及新版 Staging API；沒有明確授權不自動執行可能付費的 Container/Browser/AI 測試，也不合併／正式發布。

## F.3 免費方案真實產品與 CI 證據（本輪）

- **免費入口已實作於 PR #419**：`src/app/discover/DiscoverScreen.tsx` 提供「免費試用：已公開 App（不使用 AI）」直接導向既有公開 App 卡片，不產生新 AI 呼叫。此新版首頁目前只在未合併 PR，**未部署 Staging**。
- **真實 Staging 舊單檔 App 免生成重用 PASS**：[GitHub Actions #41168625022](https://github.com/NFF98/appf2-build/actions/runs/41168625022)（2026-10-31）在兩個全新 Chromium context 開啟實際已發布 Code App `32205d58-b07f-4e8d-9d0c-4881178b02d4`，實際按鈕操作＋刷新；GET-only；0 模型／0 DB 寫入。這**只證明舊 Code Builder 分享重用，不是 C1–C5 新版全鏈 PASS**。
- **隔離免費建置替代已切換**：`.github/workflows/sp35-agent-foundation.yml` 的 **標準 Linux GitHub Actions + network-denied Docker + Chromium** 路線保留，Cloudflare 付費 Sandbox/Browsers 的選配打包步驟已從該路線移除；不用 Cloudflare Workers Paid、Container 訂閱或任何新雲端付費服務。官方 Repo `NFF98/appf2-build` 經 GitHub API 確認 `public`。GitHub 公開 Repo 標準託管 Runner 依平台政策免費；不用 larger runners。
- **兩個回歸逐項修正**：原 `run #41167865524` 因多了一次同意要求而 disable 續作按鈕；`run #41168471420` 因重新進站直接勾選 QA 同意，使 Worker 自動提前進入 QA。現改為**新 App 三項獨立同意、已保存 Job 續作只需 AI＋容器同意、不自動啟動 QA**，QA 另行核准；安全阻擋不關閉。最後的 `run #41168708630` 停在新 GET-only 腳本 ESLint `AbortSignal no-undef`，已更正；**最新 CI 結果須另查，未完成前不可標 PASS**。
- **產品五核 C1–C5 仍為 0/5**：缺「真 AI 生成多檔案 → 既有 PG checkpoint → 安全傳到無秘密 Runner Docker → 真獨立 Browser QA → 回傳同 hash 受控 admission → v2 卡片與後端 CRUD」的單一 Job 真實整鏈；目前免費路線 Runner 的多檔案 Docker＋Chromium 仍為**可信 fixture**。Cloudflare Container/Browsers 不再是本期阻斷；須補的是**免費 Runner／產品 Job 安全接線和 v2 發布**。
- **費用總結**：本輪沒有部署 Cloudflare Containers/Browser Run，沒有呼叫付費模型 API，沒有合併 PR 或正式部署；僅使用公開 Repo 的標準 GitHub-hosted Actions 免費運算與對既有 Staging 的唯讀 GET。

## F.4 Free-only Docker image / 最新 SUCCESS（2026-10-31）

- [run 41168878799](https://github.com/NFF98/appf2-build/actions/runs/41168878799) 在 Build `ddbb0f4` **SUCCESS**：TypeScript、Lint、API／Runtime、原 UI signed Agent mock、Docker Vite＋真 Chromium QA 全 PASS；不等於真人 AI 原始碼的完整五核 E2E。
- 免費 Runner 已新增 `deploy/free-ci/Dockerfile`，**以 node:24-trixie-slim 直接建立，不引用 cloudflare/sandbox image 或 shim**，原 Docker 隔離、網路禁止、cap-drop、CPU／RAM 限制保留；`sp35-container-fixture-e2e.mjs` 已改使用這個免費專用 image。
- 不會重做已 PASS 的 Agent/Candidate/DB checkpoint。尚未解決的是**將真 AI 多檔案 Job 安全交給 Actions CI、從可信 Runner 將原始需求 QA/成果回寫到相同 Job／v2 卡片**，並實現受控生成後端 CRUD；不可因換 Docker image 便宣稱 C1–C5 已完成。
- 所有變更仍僅在 PR #419，沒有 Staging 新 Agent 正式部署、Cloudflare Containers 訂閱、付費 Browser Run 或新 AI 成本。要查本輪新 Docker image 的 Action SUCCESS 後才能標本次 IMAGE PASS。

## F.5 免額外費用產品斷點修復／失敗證據（2026-10-31）

- Build `fe93a4d5` 起新增**通用 ProjectSnapshot→Docker source 接口**：`deploy/scripts/sp35-free-ci-stage-project.mjs` 驗證每個檔案和整體 project hash、限制 VITE_WEB、檔案數/大小與路徑，阻擋 `vite.config`、`package.json`、`tsconfig` 等任意建置設定。Docker `deploy/free-ci/Dockerfile` 僅含固定 Node/Vite/TS，`build-locked.mjs` `configFile:false` 不載入專案自行提供的 build plugin；Docker runtime `--network none`/cap-drop/CPU/RAM/非 root，Docker image 的 build context 已限縮 `deploy/`。**目前是可信 fixture 借用驗證通用接口，真 AI Job 串流仍未實測**。
- Build `3f3c70e`、`64aca9775`、`3041f8ad6` **對產品費用強制 Free-only**：Staging `APPF2_AGENT_FREE_ONLY=1`，API 新增 server-side paid model、sandbox、Browser QA 拒絕，免費 CI 安全 Job 傳輸尚未接通前 readiness 返回 `FREE_CI_NOT_CONNECTED`、`can_start_paid_generation:false`。**已有 Cloudflare 金鑰/舊選配旗標也不能偷偷觸發新 Agent 付費路線**；若部署指令仍要求私有付費 Worker 會 fail closed。
- 前端文案改為「GitHub Actions 免費 Docker／Chromium」而非「Cloudflare Container 付費核准」，且只接受 `FREE_CI_READY` 明確可用訊號；Worker 暫時**不能**宣告該信號。這是費用安全與清楚告知，**不代表可以在網站新建所有 App**。
- 最新本輪 [Foundation #41169697284](https://github.com/NFF98/appf2-build/actions/runs/41169697284) **FAILED at Lint**：`sp35-staging-only.mjs` 的兩個 Cloudflare 選配殘留變數 `sandboxEnabled`、`qaEnabled` 未使用；已移除以保留 Free-only 配置，待新的 GitHub runner 重驗。此前 [Foundation #41168878799](https://github.com/NFF98/appf2-build/actions/runs/41168878799) 全步驟 **PASS**（舊可信 Fixture Docker+Chromium；非新 Agent 實際生成）。
- 現在**唯一下一個產品 Hop**：既有 Worker／PostgreSQL 的創作者簽章 Job 用**不暴露來源與密鑰**的通道派發至免費 CI Docker，安全收取同 Job source hash／artifact manifest／獨立 Browser QA 可信收據，接 Blueprint v2 admission／基本 F05 卡片；同時完成受控後端＋資料庫 CRUD。尚未具備正式 secure job dispatch／runner receipt 時不可開啟 `FREE_CI_READY`，也不能把 0/5 假升級。
- 本輪無 Cloudflare Containers、Browser Run、付費模型請求、新訂閱、Production 部署；PR #419 仍 Open。

## F.6 免費 ProjectSnapshot→Docker→獨立 Chromium 已正式驗證 PASS（2026-10-31）

**同一 Build SHA `7763163281c482737ce2c780128144cfe61a0e55` 的新 GitHub Actions 證據：**

- [免費 Foundation #41169846578 — SUCCESS](https://github.com/NFF98/appf2-build/actions/runs/41169846578)：Typecheck、Lint、平台編譯、API（76 個 test files PASS、8 skipped）、Runtime（12 files PASS）、P-256 Agent 前端 Mock QA／一次修復、**驗證來源 ProjectSnapshot 雜湊→固定免費 Docker Vite 建置→真實 Chromium Click→獨立 Browser QA＋HMAC 驗證**皆 PASS；測試 logs 顯示 `SP35 VERIFIED PROJECT SNAPSHOT → FREE LOCKED DOCKER VITE: PASS`、`SP35 INDEPENDENT DOCKER + CHROMIUM QA HMAC VERIFIED: PASS`。原始碼仍來自**可信 Repo Fixture**，沒有真模型、沒有真創作者私有 Job 提交／發布，**不能**算 C1–C5 任一完整產品 E2E PASS。
- [真實 Staging 免費重用 #41169846623 — SUCCESS](https://github.com/NFF98/appf2-build/actions/runs/41169846623)：舊單檔 Code App 在兩個全新 Browser Context 直接使用、點擊、刷新，**沒有新 AI／沒有 DB 寫入／沒有新雲端容器**。舊版功能已證實，與新五核驗收分開。
- [Cloudflare 唯讀 #41169846555 — SUCCESS](https://github.com/NFF98/appf2-build/actions/runs/41169846555) 不代表完成 Agent 新版部署；目前依 Human 指示**不再要求 Cloudflare Containers/Browsers Paid**。
- Legacy `CI Gate`、Governance、CodeQL 現有 Workflow 因 Human Task 授權預檢失敗；**不把這些既有治理 FAIL 當作免費 Docker Sandbox 的產品失敗，也不擅自關閉安全測試**。上列專項 Foundation 獨立 PASS 可驗。

**目前唯一真正產品閉環未完成：** 將真正自然語言 AI 生成的**私有**多檔案 Job 由既有 Worker/PG 安全派發至免費 Runner（不能把原始碼或 token 暴露在公開 Actions Logs/Inputs），由可信 Runner 隔離建置與獨立 Chromium 對原需求測試、可信 hash／QA 收據回寫原 Job，接 F02 v2 immutable admission、F05 受同意分享與可重開卡片。另需完成受控 generated backend／DB CRUD。**Secure Job Transport 尚未實作，所以 Worker 唯讀 readiness 必須顯示 `FREE_CI_NOT_CONNECTED`，前端不可提前扣 AI 費**。

**結果口徑**：免費 Docker 工程鏈 verified PASS；**真實線上新五核 C1–C5 = 0/5（0%）**；舊單檔真產品重開 = PASS；本輪沒有新付費訂閱／Container／Browser Run／模型 API 呼叫，沒有合併或發布 PR。

## F.7 2026-10-31 已真實部署 Staging — Cloudflare Containers 零新增費用

**已完成，不可再寫成「新版 Agent 尚未部署」或「Staging Agent API 404」。**
- **部署來源**：Build PR #419 commit `3e6bd0ac70bbf9803b034cea3ce3fe4e26e07af4`；真正 GitHub Actions [run #41170638897 — SUCCESS](https://github.com/NFF98/appf2-build/actions/runs/41170638897)，job `124447660757`，`wrangler@4.135.0` 實際上傳 `appf2-sp35-417-staging` Worker／SPA，無合併或正式 Production 部署。
- **真實同源網站**：[https://appf2-sp35-417-staging.juiyuang69.workers.dev](https://appf2-sp35-417-staging.juiyuang69.workers.dev)。同一工作流實測 `GET /api/v1/health` **200 JSON UP**、`GET /` **200 SPA**、無簽章 `POST /api/v1/intents` **400/F01-ERR-001**（安全拒絕正確）。
- **新 Agent first hop 已解除**：`GET /api/v1/agent-readiness` **HTTP 200**，`execution_mode=FREE_CI_NOT_CONNECTED`、`can_start_paid_generation=false`。**這是正確部署 + 成本保護，不是完整免費 AI/CI Agent 已可生成**。
- **真實 PostgreSQL 第一次產品 Job 驗證 PASS**：`sp35-live-agent-db-smoke.mjs` 以真正 P-256 簽章 `POST /api/v1/agent-jobs` **HTTP 201**，建立 4 檔案候選、資料庫保存，再簽章 `POST /api/v1/agent-jobs/:id` **HTTP 200**，讀回相同 Job/hash/source；沒有呼叫 AI 或 Container。Run 日誌：`SP35_PRODUCT_REAL_DB_PASS`。
- **零新增費用部署**：沿用 Cloudflare 帳號已存在的 3 個 Hyperdrive，沒有建立任何新 DB／Cloudflare Container／Browser Run／訂閱或 AI 模型呼叫；Staging 專用部署 `APPF2_STAGING_FREE_ONLY_NO_AI=1` 使用不可用的模型憑證，關閉付費新生成，且移除 Cloudflare Browser Run binding。公開既有 App 可重開的能力需保留，**Staging 上新 AI 生成暫時刻意停止**，避免超出使用者核准費用。
- **前次失敗與修正**：[run #41170526299](https://github.com/NFF98/appf2-build/actions/runs/41170526299) 首次部署因缺少現有 `@cloudflare/puppeteer@1.1.0` 打包依賴，在 Wrangler 上傳前 FAIL；於同一 PR workflow 增加固定版依賴後 [#41170638897](https://github.com/NFF98/appf2-build/actions/runs/41170638897) 完整 SUCCESS。
- **E2E 口徑**：**Staging 部署 + Agent/API + 真 PG Job CREATE/REOPEN 已 PASS**；新五核完整生成／安全免費 CI Docker／QA receipt／v2 發布、分享、真 generated backend DB CRUD 尚未同一 Job 驗收，因此 C1–C5 full acceptance **仍 0/5**。下一個 blocker 已從舊 `404/未部署` 轉為**`FREE_CI_SECURE_JOB_TRANSPORT_NOT_CONNECTED`**。不要再重查「Staging 是否部署」；直接補安全 Runner 派發與獨立 QA／immutable card 寫回。

## F.8 私有 AI 原始碼→免費 Docker 自動派發（2026-10-31，本輪實證）

- **已提交至同一 PR #419（未合併）**：既有 Worker 新增 `POST /api/v1/agent-jobs/:job/free-ci-dispatch`，需要建立者 P-256 簽章、額外同意、真 PG Job 已至少 revision 2；只把帶有 Job/owner/project_hash 的 **AES-GCM 加密短效 ticket** 送 GitHub Actions，不傳私有程式碼、prompt 或 API Key。
- **安全 Runner**：`src/edge/free-ci-source.ts` 只接受相同短效 ticket ＋已驗 RSA/JWKS 的 GitHub OIDC（指定 GitHub-hosted、公開 Repo、Branch、Workflow、事件、audience）；GitHub-hosted Linux Runner 先以 OIDC 向 Worker 私下取得 PG 原始碼及核對 project hash，才由禁網路 Docker 固定建置，再在隔離 Chromium 測試。**尚未實際見到真 AI 生成專案自動派發成功／QA 驗收與回寫／Blueprint v2 發布。**
- **實際 GitHub 派發路由修正**：新 `sp35-free-ci-job.yml` 不在 default branch，無法直接當 REST workflow_dispatch target；現改走 **main 已存在**的 `sp35-staging-only.yml`，PR 分支額外 `private-free-ci` job 接 encrypted `inputs.ticket`，`staging` job 要求 **ticket 為空**，避免私人 CI Job 重新部署或啟動 AI；OIDC workflow_ref 和測試契約同步更新。
- **真實免費 Staging 更新 PASS**：[Actions #41172385488](https://github.com/NFF98/appf2-build/actions/runs/41172385488) 在同一 Staging 真正重部署，`GET /api/v1/agent-readiness` **HTTP200**（FREE_CI_NOT_CONNECTED／付費仍鎖住）、`POST /api/v1/internal/free-ci/source` 無授權 **HTTP404 PASS**、真 PG signed CREATE/REOPEN **PASS**；未用 AI、Cloudflare Containers／Browser Run／新訂閱。
- **下一個唯一環境 blocker，已有 runner 日誌確認**：`STAGING FREE CI DISPATCH: GITHUB_CREDENTIAL_NOT_CONFIGURED`。既有 GitHub Secret `APPF2_FREE_CI_GITHUB_TOKEN` **未設定**（該次 Runner 取得空值），故 Worker 無 Actions-write 權限去 POST GitHub `/dispatches`。這不是 AI 產生原始碼不可建置；不可偷偷用 Cloudflare token 或任何公開 API 取代 GitHub Credential。需要在 Repo Actions Secret 安全配置**只具備目標 Repo Actions:write 的 GitHub token**並重跑免費 Staging deploy（已預留 optional Secret 轉入 Worker，值不印出），才能做實際派發測試。
- **E2E 不造假**：最新證明是「私有安全端點部署／PG Job 保存／免費 Docker 工程鏈 PASS」。**尚無**「真 AI 已生成的專案透過 Github workflow_dispatch 在 Runner 收到原始碼、建置、QA、收據回寫、生成可操作 v2 卡片」同一 Job 的證據，C1–C5 五項完整通過維持 **0/5**。本輪不合併、不發布 Production、不新增付費 Cloudflare／AI 呼叫。

## F.9 免費 Docker 自動派發接線修復（2026-10-31，仍需真產品驗收）

- **PR #419 原位程式修補**：Build `131d2fd74a22e7e2977a63ba30f9e8afb7f64faf` 修復 GitHub-hosted Runner 的區域性 `pipelinesghub*` OIDC 取票網址被錯誤拒絕，同時保留 HTTPS／官方完整 host 防 SSRF 檢查；增加 `ghs_` 安裝 Token 格式支援（**只在 Token 仍有效時**，不是可持續免配置的 GitHub App 授權）。
- **部署 Secret 遺漏已定位並修補**：Build `a9088f82d9b98026a82fcf0d6927a7a4fd15d94a` 在既有 `sp35-staging-only.yml` 的部署步驟明確加入 `APPF2_FREE_CI_GITHUB_TOKEN: ${{ secrets.APPF2_FREE_CI_GITHUB_TOKEN }}`；之前即使 Repo Secret 日後新增，部署腳本也讀不到。GitHub `GITHUB_TOKEN` 只在本次 Action 生命週期有效，**不可**假裝為 Worker 持續派發憑證。
- **Workers 取票網路相容性**：Build `2eaee96805eae6961ad9cc6f13a4ccd2897b0bbe` 保留 `globalThis.fetch` receiver，避免重演 F01 曾出現的 Worker native fetch 失敗；API test 加上 receiver 驗證。
- **CI 證據**：[Foundation #41175900436](https://github.com/NFF98/appf2-build/actions/runs/41175900436) 在第一個修補 SHA 上 **SUCCESS**（Types、Lint、API、Runtime、免費 Docker/Chromium 舊可信 fixture、真 Staging signed PG source→Docker）；此 SUCCESS **不**代表最新 Secret 接線已部署、更不代表真 AI 生成後自動 dispatch。
- **目前已知唯一外部設定硬擋**：之前真 Staging 發布日志確證 `GITHUB_CREDENTIAL_NOT_CONFIGURED`。GitHub Actions Repo Secret `APPF2_FREE_CI_GITHUB_TOKEN` 仍沒有「已配置」證據；本次 GitHub 連線不能設定／讀取 Secret 值，不將 Token 寫入原始碼。需僅授權目標 Repo 的 Actions:write 憑證，重新部署 Sprint 3.5 Staging，才可進行真 Job → `workflow_dispatch` → OIDC → PG source → 無網路 Docker → Chromium 的首次完整傳輸驗收。
- **驗收誠實口徑**：沒有新 AI 生成、沒有真 `workflow_dispatch`、沒有同 Job QA receipt 回寫與 v2 admission，也未完成受控 generated backend CRUD；新 C1–C5 端到端 **0/5**。無 Cloudflare Containers／Browser Run 訂閱、新付費模型請求；只改 PR #419，未合併或部署正式產品。

## F.10 第 2 項免費 Docker 派發 — 最新真 Staging 部署及授權阻斷（2026-10-31）

- **部署已實際完成**：PR #419 Build `6c5bbd24bbe65722db813b9aed02015e62350077` 觸發既有 `.github/workflows/sp35-free-staging-deploy-once.yml`，GitHub [run #41176651218](https://github.com/NFF98/appf2-build/actions/runs/41176651218) **SUCCESS**。保留 3 個現有 Cloudflare Hyperdrives、部署同一 Staging Worker/SPA，無新 Cloudflare Container／Browser Run／付費 AI。
- **真實 API**：同一 Runner 驗證 Agent readiness HTTP200、匿名 private source HTTP404、P-256 signed Agent 建立 HTTP201 和同 Job source/hash 重開 HTTP200，日誌 `SP35_PRODUCT_REAL_DB_PASS`。已部署 10/31 免費 CI token 接線、OIDC 區域 host 相容性及 Worker fetch 修補，不代表完整自動派發。
- **憑證實況已確證**：安全 CI preflight 日誌在 run #41176651218 明確輸出 `SP35 FREE CI CREDENTIAL: MISSING; Worker will deny autonomous GitHub Actions dispatch`；Wrangler 部署也輸出 `STAGING FREE CI DISPATCH: GITHUB_CREDENTIAL_NOT_CONFIGURED`。故 Repo Actions Secret `APPF2_FREE_CI_GITHUB_TOKEN` **仍不存在或對該 workflow 不可用**；不是 GitHub Runner 的 Docker build 錯誤。
- **下一個必須外部授權的動作**：在 `NFF98/appf2-build` Repo Actions Secrets 配置僅針對該 Repo、具 Actions:write 權限的有效 fine-grained PAT（不要在聊天或程式碼提供值）。現有 GitHub 應用連接不支援建立 Repo Secret，不能替使用者虛構、竊取或暴露憑證。配置後用已存在的 Staging deploy workflow 重新部署，再用真正已保存且 revision ≥ 2 的創作者 P-256 Job 驗證 `/free-ci-dispatch` → `workflow_dispatch` → GitHub OIDC → PG 原始碼 → network-denied Docker → Chromium。同一條鏈未見真成功前第 2 項仍 **NOT_VERIFIED**。
- **產品範圍**：現時 Staging Free-only 仍阻擋付費新 Agent AI 生成，沒有啟用新模型呼叫；C1–C5 完整自然語言產品端到端維持 **0/5**。本輪未合併、未發布 Production。

## F.11 2026-10-31 最新產品證據 — 先前 F.6–F.10 障礙已有解除（優先閱讀本節）

**注意：F.6–F.10 為當時歷史截面，其中「GitHub Token 未設定」、「FREE_CI_NOT_CONNECTED 才安全」、「免費 Docker 尚未派發」均已過期，禁止重當目前阻斷。**

- **實際 Staging Agent + 真 PG Job：PASS**。免費部署 [#41184306043](https://github.com/NFF98/appf2-build/actions/runs/41184306043) SUCCESS，原始建立者 P-256 簽章保存／重開 Job，無付費 AI／Cloudflare Containers。
- **第 2 項免費派發：PASS（測試建立者手動提供的多檔案程式，不是 AI 產出）**。GitHub Actions Token 已由 Human 安全設定，實際 Worker `workflow_dispatch` HTTP204，GitHub-hosted OIDC 精確驗證，再以禁網路 Docker 建置、Chromium 操作；私人 [Runner #41182117441](https://github.com/NFF98/appf2-build/actions/runs/41182117441) 與 [#41183983219](https://github.com/NFF98/appf2-build/actions/runs/41183983219) SUCCESS。
- **第 3 項同 Job/版本 QA：PASS（測試程式）**。Runner 依開發前凍結的計畫點擊 `dice_button`，觀察 PASS／證據 SHA，透過 OIDC + AES 票券回寫原 PostgreSQL Job。未知／未測需求不能聲稱通過正式 QA；不會自動發布。
- **第 4 項私人建置成果保存／零 AI 重開：PASS**。Staging [#41184306043](https://github.com/NFF98/appf2-build/actions/runs/41184306043) SUCCESS，原 Job 以 P-256 連續讀回兩次相同已建置資產；資料庫查驗已保存 2 份私人 App bundle。這**不是** Blueprint v2 正式公開發布／分享，亦不是 AI 生成通過。私人 asset 表有 RLS；匿名角色無直接 SELECT。
- **本輪產品 UX 修復**：PR #419 提交 `def8412d5bbc3b30c384df68ad9c62560e29c22b`，將真有 GitHub 派發憑證的免費模式從誤報 `FREE_CI_NOT_CONNECTED` 改成 `FREE_CI_READY / CONFIGURED_NOT_VERIFIED`，**同時** `can_start_paid_generation=false`；`c74fc7d1e8f097e597f7ee5040f5c8568f30a403` 讓原建立者點擊私人 App 卡片直接零 AI 開啟已保存的 verified bundle。這些新 UX 改動需以後續完成的新版 Staging CI 作最終確認。
- **真實產品尚未解決的功能**：Staging `APPF2_AGENT_FREE_ONLY=1`，故模型生成和修復**刻意不執行**。缺「原始自然語言→真 AI 多檔案程式→原需求完整 QA 自動修復→Blueprint v2 F02 admission→正式公開卡片與分享」，亦缺生成的真 backend/DB CRUD。不能聲稱 5 項產品驗收全面 100%，但不能把已通過的免費派發／收據／私人保存當作 0%。
- **誠實計分**：四項基礎通道：部署 PASS；免費 CI 派發 PASS（固定輸入）；私有 QA receipt PASS（固定輸入）；私人重開 PASS。完整 AI 自主端到端單一鏈 **0/1（NOT_VERIFIED）**，不是「所有四項工程 0/4」。只在真 AI 生成、完整 QA、正式分享皆通過**同一真 Job**後改為 PASS。
- **硬限制不變**：僅 PR #419，不合併／Production，不新增費用或付費 Cloudflare Containers/Browser Run，不編造 AI 成果；若要真 AI 實測，須有明確的既有零新增費用供應或 Human 新授權，不能自行呼叫付費 API。

## F.12 2026-10-31 真付費 AI → 免費 Docker → Chromium QA → 私人 App 首次 E2E PASS

**新實測成功：同一個原始 Job，真正由 OpenAI 生成程式，不是 fixture。**
- [付費模型 + 原建立者 Job + E2E GitHub run #41188277779 — SUCCESS](https://github.com/NFF98/appf2-build/actions/runs/41188277779)：Runner 日誌顯示 `SP35 REAL PAID AI: OpenAI Responses status=completed, model=gpt-4.1-mini, output_tokens=376`，真正生成 `src/main.ts`、`src/style.css`，P-256 owner 寫入 PostgreSQL revision2，Worker 正式 `workflow_dispatch` HTTP204。
- [真實 GitHub-hosted Runner #41188359539 — SUCCESS](https://github.com/NFF98/appf2-build/actions/runs/41188359539)：GitHub OIDC 身分驗證、原 Job source hash→network-denied Docker Build→Chromium 真 click。凍結原需求驗收 `increment_button` 為 `PASS`，含 SHA 證據；PG 同 Job 收據 run_id `41188359539`，私人 App bundle 保存。原作者用 P-256 重開同一份字元內容兩次，無重新生成。
- 同輪一個先前 **實際付費模型請求**因輸出格式不符合多檔案 schema 受到拒絕，之後改用官方 OpenAI Responses `text.format=json_schema` strict 成功。第一個測試語法錯誤發生在模型呼叫前。這次共見證兩次已完成的模型回應，實際帳單金額需查看 OpenAI billing，**不要宣稱精確費用或零費用**。
- **這個 PASS 的精確範圍**：自然語言 → 真模型生成兩檔案 → P-256 原 Job 保存 → GitHub Actions/OIDC → 免費 Docker/Chromium 按鈕「加一」實測 → immutable PG QA 收據 → 私人 App bundle 零 AI 重開。是一個小型互動計分 App 的**真 AI→私人可操作 App 端到端 1/1 PASS**。
- **不是五核產品全面 PASS**：本次模型由受控 GitHub workflow 呼叫，再用建立者簽章匯入 Job；正式網站上輸入任意需求後全自動呼叫模型、持續自行修復、後端/資料庫生成、Blueprint v2 F02 admission／公開卡片、他人分享 **均未在同一鏈驗證**。現有 `APPF2_AGENT_FREE_ONLY=1` 的網站正式付費 Agent 按鈕仍被安全鎖住，不應說已解鎖。
- **成本及授權保護**：本次限單個 gpt-4.1-mini Responses 請求，每次最多 3200 output tokens，無額外 Cloudflare Containers／Browser Run 訂閱，未合併或部署 Production。完成後 workflow 另加嚴格 commit-message opt-in marker；一般 Push 無法再觸發付費測試，避免重複扣款。原本工程安全／CodeQL Gate FAIL 與本次專項模型 E2E SUCCESS 應分開呈報。

## F.13 2026-10-31 GPT-6 模型、付費保留 RLS 與真正網站 E2E 斷點（同一既有 SSOT 原位續記）

> **此節優先於 F.6–F.12 的歷史「下一阻斷」敘述，但不重寫它們的已通過證據。**
> 唯一開發位置仍是 Build PR #419；未合併、未發布 Production，不開新 Sprint 或新 SSOT。

- **模型真實設定**：新付費 QA／CODE／REPAIR 已在 `src/edge/free-ci-ai-code.ts` 統一使用 OpenAI Responses `gpt-6.1-sol`（Build `c11bad73`）；Staging 的新請求資料庫模型白名單也已套用 GPT-6.1 Sol-only SQL（`bcee4add`），**不是** `gpt-4.1-mini`。原歷史 F.12 的 4.1-mini 是當時真實完成的模型，不可事後改稱 GPT-6。
- **免費產品鏈已有實測 PASS**：[Staging Worker／簽章 Postgres 建立讀回／免費 Runner 派發 #41196371312](https://github.com/NFF98/appf2-build/actions/runs/41196371312)、[無額外付費 Docker＋Chromium＋原首頁 Agent API Mock #41196844121](https://github.com/NFF98/appf2-build/actions/runs/41196844121)、[真 Staging 舊已發布 App 雙瀏覽器開啟操作重載 #41196844123](https://github.com/NFF98/appf2-build/actions/runs/41196844123)，皆 SUCCESS。免費 fixture、舊 App 重用不冒充「新 GPT-6 生成任意 App 後正式發布」。
- **第一次真網站付費 E2E FAIL（已定位）**：[run #41195413739](https://github.com/NFF98/appf2-build/actions/runs/41195413739) 在原網站建立 Creator Job 成功，`/free-ai-stage` HTTP503；Postgres `reserve_agent_model_call` 拒絕模型白名單，當次 Job 無 `appf2_agent_model_call` 紀錄，沒證據顯示 API 已發送或扣費。依原計畫加上 GPT-6 來源碼與模型 SQL。
- **第二次真網站付費 E2E FAIL（已定位）**：[run #41196540308](https://github.com/NFF98/appf2-build/actions/runs/41196540308) 原網站再次建立 44 美分上限的 Creator Job，但 `/free-ai-stage` HTTP503；Supabase `postgres_logs` 同時間 SQLSTATE `42501`，根因 `appf2_agent_model_call` 缺 `FOR INSERT` 的原建立者 RLS Policy；該 Job revision0 / CREATED、model call rows=0。這不是 GPT-6 已呼叫或生成 App 的證據。
- **已完成的最低權限修復**：Build [`9368faaa`](https://github.com/NFF98/appf2-build/commit/9368faaa532a8a12e1487c4446a0a61e92c55bf3) 在既有 Supabase Staging 專案實際 `apply_migration SUCCESS`，只允許 `appf2_worker` 的 owner-bound `INSERT`，保留資料表 RLS、owner `app.anonymous_id`、Job 外鍵、單次呼叫防重／預算限制。讀回 `pg_policies` 已驗證此 Rule 存在。Build `425e9f31` 在**原測試檔** `tests/api/sp35-paid-model-journal.api.test.ts` 新增 RLS/模型一致性回歸測試，避免再只修 SQL 而忘記安全權限。
- **第三次 GPT-6 真網站 E2E — FAIL_CLOSED（禁止同 Job 重試）**：[run #41197580604](https://github.com/NFF98/appf2-build/actions/runs/41197580604) 真 Staging Chromium 建立 44 美分上限 Job 成功；Supabase 模型 Journal 首次以 `gpt-6.1-sol` 成功保留 `sp35_free_ai_qa_v1`，證明前次 SQLSTATE 42501 已解除。但最終 `/free-ai-stage` HTTP503，Journal `BLOCKED_UNCERTAIN`、`response_json=NULL`、`output_tokens=NULL`，Job 仍 revision0/CREATED，GitHub Action **FAILURE**。這不是 GPT-6 已成功生成，也不能聲稱本次沒有計費；未知結果不得重試原 Job。
- **下一個已實作產品修復（尚未部署驗證）**：`0958b6eb` 在 `free-ci-ai-code.ts` 區分固定無敏感資料的 provider rate limit/rejected/server/incomplete/failed、網路／逾時、回應格式、資料庫成果保存等失敗類別；`ab71ba2c` 在建立者已簽章 API 安全回傳代碼、`baf20673` 讓網站保留「不重複扣費」警告並顯示可追查的類別。不暴露模型回覆、提示詞、Token、SQL 明細，且 `BLOCKED_UNCERTAIN` 繼續 fail closed。**此修復只是診斷可見化，不冒稱真正 AI 發布 PASS。**
- **費用保護**：第三次 Provider 請求結果不明，實際是否收費只能依 OpenAI Billing 核對。此後沒有再觸發付費模型測試。
- **本輪原位部署真證據（診斷功能已反映到 Staging）**：同一 PR #419 Build `5285a07a` 經現有 [免費 Staging deploy #41198077865](https://github.com/NFF98/appf2-build/actions/runs/41198077865) 的 `Deploy FREE-ONLY Worker + Agent ... + SPA` **步驟 PASS**；同一 Run 的 LIVE 署名 Postgres CREATE＋Read、同源 SPA/Worker、未授權來源拒絕亦 PASS。整體 Workflow 最後的 Worker→GitHub OIDC→Docker→Chromium→原 PG 收據仍在執行（**不可預標整個 Run PASS**）；沒有新增 Cloudflare Containers/Browser Run 訂閱或付費模型呼叫。[現有公開 App 雙 Chromium 重開 #41198077995](https://github.com/NFF98/appf2-build/actions/runs/41198077995) SUCCESS（舊卡片，非新 AI App）。新模型安全錯誤分類碼已進入 Staging bundle，**尚未透過新的付費模型故障實測分類結果**，不拿既有 `BLOCKED_UNCERTAIN` 重試。
- **實際覆蓋與五核分母**：目前有的「3/5（60%）」說法只代表部分獨立**基礎通道**有 PASS 證據，不代表下列五個完整原始產品驗收 Gate 之中的 3 項已合格。按本文件 A/D 節嚴格標準，**C1–C5 全鏈完整通過 = 0/5（NOT_VERIFIED）**，不能因既有 Docker SUCCESS 直接報成產品 100%。

| 五核 Gate | 2026-10-31 本節最新可證實狀態 | 尚缺真產品證據 |
| --- | --- | --- |
| C1 通用多檔案／Full-stack | **PARTIAL**：已有多檔案保存與單一真模型小互動作品（F.12），非 GPT-6 網站完整驗收 | 兩種自然語言作品，至少一種受控 generated backend＋DB CRUD／刷新保留 |
| C2 同 Job 保存／接續 | **PARTIAL**：真 PG 建立讀回、私人 App 零 AI 重開、CAS/Journal 已有測試 | GPT-6 網站原 Job 失敗復原、不中斷另付費，公開新 App 重開 |
| C3 免費隔離 Sandbox | **PARTIAL**：真 AI 生成源碼→Docker＋Chromium 的歷史 F.12 成功；最新免費 Runner PASS | 本輪 GPT-6 網站產物同 Job→Docker/QA 的證據 |
| C4 原需求 QA／自動修復 | **PARTIAL / NOT_VERIFIED**：凍結 QA 與免費 Runner fixture 有 PASS，AI 修復程式存在 | 真 GPT-6 QA FAIL→修復→重建→完整獨立 QA PASS |
| C5 有限重試／策略／費用 | **PARTIAL / NOT_VERIFIED**：原 Job 預算、不可重送、權限約束有程式和 API Test | 失敗根因改方案、同 Job 續作及越權拒絕、完整真網站反向測試 |

**下一個唯一行動**：先確認 #41198077865 全流程收據與免費 CI 的最終 PASS/FAIL；Worker/SPA 與 PG route 已經真實部署測通。對 GPT-6 不明模型呼叫先用 OpenAI Billing／可回收 Provider Response ID 或之後獨立明確核准的測試分類調查，不可重送已 `BLOCKED_UNCERTAIN` 的 Job；新 AI App 的修復/QA/v2 分享與受控 generated backend/DB CRUD 仍未完成。

## G. 執行交接（只寫已證實事實）

| 關卡 | 真實狀態 | 證據／下一阻斷 |
| --- | --- | --- |
| SPEC / 命名 | **完成計畫文件提交**；非產品完成 | Design PR #45 H-001 §0 已更新免費路線於 `a9651594baf79753a05b1f608466cbc93a316c51`；Build PR #419 本檔 |
| D0 | **DONE — 真 Staging 第一雲端阻斷已定位** | F.2 / run #41167547686：Health UP，Agent Readiness HTTP 404，private Sandbox / Browser QA Workers NOT_LISTED，Cloudflare plan 403 UNKNOWN；不重做已成功的原程式 |
| D1 | **PARTIAL — 新 Agent Staging + 保密 Job→免費 Runner→PG 收據已實際 PASS** | F.11–F.13 / #41196371312、#41196844121；舊 `FREE_CI_NOT_CONNECTED`／未部署說法已過期；仍須 GPT-6 真站鏈驗證 |
| D2 | **IN_PROGRESS — pre-provider SQL/RLS 已解除，第三次 GPT-6 QA 呼叫結果不明** | F.13 / #41197580604：模型保留成功，最終 `BLOCKED_UNCERTAIN`，尚無已保存回應；只改安全分類診斷，不重試收費 |
| D3 | **FAIL_CLOSED / NOT_PASSED** | [#41197580604](https://github.com/NFF98/appf2-build/actions/runs/41197580604) HTTP503、GPT-6 QA outcome UNKNOWN，未產生新 App 分享；C1–C5 完整產品 Gate **0/5 PASS**，保留先前免費測試的 PASS 證據 |

**跨對話唯一口令：**「繼續 `SP35-FIVE-CORE-PRODUCT-CLOSEOUT` 的下一個未完成 D 關卡；先讀此檔 F/G 節與 PR #419 HEAD，只修首個真實 BLOCK，每次結尾報 C1–C5 的產品狀態與證據。」
