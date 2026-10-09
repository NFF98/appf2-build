# SP-P1-003 T007 final closure / T004 governance return

## Human authorization
2026-10-09：「批准 T007 implementation merge PR #328, and 關閉 T007 and back to T004」。
邊界：允許 T007 merge、Evidence normalization、closure，以及 T004 回到治理啟動；**未**核准 T004 Cursor execution、舊 PR #323 merge、T005/T006。

## Immutable source of evidence
- Locked baseline BS-P1-024 (active); no Product/Design/Build Spec change.
- T007 single-use lease #6071633835 / result #6072048159.
- Independent BCE-1 #6072069317 (PR transport blocker only) and BCE-2 PASS #6072160120.
- T007 implementation PR #328 https://github.com/NFF98/appf2-build/pull/328 merged with human approval as 61108dabc153985b6689680577188a945153f05b.
- Candidate fe24c8711fa0b36e5c7b05aa404c310af922531a; exactly 8 legal source/tests files. GitHub PR checks CI Gate, Governance Gate, Governance Attack Dry-run, CodeQL COMPLETED SUCCESS.
- CI workflow https://github.com/NFF98/appf2-build/actions/runs/37867961823: product CI including governance and lint PASS. Local 9/9 required commands and strict mapped test integrity reported by Cursor in RESULT #6072048159; independent BCE review #6072160120 verified code, tests and GitHub CI.
- F01-AC-004 → TEST-F01-004 server-authoritative pending assumption edit-shape projection, tests for six JsonValue types including choices and nested RECORD, errors fail closed, provenance and identity invariants.
- Evidence EV-SP-P1-003-T007-001 maps exactly F01-AC-004 → TEST-F01-004. Evidence EV-SP-P1-003-T007-002…EV-SP-P1-003-T007-010 capture the nine Cursor-reported command PASS records, with explicit Issue #301 source. Evidence EV-SP-P1-003-T007-011 provides independent BCE REVIEW of all eleven engineering checks.

## Governance transition
- T007 CLOSED, 11 immutable evidence records. BL-P1-008 remains historical DONE with only its BS-P1-024 F01-AC-004 revalidation marked CLOSED. Prior T001–T003 unchanged.
- T004 BLOCKED→IN_PROGRESS; T004 existing BS-P1-024 Task scope/AC mapping/paths/commands unchanged. BL-P1-017 BLOCKED→SPRINTED; active Task now T004, SP-P1-003 stays ACTIVE; other Tasks remain PLANNED.
- BF-053 remains RESOLVED (semantic ambiguity solved), BD-024 remains IMPLEMENTING until F00 side actually closes.

## T004 handoff blockers / scope
- Historical T004 PR #323 OPEN, old BS-P1-023 head 15363feee73bb6df8171a9d9c1bd2deed29f94fb and CI failed; no merge or silent rebase. It does not satisfy BS-P1-024.
- T004 must implement real F00 typed Accept/Edit/Reject including ENUM/LIST/RECORD and address old TEST-F00-AC-002 parser-title CI bug only inside T004 legal paths, revalidate user interaction and non-coercion, preserve draft/recoverable failures.
- New execution must be based on current main after this governance PR; one fresh lease only after explicit Human T004 Cursor approval, and no legacy T004 lease replay. GitHub Issue #301 remains canonical transport; Watcher itself need not switch channels. PC B repository must fast-forward its main before the next Cursor preflight.
- T005/T006 remain PLANNED. No implementation or release work is triggered by governance closure.
