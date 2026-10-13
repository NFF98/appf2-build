# SP-P1-003 行政結案候選 — 阻擋報告（HARD STOP）

- GOVERNANCE_AUTH_ID：`GOV-AUTH-20261014-SP3-CLOSE-01`
- AUTH_DIGEST：`sha256:06ad8a9bcc24ce193efb124dbfb5967918be71e672c671c70f9c9ce1c360cb4d`
- BASE_SHA：`38d2f8a3bbd484b98795f5140afcca29eb4bfa07`（canonical `main`，執行時已以 `git fetch` 確認相同）
- 分支：`governance/sp-p1-003-admin-closure-20261014`（僅本地候選；非 Merge、非結案事實）
- 產出者：Cursor（Execution Agent）。本報告**不是** Human 核准、**不是** Sprint／Task 結案、**不是** PASS 證明。

## 0. 結論（TL;DR）

依 BASE_SHA 上現行 canonical 規則，SP-P1-003 **不能**合法進入 `CLOSED`，也**不存在**任何「行政結案／帶 carry-forward GAP 結案」狀態或通道。依 lease 指示：**不標記 T006 或 Sprint 為 CLOSED**，僅寫入本阻擋報告與最小規則修正需求，並 **STOP**。

同時確認：T008 的 `CLOSURE_DEFERRAL` docket **無法**與本報告放在同一個 commit／PR 中合法成立（通道路徑 allowlist 不含 `delivery/audits/`），因此本候選**未**建立 docket；其精確必要形狀列於 §3，交 Planning Agent／Human 決定是否另開單一 docket PR。

本 commit 未修改任何 Task 狀態、AC/Test 映射、Evidence、Backlog、Sprint 控制檔、`build-spec/`、`harness/`、`src/`、`tests/`。

## 1. 現況事實（BASE_SHA）

| 項目 | 值 |
|---|---|
| `build-spec/CURRENT.json` | `active_baseline=BS-P1-025`、`implementation_enabled=true` |
| `delivery/CURRENT-SPRINT.json` | `SP-P1-003` / `BS-P1-025` / `active_task=T008` / `status=REVIEW` |
| Sprint manifest `status` | `ACTIVE`（CURRENT-SPRINT 為 `REVIEW`） |
| T001–T005、T007 | `CLOSED` |
| T006 | `BLOCKED`，9 組 AC/Test，21 筆 Evidence |
| T008 | `REVIEW`，4 組 AC/Test，14 筆 Evidence（4 筆 TEST_RESULT PASS + 10 筆其餘 PASS） |
| BL-P1-015、BL-P1-018 | `SPRINTED`（非 `DONE`） |
| BL-P1-008／010／031 revalidation | `IN_PROGRESS`（target `BS-P1-025`、owner `T008`） |

## 2. Sprint 結案阻擋（精確規則與違反項）

### 2.1 一般 `CLOSED` 的硬性條件 — `harness/scripts/validate-sprint.mjs`

- L15：Sprint 狀態集合僅 `PLANNED / ACTIVE / BLOCKED / REVIEW / CLOSED`；**沒有**行政結案或 `CLOSED_WITH_CARRY_FORWARD` 類狀態。
- L405–L418（`m.status==="CLOSED"` 時）：
  1. 每個 Task 必須 `CLOSED` → **違反**：T006 `BLOCKED`、T008 `REVIEW`。
  2. 每個 selected Backlog 必須 `DONE` → **違反**：BL-P1-015、BL-P1-018 為 `SPRINTED`。
  3. 每個 revalidation item 必須 `VERIFIED/CLOSED` → **違反**：BL-P1-008、BL-P1-010、BL-P1-031 為 `IN_PROGRESS`。
  4. CLOSED Sprint 不得仍是 CURRENT `active_sprint` → 必須改 `delivery/CURRENT-SPRINT.json`。
- L421–L425：`active_sprint=null` 時必須 `status=HOLD`、`active_build_spec/active_task=null`，且 `build-spec/CURRENT.json.implementation_enabled=false` → 需修改 `build-spec/CURRENT.json`，**超出本 lease ALLOWED_PATHS 且為 NEVER 項目**。

