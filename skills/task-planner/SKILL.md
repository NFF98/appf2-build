# Skill: Task Planner

## Purpose

把 Locked Build Spec + READY Backlog Item 拆成最小、可驗證、不可自行擴張產品語意的 Sprint Task。

## Ownership

- Actor: `PLANNING_AGENT` (current operating model: ChatGPT).
- Use only while preparing/revising a Sprint in HOLD/PLANNED governance flow.
- This is not a Cursor execution Skill and must not appear in an implementation Task `required_skills`.
- After Human Sprint Activation, Cursor consumes the approved Task definition; any re-plan requires BLOCK/Finding and return to Planning Agent.

## Read

1. `build-spec/CURRENT.json`
2. active baseline manifest + referenced contracts
3. `delivery/backlog/QUEUE.json`
4. dependency / Acceptance-Test mapping
5. `delivery/PROJECT-OPEN-ITEMS.json` + unresolved Findings + complete live Open PR inventory
6. existing Sprint scope
7. proof readiness for every mapped AC/Test
8. required harness / validator / CI / toolchain readiness

## Produce

Task 必須包含：
- backlog_item_ids
- build_spec_id
- scope / non_scope
- acceptance_links
- allowed_write_paths
- required_commands
- required_skills
- completion_evidence placeholder
- product_decision_allowed=false

## Method

1. 一個 Task 只承擔一個可驗證 outcome。
2. 先找 dependency，再排順序。
3. AC/Test 一起帶入，不允許「先寫 code 之後再補 test」。
4. Write scope 盡量小。
5. 每個 mapped AC/Test 在 Activation 前都必須有 credible executable proof path；Test ID 存在不等於 proof ready。
6. 先檢查該 Sprint 所需 harness / validator / CI / toolchain。若缺口只能在 HOLD/PLANNED 安全修正，必須先修再 Activation。
7. Open PR inventory 必須使用 complete collection；search 只能定位，不能宣稱總數。
8. 未決產品行為不得轉成 Task；建立 Finding / governance question。

## Stop

遇到缺 AC、兩種合理產品行為、contract conflict、跨 baseline 依賴、或 mapped AC/Test 沒有可信 executable proof path 時停止規劃，不猜、不先 Activation。
