# BS-P1-004 / SP-P1-002 Human Activation

Program = PFR-2026
Date = 2026-10-01
Decision = HUMAN APPROVED
Decision Ref = HUMAN-ACTIVATION-BS-P1-004-SP-P1-002-T001-20261001
Activated At = 2026-10-01T12:18:15Z

## Authority

- Build Freeze: BS-P1-004 LOCKED
- Freeze source: 91894ae8bd6241bb5ee1897180db72e9e578d1bf
- Rebind + Activation Review: PASS, appf2-build@bc874a8bb5e400f49f12d844bf756cacc0c0e700
- BF-024 / BF-025: RESOLVED
- BF-023: OPEN implementation bug, assigned to T001

## Atomic Control Transition

- append build-spec/activations/BS-P1-004.json
- CURRENT.active_baseline: BS-P1-003 → BS-P1-004
- implementation_enabled: false → true
- global backlog: 38 unfinished items rebound to BS-P1-004
- 5 DONE histories preserved on original baseline provenance
- BL-P1-032 stays DONE/BS-P1-003/SP-P1-001 with explicit BS-P1-004 revalidation of F07-AC-008 under SP-P1-002/T001
- SP-P1-002: BLOCKED → ACTIVE, Build Spec → BS-P1-004
- T001: BLOCKED → IN_PROGRESS and sole active Task
- T002 / T006 / T008: old contract-blocked state → PLANNED
- all other SP2 Tasks remain PLANNED
- T001 adds F07-AC-008 / TEST-F07-008, BF-023 UUID-v4 correction, and Evidence Registry v3 obligations
- T002 / T006 / T008 carry Human-approved A0 remediation obligations
- CURRENT-SPRINT = SP-P1-002 / BS-P1-004 / T001 ACTIVE

## Scope Boundary

This activation is governance/control-state only.

No Product implementation is included.
No dependency PR is approved or merged by this activation.
No SP-P1-003+ work is activated.
Cursor may execute only the active T001 scope after this Activation PR is merged and all required gates pass.

## Gate

Status = PENDING PR VALIDATION
