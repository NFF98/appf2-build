# GOV-CASE-T006-REBIND-001 — R4 v1.3 隔離 Verifier 實作與反方證據

**狀態：R4 Human decision PENDING；R5 不可進入；正式 L3 Amendment / production revalidation BLOCKED。**

## 不可改變的 authority 與 SSOT

- Human R1/R2 直接批准進入後一關；Human R3 v1.0 以 hash `c296035868e48fa187d5d089c83fc70ffb4d193d11c5cb3cf1b1ce8ee748be0a` 選 **C 隔離 PoC**，僅授權起草與審核 R4。
- 0/5 個可獨立驗證的 Human Ed25519 approval。Direct-chat approval 不等於 cryptographic signature，也不可藉 AI 共用 GitHub 身分代簽。
- canonical Build main `7bf5c9466e681719463560c2676ccb82ab097f0e`；`CURRENT=BS-P1-024`、BS025 LOCKED、T001/T007 CLOSED、T006 BLOCKED、Sprint HOLD、implementation_enabled=false。
- R4 v1.0/v1.1/v1.2 原版保留，**本版補強案卷是另加一個審議標的**，不是未經核准改寫。

## 新交付 1：真正可執行的隔離驗證器

`delivery/audits/R4-ATTESTATION-VERIFIER.mjs`
- 已用 Node v22.16.0 真實執行，GitHub readback blob 與本機 git hash-object 位元一致。
- Git blob `228708967c0e1a1a4272b104bde7f806e1449d5c`；UTF-8 SHA256 `1c9ea535239443f0be409d122865b8e1e332ad2972e8eeb6e2c4794c1f618528`。
- 核心：`gh attestation verify`（exact --repo、--signer-workflow、--source-digest、--source-ref、--deny-self-hosted-runners）並用 GitHub Actions Run API / exact run_attempt jobs 交叉驗證；每項 AC/Test 必須 executed=true、PASS、assertion_count>=1、skipped=0；Product CI 不得 HOLD/N/A；不接受錯 Workflow、PR-only success、假簽章 JSON、replay。
- 直接執行 `node delivery/audits/R4-ATTESTATION-VERIFIER.mjs verify` → **exit code 2 fail closed**。Production trusted approved expectation + immutable replay ledger 不存在，任何人不得藉此程式宣稱真實 PASS。

## 新交付 2：42 項實際 Node.js 攻擊與回歸測試

`delivery/audits/R4-ATTESTATION-VERIFIER-TEST.mjs`
- GitHub byte-exact blob `a1b9508c1d78e65c9ec8db7e45ea9ac650f86e68`；SHA256 `be2e834bfeb09b99578dd90430db313bfd4998c048912c3e953732ed0b57cf7c`。
- Local command `node delivery/audits/R4-ATTESTATION-VERIFIER-TEST.mjs` 結果 **42/42 matched**，其中 **2 個 mock positive、40 個 adversarial negative**。Local JSON result SHA256 `c47dbaf7073eddad70d0a50fb0dbaac6c3e80b73538e9d94f85570400ae61993`。
- 額外測試 `gh` CLI 命令參數必含全部精確約束，API 路徑不得偏移，run_attempt／Job attempt／step 唯一性、錯 evidence ID、空帳本或缺實物／CLI 全部負向 FAIL。
- `gh` CLI 未安裝於本機隔離 runner；**42/42 不是外部真 Sigstore/GitHub Artifact Attestation 的正向驗證，也不是 Human 簽名**。

## 新交付 3：GitHub Native Workflow 候選

`delivery/audits/R4-REVALIDATION-PROOF-WORKFLOW-CANDIDATE.yml`，SHA256 `f01419093a46e9843d1c1bbde0fdc92ec7624d6a71d7e720f90924740a523db0`。

僅存於 audit 區，**不是 .github/workflows 真實執行工作流**。設計為 main-only、最小 attestation 權限、先確認 exact Human-approved Task 才跑 Gate / executable test / emit per-Test manifest / sign。未實作的 protected preflight / runner / emitter、未以 commit SHA pin actions 之前不得啟用。

## 新交付 4：獨立真實 GitHub Run 反例

真實 PR #364 `CI Gate` run `38095337831` 回報 success，實際 `event=pull_request`、`path=.github/workflows/ci.yml`。以此 run/job metadata + **標示 synthetic 的 manifest 和 verified bundle** 餵給上面精確 GitHub blob 的 `inspectProof`，結果 **`UNTRUSTED_GITHUB_RUN`、ok=false**。證明「綠燈」不能升級成「可信新 Acceptance 證明」的拒絕規則會觸發。

具體測試證據：`delivery/audits/R4-ATTESTATION-VERIFIER-LOCAL-RESULTS.json`。

## 第三輪 BCE

**可稽核隔離交付：PASS。** 有實際 Node 42/42、原始碼 byte match、GitHub CI audit-only checks、Run metadata 真實負向、正式入口安全拒絕。

**R4 → R5 readiness：BLOCKED。** 尚無真實受保護 workflow、可信 Test runner／per-Test report emitter、受信任 expectation 簽署來源及 ledger、真實 GitHub attestation 正向測試、獨立 protected candidate 全檔 diff 與 CI/BCE。不能用 mock、synthetic T008/T009/T010、原本 19/19、42/42 取代。

**下一個 ACTION OWNER：ChatGPT Governance。** 限縮工作：先在隔離審核區實作 preflight + per-Test report emitter、signer workflow 完整候選及負向整合測試，再形成精確 protected L3 amendment draft；若取得 Human R4 獨立核准與有效簽章，才依憲法流程要求進入 R5，且另需 Human merge approval。

本版不授權：改動 protected `harness/`、`.github/`、`ci/`、Product Truth、正式 Task/Sprint、PG-001 DB/RLS/Worker、Cursor execution、GitHub merge。
