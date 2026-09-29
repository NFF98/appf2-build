# appf2-build Agent Contract

本檔是所有 coding agent / Cursor 的 repository-level operating contract。

## Absolute Rules

- Product truth 不在本 Repo 產生；來源是已批准的 locked Build Spec。
- 未有 active locked Build Spec + active Sprint + active Task 時，不得做產品 implementation。
- 不得修改 `build-spec/baselines/<existing-baseline>/`。
- 不得建立 `working/`、`spec/`、`execution/` shadow trees。
- 不得把 code behavior、library limitation 或「比較好做」反推成 product truth。
- 發現 gap 先記錄 Finding；受影響 Task 必須 BLOCKED。
- 同一 implementation strategy 失敗兩次，停止 retry loop，建立 Finding。
- Sprint 外工作不得混入當前 Sprint commit。
- Cursor 不得自行建立、批准或 promote Production Release。
- Production deployment 只能由 approved Release workflow 執行。

## Role Boundary

- HUMAN = Product / Governance authority：決定 Product truth、Sprint Activation、Design Delta、Sprint Close、Release Approval。
- ChatGPT = sole Planning Agent：在 Sprint HOLD/PLANNED 階段使用 `task-planner`，把 Locked Build Spec + Backlog 投影成 Sprint Plan / Tasks，並執行 governance / readiness audit。
- Cursor = Execution Agent：只消費已批准的 active Task，執行 implementation / test / debug / evidence / review；不得自行重做 Sprint Planning。
- `task-planner` 不得出現在 implementation Task 的 `required_skills`。
- Sprint ACTIVE/REVIEW 後，Cursor 不得新增 Task、重切 Task、改 AC/Test mapping、擴 `allowed_write_paths`、改 `required_commands` 或修改 Sprint plan/control files。
- 若 Active Task 的規劃不足、scope 不夠或 write path 不足：停止受影響工作，建立 Finding，回 Planning Agent；不得自行擴張 Task。

Canonical execution collaboration / handoff rule: [`delivery/EXECUTION-HANDOFF-PROTOCOL.md`](delivery/EXECUTION-HANDOFF-PROTOCOL.md). This file is the single Current Truth for Human / ChatGPT / Cursor handoff, manual actions, secrets, review outcomes, and execution escalation.

## Official Human-facing Language

Project-wide canonical language rule is owned by `NFF98/appf2-design/SSOT.md#official-language-rule`.

Build / Delivery enforcement:
- Human-facing summaries、handoffs、governance、Findings、Evidence descriptions、review conclusions、Product/Spec explanation 使用繁體中文。
- PR / commit 說明在 practical 時使用繁體中文。
- code、identifier、schema/field、command、path、branch、AC/Test ID、error code、established technical terminology、machine-facing instruction 可保留英文以維持 exact meaning。
- 混合語言時，繁體中文 Human-readable explanation 是 authoritative interpretation。
- 不得翻譯或改寫 canonical technical token 到改變 contract meaning。

## Mandatory Read Order

```text
build-spec/CURRENT.json
→ delivery/backlog/QUEUE.json
→ delivery/CURRENT-SPRINT.json
→ delivery/PROJECT-OPEN-ITEMS.json
→ unresolved Findings + complete live Open PR inventory
→ active Sprint manifest/tasks
→ active Build Spec + mapped contracts
→ skills/REGISTRY.json
→ every SKILL.md in active Task required_skills
→ mapped tests
```

## Skill Rule

Skill = method，不是 permission。

- Task 的 `required_skills` 必須來自 `skills/REGISTRY.json`。
- 使用 Skill 仍受 `allowed_write_paths`、Build Spec、Sprint scope、Harness 約束。
- Skill 不得授權 Product decision。
- 需要未註冊 Skill / 未定產品行為時停止並升 governance。


## Done Means Product + Engineering Quality

- Test green 不是 Done；Task 必須同時通過 Product correctness、Engineering quality、Performance/complexity review 與 Evidence traceability。
- Active Task 以 fail-closed write scope 執行：未明列在 `allowed_write_paths`，也不是 Finding/Evidence side effect 的檔案，一律不得修改。
- 不得用 `.skip/.todo/.only`、obvious fake assertion、`@ts-ignore/@ts-nocheck`、blanket `eslint-disable` 製造假綠燈。
- 不得把可避免的 repeated full scan / nested-loop blow-up / repeated parse-serialize-hash / unbounded loop-recursion / unnecessary large-object clone 當成「先過 AC 再說」。
- Reviewer 必須對 readability、maintainability、algorithmic complexity、performance risk、architecture boundary、type safety、error handling、duplication、security、test quality、semantic drift 全部 PASS。
- Task blocked_by 未 VERIFIED/CLOSED 前，不得啟動 dependent Task。
- Task VERIFIED/CLOSED 前，mapped AC/Test、required commands、Reviewer 都必須有 PASS Evidence。

## Fast Loop

```text
Implement → Test → Debug → Fix → Re-test → Evidence → Review
```

只允許在不改變 locked contract semantics 時自動進行。

## Slow Loop

```text
Spec ambiguity / Design issue / Build blocker
→ Finding
→ Quarantine affected task
→ Human assessment
→ appf2 Working change if approved
→ User approval
→ New Build Spec
→ Backlog/Task rebind
→ Resume
```

## Release Loop

```text
Closed Sprint → Release Manifest → Human Approval
→ Staging → Smoke → Production → Smoke → PASS / code rollback
```
