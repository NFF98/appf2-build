# 2026-11-02 JST 最新 checkpoint：G5已付費成功、7/7、ACTIVE，但公開form互動FAIL，策略修正驗證中

**真產品仍2/9（22.2%），禁止加分。** Model G5 `8880979c-d09d-44ef-aaa7-bd114a31a967` **CODE SUCCEEDED**，1889 input/5042 output，max_charge20¢（不是invoice）；44¢Job cap。這是已批准7個/308¢中的**第1個paid Job**，後續6個名額264¢。舊32¢未決保留。**不要重送CODE，不要重生餐費**。

- 原生Cua Browser tab **1 / ownerTab**，已markHandoff，原owner非匯出式key/Job/QA全在同profile；不要關閉。tab **3 / mealPublicTab** 是已發布頁面，URL已實際開啟 `https://appf2-sp35-417-staging.juiyuang69.workers.dev/code/760b46d4-19b7-4092-b53a-d5276eaf9068`。
- Model [#41328942825](https://github.com/NFF98/appf2-build/actions/runs/41328942825) SUCCESS；6檔（3 TS模組）snapshot project `sha256:4ed7629c245c14fa76e68a145b38de5091fc26bb932ed6360445a296872fcf0d`，原碼永久保留。
- [Docker/獨立QA #41329192200](https://github.com/NFF98/appf2-build/actions/runs/41329192200) SUCCESS，7/7；built artifact `sha256:278c251d4e04422fe5222ac66d0c4db2be27360dae340eab77ad3eacd9fc51fe`。
- 原owner UI另勾明確公開同意並發布，PG確認share `760b46d4-19b7-4092-b53a-d5276eaf9068` **ACTIVE/public_opt_in/同owner**，blueprint `sha256:1e8806cb43f40f6ddc7e1ee0fab35d76199fe6a1a3b3141ee4a8f7ac1c842be1`。**只ACTIVE不算產品成功**。
- [免費獨立公開訪客 #41329592905](https://github.com/NFF98/appf2-build/actions/runs/41329592905) **FAIL**：1000/4/10填好點計算，沒有1100。Cua在公開tab3與私人tab1都真重現，未假PASS。
- 根因已分析：原Vite JS 5871字完整包於公開13619字JS（起點7749），沒有漏原碼；計算listener綁form submit。sandbox **allow-scripts** 會在派發submit之前拒絕原生forms，普通plain-page QA因而不代表真sandbox（HTML標準）。不應付費重寫餐費邏輯或偷偷加allow-forms。
- Design #45 **§0.21 SPEC first**（6b149c0），在兩輪入口修復後換**通用受信任DOM事件適配策略**：submit button真click→preventDefault原生動作→驗證欄位→在同opaque frame派發cancelable SubmitEvent。**不加allow-forms/same-origin、不改CSP禁網/禁form-action、不動AI artifact/code/hash**；私人和公開frame共用固定adapter、各加精確CSP hash；原source/Job保留，新增模型0。
- Build已有 `src/app/runtime/code-dom-events.ts` + public/private renderer；可信免費因果/安全實驗 `deploy/scripts/sp35-no-network-form-events-e2e.mjs`（無adapter負例、public/private計算/重設、invalid驗證、click preventDefault不重複、惡意_top/_blank表單不能送網路）。它使用同實際renderer，不執行App特定計算以冒充產品。
- 最終策略候選 HEAD **412de4c4e7274dac913a528e96cb357f9ad84b42**，免費Foundation **#41330733610**、Staging **#41330733503** 執行中，需讀最終結論。早先c16d6ea跑的lint FAIL（私有CSP漏引用eventHash、fixture max-depth）已精確修正，不能改稱PASS。沒有新增App/費用。
- **接續**：若免費因果/安全實驗SUCCESS且Staging完整SUCCESS，先reload **公開tab3**（只重開既有card、0AI）按相同1000/4/10證明1100/275；保留owner tab1不生成新Job。再用GitHub `rerun_workflow_job` **只重跑 #41329592905的published-recipient-free-only那個免費job**（先fetch jobs取id；其他paid jobs全部SKIPPED，不重跑整個paid workflow）。測試腳本含100/3/5 holdout、錯誤/重設/reload/0generation。新公開完整PASS+PG同hash不變才3/9。
- 策略實驗FAIL時保留原證據，先根因分析，不假PASS。後續六件原文/42條QA已在§0.19和manifest，依下方詳細指南逐一同owner原生UI推進。持續到9/9或真實超額/不可解阻斷；不再重問這7件已批准費用。

---

# 2026-11-02 JST — 正在執行，最新狀態優先於下方舊交接

Human已回覆「批准繼續做完全部」。已在Design #45 H-001 §0.17記錄有限上限：**剩餘7個新paid Job，每個≤44¢，合計≤308¢**，一次一個，不限額重問、不批次並發；舊32¢未決風險另列、不重送。原產品仍**2/9（22.2%）**，到真ACTIVE＋獨立新browser通過才加分。

## 活動中的原生owner與真模型（不可重建或再付CODE）

- **持續cloud Browser tab 1**，handle `ownerTab`，URL `https://appf2-sp35-417-staging.juiyuang69.workers.dev/`，已markHandoff。原需求「餐費分攤工具」及原始7條QA已從網站UI填入，5項同意已勾、Job cap44¢。只透過UI操作，不讀取/匯出私鑰。保持tab/profile，不要關閉或初始化另一個代替owner；在後續turn先按cua文檔恢復既有tab1、重新markHandoff。
- **新G5原Job `8880979c-d09d-44ef-aaa7-bd114a31a967`**，原prompt request_hash `sha256:cbfb7a6ec51fc4d0ad55156b4d063f42fe9afb2225b46e644985164ff5229714`，原始7條QA已入庫。Model `sp35_free_ai_code_v1` **IN_FLIGHT，20¢ max_charge**，實扣NOT_VERIFIED，整Job44¢。**禁止另建同prompt付費Job或重跑CODE**。
- [真模型 Runner #41328942825](https://github.com/NFF98/appf2-build/actions/runs/41328942825) private-paid-ai正執行唯一一次model POST。下一步只讀journal/Runner/原tab狀態；等源碼保存及免費Docker/獨立QA結果。未知結果不POST重送。
- 0/7後續真正PASS尚未增加；本輪paid Job額度占用1×44¢（後續6個名額264¢），單次CODE上限20¢只是保留，不冒充invoice。

## 已完成兩輪集中修復及換策略（不要第三輪盲修）

- 第一根因：CREATE1400拒絕1950 bytes合法中文；§0.16最小4096修正、[Staging #41326481475](https://github.com/NFF98/appf2-build/actions/runs/41326481475) SUCCESS。
- 第二根因：free-ai-stage等完整800字原文路由仍1400。§0.18修為精確CREATE/publish/free-ai-stage/free-ai-repair-evidence/qa-generate4096，其餘1400/24000/200000不變，所有PoP/owner/QA/budget保留。FREE_ONLY停用的舊qa-generate仍提前均勻404（不開啟它、不為測試調安全順序）；正規啟用環境仍4096單元驗證。
- **最終完整免費** [Staging #41328297162](https://github.com/NFF98/appf2-build/actions/runs/41328297162) **SUCCESS**：所有實際啟用原文路由>1400<=4096錯PoP404，>4096拒絕413、agent-progress>1400仍413，停用legacy QA保持404，全部其餘免費回歸已核對。
- [Foundation #41328297159](https://github.com/NFF98/appf2-build/actions/runs/41328297159) SUCCESS；新測試腳本候選d3eeec9之 [Foundation #41328802733](https://github.com/NFF98/appf2-build/actions/runs/41328802733) 也SUCCESS。舊四Gate Human Task前檢實際FAIL，不報PASS、不阻本產品。
- 正式publish合約為**201 Created**（正確），接受200/201但必須ACTIVE真row+URL+新browser實際操作，不能只等200而誤報失敗。原QA7條不變。
- 前兩個UI入口嘗試無model POST：#41326123312取消前無matching Job；#41327212659之空Job `b439ed54-4a9a-4f2d-8a32-14c06df42d53` 有7 QA但model_call/runner_request=0，已取消原ephemeral waiter，Job/QA保留；不可冒充舊owner復原。它們沒有AI原始碼、不占paid名額，不許把它們當產品PASS。
- §0.20策略改為持續owner cloudtab保存原身份＋獨立免費CI訪客驗證，不再丟棄已付費owner。不要再盲目迴圈重新生成。

## 成功後及後續六件

1. 原owner tab1等同Job免費Docker收據**七項全部PASS**與實際預覽，再勾「我同意將目前這份經過完整QA的App公開發布」，點正式發布。讀UI錯誤，保持owner。4xx失敗閉鎖；5xx最多同owner/idempotency免費一次，不重做模型。
2. 獨立讀PG `appf2_code_app` 真ACTIVE/public_opt_in、source/QA/preview/blueprint hashes一致。取得**原tab真share link**，不要編造URL。
3. 已準備 `deploy/scripts/sp35-published-recipient-proof.mjs`，僅接受既有share UUID、白名單sample，完全0 generation；它在**新的Chromium process**實際操作公開原App/reload/reuse，DB類再第三個browser比隔離並觀察真records HTTP CRUD。原workflow `.github/workflows/sp35-one-paid-ai-real-e2e.yml` 之 `published-recipient-free-only` job等待固定share，目前env placeholder不是可用卡。
4. 將該原workflow此job兩個env設定真 `APPF2_SP35_SAMPLE: g5-meal` / `APPF2_EXISTING_SHARE_ID: 真UUID`，提交唯一 `[SP35-RECIPIENT-FREE-ONCE]` marker；**不包含任何PAID marker**。免費訪客全PASS+PG核帳後才3/9。
5. 其餘原自然需求/42 QA先凍於Design §0.19（commit48933e9），Build已有 `sp35-remaining-scenarios.mjs`，順序g6-length（工具）、g7-memory/g8-lights/g9-connect（遊戲）、g10-books/g11-water（真PG）。已用實際parseQaPlan免費驗6份/42條schema，原自然文<=800、各7 QA<=8steps。一次一個、各44¢、保留同原Job與所有source。每筆新Job前重核journal+7名額/308¢餘額，任何已付不重生。
6. 可用持續owner UI填下一原prompt+frozen plan（資料全在manifest），原Job keys保留；或已備妥逐一CI驗收腳本 `sp35-remaining-native-website-e2e.mjs`，但不可在owner尚IN_FLIGHT時並發新paid Job。優先保持owner可恢復的策略。原workflow之 `one-remaining-native-original-request` **只有**同次message含 `[SP35-REMAINING-PAID-ONE-SHOT]` 和一個 `[SP35-SAMPLE-g6-length]` 等才會paid；不要隨意觸發。所有free/paid marker必須分開。
7. 每個完成里程碑回報真x/9、evidence、max reservation vs invoice unknown、阻斷與下一步。失敗保留原Job，不改QA，不偽造PG owner，不超額、不第三輪盲修。只原#419/#45，不merge/Production/Sprint4。

---

# APPf2 Sprint 3.5 → ChatGPT Work execution handoff (2026-11-01)

**DO WORK, not a fresh planning discussion.** User has approved continuation and wants real products operational and real costs bounded. Only existing Build PR #419 and Design PR #45. Never Sprint 4, merge, Production deploy, prompt the user for CLI/Cursor/Work re-selection, or pretend CI-only checks are products.

## Single source of truth / permissions

- Build: https://github.com/NFF98/appf2-build/pull/419 ; branch `product/sprint-3.5-complex-intent-recovery-20261026`.
- Design: https://github.com/NFF98/appf2-design/pull/45 ; branch `product/blueprint-code-artifact-hybrid-20261028`; SPEC `working/architecture-evolution/BLUEPRINT-CODE-ARTIFACT-HYBRID.md` §0.12–0.14. **Spec first** for any change in acceptance/cost/architecture.
- Product SSOT: `docs/sprint-3.5/SP35-FIVE-CORE-PRODUCT-CLOSEOUT.md` (on Build #419).
- Exactly **2/9 real successful independent NEW AI-created products = 22.2%**; third PASS requires new distinct signed native website owner to generate APP and save code, frozen original 7/7 independent network-denied Docker+Chromium QA, **200/ACTIVE published new share card**, and **fresh stranger Chromium actually clicking the AI-authored published App** (including reload/reuse with **0 guest model requests**). Baseline 1 tool + 1 PostgreSQL CRUD. Original desired category mix 3 simple tools, 3 interactive games, 3 real PostgreSQL apps. No fixed fixtures, old public cards or 7/7 without publication may increase numerator.

## 413 incident, paid state, and current code

- Real G3 new AI Tic-Tac-Toe `31d6a1f4-df41-4c41-8f92-5800a937c7c7`: GPT code succeeded, 6 source files, isolated Chromium QA 7/7, original creator publication did **NOT** result in public link, no guest; owner ephemeral P-256 private key expired. Preserve only. Source Run https://github.com/NFF98/appf2-build/actions/runs/41311674915.
- Real G4 new AI stones game `7045a009-6bfc-4889-8f1b-df03ba93c406`: GPT code succeeded, 7 source files, original Chromium 7/7, **owner publish HTTP 413 AGENT_JOB_TOO_LARGE**, no share/guest; owner ephemeral P-256 expired. Source Run https://github.com/NFF98/appf2-build/actions/runs/41313398452 ; isolated QA https://github.com/NFF98/appf2-build/actions/runs/41313795170. No recovery with SQL/admin bypass; do not re-run model for these old jobs.
- Confirmed root cause: `src/edge/agent-jobs.ts` generic POST max 1400 bytes erroneously applied to `/publish-code-app`. Valid Chinese 800-char prompt plus metadata exceeds it **before auth**. SPEC §0.14 freezes exact publication route max **4096 raw bytes**, keeping other 1400/24000/200000 caps, owner P-256, same-Origin, unchanged QA hash/ACTIVE gating.
- Code patch on Build PR `c810ed8`; free unit `tests/api/sp35-agent-publication-size-limit.api.test.ts`; real staging readonly negative-PoP `deploy/scripts/sp35-staging-publish-size-readonly-smoke.mjs`; workflow `.github/workflows/sp35-staging-only.yml` runs real staging smoke AFTER deploy, no model.
- Early first staging one-shot run https://github.com/NFF98/appf2-build/actions/runs/41316281418 FAILED early on ESLint (2 game scripts max-depth + staging smoke Node globals), **not** a 413 logic failure. Precisely scoped lint fixes committed `4f3e97e`, `36823f4`, `e14a468`. Second isolated staging one-shot run **https://github.com/NFF98/appf2-build/actions/runs/41316476210** was started with one marker `[SP35-G0-FREE-STAGING-ONCE]`; Foundation https://github.com/NFF98/appf2-build/actions/runs/41316476230. Read actual final conclusions and live smoke evidence; if pending, continue in same work. These are **free** staging and QA, not new paid App.
- Cost: G3/G4 each 44c **per-Job maximum reservation** with one 20c successful CODE ceiling each; **NOT provider invoices**. Earlier November 1 total SUCCEEDED model ceiling was 188c before G3, and October 31 unresolved IN_FLIGHT/BLOCKED_UNCERTAIN 32c risk; read-only reconcile with Supabase `xxwnxetwufwyiisgaqhl`, never assume uncertain exposure is zero. User authorizes additional bounded progress but no unlimited spend; propose finite per-Job 44c and do not exceed without explicit approval. Never spawn multiple paid Jobs in a loop, retry an unresolved model call, or reset old ledger. Do not print secrets.

## Continue executing, not just reporting

1. Inspect latest existing two PR HEADs and SPEC. Inspect staging run #41316476210 logs/steps and free Foundation run #41316476230; fix real failures **within at most 2 focused evidence-backed repair rounds** in the SAME Build PR, SPEC first where appropriate. Do not repeatedly fire Workflows with old paid markers.
2. Verify in current **isolated Staging** `https://appf2-sp35-417-staging.juiyuang69.workers.dev` that invalid-PoP long Chinese share payload >1400 and <=4096 gets **404 not 413**; >4096 gets **413**; other Agent >1400 gets **413**; health/readiness 200. This is a SECURITY/INGRESS PASS only, NOT product 3/9.
3. Run free existing published-App multi-browser reuse to confirm no regression; never re-generate paid source to prove regression. If necessary adjust only deploy/tests code in existing PR.
4. After confirmed fix and **only with explicit finite budget for a new distinct creative App**, use native website owner P-256 consent to start one NEW model Job capped 44c. Freeze original 7 QA criteria based on human requirement BEFORE AI. Capture publish POST HTTP status/code and UI alert while the **original owner Chrome context remains alive**; on 5xx at most one same-owner same-idempotency free retry, 4xx FAIL_CLOSED. Require new published ACTIVE share URL and fresh separate visitor Chrome interacting with actual immutable App. Save jobId/shareId/Run IDs/console and evidence. Advance 2→3/9 only if ALL PASS.
5. Iterate one genuinely distinct App at a time toward 9/9 within user-approved costs; simple tools, games, and PostgreSQL apps. Each independent acceptance must prove original use case with functional actions, persistence for DB, share/reload, no fake App. Two repairs max before root-cause strategy switch. Never imply Work or CI will autonomously monitor for eternity; deliver saved handoff if session ends.
6. Every meaningful milestone report in Traditional Chinese concise **real product PASS x/9 (%), new job count, paid ceilings vs verified invoices, last error/code, next concrete action**. Do not claim success based only on unit/CI.

## Work products

- Commit changes only in Build PR #419 / Design PR #45; always cite GitHub Actions evidence and actual Postgres rows for count decisions.
- No merge, no Production deploy, no Sprint 4. Prioritize user-visible functional Stage A: one sentence → real interactive App card → saved, shared, reused.
- No asking user to open Cursor, paste PowerShell, or repeat context. If budget or external permissions really block, say the exact blocker and preserve the current version.


## Work 接管查證與下一筆費用暫停（2026-11-01，日本時間）

- **產品仍 2/9（22.2%）**。本 Work 新增 paid model POST = 0；沒有新 Job/ACTIVE share，不能升到3/9。
- 原 Staging [#41316476210](https://github.com/NFF98/appf2-build/actions/runs/41316476210) **completed/success**，已逐項核對全部 step 及完整 job logs；paid markers false、paid model jobs skipped。真 ingress：>1400且<=4096中文錯PoP為404；>4096及其他Agent>1400為413。視窗/全屏、舊卡重用、PG橋/兩次Chrome冷啟動等指定免費回歸 step成功。
- Foundation 原 #41316476230 是 **cancelled**，不可改寫為成功；同舊程式後續 [#41316637632](https://github.com/NFF98/appf2-build/actions/runs/41316637632) **SUCCESS**，types/lint/API/runtime/Docker/Chromium全部實際執行。
- **負面證據仍在**：Staging末段舊十八啦稽核刻意保存 TWO_PAIRS_TWELVE、TRIPLE_MUST_REROLL、結果/排行/規則缺頁；corrected live published card另外驗證成功。不能把workflow success說成所有舊App合格。既有CI Gate在 Human Task授權預檢失敗，完整舊Gate skipped；不是產品新測試PASS，不拿它阻擋本Sprint。
- Supabase只讀重新核帳：2026-11-01 UTC **12筆SUCCEEDED GPT-6.1-sol，model_call ceiling 228¢**；10/31兩筆IN_FLIGHT+兩筆BLOCKED_UNCERTAIN，各8¢共**32¢未決風險**。供應商實扣仍NOT_VERIFIED；最後成功model journal created_at=2026-11-01T13:54:54.797822Z。本Work沒有增加模型journal。禁止重送這四筆。
- G3/G4原44¢兩個獨立批准均已各自執行，不存在可推定的下一個44¢餘額。**下一新Job等待Human明確批准新增最高US$0.44**；舊32¢風險另列且不可當零。不要因「持續」字眼觸發paid marker。

### 已完成的下一款免費準備（不是產品PASS）

- SPEC first：Design #45 H-001 §0.15，commit b85cc1673012a5dae4009721930c4276d94c51a6，下一款**全新餐費分攤工具**，凍結七條原需求QA；不是重生已付井字棋/拿石頭。
- Build #419新增 `deploy/scripts/sp35-fifth-native-website-meal-tool-e2e.mjs`：真原生首頁owner、44¢ Job cap、七項QA、200發布診斷、ACTIVE link、**另一個全新Chromium process**填表/計算/錯誤/重設/reload再算，guest model/Job POST必須0；尚未執行paid path。
- 實際平台 `parseQaPlan` 本地檢查成功：7 criteria、最多6 steps、source_quote均來自原prompt；syntax與無授權拒絕檢查成功。欄位用number/spinbutton避免QA角色歧義。
- 原既有 `.github/workflows/sp35-one-paid-ai-real-e2e.yml` 已準備G5 job；最終免費 [#41317624931](https://github.com/NFF98/appf2-build/actions/runs/41317624931) g5-meal-free-preflight SUCCESS，syntax/frozen plan/未授權拒絕/Staging readiness GET 全成功，g5 paid及所有其他paid job **SKIPPED**。
- 最終工程候選HEAD `bd1e4b0ffe81fb260123f32038274ef982ba152f`；最終Foundation #41317625058 與live reuse #41317624981需依下面最終核對結果。文件追加commit只改交接/記錄，不啟動付費。

### 下一個Work直接接續指令

先讀本節、#419/#45最新HEAD與最終免費runs。若Human仍未批准**新的44¢單Job**，停在PAUSED_BUDGET，僅免費查修，**不提交paid marker、不新建付費Job**。批准後先只讀重核Supabase appf2_agent_model_call（包含原32¢風險，invoice未查仍標NOT_VERIFIED），再只於原 #419 的 `.github/workflows/sp35-one-paid-ai-real-e2e.yml` 加一行當次授權紀錄，以唯一 `[SP35-G5-MEAL-PAID-ONE-SHOT]` commit message啟動**一次**。不要rerun舊G3/G4/舊paid workflow。

持續等待原G5 Job/免費Docker Chromium，最多兩輪集中修復且不超44¢、未知模型結果不得POST重送。必須核對該**新**job source/version、原凍結7/7 QA、200 ACTIVE新share、PG真ACTIVE/hash，以及新的獨立Chromium實際填表/算1100與275、600/3=200、零人拒絕、重設、reload再算、guest生成0。全部通過才+1為3/9；若失敗保留原Job/source/receipt及HTTP錯誤，在同PR分析根因。只Sprint3.5、不新PR、不merge、不Production。

### 最終免費結果（本Work已核對，非新產品驗收）

- [Foundation #41317625058](https://github.com/NFF98/appf2-build/actions/runs/41317625058) **completed/success**：精確工程候選 bd1e4b0 types/lint/build/API/runtime、temporal QA、多檔/browser、network-denied Docker、真Staging Job→Docker全完成。
- [Live published reuse #41317624981](https://github.com/NFF98/appf2-build/actions/runs/41317624981) **completed/success**：既有App兩browser實際操作/reload與新Agent無同意零呼叫回歸。
- [G5免費預檢 #41317624931](https://github.com/NFF98/appf2-build/actions/runs/41317624931) **completed/success**；所有paid jobs skipped。沒有新AI Job、沒有新published card，所以仍2/9。
- 本輪沒有新的真產品故障需要集中修復；**阻斷是下一筆US$0.44新授權尚未取得**。原413修正已部署且免費驗證，不能拿免費PASS補分。最後ledger重核仍12筆/228¢ ceiling；invoice unknown；舊32¢ risk仍保留。
