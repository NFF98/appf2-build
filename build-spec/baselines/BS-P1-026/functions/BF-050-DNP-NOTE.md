# BF-050 — F01 DO_NOT_PERSIST Request Lifecycle

Status: NORMATIVE DESIGN ADDENDUM  
Delta: BD-021  
Applies to: F01-DATA-002, F01-DATA-005, F01-RQ-006, F01-API-003, F01-API-004, F01-RQ-010.

This addendum supersedes only the ambiguous DO_NOT_PERSIST request-lifecycle behavior. All other F01 semantics remain unchanged.

## Durable requirement marker

A `KnownInput` with `sensitivity=DO_NOT_PERSIST` keeps its actual value request-scoped only.

Before durable write, server code projects:

~~~text
EphemeralInputRequirement
- id
- key
- value_type
- source
- source_ref?
~~~

Canonical rules:

1. `id` is the original stable semantic ID.
2. The marker contains no actual input value and no reversible representation of it.
3. The value-bearing DO_NOT_PERSIST KnownInput is removed from durable `known_inputs[]`.
4. Server-owned durable StructuredIntent and ResolvedIntent may contain sorted `ephemeral_input_requirements[]`.
5. Existing dependency and capability-hint references may continue to reference the marker by the same stable `id`.
6. Prompt A and Client cannot directly assert or modify this server-owned marker.
7. The marker is metadata only; it is not a second semantic value truth.

## Compile request binding

`POST /api/v1/intents/{intent_id}/compile` accepts:

~~~text
ephemeral_inputs[]?
  - id
  - value
~~~

Rules:

1. `ephemeral_inputs[]` may be omitted only when the durable requirement list is empty.
2. Every required marker ID must be supplied exactly once.
3. Unknown or duplicate IDs are invalid.
4. Supplied value shape must match the marker's canonical `value_type`.
5. Client cannot override marker metadata.
6. Binding/type validation happens before COMPOSING and before any ModelGateway call.
7. After validation, server joins marker metadata with the submitted value into request-scoped `EphemeralResolvedContext` for the current Prompt B call only.
8. Submitted values do not update `intent_record` and do not increment `intent_version`.

Missing required input returns HTTP 400 / F01-ERR-001 with `details.reason=EPHEMERAL_INPUT_REQUIRED`. Invalid binding/type returns HTTP 400 / F01-ERR-001 with `details.reason=EPHEMERAL_INPUT_INVALID`. `details.input_ids[]` may contain sorted marker IDs only; response details never echo submitted values.

A referenced DO_NOT_PERSIST semantic ID is therefore not by itself an analysis failure.
