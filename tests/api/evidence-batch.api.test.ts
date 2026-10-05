import { describe, expect, test } from "vitest";

import { createEventsBatchHandler } from "../../src/edge/events-batch.js";
import { EvidenceIngestionService } from "../../src/platform/evidence/evidence-ingestion-service.js";
import {
  EvidenceQualityRecorder,
  type EvidenceClientQualityReportRow,
  type EvidenceIntakeObservationRow,
  type EvidenceQualityReportWriteResult,
  type EvidenceQualitySourceRepository
} from "../../src/platform/evidence/evidence-quality-recorder.js";
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
  public readonly receivedAtByEventId = new Map<string, string>();

  public async insert(
    event: EvidenceEventInput,
    receivedAt: string
  ): Promise<EvidenceWriteResult> {
    if (this.events.has(event.event_id)) {
      return "DUPLICATE";
    }
    this.events.set(event.event_id, event);
    this.receivedAtByEventId.set(event.event_id, receivedAt);
    return "INSERTED";
  }
}

class RecordingDiagnostics implements EvidenceIngestionDiagnostics {
  public readonly failures: unknown[] = [];

  public reportNonBlockingFailure(error: unknown): void {
    this.failures.push(error);
  }
}

class RecordingQualitySources implements EvidenceQualitySourceRepository {
  public readonly observations: EvidenceIntakeObservationRow[] = [];
  public readonly reports = new Map<string, EvidenceClientQualityReportRow>();
  public failReports = false;

  public async insertIntakeObservation(row: EvidenceIntakeObservationRow): Promise<void> {
    this.observations.push(row);
  }

  public async insertClientQualityReport(row: EvidenceClientQualityReportRow): Promise<EvidenceQualityReportWriteResult> {
    if (this.failReports) {
      throw new Error("quality report storage unavailable");
    }
    if (this.reports.has(row.report_id)) {
      return "DUPLICATE";
    }
    this.reports.set(row.report_id, row);
    return "INSERTED";
  }
}

function event(index: number, anonymousId: string | null = ANONYMOUS_ID) {
  return {
    event_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    event_type: "F05-EVT-007",
    schema_version: "2.0.0",
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
  const quality = new RecordingQualitySources();
  let observationIndex = 0;
  const handler = createEventsBatchHandler({
    ingestion,
    qualityRecorder: new EvidenceQualityRecorder({
      repository: quality,
      diagnostics,
      now: () => new Date("2026-09-27T02:00:00.000Z"),
      randomUUID: () => {
        observationIndex += 1;
        return `88888888-0000-4000-8000-${String(observationIndex).padStart(12, "0")}`;
      }
    }),
    createRequestId: () => REQUEST_ID
  });
  return { diagnostics, evidence, handler, identities, quality };
}

const QUALITY_REPORT = {
  report_id: "823e4567-e89b-42d3-a456-426614174000",
  local_queue_drop_count: 2,
  offline_expired_event_count: 1
};

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

  test("TEST-F07-030 accepts a clock-invalid event with F07-ERR-013 diagnostic", async () => {
    const harness = createHarness();
    const clockInvalid = {
      ...event(1),
      occurred_at: "2026-09-27T02:11:00.000Z"
    };

    const response = await post(harness.handler, [clockInvalid]);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      request_id: REQUEST_ID,
      data: {
        accepted: 1,
        duplicates: 0,
        rejected: 0,
        rejections: [],
        diagnostics: [
          {
            event_id: clockInvalid.event_id,
            code: "F07-ERR-013",
            field: "occurred_at",
            action: "USE_RECEIVED_AT"
          }
        ]
      }
    });
    expect(harness.evidence.events.get(clockInvalid.event_id)?.occurred_at).toBe(
      "2026-09-27T02:11:00.000Z"
    );
    expect(harness.evidence.receivedAtByEventId.get(clockInvalid.event_id)).toBe(
      "2026-09-27T02:00:00.000Z"
    );
  });
});

