# GOV-CASE-T006-REBIND-001 / R4 v1.1 — 隔離 PoC、新 Human 簽章與最小 Bootstrap 審議案卷

**HUMAN R4 DECISION: PENDING。** 已核准 R3 選 C「隔離 PoC」僅授權準備本 R4 案卷；**不授權正式 L3 修法、R5、Merge、Cursor、production DB 或 Task Activation**。本案獨立 BCE 結論為 **PoC structural CONDITIONAL PASS / R4 production-change readiness BLOCKED**。

## 1. 不得重審的已批准決策

- R1：Human 直接訊息核准 v1.0 / SHA256 `50f4a19124080876691563f01652ec82a72088afa1b258404ae27d057a43f453` / commit `fc538abb9d4f1838c3639e0a7fd818f26aab3ae5`，僅許 R2。
- R2：Human 直接訊息核准 v1.0 / SHA256 `88134edf64b5ddf2a61c1fed1a56dc73c8a58a32b654276b54380f37101ce141` / commit `17851adaff39bbd004e3235d7ed153edae7315ea`，僅許 R3。
- R3：Human 直接選 **C 隔離 PoC**，v1.0 / SHA256 `c296035868e48fa187d5d089c83fc70ffb4d193d11c5cb3cf1b1ce8ee748be0a` / commit `254c57a924839fb88a39748681ec628f9568dcfa`，僅許 R4 草案準備。
- 上述是三次不同 Human 聊天訊息核准，**截至 2026-10-11 已獨立核驗 R1/R2/R3 密碼學簽章：3/5；R4/R5 尚未簽署或核准**。AI 或同一 GitHub 帳號無權代簽。

## 2. Canonical GitHub exact source 與隔離分支

- Build main `7bf5c9466e681719463560c2676ccb82ab097f0e`（PoC 固定 base）；Design SSOT 原狀。R3 review PR #363 仍 DRAFT，不併入 R4。
- `BS-P1-025` LOCKED；`build-spec/CURRENT.active_baseline=BS-P1-024`；`implementation_enabled=false`；`CURRENT-SPRINT.status=HOLD`；T001/T007 CLOSED；T006 BLOCKED。
- 隔離分支 `governance/gov-case-t006-rebind-r4-isolated-poc-v1`，僅新增 `delivery/audits/` 及本案卷 `delivery/constitutional-dossiers/` 的**審議證據**；未觸碰 `harness/`、`ci/`、locked baseline、Task、evidence 正式史或 production DB。
- 檔案 SHA256 / Git blob SHA1 如下（UTF-8；digest 已在寫入 R4 案卷前以 GitHub 回讀 bytes 計算）：
  - `delivery/audits/GOV-CASE-T006-REBIND-001-R4-POC.mjs`: SHA256 `d955f1902e2fef72523fadb72bfcea0852661a2db9c4ad1170b84b17a66fe736`; git-blob `263cb94cdcee1bb149098a6ff5517ea0c4afa3c2`
  - `delivery/audits/GOV-CASE-T006-REBIND-001-R4-POC-RESULTS.json`: SHA256 `e2cc21acd0912f8a45612bba405eb32d728006a9badaf431dd471f56b59f3c99`; git-blob `e2f08ecc05c7401506957cd062c5b03a835724a2`
  - `delivery/audits/GOV-CASE-T006-REBIND-001-R4-PROTECTED-CANDIDATE-DIFF.md`: SHA256 `eb2578c8ed574ecbfd7a7db3c86f85a86b658c6e0563f70f32981e6e898f9ef5`; git-blob `9f53c65d6501f9d86a945d7f39049fb2ac244970`
- **Review evidence set digest**（將以上三檔按 path 字母序串接 `path=sha256\n` 再 SHA-256）：`8f5dc607a36827d22a53675377194b3a3198f1a286672daf9427d5f104051809`。這是**隔離審議證據集合**，不是 R5 正式 protected-code `candidate_digest_sha256`；後者尚不存在，值必須維持 `null`。

## 3. 實際新版漂移與來源／目標／Test／Owner

| Backlog | 正式舊歷史（原文保留） | 新獨立 obligation | 合成 owner（不得當真） |
|---|---|---|---|
| BL-P1-008 | BS016→BS024 / SP003 T007 CLOSED / F01-AC-004 | BS024→BS025 / `F01-AC-017` / `TEST-F01-SEC-007` | 假設 SP004/T008 |
| BL-P1-010 | BS021 舊 T001 CLOSED 證據維持 | BS021→BS025 / `F01-AC-013/016` / `TEST-F01-API-001/003` | 假設 SP004/T009 |
| BL-P1-031 | BS001 舊 DONE 維持 | BS001→BS025 / `F07-AC-004` / `TEST-F07-004` | 假設 SP004/T010 |
| BL-P1-032 | BS003→BS004 / SP002 T001 CLOSED / F07-AC-008 | **無後續漂移，不產生新工作** | 無 |

