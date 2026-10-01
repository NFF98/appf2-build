# SP-P1-002 — BS-P1-005 Rebind + T002 Activation Review

Program = PFR-2026  
Sprint = SP-P1-002  
Review date = 2026-10-02 (Japan time)  
Build execution = HOLD  
Human Activation = NOT GRANTED

## 1. Canonical State During Review

This review does **not** activate implementation.

Canonical main at review start:

- `appf2-build main = 436f7a35bc63451cfe9d7ad12bf6cbb4c4bae75c`
- `BS-P1-005 = LOCKED`
- `build-spec/CURRENT.json.active_baseline = BS-P1-004`
- `implementation_enabled = false`
- `delivery/CURRENT-SPRINT.json = HOLD`
- no active Sprint / Task
- `SP-P1-002 = BLOCKED`
- `T001 = CLOSED`
- `T002 = BLOCKED`
- `T003–T009 = PLANNED`

Cursor Product implementation remains unauthorized until a separate Human Activation approval.

## 2. Replacement Baseline

`BS-P1-005`:

- status = LOCKED
- source = `abd91f50fa520a4ecd047207da7e2a804762e415`
- supersedes = `BS-P1-004`
- approved delta provenance = `BD-003`, `BD-004`, `BD-005`
- Human Build Freeze decision = `HUMAN-BUILD-FREEZE-BS-P1-005-20261002`
- freeze merge = `a8ab9bd7c59a769bb61f1e03965b6a34942d3cf8`
- content SHA-256 = `2fc3f8e975ee1433987ab93d962eedd4fbf9f5c28632c4e5fd5d199c17888f16`

Scope-clean proof:

- prior freeze source = `91894ae8bd6241bb5ee1897180db72e9e578d1bf`
- new scope-clean source = `abd91f50fa520a4ecd047207da7e2a804762e415`
- Design diff changes exactly:
  - `working/detailed-design/functions/F02-BLUEPRINT-VALIDATION.md`
  - `working/detailed-design/functions/F04-CAPABILITY-REGISTRY.md`
- baseline blob comparison = 49 → 49 blobs
- changed baseline blobs only:
  - `functions/F02-BLUEPRINT-VALIDATION.md`
  - `functions/F04-CAPABILITY-REGISTRY.md`
  - `projection-map.json`
  - `manifest.json`
- no baseline file missing / added outside the replacement baseline itself

## 3. Acceptance / Backlog Rebind Audit

BS-P1-004 and BS-P1-005 use the **same Acceptance Registry blob**:

- BS-P1-004 entries = 289
- BS-P1-005 entries = 289
- entry JSON = byte/semantic identical
- no Acceptance ID, Test ID, contract status or criterion drift

Current Backlog:

- total = 43
- DONE = 6
- unfinished = 37
  - SPRINTED = 5
  - QUEUED = 32

Atomic Activation rebind rule:

- queue top-level baseline: `BS-P1-004 → BS-P1-005`
- all 37 unfinished Backlog Items: `build_spec_id → BS-P1-005`
- 6 DONE histories preserve their historical Build Spec / Sprint provenance
- no completed work is rewritten as if it ran under BS-P1-005

## 4. T001 / BL-P1-032 Historical Proof Preservation

T001 is already CLOSED under BS-P1-004 and **must not reopen**.

`BL-P1-032` remains historical DONE under BS-P1-003. Its material F07-AC-008 semantic drift was already revalidated and CLOSED by SP-P1-002/T001 against BS-P1-004.

BS-P1-004 → BS-P1-005 introduces **zero additional F07-AC-008 semantic drift** because the Acceptance Registry is identical.

BF-032 remediation now machine-validates:

- a CLOSED ancestor revalidation can carry forward when its revalidated Acceptance has no later semantic drift;
- the CLOSED Task remains at its historical Build Spec;
- later semantic drift invalidates carry-forward and requires a new revalidation.

Direct attack proof:

- `CLOSED ancestor revalidation carries forward across unchanged semantics` = PASS
- `Historical revalidation cannot cover later semantic drift` = rejected as expected

Therefore the BS-P1-005 Sprint manifest must **remove current `revalidation_item_ids = [BL-P1-032]`**. The existing Backlog revalidation record remains historical evidence; no new T001 execution is created.

## 5. T002 Rebind Scope

T002 remains the owner of F02-AC-004 through F02-AC-008.

Its BS-P1-005 implementation scope must include:

1. F02 Candidate Blueprint parsing / exact executable schema validation.
2. canonical state TypeDescriptor validation from BS-P1-005.
3. Value Source contextual typing.
4. Registry-backed exact capability/version/props/bindings/events/actions/composition validation.
5. implementation of the F04 generated validator machine contract required by BF-031.
6. immutable `validation_run` / `blueprint_content` persistence.
7. exact pre-parse `candidate_digest` semantics.
8. staged nullable `validation_run.compiler_run_id`.

T002 write scope must expand **only** by:

~~~text
src/platform/capabilities/
generated/capabilities/
~~~

Existing allowed roots remain:

~~~text
src/platform/blueprint/
supabase/migrations/
tests/contract/
tests/behavior/
tests/regression/
~~~

No T003-owned F02-AC-009–012 safety/resource semantics are moved into T002.

## 6. BF-030 / BF-031 Resolution Boundary

BF-030 and BF-031 currently remain BLOCKED in canonical HOLD state.

