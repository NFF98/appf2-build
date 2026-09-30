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

完整 live build Open PR inventory（#10/#11 關閉後、含本 planning PR）：
- #1
- #2
- #4
- #94
- #98（本 Pre-Activation Planning PR）

Disposition：
- #1 / #2 / #4 = **DEFERRED_REVIEW**（GitHub Actions major upgrade，改由獨立 Build Machine maintenance 審查）
- #94 = **MERGE_CANDIDATE / NON_BLOCKING**（Vitest patch；仍需獨立 Human merge approval）
- #3 = **CLOSED / NOT MERGED**（@types/node 26 與目前 Node 22 engine baseline 不一致）

任何 dependency PR merge 仍需獨立 Human approval。

尚待 Human/manual：
- Official Language Rule：appf2-design PR #4 已 merge，merge SHA `e2b4b0e31de53ddadc283adb6e88ee3926023280`
- local `$env:USERPROFILE\Desktop\T002-patch-archive` 中 `T002-candidate.patch` / `T002-full-candidate.patch` 仍待 Human 確認；2026-09-29 Human 已條件式批准：**不阻擋 SP-P1-002 Activation，但在第一個 Cursor implementation command 前是 hard stop，必須再次確認 cleanup/disposition**

## 8. Activation Gate

目前：

```text
Planning = PR VALIDATION PASS
Required checks = 4 / 4 PASS
Sprint = PLANNED
CURRENT-SPRINT = HOLD
implementation_enabled = false
Human Activation = NOT GRANTED
```

在以下條件完成前不得 Activation：

1. Pre-Activation PR required checks PASS。
2. Complete Open PR inventory rechecked。
3. Human reviews this plan and explicitly approves `SP-P1-002 Activation`。
4. Local dead patch cleanup may remain pending through Activation only; **before the first Cursor implementation command it must be confirmed complete/disposed**。


## 9. PR Validation Evidence

PR #98 head `a45d571eaffc011ea208d42a56dc513397df5f5a` 完成 required checks：

- CI Gate — PASS — run `36509339243`
- Governance Gate — PASS — run `36509339278`
- Governance Attack Dry-run — PASS — run `36509339311`
- CodeQL — PASS — run `36509339232`

此 check set 驗證的是 Pre-Activation planning/governance change；**不是 Sprint Activation，也不是 Product implementation approval**。


### Conditional Local Patch Decision

2026-09-29 Human decision:

- local dead patch cleanup remains **MANUAL_ACTION_REQUIRED**
- it does **not** block SP-P1-002 Activation
- it **does** block the first Cursor implementation command
- ChatGPT must explicitly re-check this condition before giving Cursor any SP-P1-002 implementation command
- this is a one-time SP-P1-002 exception, **not** a permanent relaxation of Temporary Local Artifact Hygiene

## 10. PFR-02 Live Activation Review — 2026-10-01

Review result:

~~~text
Activation Review = PASS
Sprint Readiness = READY FOR HUMAN ACTIVATION
Human Activation = NOT YET GRANTED
Build Execution = HOLD
First Cursor Command Gate = BLOCKED UNTIL POI-003 DEAD PATCH DISPOSITION CONFIRMED
~~~

Live revalidation:

- Build `main` reviewed at `0f02aa3c811965e163cc02084935054c92fd570c`.
- `BS-P1-003` remains `LOCKED`; `build-spec/CURRENT.json` still has `implementation_enabled=false`.
- `SP-P1-002` remains `PLANNED`; `delivery/CURRENT-SPRINT.json` remains `HOLD`.
- PFR-01 approved that SP2 continues on `BS-P1-003` without rebaseline.
- Current Product Design F01 / F02 / F04 / F07 plus Acceptance Registry and Evidence Registry have identical Git blob SHAs to the `BS-P1-003` source Working commit `3818926b82ae2c5edaf9d6115fda3d1505757781`; no SP2 contract drift was found.
- PR #98 is merged. Its CI / Governance / attack / CodeQL checks completed successfully.
- Immediately before this review record PR was opened, the existing Build open PR inventory was #1 / #2 / #4 / #94. They are dependency maintenance items and remain non-blocking for SP2 Activation; no dependency PR is approved for merge by this review. PR #100 is this governance-only Activation Review record and does not add Product implementation scope.
- `POI-003` remains `MANUAL_ACTION_REQUIRED`, but the 2026-09-29 Human decision explicitly allows Sprint Activation before cleanup. It remains a **hard stop before the first Cursor implementation command**.

Therefore no technical, Product Truth, Build Spec, dependency, Acceptance mapping, or governance blocker prevents Human from activating `SP-P1-002`.

> This review does not itself activate the Sprint. Activation still requires an explicit Human decision and the corresponding Build authority state change.


## 11. Human Activation Decision — 2026-10-01

Human decision:

~~~text
SP-P1-002 Activation = APPROVED
Build Spec = BS-P1-003
Activation Control Transition = AUTHORIZED
First Cursor Command = HARD STOP UNTIL POI-003 CONFIRMED
~~~

Human explicitly approved `SP-P1-002 Activation` after the PFR-02 live Activation Review PASS.

The approved control-state transition is:

- `SP-P1-002`: `PLANNED → ACTIVE`
- `T001`: `PLANNED → IN_PROGRESS`
- selected Backlog `BL-P1-003 / 005 / 006 / 007 / 008 / 033`: `READY → SPRINTED`
- `build-spec/CURRENT.json`: `implementation_enabled=false → true`
- `delivery/CURRENT-SPRINT.json`: bind `SP-P1-002 / BS-P1-003 / T001` as the sole active execution context

This Human decision does **not** itself bypass protected-branch / machine gates. The control-state transition must still land through the repository's required PR checks.

The 2026-09-29 conditional decision for `POI-003` remains unchanged:

> Sprint Activation may proceed, but **the first Cursor implementation command is forbidden** until the Human confirms `T002-candidate.patch` and `T002-full-candidate.patch` are deleted or intentionally archived outside the project execution path.

No dependency PR merge, Product scope expansion, SP-P1-003+ implementation, or Build Spec rebaseline is approved by this decision.
