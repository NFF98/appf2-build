# A0 Phase 2 — SP2 Contract Remediation + Clean Freeze Candidate

Program = PFR-2026
Sprint = SP-P1-002
Build = HOLD
Active Locked Baseline = BS-P1-003
Planned Replacement = BS-P1-004
Cursor Product Implementation = NOT AUTHORIZED

## Human Decision

2026-10-01 Human approved the BF-016 through BF-023 resolution directions and authorized A0 Phase 2 remediation.

## Working Remediation

Canonical Working remediation commit:

`c8325c60b1ee9e901e94af38825fd860f0852cd2`

Resolved contract directions:

- BF-016 — F01 event evidence is separated from compiler_run economics and clarification-policy semantic truth.
- BF-017 — validation_run.compiler_run_id uses staged nullable relationship semantics until compiler persistence is present.
- BF-018 — appf2-owned EvidenceRetentionMaintenance owns retention semantics; deployment scheduler is a replaceable trigger only.
- BF-019 — candidate_digest = SHA-256 of exact UTF-8 candidate payload bytes before parse, encoded as sha256:<64 lowercase hex>.
- BF-020 — 90-day raw retention cutoff uses first durable received_at.
- BF-021 — evidence_daily_aggregate is the bounded non-identifying durable aggregate owner and raw deletion fails closed until aggregate watermark coverage is verified.
- BF-022 — common Evidence envelope is canonical for reserved event-level fields; properties cannot duplicate reserved envelope field names.
- BF-023 — canonical anonymous/session/share Evidence identity boundary is UUID v4; production validator fix remains implementation work under T001.

## Second Executable Contract Audit

PASS:

- Evidence Registry = 3.0.0.
- Event count = 112.
- Reserved envelope fields = 15.
- Envelope/property collisions = 0.
- SP2 selected Acceptance/Test mapping = 35/35.
- event_id / anonymous_id / session_id / share_id envelope schemas lock UUID v4.
- canonical capability IDs including data.table_basic / data.chart_basic / media.audio_playback pass.
- invalid numeric-leading / multi-segment / hyphen capability samples fail.
- registry regex compile warnings = 0.

## Scope-Clean Projection

Current Working main cannot be frozen directly because it also contains later PFR/F18/F19/F20/future changes.

A derived Freeze Candidate source was therefore created:

`91894ae8bd6241bb5ee1897180db72e9e578d1bf`

Base:
`3818926b82ae2c5edaf9d6115fda3d1505757781` — BS-P1-003 Design source.

The derived source applies only approved BF-014 through BF-023 remediation and changes exactly these 11 paths:

- working/common-core/INFRA-ARCHITECTURE.md
- working/detailed-design/data-model/DATA-MODEL-DETAILED.md
- working/detailed-design/functions/F01-INTENT-COMPILATION.md
- working/detailed-design/functions/F02-BLUEPRINT-VALIDATION.md
- working/detailed-design/functions/F03-RUNTIME-EXECUTION.md
- working/detailed-design/functions/F04-CAPABILITY-REGISTRY.md
- working/detailed-design/functions/F05-SHARE-RESTORE.md
- working/detailed-design/functions/F07-ANONYMOUS-IDENTITY-EVIDENCE.md
- working/detailed-design/infrastructure/INFRASTRUCTURE-DETAILED.md
- working/detailed-design/registries/acceptance-test-registry.json
- working/detailed-design/registries/evidence-event-registry.json

No F18/F19/F20, Phase 4 UI, Business Plan, or unrelated future Product truth is included.

## Finding State

- BF-014 / BF-015: Working correction verified; still blocked on replacement Build Spec.
- BF-016 through BF-022: Human-approved Working remediation verified; blocked on replacement Build Spec.
- BF-023: existing-contract implementation bug; remains OPEN for T001 implementation after reactivation.

## Gate Result

A0 Phase 2 Contract Remediation = PASS.
Clean Freeze Candidate = READY FOR HUMAN BUILD FREEZE REVIEW.

No BS-P1-004 exists yet.
No SP2 rebind / activation has occurred.
Cursor remains prohibited.

Next Human Gate = BS-P1-004 Build Freeze Approval.
