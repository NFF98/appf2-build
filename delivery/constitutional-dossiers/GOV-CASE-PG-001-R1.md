# GOV-CASE-PG-001 — R1 根因／必要性定稿審議候選 v1.0

**狀態：R1 REVIEW CANDIDATE；NOT APPROVED；Human Ed25519 signatures 0/5。**
**本文件僅供 Human 在後續獨立訊息審議 R1，不能當作 Human 簽章、Cursor lease、正式修改許可、Merge、部署或 T006 Activation。**

## 0. 身分、固定事實與來源

- Case：`GOV-CASE-PG-001`；審議通道：[Build Issue #345](https://github.com/NFF98/appf2-build/issues/345)；法律：[GOV-CONST-001](../../../harness/policy/APPF2-CONSTITUTION.md)。
- 撰寫時 canonical Build `main`：`7bf5c9466e681719463560c2676ccb82ab097f0e`；`build-spec/CURRENT.active_baseline=BS-P1-024`、`implementation_enabled=false`；`CURRENT-SPRINT.status=HOLD`、無 active Task，T006 BLOCKED。
- 新的 PG-001 實際程式審查候選：[Draft PR #365](https://github.com/NFF98/appf2-build/pull/365)，HEAD `7547d5cbb15ca629f554ea162a542396ae5ef2f6`，12 個 changed paths；舊 PR #347 已 CLOSED、UNMERGED，不可直接合併或挪用簽章。
- BS-P1-025 已 LOCKED 但尚未正式 Activation；PG-001 L3 與 BS025→T006 rebind/activation L2 分案，後者的執行通道維持 [Issue #301](https://github.com/NFF98/appf2-build/issues/301)。
- Human 已授權建立 **Draft PR 候選**，不等於 R1–R5 的任何 Human stage approval 或 Merge 許可。此 R1 只審查「PG 受保護依賴／安全接線的必要性及根因」，不事先批准 12-file 差異。

## 1. 五個 WHY：現象、機制、證據

**W1｜可重現現象是什麼？**
此前真人 Browser 在靜態 Vite preview 對 `POST /api/v1/intents` 收到 404；不能因此宣稱 APPf2 已完成 Browser→F01→F02→F03→S03 可玩 App。先前 Supabase 10 個 APPf2 public 表的 read-only 盤點顯示 RLS 已開且沒有可用的普通 Worker 專用政策。隔離環境 PG-001 已證明有修復可行性，但尚未落地 main。
證據：[PG Case #345 R1 歷史觀測](https://github.com/NFF98/appf2-build/issues/345)、[真 DB／Worker 角色安全紀錄 #6097802221](https://github.com/NFF98/appf2-build/issues/345#issuecomment-6097802221)、[Draft #365](https://github.com/NFF98/appf2-build/pull/365)。注意這些不等於正式生產 DB 變更。

**W2｜直接技術機制為何？**
目前 main 有 Postgres repository 介面及 F01 HTTP handler，但缺已正式接入的 Worker DB transport／`pg` 依賴及正式 Host。若以 BYPASSRLS 的高權限連線權宜處理，資料權限就會偏離最小權限；若只切普通 NOBYPASSRLS 角色而沒有 GRANT／RLS Policy，真實寫入會 fail closed。靜態 Vite Preview 沒掛 API handler，也是先前 Browser 404 的直接原因，不能都歸因於缺 driver。
證據：main `package.json`、`src/platform/blueprint/postgres-blueprint-repository.ts`、`src/edge/intent-api.ts`、[Issue #345 技術盤點 #6097870851](https://github.com/NFF98/appf2-build/issues/345#issuecomment-6097870851)。

**W3｜真正缺哪個能力？**
需要可以被 CI、真 PostgreSQL 和真 HTTP 驗證的最小權限 Worker transport：`pg@8.23.0`、`@types/pg@8.23.1`、P-256 PoP、intent-scoped Cookie、同一 CREATE key 單持有人唯一索引、以 NOBYPASSRLS actor + transaction-local context 執行授權 SQL。候選 #365 有 F01 CREATE／重試／併發安全證據，但 **F02 admission role、Evidence context、Retention actor、/b 讀取授權、真正 Browser IndexedDB／LLM 品質與 F03→S03 都未完成**；不得以候選的 F01 PASS 代替完整產品驗收。
證據：[PR #365 差異／BCE Review](https://github.com/NFF98/appf2-build/pull/365)、[BS-P1-025 F01-API-ID-001A](../../../build-spec/baselines/BS-P1-025/functions/F01-INTENT-COMPILATION.md)。

**W4｜為什麼當初沒有？**
**UNKNOWN。** 可以證明 main 沒有這個完整正式接線，但沒有可信的原始決策紀錄，不能猜測當初團隊／架構師動機或歸責。

**W5｜為什麼不能由普通 T006 Cursor Task 直接補？**
`package.json` 屬 governance-only；`package-lock.json` 的依賴差異依法與其視為同一 L3 受保護單位。PR #365 exact HEAD 的 GitHub `governance` 與 `ci` 均因 `CONSTITUTION: exactly one changed human approval case docket required` 而 FAIL CLOSED；另外 `CURRENT-SPRINT.status=HOLD` 令 L1 implementation change-scope 不能合法 PASS。要求 Cursor 繞過 Gate、假造 Human Ed25519 stage proofs、直接把 Draft PR merge，均不合法。
證據：[憲法](../../../harness/policy/APPF2-CONSTITUTION.md) §§1–5、`harness/scripts/validate-constitutional-change.mjs`、`harness/scripts/validate-change-scope.mjs`、[PR #365 CI](https://github.com/NFF98/appf2-build/pull/365/checks)。

## 2. 不處理的代價、風險及最小路徑

- **不變更**：HOLD 安全保留，但 PG 正式接線與 T006 真可玩 App 驗收持續 BLOCKED。
- **Repo 外隔離 PoC**：已取得隔離 PostgreSQL／真 HTTP／PoP／NOBYPASSRLS 局部正面證據；可供驗證，但不能替代 main 的可重現正式產品路徑。
- **最小正式變更候選**：保持 #365 Draft，逐案核對其 12 檔差異、依賴版本和 row-level 權限；依憲法完成 R1→R5 的真人核准／簽章，再另行 CI、BCE、Human merge。PG 程式完成不會自動合法啟動 T006。
- **其他 Host/Provider／部署拓撲**：不是本 R1 的預設解答；Human 已選擇 Cloudflare Pages + 同一 Worker + Hyperdrive/pg/Supabase 方向，除非證據證明不可行，不重選架構。
- **權限與資料風險**：#365 migration 的 `REVOKE ... FROM anon,authenticated` 可能影響既有 Supabase PostgREST 行為；F02/Evidence/Retention 尚缺 production wiring；高權限 Hyperdrive 角色、錯誤的 `SECURITY DEFINER` 或過寬 RLS 都不得用作捷徑。部署前必須做真環境相容性、角色分離和 rollback 審查。
- **可回滾性**：此階段沒有執行 DDL；正式 R4 必須列出受影響 GRANT／Policy／Index／Role、既有資料碰撞預檢、可回退程序和對現有讀者的影響，R1 不能宣稱已驗證可回退。
- **證據等級**：Cursor 回報本機 TypeScript、Affected Tests、真 PostgreSQL 5/5 PASS（在舊 thumbprint 版本）；新 HEAD 互通測試 2/2 PASS，舊算法負向驗證 2/2 預期 FAIL。GitHub attack/CodeQL PASS；CI/governance FAIL CLOSED。新 SHA 沒重跑真 DB；也沒有真的 Browser/LLM E2E，不能補填成 PASS。

## 3. R1 擬審議決定（只有 Human 可作）

**可核准事項**：確認 PG 受保護依賴／最小權限接線值得立案、接受上面 5 Why／UNKNOWN 分類，**只允許進入 R2 獨立事實覆核準備**。

**不可核准事項**：R2/R3/R4/R5 提前通過、建立假的 Human 簽章、修改 `package.json`／lock／`harness/`、Merge #365、部署 Cloudflare／修改遠端 Supabase、放寬 CI/Scope Gate、啟動 T006 或 Closure。

- 本檔是 **review-only R1 dossier**，不是 `delivery/constitutional-cases/GOV-CASE-PG-001.json` 已簽署的審批紀錄，也不得加到產品 PR #365 偽裝成通過 Gate。
- Human 須先閱讀本定稿及固定 Git SHA/Hash，**另起單一直接訊息**表達 R1 的明確接受或否決；之後憲法機器簽章還需要 Human 專屬 Ed25519 身分證據，AI 不能代生私鑰或代簽。
- 此 R1 候選不會修改 main、PR #365、Issue #301 Watcher 或已 CLOSED 的 Task。No Merge / No Deploy / No T006 Activation / No Closure。
