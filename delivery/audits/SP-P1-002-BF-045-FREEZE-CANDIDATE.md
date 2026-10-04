# SP-P1-002 / BF-045 — BS-P1-016 Freeze Candidate Audit

## Verdict

PASS — replacement freeze candidate is scope-clean and limited to BF-045 F01 clarification answer-value ownership, dependency invalidation, and state/value invariant remediation.

## Canonical references

- Finding: `BF-045 SPEC_AMBIGUITY`
- Previous locked baseline: `BS-P1-015`
- Canonical Design remediation: `b665370eb43b1eadaa0a24c14ae60e8ad024fac3`
- Scope-clean freeze source: `b47429e94fae3a6d32c35e3ec3b46b1be4497377`
- Direct predecessor freeze source: `4527b4ae9b622d6961685bbdad889b045fabf815`
- Replacement baseline: `BS-P1-016`

## Scope-clean audit

PASS.

The scope-clean source is exactly one commit ahead of the BS-P1-015 freeze source and changes exactly:

`working/detailed-design/functions/F01-INTENT-COMPILATION.md`

No Registry, Evidence Registry, F00/F02/F03/F04/F06/F07, Data Model, UI reference, or other Product truth file changes are absorbed into BS-P1-016.

## BF-045 remediation frozen by BS-P1-016

1. Policy-visible `resolved_value?` is the sole canonical confirmed concrete value owner inside StructuredIntentEnvelope / intent_record.structured_intent.
2. Parallel durable `user_explicit_values` or clarification-answer sidecar truth is forbidden.
3. CONFIRMED / UNRESOLVED / PROPOSED now have closed value/default/source invariants.
4. `UNRESOLVED + can_default=true` is an Envelope invariant failure.
5. `DOMAIN_KNOWN + PROPOSED` is an Envelope invariant failure.
6. Clarification answer / EDIT writes USER_EXPLICIT + CONFIRMED + resolved_value and clears proposal/default state.
7. Accepted LLM proposal moves proposed_default to resolved_value and retains USER_ACCEPTED_PROPOSAL provenance.
8. Accepted NFF default moves proposed_default to resolved_value while preserving NFF_DEFAULT policy provenance.
9. Trusted answer/assumption merge performs recursive fixpoint invalidation of stale PROPOSED dependent defaults/proposals over `depends_on_ids[]` before policy re-evaluation.
10. Invalidated descendant IDs join `changed_semantic_item_ids[]`; unrelated branches and confirmed User truth are not silently overwritten.

## Same-class audit

PASS.

- Answer value has one durable owner.
- Proposal/default invalidation is deterministic and recursive.
- changed_semantic_item_ids includes resolved_value and actual invalidations.
- Source/resolution/value/default combinations are closed enough to reject the two contradictory states found by the BS-P1-015 candidate sweep.
- No-reask still uses target + recursive upstream dependency closure; invalidation does not turn unrelated edits into re-ask authority.
- F01-AC-001 / 004 / 005 / 006 mappings remain unchanged; no new Acceptance semantics are invented.

## Boundary audit

- F01-AC-002 browser proof remains T009-owned.
- No LLM provider/full Compiler implementation is added.
- No Evidence event/property ownership changes.
- Candidate `e3ca711c8126fbf5d090571a007840b8e51306e9` remains non-canonical implementation history and must not be merged as-is.
- T007-T009 remain unactivated.
- Cursor execution remains forbidden until BS-P1-016 is activated and a fresh explicit Cursor EXECUTE is issued.

## Freeze decision

Human BCE approval on 2026-10-04 covers remediation through the pre-Cursor boundary. BS-P1-016 is approved for freeze only in this transition; CURRENT remains BS-P1-015 / HOLD until a separate activation control transition inside the same bounded approval envelope.
