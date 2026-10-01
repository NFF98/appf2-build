# SP-P1-002 — BS-P1-004 Rebind + Activation Review

Program = PFR-2026
Sprint = SP-P1-002
Review date = 2026-10-01
Build execution = HOLD
Human Activation = NOT GRANTED

## Rebind State

- Sprint manifest: REVIEW
- Sprint Build Spec: BS-P1-004
- T001–T009: PLANNED
- all nine Tasks: build_spec_id = BS-P1-004
- six selected Backlog items remain SPRINTED to SP-P1-002 and are rebound to BS-P1-004
- CURRENT.active_baseline remains BS-P1-003
- implementation_enabled remains false
- CURRENT-SPRINT remains HOLD with no active Sprint / Task

No Product implementation is authorized by this review.

## A0 Remediation Carry-forward

The rebind explicitly carries the Human-approved A0 obligations into executable Task wording:

- T001 — Evidence Registry v3 ownership/representation + BF-023 UUID-v4 validator correction.
- T002 — exact candidate_digest bytes/hash representation + staged nullable compiler_run_id relationship.
- T006 — F01 evidence source ownership boundaries.
- T008 — EvidenceRetentionMaintenance + received_at cutoff + evidence_daily_aggregate + watermark-guarded deletion.

BF-023 remains OPEN and is bound to T001 completion evidence. It is an implementation bug under an already-locked contract, not a Product/contract blocker.

## Acceptance / Task Audit

Independent rebind audit:

- selected Backlog items = 6
- Tasks = 9
- selected Acceptance/Test pairs = 35
- unique Task claims = 35
- missing Acceptance = 0
- Test ID mismatch = 0
- duplicate Acceptance ownership = 0
- missing required npm scripts = 0
- unknown required skills = 0
- invalid Task dependency references = 0

Result: PASS.

## Replacement Baseline

BS-P1-004:

- status = LOCKED
- source = 91894ae8bd6241bb5ee1897180db72e9e578d1bf
- supersedes = BS-P1-003
- approved deltas = BD-003 + BD-004
- Build Freeze approval = HUMAN-BUILD-FREEZE-BS-P1-004-20261001

## Activation Provenance Review

Activation Review discovered BF-024:

The legacy Activation Gate assumed every approved Design Delta upstream_working_commit must equal the replacement baseline source commit. This is invalid for the Human-approved scope-clean derived freeze source because:

- BD-003 truthful upstream Working = 8ca4625ab71cd8884120ad1fe86d78f97cb19523
- BD-004 truthful upstream Working = c8325c60b1ee9e901e94af38825fd860f0852cd2
- BS-P1-004 scope-clean freeze source = 91894ae8bd6241bb5ee1897180db72e9e578d1bf

Rewriting the Delta Working SHAs to 91894ae8... would falsify provenance.

This review therefore adds machine-checked SCOPE_CLEAN_DERIVED provenance to BD-003/BD-004 and updates Activation/Delta gates. The attack dry-run contains both:
- positive case: truthful upstream Working + valid derived source passes;
- negative case: derived source mismatch fails.

BF-024 remains OPEN until the PR required checks prove this governance path.

## Open PR / Open Item Review

Authoritative Build open-PR inventory before this review PR is created:

- #1 actions/upload-artifact major — DEFERRED_REVIEW
- #2 actions/setup-node major — DEFERRED_REVIEW
- #4 actions/checkout major — DEFERRED_REVIEW
- #94 Vitest patch — MERGE_CANDIDATE, requires separate Human approval

Stale A0 PR #111 was inspected, marked SUPERSEDED, and closed without merge.

Design repo open PRs = 0.

Project items:
- POI-002 dependency inventory = non-blocking
- POI-003 dead patch cleanup = RESOLVED
- POI-004 blocked-task product:ci tooling issue = OPEN / non-blocking

## Candidate Human Activation Transition

If and only if this Activation Review reaches PASS and Human separately approves Activation, the next control-only transition is:

- create append-only build-spec/activations/BS-P1-004.json
- type = REBASELINE
- previous_baseline = BS-P1-003
- source_working_commit = 91894ae8bd6241bb5ee1897180db72e9e578d1bf
- approved_delta_ids = [BD-003, BD-004]
- CURRENT.active_baseline: BS-P1-003 → BS-P1-004
- implementation_enabled: false → true
- SP-P1-002: REVIEW → ACTIVE
- T001: PLANNED → IN_PROGRESS
- CURRENT-SPRINT: HOLD → SP-P1-002 / BS-P1-004 / T001 ACTIVE
- all other Tasks remain PLANNED

No dependency PR merge and no Product scope expansion is implied.

## Current Review Result

Activation Review = PENDING PR VALIDATION
Human Activation = NOT YET GRANTED
Build = HOLD
Cursor = NOT AUTHORIZED
