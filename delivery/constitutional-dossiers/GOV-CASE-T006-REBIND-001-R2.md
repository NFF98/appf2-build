# GOV-CASE-T006-REBIND-001 — R2 事實覆核案卷（定稿候選 v1.0）

**R2 HUMAN DECISION: PENDING.** R1 已有 User 直接訊息批准進入 R2，但**獨立 Human Ed25519 簽章尚未提交／驗證**；不得宣稱憲法 L3 案件已有任何機器驗證簽章。此案卷與 R1 v1.0 彼此獨立，不改寫原 R1 文件、歷史證據或安全 Gate。

## 0. 精確案件與可驗證來源

- Case: `GOV-CASE-T006-REBIND-001`；R2 dossier_version: `v1.0`；R2 的最終 SHA256 以 **本文件入 GitHub 後回讀**為準。
- R1 原案卷 commit: `fc538abb9d4f1838c3639e0a7fd818f26aab3ae5`；SHA256: `50f4a19124080876691563f01652ec82a72088afa1b258404ae27d057a43f453`。Human 直接核准文字：「批准 GOV-CASE-T006-REBIND-001 / R1 / dossier_version=v1.0 / dossier_sha256=50f4a19124080876691563f01652ec82a72088afa1b258404ae27d057a43f453 / commit=fc538abb9d4f1838c3639e0a7fd818f26aab3ae5。僅批准進入 R2 事實覆核。」
- Build canonical `main=699eff7e088e1b5b741e9369f3f6a4596e794c9c` at evidence collection；Design `main=17a3a57f15c17a6240b887ee55a6ded64cdf7106`。任何 main 更新後應重抓 baseline before R3/constitutional R4-R5，不能假設仍是同一版本。
- Human-approved Design merge: PR37 `2e74ea19623c81261bf408856543717e943f6f51`; PR39 `17a3a57f15c17a6240b887ee55a6ded64cdf7106`；scope-clean frozen Design source `fda9045d0fc1b2b718d56ed49fa09abdce343a5c`。
- Human-approved locked Build Spec `BS-P1-025` aggregate SHA256 `f46e8ecdb9f183baf82d4a53e40fb61eaed9d340838373d515d10e7a73d342c5`；`BD-025 APPROVED`、`BF-054 BLOCKED`。
- Independent R2 audit PR #360 HEAD `33c76224ea656500044b2f0bcfb3e8b1aa09cd36`: `delivery/audits/GOV-CASE-T006-REBIND-001-R1-HUMAN-DECISION-RECEIPT.json`, `GOV-CASE-T006-REBIND-001-R2-FACT-CHECK.json`, `...R2-FACT-CHECK.md`. These are factual documents, **not approved/signature records**.

## 1. Canonical Repo 状態 — PASS (read-only verification)

- `build-spec/CURRENT.json`: `active_baseline=BS-P1-024`, `implementation_enabled=false`，**BS025 已 LOCKED 但並未啟用**。
- `delivery/CURRENT-SPRINT.json`: `status=HOLD`, `active_sprint=null`, `active_build_spec=null`, `active_task=null`。
- SP-P1-003 Tasks: `T001,T002,T003,T004,T005,T007=CLOSED`, `T006=BLOCKED`。不得重開、改寫或補簽既有已結案證據。
- `delivery/backlog/QUEUE.json`: 46 Backlog items，`21 DONE / 2 SPRINTED / 23 QUEUED`，歷史 Backlog 與現行 Task 仍是 BS-P1-024 選定狀態。
- CI run `38088567310` 為過去 implementation **enabled=true** 的 PR352 candidate `efaee1ae938c4e2d987ee91cd0b8f8ea22c96532`，非目前 HOLD 的執行證據。
- PG Draft PR #347 OPEN/DRAFT，不能自動視為已取得獨立 PG R4/R5 新候選權限，與本案分開。

## 2. Exact Acceptance / completed-history 差異（可反駁）

以 `BS-P1-024`→`BS-P1-025` 兩份 immutable machine-readable Registry、Canonical key-order object equality 比對：**10/307** Acceptance entries 改變：
`F01-AC-013`、`F01-AC-016`、`F01-AC-017`、`F05-AC-001`、`F05-AC-002`、`F05-AC-008`、`F05-AC-011`、`F05-AC-014`、`F07-AC-004`、`F12-AC-004`。

關鍵在 **歷史起點不同**。本輪已重新讀取 **12 個**涉及歷史 Task / Backlog 的 baseline Registry，使用與 `acceptanceSemanticDriftIds` 相同的完整物件比較方法：

