import { describe, expect, test } from "vitest";

import { createEventsBatchHandler } from "../../src/edge/events-batch.js";
import { EvidenceIngestionService } from "../../src/platform/evidence/evidence-ingestion-service.js";
import type {
  AnonymousIdentityRepository,
  EvidenceIngestionDiagnostics,
  EvidenceRepository
} from "../../src/platform/evidence/evidence-repository.js";
import type {
  EvidenceEventInput,
  EvidenceWriteResult
} from "../../src/platform/evidence/evidence-types.js";
import { EVIDENCE_LIMITS } from "../../src/platform/evidence/evidence-validator.js";

const BATCH_ID = "323e4567-e89b-42d3-a456-426614174000";
const ANONYMOUS_ID = "423e4567-e89b-42d3-a456-426614174000";
const REQUEST_ID = "523e4567-e89b-42d3-a456-426614174000";

class RecordingIdentities implements AnonymousIdentityRepository {
  public readonly ensured: string[] = [];
  public readonly refreshed: string[] = [];

  public async ensure(anonymousId: string): Promise<"ACTIVE"> {
    this.ensured.push(anonymousId);
    return "ACTIVE";
  }

  public async refreshLastSeen(anonymousId: string): Promise<void> {
    this.refreshed.push(anonymousId);
  }
}

class RecordingEvidence implements EvidenceRepository {
  public readonly events = new Map<string, EvidenceEventInput>();

  public async insert(event: EvidenceEventInput): Promise<EvidenceWriteResult> {
    if (this.events.has(event.event_id)) {
      return "DUPLICATE";
    }
    this.events.set(event.event_id, event);
    return "INSERTED";
  }
}

class RecordingDiagnostics implements EvidenceIngestionDiagnostics {
  public readonly failures: unknown[] = [];

  public reportNonBlockingFailure(error: unknown): void {
    this.failures.push(error);
  }
}

function event(index: number, anonymousId: string | null = ANONYMOUS_ID) {
  return {
    event_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    event_type: "F05-EVT-007",
    schema_version: "1.0.0",
    occurred_at: "2026-09-27T01:23:45.000Z",
    anonymous_id: anonymousId,
    session_id: "623e4567-e89b-42d3-a456-426614174000",
    function_id: "F05",
    share_id: "723e4567-e89b-42d3-a456-426614174000",
    properties: { share_mode: "DURABLE_REFERENCE" }
  };
}

function createHarness() {
  const identities = new RecordingIdentities();
  const evidence = new RecordingEvidence();
  const diagnostics = new RecordingDiagnostics();
  const ingestion = new EvidenceIngestionService({
    anonymousIdentities: identities,
    evidence,
    diagnostics,
    now: () => new Date("2026-09-27T02:00:00.000Z")
  });
  const handler = createEventsBatchHandler({
    ingestion,
    createRequestId: () => REQUEST_ID
  });
  return { diagnostics, evidence, handler, identities };
}

async function post(
  handler: ReturnType<typeof createEventsBatchHandler>,
  events: readonly unknown[]
) {
  return handler({ body: JSON.stringify({ batch_id: BATCH_ID, events }) });
}

describe("POST /api/v1/events/batch", () => {
  test("TEST-F07-011 partially accepts valid events without rolling them back", async () => {
    const harness = createHarness();
    const invalid = { ...event(2), event_type: "F05-EVT-999" };

    const response = await post(harness.handler, [event(1), invalid, event(3)]);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      request_id: REQUEST_ID,
      data: {
        accepted: 2,
        duplicates: 0,
        rejected: 1,
        rejections: [{ event_id: invalid.event_id, code: "F07-ERR-004" }]
      }
    });
    expect([...harness.evidence.events.keys()]).toEqual([
      event(1).event_id,
      event(3).event_id
    ]);
  });

  test("ensures anonymous identity but accepts infrastructure evidence without it", async () => {
    const harness = createHarness();

    const response = await post(harness.handler, [
      event(1),
      event(2),
      event(3, null)
    ]);

    expect(response.body).toMatchObject({
      data: { accepted: 3, duplicates: 0, rejected: 0 }
    });
    expect(harness.identities.ensured).toEqual([ANONYMOUS_ID]);
    expect(harness.identities.refreshed).toEqual([ANONYMOUS_ID]);
    expect(harness.evidence.events.get(event(3).event_id)?.anonymous_id).toBeNull();
  });

  test("enforces request and batch bounds before event ingestion", async () => {
    const harness = createHarness();
    const tooManyEvents = Array.from(
      { length: EVIDENCE_LIMITS.batchEvents + 1 },
      (_, index) => event(index + 1)
    );

    const batchResponse = await post(harness.handler, tooManyEvents);
    const requestResponse = await harness.handler({
      body: new Uint8Array(EVIDENCE_LIMITS.requestBytes + 1)
    });

    expect(batchResponse).toMatchObject({
      status: 400,
      body: { error: { code: "F07-ERR-007" } }
    });
    expect(requestResponse).toMatchObject({
      status: 400,
      body: { error: { code: "API-REQUEST-TOO-LARGE" } }
    });
    expect(harness.evidence.events.size).toBe(0);
  });

  test("acknowledges a repeated event_id without a second repository row", async () => {
    const harness = createHarness();

    const first = await post(harness.handler, [event(1)]);
    const retry = await post(harness.handler, [event(1)]);

    expect(first.body).toMatchObject({ data: { accepted: 1, duplicates: 0 } });
    expect(retry.body).toMatchObject({ data: { accepted: 0, duplicates: 1 } });
    expect(harness.evidence.events.size).toBe(1);
  });
});
