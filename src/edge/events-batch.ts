import { EvidenceIngestionService } from "../platform/evidence/evidence-ingestion-service.js";
import { EVIDENCE_LIMITS, isUuid } from "../platform/evidence/evidence-validator.js";

export const EVENTS_BATCH_ROUTE = "/api/v1/events/batch";

export interface EventsBatchHttpRequest {
  readonly body: string | Uint8Array;
  readonly requestId?: string;
}

export interface EventsBatchHttpResponse {
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface EventsBatchHandlerDependencies {
  readonly ingestion: EvidenceIngestionService;
  readonly createRequestId: () => string;
}

function errorResponse(
  requestId: string,
  status: number,
  code: string,
  messageKey: string
): EventsBatchHttpResponse {
  return {
    status,
    headers: { "X-Request-Id": requestId },
    body: {
      request_id: requestId,
      error: {
        code,
        message_key: messageKey,
        retryable: false,
        retry_after_seconds: null,
        details: {}
      }
    }
  };
}

function decodeBody(body: string | Uint8Array): { text: string; bytes: number } {
  if (typeof body === "string") {
    const encoded = new TextEncoder().encode(body);
    return { text: body, bytes: encoded.byteLength };
  }
  return { text: new TextDecoder().decode(body), bytes: body.byteLength };
}

function parseRecord(text: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(text);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

export function createEventsBatchHandler(
  dependencies: EventsBatchHandlerDependencies
): (request: EventsBatchHttpRequest) => Promise<EventsBatchHttpResponse> {
  return async request => {
    const requestId = request.requestId !== undefined && isUuid(request.requestId)
      ? request.requestId
      : dependencies.createRequestId();
    const decoded = decodeBody(request.body);
    if (decoded.bytes > EVIDENCE_LIMITS.requestBytes) {
      return errorResponse(
        requestId,
        400,
        "API-REQUEST-TOO-LARGE",
        "api.request.too_large"
      );
    }

    const payload = parseRecord(decoded.text);
    if (
      payload === null ||
      !isUuid(payload.batch_id) ||
      !Array.isArray(payload.events) ||
      Object.keys(payload).some(key => key !== "batch_id" && key !== "events")
    ) {
      return errorResponse(
        requestId,
        400,
        "F07-ERR-003",
        "evidence.event_schema_invalid"
      );
    }
    if (payload.events.length > EVIDENCE_LIMITS.batchEvents) {
      return errorResponse(
        requestId,
        400,
        "F07-ERR-007",
        "evidence.event_batch_too_large"
      );
    }

    const result = await dependencies.ingestion.ingest(payload.events);
    return {
      status: 200,
      headers: { "X-Request-Id": requestId },
      body: { request_id: requestId, data: result }
    };
  };
}
