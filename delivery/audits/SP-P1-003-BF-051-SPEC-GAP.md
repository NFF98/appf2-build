# SP-P1-003 / BF-051 — T002 MOD Semantics SPEC_GAP Audit

## 結論

T002 **BLOCKED；PR #303 不得 merge；T003 不得開始**。

Issue #301 RESULT `6038074492` 產生 T002 candidate PR #303（HEAD `d6b9dee21b8070a8b8a8091fe4ee3584aaeab7c3`）。Independent BCE audit `6038182280` 驗證 implementation scope / 17 組 AC-test traceability 基本成立，但確認 BS-P1-021 對 mixed-sign `MOD` 的 exact output semantics 未鎖定，因此 Cursor 的 `SPEC_GAP` HARD STOP 正確。

## SG-1 — MOD opposite-sign semantics

BS-P1-021 F03 §12 只鎖定：

- `MOD(NUMBER, NUMBER) → NUMBER`
- denominator 0 → `F03-ERR-008`
- non-finite result → `F03-ERR-009`

但沒有決定 opposite-sign operands 的 canonical remainder rule。

例如：

- truncated remainder：`MOD(-7, 3) = -1`
- floored / Euclidean-style remainder：`MOD(-7, 3) = 2`

F02-RQ-005 把 `MOD` 納入 Pure Operator Allowlist，並明確把 exact typed semantics 交給 F03；因此合法 admitted Blueprint 可以到達這個未定義 domain。

## Candidate 行為

PR #303 沒有自行選 Product semantics。Candidate 對 mixed-sign non-zero MOD 採 fail-closed，回 typed `F03-ERR-005`；這是安全的 implementation stopgap，但這個 error 行為本身也不是 locked canonical semantic，所以 candidate 不得 merge 成 Product truth。

## GitHub gate evidence

PR #303：

- Governance Attack Dry-run = PASS
- CodeQL = PASS
- Governance Gate = FAIL
- CI Gate = FAIL

兩個 FAIL 的 canonical reason 都是：

`BF-051 requires affected Task T002 to be BLOCKED`

在該 gate 之前，Projection Map / Baseline / Governance / Activation / Skill / Toolchain / Backlog / Sprint gates 全部 PASS。

## Human decision gate

Human governance 必須選一個 canonical appf2 MOD v1：

1. truncated remainder（sign follows dividend）；
2. floored remainder（sign follows divisor / floor division）；
3. mixed-sign non-zero MOD 明確定義為 typed Runtime error，並鎖 error code。

決定後才可：

Design truth remediation → replacement Build Spec rebaseline → BF-051 resolution → T002 rebind → fresh Cursor execution lease。

## HOLD invariant

- `implementation_enabled = false`
- `CURRENT-SPRINT = HOLD`
- `SP-P1-003 = BLOCKED`
- `T002 = BLOCKED`
- T001 = CLOSED
- T003-T006 = PLANNED
- PR #303 = superseded / DO NOT MERGE
- Issue #301 不得收到新的 execute lease，直到 replacement baseline rebind 完成
