# SP-P1-002 / BF-037 Freeze Candidate Audit

- Finding: BF-037
- Replacement Build Spec: BS-P1-009
- Supersedes: BS-P1-008
- Upstream Design Working merge: 1af9a51eac0a07b86c40b9405759b8412c1dea3a
- Prior scope-clean freeze source: 2ee3b32dafa49c1409f645f1aafd95ef024d2a0f
- New scope-clean freeze source: 728049049dad4e43146265bfe142d4195e7fac6d
- Human authority: 2026-10-03 approval to proceed through all governance and activation steps, stopping immediately before fresh Cursor implementation execution.

## Scope-clean provenance

PASS. Compare prior freeze source → new freeze source changes exactly:
1. working/detailed-design/functions/F02-BLUEPRINT-VALIDATION.md
2. working/detailed-design/functions/F03-RUNTIME-EXECUTION.md
3. working/detailed-design/data-model/DATA-MODEL-DETAILED.md

The first attempted derived source was rejected during audit because whole-file Data Model replacement would have admitted unrelated Working drift. The final source 728049049dad4e43146265bfe142d4195e7fac6d applies only the PR #12 BF-037 Data Model semantic delta onto the prior freeze source. No unrelated Working drift is admitted.

## BF-037 closure coverage

PASS for freeze eligibility.

- C1: F02 rejects U+0000 and invalid/lone surrogate string cases before PASSED admission, so executable canonical Blueprint strings are PostgreSQL-jsonb representable.
- C2: F03 defines canonical NodeInstanceKey for repeated runtime clones; F02 Phase 1 INVOKE_CAPABILITY targets remain singleton-only when no repeat ancestor exists.
- P1: validation_run is a terminal insert-only immutable trust-evidence row; UPDATE/DELETE are forbidden at the storage boundary.
- G1: Build test-integrity now compares per-Test executable declarations rather than treating every Test ID in a changed file as modified. Exact Test-ID/file maintenance authorization remains fail-closed.
- PR #156 Governance Gate, CI Gate, Governance Attack Dry-run and CodeQL all PASS before merge.
- Acceptance Registry is byte-identical to BS-P1-008; no Acceptance/Test ID remap is introduced.
- TEST-F04-AC-006 remains the only T002 closed-test maintenance authorization; Activation must rebind it directly BS-P1-008 → BS-P1-009.

## Projection / identity

- F02 / F03 are FULL_COPY from scope-clean source.
- DATA-MODEL-DETAILED remains the existing Phase 1 SECTION_FILTERED projection; only BF-037 Phase 1 lines change.
- All other BS-P1-008 projected blobs remain byte-identical.
- Acceptance count remains 289.
- BS-P1-009 content_sha256 = 59dd7bb8fab674dfae5da3eada4d59b4f747db972f27631452eea0ff58c4d115

## Freeze decision

PASS — Human-preapproved Build Freeze may create BS-P1-009 as LOCKED. Repository remains implementation HOLD until atomic BS-P1-009 / SP-P1-002 / T002 Activation. Fresh Cursor implementation execution is explicitly outside this freeze step and remains the requested stop point.
