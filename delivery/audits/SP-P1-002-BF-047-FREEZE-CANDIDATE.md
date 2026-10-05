# SP-P1-002 / BF-047 — BS-P1-018 Freeze Candidate Audit

Status: PASS — eligible for Human-authorized replacement Build Freeze already granted in the T008 scope-expansion/rebaseline decision.

## Provenance
- canonical Design main carrying approved PR #26: `82bd737ac5229fde218175c5d9baa67dfa6f281a`
- prior BS-P1-017 freeze source: `6b5babe6e7ccc44b8f83731367aa8eece9c96364`
- scope-clean derived freeze source: `9c1e0c5f077663858530ac026fc55b9e20eddef2`
- derived source changes exactly three files: F07, DATA-MODEL-DETAILED, Acceptance Registry.

## Scope isolation
Design main before PR #26 already contained unrelated Phase-4 hardening (PR #25), including F07 drift. BS-P1-018 therefore derives from the exact BS-P1-017 freeze source and applies only the Human-approved PR #26 T008 semantics.

## Contract delta
- AC-027: event_count + all seven F07 Evidence-quality metrics have explicit source/aggregate semantics.
- AC-028: pre-service rejection plus queue drop/expiry have an app-owned production observability path; optional callback-only proof is insufficient.
- AC-029: client DEBUG_ONLY guard remains; server registered DEBUG_ONLY must fail closed with F07-ERR-016 and never durable.
- BL-P1-034 remains non-scope.

## Freeze result
- replacement baseline: BS-P1-018
- supersedes: BS-P1-017
- only projected contract outputs changed: F07, DATA-MODEL-DETAILED, Acceptance Registry.
- all other BS-P1-017 projected artifacts are reused byte-for-byte.
- Freeze PR places T008 on BLOCKED/HOLD only; activation/rebind is a separate atomic step.
- no Cursor execution authority.
