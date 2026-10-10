# GOV-CASE-T006-REBIND-001 / R4 — CI 證據可信來源候選 v1.0

**僅供 R4 隔離審議；未准許修改任何 .github / ci / harness 正式規則。**
Canonical Build base: `7bf5c9466e681719463560c2676ccb82ab097f0e`.
此文件解決的是「未來安全 Revalidation 輪次應怎麼生產並驗證真證據」，**不是**發行任何現成的 PASS。

## 一、GitHub SSOT 已實際觀測

1. 既有 `.github/workflows/ci.yml` (blob `fda7cec88a8740c84774bf1067e9f58136e9f0a4`) 目前 `permissions: contents: read`，有 `npm run gate`、Repo lint 和 Product CI；**沒有** GitHub Artifact Attestation 步驟，亦無 per-Acceptance machine-verifiable test result manifest。
2. 現行 `ci/run-product-ci.mjs` (blob `ea2b3acd74aeb866f3eb70ddbd7cb6cedf130567`) 在 `implementation_enabled=false` 返回 `PRODUCT CI: HOLD` 並以 exit 0 結束。**不能以 CI job success 當成任何安全 Acceptance 真正測試 PASS。**
3. T007 舊證據 `EV-SP-P1-003-T007-001` source_commit=`61108dabc153985b6689680577188a945153f05b`，locator 引用 Actions Run `37867961823`。GitHub API 當下獨立回讀 Run `head_sha=fe24c8711fa0b36e5c7b05aa404c310af922531a`、`conclusion=success`、`event=pull_request`、`workflow path=.github/workflows/ci.yml`、`run_attempt=1`、artifacts `[]`。**source_commit 不等於 head_sha**，因此新安全輪次需 exact SHA，但**不得把這條新要求倒套舊 T007**。
4. PR #364 的舊 head `e01b81b4b4fe744e0a0d56f0d22ff5eb0e756c46`：Governance / CodeQL / Attack Dry-run 成功，CI **曾在 ESLint 六個錯誤失敗**；後續 lint refactor commit `b7afb4f29b646a21ee3fc71524af6bde2554325f` GitHub Actions 四工作流程均 `completed/success`。這僅確認 PoC 審核檔案本身可通過 CI，**不是 protected candidate / product PASS**。

## 二、候選選路：GitHub Native Artifact Attestations（不自造信任根）

建議 L3 正式候選新增**受保護、只在 main push 的獨立 Revalidation Proof workflow**；必須先獨立完成 R4/R5 Human 和精確候選簽章批准，**不是此刻建立 workflow**。

必要限制：
- `on: push` 僅 `refs/heads/main`，需要 branch protection、Human 已批准的 Task 與 Build activation；不要使用可攜帶不可信 payload 的 PR 或 `workflow_dispatch` 來建立正式安全 PASS。
- 權限只給必須證明的 job：`contents: read`、`id-token: write`、`attestations: write`。這是新增 L3 授權面，禁止隱藏在現有一般 `ci.yml` 裡。Workflow / external actions 需 pin SHA、lock、Human approval。
- 真實 `npm run gate` 與**該 Task 所要求的 executable Test ID** 必須在此執行；任何 `HOLD`、`CONTROL-ONLY`、`N/A`、`skipped`、`unavailable`、`unknown` 都不得輸出可閉環的 PASS manifest。
- 由成功執行的可信測試 runner 產生 canonical `revalidation-proof.json`；內容含 exact repo/commit、workflow path/digest、run_id/attempt、approved Sprint/Task、source→target Baseline／Registry SHA256、每項 AC/Test 及 executable result、唯一 evidence_id；每項均需明示 executed `PASS`。不能由使用者/PR 直接提交一份聲稱 PASS 的 JSON 代替實際執行。
- 完成後以 GitHub `actions/attest@v4` 或已鎖定的正式版本簽署該產物的 digest。對 repo 工作流程的源與 runner 供應鏈仍需治理鎖定；不能只靠 attestation 證明測試語意正確。
- 獨立驗證器用受信任版本 GitHub CLI 的 `gh attestation verify`，要求 exact `--repo`、`--signer-workflow`、`--source-digest`、`--source-ref refs/heads/main`、`--deny-self-hosted-runners`、`--format json`；驗 certificate identity/timestamp 及 artifact digest，**不得信任來源工作流程可以自填的 statement.predicate 作為唯一權限來源**。
- 再以**新一次受權 GitHub API 查詢**交叉確認 run_id、workflow path/id、event=push、head_sha=所簽 source、run_attempt、completed/success、必要 job/step 成功；從受驗證的產物解析 Acceptance/Test 證明。API JSON cache 本身不是離線簽章，不能由任何注入 JSON 代替受信任網路查詢。
- replay 防護採主鏈不可回寫的 `(repo,run_id,attempt,evidence_id,task_id,baseline,acceptance_id)` 唯一 ledger/immutable transition；nonce 僅是輔助，不能只靠記憶體 Set。跨簽章、跨 owner、跨 baseline／PR fake success 均拒絕。
- 外部 Sigstore／GitHub/API 異常、artifact 不存在、digest 不合、簽署者不可信、缺任何 test 或 protected main 無法確認，一律 **FAIL CLOSED + Sprint HOLD**。無 fallback to `status:PASS`／hash-only／人工黏貼 locator。