**新 owner 只是 isolated TEST DOUBLE 代號**；任何實際新 Sprint、Task / Evidence ID，必須另行 Human 正式決定，不能自動啟動，也不能讓 T006 吞掉非 Stage A 安全工作。

## 4. PoC 實際正反測試與獨立 BCE

- 使用 GitHub connector 重新下載 canonical main 19 個實際 JSON，回讀 GitHub 上已提交的 PoC `.mjs` exact blob，在隔離 V8 執行同一組函式；**19/19 預期相符**，包含 2 個合成正向與 17 個負向。測試項目、預期／實際及每個 source blob 對應在上述 `R4-POC-RESULTS.json`。
- 正向：BL008 舊 T007 與新增 F01-017 兩輪並存、BL010/BL031 的精確新 drift、BL032 不重驗；僅在 **ISOLATED + TEST DOUBLE** 模式成立。
- 負向：無新證據、錯 source/target、PLANNED 冒充 CLOSED、Task 未結、重複 owner、缺失證據、假 evidence status、replay nonce、重用 Evidence、錯 registry digest、外來 Task、錯 Test ID、部分 drift；以及 **合成證據絕不應通過 PRODUCTION**。
- 獨立反方發現：最初版本 18/18 看似正常，但將 `test_double=false`、`independently_verified=true` 偽造後，`PRODUCTION` 會錯誤接受。此 attack **實際復現**，不是推測。修復隔離 PoC 後正式模式改為必須信任外部 `verifyEvidence` callback；未接上就全部 fail closed。以改後 GitHub blob 重新測得 **19/19**，偽造 boolean 攻擊被拒。
- **重大保留**：目前尚無接上真 GitHub CI／外部信任證明驗證器；沒有 Node CLI 真實運行 log、沒有真 PostgreSQL/RLS/Worker 測試、沒有新的 Product/CI 已簽署測試證據（R1–R3 Human 決策簽章屬不同證據）、T006 九項 executable tests 未完成。不得把這批結果寫成 Product/Protected Gate PASS。

### BCE 明確分項

- **PASS / evidence-bounded:** canonical drift 可重現；舊 revalidation 保留；同義 source/target/Acceptance/Test 驗證；錯誤 baseline、重放、重複認領之隔離拒絕；偽造 bool attack 經獨立反方測試並修正為 fail-closed。
- **BLOCKER / protected candidate:** 尚無完整可編譯且已實際跑 CI 的 L3 diff；真正外部 Evidence 可信驗證尚未串接，光有 `delivery/evidence/*.json` 的 `status:PASS` 不能當不可偽造的 CI 結論；舊來源完整 immutable blob 釘選、round digest/append-only transition 關閉審計仍須對正式 Gate 精確回歸。
- **BLOCKER / constitutional provenance:** R1–R3 直接 Human 核准及其 Ed25519 簽章已獨立核驗為 3/5；R4/R5 均尚未核准；尚未物化正式五關 constitutional docket。不可自行製作簽章、以 UI username 充當密碼學身份或假裝五關完成。

## 5. 純 L2 vs 最小 L3 的精確邊界

- 純 L2 的四種直覺方案在原 R3 5/5 source-condition tests 已實證無法保持舊 SP003 與新 BS025；R4 真實 registry 的 drift 分段再次證實問題。此結論僅排除已驗證變體，**不能聲稱否定所有可能 L2 設計**。
- **必須處理的 protected read-side**：`validate-backlog.mjs` 現只讀一筆 `item.revalidation`；`validate-sprint.mjs` 的 old/new Sprint owner resolution 也只讀該欄。若採 append-only multi-round 資料形狀，兩者語意均需限縮、fail-closed 的支援。
- **安全治理相關條件路徑**：`validate-change-scope.mjs` 目前 closure exception 僅處理單輪；`validate-evidence.mjs` 目前有 Evidence status、ancestor commit、映射、REVIEW Gate，但沒有已驗證的真實外部 proof resolver。可能還需受控 helper / wiring；不准預先虛構已足夠。
- **應保持不變**：`baseline-lineage.mjs` 的 acceptance drift comparator、憲法／簽章 Gate、CI 放行規則、BS024/025 immutable content，及 T001/T007 全部 CLOSED 歷史。

具體候選變更語意與 anchored `diff` 在 `R4-PROTECTED-CANDIDATE-DIFF.md`。**此為 review-only 非可套用草案**，因 production evidence 信任鏈缺口，本 R4 還不能形成可承擔 R5 授權的 protected code digest。Human 不得把目前的 evidence-set digest 誤用成 R5 protected candidate digest。

## 6. 風險／rollback／Human 界線

