# SP-P1-002 Pre-Activation Gate Report

> 狀態：**HUMAN REVIEW PENDING / NOT ACTIVATED**
>
> 本報告是 2026-09-29 的 SP-P1-002 Pre-Activation planning snapshot。它不授權 implementation。

## 1. Current Truth

- live main baseline checked from commit: `fb27830f8e7ff22e8a1736afaac0a2325c43b576`
- `build-spec/CURRENT.json`: `active_baseline=BS-P1-003`, `implementation_enabled=false`
- `delivery/CURRENT-SPRINT.json`: `status=HOLD`, active Sprint / Task = null
- `BS-P1-003`: locked baseline
- unresolved Build Findings on main: **0**

## 2. Selected Backlog / Dependencies

Selected:

- BL-P1-003
- BL-P1-005
- BL-P1-006
- BL-P1-007
- BL-P1-008
- BL-P1-033

Dependency audit: **PASS**。所有 Sprint 外 upstream dependency 已 DONE；Sprint 內 BL-P1-006 / BL-P1-007 對 BL-P1-005 的 dependency 由 Task graph 承接。

Planning branch 將六個 selected Backlog 由 `QUEUED → READY`，仍不綁 `sprint_id`。

## 3. Acceptance / Test Coverage

- selected Acceptance/Test pairs: **35**
- Task claims: **35**
- duplicate Acceptance claims: **0**
- missing claims: **0**
- registry Test ID mismatch: **0**

Result: **35 / 35 PASS**。

## 4. Task Decomposition

- T001 Registry evidence & traceability
- T002 Blueprint validation core + admitted-content persistence
- T003 Blueprint execution safety / ceilings / trust anti-bypass
- T004 Validation failure + degradation semantics
- T005 Validation evidence + admission trace
- T006 Intent Envelope + clarification + visible assumptions
- T007 Durable client evidence queue / TTL / overflow / pagehide
- T008 Evidence retention / aggregate survival / drop-expiry observability / DEBUG guard
- T009 Real-browser verification harness for F01-AC-002 + F02-AC-017

每個 Task 都已固定：
- scope / non_scope
- Acceptance ↔ Test
- allowed_write_paths
- required_commands
- required_skills
- dependency graph
- `product_decision_allowed=false`

## 5. END_TO_END Proof Readiness

兩個 END_TO_END Acceptance：

- `F01-AC-002 / TEST-F01-CP-001`
- `F02-AC-017 / TEST-F02-017`

由 T009 單獨承接，避免和 implementation Task 重複 claim。

T009 的 proof path：

```text
existing SP2 production modules
→ npm run build
→ test-only local verification server/page under tests/e2e
→ real Playwright browser
→ render production result/state
→ assert NEEDS_CLARIFICATION / explicit result.outputs
```

這不是 SP4 Create shell，也不是 SP5 App surface；harness 不得複製 F01/F02 logic。

現有 repo 已有 Playwright、`npm run build`、`npm run test:e2e`、ES module build output。Planning audit 判定：**目前不需要 Pre-Activation 修改 package.json / harness / CI / toolchain**。若 PR CI 證明此判定錯誤，Sprint 保持 HOLD，先修 machine blocker，再重新 review。

## 6. Write Scope / Command Audit

Planning-agent independent audit：

- protected governance path inside implementation Task: **0**
- missing npm scripts: **0**
- unregistered required skill: **0**
- missing reviewer: **0**

T009 只允許寫：
- `tests/e2e/`
- `playwright.config.ts`

不得藉 E2E harness 提前建立正式 Product UI。

## 7. Project Cleanup / Permanent Governance

已處理：
- stale `CURRENT.json` T001 narrative：historically resolved by PR #50 / commit `a52f8a2...`
- obsolete naming PR #10 / #11：2026-09-29 已以 SUPERSEDED 關閉，**未 merge**
- Registry honesty：locked F04 已禁止 fake support；build Agent Contract 再加 execution enforcement
- permanent Sprint Pre-Activation Gate / complete Open PR audit / proof readiness / machine readiness / temp local artifact hygiene / new Chat carry-forward：已放入本 planning PR
- canonical `delivery/PROJECT-OPEN-ITEMS.json`：已建立

完整 live build Open PR inventory（#10/#11 關閉後）：
- #1
- #2
- #3
- #4
- #94

全部維持 **DEFERRED_REVIEW / NOT MERGED**；任何 merge 仍需獨立 Human approval。

尚待 Human/manual：
- appf2-design Official Language Rule PR #4 尚未 merge
- local `$env:USERPROFILE\Desktop\T002-patch-archive` 中 `T002-candidate.patch` / `T002-full-candidate.patch` 需 Human 確認刪除或明確 archive disposition

## 8. Activation Gate

目前：

```text
Planning = READY FOR PR VALIDATION
Sprint = PLANNED
CURRENT-SPRINT = HOLD
implementation_enabled = false
Human Activation = NOT GRANTED
```

在以下條件完成前不得 Activation：

1. Pre-Activation PR required checks PASS。
2. Official Language Rule governance item resolved。
3. Local dead patch manual cleanup/disposition confirmed。
4. Complete Open PR inventory rechecked。
5. Human reviews this plan and explicitly approves `SP-P1-002 Activation`。