### 2.2 T006 不能 `REVIEW/VERIFIED/CLOSED`

- `harness/scripts/validate-evidence.mjs` L100–L106：`REVIEW/VERIFIED/CLOSED` 需每組 AC/Test 有 `TEST_RESULT PASS`；`F00-AC-037::TEST-F00-037` 只有 `EV-SP-P1-003-T006-009`（`status=INFO`，PARTIAL）。
- 同檔 L116–L119：`VERIFIED/CLOSED` 需 `REVIEW PASS` Evidence；T006 的 21 筆中**無** `kind=REVIEW`。
- `harness/scripts/validate-backlog.mjs` L467–L477：T006 final `CLOSED` 需 T008 `CLOSED`、T008 恰好四組 AC/Test、BL-P1-008/010/031 revalidation `CLOSED`。

### 2.3 現有例外通道不能涵蓋 Sprint 結案

- `harness/policy/governance-reform.json` L29–L31：`deferrable_procedural_gates` **僅** `BACKLOG_T008_CLOSE_AFTER_T006_REVIEW`。上述 §2.1 任何一條都不是可延後的 Gate。
- `CLOSURE_DEFERRAL` 通道（L128–L146）`waivable_gates=[]`、`forbidden_paths` 含 `build-spec/`。
- `harness/policy/repo-policy.json` `human_gate_required_for` 含 `SPRINT_CLOSE`。
- 憲法 §7（`harness/policy/APPF2-CONSTITUTION.md` L101）：`CLOSURE_DEFERRAL` 「只可延後 policy 列明的程序順序 Gate」、「不得改變任何 PASS／FAIL／UNTESTED」。

**判定**：一般 `CLOSED` 需每個 Task `CLOSED`、每個 selected Backlog `DONE`；行政結案需修改 validator 與治理 policy → 觸發 lease `STOP_ON`（any need to amend a validator or governance policy）。

## 3. T008 `CLOSURE_DEFERRAL` docket — 為何本候選未建立

`harness/scripts/human-exception.mjs` 的 PR 時驗證（由 `validate-change-scope.mjs` L182–L190 呼叫）要求：

1. L389：每個 PR **恰好一份** exception docket。
2. L62–L71：`exact_changed_paths` 必須**等於** PR 中 docket 以外的全部變更路徑，`candidate_digest_sha256` 綁定這些路徑的精確位元組。
3. L120–L133：每個變更路徑必須在 `CLOSURE_DEFERRAL` allowlist 內：`delivery/CURRENT-SPRINT.json`、`delivery/backlog/QUEUE.json`、`delivery/sprints/SP-P1-003/{tasks,manifest}.json`、`delivery/evidence/`、`delivery/findings/`。**不含** `delivery/audits/`、`delivery/PROJECT-OPEN-ITEMS.json`；其他 docket 不可同 PR 修改。
4. L82–L88：`human_message_ref` 不得符合 placeholder pattern（`PENDING` 等）→ 在 Human 填寫前必然 FAIL（設計如此）。
5. L92–L97 及 policy `max_ttl_seconds=1209600`：docket 自 `approved_at_unix` 起最長 14 天；`validate-backlog.mjs` L481–L488 在**每次** gate 執行都重驗，過期即失效。

因此：

- 本 lease 要求「ONE commit」同時包含 docket 與 `delivery/audits/` 報告，**在 BASE policy 下不可能通過 docket 驗證**。要合法，只能另開一個只含 docket + T008 結案控制變更的 PR（拆 PR 屬 Planning 決定，Cursor 不自行擴張）。
- docket 的 digest 必須綁定 T008 結案的實際控制位元組：
  - `delivery/sprints/SP-P1-003/tasks.json`：T008 `REVIEW → CLOSED`，`completion_evidence` 14 筆**原樣**，`acceptance_links` 四組**原樣**；T006、T007 位元組不變。
  - `delivery/backlog/QUEUE.json`：BL-P1-008/010/031 revalidation `IN_PROGRESS → CLOSED`，其餘欄位不變（符合 `validate-change-scope.mjs` L81–L110 的精確 revalidation closure 形狀）。
  - `delivery/CURRENT-SPRINT.json`：Sprint `REVIEW` 且 active_task `T008` 為 `CLOSED` 會違反 `validate-sprint.mjs` L173–L177；在 T006 `BLOCKED` 下，validator 唯一相容的組合是 `active_task=T006`、`status=BLOCKED`。此 Sprint 控制狀態的選擇 lease **未指定**，Cursor 不代為決定。
