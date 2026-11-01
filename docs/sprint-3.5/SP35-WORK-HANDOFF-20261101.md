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
