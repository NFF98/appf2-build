# SP-P1-002 / BF-036 Freeze Candidate Audit

- Finding: BF-036
- Replacement Build Spec: BS-P1-008
- Supersedes: BS-P1-007
- Upstream Design Working merge: 9ec15b1ba53e59eadd39584197555fe76b97be5b
- Prior scope-clean freeze source: 75da33333d80ce362f8a10046c5462271e98fcec
- New scope-clean freeze source: 2ee3b32dafa49c1409f645f1aafd95ef024d2a0f
- Human authority: 2026-10-03 blanket approval to sweep same-class gaps and proceed through re-activation, stopping before Cursor restarts.

## Scope-clean provenance

PASS. Compare prior freeze source → new freeze source changes exactly:
1. working/detailed-design/functions/F01-INTENT-COMPILATION.md
2. working/detailed-design/functions/F02-BLUEPRINT-VALIDATION.md
3. working/detailed-design/functions/F03-RUNTIME-EXECUTION.md
4. working/detailed-design/functions/F04-CAPABILITY-REGISTRY.md

No unrelated Working drift is admitted.

## BF-036 completeness resolution

PASS.

- B1: F02 RECORD TypeDescriptor has one canonical optional_fields machine token. Phase 1 Blueprint app-state RECORD forbids it; F04 capability_state may use it. F03 owns ABSENT/init/patch semantics.
- B2: F02 defines lexical repeat SCOPE for node-local Value Sources and all-dispatch-site Action SCOPE typing. F03 event envelopes carry admitted lexical_scope_bindings.
- B3: F02 §4.1 closes exact required/optional key sets for Blueprint, Meta, Support/Degradation, StateEntry variants, Rule, CapabilityRef, Node, Repeat, Action/ActionStep, Result/ResultOutput. Empty executable containers are explicit, not inferred by omission.
- B4: kind=APP, repeat alias grammar/max_items, rooted Node tree, result/degradation identity and bounds, descriptor/composite nesting, and V01 exact 512 KiB intake ceiling are frozen.
- Same-class sweep additionally fixes degradation/ref uniqueness, Node multi-parent ambiguity, valid-unused declaration behavior, and current F01 registry-version example.
- Registry machine contract is MAJOR-bumped 3.0.0 → 4.0.0.
- Acceptance Registry is byte-identical to BS-P1-007; no Acceptance/Test ID remap is introduced.
- Existing TEST-F04-AC-006 baseline-maintenance boundary remains the only mapped test source edit authorization required; its direct rebind must become BS-P1-007 → BS-P1-008 at Activation.

## Precision checks

- F02 top-level executable example conforms to the newly frozen required Node/root schema.
- No replacement-string/prefix corruption remains in final Design diff; duplicate heading scan PASS.
- TypeDescriptor optional_fields does not create a second Runtime value type or allow optional Blueprint app state.
- SCOPE cannot be inferred from DOM/render state and cannot choose only one dispatch site.
- Scope-clean source contains exactly the four audited Working files above.

## Freeze decision

PASS — eligible for Human-preapproved Build Freeze as BS-P1-008. Product implementation remains HOLD until atomic Activation; fresh Cursor execution remains a separate final gate.
