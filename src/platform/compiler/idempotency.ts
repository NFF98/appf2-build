import { createHash } from "node:crypto";

import { canonicalJson, type JsonValue } from "../intent/json-value.js";
import type { AttemptGuard } from "./compiler-records.js";

export const INTENT_ROUTE_KEYS = Object.freeze({
  create: "POST /api/v1/intents",
  answers: "POST /api/v1/intents/{intent_id}/answers",
  compile: "POST /api/v1/intents/{intent_id}/compile"
} as const);
export type IntentRouteKey = (typeof INTENT_ROUTE_KEYS)[keyof typeof INTENT_ROUTE_KEYS];

/** Shared API rule 12: the lease is the host route's locked server budget (F01 §23), never a hidden timeout. */
export const ROUTE_LEASE_MS: Readonly<Record<IntentRouteKey, number>> = Object.freeze({
  [INTENT_ROUTE_KEYS.create]: 20_000,
  [INTENT_ROUTE_KEYS.answers]: 20_000,
  [INTENT_ROUTE_KEYS.compile]: 30_000
});
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const IDEMPOTENCY_KEY_PATTERN = /^[\x21-\x7e]{1,255}$/;

export function isValidIdempotencyKey(value: unknown): value is string {
  return typeof value === "string" && IDEMPOTENCY_KEY_PATTERN.test(value);
}

export type IdempotencyStatus = "IN_PROGRESS" | "FAILED_RETRYABLE" | "SUCCEEDED" | "FAILED_TERMINAL";
export type ResultRefType = "INTENT" | "VALIDATION_RUN";

export type IdempotencyOperationRow = {
  readonly idempotency_operation_id: string;
  readonly anonymous_id: string;
  readonly route_key: string;
  readonly idempotency_key: string;
  readonly request_digest: string;
  readonly status: IdempotencyStatus;
  readonly attempt_no: number;
  readonly lease_expires_at: string | null;
  readonly result_ref_type: ResultRefType | null;
  readonly result_ref_id: string | null;
  readonly http_status: number | null;
  readonly error_code: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly expires_at: string;
};

export type NewIdempotencyOperation = Pick<
  IdempotencyOperationRow,
  "idempotency_operation_id" | "anonymous_id" | "route_key" | "idempotency_key" | "request_digest" | "lease_expires_at" | "created_at" | "expires_at"
>;

export type AttemptAcquisition = {
  readonly idempotency_operation_id: string;
  readonly expected_status: IdempotencyStatus;
  readonly expected_attempt_no: number;
  readonly lease_expires_at: string;
  readonly now: string;
  /** Set only when re-opening a row whose 24h replay window has expired. */
  readonly reset: { readonly request_digest: string; readonly created_at: string; readonly expires_at: string } | null;
};

export type OperationCompletion = {
  readonly status: Exclude<IdempotencyStatus, "IN_PROGRESS">;
  readonly http_status: number;
  readonly error_code: string | null;
  readonly result_ref: { readonly type: ResultRefType; readonly id: string } | null;
};

export interface IdempotencyRepository {
  insertIfAbsent(operation: NewIdempotencyOperation): Promise<IdempotencyOperationRow | null>;
  read(anonymousId: string, routeKey: string, idempotencyKey: string): Promise<IdempotencyOperationRow | undefined>;
  /** Atomic CAS: only one caller can move a FAILED_RETRYABLE / lease-expired / TTL-expired row to a new attempt. */
  acquireAttempt(acquisition: AttemptAcquisition): Promise<IdempotencyOperationRow | null>;
  /** Commits only while `attempt_no` is current and the row is IN_PROGRESS; late attempts match zero rows. */
  complete(guard: AttemptGuard, completion: OperationCompletion): Promise<boolean>;
}

export type ClaimResult =
  | { readonly kind: "ACQUIRED"; readonly guard: AttemptGuard; readonly operation: IdempotencyOperationRow }
  | { readonly kind: "REPLAY_SUCCEEDED"; readonly operation: IdempotencyOperationRow }
  | { readonly kind: "REPLAY_TERMINAL"; readonly operation: IdempotencyOperationRow }
  | { readonly kind: "IN_PROGRESS" }
  | { readonly kind: "CONFLICT" };

