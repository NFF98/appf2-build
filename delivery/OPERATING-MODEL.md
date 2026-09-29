# appf2-build Operating Model

## 1. Authority

```text
appf2/working = Design Current Truth
build-spec     = frozen implementation truth for a build baseline
backlog        = work derived from that baseline
sprint/task    = selected execution scope
src/tests      = implementation
evidence       = proof of completion
release        = approved deployment control
```

Code、tests、Backlog、Cursor opinion、library limitation 都不能反向覆蓋產品真相。

## 2. Build Enable Sequence

```text
appf2 Working clean
→ Build Freeze audit
→ User approves BS-*
→ generate Backlog from BS-* + AC registry
→ Backlog Gate
→ Sprint plan from READY backlog
→ User approves Sprint activation
→ exactly one Active Task
→ required Agent Skill(s)
→ Cursor automation
→ Evidence
→ Sprint Close
→ Release
```

## 2.1 Human / Planning Agent / Cursor Boundary

```text
HUMAN
  Product / Governance authority
        ↓
ChatGPT = sole Planning Agent
  Backlog → Sprint Plan → Task definitions → Readiness Audit
        ↓
HUMAN Sprint Activation
        ↓
Cursor = Execution Agent
  Implement → Test → Debug → Evidence → Review
```

- HUMAN owns Product decisions, Sprint Activation, Design Delta approval, Sprint Close and Release Approval.
- ChatGPT is the sole Planning Agent for this operating model. Planning happens while Sprint is HOLD/PLANNED and uses the registered `task-planner` method.
- Cursor does not create or redefine Sprint Tasks. Cursor consumes the active Task and only uses execution/review skills assigned to that Task.
- Once Sprint is ACTIVE/REVIEW, Sprint manifest/task definitions are execution-immutable to Cursor. Any needed re-plan goes through Finding → BLOCK → Planning Agent / Human governance.
- `task-planner` is not an execution permission and must never appear in an implementation Task `required_skills`.

Canonical Human / ChatGPT / Cursor execution handoff protocol: [`delivery/EXECUTION-HANDOFF-PROTOCOL.md`](EXECUTION-HANDOFF-PROTOCOL.md). Keep execution-collaboration rules there instead of duplicating them in this Operating Model.

## 2.2 Sprint Pre-Activation Gate

每個 Sprint 在 Human Activation 前都必須完成同一套 Pre-Activation Gate；這是永久治理規則，不是單一 Sprint 的臨時 Task。

Mandatory sequence：

```text
1. Cold-read live main + build-spec/CURRENT.json + delivery/CURRENT-SPRINT.json
2. Read PROJECT-OPEN-ITEMS + unresolved Findings + complete live Open PR inventory
3. Verify selected Backlog dependencies
4. Verify 100% Acceptance ↔ Test mapping
5. Decompose executable Tasks with dependency order
6. Fix allowed_write_paths / required_commands / required_skills before Activation
7. Prove every mapped AC/Test has an actually executable proof path
8. Audit required harness / validator / CI / toolchain / external test environment
9. Any machine/governance blocker must be fixed while Sprint remains HOLD/PLANNED
10. Persist Sprint planning artifacts in GitHub
11. Selected Backlog moves QUEUED → READY only after readiness is real
12. Run governance/readiness validation
13. Human reviews the complete plan
14. Only explicit Human approval may activate the Sprint
```

Hard rules：

- Search results may locate PRs/files but **must not** be used to claim a complete repository-wide inventory. Open PR count/status must come from the complete pull-request collection, with pagination when needed.
- Pre-Activation Gate PASS requires zero unresolved **blocking** project open items for that Sprint.
- A Test ID alone is not proof readiness. The test must have a credible executable path in the current repository/toolchain.
- If an AC needs browser/runtime/infrastructure proof that the current machine cannot execute, planning remains BLOCKED until the proof path exists or Human-approved Product/roadmap governance changes the scope.
- Sprint ACTIVE/REVIEW 後，不得把原本應在 Pre-Activation 解決的 planning/toolchain 缺口偷偷塞進 implementation scope。
- Sprint-specific Task IDs / harness details belong to that Sprint plan；本節只固定永久 Gate。

### Open PR Audit

Pre-Activation 與 Sprint Close 都必須做完整 Open PR inventory。

每個 Open PR 必須被分類為：
- MERGE_CANDIDATE — 需獨立 Human approval 才可 merge
- DEFERRED_REVIEW — 明確保留，不得假裝已處理
- SUPERSEDED — 可在有 evidence 時關閉，不 merge
- BLOCKING — 必須在 Activation/Close 前處理

不得因 PR 與當前 Sprint 無關就讓它從 handoff 消失。

### Temporary Local Artifact Hygiene

已知會影響後續協作判斷的 local temporary artifact / patch 必須在 Task 或 Sprint close 時明確分類：
- DELETE
- ARCHIVE_WITH_PATH
- PROMOTE_TO_REPO

若 artifact 不在 GitHub，必須在 `PROJECT-OPEN-ITEMS.json` 留下 Human/manual owner、exact known path（不得包含 secret）與 completion criterion；不得靠 Chat memory。

## 3. Backlog Rule

Backlog 是 Build Spec 的 projection，不是新的需求層。

- 每個 item 必須 map 到 active baseline 中真實存在的 Acceptance/Test。
- 不得新增未存在於 Build Spec 的產品行為。
- `SPRINTED` 必須指向存在的 Sprint。
- Sprint Task 必須反向引用 Backlog Item。
- Build Spec Rebaseline 後，舊 baseline 的未完成 item 不得偷偷沿用；必須重新 bind / regenerate。

## 4. Sprint / Task

同時只允許一個 active Sprint、一個 active Task。

Task 必須固定：
- backlog item(s)
- Build Spec ID
- AC ↔ Test mapping
- allowed_write_paths
- required commands
- required skills
- completion evidence
- product_decision_allowed = false

## 5. Task Close

Task completion 不是「Cursor 說完成」或「測試綠」：

```text
Mapped AC/Test PASS
+ required command PASS
+ Type / Lint / Security / Build PASS
+ Engineering Quality Review PASS
+ Semantic Drift Review PASS
+ Evidence complete
= VERIFIED / CLOSED
```

`REVIEW` 前，mapped AC/Test + required commands 必須有 PASS Evidence。
`VERIFIED/CLOSED` 前，另外必須有完整 Reviewer PASS，包含 readability、maintainability、algorithmic complexity、performance risk、architecture boundary、type safety、error handling、duplication、security、test quality、semantic drift。

Task 的 `blocked_by` 未達 VERIFIED/CLOSED 時，dependent Task 不得成為 active Task。

## 6. Fast Loop

```text
IMPLEMENTATION_BUG / TEST_BUG
→ fix without changing contract semantics
→ mapped tests
→ required commands
→ evidence
→ verify
```

同策略最多失敗兩次。

## 7. Slow Loop

```text
SPEC_AMBIGUITY / DESIGN_DELTA_CANDIDATE / contract-affecting BUILD_BLOCKER
→ Task BLOCKED
→ Finding
→ Human governance
→ appf2 Working if needed
→ User approval
→ new BS-*
→ regenerate/rebind affected Backlog + Task
→ resume
```

## 8. Release

只有 Closed Sprint + PASS gate-result + approved Release Manifest 才能進 Staging / Production。
