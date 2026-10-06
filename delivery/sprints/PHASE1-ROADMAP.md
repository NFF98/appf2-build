# Phase 1 Delivery Roadmap — Product-First Alignment

> Status: CURRENT PLANNING ROADMAP / FUTURE STAGES PROVISIONAL  
> Current locked Build Spec: `BS-P1-019`  
> Canonical Build control state: `build-spec/CURRENT.json` + `delivery/CURRENT-SPRINT.json`  
> Design planning source: `NFF98/appf2-design/working/PHASE-REALIGNMENT-PROGRAM.md`

This roadmap is a planning view. It does **not** reserve future Build Spec IDs, Sprint IDs, Product semantics, or implementation authority.

## Planning Principles

- Product truth remains the current Human-approved locked Build Spec; this roadmap does not add requirements.
- HUMAN owns Build Freeze and Sprint Activation.
- ChatGPT is the Planning / Audit / Evidence-normalization agent.
- Cursor consumes only Human-activated Tasks.
- Only an actually created Sprint directory + Human-approved activation can establish a canonical `SP-P1-NNN`.
- Future Product-First stages use stable stage names until detailed planning creates a Sprint.
- Future Build Specs receive their numeric ID only when the Human-approved Freeze candidate is actually created.
- Historical Build/Sprint IDs are immutable and are never renamed, recycled, or reassigned.

## Current Executed / Detailed Scope

| Canonical unit | Goal | Current state |
|---|---|---|
| `SP-P1-001` | Platform foundations: trusted capability registry, canonical Blueprint identity, anonymous identity, evidence intake/retry foundations | **CLOSED** |
| `SP-P1-002` | Validation + intent foundation + evidence reliability | **CLOSED** — T001–T009 CLOSED; all six selected Backlog items DONE |

Current canonical execution boundary:

- Canonical control state is read from `build-spec/CURRENT.json` + `delivery/CURRENT-SPRINT.json`.
- `BS-P1-019 = LOCKED` and supersedes `BS-P1-018`.
- `implementation_enabled = false`.
- `delivery/CURRENT-SPRINT.json = HOLD`.
- SP-P1-002 is CLOSED; T001–T009 are CLOSED.
- No Sprint or Task is currently active.
- POI-005 records non-blocking future production HTTP / Runtime / Postgres fresh-admission wiring and must not be silently absorbed into T004.

## Product-First Future Stage Sequence

The Human-approved Product-First order is:

~~~text
SP-P1-002 foundation — CLOSED
→ Product Proof Stage A — Playable App
→ Product Proof Stage B — Share + Shared Ranking
→ Product Proof Stage C — Remix + Lineage
→ Product Hardening + Phase 1 Close
~~~

| Planning stage | Human outcome | Sprint ID | Backlog allocation |
|---|---|---|---|
| Product Proof Stage A — Playable App | Intent → generated App → render → play | **TBD at Sprint creation** | Candidate mapping: 12 existing queued items |
| Product Proof Stage B — Share + Shared Ranking | Share → recipient use → bounded asynchronous Shared Ranking | **TBD at Sprint creation** | Candidate mapping: 3 existing + BL-P1-044/045 |
| Product Proof Stage C — Remix + Lineage | Remix → child Version → Direct Parent / Root lineage → fresh Shared Data scope | **TBD at Sprint creation** | Candidate mapping: 5 existing + BL-P1-046 |
| Product Hardening + Phase 1 Close | Required recovery / correction / accessibility / performance / evidence hardening | **TBD at Sprint creation** | Candidate mapping: 12 existing queued items |

These stage names are stable planning labels. They are **not** aliases for any pre-existing `SP-P1-NNN`.

## Retired Legacy Provisional Grouping

The pre-PFR roadmap previously grouped future work under provisional labels `SP-P1-003` through `SP-P1-008` (Compiler/Runtime core, shell, recovery, share, remix, correction, etc.).

PFR-2026 explicitly retired that sequence.

Rules:

1. Those legacy provisional labels do not reserve future numeric Sprint IDs.
2. Their old backlog grouping must not be auto-activated or treated as the Product-First execution order.
3. Remaining backlog items stay canonical in `delivery/backlog/QUEUE.json` until a later Human-approved planning step selects them into a real Sprint.
4. If a future Sprint happens to receive a numerically identical ID because it is the next canonical number, its scope must come from the new Human-approved Sprint manifest/tasks — never from this retired grouping.
5. No historical Build Spec or actual Sprint artifact is renamed by this cleanup.

## Build Spec Naming Rule

Roadmaps must never write statements such as “the future Product Proof baseline is `BS-P1-005`”.

Instead:

~~~text
next Human-approved Product Proof Build Spec
→ ID assigned only when Freeze candidate is created
→ choose the next unique canonical BS-P1-NNN after the latest existing baseline
~~~

