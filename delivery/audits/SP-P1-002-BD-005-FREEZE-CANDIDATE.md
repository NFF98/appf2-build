# SP-P1-002 — BD-005 / BS-P1-005 Freeze Candidate Audit

> Date: 2026-10-02 (Japan time)
> Status: FREEZE_CANDIDATE / HOLD
> Current locked baseline: BS-P1-004
> Proposed replacement: BS-P1-005
> Source findings: BF-030, BF-031

## 1. Human decision

Human approved the BF-030 / BF-031 resolution direction on 2026-10-02 and instructed governance remediation before Cursor returns to T002.

This approval authorizes the F02/F04 remediation direction and preparation of the replacement Build Spec. It does **not** remove the separate Build Freeze / Sprint Activation gates.

## 2. Upstream Working truth

- appf2-design PR #8 merged the F02/F04 machine-contract remediation.
- Human-approved Working lineage commit: `42cd2c366049cab77697873fd7d9654bec2fdf5e`.
- Governance status normalization commit: `3633198a22a4393be0b803c313085faefa873dc8`.
- The normalized Working truth contains no new implementation code.

## 3. Scope-clean freeze source

To prevent unrelated Working/history changes from entering Build Spec:

- base = prior BS-P1-004 source `91894ae8bd6241bb5ee1897180db72e9e578d1bf`
- derived freeze source = `abd91f50fa520a4ecd047207da7e2a804762e415`
- compare result: exactly **2 changed paths**

~~~text
working/detailed-design/functions/F02-BLUEPRINT-VALIDATION.md
working/detailed-design/functions/F04-CAPABILITY-REGISTRY.md
~~~

Explicitly excluded:
- `archive/ProjectManagement/ASSISTANT-SHAME-LOG.md`
- unrelated Working files
- future Phase work
- any T002 implementation branch content

## 4. BF-030 remediation included

The proposed BS-P1-005 projection must contain:

- exact mutable-state executable shape for NUMBER / STRING / BOOLEAN / ENUM / LIST / RECORD
- reusable bounded TypeDescriptor semantics
- exact Value Source keys
- contextual typing for composite LITERAL values
- canonical input binding key `bind`
- F02 structural `children` / `repeat` as structural syntax, not magic bindings
- static type-check ownership references to F03 operator signatures and F04 generated validator truth

## 5. BF-031 remediation included

The proposed BS-P1-005 projection must contain:

- resolved props / capability-state / binding / action / event schemas for ENABLED core capabilities
- explicit binding expected types and allowed source kinds
- explicit composition.children / composition.repeat
- rejection of unresolved ref-only validator schemas
- exact Phase 1 core validator surface
- no `children` magic binding inference
- no `bindings.item_template` second repeat syntax
- no button `action_ref` shadow dispatch path

## 6. Projection rule

BS-P1-005 must supersede BS-P1-004 and reuse BS-P1-004 projection/output unchanged except:

~~~text
functions/F02-BLUEPRINT-VALIDATION.md
functions/F04-CAPABILITY-REGISTRY.md
projection-map.json
manifest.json
~~~

All other projected files must remain byte-identical to BS-P1-004.

Acceptance Registry remains byte-identical because BF-030/BF-031 clarify executable machine truth supporting existing F02 acceptance; they do not add/remove Acceptance IDs.

## 7. T002 rebind consequences

After Human-approved BS-P1-005 Build Freeze:

- T001 remains CLOSED and must not reopen.
- T002 remains the same logical Task but must rebind from BS-P1-004 to BS-P1-005.
- T002 allowed write paths must be reviewed because BF-031 requires implementation of the generated Capability validator contract under `src/platform/capabilities/` / `generated/capabilities/` before F02 can consume it.
- Existing T002 candidate `d8f1b17d...` is not discarded wholesale:
  - raw-byte digest, strict parser, graph algorithms, canonical hash/transaction work may be retained after re-review.
  - provisional state-schema, ValueSource and Registry inference code/tests must be re-derived from BS-P1-005.
- T003–T009 remain non-active.

## 8. Remaining gates before Cursor

1. Human approves **BS-P1-005 Build Freeze**.
2. Create immutable LOCKED BS-P1-005 from scope-clean source `abd91f50...`.
3. Direct baseline/projection/governance gates PASS.
4. Rebind Sprint 2 unfinished work to BS-P1-005.
5. Update T002 authorized scope for the generated validator-contract implementation required by BF-031.
6. Future-diff / change-scope / test-integrity dry-run PASS.
7. Human approves **SP-P1-002 / T002 Activation**.
8. Only then issue the revised Cursor T002 command.

## 9. Freeze candidate conclusion

**PASS — ready for Human Build Freeze decision.**

No implementation is authorized by this audit.
