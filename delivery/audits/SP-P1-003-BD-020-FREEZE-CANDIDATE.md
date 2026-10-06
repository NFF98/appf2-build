# SP-P1-003 — BF-049 / BD-020 / BS-P1-020 Freeze Candidate Audit

> Date: 2026-10-06 (Japan time)
> Status: FREEZE_CANDIDATE / HOLD
> Current locked baseline: BS-P1-019
> Proposed replacement: BS-P1-020
> Source finding: BF-049
> Source independent audit: Issue #245 comment 6013292757

## 1. Human authority

Human approved continuing the BF-049 BCE chain through:
Finding/HOLD → bounded Design contract closure → replacement Build Spec → T001 rebind,
with a hard stop before any fresh Cursor execution.

This audit does **not** authorize Product implementation, T002, Evidence normalization, Task closure, or Cursor execution.

## 2. Independent blocker basis

Cursor RESULT comment 6012821241 correctly stopped before code write under BS-P1-019.

Independent BCE audit comment 6013292757 confirmed that T001 could not be implemented without inventing contract semantics in six bounded areas:

1. CapabilityRequirement deterministic derivation.
2. Exact durable ResolvedIntent projection/provenance.
3. F02 rejection → F01 feedback classification, including the F02-ERR-012 recovery contradiction.
4. Compile failure / retry lifecycle transitions.
5. Retryable mutation idempotency / interrupted IN_PROGRESS semantics.
6. Trusted anonymous identity binding and non-disclosing mismatch behavior.

## 3. Human-approved Working remediation

appf2-design PR #29, **BF-049 T001 compiler contract closure**, merged canonical as:

`c970bd29c192a77a836721a8ebe2d49189e370d9`

The merged Working remediation changes exactly these contract surfaces:

- working/common-core/API-CONVENTIONS.md
- working/detailed-design/data-model/DATA-MODEL-DETAILED.md
- working/detailed-design/functions/F01-INTENT-COMPILATION.md
- working/detailed-design/functions/F02-BLUEPRINT-VALIDATION.md
- working/detailed-design/functions/F07-ANONYMOUS-IDENTITY-EVIDENCE.md
- working/detailed-design/functions/F12-HUMANIZED-RECOVERY.md
- working/detailed-design/registries/acceptance-test-registry.json
- working/detailed-design/registries/recovery-registry.json

Independent Design BCE audit found no remaining blocking contradiction in the six BF-049 surfaces.

## 4. Locked remediation decisions

The replacement Build Spec must contain all of the following:

### 4.1 CapabilityRequirement derivation

- Prompt A may emit bounded semantic CapabilityHintV1 only.
- CapabilityHintV1 cannot carry final Capability IDs / versions.
- appf2-owned CapabilityRequirementExtractor deterministically derives canonical requirements.
- requirement_id is deterministic from the canonical requirement tuple.
- no third LLM operation and no capability-name inference.

### 4.2 ResolvedIntent projection

- exact durable entry shapes are locked for inputs, semantic items, accepted assumptions, unresolved cosmetic items and provenance.
- confirmed structured truth is projected deterministically.
- DO_NOT_PERSIST remains request-scoped only and may flow only through EphemeralResolvedContext.
- durable ResolvedIntent must never recover/request-synthesize expired DO_NOT_PERSIST values.

### 4.3 F02 → F01 rejection authority

- F01-RQ-008A is the authoritative per-F02-error classification.
- F02 Retry metadata does not grant F01 automatic recompose authority.
- F02-ERR-012 PERMISSION_NOT_ALLOWED is SECURITY_TERMINAL / NO_RETRY.
- the prior Recovery Registry contradiction is removed.
- validation-driven recompose budget is one total recompose per logical compile operation.

### 4.4 Compile retry lifecycle

- intent_record.lifecycle_status remains the durable lifecycle owner.
- eligible COMPOSITION_FAILED / VALIDATION_REJECTED retry transitions go directly to COMPOSING after idempotency attempt acquisition.
- retry must not fabricate an intermediate READY state.
- INCOMPATIBLE / security / resource terminal states require explicit new User change/recovery.

### 4.5 Mutation idempotency

Canonical states:
`IN_PROGRESS / FAILED_RETRYABLE / SUCCEEDED / FAILED_TERMINAL`.

