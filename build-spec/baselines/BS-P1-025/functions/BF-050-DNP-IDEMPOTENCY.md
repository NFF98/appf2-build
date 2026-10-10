# BF-050 — F01 Ephemeral Input Idempotency

Status: NORMATIVE DESIGN ADDENDUM  
Delta: BD-021

This file completes the request lifecycle defined by `BF-050-DNP-NOTE.md`.

## Canonical digest

For `POST /api/v1/intents/{intent_id}/compile`, `ephemeral_inputs[]` is sorted by `id` and is part of the canonical logical request body before `request_digest` is calculated.

Rules:

1. Durable `idempotency_operation` stores only the digest; it does not store the submitted ephemeral values.
2. Network retry, FAILED_RETRYABLE retry, or expired-IN_PROGRESS takeover uses the same Idempotency-Key and re-submits the same logical body, including the same ephemeral inputs.
3. Same key with a changed ephemeral value is same-key/different-digest and follows canonical idempotency-conflict behavior.
4. Intentional change of an ephemeral value is a new compile logical mutation and uses a new Idempotency-Key.
5. If request-scoped context is gone, User re-provides the required input. Server never reconstructs it from durable truth.
6. SUCCEEDED / FAILED_TERMINAL replay still requires the same request digest and returns the durable logical outcome without re-running Prompt B.
7. No raw ephemeral value becomes an idempotency replay payload.

This addendum does not change the existing 24-hour idempotency window, lease/CAS rules, or attempt ownership semantics.
