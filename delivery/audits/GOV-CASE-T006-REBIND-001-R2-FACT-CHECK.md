# GOV-CASE-T006-REBIND-001 — R2 獨立事實覆核紀錄（2026-10-11）

**R1 Human 決策：已明確核准進入 R2。** 證據為 User 的直接訊息，精確綁定 R1 v1.0 SHA256 `50f4a19124080876691563f01652ec82a72088afa1b258404ae27d057a43f453`、commit `fc538abb9d4f1838c3639e0a7fd818f26aab3ae5`。**Human Ed25519 獨立簽章尚未提交／驗證，不得把聊天核准冒稱五關密碼學簽章。** 原案卷不改寫。

## 1. 現行唯一真相

- Build `main=699eff7e088e1b5b741e9369f3f6a4596e794c9c`；Design `main=17a3a57f15c17a6240b887ee55a6ded64cdf7106`。
- Design PR37 `2e74ea19623c81261bf408856543717e943f6f51`、PR39 `17a3a57f15c17a6240b887ee55a6ded64cdf7106` 均 MERGED。
- BS-P1-025 正式 LOCKED，內容 aggregate SHA256 `f46e8ecdb9f183baf82d4a53e40fb61eaed9d340838373d515d10e7a73d342c5`，並非 active baseline；`build-spec/CURRENT.active_baseline=BS-P1-024`，`implementation_enabled=false`；Sprint `HOLD`，無 active Task。
- T001/T002/T003/T004/T005/T007 `CLOSED`；T006 `BLOCKED`，保持原有 Task 定義及九項 Test ID。
- `BD-025=APPROVED`，`BF-054=BLOCKED`；PG 憲法簽章、資料庫/Worker 安全與 Cursor 執行均未由 R1 核准。

## 2. 不只對比相鄰版本，也對比每個歷史起點

正式 BS-P1-024→025 Acceptance Registry 原物件比對：**307 條 registry 中 10 條語意改變**，ID 為 F01-AC-013/016/017、F05-AC-001/002/008/011/014、F07-AC-004、F12-AC-004。

但歷史 `CLOSED` Task 各自的 origin BS 不相同。已獨立讀取 12 個涉及 baseline 的 Registry，再以現行 `acceptanceSemanticDriftIds` 同等的整個物件比較：
- **T001 / BS-P1-021：F01-AC-013、F01-AC-016 兩項漂移。**
- **T002 / BS-P1-022、T003 / BS-P1-023、T004/T005/T007 / BS-P1-024：沒有任何新漂移。** 不准為了省事重開這些已結案工作。
- `BL-P1-008`：起始 BS-P1-016 至 025 共 F01-AC-004/017；**其中 004 已在 T007/BS024 revalidation CLOSED，僅 F01-AC-017 是本輪新增義務**。舊紀錄必須保留。
- `BL-P1-010`：F01-AC-013/016 需新驗證。
- `BL-P1-031`：F07-AC-004 需新驗證。
- **反證：BL-P1-032** 從 BS-P1-003 至 025 的 F07-AC-008 雖不同，但既有 BS-P1-004 revalidation CLOSED；BS004→025 **無後續漂移**，依法可 carry forward，**不得不必要地納入新 scope**。

## 3. CI 事實反證與修正 R1 的寬泛描述

`ci/run-product-ci.mjs` 第一個邊界：`!implementation_enabled` 時輸出 `PRODUCT CI: HOLD` 並結束，**不是 HOLD 下強制跑缺失的九項測試**。

`ci/policy.json.activation_control_only_skip_product_ci=true` 且 `validate-change-scope.mjs` 辨識精確、合法的 rebaseline activation；符合條件的**純控制變更**可以跳過 Product CI，不代表 product tests PASS，也不能自行放寬規則。

舊失敗 CI run `38088567310` 來自仍處於 `implementation_enabled=true` 的歷史 PR HEAD `efaee1ae938c4e2d987ee91cd0b8f8ea22c96532`，當時 14 道治理 gate 全 PASS；進 Product CI 對九個 T006 mapped `test()` 各報 `found 0`，因此失敗。它**不能用來斷言今日 HOLD 下所有治理 PR 都失敗**。

結論：目前必要的 protected-change 問題首先是 **T001 關閉歷史如何被保護、新一輪 revalidation 如何有獨立所有者及真證據**。Product CI activation 前置狀態不等於無條件死鎖；是否需要改 `harness/`/CI，應先在 R3 證明既有純 L2 新 Sprint／分離 revalidation 方案確實不足，而非預先認定 L3 必改。

## 4. R2 反方及不得越權

- **對 W4 保留 UNKNOWN：** 無已認證的原始產品決策史，不臆測單一 revalidation pointer 的歷史設計理由。
- **可不修 L3 的反案必須試算：** 新 Sprint 與獨立小範圍 F01/F07 revalidation 是否能只經普通受控 L2/Activation 成立、又不改寫既有 T001/T007 历史？目前尚未實證，列為 R3 待判定而非「一定不行」。
- **R1 直接核准 ≠ Ed25519 签章：** eventual protected-case dossier 還需五次獨立 Human stage 的密碼學簽章、exact base/candidate digest、CI/BCE 及獨立 Merge Approval。不能由 ChatGPT 代簽。
- **24 個攻擊案例**目前是規格矩陣，0 executed；無實際 DB/RLS/PoP/Playwright 或 T006 9 tests PASS。
- **絕不授權：** 修改 `harness/`/CI、為方便重綁覆寫 T001/T007、改舊 LOCKED Spec、偷偷納入 F05 Stage B、簽 PG 案、改正式 DB、觸發 Cursor lease。

**R2 BCE：事實比對完成，含 R1 W5 反證；R2 Human decision = PENDING。** 下一份 R2 v1.0 案卷供 Human 單獨核准；核准效力最多僅進入 R3 替代方案審查。
