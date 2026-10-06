import { isUuid } from "../platform/evidence/evidence-validator.js";
import { INTENT_API_ERRORS, IntentApiError, type IntentApiErrorCode, type IntentApiFailure } from "../platform/compiler/f01-errors.js";
import { isValidIdempotencyKey } from "../platform/compiler/idempotency.js";
import type { CreateIntentCommand, IntentServiceResult, ScopedIntentCommand } from "../platform/compiler/intent-service.js";

export const INTENTS_ROUTE = "/api/v1/intents";

/** Shared API §14 default JSON request body ceiling. */
export const INTENT_API_MAX_BODY_BYTES = 512 * 1024;

export interface IntentApiHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly headers: Readonly<Record<string, string | undefined>>;
  readonly body: string | Uint8Array;
  /** F01-API-ID-001 server-owned trusted request context; never read from a Client body field. */
  readonly trustedAnonymousId?: string | null;
}

export interface IntentApiHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface IntentApiService {
  createIntent(command: CreateIntentCommand): Promise<IntentServiceResult>;
  submitAnswers(command: ScopedIntentCommand): Promise<IntentServiceResult>;
  compileIntent(command: ScopedIntentCommand): Promise<IntentServiceResult>;
}

export interface IntentApiHandlerDependencies {
  readonly service: IntentApiService;
  readonly createRequestId: () => string;
}

type IntentRoute =
  | { readonly kind: "create" }
  | { readonly kind: "answers" | "compile"; readonly intentId: string };

const SCOPED_ROUTE = /^\/api\/v1\/intents\/([^/]+)\/(answers|compile)$/;

function matchRoute(method: string, path: string): IntentRoute | undefined {
  if (method.toUpperCase() !== "POST") return undefined;
  if (path === INTENTS_ROUTE) return { kind: "create" };
  const match = SCOPED_ROUTE.exec(path);
  if (match === null) return undefined;
  return { kind: match[2] === "answers" ? "answers" : "compile", intentId: safeDecode(match[1] ?? "") };
}

/** A malformed path segment is just an unknown intent (404 F01-ERR-015), never a thrown URIError. */
function safeDecode(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return "";
  }
}

function header(request: IntentApiHttpRequest, name: string): string | undefined {
  const lowered = name.toLowerCase();
  for (const [key, value] of Object.entries(request.headers)) {
    if (key.toLowerCase() === lowered) return value;
  }
  return undefined;
}

function errorResponse(requestId: string, failure: IntentApiFailure): IntentApiHttpResponse {
  return {
    status: failure.http_status,
    headers: {
      "X-Request-Id": requestId,
      ...(failure.retry_after_seconds === null ? {} : { "Retry-After": String(failure.retry_after_seconds) })
    },
    body: {
      request_id: requestId,
      error: {
        code: failure.code,
        message_key: INTENT_API_ERRORS[failure.code].message_key,
        retryable: failure.retryable,
        retry_after_seconds: failure.retry_after_seconds,
        details: failure.details
      }
    }
  };
}

const reject = (requestId: string, code: IntentApiErrorCode, reason?: string): IntentApiHttpResponse =>
  errorResponse(requestId, new IntentApiError(code, reason === undefined ? {} : { details: { violations: [{ path: "$", reason }] } }).failure);

function isJsonContentType(value: string | undefined): boolean {
  if (value === undefined) return false;
  const [mediaType] = value.split(";");
  return mediaType?.trim().toLowerCase() === "application/json";
}

function decodeJson(body: string | Uint8Array): { ok: true; value: unknown; bytes: number } | { ok: false; bytes: number } {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body).byteLength : body.byteLength;
  if (bytes > INTENT_API_MAX_BODY_BYTES) return { ok: false, bytes };
  try {
    const text = typeof body === "string" ? body : new TextDecoder("utf-8", { fatal: true }).decode(body);
    return { ok: true, value: JSON.parse(text) as unknown, bytes };
  } catch {
    return { ok: false, bytes };
  }
}

function dispatch(service: IntentApiService, route: IntentRoute, body: unknown, idempotencyKey: string, trustedAnonymousId: string | null): Promise<IntentServiceResult> {
  if (route.kind === "create") return service.createIntent({ body, idempotencyKey, trustedAnonymousId });
  const command: ScopedIntentCommand = { intentId: route.intentId, body, idempotencyKey, trustedAnonymousId };
  return route.kind === "answers" ? service.submitAnswers(command) : service.compileIntent(command);
}

/**
 * `/api/v1` F01 mutation boundary: Content-Type / 512 KB / UTF-8 JSON / Idempotency-Key transport checks, then
 * the F01 service. Every response carries X-Request-Id and either `{request_id, data}` or the stable error
 * envelope; non-F01 routes return `undefined` so other Edge handlers can claim them.
 */
export function createIntentApiHandler(
  dependencies: IntentApiHandlerDependencies
): (request: IntentApiHttpRequest) => Promise<IntentApiHttpResponse | undefined> {
  return async (request) => {
    const route = matchRoute(request.method, request.path);
    if (route === undefined) return undefined;
    const clientRequestId = header(request, "X-Request-Id");
    const requestId = clientRequestId !== undefined && isUuid(clientRequestId) ? clientRequestId : dependencies.createRequestId();
    if (!isJsonContentType(header(request, "Content-Type"))) return reject(requestId, "API-UNSUPPORTED-MEDIA-TYPE");
    const decoded = decodeJson(request.body);
    if (decoded.bytes > INTENT_API_MAX_BODY_BYTES) return reject(requestId, "API-REQUEST-TOO-LARGE");
    if (!decoded.ok) return reject(requestId, "F01-ERR-001", "INVALID_JSON");
    const idempotencyKey = header(request, "Idempotency-Key");
    if (!isValidIdempotencyKey(idempotencyKey)) return reject(requestId, "F01-ERR-001", "IDEMPOTENCY_KEY_REQUIRED");
    const result = await dispatch(dependencies.service, route, decoded.value, idempotencyKey, request.trustedAnonymousId ?? null);
    if (!result.ok) return errorResponse(requestId, result.failure);
    return { status: 200, headers: { "X-Request-Id": requestId }, body: { request_id: requestId, data: result.data } };
  };
}
