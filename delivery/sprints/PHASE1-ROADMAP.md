# Phase 1 Sprint Roadmap — BS-P1-003

> Status: PROVISIONAL ROADMAP
> Authority: derived from current locked `BS-P1-003` + `delivery/backlog/QUEUE.json`
> Planning rule: future Sprints are coarse only. Only the next Sprint is decomposed into executable Tasks. Findings / Evidence from each completed Sprint may re-plan later Sprints without changing Product Truth.

## Planning Principles

- Dependency-first: no Sprint depends on a later Sprint.
- Product truth remains the current locked Build Spec (`BS-P1-003`); Roadmap does not add requirements.
- HUMAN owns Sprint Activation.
- ChatGPT is the sole Planning Agent.
- Cursor consumes only Human-activated Tasks.
- Later Sprint groupings are provisional until their detailed planning turn.

## Roadmap

| Sprint | Goal | Backlog Items | AC |
|---|---|---|---:|
| SP-P1-001 | Platform foundations: trusted capability registry, canonical Blueprint identity, anonymous identity and evidence intake foundation | BL-P1-001, BL-P1-002, BL-P1-004, BL-P1-031, BL-P1-032 | 38 |
| SP-P1-002 | Validation + intent foundation and evidence client reliability | BL-P1-003, BL-P1-005, BL-P1-006, BL-P1-007, BL-P1-008, BL-P1-033 | 35 |
| SP-P1-003 | Compiler + Runtime core semantics | BL-P1-009, BL-P1-010, BL-P1-012, BL-P1-013, BL-P1-015 | 34 |
| SP-P1-004 | Runtime hardening + Create shell foundation | BL-P1-011, BL-P1-014, BL-P1-016, BL-P1-017, BL-P1-020 | 37 |
| SP-P1-005 | App surface + Recovery core | BL-P1-018, BL-P1-019, BL-P1-022, BL-P1-035, BL-P1-036, BL-P1-038 | 41 |
| SP-P1-006 | Accessibility + Share/Restore + recovery evidence | BL-P1-021, BL-P1-023, BL-P1-024, BL-P1-026, BL-P1-037 | 36 |
| SP-P1-007 | Refine / Remix end-to-end flow | BL-P1-027, BL-P1-025, BL-P1-028, BL-P1-029, BL-P1-030 | 27 |
| SP-P1-008 | Result Correction + final cross-function outcome evidence | BL-P1-039, BL-P1-040, BL-P1-041, BL-P1-042, BL-P1-043, BL-P1-034 | 40 |

Total: **43 Backlog Items / 288 ACTIVE Acceptance**.

## Dependency Check

- 43 / 43 Backlog Items assigned exactly once.
- No duplicate assignment.
- No missing Backlog Item.
- No dependency points from an earlier Sprint to a later Sprint.
- Dependency order inside a Sprint is resolved during that Sprint's detailed Task Planning.

## Current Detailed Planning Boundary

`SP-P1-001` is fully detailed and CLOSED; all seven Tasks are CLOSED and its five selected Backlog items are DONE.
`SP-P1-002` completed detailed planning and Human Activation on 2026-10-01: six Backlog items / 35 Acceptance are bound to T001–T009; Sprint is **ACTIVE**, T001 is the sole active Task, and the first Cursor implementation command remains blocked until POI-003 dead patch disposition is confirmed.
`SP-P1-003` onward remain provisional and must not be treated as activated execution scope.
