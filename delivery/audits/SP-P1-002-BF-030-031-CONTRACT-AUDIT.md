# SP-P1-002 — BF-030 / BF-031 Comprehensive F02↔F04 Contract Audit

> Date: 2026-10-02  
> Build baseline under audit: BS-P1-004  
> T002 candidate reviewed: `d8f1b17d1d05e276e0ed9d007abb4153f3774fbf`  
> Status: BLOCKING — remediation proposal required before replacement Build Freeze.

## 1. Audit objective

This audit checks the whole class of executable-schema / Registry-validator ambiguity exposed by BF-030 and BF-031. The goal is not to preserve the T002 implementation. The goal is to ensure a future implementation can be derived from canonical Product truth without Cursor or ChatGPT inventing executable syntax.

## 2. Confirmed non-gaps

The following already have a canonical owner and must not be duplicated:

- F03 owns exact Phase 1 operator typed signatures (ADD/SUB/IF/LENGTH/etc.).
- F02 owns canonical JSON and content_hash semantics.
- BS-P1-004 owns pre-parse candidate_digest semantics.
- F04 already owns exact capability ID/version identity and generated-artifact single-source rule.
- F02 already owns graph reachability/cycle rules and state/rule/action ID grammar.

## 3. BF-030 — F02 executable machine-shape gaps

| Area | Current truth | Gap / conflict | Required remediation |
|---|---|---|---|
| Mutable STRING | “STRING has length bound” | no exact constraint shape; T002 candidate rejects all STRING constraints | freeze exact max-length machine shape |
| Mutable ENUM | “bounded allowed values” | no exact key/domain; T002 invented `constraints.allowed` and allowed heterogeneous primitives | freeze exact enum-domain machine shape |
| Mutable LIST | “item type + max length” | no exact nested item descriptor | freeze reusable bounded type descriptor |
| Mutable RECORD | “declared fields” | no exact field descriptor shape | freeze exact declared-field descriptor |
| LITERAL | example only shows scalar | unclear whether bounded LIST/RECORD literal values are legal; they are needed by capability props such as options/columns | define literal JSON domain and contextual type-check rule |
| Node binding example | F02 example uses `bindings.value` | F04 core semantic for input.number uses `bind` | align example + machine contract to one key |
| Structural children | F02 has `node.children` | F04 current source encodes `children` as a binding name | separate composition metadata from ValueSource bindings |
| Repeat | F02 has structural `node.repeat` | F04 content.list also names `items` / `item_template` bindings, creating two competing template models | make F02 structural repeat the sole repeat syntax; F04 only declares whether a capability permits it |
| Rule/derived typing | prose requires output type match | exact operator signatures already exist in F03 | F02 should reference F03 type inference; no second operator table |
| Action/Event typing | F02 requires typed args and EVENT payload | F04 current machine artifact has action/event names only | fixed under BF-031 |

## 4. BF-031 — F04 generated Validator contract gaps

| Area | Locked promise | Current implementation truth | Required remediation |
|---|---|---|---|
| props schema | generated validator contains executable props schema | only `{ref: capability://.../props}`; no resolved schema exists | canonical machine registry with resolved field schemas |
| state schema | executable capability-local state schema | ref only | resolved state schema |
| binding restrictions | typed binding restrictions | string names only | field type + allowed source kinds + writable-state rule |
| event schema | F03 says payload conforms to F04 event schema | event names only | per-event payload schema |
| action schema | F02 V08 requires typed args | action names only | per-action args schema |
| composition | Validator must know children/repeat support | T002 candidate infers support from magic binding names `children` / `items` | explicit `composition.children` / `composition.repeat` metadata |
| input.select | bounded options | bound type not machine-defined | freeze Phase 1 bound type/domain |
| capability ports | §9 promises state / port types | core definitions emit empty inputs/outputs | empty is legal only where capability truly has no ports; no fake placeholder refs |

## 5. Remediation direction

1. Add one canonical, machine-readable Phase 1 Capability Validator Contract in appf2-design Working.
2. The contract uses the same bounded type-descriptor vocabulary as F02 state/value typing.
3. Generated `validator-registry.ts` must contain the resolved validator contract; unresolved schema refs alone are not sufficient for ENABLED capabilities.
4. Structural composition is not a ValueSource binding:
   - `children` is F02 structural graph syntax.
   - `repeat` is F02 structural bounded-repeat syntax.
   - F04 declares whether each capability permits children/repeat.
5. Node `events` remains the sole event→Blueprint Action reference mechanism; Capability fields do not duplicate an `action_ref` execution path.
6. F03 remains the sole owner of operator runtime signatures.
7. No T002 implementation may resume until the replacement Build Spec contains these exact machine contracts.

## 6. Direct consequences for the rejected T002 candidate

The following parts of `d8f1b17d...` must be treated as provisional and re-derived after rebaseline:

- `state-schema.ts` type-specific constraint keys and allowed domains.
- `value-source.ts` LITERAL restrictions.
- `registry-contract.ts` composition inference from binding names.
- binding/reference checks that rely on string names without canonical type metadata.
- tests whose fixture shape embeds the provisional schema.

The raw-byte digest, strict duplicate-key parsing, canonical hash reuse, graph algorithms and transaction/immutability work are not invalidated by this audit, but they still require re-review against the replacement baseline.

## 7. Gate

BF-030 / BF-031 may not be marked RESOLVED until:

- Working remediation is Human-approved.
- replacement Build Spec is frozen from that Working truth.
- generated validator future-diff proves typed schemas are actually available to F02.
- T002 is rebound and activated under the replacement Build Spec.
- DB migration direct proof remains separately required before T002 implementation merge.