- **殘餘風險（重要）**：`CLOSURE_DEFERRAL` 有效期最多 14 天且每次 gate 重驗。若 T008 以此 docket `CLOSED`、而 T006 在到期前仍未至少 `REVIEW`，`validate-backlog.mjs` L451–L454 會在 `main` 上重新 FAIL（`T008 CLOSED requires T006 product already independently reviewed`），除非 Human 再核准新 docket。此通道**不適合**作為永久的行政結案依據。

## 4. T006 — 狀態保留與未完成事項（carry-forward，全部非 PASS）

T006 維持 `BLOCKED`；9 組 AC/Test 映射與 21 筆 Evidence 參照**完全未修改**。

| AC | Test | Evidence | 記錄狀態 |
|---|---|---|---|
| F03-AC-009 | TEST-F03-009 | EV-SP-P1-003-T006-001 | 既有 PASS（未重驗） |
| F03-AC-024 | TEST-F03-AC-024 | EV-SP-P1-003-T006-002 | 既有 PASS（未重驗） |
| F00-AC-007 | TEST-F00-007 | EV-SP-P1-003-T006-003 | 既有 PASS（未重驗） |
| F00-AC-009 | TEST-F00-AC-009 | EV-SP-P1-003-T006-004 | 既有 PASS（未重驗） |
| F00-AC-010 | TEST-F00-010 | EV-SP-P1-003-T006-005 | 既有 PASS（未重驗） |
| F00-AC-011 | TEST-F00-011 | EV-SP-P1-003-T006-006 | 既有 PASS（未重驗） |
| F00-AC-012 | TEST-F00-AC-012 | EV-SP-P1-003-T006-007 | 既有 PASS（未重驗） |
| F00-AC-036 | TEST-F00-036 | EV-SP-P1-003-T006-008 | 既有 PASS（未重驗） |
| **F00-AC-037** | **TEST-F00-037** | EV-SP-P1-003-T006-009（INFO，PARTIAL） | **UNTESTED**（F06 Preview-origin 不存在、未驗；Composer-origin 部分結果不等於 PASS） |

其餘 Evidence：EV-…-010～020 為 11 個 required command 的 `COMMAND_RESULT PASS`；EV-…-021 為 `RUNTIME_TRACE INFO`（Human Owner PPV 95% 與 F06 Preview 後測裁定，明載「不代表 TEST-F00-037 FULL PASS」）。

未完成事項（carry-forward GAP，狀態皆為 UNTESTED 或 BLOCKED，**無一為 PASS**）：

| GAP | 內容 | 狀態 | 依據 |
|---|---|---|---|
| GAP-T006-01 | F00-AC-037 / TEST-F00-037 完整 PASS（含 F06 Preview-origin） | UNTESTED | EV-009 INFO；`validate-evidence.mjs` L100–L106 |
| GAP-T006-02 | T006 Engineering/Semantic `REVIEW PASS` Evidence | BLOCKED（需 GAP-T006-01 先完成才可進 REVIEW） | `validate-evidence.mjs` L116–L119 |
| GAP-T006-03 | T006 `REVIEW → VERIFIED → CLOSED` 生命週期 | BLOCKED | 同上；`validate-backlog.mjs` L467–L477 |
| GAP-BL-015 | BL-P1-015（F03-AC-009、F03-AC-024）`SPRINTED → DONE` | BLOCKED（綁 T006 結案） | `validate-sprint.mjs` L409–L412 |
| GAP-BL-018 | BL-P1-018（F00-AC-007/009/010/011/012/036/037）`SPRINTED → DONE` | BLOCKED（含 GAP-T006-01） | 同上 |
| GAP-REVAL | BL-P1-008/010/031 revalidation `IN_PROGRESS → CLOSED`（T008 owner） | BLOCKED（T008 結案順序 Gate） | `validate-backlog.mjs` L451–L454；`validate-sprint.mjs` L413–L416 |

