# GOV-CASE-T006-REBIND-001 — R3 替代方案／路線選擇案卷（定稿候選 v1.0）

**HUMAN R3 ROUTE SELECTION: PENDING。** 這是供後續獨立 Human R3 核准的審議文件，不代表修憲、R4/R5、Build Activation、T006 或 Cursor 已被批准。

## 0. 精確核准來源與分工

- R1: Human 直接核准 `v1.0` SHA256 `50f4a19124080876691563f01652ec82a72088afa1b258404ae27d057a43f453` / commit `fc538abb9d4f1838c3639e0a7fd818f26aab3ae5`，僅許 R2。
- R2: Human 再以**獨立訊息**核准 `v1.0` SHA256 `88134edf64b5ddf2a61c1fed1a56dc73c8a58a32b654276b54380f37101ce141` / commit `17851adaff39bbd004e3235d7ed153edae7315ea`，僅許 R3 方案審查。
- Human 的聊天核准證實了意向，但**未提供獨立、可機器驗證的 Ed25519 簽章**；AI 透過 GitHub 貼出的收據亦非 Human 簽名。將來 protected R4/R5 精確候選若必須簽署，所有簽章真偽必須按憲法另行實證，不得填入假 digest、假 transcripts 或當作已有 2/5 crypto signatures。
- 本案只處理「歷史 revalidation 與新版本重綁的憲法／驗證機制」。PG-001 的 Worker / RLS / PostgreSQL protected case 另外審，不能相互借用簽章或權限。
- Build canonical main 在方案實證時 `aaf1af0fe55199bd142b33425227459f40338b97`；BS-P1-025 已 LOCKED，但 `build-spec/CURRENT.active_baseline=BS-P1-024`；`implementation_enabled=false`、Sprint `HOLD`、T006 `BLOCKED`、T001/T007 `CLOSED`。
- R3 source-condition evidence: Build audit-only PR #362 `d9ef70f6ba409ada584cdb0d3bf9ad5bd7482944`，三份 `delivery/audits/`，5 個 static source-condition cases 已**執行且符合預期**，**不是完整 `npm run gate` / 真 API/DB/E2E tests**。

## 1. R2 事實：需要解的最小範圍

- BS-P1-024→025 恰有十項 Acceptance 語意更動。T001 CLOSED 的 F01-AC-013/016 不可用舊 PASS 冒充新 PASS；其他 T002–T005/T007 CLOSED 未再改動，維持原狀。
- BL-P1-008 在舊 SP-P1-003 manifest 的 `revalidation_item_ids`。它的唯一 `item.revalidation` 對應舊 `BS-P1-024 / SP-P1-003 / T007 / F01-AC-004`、`CLOSED`。新 BS-P1-025 **另多一項 F01-AC-017**，需要獨立真實證據，不能取代 T007。
- BL-P1-010 需 F01-AC-013/016，BL-P1-031 需 F07-AC-004；BL-P1-032 過往 BS004 revalidation 有效且至 BS025 無後續漂移，**不應新開工作**。
- `harness/scripts/validate-sprint.mjs` 對舊 SP003 必須繼續認 `BL008.revalidation.target=BS024`、`sprint=SP003`；`harness/scripts/validate-backlog.mjs` 又對新的 current BS025 需要再驗 BL008 的 F01-AC-017，單一指標相互抵觸。
- **校正 CI 誤解**：`ci/run-product-ci.mjs` 在 HOLD 時返回 `PRODUCT CI: HOLD`；經現有 guard 辨識的合法控制型 rebaseline 能不宣稱 Product PASS 而跳過 Product CI。九個真正缺少的 T006 `test()` 是之後允許實作時須由 Cursor 完成的責任；不能用假 tests、關閉 Scanner 或推導「所有 HOLD CI 死鎖」。

## 2. 已執行的隔離來源條件 PoC 與限制

精確參照目前 GitHub `main` 的 `validate-backlog.mjs`、`validate-sprint.mjs`、`validate-change-scope.mjs` 邏輯及 canonical JSON，在**不改任何 repo 檔案**的隔離判斷中，五項 source-condition assertions 均為真（5/5）。

| Case | 嘗試 | 實證觀察 |
|---|---|---|
| `L2-001` | 原 BL008 保留 T007 舊 pointer | 舊 SP003 可以認，BS025 的新的 F01-017 義務沒有合法 revalidation target |
| `L2-002` | 用單一 pointer 改指 BS025/SP004 | 新版本 target 形式可對，舊 SP003 的原有 target/sprint 驗證失敗且會覆寫 T007 歷史 |
| `L2-003` | 只新增 SP004 | 不會改變 BL008 舊 pointer，新 Backlog 仍擋 |
| `L2-004` | 只新增 BL alias for F01-017 | BL008 本人依舊有未補的新版本漂移，且 duplicate coverage 另有風險 |
| `SAFE-005` | 完全留在 BS024/HOLD | 舊歷史仍有效，但 T006 不前進 |

