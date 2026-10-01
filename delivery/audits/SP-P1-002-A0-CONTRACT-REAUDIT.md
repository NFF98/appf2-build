# A0 — SP2 Comprehensive Contract Re-Audit

Program = PFR-2026
Sprint = SP-P1-002
Build state = HOLD
Baseline under audit = BS-P1-003
Product implementation = NOT AUTHORIZED

## Audit scope

F01 / F02 / F04 / F07; T001–T009; Acceptance/Test mapping; Evidence Registry machine rules; canonical examples; Data Model/migration ownership; retention execution; E2E feasibility; Design→Build projection.

## Verified PASS

- T001–T009 selected Acceptance/Test mapping: 35/35 present and unique.
- F01 event IDs/names: 14/14 match Evidence Registry.
- F02 event IDs/names: 13/13 match.
- F04 event IDs/names: 8/8 match.
- F01/F02/F04/F07 error IDs all have Recovery Registry references.
- Evidence Registry structural checks pass except Findings below.
- T007 client queue boundary is implementable and bounded.
- T009 existing Playwright/build toolchain and allowed paths are sufficient.
- blueprint_hash fields reference blueprint_content.content_hash consistently.
- validation_run / blueprint_content field contracts are otherwise explicit.

## Open Findings

- BF-014 — original Evidence regex escaping / digest representation blocker.
- BF-015 — capability_id Evidence grammar contradicts canonical F04 grammar.
- BF-016 — F01 Evidence dimension text conflicts with canonical evidence-source ownership.
- BF-017 — T002 validation migration lacks compiler_run reference staging ownership.
- BF-018 — T008 90-day retention lacks a defined periodic execution owner.
- BF-019 — F02 candidate_digest representation is undefined.

## Clarification, not blocker

Evidence Registry x-semantic-rule metadata is not part of generic F07 intake type/enum/format/bounds enforcement. Domain producers own those semantic obligations. Working must say this explicitly to prevent future false assumptions.

## Projection

Replacement Freeze remains blocked because current Working includes projected PFR/F19/future-compatibility changes beyond SP2. A0 must produce scope-clean projection truth before BS-P1-004.

## Exit gate

A0 can advance to Human Build Freeze Review only when:
1. all blocking Findings are resolved/verified;
2. comprehensive re-audit returns zero blocking issues;
3. Design→Build projection is scope-clean;
4. Build remains HOLD until Human explicitly approves the replacement freeze.