> **GitHub 原生 attestation 證明「這些 bytes 是誰在哪個 Workflow 產生」而非「測試本身一定有安全語意」**。仍需守住可信 runner、測試定義不被非 owner 偷改、完整執行結果與任務合法性。

## 三、最小候選受保護路徑變更（修正先前「只有四檔就足夠」的假設）

現在可以更精確指出**至少還需要一條受保護的簽發者路徑**，故 v1.1 四檔 read/closure patch 只是 fail-closed compatibility stage。

| 檔案 | 要求 |
|---|---|
| `harness/scripts/validate-backlog.mjs` | 多輪 lineage／Exact Drift 綁定 |
| `harness/scripts/validate-sprint.mjs` | Old SP003 / New Sprint 唯一 round/owner |
| `harness/scripts/validate-change-scope.mjs` | Append-only status closure 的 exact 安全例外 |
| `harness/scripts/validate-evidence.mjs` | 新輪的真實 artifact verifier／run/Task/AC/Test 授權；舊 Evidence 不套新制 |
| **候選 `.github/workflows/revalidation-proof.yml`** | 新 protected main-only Workflow、授權簽章、產生真測試結果／attestation |
| **候選 `harness/scripts/verify-revalidation-attestation.mjs`** | 可信 Sigstore/GitHub/runner/verifier adapter，且由正式 Gate 在精確簽章授權後接入 |
| **可能** `harness/policy/*`、`ci/*` | 只在需要註冊信任來源/引入依賴且經 Human 精確鎖檔核准時加入 |

以上**候選**並非已批准 changed paths；該 workflow、verifier、可信分支／測試報告、重放 ledger、正式 hash/digest 尚未落地，**R4 to R5 readiness BLOCKED**。

## 四、BL-P1 實際新驗證義務，不准虛構證據

- BL008：`BS-P1-024 → BS-P1-025`，`F01-AC-017 ↔ TEST-F01-SEC-007`；舊 T007 `F01-AC-004` 永遠保留。
- BL010：`BS-P1-021 → BS-P1-025`，`F01-AC-013 ↔ TEST-F01-API-001`、`F01-AC-016 ↔ TEST-F01-API-003`。
- BL031：`BS-P1-001 → BS-P1-025`，`F07-AC-004 ↔ TEST-F07-004`。
- BL032：`BS-P1-004 → BS-P1-025` 後續 semantic drift=空集合，禁止重開。
- T008/T009/T010 在舊 PoC 只有**合成假代號**，不能當正式 owner。

## 五、Evidence 先決的 R4 Acceptance / Negative CI 驗收矩陣

必須至少有真實正向（一個新 Task 每項 executable Test 正式完成且有 verified artifact）及負向：workflow job success 但 Product HOLD、no test manifest、wrong source SHA、wrong ref/PR/fork、wrong Workflow signer、re-run attempt mismatch、wrong artifact digest、tampered test report、missing AC/Test、skipped/partial test、owner mismatch、nonce/replay、attestation missing/revoked、API unavailable、nonancestor source、untrusted predicate、foreign/prod DB authority、duplicate owner；每項都經真實 CI/Verifier fail closed，才可能把候選交 R4 Human 最終審議。

## 六、官方文件依據（文件研究，尚未啟用於 repo）

- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/use-artifact-attestations
- https://docs.github.com/en/actions/how-tos/secure-your-work/use-artifact-attestations/increase-security-rating
- https://cli.github.com/manual/gh_attestation_verify
- https://docs.github.com/en/rest/actions/workflow-runs
- https://docs.github.com/en/rest/repos/attestations

**決議建議：保留 v1.1 審查證據，將原本單憑合成簽章的方案降級為 TEST-ONLY，未來正式實作優先採 GitHub Native Attestation + 保護工作流程。R4 未獲核准；main HOLD、BS024 active、BS025 LOCKED、T006 BLOCKED、No Cursor/DB。**