**精確限制：** 5/5 是來源條件／canonical 資料的 deterministic match，非修改後跑 GitHub CI 的真環境 PASS；不能從這五例宣稱數學上否定所有可能的 L2 設計。需 R4 進一步正反測與確定差異。

## 3. R3 四種選擇與成本／回退性

| 路線 | 做什麼 | 安全性與代價 | 可回退性 |
|---|---|---|---|
| **A：不變更** | 維持 `HOLD` 與舊 CURRENT；不動驗證程式 | 不產生新安全缺口，但 T006 持續停擺 | 原地即安全狀態 |
| **B：純 L2 新 Sprint / BL 重排** | 不改 protected Gate，重新安排獨立證據 owner | 現已實證四種直覺變體不行；其他 L2 設計尚未證實，若貿然 Merge 會損害舊驗收 | 僅可做未合併 PoC，不可作正規 rebind |
| **C：先隔離 PoC（建議）** | 在**未合併／不啟動 Task**候選中具體設計「兩輪 append-only revalidation」，列清最小可能 protected 差異及負面測試，交 R4 精確審查 | 要做更多獨立審核，但能在觸碰 main 前驗證舊 T007、同源 hash、F01 新證據是否兼容 | 可丟棄分支，main、HOLD、歷史均不變 |
| **D：直接提最小 L3 正式修法** | 在未作完隔離驗證前就規劃 protected 變更，預計涉及 backlog/sprint validators及少量 control guard | 範圍可能較快固定，但風險是讓歷史已結案項目再次自動變 PASS；仍需依序五關 R1–R5 獨立 Human 決策、CI/BCE、另一次 Merge Approval | 直到 Merge 前可取消；Merge 後 rollback 亦須合法審核 |

**建議 Human R3 選 C，仍保留 A 作為失敗回退。** 選 C 只批准「繼續 R4 準備隔離 PoC 的精確候選 diff、攻擊案例與回退計畫」，**並不授權在 repo 的受保護 `harness/` / CI 正式主分支修改**，也不代表同時選 D。

## 4. 若選 C，R4 最小候選的原則（不是檔案變更授權）

1. **永遠保留**現有 `BL008.revalidation`、舊 `SP003`、T001/T007 CLOSED、T007 所有舊 evidence/registry links 原文；不可改寫、移除、搬移或冒稱新 PASS。
2. 用 append-only 的新輪紀錄綁定 `source_baseline`、`target_baseline`、exact source blob/digest、`acceptance_ids`、`test_ids`、`owner_task`、`evidence_ids`、狀態；不可用舊證據重簽新 drift。
3. 正向：BS024 舊 T007 已完成 + BS025 新 F01-017 proof 另行真實產生時，允許 *兩段各司其職* 的 lineage。負向：wrong source/target、partial drift、foreign Task、duplicate owner、replay、fake PASS、revoked Share、hash-only、DB unavailable 都應 fail closed。
4. 僅在**必要且經 R4 實證**時修改現有 L3 validator 的 read-side 支援及受控寫入白名單；Product Design/Registry 所有者維持既有權限，F05 Stage B 不偷渡 T006。
5. 真正的 T006 九項 executable test declarations 和 PostgreSQL 最小權限正向寫入證據都不得標示 PASS；Cursor 實作需合法單次 Lease，且 Human 本案先前只授權至執行前。
6. R4 形成**精確 changed files、base SHA、候選 digest、CI/攻擊測試、回退方案**；Human 獨立核准 R4 後才可準備 R5，R5 也不等於合併或 Cursor 啟動。任何可驗證 Human cryptographic signing 缺口都需先誠實揭露與補足，不能填假的 5/5。

## 5. 請 Human 對 R3 所做的唯一決策

可選 A、B、C 或 D，並明列 **Case `GOV-CASE-T006-REBIND-001` / R3 / `dossier_version=v1.0` / exact SHA256 / Git commit**。本案文件推薦 **C**（先隔離 PoC，R4 才提出最小具體規則），並不代替 Human 決策。

**R3 HUMAN APPROVAL = NOT RECEIVED；R4/R5、受保護修改、Build 重綁、Cursor 執行 = NOT AUTHORIZED。**