describe("POST /api/v1/events/batch quality_report", () => {
  test("accepts a quality-only batch and dedupes the quality_report by report_id", async () => {
    const harness = createHarness();
    const body = JSON.stringify({ batch_id: BATCH_ID, events: [], quality_report: QUALITY_REPORT });

    const first = await harness.handler({ body });
    const retry = await harness.handler({ body });

    for (const response of [first, retry]) {
      expect(response).toEqual({
        status: 200,
        headers: { "X-Request-Id": REQUEST_ID },
        body: {
          request_id: REQUEST_ID,
          data: { accepted: 0, duplicates: 0, rejected: 0, rejections: [], diagnostics: [] }
        }
      });
    }
    expect([...harness.quality.reports.values()]).toEqual([
      { ...QUALITY_REPORT, received_at: "2026-09-27T02:00:00.000Z" }
    ]);
    expect(harness.quality.observations.map(row => [row.batch_accepted, row.event_received_count])).toEqual([
      [true, 0],
      [true, 0]
    ]);
    expect(harness.evidence.events.size).toBe(0);
  });

  test("rejects an empty batch without a quality_report and any malformed quality_report as F07-ERR-003", async () => {
    const harness = createHarness();
    const malformedReports: readonly unknown[] = [
      null,
      { ...QUALITY_REPORT, local_queue_drop_count: 0, offline_expired_event_count: 0 },
      { ...QUALITY_REPORT, local_queue_drop_count: -1 },
      { ...QUALITY_REPORT, offline_expired_event_count: 1.5 },
      { ...QUALITY_REPORT, local_queue_drop_count: Number.MAX_SAFE_INTEGER + 1 },
      { ...QUALITY_REPORT, report_id: "not-a-uuid" },
      { ...QUALITY_REPORT, anonymous_id: ANONYMOUS_ID }
    ];

    const responses = [
      await harness.handler({ body: JSON.stringify({ batch_id: BATCH_ID, events: [] }) }),
      ...await Promise.all(malformedReports.map(report => harness.handler({
        body: JSON.stringify({ batch_id: BATCH_ID, events: [event(1)], quality_report: report })
      })))
    ];

    for (const response of responses) {
      expect(response).toMatchObject({ status: 400, body: { error: { code: "F07-ERR-003", retryable: false } } });
    }
    expect(harness.evidence.events.size).toBe(0);
    expect(harness.identities.ensured).toEqual([]);
    expect(harness.quality.reports.size).toBe(0);
    expect(harness.quality.observations.map(row => row.route_rejection_code))
      .toEqual(responses.map(() => "F07-ERR-003"));
  });

  test("counts quality_report bytes in the 256 KiB request bound", async () => {
    const harness = createHarness();
    const compact = JSON.stringify({ batch_id: BATCH_ID, events: [], quality_report: QUALITY_REPORT });
    const atBound = compact + " ".repeat(EVIDENCE_LIMITS.requestBytes - new TextEncoder().encode(compact).byteLength);

    expect((await harness.handler({ body: atBound })).status).toBe(200);
    expect(await harness.handler({ body: `${atBound} ` })).toMatchObject({
      status: 400,
      body: { error: { code: "API-REQUEST-TOO-LARGE" } }
    });
  });

  test("returns retryable 503 F07-ERR-010 when the quality_report cannot be made durable", async () => {
    const harness = createHarness();
    harness.quality.failReports = true;

    const response = await harness.handler({
      body: JSON.stringify({ batch_id: BATCH_ID, events: [event(1)], quality_report: QUALITY_REPORT })
    });

    expect(response).toMatchObject({
      status: 503,
      body: { error: { code: "F07-ERR-010", message_key: "recovery.f07.event_storage_failed", retryable: true } }
    });
    expect(harness.evidence.events.size).toBe(1);
    expect(harness.quality.observations).toMatchObject([{ batch_accepted: false, accepted_count: 1 }]);
    expect(harness.diagnostics.failures).toEqual([new Error("quality report storage unavailable")]);

    harness.quality.failReports = false;
    const retry = await harness.handler({
      body: JSON.stringify({ batch_id: BATCH_ID, events: [event(1)], quality_report: QUALITY_REPORT })
    });
    expect(retry.body).toMatchObject({ data: { accepted: 0, duplicates: 1 } });
    expect(harness.quality.reports.size).toBe(1);
  });
});