本候選**未**新增 Finding 檔或 POI 項目：lease 在 Sprint 判定為不可行時要求 STOP；且新 Finding 的 classification 與 ID（`BF-055` 已被 `validate-change-scope.mjs` L551 的 BS026 路徑保留）需 Planning 決定，Cursor 不自行選定。上表即為保留紀錄，供 Planning Agent 轉為正式 Finding／Backlog。

## 5. 最小必要規則修正（提案，僅供 L3 審議；Cursor 未修改）

行政結案（Sprint `CLOSED` 而 T006 `BLOCKED`、BL-P1-015/018 未 `DONE`）至少需要下列 L3 變更，須依憲法 §3–§4 完成 5 Why 與一次 Human 精確差異審定、獨立 CI/BCE、另一筆 Human Merge：

1. `harness/policy/governance-reform.json`：新增可延後的 Sprint 結案程序 Gate（例如 `SPRINT_CLOSE_ALL_TASKS_CLOSED`、`SPRINT_CLOSE_SELECTED_BACKLOG_DONE`、`SPRINT_CLOSE_REVALIDATION_COMPLETE`），或新增專用通道；並定義 carry-forward 必填欄位（GAP 清單、承接 Sprint/Backlog、`never_converts_fail_or_untested_to_pass: true`），且**不受** 14 天 TTL 失效影響（或明訂到期後的處理），否則結案後 `main` 會重新 FAIL。
2. `harness/scripts/validate-sprint.mjs` L405–L418：`CLOSED` 時查詢已合併、已 Human 核准、範圍精確的上述 waiver；被豁免的 Task 必須維持 `BLOCKED`、Evidence 與 AC/Test 位元組不變；未完成 Backlog 必須有明確承接標記。
3. Sprint 結案改 `active_sprint=null` 需 `build-spec/CURRENT.json.implementation_enabled=false`（L421–L425）：結案 PR 必須被允許改此欄位（一般 safe control transition 允許，但 `CLOSURE_DEFERRAL` 通道禁止 `build-spec/`）。
4. `harness/scripts/validate-backlog.mjs` L444–L456／L481–L488：若 T008 以 docket 先結案，需定義 docket 到期後的永久處置（例如 Sprint 已 CLOSED 時不再重驗順序 Gate），避免 `main` 回歸 FAIL。
5. `harness/policy/APPF2-CONSTITUTION.md` §7 文字同步；`harness/scripts/governance-reform-selftest.mjs`、`harness/attack/run-dry-run.mjs` 新增正反測試（含 T006 被誤標 PASS、Evidence 改動、承接缺漏、過期、replay 等）。

替代（不修規則）路線：維持 Sprint `REVIEW/BLOCKED`，待 F06 Preview-origin 可測、TEST-F00-037 完整 PASS 後依一般流程結案。此路線無規則風險，但 Sprint 3 無法於此時結案。

## 6. 範圍聲明

- T007：`CLOSED`，未觸碰。
- 未建立 docket、未改 Task／Sprint／Backlog 狀態、未改 Evidence、未執行任何產品測試迴圈、未 push、未建立／更新 PR、未發 GitHub 留言、未啟動任何 Sprint／Task。
- 本 commit 在 Sprint `REVIEW` 下仍會被 `validate-change-scope.mjs` L823–L833 判為「Active Task T008 undeclared write」（`delivery/audits/` 不在 T008 `allowed_write_paths`，也不是 side-effect 路徑）；合併需經 Human 決定的合法治理通道。此為已知事實，不以任何方式繞過。
