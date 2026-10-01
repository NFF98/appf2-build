# SP-P1-002 — BS-P1-004 Rebind + Activation Review

Program = PFR-2026  
Sprint = SP-P1-002  
Review date = 2026-10-01  
Build execution = HOLD  
Human Activation = NOT GRANTED

## 1. Canonical State During Review

This review does **not** pre-activate or partially rebind canonical execution state.

Current canonical control truth remains:

- `build-spec/CURRENT.json.active_baseline = BS-P1-003`
- `implementation_enabled = false`
- `delivery/CURRENT-SPRINT.json = HOLD`
- no active Sprint / Task
- `SP-P1-002` remains BLOCKED on its historical BS-P1-003 record until Human-approved activation transition
- `BS-P1-004 = LOCKED`

This follows the existing BS-P1-002 → BS-P1-003 precedent: rebind and CURRENT transition land atomically in the Human-approved Activation PR, not as a partial pre-activation mutation.

## 2. Replacement Baseline

`BS-P1-004`:

- status = LOCKED
- source = `91894ae8bd6241bb5ee1897180db72e9e578d1bf`
- supersedes = `BS-P1-003`
- approved deltas = `BD-003`, `BD-004`
- Build Freeze approval = `HUMAN-BUILD-FREEZE-BS-P1-004-20261001`
- content SHA-256 = `1520ad5aaec565f49438bffefd56e03c768d0a58347b1d566f09ae9b218568f9`

## 3. SP2 Acceptance / Task Rebind Audit

Existing SP2 plan:

- selected Backlog = 6
- Tasks = 9
- mapped Acceptance/Test pairs = 35
- missing Acceptance = 0
- Test ID mismatch = 0
- duplicate claim = 0
- missing required npm script = 0
- unknown required Skill = 0
- invalid Task dependency = 0

All 35 existing SP2 pairs are ACTIVE / required-for-freeze in BS-P1-004.

### A0 obligations that must be written into the atomic activation rebind

- **T001**
  - adopt Evidence Registry v3 envelope/property ownership and canonical Capability/version/digest representation;
  - close BF-023 by enforcing UUID v4 for canonical evidence identity/share envelope fields;
  - claim/revalidate `F07-AC-008 / TEST-F07-008`.
- **T002**
  - candidate_digest = SHA-256 of exact UTF-8 candidate payload bytes before parse, encoded `sha256:<64 lowercase hex>`;
  - staged nullable `validation_run.compiler_run_id`, no compiler_run FK before compiler persistence exists.
- **T006**
  - F01 bounded event evidence ownership; compiler economics remain compiler_run truth; no invented triggered-rule/token/cost product_event fields.
- **T008**
  - appf2-owned EvidenceRetentionMaintenance;
  - 90-day cutoff from first durable `received_at`;
  - `evidence_daily_aggregate` durable non-identifying owner;
  - watermark-guarded fail-closed raw deletion.

After completed-Acceptance revalidation is added, SP2 Activation mapping becomes **36** Acceptance/Test claims: the original 35 + `F07-AC-008` on T001.

## 4. Full Backlog Rebind Audit

The global Backlog ledger is tied to CURRENT baseline, so replacement rebind must occur atomically with Activation.

Current queue under BS-P1-003:

- total Backlog Items = 43
- DONE historical items = 5
- unfinished items = 38
  - SPRINTED = 6
  - QUEUED = 32

Activation plan:

- queue top-level `build_spec_id: BS-P1-003 → BS-P1-004`;
- all **38 unfinished** items rebind to BS-P1-004 and update their contract scope;
- 4 historical DONE items preserve their old baseline because mapped Acceptance semantics are unchanged;
- `BL-P1-032` preserves DONE / SP-P1-001 / BS-P1-003 history but requires explicit BS-P1-004 revalidation for changed `F07-AC-008`.

BS-P1-003 and BS-P1-004 both contain 288 ACTIVE required-for-freeze Acceptance entries, so there is no unexplained coverage-count drift.

## 5. BF-025 — Completed Acceptance Semantic Drift

