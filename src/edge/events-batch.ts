import { EvidenceIngestionService } from "../platform/evidence/evidence-ingestion-service.js";
import type {
  EvidenceQualityRecorder,
  EvidenceRouteRejectionCode
} from "../platform/evidence/evidence-quality-recorder.js";
import {
  parseEvidenceQualityReport,
  type EvidenceQualityReport
} from "../platform/evidence/evidence-quality-report.js";
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
  readonly qualityRecorder: EvidenceQualityRecorder;
  readonly createRequestId: () => string;
}

interface EventsBatchEnvelope {
  readonly events: readonly unknown[];
  readonly qualityReport: EvidenceQualityReport | null;
}

const ENVELOPE_KEYS: ReadonlySet<string> = new Set(["batch_id", "events", "quality_report"]);

const ROUTE_REJECTION_MESSAGE_KEYS: Readonly<Record<EvidenceRouteRejectionCode, string>> = {
  "API-REQUEST-TOO-LARGE": "api.request.too_large",
  "F07-ERR-003": "evidence.event_schema_invalid",
  "F07-ERR-007": "evidence.event_batch_too_large"
};

function errorResponse(
  requestId: string,
  status: number,
  code: string,
  messageKey: string,
  retryable = false
): EventsBatchHttpResponse {
  return {
    status,
    headers: { "X-Request-Id": requestId },
    body: {
      request_id: requestId,
      error: {
        code,
        message_key: messageKey,
        retryable,
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

// A present quality_report must be valid; events=[] is accepted only with a valid quality_report.
function parseEnvelope(text: string): EventsBatchEnvelope | null {
  const payload = parseRecord(text);
  if (
    payload === null ||
    !isUuid(payload.batch_id) ||
    !Array.isArray(payload.events) ||
    Object.keys(payload).some(key => !ENVELOPE_KEYS.has(key))
  ) {
    return null;
  }
  const qualityReport = payload.quality_report === undefined
    ? null
    : parseEvidenceQualityReport(payload.quality_report);
  if (payload.quality_report !== undefined && qualityReport === null) {
    return null;
  }
  if (payload.events.length === 0 && qualityReport === null) {
    return null;
  }
  return { events: payload.events, qualityReport };
}

export function createEventsBatchHandler(
  dependencies: EventsBatchHandlerDependencies
): (request: EventsBatchHttpRequest) => Promise<EventsBatchHttpResponse> {
  const { ingestion, qualityRecorder } = dependencies;

  // F07 §44: the request attempt is recorded before every pre-service return.
  const rejectRoute = async (requestId: string, code: EvidenceRouteRejectionCode) => {
    await qualityRecorder.recordRouteRejection(code);
    return errorResponse(requestId, 400, code, ROUTE_REJECTION_MESSAGE_KEYS[code]);
  };

  return async request => {
    const requestId = request.requestId !== undefined && isUuid(request.requestId)
      ? request.requestId
      : dependencies.createRequestId();
    const decoded = decodeBody(request.body);
    if (decoded.bytes > EVIDENCE_LIMITS.requestBytes) {
      return rejectRoute(requestId, "API-REQUEST-TOO-LARGE");
    }

    const envelope = parseEnvelope(decoded.text);
    if (envelope === null) {
      return rejectRoute(requestId, "F07-ERR-003");
    }
    if (envelope.events.length > EVIDENCE_LIMITS.batchEvents) {
      return rejectRoute(requestId, "F07-ERR-007");
    }

    const result = await ingestion.ingest(envelope.events);
    const observation = { eventReceivedCount: envelope.events.length, result };
    if (envelope.qualityReport !== null) {
      try {
        await qualityRecorder.recordClientQualityReport(envelope.qualityReport);
      } catch {
        // A 2xx confirms the report to the browser, so an undurable report must stay retryable.
        await qualityRecorder.recordIngestion({ ...observation, batchAccepted: false });
        return errorResponse(requestId, 503, "F07-ERR-010", "recovery.f07.event_storage_failed", true);
      }
    }
    await qualityRecorder.recordIngestion({ ...observation, batchAccepted: true });
    return {
      status: 200,
      headers: { "X-Request-Id": requestId },
      body: { request_id: requestId, data: result }
    };
  };
}
