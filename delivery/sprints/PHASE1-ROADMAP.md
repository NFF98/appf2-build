# Phase 1 Delivery Roadmap — Product-First Alignment

> Status: CURRENT PLANNING ROADMAP / FUTURE STAGES PROVISIONAL  
> Current locked Build Spec: `BS-P1-012`  
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
| `SP-P1-002` | Validation + intent foundation + evidence reliability | **OPEN / HOLD between Tasks** — T001–T003 CLOSED; T004–T009 PLANNED |

Current canonical execution boundary:

- Canonical control state is read from `build-spec/CURRENT.json` + `delivery/CURRENT-SPRINT.json`.
- `BS-P1-012 = LOCKED`.
- `implementation_enabled = false`.
- `delivery/CURRENT-SPRINT.json = HOLD`.
- T003 is CLOSED.
- T004 is the next Task for Activation Review; **T004 is not activated by this roadmap**.
- POI-005 records non-blocking future production HTTP / Runtime / Postgres fresh-admission wiring and must not be silently absorbed into T004.

## Product-First Future Stage Sequence

The Human-approved Product-First order is:

~~~text
SP-P1-002 foundation completion
→ Product Proof Stage A — Playable App
→ Product Proof Stage B — Share + Shared Ranking
→ Product Proof Stage C — Remix + Lineage
→ Product Hardening + Phase 1 Close
~~~

| Planning stage | Human outcome | Sprint ID | Backlog allocation |
|---|---|---|---|
| Product Proof Stage A — Playable App | Intent → generated App → render → play | **TBD at Sprint creation** | Re-plan from remaining canonical backlog after PFR-03/PFR-04 + Product Proof Build Freeze |
| Product Proof Stage B — Share + Shared Ranking | Share → recipient use → bounded asynchronous Shared Ranking | **TBD at Sprint creation** | TBD during detailed planning |
| Product Proof Stage C — Remix + Lineage | Remix → child Version → Direct Parent / Root lineage → fresh Shared Data scope | **TBD at Sprint creation** | TBD during detailed planning |
| Product Hardening + Phase 1 Close | Required recovery / correction / accessibility / performance / evidence hardening | **TBD at Sprint creation** | Evidence-driven |

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

As of this normalization, `BS-P1-005` through `BS-P1-012` already exist as historical blocker/remediation rebaselines and retain those meanings permanently.

## Current Detailed Planning Boundary

`SP-P1-001` is CLOSED.

`SP-P1-002` remains the only current detailed Sprint. T001–T003 are CLOSED; T004–T009 remain PLANNED. The repository is HOLD until a separate Human-approved T004 activation transition.

All Product Proof stages after SP-P1-002 remain planning-only. Before implementation they require, as applicable:

1. PFR-03 F19 Shared App Data detailed-design closure.
2. PFR-04 S03/S04/S05 UI/UX Delta Review.
3. Human-approved Product Proof Build Freeze using a newly allocated Build Spec ID.
4. Detailed Sprint planning with a newly allocated Sprint ID.
5. Human Sprint/Task activation.

No roadmap text alone authorizes Cursor implementation.