- Principal security risk：新資料以自稱 `PASS` 的紀錄、任意 hash、fake locator 或重放 Task 身分覆蓋安全義務；另有雙重 owner/舊 CLOSE 被改寫之風險。對上述任何情況採 fail-closed/HOLD。
- Pre-merge rollback：棄置 R4 隔離分支／Draft review PR 即可，不影響 main；沒有資料庫異動、不新增 Sprint activation、不發任何 `[APPF2-EXECUTE][APPROVED]` lease。
- Future post-merge rollback 必須另經 Human 審批，禁止改寫 T001/T007 已結案證據、強制 reset 或無審批降級 Gate。
- PG-001 Worker/RLS/PostgreSQL 與 T006 Stage A 的 9 個 executable tests 是**獨立**責任；本案不能替代其測試、核准或權限。

## 7. 交付給 Human 的 R4 v1.0 意思

本案供 Human **獨立審閱與提出修訂**，不偷渡 R4 approval。若問可否准予直接進 R5，獨立 BCE 意見是 **NO / HOLD**：必須先補完整可編譯的 exact L3 patch、外部 Evidence proof verifier、append-only closure 行為／回歸，產出真正 protected candidate SHA-256，並依法解決可靠的 Human Ed25519 審批來源。另需要正式 CI/BCE，不能以模擬 PoC 充數。

**R4 v1.1 REVIEW-ONLY；R4/R5 NOT APPROVED；R3 只授權到 R4 草案；GitHub main 與所有受保護 Gate 保持原樣。**


## 8. 2026-10-11 / R4 v1.1 補充：真實 Human R1–R3 簽章已獨立確認

- Human 經 Windows 本機工具各自確認及簽署 R1、R2、R3；使用者上傳的三份完整 `R1.signature.json`／`R2.signature.json`／`R3.signature.json` 已由 **Python cryptography Ed25519** 與 **Node.js crypto.verify** 各自重新驗證；不是靠工具自報 3/3。
- 三份 original approved dossier SHA256 及來源 Git commits 逐關吻合；R1→R2→R3 的 `previous_signature_sha256` 鏈一致，時間嚴格遞增；信任鍵 Fingerprint `67b77efc92f6e0296ef7841d916fd8bb95eef2a25711cfc31b9e45645e3a0076`，與 GitHub Actions CI #114354440983 環境公布的 Ed25519 公鑰及使用者現場 GitHub CLI inspect 比對一致。
- 獨立核驗鏈 SHA256 HEAD：`02c4aa57d8bf270429341b136bf53e6f6c807d2613b24c1ee065c337eaf21b74`；離線 adversarial test 1 synthetic valid + 13 mutated invalid = 14/14 符合預期。具體 receipt 檔案 SHA256、單關 Ed25519 signature SHA256、原始 Git blob、時間與來源載於 `delivery/audits/GOV-CASE-T006-REBIND-001-R1-R3-CRYPTOGRAPHIC-BCE.json`。
- **保護邊界**：PR #364 只記錄衍生驗證資料，尚未公開提交三份含 `signature_base64` 的正式收據；不能單靠這份摘要通過憲法 Docket。後續任何 protected PR 必須在獨立 Human 流程下將五關精確簽章及五份 canonical 案卷物化，再執行現有 `validate-constitutional-change.mjs`。

### 8.1 R4 現在的最小可決策範圍

**提案 A：只批准把「Phase A 信任 Bootstrap」列為 R5 下一輪獨立審查對象。** Exact proposed protected target 只有 `.github/workflows/revalidation-trust-bootstrap.yml`，審核來源 `delivery/audits/R4-TRUST-BOOTSTRAP-WORKFLOW-CANDIDATE.yml`，Git blob `f5fa3125a65eb4f5044b6543888a92d46afcc15e`；單檔 SHA256 `f5186b085b7e02a3e8faca28c6c2032518e067ad54ed70b4a53f4c08a8234ade`；exact proposed patch blob `38af563878488be9c8f0d22d7120bf2472efea5f`。

- Phase A workflow 只產生 `TRUST_BOOTSTRAP_ONLY` 證據，明示 `eligible_for_closure=false`、`product_ci_mode=NOT_EXECUTED`；**不能產生任何產品 PASS，不能關閉舊重驗或 T006**。
- Protected Main Ledger 與 Backlog／Scope／Evidence 三個 Gate 的接線都屬獨立 **Phase B**，不得藉 Phase A 核准偷渡。替代分支方案、Why5 與剩餘真實外部證明阻斷詳見 `delivery/audits/GOV-CASE-T006-REBIND-001-R4-PHASE-A-DECISION-REQUEST.md`。
- **R4 若獲 Human 獨立批准，最多僅推進 R5 精確審查，不等於 R5 批准，也不構成 PR merge、Workflow 安裝、任何 Sprint、BS025 或 T006 Cursor 執行授權。** R4 本身仍需 Human 本人對本最新版 canonical R4.md exact digest 簽署，絕不可沿用 R1–R3 私鑰回條冒認後續核准。

**R4 v1.1 HUMAN DECISION: PENDING；R1–R3 crypto 3/5；R4/R5 crypto PENDING；Build main 保持原樣。**
