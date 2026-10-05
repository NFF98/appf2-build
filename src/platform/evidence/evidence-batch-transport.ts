import type { EvidenceEventInput } from "./evidence-types.js";

export const EVIDENCE_EVENTS_BATCH_PATH = "/api/v1/events/batch";

// The Fetch Standard caps the bodies of all in-flight keepalive requests of a document, which
// sendBeacon shares, at 64 KiB; the user agent refuses anything beyond it outright.
export const EVIDENCE_BEACON_BUDGET_BYTES = 64 * 1024;

export const RETRYABLE_INGESTION_REJECTION_CODES = Object.freeze([
  "F07-ERR-008",
  "F07-ERR-009",
  "F07-ERR-010"
]);

export interface EvidenceBatchPayload {
  readonly batch_id: string;
  readonly events: readonly EvidenceEventInput[];
}

export type EvidenceBatchTransportResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly retryable: boolean };

export interface EvidenceBatchTransport {
  send(payload: EvidenceBatchPayload): Promise<EvidenceBatchTransportResult>;
}

export interface EvidenceBeaconTransport {
  dispatch(payload: EvidenceBatchPayload): boolean;
}

export type EvidenceBeaconNavigator = Partial<Pick<Navigator, "sendBeacon">>;

export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

export function serializeEvidenceBatch(payload: EvidenceBatchPayload): string {
  return JSON.stringify({
    batch_id: payload.batch_id,
    events: payload.events
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function canonicalRejections(body: unknown): readonly unknown[] | null {
  if (!isRecord(body) || typeof body.request_id !== "string" || !isRecord(body.data)) {
    return null;
  }
  const data = body.data;
  if (
    !isNonNegativeInteger(data.accepted) ||
    !isNonNegativeInteger(data.duplicates) ||
    !isNonNegativeInteger(data.rejected) ||
    !Array.isArray(data.rejections) ||
    !Array.isArray(data.diagnostics)
  ) {
    return null;
  }
  return data.rejections;
}

function hasRetryableIngestionRejection(rejections: readonly unknown[]): boolean {
  return rejections.some(rejection =>
    isRecord(rejection) &&
    typeof rejection.code === "string" &&
    (RETRYABLE_INGESTION_REJECTION_CODES as readonly string[]).includes(rejection.code)
  );
}

function outcomeFromSuccessBody(body: unknown): EvidenceBatchTransportResult {
  const rejections = canonicalRejections(body);
  if (rejections === null) {
    return { ok: false, retryable: true };
  }
  if (hasRetryableIngestionRejection(rejections)) {
    return { ok: false, retryable: true };
  }
  return { ok: true };
}

async function outcomeFromResponse(response: Response): Promise<EvidenceBatchTransportResult> {
  if (!response.ok) {
    return {
      ok: false,
      retryable: isRetryableHttpStatus(response.status)
    };
  }
  try {
    return outcomeFromSuccessBody(await response.json());
  } catch {
    return { ok: false, retryable: true };
  }
}

export function createBrowserEvidenceBatchTransport(
  fetchImpl: typeof fetch = globalThis.fetch
): EvidenceBatchTransport {
  return {
    async send(payload) {
      try {
        const response = await fetchImpl(EVIDENCE_EVENTS_BATCH_PATH, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: serializeEvidenceBatch(payload)
        });
        return await outcomeFromResponse(response);
      } catch {
        return { ok: false, retryable: true };
      }
    }
  };
}

// sendBeacon only reports whether the user agent accepted the request for delivery; it is the
// single page-unload handoff signal and never yields a server response.
export function createBrowserEvidenceBeaconTransport(
  navigatorImpl: EvidenceBeaconNavigator | undefined = globalThis.navigator
): EvidenceBeaconTransport {
  return {
    dispatch(payload) {
      if (typeof navigatorImpl?.sendBeacon !== "function") {
        return false;
      }
      try {
        const body = new Blob([serializeEvidenceBatch(payload)], { type: "application/json" });
        return body.size <= EVIDENCE_BEACON_BUDGET_BYTES &&
          navigatorImpl.sendBeacon(EVIDENCE_EVENTS_BATCH_PATH, body);
      } catch {
        return false;
      }
    }
  };
}
