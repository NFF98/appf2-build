# SP-P1-002 / BF-044 — BS-P1-015 Freeze Candidate Audit

## Verdict

PASS — replacement freeze candidate is scope-clean and limited to BF-044 F01 clarification-policy totality / deterministic question contract remediation.

## Canonical inputs

- Affected baseline: `BS-P1-014`
- Affected task: `SP-P1-002 / T006`
- Finding: `BF-044 SPEC_AMBIGUITY`
- Design Working remediation: `aa861b3fd3f81c52cf7f3bdc852482910856b630`
- Scope-clean freeze source: `4527b4ae9b622d6961685bbdad889b045fabf815`
- Direct predecessor freeze source: `5deb371234bce8864b1fc6847474c6d31bddd332`

## Scope-clean proof

`4527b4ae9b622d6961685bbdad889b045fabf815` is exactly one commit ahead of `5deb371234bce8864b1fc6847474c6d31bddd332` and changes exactly:

- `working/detailed-design/functions/F01-INTENT-COMPILATION.md`

No Registry, Evidence Registry, F00/F02/F03/F04/F06/F07, Data Model, UI reference, or other Product truth file is changed by the scope-clean freeze source.

## BF-044 remediation frozen by BS-P1-015

The replacement F01 contract closes the same-class machine gaps found after BS-P1-014:

- explicit `resolution_state` and deterministic answer-shape fields on policy-visible items;
- machine-safe default predicate and ambiguity alternative invariant;
- `F01-POL-CP-003A` totality fallback for unresolved MATERIAL items without a safe default;
- CP-004 restricted to MATERIAL PROPOSED safe defaults and CP-006 to fully confirmed material truth;
- totality invariant: any valid Envelope must have one contract-authorized outcome or fail as existing `F01-ERR-014 INTERNAL_INVARIANT`;
- one-item-per-question Phase 1 grouping, highest-precedence rule ownership, deterministic lexicographic ranking and max-three selection;
- deterministic question type / expected type / option projection;
- suppression consistency: answered questions cannot create NEEDS_CLARIFICATION with zero eligible questions; stale blocker truth after accepted merge is an internal invariant;
- explicit FACT / DEFAULT / PROPOSAL / UNKNOWN classification and safe assumption acceptance/edit/reject semantics.

## Same-class totality audit

PASS:

1. MATERIAL + unresolved/proposed + no safe default is owned by CP-003A unless a higher-priority NC rule owns it.
2. MATERIAL + proposed + safe default is owned by CP-004.
3. Confirmed MATERIAL truth can reach CP-006 only when no higher blocker remains.
4. COSMETIC items cannot become execution/risk blockers and remain CP-005/non-material.
5. NEEDS_CLARIFICATION always projects 1–3 eligible questions; impossible projection or stale suppressed blocker is F01-ERR-014.
6. Question identity, grouping, type, options and ranking no longer depend on LLM/insertion-order guesses.

## Boundary audit

- Existing T006 mappings F01-AC-001/003/004/005/006/017 remain unchanged.
- F01-AC-002 browser proof remains T009-owned.
- No Evidence event/property or compiler economics ownership changes.
- POI-005 and POI-006 remain deferred.
- T007-T009 remain unactivated.
- Cursor execution remains forbidden until separate BS-P1-015 activation/rebind is canonical and a later explicit Human Cursor approval is issued.

## Freeze decision

Human approved BF-044 remediation continuously through the pre-Cursor restart boundary on 2026-10-04.

Replacement baseline: `BS-P1-015`.