export type ClaimRequest = {
  readonly anonymous_id: string;
  readonly route_key: IntentRouteKey;
  readonly idempotency_key: string;
  readonly request_digest: string;
  readonly now: Date;
  readonly newOperationId: () => string;
};

/** Canonical digest of the logical request: route + path identity + canonical JSON body (never stored raw). */
export function requestDigest(routeKey: IntentRouteKey, intentId: string | null, body: JsonValue): string {
  const canonical = canonicalJson({ route_key: routeKey, intent_id: intentId, body });
  return `sha256:${createHash("sha256").update(canonical, "utf8").digest("hex")}`;
}

const iso = (date: Date, offsetMs = 0): string => new Date(date.getTime() + offsetMs).toISOString();

function acquired(operation: IdempotencyOperationRow, now: string): ClaimResult {
  return { kind: "ACQUIRED", operation, guard: { idempotency_operation_id: operation.idempotency_operation_id, attempt_no: operation.attempt_no, now } };
}

async function acquire(repository: IdempotencyRepository, existing: IdempotencyOperationRow, request: ClaimRequest, reset: boolean): Promise<ClaimResult> {
  const now = iso(request.now);
  const next = await repository.acquireAttempt({
    idempotency_operation_id: existing.idempotency_operation_id,
    expected_status: existing.status,
    expected_attempt_no: existing.attempt_no,
    lease_expires_at: iso(request.now, ROUTE_LEASE_MS[request.route_key]),
    now,
    reset: reset ? { request_digest: request.request_digest, created_at: now, expires_at: iso(request.now, IDEMPOTENCY_TTL_MS) } : null
  });
  return next === null ? { kind: "IN_PROGRESS" } : acquired(next, now);
}

function evaluateExisting(existing: IdempotencyOperationRow, request: ClaimRequest): "RESET" | "CONFLICT" | "REPLAY_SUCCEEDED" | "REPLAY_TERMINAL" | "RETRY" | "IN_PROGRESS" {
  const nowMs = request.now.getTime();
  if (Date.parse(existing.expires_at) <= nowMs) return "RESET";
  if (existing.request_digest !== request.request_digest) return "CONFLICT";
  if (existing.status === "SUCCEEDED") return "REPLAY_SUCCEEDED";
  if (existing.status === "FAILED_TERMINAL") return "REPLAY_TERMINAL";
  if (existing.status === "FAILED_RETRYABLE") return "RETRY";
  const leaseExpired = existing.lease_expires_at === null || Date.parse(existing.lease_expires_at) <= nowMs;
  return leaseExpired ? "RETRY" : "IN_PROGRESS";
}

/**
 * Shared API §7 / DATA-MODEL §6.12 state machine over the canonical `idempotency_operation` row: first caller
 * inserts attempt 1; SUCCEEDED / FAILED_TERMINAL replay; FAILED_RETRYABLE and lease-expired IN_PROGRESS are
 * re-acquired by exactly one CAS winner (attempt_no + 1, result_ref kept); a live lease or a lost CAS is 409.
 */
export async function claimOperation(repository: IdempotencyRepository, request: ClaimRequest): Promise<ClaimResult> {
  const now = iso(request.now);
  const inserted = await repository.insertIfAbsent({
    idempotency_operation_id: request.newOperationId(),
    anonymous_id: request.anonymous_id,
    route_key: request.route_key,
    idempotency_key: request.idempotency_key,
    request_digest: request.request_digest,
    lease_expires_at: iso(request.now, ROUTE_LEASE_MS[request.route_key]),
    created_at: now,
    expires_at: iso(request.now, IDEMPOTENCY_TTL_MS)
  });
  if (inserted !== null) return acquired(inserted, now);
  const existing = await repository.read(request.anonymous_id, request.route_key, request.idempotency_key);
  if (existing === undefined) return { kind: "IN_PROGRESS" };
  const decision = evaluateExisting(existing, request);
  switch (decision) {
    case "RESET":
      return acquire(repository, existing, request, true);
    case "RETRY":
      return acquire(repository, existing, request, false);
    case "REPLAY_SUCCEEDED":
    case "REPLAY_TERMINAL":
      return { kind: decision, operation: existing };
    case "CONFLICT":
    case "IN_PROGRESS":
      return { kind: decision };
  }
}
