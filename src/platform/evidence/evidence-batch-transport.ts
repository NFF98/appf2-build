import type { EvidenceEventInput } from "./evidence-types.js";

export const EVIDENCE_EVENTS_BATCH_PATH = "/api/v1/events/batch";

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

function outcomeFromResponse(response: Response): EvidenceBatchTransportResult {
  if (response.ok) {
    return { ok: true };
  }
  return {
    ok: false,
    retryable: isRetryableHttpStatus(response.status)
  };
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
        return outcomeFromResponse(response);
      } catch {
        return { ok: false, retryable: true };
      }
    }
  };
}
