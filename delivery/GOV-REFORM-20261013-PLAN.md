# GOV-REFORM-20261013 — consolidated governance reform execution plan

Status: **HUMAN PROGRAM APPROVED / IMPLEMENTATION CANDIDATE COMPLETE / EXACT-DIGEST APPROVAL PENDING / NOT MERGE APPROVED**  
Docket: [Issue #389](https://github.com/NFF98/appf2-build/issues/389)  
Baseline: `ec4443d40db8c72e43403adb9f3d9d02e72fbc18` (verify afresh before code updates)

## Product invariant
Improve workflow efficiency **without** relaxing security, Product truth, Evidence honesty or the Human merge boundary. Phase 1 REAL acceptance/fake-green policy remains tracked as a separate decision with no false PASS claims.

## Scope — all Human 9 items and assistant six additions
1. One Task → one enduring Draft PR + branch, iterative Bugfix, tests, Review until Ready; additional PR requires recorded justification and an actual authorization boundary.
2. Same valid Task lease → keep working without re-Activation/approval. New Task, scope or lease revocation → separate Human authorization.
3. Impacted-test-only fast loop with conservative dependency mapping and deterministic fallback to a wider suite; all mapped AC/Test results explicitly reported.
4. Activation only for actual execution authority change; never on routine bug edits.
5. Rebind only for real Baseline/AC/Test/Task mapping changes, not code fixes.
6. Evidence collection and deduplication, atomic Task closure when possible, preserve canonical immutable references and optional external evidence link.
7. Generic Human Exception Approval: exact scope, actor provenance, written Human decision, expiry/condition, covered gate, residual GAP, owner, follow-up; fail closed if missing/forged/stale; PASS/FAIL/UNTESTED unchanged.
8. GPT preflight gate: read live main/current Sprint/Task/lease/pr/approvals first; assert no existing usable PR or approval before creating more.
9. Metrics: Task-PR ratio, Human approval count, CI full-run count, time spent on rework.

**Extra six, individually retained:**
A. Prevent PR explosion (PR creation justification).
B. Prevent redundant approval (same Task same authority).
C. Automatic impacted-test selection.
D. No fake green, separately tag Mock/API/real PostgreSQL/real browser; detailed Phase 1 product gate **needs separate Human review**.
E. Automatic Evidence grouping/dedupe with canonical audit trail.
F. GPT no invented governance steps, preflight and auditable proof.

## Proposed execution states (not yet effective)
`AUTHORIZED_TASK` → `DRAFT_DEVELOPMENT` → `LOCAL_AC_TESTS_PASS` → `GPT_BCE_PASS` → `HUMAN_FINAL_INTEGRATION_READY` → `EXACT_HEAD_FULL_GATES_PASS` → `HUMAN_MERGE_APPROVED` → `MERGED` → `EVIDENCE_AND_CLOSURE`.

- Multiple commits in the same draft PR allowed; no new Task or Product authority is implied.
- A changed HEAD invalidates READY/gate/merge claims until reverified.
- Human exceptions only affect explicitly approved procedural closure/deferral gates, never Trust/privacy/secrets/release safety or observed test outcomes.
- Real deployment/release is a separate authority boundary.
- Product failures are not fixed by a governance exception.

## Confirmed SSOT constraints / audit
- `.github/workflows/ci.yml` currently runs on `pull_request` and main push, performs `npm run gate`, `npm run check:lint`, browser installs and `npm run product:ci`.
- `.github/workflows/codeql.yml` runs on every PR, main push, scheduled weekly.
- Ruleset `NFF Build` ID **23969502** applies to default branch; requires successful contexts **ci, attack, governance, Analyze JavaScript / TypeScript** with strict SHA freshness, squash-only merge and resolved conversations.
- Branch protection endpoint returned 403 for the available integration; do not claim to have independently inspected legacy protection rules. Rulesets endpoint succeeded.
- `validate-backlog.mjs` still blocks T008 CLOSED while T006 BLOCKED. Current SP-P1-003 T008 REVIEW, T006 BLOCKED. This program does **not** silently close either or activate another Product Task.

## Implementation work packages — ONE consolidated primary PR
1. **Lifecycle/provenance**: add explicit Final Ready control and exact HEAD attestation, preserved Human approval evidence, idempotent PR reuse preflight.
2. **Actions**: Draft/development pushes run cheap checks and impacted tests; full CI/Governance/Attack/CodeQL only for Human Ready and exact final HEAD. Preserve required check contexts at final merge, prevent draft/NOT_RUN contexts from being mistaken for PASS. Adjust Ruleset required contexts **transactionally** if renamed; never create an unprotected merge window.
3. **Classification**: BUGFIX/CHANGE/ACTIVATION/REBIND/EVIDENCE/CLOSURE/GOVERNANCE/HOTFIX routing. Retain autonomous rapid repairs inside the existing authorized Task and PR.
4. **Evidence**: normalize all mapped proof and independent review; dedupe and closure as few commits/PRs as permitted by protected boundaries. Detect same-task ownership, source SHA, stale evidence.
5. **Generic exceptions**: reusable registry + signed/independently verified Human provenance, positive and negative gate test matrix; defer with owner and follow-up without falsifying PASS.
6. **Observability**: count full workflow invocations and task-specific PR/control changes, reporting benchmark before/after.
7. **Docs and rollout**: updating Operating Model/Handoff, rollout/rollback guide and migration tests. Existing Task authorizations retained.

## Required negative tests
- A non-Human label/comment cannot set FINAL_READY or grant a Human exception.
- Forged, modified, out-of-scope, expired, missing, or replayed approval → DENY.
- Final-Ready on commit A followed by commit B → full checks invalidated for B.
- A Draft/cheap-check green is NOT full-gate PASS.
- Any untested/missing required safety test or fake API/Postgres pass → NOT READY; cannot merge unverified claim.
- No Task lease, changed Task, changed Baseline mapping → no inherited authorization.
- Repeated Task fixes reuse same PR; no unaudited fresh PR proliferation.
- Existing T006 BLOCKED and T008 REVIEW remain unchanged until independently approved closure governance.

## Implementation status（PR #390 候選；未經 Human 精確核准與 Merge 前不生效）

| # | 項目 | 機器落點 | 驗證 |
|---|---|---|---|
| 1 | 一個 Task 一個 PR | `task-pr-lifecycle.mjs`（狀態機、HEAD 失效）＋ Handoff §18.1 | selftest lifecycle 10 |
| 2 | 禁止重複核准 | `leaseDecision`、`gpt-preflight.mjs` `REDUNDANT_APPROVAL_DENIED` | selftest authority／preflight |
| 3 | Bugfix 持續執行 | `classifyChange` → `SAME_TASK_LEASE`；`CONTINUE_SAME_LEASE` | selftest routing／authority |
| 4 | 自動選擇相關測試 | `select-impacted-tests.mjs`（保守 fallback、NOT_RUN 明列） | selftest impacted 7 |
| 5 | 完整 CI 留到 Final Ready | `ci.yml`／`codeql.yml` Draft = NOT_READY 失敗＋非必要 `fast-loop` job；`finalGateVerdict` | selftest final_gate 6 |
| 6 | 精簡 Activation | `requiresActivation`（只在執行權改變時） | selftest authority |
| 7 | 精簡 Rebind | `requiresRebind`（只在 baseline／mapping 改變時） | selftest authority |
| 8 | Evidence 自動整理 | `evidence-ledger.mjs`；`proof_level` 列舉驗證 | selftest evidence_ledger 6 |
| 9 | Closure 精簡 | Scope Gate：控制轉換可同帶 Evidence／Finding | attack 正反各 1 |
| 10 | Human 通用特批 | `human-exception.mjs`＋`governance-reform.json`＋憲法 §7；已合併 `CLOSURE_DEFERRAL` 每次使用重驗期限／範圍／核准／撤銷／重放（BCE R2） | selftest human_exception 49＋persistent_waiver 22＋attack 12＋attack waiver 7 |
| 11 | Sprint 中特批修改 SSOT／Design／Build Spec | 兩階段：`PROTECTED_SSOT_AMENDMENT`（新 immutable baseline）→ `BUILD_SPEC_ACTIVATION`（Activation＋CURRENT＋Sprint/Task/Backlog REBIND，Sprint 保持 ACTIVE）；`validate-activation.mjs` 獨立重驗（BCE R2） | selftest build_spec_activation 30＋attack 兩階段 E2E 24＋負向 12 |
| 12 | GPT 執行前檢查 | `gpt-preflight.mjs state` | selftest metrics_preflight |
| 13 | PR 新增限制 | Governance Gate `pr-guard`（fail-closed、PR-Justification） | selftest metrics_preflight |
| 14 | 禁止假綠燈 | NOT_RUN／SKIPPED／Draft／stale HEAD ≠ PASS；`never_converts_fail_or_untested_to_pass` | selftest final_gate／lifecycle |
| 15 | 改革成效統計 | `governance-metrics.mjs`；基準 `delivery/audits/GOV-REFORM-20261013-METRICS-BASELINE.json` | selftest metrics |
| 16 | Governance／Hotfix 分流 | `GOVERNANCE_REFORM`／`HOTFIX` lane＋`classify` 輸出 | selftest routing／human_exception |

T008 維持 REVIEW、T006 維持 BLOCKED；`CLOSURE_DEFERRAL` 只提供機制，實際延後 T008 結案順序須另一份 Human 精確核准 docket。

## CI and Human decision gates
- Before protected rule/code change: prepare complete candidate, independent reviewer/negative tests, document any necessary constitutional L3 authorization.
- Human program approval is **not** exact rule bytes/sha Merge approval.
- For rollout: verify required checks and rollout migration before adjusting triggers. Repo settings changes may need Human manual access.
- Final independent BCE/CI then separate Human exact Merge approval.
- No unapproved merge, Task transition, release, Cursor lease or Product acceptance change from this draft.
