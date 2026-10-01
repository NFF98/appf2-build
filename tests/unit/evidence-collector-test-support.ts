import type { EvidenceEventInput } from "../../src/platform/evidence/evidence-types.js";
import {
  createBrowserEvidenceCollector,
  type EvidenceCollector,
  type EvidenceCollectorScheduler
} from "../../src/platform/evidence/evidence-collector.js";

export const ANONYMOUS_ID = "423e4567-e89b-42d3-a456-426614174000";
export const SESSION_ID = "623e4567-e89b-42d3-a456-426614174000";
export const SHARE_ID = "723e4567-e89b-42d3-a456-426614174000";

export type ScriptedFetchResult =
  | number
  | "network"
  | {
      readonly status: number;
      readonly body: unknown;
    };

export function canonicalBatchSuccessBody() {
  return {
    request_id: "523e4567-e89b-42d3-a456-426614174000",
    data: {
      accepted: 1,
      duplicates: 0,
      rejected: 0,
      rejections: [],
      diagnostics: []
    }
  };
}

export function batchRejectionBody(eventId: string, code: string) {
  return {
    request_id: "523e4567-e89b-42d3-a456-426614174000",
    data: {
      accepted: 0,
      duplicates: 0,
      rejected: 1,
      rejections: [
        {
          event_id: eventId,
          code,
          field: null
        }
      ],
      diagnostics: []
    }
  };
}

export interface RecordedBatchRequest {
  readonly url: string;
  readonly method: string;
  readonly headerNames: readonly string[];
  readonly batch_id: string;
  readonly events: readonly EvidenceEventInput[];
}

export class ManualScheduler implements EvidenceCollectorScheduler {
  public pending: { readonly delayMs: number; readonly callback: () => void } | null = null;

  public schedule(delayMs: number, callback: () => void): unknown {
    this.pending = { delayMs, callback };
    return this.pending;
  }

  public cancel(handle: unknown): void {
    if (this.pending === handle) {
      this.pending = null;
    }
  }

  public fire(): void {
    const pending = this.pending;
    this.pending = null;
    pending?.callback();
  }
}

export function shareOpenEvent(index: number): EvidenceEventInput {
  return {
    event_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    event_type: "F05-EVT-007",
    schema_version: "2.0.0",
    occurred_at: "2026-09-27T01:23:45.000Z",
    anonymous_id: ANONYMOUS_ID,
    session_id: SESSION_ID,
    function_id: "F05",
    share_id: SHARE_ID,
    properties: { share_mode: "DURABLE_REFERENCE" }
  };
}

export function batchId(index: number): string {
  return `aaaaaaaa-bbbb-4ccc-8ddd-${String(index).padStart(12, "0")}`;
}

export function createScriptedFetch(script: readonly ScriptedFetchResult[] = []) {
  const remaining: ScriptedFetchResult[] = [...script];
  const requests: RecordedBatchRequest[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as {
      batch_id: string;
      events: EvidenceEventInput[];
    };
    requests.push({
      url: String(input),
      method: String(init?.method ?? ""),
      headerNames: headerNames(init?.headers),
      batch_id: body.batch_id,
      events: body.events
    });
    const next = remaining.shift() ?? 200;
    if (next === "network") {
      throw new TypeError("Failed to fetch");
    }
    return scriptedResponse(next);
  };
  return { fetchImpl, requests, remaining };
}

export function createTestCollector(input: {
  readonly fetch: typeof fetch;
  readonly batchIds?: readonly string[];
  readonly sleepLog?: number[];
  readonly scheduler?: ManualScheduler;
}): EvidenceCollector {
  let batchIndex = 0;
  const sleepLog = input.sleepLog ?? [];
  return createBrowserEvidenceCollector({
    fetch: input.fetch,
    scheduler: input.scheduler ?? new ManualScheduler(),
    jitter: () => 0.5,
    sleep: async ms => {
      sleepLog.push(ms);
    },
    randomUUID: () => {
      const ids = input.batchIds ?? [batchId(1), batchId(2), batchId(3), batchId(4)];
      const id = ids[batchIndex];
      batchIndex += 1;
      if (id === undefined) {
        throw new Error("Test batch UUID source exhausted.");
      }
      return id;
    }
  });
}

function headerNames(headers: HeadersInit | undefined): string[] {
  if (headers === undefined) {
    return [];
  }
  return [...new Headers(headers).keys()];
}

function scriptedResponse(next: Exclude<ScriptedFetchResult, "network">): Response {
  if (typeof next === "number") {
    const body = next >= 200 && next < 300
      ? JSON.stringify(canonicalBatchSuccessBody())
      : "{}";
    return new Response(body, { status: next });
  }
  return new Response(JSON.stringify(next.body), { status: next.status });
}
