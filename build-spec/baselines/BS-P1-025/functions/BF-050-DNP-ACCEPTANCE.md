# BF-050 — F01 Existing Acceptance Binding

Status: NORMATIVE DESIGN ADDENDUM  
Delta: BD-021

BF-050 introduces no new Product feature and no new Acceptance ID. Existing T001 proof obligations are strengthened as follows:

- **F01-AC-007 / TEST-F01-007**: Prompt B cannot run before Clarification Gate pass or before required ephemeral input binding/type validation. DO_NOT_PERSIST actual values are absent from durable truth.
- **F01-AC-014 / TEST-F01-AC-014**: same-key retry/takeover with the same canonical ephemeral request remains one logical compile; ephemeral values are not durably copied.
- **F01-AC-016 / TEST-F01-API-003**: missing/invalid ephemeral input uses the stable F01-ERR-001 envelope with bounded non-value details.
- **F01-AC-020 / TEST-F01-AC-020**: retry after timeout re-submits request-scoped ephemeral input; server does not reconstruct it from durable truth.

Implementation must also prove that a capability/dependency reference to a valid DO_NOT_PERSIST semantic ID is preserved by the value-free marker and is not automatically converted into an analysis failure.

Non-scope remains unchanged: no F00 layout decision, no browser persistence rule expansion, no provider-specific behavior, no authentication change, and no T002 behavior.
