import type { EvidenceEventInput } from "./evidence-types.js";

export const EVIDENCE_EVENTS_BATCH_PATH = "/api/v1/events/batch";

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

export function isRetryableHttpStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function canonicalRejections(body: unknown): readonly unknown[] | null {
  if (!isRecord(body) || !isRecord(body.data) || !Array.isArray(body.data.rejections)) {
    return null;
  }
  return body.data.rejections;
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
          body: JSON.stringify({
            batch_id: payload.batch_id,
            events: payload.events
          })
        });
        return await outcomeFromResponse(response);
      } catch {
        return { ok: false, retryable: true };
      }
    }
  };
}
