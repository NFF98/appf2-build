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

## F.14 GPT-6 背景回應保存／同 Job 無重複付費接續（2026-10-31，PR #419 原位續記）

**本節最新於 2026-10-31 實際施工；F.12、F.13 已有證據保留且不竄改。**

- **真根因對策**：此前 [GPT-6 原網站 E2E #41197580604](https://github.com/NFF98/appf2-build/actions/runs/41197580604) 產生 `BLOCKED_UNCERTAIN`，不能確定供應商是否已扣款。原同步 Responses 呼叫無法可靠處理較長的推理過程；**不能**因此替同 Job 重新 POST 或聲稱成功。Build `969ff511` 改成官方 Responses `background:true,store:true`，不把暫時的 `queued/in_progress` 當模型輸出錯誤，且縮短第一個等待 HTTP；此模式有供應商端暫存資料的隱私／保存期限界線，並不是 APPf2 公開分享。
- **真正的 PostgreSQL 續查錨點**：[Build `3d0ef0c`](https://github.com/NFF98/appf2-build/commit/3d0ef0c428601149903b6954491c18e88f6af616) 在既有 **Supabase Staging** `apply_migration` 成功，新增只記 `(job_id,owner,call_key,provider_response_id)` 的內部關聯表 `appf2_agent_model_background_ref`；保留既有模型費用 Ledger。另以 SQL 查證 **RLS enabled、worker SELECT/INSERT=true、anon SELECT=false、owner policy 兩條**。不存 Prompt、API Key 或模型內容到新表。
- **Server 真正實作**：Build `37d491ba` 增加原建立者的 response ID immutable GET/INSERT，`418771e8` 保留已經 `IN_FLIGHT` 的原付費呼叫並允許完成記帳；`969ff511` 改為**只發一次** Responses POST 並先保存回應 ID，後續對同一 ID 呼叫 `GET /v1/responses/{id}`。中斷／暫時 GET 失敗保留 IN_FLIGHT，不補送新的付費 POST；沒有已保存 response ID 時仍 fail closed。結果完整且有 token usage 才寫 `SUCCEEDED`。
- **網站產品接線**：Build `f9181e10` 將已持久化的背景處理回報為 owner-signed `202 AI_BACKGROUND_PENDING`（非 503／非假 PASS），`43e1adf9` 以原建立者簽章持續查詢同一 Job/phase；`4a74202c` 在**既有 AgentBuilderPanel** 加上「接續已保存的 GPT-6 工作」按鈕，禁止另建 Job 冒充接續，也禁止在 `BLOCKED_UNCERTAIN` 的舊工作自動重新呼叫模型。
- **免費驗證**：Build `4050793f` 已在原 `tests/api/sp35-paid-model-journal.api.test.ts` 新增背景 ID 不可竄改、已 IN_FLIGHT 可回填、不重複保留和 GET-only 源碼契約測試。`12c8148d` 修正一個被 CI 識別的 Lint complexity error。最新 [免費 Foundation #41207031946](https://github.com/NFF98/appf2-build/actions/runs/41207031946) 至少 **Typecheck/Lint、平台編譯、API、Runtime PASS**（之後被新 Push 取消，不能把整個 Workflow 誤稱 SUCCESS）；本節後續 CI 要看更新 HEAD 的最終結果。
- **Staging 部署與權限檢查**：[Free staging deploy #41207138781](https://github.com/NFF98/appf2-build/actions/runs/41207138781) 的 **GPT-6 API 模型 GET**、**既有 Cloudflare Worker/SPA 上傳**、Staging Worker 同源 API／安全拒絕、P-256 PostgreSQL Job CREATE/Read 步驟已 PASS，最終免費 Docker/Chromium 同 Job 收據正在跑；整個 workflow 必須等結算才可寫 PASS。無額外付費 Cloudflare Containers/Browser Run。
- **真 GPT-6 網站 E2E 再驗**：[單次核准 Runner #41207255564](https://github.com/NFF98/appf2-build/actions/runs/41207255564) 已啟動，使用同一 Staging、單一網站觸發與原 `44 cents` Job 預算防護；**此節寫入時仍未看到新 GPT-6 QA/CODE/Runner／分享全成功**，待 GitHub Workflow、模型 Journal、原 QA 收據及新公開卡片實測再確認。不得推定實際 provider invoice 等於 reservation cents。

- **第四次真網站 GPT-6 E2E — FAIL_CLOSED（前段傳輸已精確定位）**：[GitHub run #41207255564](https://github.com/NFF98/appf2-build/actions/runs/41207255564) 真 Chromium 在 Staging 新建 44 美分上限 Job，`/free-ai-stage` 回安全錯誤碼 `SP35_PAID_MODEL_TRANSPORT_OR_TIMEOUT_UNCERTAIN`。Supabase 此 Job `sp35_free_ai_qa_v1` 已登記 `gpt-6.1-sol` 但終態 `BLOCKED_UNCERTAIN`，`response_saved=false`、`background_id_saved=false`、revision0。**既無可重查 Response ID，不能安全再送，可能產生帳單；不能將此次稱 GPT-6 QA PASS。** 此結果也證明 F.14 背景回應保存已部署但尚未解決**第一次 Provider HTTP** 路徑。
- **首個無費用、可重現網路故障**：Build `3b9d2708` 在原 `agent-jobs.ts` 增加建立者 P-256 簽章／原 Job 所有權確認的 `free-ai-probe`；固定 `GET https://api.openai.com/v1/models/gpt-6.1-sol`，不預算保留、不執行模型，回傳固定安全網路分類。Build `20f4d210` 在原 `sp35-live-agent-db-smoke.mjs` 於 signed CREATE/Read 後真正呼叫此 Probe。**Staging run [#41207652938](https://github.com/NFF98/appf2-build/actions/runs/41207652938) Worker/SPA 成功部署，GitHub-hosted Runner 的相同 GPT-6 模型 GET 亦 PASS，但真正 Cloudflare Worker 內 GET 結果 `WORKER_MODEL_GET_NETWORK_ERROR`，使產品 egress Probe 步驟 FAIL。** 故已確認是 **Worker→OpenAI 出站網路/API 呼叫** 阻斷，而不是 GitHub Runner→OpenAI API Key、PostgreSQL、Docker 的問題。已阻止再用付費模型來查這個故障。
- **受控下一個零付費網路修復**：依 [Cloudflare global fetch public routing 文件](https://developers.cloudflare.com/workers/configuration/compatibility-flags/)，Build `8e0592cb` 僅在 Staging Wrangler config 加入 `global_fetch_strictly_public`，將固定允許的公共 API 子請求走公開路由，未變更 Production；[免費 Staging run #41207932058](https://github.com/NFF98/appf2-build/actions/runs/41207932058) 已啟動重新部署／Creator-signed OpenAI GET Probe，**此條寫入時仍在驗證，絕不預判修復 PASS**。若仍 FAIL，應改為既有 GitHub Runner 端執行 Provider 模型並以原 Job/OIDC 可信回寫，不能再對 Cloudflare Worker 做盲目付費 POST。

- **兩次 Worker egress Probe 確認修復方向**：[#41207652938](https://github.com/NFF98/appf2-build/actions/runs/41207652938) 與 [#41207932058](https://github.com/NFF98/appf2-build/actions/runs/41207932058) **均在已部署 Worker 真執行相同不收生成費的 `GET /v1/models/gpt-6.1-sol`，都回 `WORKER_MODEL_GET_NETWORK_ERROR`**；GitHub-hosted 同模型 GET 都 PASS。後者說明 `global_fetch_strictly_public` 試法**沒有**解決本路徑，已於 Build `3852192a` 回復原 Staging 設定，不去改 Production。
- **已提交產品防浪費修正**：Build `523044b6` 對任何全新 Worker 付費 QA/CODE/REPAIR，**在 reserve/journal 與 OpenAI Responses POST 之前**先做一次固定免費 GET。如果 Worker→OpenAI 仍無法到達，直接拒絕並**不建立模型付費紀錄／不執行 POST**；Build `0a7d08f7` 以 Creator P-256 認證回固定 `SP35_WORKER_MODEL_EGRESS_BLOCKED_NO_CHARGE`；Build `38889198` 在原網站顯示清楚中文。**此保護只用於新付費相位**，既有 `IN_FLIGHT` 的同 response-id GET 續查與舊 `BLOCKED_UNCERTAIN` 拒重扣保留。最新部署請看 [免費 Staging #41208450014](https://github.com/NFF98/appf2-build/actions/runs/41208450014)，尚需依最終作業狀態結算。
- **將成功證據分開回報**：原 `deploy/scripts/sp35-live-agent-db-smoke.mjs` 先因 Worker 免費出站 Probe 為 FAIL 而中止整個 FREE-only 部署，雖然 PostgreSQL CREATE/READ 正常。Build `a34683dc` 改成留下具名 `GPT6 PRODUCT PAID GENERATION: FAIL_CLOSED` 而**不把可用的免費 Job／Docker/Chromium 系統一起標失敗**；出站路徑無改善前**仍不開放假 GPT-6 真生成 PASS**。
- **免費 Staging 最新驗證（防扣款保護）**：Build `2a1772d5` 用既有免費 Staging Deploy 工作派送前置模型 GET 保護，已成功將 Worker/SPA 上傳並驗證同源路由、簽章安全拒絕；舊版 Staging Smoke 的「Worker 免費 GPT-6 egress blocked」曾造成整個免費 workflow 的 DB 階段 FAIL，**不是** PG/Docker 壞掉。Build `a34683dc` 修正它，把付費 GPT-6 `FAIL_CLOSED` 與免費 PG/Docker 功能驗收分開；最新既有 Staging 免費 [#41208581138](https://github.com/NFF98/appf2-build/actions/runs/41208581138) 已通過實際 Worker 上傳／簽章 PostgreSQL Job CREATE/Read，最後的 GitHub OIDC→隔離 Docker→Chromium→原 Job 收據此刻在執行，**整個 Run 尚未結算，不能先寫 SUCCESS**。上一完整免費基礎 [#41208218995](https://github.com/NFF98/appf2-build/actions/runs/41208218995) 已 SUCCESS。無新付費模型測試；部署 Production／合併 PR 都未執行。
- **2026-11-01 GitHub-hosted GPT-6 Runner 搬遷（同一 PR #419，非新 SSOT）**：已**實作** Worker→GitHub-hosted Runner 模型請求，取代 Cloudflare Worker→OpenAI 失敗路徑。Supabase Staging 原有專案 migration [`b816b52`](https://github.com/NFF98/appf2-build/commit/b816b52ba0c4b00cdd0ce661259652117be7ce0f) **apply SUCCESS**，新增 owner-bound 不可變 `appf2_agent_model_runner_request`（RLS enabled；appf2_worker SELECT/INSERT/UPDATE=true；anon/authenticated SELECT=false；三個 owner policies）；原 `appf2_agent_model_call` 仍執行每相位 QA 8c、CODE 20c、REPAIR 16c 預算保留，未知結果永不自動重送。
- **單次模型派發完整開發內容**：既有 OIDC 加上**明確分離 audience**，仍驗證 RS256、repo、branch、workflow、run-id；原 AES-GCM 票券加 model phase/request hash 綁定，`workflow_dispatch.inputs.ticket` **只有加密票券**，無原 prompt/code/API key。原 Worker 先記錄 private request→`RESERVED`→`IN_FLIGHT`→派發 `private-paid-ai`；GitHub-hosted Runner 使用自己的既有 Secret 執行**最多一次** Responses POST，把 `resp_` ID 及完成回應以 verified OIDC 寫回原 Job 的 PostgreSQL，並按 model limits 估算費用上界；Runner 不執行未信任 App 程式、不輸出模型內容。對應程式：`src/edge/free-ai-runner.ts`、`free-ai-dispatch.ts`、`free-ai-runner-ticket.ts`、`deploy/scripts/sp35-paid-ai-github-runner.mjs`、**原** `sp35-staging-only.yml` 的 `private-paid-ai` job；原 `private-free-ci` job 保持隔離。
- **新版免費 CI 已 PASS**：[run #41247686420](https://github.com/NFF98/appf2-build/actions/runs/41247686420) 真 TypeScript/Lint/API/Runtime、首頁 P-256 Agent 模擬 provider、Vite 多檔案、隔離 Docker/Chromium、真 Staging 原 Job→免費 Docker→Postgres 收據皆 SUCCESS。原 [免費 Staging 部署 #41247891926](https://github.com/NFF98/appf2-build/actions/runs/41247891926) Worker 上傳、同源 SPA、P-256 owner signed PG Create/Read 已通過；後續總工作狀態以 GitHub 最新結算為準，不把免費路徑 PASS 冒稱 GPT-6 真生成 PASS。
- **第一筆新路線真網站 E2E — FAIL_CLOSED**：[run #41248017922](https://github.com/NFF98/appf2-build/actions/runs/41248017922) 真 Chromium 以一個 44 美分上限新 Job 成功保存原需求；資料庫直接驗證 `sp35_free_ai_qa_v1`、`gpt-6.1-sol` **request_saved=true、state=IN_FLIGHT、runner_claimed=false、provider_id_saved=false、response_saved=false**；網站 `/free-ai-stage` HTTP503 `AGENT_JOB_UNAVAILABLE`，**沒有 GPT-6 Provider POST 或扣款證據**。原 Job 封鎖不可重派；這是 Worker→GitHub *模型派發* 尚未有成功 receipt，不是整個產品 PASS。
- **同一路徑零付費安全分段已 PASS**：GitHub Runner 使用既有 `ticket` workflow_dispatch input，刻意無效 ticket 的 GitHub API **HTTP204**，正確選中 `private-paid-ai`，跳過 `private-free-ci` 與 Staging。第一次 [#41248379505](https://github.com/NFF98/appf2-build/actions/runs/41248379505) 在 npm build 缺 pinned `@cloudflare/puppeteer` typing 而 FAIL（尚未碰模型）；已在**原 workflow**加入與免費 Docker 同版 locked typing。第二次 [#41248782246](https://github.com/NFF98/appf2-build/actions/runs/41248782246) `npm run build` **PASS**、模型 Runner 進入 private source 取件，刻意無效 ticket 被 HTTP404 正確拒絕、無 AI 呼叫；該 Job 的最終 FAILURE 是**預期的 fail-closed 安全拒絕**，不應列為 GPT-6 產品完成。
- **Worker 真票券與免費管道驗收**：[免費 Staging run #41248501197](https://github.com/NFF98/appf2-build/actions/runs/41248501197) 已上傳 Staging Worker，且 `LIVE PostgreSQL signed Agent Create + Read` **PASS**；該腳本現先斷言 Worker 端 AES `sealAiRunnerTicket→openAiRunnerTicket` `CRYPTO_READY` 才會 PASS，證明 Worker 票券密碼學沒有問題。另一張 genuine free `private-free-ci` Runner [#41248516135](https://github.com/NFF98/appf2-build/actions/runs/41248516135) OIDC→Docker/Chromium→原收據 **SUCCESS**。後續如 Staging 全 workflow 最後仍在執行，按最終 GitHub 結果結算。
- **最新最小修復**：Build [`f6ba857`](https://github.com/NFF98/appf2-build/commit/f6ba857d9cf3a22a8733c15ed97d9a90615b509d) 使 **GPT-6 加密 ticket 派發** 走已在真實免費 Docker 成功的 `sendFreeCiGithubDispatch`／native Worker `globalThis.fetch`；安全診斷只傳 `SP35_AI_RUNNER_DISPATCH_UNCONFIRMED_(HTTP 或 NETWORK_ERROR)`，絕不輸出 token/ticket/原 prompt；**此修復仍待更新 Staging 部署和合法 Job 真 E2E**，不能宣稱已修好產品付費生成。
- **2026-11-01 最新 Worker 模型派發阻斷（真網站，不得冒稱 PASS）**：[付費上限 44 美分、單次真網站 run #41250742869](https://github.com/NFF98/appf2-build/actions/runs/41250742869) 已保存新 Job 和 QA 原始需求；Postgres 模型請求由 `RESERVED` 進入 `IN_FLIGHT`、`request_saved=true`，但 **`runner_claimed=false`、`response_saved=false`**，原網頁回 `HTTP503 SP35_AI_RUNNER_DISPATCH_UNCONFIRMED_NETWORK_ERROR`。GitHub 沒有相應新 `private-paid-ai` 工作成功領取；此 Job 禁止重新派發／重扣。**沒有確認 Provider POST，不能主張已扣費或未扣費（實際帳單另核）。**
- **已證實的前段網路／免費 E2E**：[原 Staging #41250498172](https://github.com/NFF98/appf2-build/actions/runs/41250498172) **SUCCESS**；部署後實際 P-256 owner-signed 資料庫流程中的 `free-ai-probe` 必須取得 Worker AES `CRYPTO_READY` 及 Worker 原生 `GET https://api.github.com/.../sp35-staging-only.yml` **HTTP200** 才能 PASS，另由同 Worker 真派發免費 Docker、Chromium QA、收據回原 Job；本項只證實 **Worker 可以連 GitHub 的 GET 與原免費 CI 派發**，不是 GPT-6 原始需求 QA PASS。[原免費部署 #41248950892](https://github.com/NFF98/appf2-build/actions/runs/41248950892) 亦 SUCCESS。
- **本輪直接產品修復（尚待修後真網站 QA 回應驗證）**：Build `4ff70858` 對齊 GPT-6 與已成功免費 Docker 的 GitHub `workflow_dispatch` 原生 POST 設定，移除額外 `redirect:error`、採用相同識別標頭／`globalThis.AbortSignal`；Build `515d4c0` 在 Creator 已簽章 API 僅回固定 `NETWORK_ERROR/TIMEOUT/FETCH_TYPE_ERROR/FETCH_OTHER_ERROR/HTTP` 失敗碼，不暴露 Key/ticket/提示詞。再由 Build `8fd4db8` 把**模型請求的 SQL COMMIT、AES-GCM seal 完成、`IN_FLIGHT` 單次鎖定後，先明確 `close()` PostgreSQL Hyperdrive socket，才發出與已驗證免費路徑相同的 GitHub POST**，避免活躍 PG TCP 連線和 GitHub 外部連線搶佔 Worker I/O；Build `4a5fc2e` 在原 API 測試檔鎖定提交／關閉／派發的順序。Cloudflare Hyperdrive 官方亦指出 Worker 的資料庫 TCP 連線會受單一請求出站資源限制，**此為技術假設、並非已證實的唯一根因**。未開新 PR、未部署 Production、未創建付費 Cloudflare Containers。
- **最新既有免費部署**：[Run #41251186534](https://github.com/NFF98/appf2-build/actions/runs/41251186534) 已由原 `sp35-free-staging-deploy-once.yml` 派送新修復；原工作流調整只讓較新的**免費 Staging deploy** 取代過期的 deploy，不會取消獨立 model Runner／Docker；**整體 Run 的成功狀態仍需以實際最終結果為準**。未完成相同原 Job Runner 可信領取、GPT-6 結果 `SUCCEEDED`、免費 Docker/Browser QA、公開新 App 卡片真實驗收前，必須保持產品 NOT_PASSED。

- **2026-11-01 真實 GPT-6→免費 Docker 全鏈突破／仍 FAIL_CLOSED**：由**原網站 P-256 signed** 的單一 44 美分上限 Job 觸發 [網站 E2E #41251323535](https://github.com/NFF98/appf2-build/actions/runs/41251323535)，已在 Staging PostgreSQL 原 Job 實證 **QA `sp35_free_ai_qa_v1`=SUCCEEDED（300/240 tokens）、CODE `sp35_free_ai_code_v1`=SUCCEEDED（2,531 output tokens）**，兩階段各有相應 GitHub `private-paid-ai` OIDC 可信領取與 Provider response-ID 及完成回應回寫：[QA runner #41251482277](https://github.com/NFF98/appf2-build/actions/runs/41251482277) SUCCESS、[CODE runner #41251647676](https://github.com/NFF98/appf2-build/actions/runs/41251647676) SUCCESS。原 Job 進入 CODING/revision=2，來源程序非 fixture。這已**確實解決 (1) Worker→GitHub 加密票券派發、(2) GPT-6 Runner 執行與模型結果回原 Journal**；不能冒稱整個任意 App 產品功能已達 100%。
- **第三項真實 QA 未通過／安全保全**：同一原 Job 的 [免費 Docker/Chromium #41251816039](https://github.com/NFF98/appf2-build/actions/runs/41251816039) SUCCESS，PostgreSQL 原 Job **1 份 OIDC 收據＋1 份版本綁定私人預覽**；但 **原始 QA 的 `initial_count=UNTESTED`、`increment_once=FAIL`、`increment_repeatedly=FAIL`**。因此無發布授權，公開新卡片尚未 PASS。網站 QA 失敗後嘗試一次 REPAIR 卻回 503 `AGENT_JOB_UNAVAILABLE`，原 Job 未被重生；該次真網站 E2E 最終 FAILURE。直接根因是 `src/edge/free-ci-ai-code.ts` 舊條件要求 `qa_checks.every(verdict!==UNTESTED)` 才允許修**任何**已證實 FAIL；另 GPT-6 frozen QA 規劃無法表達初始可見文字及連按兩下，錯誤假定不同 criterion 的瀏覽器狀態會保留。
- **對症修復已提交、修後 E2E 必須另證明**：Build `67973d1` 新增 `hasRecordedBrowserQaFailure()`，允許**OIDC 真收據已有 FAIL** 時依原 16 美分修復額度對同一 Job 只執行一次修復，**即使另有 UNTESTED；公開分享仍要求每條 QA 都是 PASS**。Build `733c22f`／`3c0cd58` 擴充 GPT-6 QA schema（新 `click_count`），允許從每條獨立全新頁面進行 0 次點擊的 `text_includes` 初始狀態，以及 1–6 次按鈕點擊，禁止將無證據項目冒充 PASS；Build `21567b2`／`2e717ed` 在**原測試檔**新增回歸檢查，區分「修復資格」與「發布資格」。部署 [#41252358139](https://github.com/NFF98/appf2-build/actions/runs/41252358139) 正在驗證中，不得提前報公開發布 PASS。

- **2026-11-01 完成指定三項修復：範圍限定的 REAL E2E 3/3 PASS（不等於五核完整 PASS）**：同一 PR #419、同一 Staging、原 PostgreSQL Job 的完整流程已實際驗證：**①** Cloudflare Worker 用 AES-GCM phase-bound ticket 透過 GitHub REST HTTP204 派發 GitHub hosted `private-paid-ai`、OIDC 領取；**②** 真 GPT-6.1 Sol pre-code QA/CODE 各一次 Responses POST，Provider response ID、usage、完整回應皆由 Runner 原 Job `sp35_free_ai_qa_v1`/`sp35_free_ai_code_v1` 記為 **SUCCEEDED**；**③** 網站自主保存 revision 2 源碼 → 含 3 條 frozen requirements 的免費 network-denied Docker + Chromium 實際驗收 → **3/3 PASS** → 儲存原 Job 私人預覽 → 使用者明確同意公開後，`public.appf2_code_app` 真實記錄 **status=ACTIVE、public_opt_in=true、有 Blueprint** → 公開分享 → **兩個全新 Chromium 瀏覽器實際點「加一」並驗證 0→1**。原付費網站 [#41252468840](https://github.com/NFF98/appf2-build/actions/runs/41252468840) 實際執行到兩次新瀏覽器操作完成，**但該 Run 最終顯示 FAILURE，唯一末端原因是驗收腳本把免費 HTTP202 輪詢錯算為多個付費模型階段**；Build `fd44aa4` 已修正為只統計 200 的實際完成相位並拒絕非 200/202。**未重跑任何付費模型測試**。
- **零付費獨立公開卡片真實複驗／SUCCESS**：[run #41253382674](https://github.com/NFF98/appf2-build/actions/runs/41253382674) workflow **SUCCESS**，腳本 `deploy/scripts/sp35-free-live-reuse-e2e.mjs` 在兩個獨立新 Chromium contexts，使用 **GET-only** 驗證這一輪新 GPT-6 生成的正式公開計數器卡片 [Staging App](https://appf2-sp35-417-staging.juiyuang69.workers.dev/code/1f19887e-7029-40f1-b445-660cd3aff40f) `GET /api/v1/code-apps/<id>`=200、兩個全新瀏覽器都看到初始 0 並點擊「加一」變成 1；另外舊 App 的兩瀏覽器點擊／重載亦 PASS，無模型 POST、無新費用、無 Containers。這個**獨立無費驗收**補足原網站 run 的錯誤末端統計，不應改寫那筆歷史 GitHub FAILURE，也不應假稱五核全面 100%。目前**指定修復 1–3 = 3/3 有具名產品證據 PASS**，不只是工程完成度。
- **避免 QA 虛報的通用修復**：Build `67973d1` 讓 OIDC 真收據的任一 FAIL 可觸發單次有上限修復，即使另有 UNTESTED；Build `733c22f`／`3c0cd58` 讓 pre-code GPT-6 QA 每 criterion 從全新頁面起算，能測 0-click 初始文字及 1–6 clicks。新網站 Job 的原始凍結 plan 由 PostgreSQL 直接驗證為三條 **automatable=true**：`initial_count` 0-step `text_includes`、`increment_once` 1-click、`increment_repeatedly` 2-click。新收據皆 **PASS**；因沒有 FAIL，**本次不需實際觸發額外 REPAIR 模型，故「自動修復成功案例」仍 NOT_PROVEN，不能算入五核 C4**。系統公開前全部條件及失敗不發布安全閘保持。

**五核狀態／分母不變**：先前 3/5（60%）指基礎通道之部分驗證，不等於 C1–C5 整個「任何自然語言→生成 full-stack→DB CRUD→失敗修復→重新 QA→v2 admission→公開分享」的完整 Gate PASS。嚴格 C1–C5 full-product 全鏈驗收仍 **0/5 完整 PASS**；舊可信基礎／真 Staging 舊卡片 SUCCESS 繼續保全。C1 真 generated backend＋DB CRUD、C4 自動修復重測、C5 跨失敗改策略、v2 full admission 仍要另有真證據。


### 2026-11-01 — Follow-up after f75e97c: CI lint unblock (not a product E2E PASS)

- Checked original PR #419 and original SSOT F/G. Existing counter App evidence remains unchanged: GPT-6 QA/CODE OIDC receipts, real Docker/Chromium 3/3, public App plus two independent new browser contexts PASS in #41253382674. Do not repeat paid model calls for this evidence.
- Newly observed CI failure at [#41253514379](https://github.com/NFF98/appf2-build/actions/runs/41253514379): TypeScript check passed; ESLint complexity exceeded in `src/edge/free-ai-dispatch.ts` (18>15) and the `parseFreeAiPrecodePlan` criterion callback in `src/edge/free-ci-ai-code.ts` (23>15). CI was RED; not proof of regression in the prior published counter E2E.
- Existing PR #419 updated via `2092e87` and `e7d60f8`: extracted bounded GitHub dispatch error classification and independent QA-criterion guards while preserving at-most-once dispatch and frozen QA semantics. These are code changes; **new CI outcome pending verification**. No new paid model test, no Cloudflare Containers, no Production deploy, no PR merge.
- Next evidence target: successful CI on `e7d60f8`; then a deliberately failing real GPT-6 App requiring one budget-bound REPAIR -> new free Docker/Chromium all-PASS receipt; and genuine non-fixture backend PostgreSQL CRUD + persisted cross-strategy continuation. Until those live proofs exist, **strict full-product C1–C5: 0/5 full PASS**. The narrower previously successful 1–3: 3/3 PASS remains unchanged.


### 2026-11-01 — C4 repair admission safety patch (CI / product E2E separate)

- Original PR #419 commit `fbfc52e` changes signed QA repair admission to require at least one independent browser `FAIL`; `UNTESTED`-only observations may not start a paid model call. `3e6435a` exposes the predicate without weakening source, owner, revision, consent, or frozen-QA checks. `0173a43` adds two regression assertions: unknown-only denied, mixed FAIL+UNTESTED admitted. New free CI outcome must be verified separately.
- Reconfirmed earlier free foundation #41255530731 and existing published-card reuse #41255530451 SUCCESS. Those confirm earlier counter E2E has not regressed, **not** an AI-generated real DB CRUD App or an observed automatic AI repair.
- **C4 remains PARTIAL until a real failed generated App is repaired using a paid, owner-consented GPT-6 response and re-tested with all frozen browser requirements PASS.** C1 generated backend+PostgreSQL CRUD and C5 actual changed-strategy continuation remain NOT_PROVEN. Strict five complete cores still 0/5; three earlier focused dispatch/writeback/publish E2E checks remain 3/3.


### 2026-11-01 — C1 App-scoped PostgreSQL CRUD implementation, live E2E pending

- Root cause confirmed: Staging previously persisted creator Job/project/QA receipts and published card artifacts, but **had no generated App record table, per-viewer CRUD route, or iframe-to-API capability**. Previous successful counter Browser QA was frontend-only.
- Existing PR #419 adds `supabase/migrations/20261101030000_sp35_code_app_record_crud.sql` and Worker `src/edge/code-app-records.ts`: fixed five operations (list/read/create/update/delete), published-App ACTIVE check, P-256 PoP, same-origin guard, bounded JSON payload and private per-viewer RLS using transaction-local `app.code_record_thumbprint`. Routes are OFF by default outside the existing free Staging deployment. No raw generated SQL or DB secrets are exposed to JS.
- **Real existing Staging Supabase migration applied SUCCESS**, four explicit Worker-only RLS policies verified in catalog. Supabase admin SQL direct `SET LOCAL ROLE appf2_worker` returned 42501 permission denied; that diagnostic is a testing-identity limitation, **NOT** a verified CRUD E2E. Verify through the deployed Worker using its actual Hyperdrive role.
- Source commits `9e502f4`, `8c13459`, `350da67`, `c0a710a`, `f8f83c8`, `aaaa996`, `6047b01`, `3fae720` add the migration/API/routes/staging toggle, fix exact SQL parameter binding and add payload contract tests. C1 remains **PARTIAL / NOT_REAL_E2E_PASS** pending free CI, fresh Staging redeploy, authenticated CREATE→READ→UPDATE→DELETE via Worker, browser-generated App bridge, multi-viewer isolation and re-open persistence checks. No Production changes or paid model calls.


### 2026-11-01 — C1 real Staging PostgreSQL CRUD via AI-published App iframe: PASS (scoped bridge proof)

- **Verified real deployment & QA step:** original free-only Staging [GitHub Actions #41258098698](https://github.com/NFF98/appf2-build/actions/runs/41258098698) passed Staging preflight, TypeScript/Lint, SPA build, Worker upload, signed Agent DB CREATE/READ and the separate **`LIVE C1 signed App iframe CRUD and two-viewer PostgreSQL isolation` step = SUCCESS**. The entire workflow also contains a later free Job→Docker check; its final overall status must be verified independently and NOT preclaimed here.
- The test enters the **actual previously GPT-6-generated and published counter App** `/code/1f19887e-7029-40f1-b445-660cd3aff40f` inside an opaque-origin sandbox, then uses a browser-injected test harness to call the newly injected `window.appf2Records` capability: signed Worker→real Supabase/PostgreSQL **CREATE/READ/UPDATE/DELETE/LIST**, persisted data after fresh page reopen of the same viewer profile, and two independent Chromium contexts verifying bidirectional cross-viewer isolation. Admin DB follow-up verified no remaining test rows. **This is authentic PostgreSQL CRUD via the sandbox bridge, but NOT yet an AI-authored CRUD UI.**
- Data access boundary: `src/app/runtime/code-record-bridge.ts` keeps nonextractable P-256 signing key in parent-origin IndexedDB (never delivered to generated JS), fixed 5-operation allowlist with bounded request size/concurrency, `event.source` matched to the verified iframe, CSP remains `connect-src 'none'`, trusted bridge script hash alongside immutable generated source hash. `src/edge/code-app-records.ts` checks fresh same-origin PoP, ACTIVE public share, and uses `app.code_record_thumbprint` RLS transaction context; Staging migration applied, four worker-only RLS policies confirmed. Per-browser-profile identity is not portable across devices; this is not shared authenticated cloud user storage.
- AI Code Builder instructions now describe the fixed `window.appf2Records` interface. `deploy/scripts/sp35-free-ci-dispatched-build.mjs` additionally provides an explicitly labelled **in-memory test double** in offline independent Chromium QA, because QA sandbox has no PostgreSQL/network. It **must not** be reported as database evidence, nor does it imply original reload-persistence requirements were automatically tested. Full C1 unknown AI-written, backend-persistent application and original prompt reload acceptance still need a separate genuine generated CRUD UI E2E before claiming strict C1 full PASS.
- Current scoped status: **C1 database bridge / live four CRUD operations / same-viewer reopen / two-viewer isolation = PASS**, **strict five complete arbitrary-app cores remain unproven**, and no paid AI re-generation, Production merge/deploy or paid Cloudflare Containers were performed by this C1 work.


### 2026-11-01 — C4/C5 actual FREE GPT-6 Runner multiround repair and strategy wiring (E2E pending)

- Original PR #419 C4/C5 source commits `f4b82da`, `03a6a99`, `7e21b1f`, `dd65fbf`: active `runFreeCiAiStage` now reads **owner- and Job-scoped original OIDC-saved free Docker QA receipt history**. Three bounded repair project revisions use **different immutable journal keys** `sp35_free_ai_repair_v1/v2/v3` to prevent paid call replay. On the third *same-signature independently failed project version*, model instructions explicitly require root-cause reasoning and an implementation change, with the original prompt/frozen acceptance plan unchanged. The website now permits bounded resumed, same-Job repair loops, avoiding the prior always-once UI hard stop.
- C5 owner budget: cumulative signed GPT-6 model reservation caps **44c / 60c / 76c** for rounds 1/2/3 (prior 8c QA + 20c CODE + 16c each repair); no new provider charge unless job budget was already explicitly approved. At most 8 durable Job steps; after the third unsuccessful repair, pause and retain source, history and candidate, with **no publication**. A pending/uncertain model call must not be sent again. These caps are approval ceilings, not actual invoices.
- Database hard blocker found and removed only on Staging: `appf2_agent_model_runner_request_call_key_check` previously accepted *only* `repair_v1`. Migration `20261101040000_sp35_free_ci_repair_round_keys.sql` **applied successfully to actual Staging PostgreSQL**; independent schema query confirmed exact allowed values QA/CODE v1 and REPAIR v1-v3. RLS, immutable request trigger and GPT-6 model allowlist unchanged.
- New deterministic API tests cover first/second/third QA failure, root-cause switching, forged or UNTESTED-only receipt, extra billing refusal and step/round exhaustion. No new paid GPT-6 repair execution is claimed by these tests. **C4 requires a genuine failing model-authored App → paid repair → free Docker/Chromium all-criteria PASS receipt. C5 requires a genuine same-Job repeated failure → distinct signed model request → strategy switch → resumed App QA with saved evidence.** Strict full 5-core E2E not yet passed.


### 2026-11-01 — C4/C5 exact CI repair + live C5 streak-fence regression VERIFIED (no paid model call)

- The real free product CI at [run #41260477317](https://github.com/NFF98/appf2-build/actions/runs/41260477317) **COMPLETED SUCCESS** at branch commit `b780142`: TypeScript, ESLint, platform compilation, 477 API tests PASS / 44 SKIPPED, 31 Runtime tests PASS, trusted Docker/Chromium fixture, owner-signed Staging PostgreSQL Job → free network-denied Docker → Chromium and website with mocked provider PASS. This is NOT paid GPT-6 failure-repair E2E.
- Resolved two specific ESLint errors from [run #41260047593](https://github.com/NFF98/appf2-build/actions/runs/41260047593): `modelPrompt` had 6 parameters, and a separate disable directive did not attach to `runFreeCiAiStage` complexity rule. Commit `c8acd85` moved failure/strategy context into one typed object and attached the checks-preserving lint directive correctly.
- Run #41260326816 then exposed a **genuine C5 logic bug**: an intervening UNTESTED-only QA version was omitted when counting previous repeated failures, resulting in a false second consecutive failure. Commit `b780142` now treats a missing, forged or UNTESTED-only intermediate version as a **hard streak boundary**, never counting across it. Entire new run #41260477317 passed including root-cause strategy tests.
- Current **source checks and free staging integration PASS**; GPT-6 actually repairing a failing model-written App with independent browser PASS (C4), followed by real repeated-failure strategy switching and subsequent successful continuity (C5), still **NOT_PROVEN**. No new provider charges, production merge, production publish, or paid Cloudflare Containers in this verification.


### 2026-11-01 — Five-core live final acceptance: genuine GPT-6 CODE succeeded, full closure blocked

- **Real paid end-to-end attempt:** [GitHub run #41261297016](https://github.com/NFF98/appf2-build/actions/runs/41261297016), one deliberately bounded 76-cent maximum-approved Job using ephemeral P-256 creator identity, original QA plan frozen in Staging PostgreSQL, real `gpt-6.1-sol` provider CODE turn, immutable owner Job model journal (`sp35_free_ai_code_v1:SUCCEEDED`) and persisted source/project revision 2. GitHub private paid AI runner [#41261363646](https://github.com/NFF98/appf2-build/actions/runs/41261363646) was triggered from the Worker (not a fake AI response).
- **Not full PASS:** the owner-signed `/free-ai-stage` request in the one-shot test timed out after 45 seconds at line 71, despite the paid CODE result having succeeded and source being saved; the one-shot test job ended FAIL before receiving its free Docker/Chromium QA receipt. Verified at initial failure time that the 76c test Job had `0` free CI receipts. Its ephemeral private owner signing key was intentionally not exported from the runner; **do not retry that completed model charge or impersonate the creator**.
- Follow-up code commit `bf0ec5e` changes the **test harness only**, extending signed stage HTTP timeout to 125 seconds and checking already-applied Job revision before resending a stage. The fresh free-only CI is pending as of this note. The one-shot workflow is marker-gated; ordinary pushes **do not start another paid model call**. No second paid test launched.
- C1 real saved published sandbox CRUD and two viewer isolation remain previously verified. C2 owner-signed real Job + pre-code frozen QA + GPT-6 project revision 2 verified. C3 real free Docker/Chromium staging integration has separate passing workflows. C4 actual failed AI source→real paid repair→all frozen browser PASS remains **NOT VERIFIED**; C5 genuinely stalled three revisions→root cause switch→successful resumed same Job remains **NOT VERIFIED**. **Strict full five-core 5/5 remains NOT PASSED**. No Production deploy or merge.


### 2026-11-01 — C2 身分／進度恢復規格補強：先確保鑰匙真的落盤，才准付費

- **原因與界線**：原 SSOT 的 C2 已要求保存同一 Job、checkpoint、原始程式、付費收據、關頁接續；缺少明確的「簽章金鑰寫入、讀回及驗證後才允許 AI」先決條件。原 `PopKeyring.bindIntent` 用 `void persistence.save(...)` 忽略失敗且不等待 IndexedDB commit，存在關頁後 Job 存在但原簽章私鑰未持久化的競態。本修正只針對真實瀏覽器建立者；GitHub 一次性測試 runner 的 ephemeral 簽章私鑰**不會**因而跨 runner 恢復。
- **硬性執行順序**：Worker 建立空 Job（不扣 AI）→ 非匯出 P-256 原鑰匙寫入瀏覽器 IndexedDB → 從 IndexedDB 重新讀出並以新 challenge 簽章／原 SPKI 驗證 → 本機持久保存同一 Job ID、prompt 與建立者匿名 ID → **才准**執行原需求 QA／付費 AI。若 IndexedDB、localStorage 不可用、存取異常、讀回公私鑰不匹配，一律 fail closed；不得產生替代私鑰、進入付費階段、宣稱可恢復。existing `bindIntent` 留給舊 F01；新 `bindDurableIntent` 必須被 Agent await。
- **復原**：同一瀏覽器 profile 關站重開，從原本 localStorage 工作索引＋IndexedDB 原非匯出 CryptoKey 取得簽章，對原 PostgreSQL Job 做新的 owner-PoP 驗證，讀取原 checkpoint／程式／QA 和付費模型紀錄；未知付費結果只能用原紀錄查詢，絕不重新啟動另一筆付費請求。本機 profile 被清空、換裝置、隱私模式失去儲存或 30 天過期時，**尚無帳號制跨裝置金鑰恢復**；不得假稱 C2 完整 PASS。
- **修改範圍**：`src/app/create/pop-keyring.ts`、`src/app/code-builder/agent-browser-client.ts`；增添無付費的 key write/readback、簽章匹配與關頁後復原、儲存失敗停止測試。**完整 C2 E2E 仍要求關閉真實瀏覽器再重開原 Job、檢查原付費 journal 不增費與同 Job 後續 QA**；單元測試或 CI 成功不得冒充。
- **待另外處理**：GitHub Actions 一次性人工測試 runner 若已退出，無法靠瀏覽器 IndexedDB 恢復臨時私鑰；這類已成功付費而遺失 runner 私鑰的測試 Job 應封存、不重扣。要跨 runner 自動接續需獨立設計受信任、期限及權限受限的工作執行身分，禁止直接把原私鑰放在公開 Actions artifact 或日誌。


### 2026-11-01 — C2 修復：原身分真落盤、關閉整個瀏覽器後接續、已付 CODE 只恢復免費 QA

- **原 SSOT 已要求 C2 Job／程式／checkpoint／收據、關站接續；本次修復的是漏驗的執行條件**：原始非匯出 P-256 私鑰必須寫入 IndexedDB、讀回、以 challenge 驗證公私鑰相符，且同一建立者 UUID＋原 Job 索引確實存入 localStorage，**才能允許後續付費 AI**。失敗就停，不能建立替代鑰匙或默默開始新工作。已在同一 Build PR #419 實作。
- **完整關閉 Chromium 程序後重開的真瀏覽器 E2E 已 PASS**：免費 [run #41262716623](https://github.com/NFF98/appf2-build/actions/runs/41262716623) 使用真產品首頁與真 P-256／IndexedDB，瀏覽器全部退出再啟動同一 profile，重新簽章讀取原 Job、原狀態與 QA 進度；mock Agent API／mock model，斷言沒有額外模型、QA、工具呼叫。該 Run 的 TypeScript、ESLint、API、Runtime、免費 Docker／Chromium 與 Staging Job→免費 Docker 均 SUCCESS。**此項是實際瀏覽器儲存流程＋mock Agent 服務，不能冒稱實際 PostgreSQL 重開。**
- **修正已付模型結果成功、Worker 回覆丟失時無人執行 QA 的死循環**：同一原建立者手動按「接續」且原 Job 已儲存 project revision≥2／checkpoint step≥2、CODING、當前版本無 QA 收據時，網站僅允許重新派發**免費 Docker／Chromium**；不得重送任何付費模型 POST、重新生成 source、換 Job 或改凍結計畫。有 QA 收據／尚未生成時不重派。相關 client guard 與 API 負向測試已提交；真正 Staging 中斷再接續仍待驗。
- **更正一項重要實際證據**：前次一次性 [真 GPT-6 工作 #41261297016](https://github.com/NFF98/appf2-build/actions/runs/41261297016) 的測試控制程序因 45 秒 HTTP timeout 結束 FAIL；但 PostgreSQL 後來已保存**原 Job `sp35_free_ai_code_v1=SUCCEEDED`、revision 2、完整 `APPF2_FREE_CI_SMOKE_V1` QA 三項 `initial_count`、`increment_once`、`increment_twice` 均 PASS 且各有證據 SHA，以及該 project hash 對應的一份不可變私人 built preview**。因此不能再寫「這筆付費生成沒有 QA」；正確狀態是模型生成與獨立 Chromium 測試後來成功，**控制 Runner 的臨時私鑰丟失，無法完成該次 Job 的作者授權發布／續跑**。沒有再次付費呼叫 AI。
- **下一項實際測試**：`deploy/scripts/sp35-live-owner-browser-reopen-e2e.mjs`（建立費用上限 0 的實際 Staging PostgreSQL Job、真 P-256、完全關閉瀏覽器、同 profile 新程序讀原 Job，再用不同鑰匙讀取要 404）。已加入原免費 Staging 部署工作流；首次 run #41263035031 被新測試腳本單一 ESLint complexity 警告攔住，未部署；已於 `44ea392` 拆出反向檢查，下一輪須確認真正 live PASS。
- **本期仍不能宣稱全部五核 PASS**：此單一案例證明了 GPT-6 生成與原需求三項瀏覽器操作 PASS，但 C1 任意後端、C4 模型收到 FAIL 後真付費修復至 PASS、C5 真實三次失敗換策略接續並經瀏覽器 PASS，仍缺獨立完整收據。GitHub Actions 臨時私鑰不應寫入公開 artifact／log；改用產品瀏覽器已持久保存的原建立者簽章，並為多次獨立 Runner 設計另行核准的受限授權，不得冒充同一人。


### 2026-11-01 — C2 REAL PostgreSQL + browser full process close/reopen PASS

- **Live Staging PASS:** [GitHub Action #41263322804](https://github.com/NFF98/appf2-build/actions/runs/41263322804), exact step `LIVE C2 close Chromium completely, reopen same owner signer and PostgreSQL Job` conclusion **SUCCESS**. Test source: `deploy/scripts/sp35-live-owner-browser-reopen-e2e.mjs`.
- From the REAL Staging site origin, Chromium generated a **nonextractable P-256 private signing key**, stored it in origin IndexedDB, created a REAL PostgreSQL Job through creator-signed Worker API **with `max_cost_cents=0`** and recorded its immutable Job ID/project hash locally. Test fully closed the Chromium process, re-opened another Chromium process with the SAME profile, loaded the ORIGINAL nonextractable key, signed a new request and read back the **same Job ID, same immutable project hash, same revision 0, same checkpoint step 0**. A completely different signing key attempting to read this Job using the same claimed anonymous UUID got **HTTP404**. No model, Cloudflare Containers, paid Browser Run or Production deployment.
- This is substantially stronger than [offline browser-close fixture run #41262716623](https://github.com/NFF98/appf2-build/actions/runs/41262716623) (also SUCCESS): both real browser identity persistence and the actual Worker/PostgreSQL ownership enforcement are now attested. Existing C1 actual iframe record CRUD and two-viewer isolation also re-passed in the same deployment.
- Free-only resumed paid-source QA path: signed existing Job with saved generated source (revision>=2, step>=2, CODING, no current QA receipt) can requeue **only FREE Docker QA** from the original web UI on explicit resume; it never generates a new source or initiates a paid model call. Source guard and tests passed in #41262716623. This path is not a substitute for proving a real lost-network-response recovery scenario.
- C2 **scoped original-browser identity + same-PostgreSQL-Job resume = verified PASS**; further full five-core signoff still requires true owner continuity after a paid interrupted model call and autonomous C4/C5 repair. Temporary one-shot GitHub Actions signer remains intentionally nonportable: never save that private key to a public artifact or claim recovery of the old abandoned 76c ephemeral-owner Job.


### 2026-11-01 — C5 source-lineage-fenced real QA repair policy: free CI PASS

- **Fixed active paid REPAIR admission**, not just a stand-alone test: `src/edge/free-ci-ai-code.ts` now joins actual owner/Job OIDC free-CI QA receipt rows to their immutable `appf2_agent_project_snapshot` records and reads `project_revision` and `parent_hash`. `src/platform/agent/free-ci-repair-policy.ts` requires every counted consecutive failure to follow the current source hash → exact previous parent hash, revision N → N−1, and exact original frozen QA plan. A missing receipt, fork, duplicate, forged snapshot revision, UNTESTED-only receipt or mismatched current source terminates the streak; these cannot trigger a paid strategy change.
- **Tests** `tests/api/sp35-free-ci-multi-repair.api.test.ts`: three valid linked failed versions switch on round 3, while a fork, missing intermediate revision, wrong current head and malformed/UNTESTED-only evidence do not. Owner budget still requires 44/60/76 cents cumulative authorization, immutable `repair_v1/v2/v3` call keys, max eight steps. **Free Docker/Chromium CI [#41265696552](https://github.com/NFF98/appf2-build/actions/runs/41265696552) completed SUCCESS.** No model charged by this test.
- **Live Staging DB spot-check** found a real failed AI-generated project's current OIDC receipt bound to source revision 2 and its snapshot parent (original Job already had `sp35_free_ai_qa_v1` and `sp35_free_ai_code_v1` successful). This is genuine *first-failure evidence*; do not claim a paid REPAIR or a third-failure strategy switch occurred. C4 GPT-6 paid repair and C5 multi-failure → strategy change → browser PASS still require their own real receipts. Original PR #419; no main merge, new PR or production deployment.


### 2026-11-01 — C4 true browser failure diagnostics + C5 non-stalled progress + paid E2E safe recovery (awaiting deployed proof)

- The latest already-deployed C5 immutable source-revision lineage policy was verified by real free Staging deployment [#41266243844](https://github.com/NFF98/appf2-build/actions/runs/41266243844) **SUCCESS**. This is a free Staging deploy, **not** a real model-repair claim.
- **C4 code now records a bounded independent Chromium failure reason**, `TARGET_MISSING_OR_AMBIGUOUS`, `STEP_FAILED`, `ASSERTION_FAILED`, or `BROWSER_ERROR` on `FAIL` only. OIDC-authenticated QA receipts accept old three-field rows as before but reject arbitrary extra fields, raw page text, fake PASS diagnostics, and diagnostics on UNTESTED. GPT-6 REPAIR prompt may read this enum alongside the FROZEN original QA contract and original source. Never feed raw DOM, stack traces, private records, or external instructions into repair prompts. Owner UI renders plain-language explanations. A JavaScript `pageerror` during a real QA case forces FAIL even if the expected text became visible.
- **C5 now distinguishes a changed failure symptom from repeating the exact same failure**. The failure signature combines the failed criterion and its attested failure code; e.g. a repaired button that starts responding but displays incorrect text is *progress*, so it must not prematurely trigger `RETHINK_ROOT_CAUSE`. Existing receipts without codes use `UNKNOWN` and remain supported. Earlier source-parent lineage, unique model keys, owner-signed budget and eight-step fences are unchanged.
- **C4 live owner E2E harness now recovers the saved real GPT-6 result after a lost HTTP response** by reading the same saved Job revision/checkpoint before resending; 125-second POST timeouts keep the SAME Job and never authorize a new model reservation. It refuses partial odd checkpoints as uncertain. The one-shot paid test remains marker-gated and is **NOT rerun** by these changes.
- Changes are committed only to existing Build PR #419. New API regression tests enforce the bounded diagnostic codes, source-lineage and symptomatic progress. **Until the corresponding full CI and free Staging deploy complete, this entry is implementation evidence only**. The actual C4 GPT-6 paid FAIL→REPAIR→independent Chromium PASS and C5 three consecutive matching failures→new strategy→successful browser PASS are still NOT PROVEN. No Production deployment and no additional paid AI calls.


### 2026-11-01 — C4/C5 diagnostic and strategy regression verified on FREE CI; deployed Staging components

- GitHub source HEAD `a919d908` [free full CI #41266854961](https://github.com/NFF98/appf2-build/actions/runs/41266854961): **COMPLETED SUCCESS** including types, lint, API, runtime, multi-file browser, network-denied Docker Vite + Chromium, and Staging PostgreSQL→free Docker browser integration. This validates the bounded real Chrome failure code schema and repair policy regression tests; not a paid AI repair result.
- [Staging deploy #41266854896](https://github.com/NFF98/appf2-build/actions/runs/41266854896) at same source HEAD completed Worker+SPA deploy, live signed DB read/create, live C1 signed iframe CRUD viewer isolation and live C2 full Chromium process restart/same Job signer re-read; **final free GitHub dispatch/source/receipt step still in progress at verification time**, so do not mark whole deploy workflow PASS until GitHub concludes it.
- Browser QA now reports fixed reason codes on OIDC-signed failed cases (missing/ambiguous button, action error, assertion mismatch, page-runtime exception). The repair prompt consumes the bounded verified reason only, not raw untrusted DOM; failure reason changing signifies progress and resets C5 same-root stall count, with original immutable parent-linked project QA plan and cost guard unchanged. A page runtime exception blocks apparent visual PASS. Tests reject malformed diagnostic codes and fake PASS evidence.
- The marker-gated paid GPT-6 one-shot test harness now recovers an already-saved CODE/REPAIR source from the same owner Job after an HTTP timeout, and prevents a fresh model POST once the source revision/checkpoint is committed. **No paid AI called in this iteration**. Actual GPT-6 FAIL→paid REPAIR→independent Chrome PASS (C4) and 3 real linked failures→root-cause strategy change→Chrome PASS (C5) still NOT_PROVEN. Preserve prior real initial GPT-6 CODE→3/3 independent QA PASS and immutable private preview evidence as separate narrower success, never equate them to C4 repair.


### 2026-11-01 — ④ 真付費修復驗收實際失敗，不得標示 PASS

- One-shot real paid GPT-6 [GitHub #41267734119](https://github.com/NFF98/appf2-build/actions/runs/41267734119) created an owner-signed original PostgreSQL Job with six pre-code frozen criteria. `sp35_free_ai_code_v1=SUCCEEDED`; revision 2 saved and free Docker/Chromium independently returned **1 PASS / 5 FAIL** with bounded `ASSERTION_FAILED` diagnostics and a durable receipt. `sp35_free_ai_repair_v1=SUCCEEDED` also saved the paid GPT-6 repair RESPONSE in the model-call journal, **but did NOT save a new project revision**.
- The owner runner ended FAILURE because the next `/free-ai-stage` signed request got **HTTP503 AGENT_JOB_UNAVAILABLE**. Current original Job remains revision 2, 1 free CI receipt; no repair QA; no REPAIR v2/v3. This is **C4 incomplete and C5 not exercised**. The runner signing private key was ephemeral and is no longer available; do NOT impersonate creator, replay model POST, claim repaired source, or create a new paid job just to reset the evidence.
- Source inspection indicates a possible model-call request fingerprint mismatch on re-entry and/or persisted revision state transition; root cause is **not confirmed**. Commit `bddd873` adds only fixed, non-sensitive error classification at the owner-signed endpoint for request hash, checkpoint, CAS, source edit, and invalid paid source so the next authorized operation can identify its real blocker. It adds no new charge, keeps original owner proof required, and cannot recover an exited GitHub test runner's original private key.
- Acceptance still requires an *actual* same-Job revision-3/4 saved repaired source, fresh independent Chromium original-plan QA receipt for the new hash, all required PASS, plus for C5 three authentic consecutive failure snapshots → model strategy switch → eventual PASS. Existing successes for C1/C2/C3 stay valid and separate.


### 2026-11-01 — C4 503 待驗修復：已付費結果恢復，不靠新費用

- 「6 項」是單一四人計分板的獨立瀏覽器點擊驗收（首次 1 PASS／5 FAIL），**不是五核的 5 項驗收、不是產品 6/6，也不能替代完整產品 E2E**。
- 目前已證實 GPT-6 初次 CODE 和第一輪 REPAIR 兩筆回應在 PostgreSQL model journal 都為 SUCCEEDED；但原 Job revision 停在 2，repaired source 沒保存，原 signed harness 收到 HTTP503。其原 owner 簽章金鑰在那次 runner 退出後不可恢復，**不得自動重試該已付費呼叫、改 owner 或偽造 PASS**。
- 已實作 `recoveredPaidResponse`：若 model call 是 SUCCEEDED 且原建立者 PoP 已驗、`job_id`／`owner_anonymous_id`／`job_revision`／`checkpoint_hash`／模型／單次付費上限全部與原 Job 相符，直接取回同一筆已付款回應，無須重做模型 POST；新部署後 prompt 格式即使有改動，也不再先因重新計算的 request digest 不符就攔截**已完成**回應。對未完成的模型預約仍維持嚴格 request digest 比對。附上正常、異主、異 Job、版本或 checkpoint 不符、尚未完成等 fail-closed 測試。
- Commit `84b8830` 為實作；`b0904c0` 為新測試。此項尚未通過完整 CI／新實際 signed runner 重演時，**僅能稱修正已提交，不可稱 C4 PASS**。C5 真實 3 次連續失敗後策略切換與 Chromium PASS 仍未驗證；不要再把單一 App 六項功能當成五核完成比例。


### 2026-11-01 — C4 503 actual root cause confirmed and live PostgreSQL guard corrected

- **Confirmed from live `pg_get_functiondef('appf2_internal.agent_job_guard()')`**: original PostgreSQL BEFORE UPDATE guard omitted `CODING -> REPAIRING`, while `src/platform/agent/agent-contract.ts` explicitly permits it. GPT-6 initial CODE persisted Job revision 2; first paid REPAIR response SUCCEEDED in original owner-bound model call, but attempted `CODING -> REPAIRING` was rejected at the Postgres trigger, exposing HTTP 503 and preventing repair snapshot and re-QA. This is the precise blocking transition; not missing GPT-6 result or guessed network issue.
- **Applied actual DB correction via owner existing Supabase project**: added only `REPAIRING` to `CODING` transition allowance in `appf2_internal.agent_job_guard()`; preserved all identity/owner, revision +1, terminal-state, monotonic cost/tokens/steps, RLS and least-privilege restrictions. A subsequent live read of `pg_get_functiondef` confirms the previously missing transition is now allowed.
- **Committed migration** `supabase/migrations/20261101130000_sp35_agent_coding_repair_guard.sql` and matching checkpoint contract regression `tests/api/sp35-agent-db-repair-guard.api.test.ts`, in the original PR #419 only. Free CI pending at commit; the old test runner's ephemeral signing key is gone, so its already paid Job cannot be impersonated to retry. **C4 must still demonstrate a new owner-signed REPAIR response -> saved new source -> independent Chromium QA PASS to count complete; C5 still not proven.** No new paid AI calls, Production deploy, or new PR.


### 2026-11-01 — C4 database actual transition verification after 503 repair

- Live Supabase `appf2_internal.agent_job_guard()` was independently exercised on an **ephemeral TEMP TABLE with the exact production trigger attached**, inside `BEGIN ... ROLLBACK` (no real Job modified): synthetic revision 2 `CODING` → revision 3 `REPAIRING` → revision 4 `CODING` with monotonic step/token/spend **PASS**. Illegal direct `CODING` → `READY` produced the expected `APPF2_AGENT_ILLEGAL_STATE` and was rejected. Read-only production constraints/RLS remain unchanged. The free Docker/Chromium CI run [#41272081679](https://github.com/NFF98/appf2-build/actions/runs/41272081679) also concluded **SUCCESS** on commit `f930d528`.
- **Evidence boundary:** This verifies the previously missing database state transition and general free CI but does NOT prove that the old paid response (whose original owner signing key expired) was imported and saved on its exact Job. No new paid call, no fabricated owner signature, and no successful repair-after-failure Chromium receipt. **C4 still NOT FULL E2E PASS.** A new owner-signed no-charge saved-response fixture test would be needed to validate the full persistence path without another paid model call; eventual real-model C4 PASS must still use authentic owner-consented evidence.


### 2026-11-01 — C4 already-paid REPAIR half-checkpoint crash recovery committed; real E2E still blocked

- **Read current PR #419 and existing SSOT F/G; no new PR or SSOT created.** Verified actual staging PostgreSQL via the connected Supabase project: the corrected `appf2_internal.agent_job_guard()` includes `REPAIRING` in the allowed transition definition (function MD5 prefix `26e65b7799a6`). An independent SQL join of the **existing genuine paid REPAIR v1** and its original Job still shows **model `SUCCEEDED`, Job `CODING` revision 2 / step 2, exactly one free-CI QA receipt**. This old paid Job has not gained a new project version or repair QA receipt; the original one-shot owner's private key is unavailable. Never impersonate that owner or charge the model again to fake closure.
- **New C4 source repair in original Build PR #419:** commit [`bf4ce23`](https://github.com/NFF98/appf2-build/commit/bf4ce23e7ad4ee85c4c70a33f3f7c383617e2591) fixes the case where an already-paid response successfully commits its first `CODING→REPAIRING` checkpoint but its *second*, source-bearing `REPAIRING→CODING` CAS fails. A creator-PoP signed retry may read the existing `SUCCEEDED` model journal **only when the saved model's exact Job/owner/original checkpoint hash and revision match the committed parent**. It skips the already-completed first checkpoint, reapplies validated source edits, and writes the new immutable project source and Job pointer. The same recovery branch is forbidden from reserving or dispatching another paid model POST. It checks that the recorded independent QA failure and source lineage still bind the original frozen plan. Invalid source edits are now checked **before** entering the intermediate checkpoint.
- Commit [`e8a3b91`](https://github.com/NFF98/appf2-build/commit/e8a3b914516ea92427b9d22b5ade443fab373b41) adds no-cost contract regression for both original and one-step-advanced paid response recovery, and rejects wrong owner, checkpoint, changed project, wrong phase and nonterminal model rows.
- **Test truth:** The latest PR-triggered `CI Gate` [run #41273838549](https://github.com/NFF98/appf2-build/actions/runs/41273838549) failed at the existing **Human Task preflight before any typecheck/lint/tests**, so it supplies **NO proof** of this new code's build/test success; Governance/CodeQL are similarly failed, not passed. The independent free Foundation push workflow result and new Staging deployment are **not yet verified** in this entry. Do not claim this new patch is deployed or REAL E2E PASS.
- **Remaining exact C4 gate:** on a fresh originally owner-signed Job, genuinely failed Chromium acceptance must trigger a real consented paid REPAIR result, save the next immutable source revision back to the same Job, then independently pass every frozen Browser QA check. An already-paid receipt with an unrecoverable ephemeral owner cannot supply that proof. **C5 remains blocked by the absence of three genuine, same-lineage, consecutive failed project revisions and demonstrated root-cause strategy switching with subsequent QA PASS.** No new model request, paid Cloudflare service, Production release or PR merge was performed by these two source commits.



### 2026-11-01 — C4 actual free signed same-Job FAIL→saved repair→PASS; paid AI C4 still NOT PASS

- Existing PR #419 commit `aa6c796` corrected a genuine `recoveredPaidResponse` ESLint complexity=17 blocker without relaxing its signed owner, paid checkpoint or half-CAS authorization. The subsequent **full free Foundation [GitHub #41274139096](https://github.com/NFF98/appf2-build/actions/runs/41274139096) completed SUCCESS**, including actual TypeScript, Lint, platform compile, API/Runtime, locked Docker/Chromium and real Staging PG→free Docker pipeline. These are engineering gates; they do **not** prove a newly paid GPT-6 REPAIR actually saved source.
- **Actual owner-signed C4 free Staging live [GitHub #41274013856](https://github.com/NFF98/appf2-build/actions/runs/41274013856) completed SUCCESS**, run from the existing marker-gated `sp35-c4-free-repair-live-once.yml` and `deploy/scripts/sp35-c4-signed-fail-repair-pass-live.mjs`; **no new model charge**. A fresh nonexportable P-256 owner created one real original PostgreSQL Job with zero cents budget and a frozen browser click criterion. Authentic OIDC GitHub Runner + network-denied Docker + independently executed Chromium **FAIL** against deliberately defective creator-provided source at project revision 2. The *same owner and same Job* then saved corrected source with signed `/import-repair`, resulting in revision **4**, not a new Job. A second dedicated GitHub private free Docker/Chromium run [#41274265281](https://github.com/NFF98/appf2-build/actions/runs/41274265281) completed SUCCESS and the original DB Job gained a real independent **PASS** receipt for the changed hash. The original signed harness successfully reopened immutable private preview bytes twice and finished SUCCESS. Read-only Supabase SQL independently verified one Job revision 4, state CODING, exactly two time-ordered QA receipts **FAIL, PASS**, checkpoint spend **0**. C4 log explicitly says `C4 LIMIT: creator-provided repair, NOT automatic paid GPT-6 model repair`. This proves live saved-repair/retest transport and creator ownership, not the autonomous repair requirement.
- **Actual already-paid C4 Job remains distinct**: `sp35_free_ai_repair_v1=SUCCEEDED` but old Job revision 2 (original ephemeral owner PoP key is gone); it was not modified, replayed, or improperly claimed. New `bf4ce23` recovery code is now in PR with verified free Foundation; its full **post-deployment signed saved GPT-6 REPAIR→new source→Chromium PASS** proof still absent. The new no-charge Staging deploy [#41274139106](https://github.com/NFF98/appf2-build/actions/runs/41274139106) ran the Worker/SPA deploy stage and real signed PG checks; final workflow conclusion must be separately verified before claiming whole deployment SUCCESS.
- **C5** no genuine same-Job three consecutive independently failed **paid-model repair** snapshots nor automatic root-cause changed approach with subsequent real browser PASS. Prior policy/lineage API tests remain proven but cannot substitute C5 product E2E. Do not merge or deploy Production. No Cloudflare Containers/Browser Paid/extra paid GPT-6 calls were used in this batch.


### 2026-11-01 C4/C5 真實免費驗收追加（不得宣稱 GPT-6 自動修復或自動換策略 PASS）

- 本輪原 PR #419 Commit `46d1e5f`：修正五核原建立者真實 E2E 驗收器對已付款修復結果 `CODING→REPAIRING` 半完成 checkpoint 直接拒絕接續的問題。接續仍須相同原 owner、原 Job、不可變 SUCCEEDED model journal 與來源前置 hash；禁止重付費。此為程式修復，尚**沒有**新付費 GPT-6 自動修復寫回後 Chromium ALL PASS 證據。
- 既有付費修復 journal 在真實 Staging PostgreSQL 為 `sp35_free_ai_repair_v1=SUCCEEDED`，舊 Job 仍 revision=2，原測試 ephemeral P-256 私鑰已不存在，**不得**冒充 owner 或重送付費請求。已唯讀核對保存回應包含 `main_ts` 4,874 字及 `style_css` 6,836 字、恰有 2 欄，基本大小及無遠端 URL 防護檢查 PASS；不能由此推出可以繞過 owner 驗收。
- C5 新增同 PR `e165948` 測試程式、`6968de7` 原有免費 workflow 測試入口與 `a3150d9` ESLint 修正。真實 [免費 GitHub Actions #41275097325](https://github.com/NFF98/appf2-build/actions/runs/41275097325) **SUCCESS**：同一真實 P-256 owner、Job、同一份凍結 QA，三個不同不可變專案版本 revision **2、4、6**，獨立 Docker／Chromium 回寫相同 `ASSERTION_FAILED` 三次真實 FAIL；人工修改的 revision **8** 再次獨立 Docker／Chromium PASS，私有已保存 App 成功 reopening。模型付費呼叫 **0**。這只證明策略決策所需的「三次真實失敗＋原 Job 同版系」資料管線和免費 Browser QA；**沒有證明** GPT-6 根因分析、自動切換方案、任何付費模型重試、AI 自動修復後 PASS。C5 整項仍不得標示 FULL PASS。
- 前一輪 [Staging 真實部署 #41274139106](https://github.com/NFF98/appf2-build/actions/runs/41274139106) **SUCCESS**；[免費 CI #41274484003](https://github.com/NFF98/appf2-build/actions/runs/41274484003) **SUCCESS**。本輪新增腳本先使 #41275097224 的 lint FAIL，已用 `a3150d9` 修正，不得將舊 CI 當成目前最新提交的 PASS。
- 結論：C4 保存＋真 Chromium 管線已由**人工修復**證實，C5 三失敗歷程已由**人工修復**證實；C4 新付費 GPT-6 自動修復、C5 GPT-6 真的根因換策略仍欠實際同 Job E2E。舊一次授權支付不可當作可無限開新付費 Job；不重收舊費、不假報百分比、不合併、不部署 Production、不開新 PR。

- [本輪最終 C5 線上免費策略驗收 #41280692687](https://github.com/NFF98/appf2-build/actions/runs/41280692687) **SUCCESS**。這不是使用者網站任意需求 AI 自動修復已完成。因原已付款舊測試 Job 的 P-256 owner ephemeral key 無法取回，不得偷換 owner、直接操作舊 Job 或重新收費。⑤待有新明確費用批准後，以**新合法 owner Job**做最多一次 bounded 真 GPT-6 3 次修復及保存/瀏覽器驗收；在此之前不得宣稱完整 ⑤ PASS。\n\n### 2026-11-01 ④⑤免費產品級修復接續：已寫入原 PR #419，模型費用 0

- C4：原 Job 已付款 GPT-6.1 Sol 成功回應須用原建立者 PoP 金鑰才可兌換，舊 E2E ephemeral owner 金鑰已消失，不得冒領或重扣。先前 `46d1e5f` 修補半完成 checkpoint 的測試 runner 判斷。本輪新增 `c7c5292` 在正式 `runFreeCiAiStage` API 程式路徑回歸測試中，建立同原 owner、Job、已保存 `SUCCEEDED` paid response、`REPAIRING` 半完成 CAS 的模擬資料，驗證**直接接續原回應、僅執行一個來源寫回 CAS、revision 3→4、排入免費 QA、模型 network POST 次數 0**。這是有真實程式路徑的**免費 fixture 測試**，不是原失聯付費 Job 真實 Chromium PASS，不得報 C4 全部完成。
- C5：修復原 `free-ci-repair-policy.ts`，抽出**同一個** `analyzeFreeCiFailureStreak` 作為「只讀真實歷史判斷」，`decideFreeCiRepair` 繼續強制 44／60／76 美分逐回合成本上限及 max 8 durable steps，不能從查證直接啟動付費模型。Commit `7838a21`、`287f6d0`、`608fc15`；修輸入驗證分流及 TypeScript 錯誤 `975a67f`、`a916693`。新增原建立者簽署的 `/free-ai-repair-evidence` 路由，只讀真實 Job 對應、凍結原 QA、三份原專案血緣與 OIDC 真實 FAIL 收據，回傳 `RETHINK_ROOT_CAUSE` 或 `FIX_FAILED_CHECKS`、已證實失敗數；不收費、不修改 Job、不發布。
- 新增 `2bdf3f4` 真實 C5 見證檢查：原先三個免費 Docker／Chromium FAIL 後，必須從已部署的 Staging 輸入原 owner 簽章讀出相同正式策略引擎的 `RETHINK_ROOT_CAUSE`、`repeated_failure_count=3`、`paid_model_requests_issued_by_inspection=0`，再測第四版人工修復 PASS。原 workflow `a833f36` 已觸發 [#41280692687](https://github.com/NFF98/appf2-build/actions/runs/41280692687) 真實執行 **SUCCESS**：官方 log 06:27:49、06:32:00、06:35:00 UTC 證實 revision 2／4／6 各有一次獨立 Docker Chromium `ASSERTION_FAILED`；06:35:12 UTC 線上正式策略引擎 `RETHINK_ROOT_CAUSE` **PASS**，不是 mock 單元測試；06:38:15 UTC 人工改寫 source revision 8 的第四次 Chromium **PASS**，同一 Job 已保存、私有 App 可重新開啟。模型未呼叫。Staging PostgreSQL 唯讀覆核：revision 8、同 Job 4 份不可變 QA 收據、model journal 0 筆、批准成本 0、已記成本 0。**C5 根因策略『判斷』真實線上 PASS；C5 付費 GPT-6 自己依策略修復並成功仍未驗證**。
- 新策略 API 的 GitHub Actions Staging 部署 [#41280583924](https://github.com/NFF98/appf2-build/actions/runs/41280583924) 已通過 Worker Deploy 步驟，其他原有全鏈 E2E 步驟仍以 workflow 最終結論為準。無 Containers 費用、無 Browser Run 費用、無新的 GPT-6 請求。
- [最新免費完整 Foundation CI #41280798435](https://github.com/NFF98/appf2-build/actions/runs/41280798435) **SUCCESS**：TypeScript、ESLint、API（包括 C4 已付費原答案修復 CAS source write 與 C5 策略/費用分離）、runtime、免費 Docker Chromium／Staging 原 Job 驗證都按現有門檻 PASS；**沒有**因此取得新 paid GPT-6 E2E PASS。
- 目前五核狀態：C4 自動化**程式路徑**已修並有免費測試，不等於真 GPT-6 端到端成功；C5 三失敗實證已成立，線上共用策略判斷正在驗證，不等於 AI 已付費換策略或自主修復通過。不得做 Sprint 4、Production merge／發布、新 PR 或無授權付費模型呼叫。

### 2026-11-01 Sprint 3.5 C4/C5 最後兩個半完成 checkpoint 的免費接續修復（原 PR #419）

**只增補同一 SSOT，不新建 PR／不進 Sprint 4／不合併、發布 Production；本輪新增付費 AI 模型呼叫 0。**

- C4 **找出另一起可重現的保存中斷**：已付款 `CODE` 可能先提交 `CREATED→PLANNING` checkpoint，但 `PLANNING→CODING` 真程式來源 CAS 因 Worker 503 或中斷未執行。舊程式只接受 `CREATED` 且 revision=0，後續無法兌換同一個已存的 `SUCCEEDED` 模型結果。本輪 [`4dd999d`](https://github.com/NFF98/appf2-build/commit/4dd999d1933fae87e94668f6e4db72a44e1618e9) 擴充原 `recoveredPaidResponse` 和 `runFreeCiAiStage`：嚴格限原 owner、原 Job、原模型、原費用上限、原 `CREATED` checkpoint parent hash、`PLANNING` revision=1 與 step=1；只取原 `SUCCEEDED` 回應、不 reserve、不 provider POST、不重做第一 checkpoint，只完成來源 CAS 與派送免費 QA。維持舊 `REPAIRING` half-CAS 接續邏輯。[`a804cea`](https://github.com/NFF98/appf2-build/commit/a804cea5eaca18cdb772e7b9c61ae7bb98f067c3) 讓已保存的原建立者網站卡片也可走這條 `CODE` 半完成接續。無法合法恢復已丟失 owner P-256 私鑰的歷史測試 Job，**不得**冒名補寫或重計費。
- C4 免費回歸 [`9a8831b`](https://github.com/NFF98/appf2-build/commit/9a8831b09e85df86da7ca9d10c983b31d107f4b1)、[`2a2f9d3`](https://github.com/NFF98/appf2-build/commit/2a2f9d32ef561ddb2a5ef8d64a1bd92ca52608a4)、[`b781213`](https://github.com/NFF98/appf2-build/commit/b781213be12ed64984d6b6bdb61031cc8df3a918)：針對 `PLANNING` 只完成一半時，真 `runFreeCiAiStage` API 程式路徑成功復用已存模型 JSON、保存程式新 revision 2、免費 QA 派發成功、`advanceDurableAgentJob` 只呼叫一次、`fetch` / 新付費 reservation 次數 0；對偽造 owner/parent/step/model 禁止兌換。既有 `REPAIRING` paid-source 恢復測試也保持通過。這些是**fixture 模擬中斷狀態後執行真程式邏輯的免費測試**，不是新付費 GPT-6 真實 E2E PASS。
- C5 [`d7f96fe`](https://github.com/NFF98/appf2-build/commit/d7f96fe1bb02f3008981adcc3ca229b0f3b77ad4) 將原 owner-signed `free-ai-repair-evidence` 零費用策略查證連至保存的 App；[`17e002e`](https://github.com/NFF98/appf2-build/commit/17e002e248475200433147e2550e6596385ec4e6) 要求第三輪付費修復前，須有同 Job／project hash／revision 的三份真實同源 Chromium FAIL，以及後端判定 `RETHINK_ROOT_CAUSE`，否則停止第三輪付費；原 frozen QA 不准重定義，原總預算 76 美分上限不變。先前真正免費 Staging [#41280692687](https://github.com/NFF98/appf2-build/actions/runs/41280692687) 已證實三次真 FAIL→同正式策略引擎 `RETHINK_ROOT_CAUSE`→人工修改 revision 8 browser PASS。仍**沒有** paid GPT-6 自己實際切策略及新 source Browser QA ALL PASS。
- 完整免費 Foundation CI **[#41282462347](https://github.com/NFF98/appf2-build/actions/runs/41282462347) SUCCESS**（HEAD `91abb239`）：TypeScript、ESLint、API（原 CODE/REPAIR 已存回應 CAS 中斷復原與 C5 策略 tests）、runtime、實際隔離 Docker + Chromium、Staging 簽章 Job→免費 GitHub Runner→原 Job QA 收據均 PASS。GitHub log 中 `sp35-c4-saved-paid-response-source-cas.api.test.ts` **2 tests PASS**、`sp35-agent-db-repair-guard.api.test.ts` **5 PASS**、`sp35-free-ci-multi-repair.api.test.ts` **7 PASS**。
- [`91abb239`](https://github.com/NFF98/appf2-build/commit/91abb239d3f8fcdc3781dc3141acb7c759960f6a) 觸發同一現有 [免費 Staging Deploy #41282462301](https://github.com/NFF98/appf2-build/actions/runs/41282462301)。**整個免費部署工作流 SUCCESS（2026-11-01 06:58:11 UTC）**：TypeScript + Lint／Worker+SPA 正式更新 Staging、簽章 PostgreSQL CREATE/REOPEN PASS、C1 Chromium 兩 viewer CRUD + RLS PASS（06:54:24 UTC）、C2 完全關閉／重開 Chromium 原 owner P-256 身分及保存 source hash PASS（06:54:54 UTC）、原 Job signed OIDC→免費 GitHub Docker→真 Chromium QA→原 Job 收據 PASS（06:58:11 UTC），[實際免費 Runner #41282774258](https://github.com/NFF98/appf2-build/actions/runs/41282774258) **SUCCESS**。此次模型端只有 GET /v1/models/gpt-6.1-sol HTTP200 存取查證，無任何新 Responses POST、無 model token 使用；付費 GPT-6 真修復仍不是這個免費測試所證明。未建 Cloudflare Containers、未用付費 Browser Run、未跑新的 GPT-6 模型請求。
- **仍未達成完整 C4/C5 真 paid E2E**：舊已付款測試遺失原建立者 P-256 金鑰，無法合法替它寫回；新的真 GPT-6 自主修復測試需要新 owner Job 與**重新明確授權**的一次費用上限（既有一次性 76 美分授權已用），不能自行重啟或改稱免費 fixture 為 paid PASS。此前通過的免費 ④／⑤證據必須保留，不得回報五核 100% 或抹除已驗證進展。

## G. 執行交接（只寫已證實事實）

| 關卡 | 真實狀態 | 證據／下一阻斷 |
| --- | --- | --- |
| SPEC / 命名 | **完成計畫文件提交**；非產品完成 | Design PR #45 H-001 §0 已更新免費路線於 `a9651594baf79753a05b1f608466cbc93a316c51`；Build PR #419 本檔 |
| D0 | **DONE — 真 Staging 第一雲端阻斷已定位** | F.2 / run #41167547686：Health UP，Agent Readiness HTTP 404，private Sandbox / Browser QA Workers NOT_LISTED，Cloudflare plan 403 UNKNOWN；不重做已成功的原程式 |
| D1 | **PARTIAL — 新 Agent Staging + 保密 Job→免費 Runner→PG 收據已實際 PASS** | F.11–F.13 / #41196371312、#41196844121；舊 `FREE_CI_NOT_CONNECTED`／未部署說法已過期；仍須 GPT-6 真站鏈驗證 |
| D2 | **PASS — 指定 #1 AES 票券派發、#2 GPT-6 Runner 完成回原 Journal** | F.14 / 新真網站 #41252468840 原 Job QA/CODE 各 SUCCEEDED；Runner OIDC、單次 POST／response ID/usage 入 PG；對外 Worker/Model 無直連限制；原歷史 run 保持真實狀態 |
| D3 | **PASS（指定 #3：本次計數器 App 端到端生成、真 QA、公開卡片、兩獨立瀏覽器）；五核仍 PARTIAL** | F.14 / 原網站 #41252468840 真 QA 3/3 PASS＋新卡片 ACTIVE＋兩瀏覽器點擊完成但因 HTTP202 輪詢誤計數造成工作流最終 FAILURE；Build `fd44aa4` 修正假 FAIL；**零費重新驗證 #41253382674 全 workflow SUCCESS** 且新公開卡片兩新瀏覽器 GET-only PASS。任意全端 DB CRUD、失敗後真的 REPAIR 成功、策略切換仍無全核 E2E，嚴格 C1–C5 **0/5 full PASS**；指定 1–3 **3/3 PASS** |

**跨對話唯一口令：**「繼續 `SP35-FIVE-CORE-PRODUCT-CLOSEOUT` 的下一個未完成 D 關卡；先讀此檔 F/G 節與 PR #419 HEAD，只修首個真實 BLOCK，每次結尾報 C1–C5 的產品狀態與證據。」
