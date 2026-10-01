# Build Backlog

Build Backlog 不是產品需求文件；它是 active Locked Build Spec 的可執行工作佇列。

Canonical queue：`delivery/backlog/QUEUE.json`

每筆 Backlog Item 必須：
- 來源 = `BUILD_SPEC`
- 綁定 active Build Spec ID
- 綁定 Function / contract scope
- 綁定至少一組 Acceptance ID ↔ Test ID
- 明確 dependencies / priority / status
- `product_decision_allowed = false`

Lifecycle：

`QUEUED → READY → SPRINTED → BLOCKED | DONE`

沒有 active Build Spec 時，QUEUE 必須是 HOLD 且 items = []。


## Completed Acceptance Revalidation

Rebaseline 時，DONE Backlog Item 的歷史 `build_spec_id` / `sprint_id` 不得被改寫來假裝符合新 contract。

若 mapped Acceptance 在 replacement baseline 的 semantics 改變：

- historical Backlog Item 保持 `DONE` 與原 baseline / Sprint provenance；
- Item 必須新增 `revalidation`：
  - `target_build_spec_id`
  - `status = PLANNED | IN_PROGRESS | VERIFIED | CLOSED`
  - `sprint_id`
  - `task_id`
  - `acceptance_ids`
- target Sprint manifest 以 `revalidation_item_ids` 明確列出 historical item；
- target Task 必須 claim 所有 changed Acceptance；
- changed Acceptance 不得由 historical DONE claim 假裝 current coverage；
- Sprint Close 前 revalidation 必須 VERIFIED / CLOSED。

目的：保留已完成歷史，同時 fail-closed 地重驗證 replacement contract；禁止 reopen/改寫 closed Sprint history。
