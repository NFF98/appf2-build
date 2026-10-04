# SP-P1-002 / BF-044 — BS-P1-015 Freeze Candidate Audit

## Verdict

PASS — replacement freeze candidate is scope-clean and limited to BF-044 F01 clarification-policy totality remediation.

## Canonical inputs

- Affected baseline: `BS-P1-014`
- Affected task: `SP-P1-002 / T006`
- Finding: `BF-044 SPEC_AMBIGUITY`
- Audited Design Working remediation: `aa861b3fd3f81c52cf7f3bdc852482910856b630`
- Scope-clean freeze source: `4527b4ae9b622d6961685bbdad889b045fabf815`
- Direct predecessor freeze source: `5deb371234bce8864b1fc6847474c6d31bddd332`

## Scope-clean proof

`4527b4ae9b622d6961685bbdad889b045fabf815` is exactly one commit ahead of `5deb371234bce8864b1fc6847474c6d31bddd332` and changes exactly `working/detailed-design/functions/F01-INTENT-COMPILATION.md`.
The F01 blob is byte-identical to the audited Design remediation commit `aa861b3fd3f81c52cf7f3bdc852482910856b630`.
No Registry, Evidence Registry, F00/F02/F03/F04/F06/F07, Data Model, UI reference, or other Product truth file changes.

## BF-044 remediation frozen by BS-P1-015

The replacement F01 contract freezes:
- `resolution_state = CONFIRMED | UNRESOLVED | PROPOSED`;
- bounded `expected_value_type` / `question_type` and deterministic pairing;
- explicit ambiguity/default/choice invariants;
- CP-003A for MATERIAL unresolved/proposed + no safe default;
- totality or `F01-ERR-014 INTERNAL_INVARIANT`;
- deterministic lexicographic question ranking;
- one-question-per-target grouping and highest-precedence rule ownership;
- deterministic question projection;
- suppression invariants forbidding NEEDS_CLARIFICATION with zero eligible questions;
- canonical FACT / DEFAULT / PROPOSAL / UNKNOWN classification.

## Boundary audit

- F01-AC-004/005/006 IDs and Test mappings remain unchanged.
- Acceptance Registry and Evidence Registry are unchanged.
- F01-AC-002 browser proof remains T009-owned.
- POI-005 / POI-006 remain deferred.
- T007-T009 remain unactivated.
- `build-spec/CURRENT.json` remains BS-P1-014 with implementation disabled.
- BF-044 remains BLOCKED.
- Cursor execution remains forbidden until separately approved activation/rebind and execution approval.

## Deterministic projection result

- Replacement baseline: `BS-P1-015`
- Projected artifact count: 48
- Changed projected artifact: `functions/F01-INTENT-COMPILATION.md`
- Baseline aggregate content SHA-256: `2b788f6d927699383235c768bef5dfe4e2f18196a14aac64d334e37d6d8fccf7`

## Freeze decision

Human approved BF-044 Build Freeze on 2026-10-04. Freeze-only; no T006 activation or Cursor authority.
