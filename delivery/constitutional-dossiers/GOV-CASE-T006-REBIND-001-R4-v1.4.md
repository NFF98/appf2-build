# GOV-CASE-T006-REBIND-001 — R4 v1.4 / 第四輪 BCE 隔離整合結果

**R4 HUMAN APPROVAL = PENDING | R5 = NOT AUTHORIZED | L3 PROTECTED MODIFICATION = NONE | DEPLOY/PRODUCT EVIDENCE = BLOCKED**

### 固定邊界
- Canonical Build main `7bf5c9466e681719463560c2676ccb82ab097f0e`、BS024 active、BS025 LOCKED、Sprint HOLD、implementation false、T001/T007 CLOSED、T006 BLOCKED。
- Human 已在 R3（v1.0 SHA256 `c296035868e48fa187d5d089c83fc70ffb4d193d11c5cb3cf1b1ce8ee748be0a`）選擇 C「隔離 PoC」；僅允許準備 R4，無 R4 / R5 Human 核准。Ed25519 Human identity independently verified = 0/5。
- v1.0/v1.1/v1.2/v1.3 全部原文保留；此版僅追加新證據，不重寫舊批准。

### 實際已寫入 GitHub 的隔離執行成果

| 項目 | GitHub exact blob | SHA256 / 事實 |
|---|---|---|
| GitHub provenance verifier | `449b06d21a3930e12188a720e248595f44762e7b` | `a046824afd656e3529ad44cf7284c37ca79a3de3807e5c0703adc68f9e708232` |
| Verifier Node attack tests | `b6f2b5122b3955c480d05f2232eeabc0fafdc882` | `e5a283a2ee5da8e5480c182de3aaa1c9dde46cb204a0c82197f4b9c1fab96bfc`; **42/42**, 2 synthetic positive + 40 negative |
| Exact Vitest JSON proof emitter | `44def52b40c78382c4a7fb5fde920225464c52b3` | `70ba5d83e1756aa902f845b3746268d2a1ba4b03304a163d34f37bf3d94ccdc1` |
| Emitter Node negative tests | `040cf52e811d02ed278267e0b268a0c79ae9ef23` | `a137586ff45688fdac0a4b06ae6a3a649d90d8d02688ad5022509645a679a1c4`; **27/27**, 1 synthetic positive + 26 negative |

**本機實際 Node v22.16.0 合計 69/69**：3 個 TEST DOUBLE 正向、66 個負向。以上四份 GitHub readback blob 均與本機 `git hash-object` 匹配；不代表真實受信任新 Test 執行成功。Artifact Attestations 的 production signer workflow 根本尚未存在，因此 **real attested positive = 0**。

Verifier 會用 `gh attestation verify` 的 exact --repo / --signer-workflow / --source-digest / --source-ref / --deny-self-hosted-runners，再查 GitHub Runs & exact attempt Jobs；同時要求 Preflight、Governance Gate、Mapped Test、Emitter、Signer 五步成功。其獨立的 `verify` CLI production entry 故意 exit 2。Emitter 要求 Vitest 所有 assertion 真實 passed、正確 Test ID、無 skip / pending / failure，並核對 source ref / run；其 `emit` production entry 同樣 exit 2。

**真實 GitHub 反例**：Actions CI run `38095337831` 雖然 conclusion=success，但 `event=pull_request`、工作流 `ci.yml` 不是授權 `revalidation-proof.yml`，新版精確 verifier 仍拒絕 `UNTRUSTED_GITHUB_RUN`。該反例的 manifest 與 attestation 是明確的測試 DOUBLE，不是外部真正簽章。

### 建議的 protected Workflow（尚未安裝）
`delivery/audits/R4-REVALIDATION-PROOF-WORKFLOW-CANDIDATE.yml` SHA256 `f01419093a46e9843d1c1bbde0fdc92ec7624d6a71d7e720f90924740a523db0`。未修改 `.github/workflows/`；其 missing protected preflight、runner、emitter wrapper 及 Actions SHA pins 均不可自行假設完成。

### 獨立 BCE — 限縮結論
1. **隔離語意攻擊測試：PASS (69/69 LOCAL)。** 能區分 Github run success 和真正 attested Test PASS，直接正式入口拒絕安全越權。
2. **PR #364 Audit CI：須以 exact PR head 完整 GitHub workflow results 為準**，先前 Head 綠燈不能繼承到後續新 Head。
3. **正式 L3 protected Amendment：BLOCKED**。尚需 trusted approved expectation sourcing、new Task authorized preflight、production per-Test runner、signed artifact、protected workflow with pinned actions、persistent replay ledger、實際 GitHub/real Sigstore positive、完整 protected CI/BCE 及獨立 Human R1–R5 的可信簽署證據。
4. **保持 HOLD**：不要合併任何 Draft PR，不要改 protected harness/ci/.github 或產品真相，不要啟動 T008/009/010、T006 下一階段、Cursor/Watcher、production DB。

**NEXT ACTION OWNER = ChatGPT Governance。** 完成 protected preflight / approved expectation / replay ledger 的隔離端到端候選與實際 CI 正向路徑設計，再提出 R4 完整可審議版本。此前不升 R5。