At the Human-approved BS-P1-005/T002 Activation transition they may move to **RESOLVED**, because the implementation blockers have been removed:

- exact Product/Schema truth is now frozen in BS-P1-005;
- T002 is authorized to write the Capability Registry/generated-validator surfaces required to implement that truth;
- no second F02 capability schema/allowlist is permitted;
- F03 remains the canonical owner of operator signatures;
- future-diff gates prove the expanded T002 scope is executable.

This finding resolution **does not claim the production generated validator implementation is already complete**. That implementation remains T002 work and must satisfy T002 Acceptance, tests, review and merge gates.

## 7. SHAME-017 Future-Diff Direct Proof

Proof PR #134 = `PROOF ONLY — T002 BS-P1-005 future-diff gate`.

Latest proof head:

`8646dab058c146a6f089d1393e3ac41b25c3a82e`

The PR was Draft / DO NOT MERGE and was closed without merge after proof.

Direct CI log proved:

- `CHANGE SCOPE GATE: PASS`
- active-task `TEST INTEGRITY GATE: PASS`
- Engineering Quality = PASS
- Product CI executed, not HOLD / CONTROL-ONLY
- `npm run check:types`
- `npm run check:lint`
- `npm run security:audit`
- `npm run gate`
- `npm run test:contract`
- `npm run test:behavior`
- `npm run test:regression`
- final `PRODUCT CI: PASS`

Proof roots included:

~~~text
src/platform/blueprint/
src/platform/capabilities/
generated/capabilities/
tests/contract/
~~~

All five T002 mapped Test IDs were present exactly once in the proof test surface.

The proof artifacts never entered main and are not implementation evidence.

## 8. BF-032 / BF-033 Governance Remediation

PR #135 directly hardened the shared rebaseline path.

BF-032:
- preserves CLOSED historical revalidation across later semantic identity;
- refuses carry-forward when later semantic drift occurs.

BF-033:
- classifies inherited deltas as the intersection of predecessor/replacement manifest delta IDs;
- treats every other listed delta as introduced in the current rebaseline;
- respects existing non-cumulative baseline history;
- introduced deltas must bind to the immediate previous baseline and current source provenance.

Attack Dry-run = **90 / 90 expected outcomes observed**.

PR #135 latest-head Governance / CI / Attack / CodeQL = PASS and merged as:

`436f7a35bc63451cfe9d7ad12bf6cbb4c4bae75c`

## 9. Candidate Atomic Human Activation Transition

Only after explicit Human approval of **BS-P1-005 / SP-P1-002 / T002 Activation**:

1. add append-only `build-spec/activations/BS-P1-005.json`
   - type = REBASELINE
   - previous_baseline = BS-P1-004
   - source = `abd91f50...`
   - approved delta IDs exactly match BS-P1-005 manifest
   - own Human Activation decision ref
2. `build-spec/CURRENT.json`
   - `active_baseline: BS-P1-004 → BS-P1-005`
   - `implementation_enabled: false → true`
3. Backlog
   - top-level baseline → BS-P1-005
   - 37 unfinished items → BS-P1-005
   - 6 DONE histories preserved
   - BL-P1-032 historical CLOSED revalidation preserved; no fresh revalidation
4. SP-P1-002 manifest
   - `BLOCKED → ACTIVE`
   - `build_spec_id → BS-P1-005`
   - remove current `revalidation_item_ids`
   - write new Human Activation approval ref
5. Tasks
   - T001 stays `CLOSED / BS-P1-004`
   - T002 → `IN_PROGRESS / BS-P1-005`
   - T002 adds exactly `src/platform/capabilities/` + `generated/capabilities/`
   - T003–T009 stay PLANNED and rebind to BS-P1-005
6. Findings / Delta
   - BF-030 → RESOLVED
   - BF-031 → RESOLVED
   - BF-032 / BF-033 remain RESOLVED
   - BD-005 → IMPLEMENTING
7. CURRENT-SPRINT binds:
   - sprint = SP-P1-002
   - baseline = BS-P1-005
   - task = T002
   - status = ACTIVE
8. all direct activation/governance/baseline/sprint/backlog/change-scope gates must PASS before Cursor instruction is issued.

## 10. T002 Implementation Review Requirements After Activation

Activation is authorization to implement, not approval of the old candidate.

Cursor must rebase/surgically align the existing T002 work to the new canonical main and BS-P1-005:

- retain only portions still valid under BS-P1-005;
- remove provisional/invented state-schema and Registry inference semantics;
- implement the generated validator machine contract from the canonical F04 truth;
- F02 consumes that generated truth; no second hand-written capability schema;
- no T003 scope expansion.

Before T002 implementation merge, direct proof still requires:

- required T002 npm commands PASS;
- real Postgres/Supabase migration apply + persistence/immutability proof;
- generated validator contract tests proving typed props/bindings/events/actions/composition;
- no Product/schema decisions invented by Cursor.

## 11. Review Result

**Activation Review = PASS / READY FOR HUMAN ACTIVATION**

Current state remains:

- BS-P1-005 = LOCKED
- CURRENT = BS-P1-004
- implementation = HOLD
- T002 = BLOCKED
- BF-030 / BF-031 = BLOCKED pending atomic Human-approved Activation
- Cursor = NOT AUTHORIZED

Human Activation = **NOT YET GRANTED**.
