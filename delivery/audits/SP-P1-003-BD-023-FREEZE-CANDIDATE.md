# SP-P1-003 / BD-023 — BF-052 Freeze Candidate Provenance Audit

## Verdict

PASS — scope-clean derived Design source is suitable for replacement Build Spec BS-P1-023 projection.

## Human authority

Human 2026-10-08: **批准 closure dynamic-repeat lifecycle semantic gap → 如有 contract 變更則 rebaseline → rebind T003 → 再跑一次 Planning**。

## Provenance

- Design remediation PR: NFF98/appf2-design #32
- merged upstream Working commit: `4889199dee040f43ae7961b0976f120598503337`
- scope-clean base: `3328bd2fe9d026995e4a81810ade2648b170ced2` (BS-P1-022 source)
- scope-clean derived freeze source: `05f261a8f83f447df60af7e4c581432fe825787d`
- delta: `BD-023`
- finding: `BF-052`
- replacement baseline: `BS-P1-023`

## Scope verification

The derived source is exactly 2 commits / 2 files ahead of the BS-P1-022 source and contains only:

1. `working/detailed-design/functions/F03-RUNTIME-EXECUTION.md`
2. `working/detailed-design/registries/acceptance-test-registry.json`

No unrelated Design truth is included.

## Contract closure

Dynamic repeat clone lifecycle is now locked:

- retained exact NodeInstanceKey keeps its lifecycle state;
- added key fresh-initializes before render/event intake;
- removed key is made inactive before cleanup/dispose;
- shrink → regrow of the same coordinate is a fresh incarnation;
- per-key monotonic lifecycle_generation rejects stale callbacks/events;
- index-based identity remains positional and does not infer item identity;
- initialize failure is node-isolated;
- dispose failure cannot resurrect a removed clone;
- inability to prove lifecycle/resource integrity fails closed with F03-ERR-018;
- all existing F02/F04/F03 resource ceilings remain authoritative.

No new Acceptance ID is required. Existing F03-AC-019 / TEST-F03-019 is the bounded proof surface.

No Product implementation, T004, or Cursor execution is authorized by this audit.
