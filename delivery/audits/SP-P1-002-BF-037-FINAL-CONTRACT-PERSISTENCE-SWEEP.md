# SP-P1-002 / BF-037 — Final Contract & Persistence Sweep

## 結論

T002 candidate `286deb4680c95fb06f548eecd046c284b40bb0b3` **NOT MERGE READY**。本輪是 final same-class sweep，不只重述 Cursor 自報風險。

## Sweep scope

- F02 candidate JSON / canonical JSON / PostgreSQL jsonb persistence boundary
- F02/F03 repeat runtime identity and all runtime node references
- validation_run / blueprint_content durable mutability
- T002 shared-test maintenance authorization vs test-integrity harness
- candidate digest / staged compiler FK / content immutability adjacent checks

## Confirmed blockers

### C1 — Blueprint string domain is not total over PostgreSQL jsonb

F02 accepts syntactically valid JSON strings and standard JSON escaping, but does not reject escaped U+0000 or lone surrogate code units. DATA-MODEL fixes canonical_blueprint as PostgreSQL jsonb. Therefore a candidate can pass F02 semantics yet fail only when cast to jsonb.

Required closure: define one executable Blueprint string domain before admission. Recommended: Unicode scalar values only, valid surrogate pairs only, U+0000 forbidden; reject before PASSED.

### C2 — Repeat lacks canonical runtime node-instance identity

F02 repeat makes structural children multiplicative. F03 currently has only static node_id references:
- capability_state_by_node[node_id]
- event source_node_id
- timer/evidence/error node_id
- INVOKE_CAPABILITY.target_node_id

No canonical NodeInstanceKey exists, so repeated descendants cannot be distinguished.

Required closure: introduce runtime NodeInstanceKey = node_id + ordered ancestor repeat coordinates. Static Blueprint node_id remains definition identity. For Phase 1, keep INVOKE_CAPABILITY target singleton-only (no repeat ancestor) rather than invent cross-clone selection.

### P1 — validation_run persistence is not immutable

DATA-MODEL marks validation_run APPEND / finalize only; T002 scope says immutable validation_run / blueprint_content. Candidate migration protects blueprint_content immutable columns but has no validation_run UPDATE/DELETE protection.

Required closure: terminal validation_run insert-only; DB UPDATE/DELETE reject.

### G1 — test-integrity authorization is evaluated at wrong granularity

T002 is authorized to rebind TEST-F04-AC-006 in capability-registry.contract.test.ts. The actual diff changes that test only. Current harness sees the file changed, enumerates every Test ID in the BASE version, and falsely reports untouched AC-001/002/003/007.

Required closure: compare executable test declarations per Test ID; do not broaden to a whole-file waiver.

## Same-class items checked and not reopened

- candidate_digest exact pre-parse bytes: sufficiently frozen / implemented
- staged nullable compiler_run_id without premature FK: sufficiently frozen / implemented
- blueprint_content immutable body with trust_status mutable: sufficiently frozen / implemented
- content-addressed reuse / hash body equality: no new contract gap found
- no second runtime node-selector field besides INVOKE_CAPABILITY.target_node_id found in T002 action schema

## Required remediation proof

1. jsonb string boundary tests: U+0000 reject; lone surrogate reject; valid surrogate pair persists.
2. repeat identity tests: repeated descendants receive distinct NodeInstanceKey; capability state/event identity cannot collide.
3. INVOKE_CAPABILITY repeated target rejects in Phase 1.
4. validation_run UPDATE and DELETE fail at DB boundary.
5. test-integrity fixture proves one authorized Test ID may change in a shared file while untouched neighboring Test IDs remain protected.
6. required T002 commands + CI-mode gate all PASS before merge.

