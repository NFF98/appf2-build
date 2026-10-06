# SP-P1-003 / BD-021 — BF-050 Freeze Candidate Provenance Audit

## Verdict

PASS — scope-clean derived Design source is suitable for replacement Build Spec projection.

## Human authority

Human 2026-10-06: 批准繼續補 DO_NOT_PERSIST contract，再 rebaseline / rebind；停在 Cursor execution 前。

## Provenance

- Design remediation PR: NFF98/appf2-design #30
- merged upstream Working commit: `af3fc11f7326e58955c17b850cb4427a4f27ddd1`
- scope-clean base: `d8a9af891dbd61f3f830bd63ae5e21b6bb525603`
- scope-clean derived freeze source: `7a1189f65268a82bb03b27f378fcaf59c41e4220`
- delta: `BD-021`
- finding: `BF-050`
- replacement baseline: `BS-P1-021`

## Scope verification

The derived source is exactly 3 files ahead of the base and contains only:

1. `working/detailed-design/functions/BF-050-DNP-NOTE.md`
2. `working/detailed-design/functions/BF-050-DNP-IDEMPOTENCY.md`
3. `working/detailed-design/functions/BF-050-DNP-ACCEPTANCE.md`

No unrelated Design truth is included.

## Contract closure

The bounded addenda lock:

- value-free durable `EphemeralInputRequirement` markers while DO_NOT_PERSIST values remain request-scoped;
- `POST /api/v1/intents/{intent_id}/compile` request-scoped `ephemeral_inputs[{id,value}]` binding and type validation before COMPOSING/ModelGateway;
- explicit missing/invalid recovery using bounded F01-ERR-001 details;
- idempotency digest inclusion without raw value persistence;
- same-body retry/takeover re-provision semantics and new-key behavior for intentional value changes;
- durable SUCCEEDED / FAILED_TERMINAL replay without rerunning Prompt B;
- strengthened existing T001 AC/Test obligations without adding a new Product feature or Acceptance ID.

FAILED_TERMINAL replay fidelity remains a separate implementation remediation in T001 and is not hidden inside this Design delta.

No Cursor execution is authorized by this audit.

## Provenance correction

The freeze source is intentionally derived directly from the locked BS-P1-020 source commit so BS-P1-021 is byte-lineage-equivalent to BS-P1-020 plus only the three BF-050 addenda. The merged Design PR remains the upstream Human-approved Working source.
