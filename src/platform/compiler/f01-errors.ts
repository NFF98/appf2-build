import { IntentContractError } from "../intent/intent-contract.js";
import type { JsonRecord } from "../intent/json-value.js";

export type F01ErrorCode =
  | "F01-ERR-001"
  | "F01-ERR-002"
  | "F01-ERR-003"
  | "F01-ERR-004"
  | "F01-ERR-005"
  | "F01-ERR-006"
  | "F01-ERR-007"
  | "F01-ERR-008"
  | "F01-ERR-009"
  | "F01-ERR-010"
  | "F01-ERR-011"
  | "F01-ERR-012"
  | "F01-ERR-013"
  | "F01-ERR-014"
  | "F01-ERR-015";

export type SharedApiErrorCode =
  | "API-IDEMPOTENCY-IN-PROGRESS"
  | "API-IDEMPOTENCY-CONFLICT"
  | "API-REQUEST-TOO-LARGE"
  | "API-UNSUPPORTED-MEDIA-TYPE";

export type IntentApiErrorCode = F01ErrorCode | SharedApiErrorCode;

type ErrorSpec = { readonly status: number; readonly message_key: string; readonly retryable: boolean };

/** F01 §24 HTTP mapping + F01 §28 retry column + F12 recovery-registry message keys. */
export const INTENT_API_ERRORS: Readonly<Record<IntentApiErrorCode, ErrorSpec>> = Object.freeze({
  "F01-ERR-001": { status: 400, message_key: "recovery.f01.invalid_request", retryable: false },
  "F01-ERR-002": { status: 502, message_key: "recovery.f01.intent_analysis_schema_invalid", retryable: true },
  "F01-ERR-003": { status: 400, message_key: "recovery.f01.clarification_answer_invalid", retryable: false },
  "F01-ERR-004": { status: 409, message_key: "recovery.f01.intent_version_conflict", retryable: true },
  "F01-ERR-005": { status: 429, message_key: "recovery.f01.model_provider_rate_limited", retryable: true },
  "F01-ERR-006": { status: 502, message_key: "recovery.f01.model_provider_unavailable", retryable: true },
  "F01-ERR-007": { status: 502, message_key: "recovery.f01.model_output_invalid", retryable: true },
  "F01-ERR-008": { status: 422, message_key: "recovery.f01.capability_unsupported", retryable: false },
  "F01-ERR-009": { status: 504, message_key: "recovery.f01.operation_timeout", retryable: true },
  "F01-ERR-010": { status: 502, message_key: "recovery.f01.blueprint_composition_failed", retryable: true },
  "F01-ERR-011": { status: 422, message_key: "recovery.f01.validation_rejected", retryable: true },
  "F01-ERR-012": { status: 422, message_key: "recovery.f01.security_terminal", retryable: false },
  "F01-ERR-013": { status: 409, message_key: "recovery.f01.idempotency_conflict", retryable: false },
  "F01-ERR-014": { status: 500, message_key: "recovery.f01.internal_invariant", retryable: false },
  "F01-ERR-015": { status: 404, message_key: "recovery.f01.intent_not_found", retryable: false },
  "API-IDEMPOTENCY-IN-PROGRESS": { status: 409, message_key: "api.idempotency.in_progress", retryable: true },
  "API-IDEMPOTENCY-CONFLICT": { status: 409, message_key: "api.idempotency.conflict", retryable: false },
  "API-REQUEST-TOO-LARGE": { status: 400, message_key: "api.request.too_large", retryable: false },
  "API-UNSUPPORTED-MEDIA-TYPE": { status: 400, message_key: "api.request.unsupported_media_type", retryable: false }
});

/** Bounded, non-secret error detail; never a stack, provider payload, SQL or raw User content. */
export type IntentApiErrorDetails = JsonRecord;

export type IntentApiFailure = {
  readonly code: IntentApiErrorCode;
  readonly http_status: number;
  readonly retryable: boolean;
  readonly retry_after_seconds: number | null;
  readonly details: IntentApiErrorDetails;
};

export type IntentApiErrorOptions = {
  readonly details?: IntentApiErrorDetails;
  readonly retryable?: boolean;
  readonly retryAfterSeconds?: number | null;
  /** Only for F01-ERR-001 used as "422 semantically not allowed" (F01 §24) instead of a malformed request. */
  readonly httpStatus?: 400 | 422;
};

/** Thrown inside the F01 service; the Edge maps it onto the stable error envelope. */
export class IntentApiError extends Error {
  public readonly failure: IntentApiFailure;

  public constructor(code: IntentApiErrorCode, options: IntentApiErrorOptions = {}) {
    super(code);
    this.name = "IntentApiError";
    this.failure = Object.freeze({
      code,
      http_status: code === "F01-ERR-001" && options.httpStatus !== undefined ? options.httpStatus : INTENT_API_ERRORS[code].status,
      retryable: options.retryable ?? INTENT_API_ERRORS[code].retryable,
      retry_after_seconds: options.retryAfterSeconds ?? null,
      details: Object.freeze({ ...(options.details ?? {}) })
    });
  }
}

const SAFE_VIOLATION_LIMIT = 8;

/** IntentContractError → API failure: only bounded JSON paths / reasons leave, never submitted values. */
export function failureFromIntentContract(error: IntentContractError): IntentApiFailure {
  const violations = error.violations.slice(0, SAFE_VIOLATION_LIMIT).map((violation) => ({ path: violation.path, reason: violation.reason }));
  const details: JsonRecord = error.code === "F01-ERR-014" ? {} : { violations };
  return new IntentApiError(error.code, { details }).failure;
}

export function toIntentApiFailure(error: unknown): IntentApiFailure | null {
  if (error instanceof IntentApiError) return error.failure;
  if (error instanceof IntentContractError) return failureFromIntentContract(error);
  return null;
}

export function isF01ErrorCode(code: IntentApiErrorCode): code is F01ErrorCode {
  return code.startsWith("F01-ERR-");
}