`BL-P1-032` is DONE under BS-P1-003, but `F07-AC-008` changes materially in BS-P1-004:

- old: property allowlist + property type/enum/format/bounds/narrowing validation;
- new: additionally canonical envelope identifiers / UUID-v4 + reserved-envelope separation.

Silent carry-forward is forbidden.

Review remediation:

- historical item remains DONE with original baseline/Sprint provenance;
- add `revalidation` targeting BS-P1-004 / SP-P1-002 / T001;
- target Sprint manifest lists `revalidation_item_ids = [BL-P1-032]`;
- T001 claims `F07-AC-008 / TEST-F07-008`;
- changed Acceptance is current coverage only through revalidation, not through historical DONE;
- Sprint cannot close until revalidation is VERIFIED/CLOSED.

Governance attack suite includes both valid and missing-revalidation cases.

BF-025 remains OPEN until PR validation proves the new governance path.

## 6. BF-024 — Scope-clean Derived Freeze Provenance

BS-P1-004 uses Human-approved scope-clean Design source `91894ae8...`, while:

- BD-003 truthful Working source = `8ca4625ab71cd8884120ad1fe86d78f97cb19523`
- BD-004 truthful Working source = `c8325c60b1ee9e901e94af38825fd860f0852cd2`

The legacy Activation Gate required exact equality and would force false provenance.

Review remediation:

- retain truthful `upstream_working_commit`;
- add structured `freeze_source.type = SCOPE_CLEAN_DERIVED`;
- lock freeze source commit/base/audit record;
- Activation Gate accepts the derived source only with this complete provenance;
- mismatch / incomplete derived source remains rejected.

Governance attack suite includes positive and negative derived-provenance cases.

BF-024 remains OPEN until PR validation proves the new governance path.

## 7. Open PR / Open Item Review

Authoritative Build PR inventory:

- #1 — actions/upload-artifact major — DEFERRED_REVIEW
- #2 — actions/setup-node major — DEFERRED_REVIEW
- #4 — actions/checkout major — DEFERRED_REVIEW
- #94 — Vitest patch — MERGE_CANDIDATE, separate Human approval required
- #114 — this Rebind + Activation Review PR

Stale A0 PR #111 was inspected, marked SUPERSEDED, and closed without merge.

Design repo open PRs = 0.

Project items:

- POI-002 dependency PR inventory = non-blocking
- POI-003 dead patch cleanup = RESOLVED
- POI-004 blocked-task product:ci issue = OPEN / non-blocking

No dependency PR is approved for merge by this review.

## 8. Candidate Atomic Human Activation Transition

Only after this review is PASS and Human separately approves Activation:

1. add append-only `build-spec/activations/BS-P1-004.json`
   - type = REBASELINE
   - previous_baseline = BS-P1-003
   - source = `91894ae8bd6241bb5ee1897180db72e9e578d1bf`
   - approved deltas = `BD-003`, `BD-004`
2. `CURRENT.active_baseline: BS-P1-003 → BS-P1-004`
3. `implementation_enabled: false → true`
4. global Backlog: rebind 38 unfinished items to BS-P1-004
5. preserve 5 DONE histories; add BL-P1-032 revalidation metadata for F07-AC-008
6. `SP-P1-002: BLOCKED → ACTIVE`, `build_spec_id → BS-P1-004`
7. manifest adds `revalidation_item_ids = [BL-P1-032]`
8. all T001–T009 `build_spec_id → BS-P1-004`
9. T001 `BLOCKED → IN_PROGRESS`; T002/T006/T008 blocker states clear to PLANNED; all others remain PLANNED
10. T001 adds `F07-AC-008 / TEST-F07-008` and BF-023 completion proof
11. apply A0 Task obligations listed above
12. CURRENT-SPRINT binds `SP-P1-002 / BS-P1-004 / T001` ACTIVE

No Product implementation is included in that control transition.

## 9. Current Review Result

Activation Review = **PENDING PR #114 VALIDATION**  
BF-024 = OPEN  
BF-025 = OPEN  
Human Activation = NOT YET GRANTED  
Build = HOLD  
Cursor Product Implementation = NOT AUTHORIZED