As of this normalization, `BS-P1-005` through `BS-P1-018` already exist as historical blocker/remediation rebaselines and retain those meanings permanently.

## Current Detailed Planning Boundary

`SP-P1-001` is CLOSED.

`SP-P1-002` is CLOSED. All nine Tasks are CLOSED and all six selected Backlog items are DONE. No detailed Sprint is currently active; the repository remains HOLD until a separate Human-approved planning / Build Freeze / Sprint activation flow.

All Product Proof stages after SP-P1-002 remain planning-only.

PFR-03 / PFR-04 candidate work is now complete:

- F19 is converged to Phase 1 `shared.ranking.v1` only.
- S03 / S04 / S05 F19 textual delta review PASS; no High-fi reopen.
- PFR-05 has a reviewable **BS-P1-019 candidate**, but it is not yet a locked baseline.
- Candidate backlog projection preserves the 32 existing QUEUED items and proposes only BL-P1-044..046 for new F19 Acceptance.

Before implementation they still require:

1. Human Build Freeze approval for the PFR-05 candidate.
2. Creation/locking of the approved replacement Build Spec while execution remains disabled.
3. Detailed Playable App Sprint planning with the next canonical Sprint ID.
4. Human Sprint/Task activation.
5. Separate Cursor execution approval.

No roadmap text alone authorizes Cursor implementation.


## PFR-05 Freeze Result — Canonical Planning Truth

Human-approved Freeze result:

- active replacement baseline: `BS-P1-019`;
- scope-clean Design source: `e7c83ac198b63a0273f30aeaf27a6dd65abadfee`;
- `BS-P1-018` is superseded;
- 11 historical DONE backlog items remain immutable;
- 32 existing QUEUED backlog items are preserved;
- F19 increment = `BL-P1-044`–`BL-P1-046`;
- remaining planned work = 35;
- no Sprint ID allocated;
- no Product code / Cursor authority; implementation remains disabled and Sprint HOLD.

Canonical candidate details:
- `delivery/audits/PFR-05-BS-P1-019-FREEZE-CANDIDATE.md`
- `delivery/audits/PFR-05-PROJECTION-CANDIDATE.json`
- `delivery/audits/PFR-05-BACKLOG-PROJECTION-CANDIDATE.json`
- `delivery/deltas/BD-019.json`


## PFR-05 Closure — 2026-10-06

Human approved Design PR #27 Product semantics and the BS-P1-019 Build Freeze candidate. BS-P1-019 is now the locked Phase 1 remaining baseline. PFR-05 is complete.

Next permitted activity is **Product Proof Stage A — Playable App detailed Sprint planning only**. No Sprint ID, activation, Task, or Cursor execution authority is created by this Freeze.


## PFR-06 Detailed Planning Candidate — Playable App

Human approved **starting detailed Sprint planning** on 2026-10-06. This does not create or activate a Sprint.

Planning candidate:

- Build Spec: `BS-P1-019`
- Sprint ID: **not allocated**
- selected backlog: 12 Playable App items
- mapped Acceptance/Test: 84 = F00 24 + F01 22 + F03 38
- task planning slots: A1–A6 (not canonical Task IDs)
- A1 Compiler and A2 Runtime Core may proceed in parallel after future activation
- A6 is the terminal real-browser Product proof: natural-language request → generated/validated Blueprint → F03 READY/render → real local interaction
- implementation remains disabled / Sprint HOLD

Planning audit: **PASS CANDIDATE**.

Pre-activation readiness still required before Sprint creation/activation:

1. explicit React / ReactDOM browser toolchain declaration and exact build/preview scripts;
2. real Product Playwright/webServer runner targeting the future `src/app/` surface rather than the SP2 test-only harness.

Canonical candidate artifacts:

- `delivery/audits/PFR-06-PLAYABLE-APP-SPRINT-PLANNING-CANDIDATE.json`
- `delivery/audits/PFR-06-PLAYABLE-APP-SPRINT-PLANNING-CANDIDATE.md`

**Next Human Gate:** approve the Stage A detailed plan and authorize a governance-only pre-activation React/browser toolchain readiness change. No Sprint creation, Task activation, or Cursor Product authority is implied.


## PFR-06 Sprint Creation — SP-P1-003

Human pre-authorization received on 2026-10-06 for governance through the pre-Cursor boundary.

BCE-3 creation state:

- `SP-P1-003` allocated as the next canonical Sprint ID.
- Sprint status = `PLANNED`.
- Build Spec = `BS-P1-019`.
- 12 Stage A backlog items move `QUEUED → READY`.
- planning slots A1–A6 become canonical `T001–T006`.
- `CURRENT-SPRINT` remains HOLD with active Sprint/Task null.
- `implementation_enabled=false`.

This is Sprint creation only. Activation is a separate BCE transition.
