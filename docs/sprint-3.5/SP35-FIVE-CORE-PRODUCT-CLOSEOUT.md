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

## G. 執行交接（只寫已證實事實）

| 關卡 | 真實狀態 | 證據／下一阻斷 |
| --- | --- | --- |
| SPEC / 命名 | **完成計畫文件提交**；非產品完成 | Design PR #45 H-001 §0 已更新免費路線於 `a9651594baf79753a05b1f608466cbc93a316c51`；Build PR #419 本檔 |
| D0 | **DONE — 真 Staging 第一雲端阻斷已定位** | F.2 / run #41167547686：Health UP，Agent Readiness HTTP 404，private Sandbox / Browser QA Workers NOT_LISTED，Cloudflare plan 403 UNKNOWN；不重做已成功的原程式 |
| D1 | **IN_PROGRESS — ProjectSnapshot→免費 Docker→Chromium 專項 CI PASS；新 Agent 真線上 E2E 尚未端到端** | F.6 / #41169846578 同 SHA PASS（可信 fixture）。下一個實際 BLOCK：保密私有 Job 的安全派發／QA receipt 回寫；未完成前維持 FREE_CI_NOT_CONNECTED、不得開啟付費路線 |
| D2 | **舊單檔卡片 LIVE GET-ONLY E2E PASS；新多檔案完整鏈 NOT_VERIFIED** | [#41168625022](https://github.com/NFF98/appf2-build/actions/runs/41168625022)：2 context click/reload 0 AI；新 Agent QA→v2 admission→卡片、受控後端 DB Profile 尚未接通 |
| D3 | NOT_RUN | 五核產品 REAL E2E = **NOT_VERIFIED** |

**跨對話唯一口令：**「繼續 `SP35-FIVE-CORE-PRODUCT-CLOSEOUT` 的下一個未完成 D 關卡；先讀此檔 F/G 節與 PR #419 HEAD，只修首個真實 BLOCK，每次結尾報 C1–C5 的產品狀態與證據。」