- retry/takeover uses atomic CAS and increments attempt_no.
- IN_PROGRESS is protected by a route-budget lease.
- expired lease permits exactly one takeover winner.
- stale/late attempts cannot overwrite a newer attempt.
- retryable transient failure becomes FAILED_RETRYABLE, never permanent IN_PROGRESS or fake FAILED_TERMINAL.
- durable result_ref is reused; POST /intents retry reuses the same intent_id.
- replay rebuilds from canonical durable truth rather than a second raw response truth.

### 4.6 Anonymous continuity binding

- POST /intents may receive anonymous_id in its body.
- answers/compile receive request_anonymous_id from server-owned trusted request context, not from arbitrary request body fields.
- intent lookup/mutation is scoped by intent_id + request_anonymous_id equality.
- not-found and identity mismatch are deliberately indistinguishable 404 / F01-ERR-015.
- this is continuity/idempotency isolation only; anonymous_id is still not authentication, ownership proof, or sensitive-action authorization.

## 5. Same-class cross-contract closure

The remediation also aligns:
- F07 anonymous continuity semantics;
- F12 not-found/security recovery;
- Recovery Registry F02-ERR-012;
- Acceptance Registry existing T001 proof semantics.

Registry versions after remediation:
- Acceptance Registry: 2.5.0
- Recovery Registry: 1.3.0

No new Acceptance ID is introduced by BF-049; existing T001 Acceptance semantics are clarified and therefore require T001 rebind to the replacement baseline.

## 6. Scope-clean freeze source

To exclude Design navigation/history drift, the proposed freeze source is derived from the exact BS-P1-019 source:

- base: `e7c83ac198b63a0273f30aeaf27a6dd65abadfee`
- scope-clean derived source: `d8a9af891dbd61f3f830bd63ae5e21b6bb525603`

Git compare proves exactly **8 changed paths**, matching Design PR #29's contract surfaces and nothing else.

The older branch `freeze-source/bf-049-bs-p1-020` is explicitly rejected as incomplete; only `freeze-source/bf-049-bs-p1-020-v2` / `d8a9af89...` is eligible.

## 7. Replacement Build Spec rule

BS-P1-020 must:

- supersede BS-P1-019;
- project from `d8a9af891dbd61f3f830bd63ae5e21b6bb525603`;
- carry approved deltas BD-003..BD-020;
- differ from BS-P1-019 only in the 8 projected contract outputs above, plus projection-map.json and manifest.json;
- preserve every other baseline artifact byte-for-byte;
- remain immutable and LOCKED after Freeze.

The Freeze PR itself must NOT:
- enable implementation;
- activate Sprint/Task;
- resolve BF-049;
- start Cursor.

## 8. Rebind consequence after Freeze

After BS-P1-020 is separately frozen and validated:

- SP-P1-003 unfinished work must rebind to BS-P1-020.
- T001 must rebind to BS-P1-020 and may return from BLOCKED to IN_PROGRESS only in the separately auditable Human-approved pre-Cursor rebind/activation transition.
- T002-T006 remain non-active.
- BF-049 may resolve only when the replacement baseline exists and the governed rebind/activation transition is valid.
- BD-020 may advance to IMPLEMENTING at that transition.
- a fresh Cursor EXECUTE command remains a separate Human gate and is explicitly outside this BCE chain.

## 9. Candidate conclusion

**PASS — ready for immutable BS-P1-020 Build Freeze.**

No Product implementation is authorized by this audit.

## 10. Frozen candidate materialization

The immutable BS-P1-020 candidate is now materialized with:

- baseline_id: `BS-P1-020`
- source_working_commit: `d8a9af891dbd61f3f830bd63ae5e21b6bb525603`
- supersedes: `BS-P1-019`
- approved deltas: `BD-003..BD-020`
- acceptance_count: `307`
- manifest content_sha256: `e179e8286a134f38ab0dd86c529dabce63205f9c8ba309eae8a6e868b87a067e`
- projection-map sha256: `831b19dee9e01f9043d8cd087bf5376d05dcbeb75a03433ce68cfdeacc8e1156`

Byte-preservation construction reuses every unchanged BS-P1-019 Git blob exactly. Only the 8 BF-049 projected outputs plus projection-map/manifest receive new blobs.

Freeze does not resolve BF-049 and does not activate execution.