| 記錄 | 歷史起點 | 至 BS025 的實際語意漂移 | R2 結論 |
| --- | --- | --- | --- |
| T001 CLOSED | BS-P1-021 | F01-AC-013、F01-AC-016 | 不能自動沿用舊 PASS，**不可改動原 Task** |
| T002 CLOSED | BS-P1-022 | 無 | 不需重驗 |
| T003 CLOSED | BS-P1-023 | 無 | 不需重驗 |
| T004、T005、T007 CLOSED | BS-P1-024 | 無 | 不需重驗 |
| BL-P1-008 DONE | BS-P1-016 | F01-AC-004、F01-AC-017 | 舊 T007 已驗證 004，**只有新 017** 需要額外新證據 |
| BL-P1-010 DONE | BS-P1-021 | F01-AC-013、F01-AC-016 | 需要新證據 |
| BL-P1-031 DONE | BS-P1-001 | F07-AC-004 | 需要新證據 |
| BL-P1-032 DONE | BS-P1-003 | F07-AC-008 | **反例：BS004 上已 revalidation CLOSED；BS004→BS025 無後續漂移，可保留 carry-forward** |

不准把 BL032 誤當新阻礙、不准把 T007 舊 `BL-P1-008.revalidation` 直接替換為 BS025 當作新驗證。

## 3. Existing Gate 驗證與 R1 假設修正

- `harness/scripts/baseline-lineage.mjs` 對每個 Acceptance 完整物件進行 stable-key 比對，`canPreserveCompletedBaseline` 若有任何 drift 則 false。**這個安全保護本身不是 Bug，不得為消除衝突直接刪掉**。
- `harness/scripts/validate-sprint.mjs` 對每個 CLOSED Task baseline 與 Sprint baseline 不同時，要求可保留的語意完全相等；T001 的兩個新 F01 Acceptance 使直上 BS025 的同 Sprint rebind 失敗。其歷史 carry-over 僅在不存在後續 drift 的受控 revalidation 條件下成立。
- `harness/scripts/validate-backlog.mjs` 目前只有一個 `item.revalidation` 欄位；它可驗證前一輪 CLOSED 證據被沿用，但新一輪額外 drift 需要新明確證據／Task owner。不能偷偷覆寫 BL008 的 T007。
- **反證 R1 W5 的過度推論**：`ci/run-product-ci.mjs` 在 `implementation_enabled=false` 時立刻回報 `PRODUCT CI: HOLD`；`ci/policy.json.activation_control_only_skip_product_ci=true`，經 `validate-change-scope.mjs` 獨立核准的精確純控制 rebaseline **可能在合法狀態下不要求 Product CI**。這不等於九個測試通過。
- 既有 CI run `38088567310` 的狀態是 implementation enabled，14 個治理驗證 PASS，Product CI 的 `validate-test-integrity.mjs` 回報 T006 九個 mapped `test()` 全為 `found 0` 而 FAIL。**那是啟用實作時的真實測試缺口，不是今天 HOLD 的 CI 無條件死鎖**。
- 若該案真正只需 L2 revalidation＋獨立允許測試實作的 Task/Activation，R3 應先試算現有機器 Gate 的合法新 Sprint 方案，不能預設要動受保護的 `harness/`；L3 的必要性 **NOT ESTABLISHED**。

## 4. 反方論證與未解除風險

1. **Counter-hypothesis：可能根本不用 L3 修法。** 以新 Sprint / 另行明確 F01/F07 revalidation 及舊 Task 永久留存的方式，或可通過既有 Gate。但需 R3 對 `validate-backlog/sprint/activation/change-scope` 的精確資料形狀做試算，**目前不能聲稱已通過**。
2. 反過來，BL008 只能有一個 `revalidation` 的資料模型，確實是多輪變更風險。需 R3 證明替代事件/證據模型是否可在不放寬上位 Gate 下運作。
3. 既有 `F05` Stage B 不可隨 T006 Stage A 激活；`content_hash` 不是讀取權限。PoP / Share owner-only / protected cache 真正的 Browser+DB 測試均 NOT_RUN。
4. 新憲法 protected change 若被選擇，要求 5 個分開的 **Human 自主 Ed25519 signatures**、exact R1–R5 dossier / base / candidate digest 和新的 merge approval。此聊天的 R1 文字不是 cryptographic signature，不能在 docket 偽裝成已滿足。
5. 若找不到可合法通過的路線，繼續 `HOLD`、不改舊 SSOT、不執行 Cursor 是正確回退。任何別的 Task 也不能被自動啟動。

## 5. R2 判定與下一關範圍

**R2 FACT CHECK = VERIFIED WITH MATERIAL CORRECTION TO R1 W5。** 事實未支持「所有 HOLD CI 必然失敗」「一定需要 L3 修改」兩項強說法。應接受可核查的具體漂移清單、現有保護和運作風險，但將「路線選擇」留在 R3。

**R2 Human approval 尚未收到**。批准 R2 只代表接受這份事實基礎、允許進入 R3 替代方案選擇，不等於批准任何憲法修訂／R3–R5／Rebaseline 激活／Task scope／Cursor lease／PG Production。

本案新 R2 Human 核准必須引用 `GOV-CASE-T006-REBIND-001 / R2 / dossier_version=v1.0`、經 GitHub 回讀的 SHA256 及 exact commit SHA；**不得重用 R1 核准、由 ChatGPT 代簽或回溯增補已鎖定文件**。
