# A0 — SP2 Comprehensive Contract Re-Audit

Program = PFR-2026
Sprint = SP-P1-002
Build = HOLD
Active Locked Baseline = BS-P1-003
Planned Replacement = BS-P1-004
Cursor Product Implementation = NOT AUTHORIZED

## A0 Scope
F01/F02/F04/F07; T001–T009; Acceptance/Test; machine registries; canonical examples; persistence/retention ownership; E2E feasibility; Design→Build projection.

## First-Pass Result
- 35/35 selected Acceptance/Test mappings present, unique, and owner text matches.
- Phase 1 Event / Acceptance / Error index audit passed.
- F02/F04 resource ceilings and F03 typed operator dependency passed.
- BF-014 exposed class-level Evidence Registry defects; A0 expanded the blast-radius audit and recorded BF-015～BF-023.
- Directly affected Tasks T001 / T002 / T006 / T008 were fail-closed to BLOCKED.
- Build remained HOLD.

## Human Resolution
On 2026-10-01 Human explicitly approved the BF-016～BF-023 resolution directions and authorized A0 Phase 2 remediation.

- BF-020 / BF-021 / BF-022 contract semantic changes are governed by BD-004.
- BF-016 / BF-017 / BF-018 / BF-019 are Working ownership / migration-order / representation closures.
- BF-023 remains implementation work: contract is now locked to UUID v4, but production validator is not yet changed.

## Phase 2 Working Remediation
appf2-design PR #7 merged as:

`c8325c60b1ee9e901e94af38825fd860f0852cd2`

Remediation includes:

1. F01 Evidence source ownership:
   - product_event envelope/properties separated,
   - compiler_run owns token/cost truth,
   - triggered_rule_ids remain policy/API truth.
2. F02 candidate_digest:
   - SHA-256 over exact pre-parse UTF-8 candidate_payload_bytes,
   - canonical representation `sha256:<64 lowercase hex>`.
3. validation_run.compiler_run_id staged FK:
   - nullable UUID column allowed before compiler_run table exists,
   - later migration validates non-NULL rows and adds physical FK.
4. EvidenceRetentionMaintenance:
   - appf2-owned maintenance semantics,
   - default daily replaceable trigger,
   - retention cutoff anchored to first durable received_at.
5. evidence_daily_aggregate:
   - bounded non-identifying owner,
   - deterministic logical unique key,
   - aggregate-before-delete fail-closed watermark.
6. Evidence envelope single truth:
   - reserved envelope names prohibited in properties,
   - Blueprint schema dimension renamed to blueprint_schema_version,
   - affected event families receive breaking major schema bumps.
7. UUID boundary:
   - event_id / anonymous_id / session_id / share_id machine contract = UUID v4.
8. Acceptance Registry observable text aligned to the remediated contracts.

## Second Executable Contract Re-Audit — PASS
Working / candidate audit results:

- Evidence Registry = 3.0.0.
- Evidence events = 112.
- reserved-envelope collisions = 0.
- missing envelope schemas = 0.
- missing property schemas = 0.
- regex compile errors = 0.
- Acceptance Registry = 2.3.0 / 289 entries.
- SP-P1-002 selected Acceptance/Test mapping = 35/35, no test-ID drift.
- Affected event family versions:
  - F00/F01/F02/F04/F05/F06/F16 = 2.0.0
  - F03 = 3.0.0
  - F12 unchanged = 1.0.0
- UUID v4 machine schema confirmed for event_id / anonymous_id / session_id / share_id.
- F01/F02/F07/DATA-MODEL/INFRA owner cross-check = PASS.

## Clean Rebaseline Source Candidate — READY FOR HUMAN FREEZE DECISION
Latest Working main is not a valid direct Freeze source because it also contains PFR/F19/future projected truth.

A clean candidate was therefore constructed from the exact BS-P1-003 Design source commit:

`3818926b82ae2c5edaf9d6115fda3d1505757781`

Candidate branch:

`freeze/BS-P1-004-a0-candidate`

Candidate commit:

`2e05725c706dfa37306ccf9df5b8b29f2f09368b`

Projection-scope audit:

- changed projected files = exactly 11 A0/BF14-23 allowlisted files;
- unexpected projected files = 0;
- no APP-ARCHITECTURE / CAPABILITY-FABRIC / common DATA-MODEL / APP-DETAILED-DESIGN-OVERVIEW / F06 future drift is included;
- F05 / detailed DATA-MODEL / Infra were surgically patched from the old pinned source rather than copied from latest Working;
- BF-014/015 corrections are included.

## Current Finding State
Open pending replacement baseline / implementation:
BF-014, BF-015, BF-016, BF-017, BF-018, BF-019, BF-020, BF-021, BF-022, BF-023.

Why they remain OPEN:
- BF-014～BF-022: remediated Working truth exists, but BS-P1-003 is still the active locked baseline.
- BF-023: current production validator still accepts UUID v1-v5; replacement baseline must authorize implementation correction.

T001 / T002 / T006 / T008 remain BLOCKED.
Build remains HOLD.

## A0 Gate Result
A0 Phase 2 Remediation = PASS.
Executable contract re-audit = PASS.
Clean projection candidate = PASS / scope-clean.
Build Freeze = NOT YET APPROVED.
BS-P1-004 = NOT CREATED.
Cursor Product Implementation = NOT AUTHORIZED.

## Next Human Gate
Human Build Freeze decision for Design candidate:

`2e05725c706dfa37306ccf9df5b8b29f2f09368b`

If approved, next sequence is:

Human Build Freeze approval
→ create BS-P1-004 superseding BS-P1-003 from the clean candidate
→ verify projection / baseline gates
→ rebind SP-P1-002 Tasks to BS-P1-004, including the BF-023 validator correction scope
→ Activation Review
→ Human Activation
→ only then resume Cursor at T001.
