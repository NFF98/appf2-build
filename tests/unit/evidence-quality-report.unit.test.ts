import { describe, expect, test } from "vitest";

import {
  createBrowserEvidenceBatchTransport,
  isServerAcknowledged,
  serializeEvidenceBatch
} from "../../src/platform/evidence/evidence-batch-transport.js";
import {
  admitEvidenceEvent,
  requestBoundedBatches,
  type QueuedEvidenceRecord
} from "../../src/platform/evidence/evidence-client-queue.js";
import {
  EvidenceQualityReportLedger,
  parseEvidenceQualityReport,
  qualityReportRequestBytes
} from "../../src/platform/evidence/evidence-quality-report.js";
import { EVIDENCE_LIMITS } from "../../src/platform/evidence/evidence-validator.js";
import { batchRejectionBody, canonicalBatchSuccessBody } from "./evidence-collector-test-support.js";
import { largestValidEvent } from "./evidence-queue-test-support.js";

const REPORT = {
  report_id: "923e4567-e89b-42d3-a456-426614174000",
  local_queue_drop_count: 3,
  offline_expired_event_count: 0
};
const BATCH_ID = "a23e4567-e89b-42d3-a456-426614174000";

function uuidSequence(): () => string {
  let index = 0;
  return () => {
    index += 1;
    return `b23e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`;
  };
}

function queued(index: number): QueuedEvidenceRecord {
  const admitted = admitEvidenceEvent(largestValidEvent(index));
  if (admitted === null) {
    throw new Error("fixture must be admissible");
  }
  return {
    eventId: admitted.event.event_id,
    enqueuedAt: 0,
    collectionClass: admitted.collectionClass,
    bytes: admitted.bytes,
    event: admitted.event,
    serialized: admitted.serialized
  };
}

describe("F07 quality_report", () => {
  test("parses only the exact bounded, non-identifying canonical shape", () => {
    expect(parseEvidenceQualityReport(REPORT)).toEqual(REPORT);
    expect(Object.isFrozen(parseEvidenceQualityReport(REPORT))).toBe(true);
    expect(parseEvidenceQualityReport({ ...REPORT, local_queue_drop_count: 0, offline_expired_event_count: 7 }))
      .toEqual({ ...REPORT, local_queue_drop_count: 0, offline_expired_event_count: 7 });

    for (const invalid of [
      null,
      [],
      "report",
      { ...REPORT, local_queue_drop_count: 0 },
      { ...REPORT, local_queue_drop_count: -1 },
      { ...REPORT, local_queue_drop_count: 1.5 },
      { ...REPORT, local_queue_drop_count: "3" },
      { ...REPORT, local_queue_drop_count: Number.MAX_SAFE_INTEGER + 1 },
      { ...REPORT, report_id: "not-a-uuid" },
      { ...REPORT, session_id: "623e4567-e89b-42d3-a456-426614174000" },
      { report_id: REPORT.report_id, local_queue_drop_count: 3 }
    ]) {
      expect(parseEvidenceQualityReport(invalid)).toBeNull();
    }
  });

  test("the ledger seals one report, resends it unchanged and starts a new delta after settle", () => {
    const ledger = new EvidenceQualityReportLedger(uuidSequence());
    expect(ledger.hasPending()).toBe(false);
    expect(ledger.current()).toBeNull();

    ledger.observeQueueDrop({ code: "F07-ERR-011", collection_class: "PRODUCT_SAMPLE" });
    ledger.observeQueueDrop({ code: "F07-ERR-012", collection_class: "CORE_OUTCOME" });
    ledger.observeQueueDrop({ code: "F07-ERR-012", collection_class: "RELIABILITY" });
    expect(ledger.hasPending()).toBe(true);
    const sealed = ledger.current();
    expect(sealed).toEqual({
      report_id: "b23e4567-e89b-42d3-a456-000000000001",
      local_queue_drop_count: 1,
      offline_expired_event_count: 2
    });

    ledger.observeQueueDrop({ code: "F07-ERR-011", collection_class: "PRODUCT_SAMPLE" });
    expect(ledger.current()).toBe(sealed);
    ledger.settle({ ...REPORT });
    expect(ledger.current()).toBe(sealed);

    if (sealed === null) {
      throw new Error("sealed report expected");
    }
    ledger.settle(sealed);
    expect(ledger.current()).toEqual({
      report_id: "b23e4567-e89b-42d3-a456-000000000002",
      local_queue_drop_count: 1,
      offline_expired_event_count: 0
    });
  });

  test("request bounding reserves exactly the bytes the quality_report adds", () => {
    const withReport = serializeEvidenceBatch({ batch_id: BATCH_ID, events: [], quality_report: REPORT });
    const withoutReport = serializeEvidenceBatch({ batch_id: BATCH_ID, events: [] });
    const bytes = (text: string) => new TextEncoder().encode(text).byteLength;
    expect(qualityReportRequestBytes(REPORT)).toBe(bytes(withReport) - bytes(withoutReport));

    const records = Array.from({ length: EVIDENCE_LIMITS.batchEvents }, (_, index) => queued(index));
    const [first] = requestBoundedBatches(records, qualityReportRequestBytes(REPORT));
    const body = serializeEvidenceBatch({
      batch_id: BATCH_ID,
      events: (first ?? []).map(record => record.event),
      quality_report: REPORT
    });
    expect(bytes(body)).toBeLessThanOrEqual(EVIDENCE_LIMITS.requestBytes);
  });

  test("only a canonical HTTP 2xx response acknowledges a quality_report", async () => {
    const respond = (response: Response) => createBrowserEvidenceBatchTransport(async () => response)
      .send({ batch_id: BATCH_ID, events: [], quality_report: REPORT });

    const success = await respond(new Response(JSON.stringify(canonicalBatchSuccessBody()), { status: 200 }));
    const retryableEvent = await respond(new Response(
      JSON.stringify(batchRejectionBody("00000000-0000-4000-8000-000000000001", "F07-ERR-010")),
      { status: 200 }
    ));
    const unavailable = await respond(new Response("{}", { status: 503 }));
    const malformed = await respond(new Response("{}", { status: 200 }));

    expect(success).toEqual({ ok: true });
    expect(retryableEvent).toEqual({ ok: false, retryable: true, acknowledged: true });
    expect([success, retryableEvent, unavailable, malformed].map(isServerAcknowledged)).toEqual([true, true, false, false]);
  });
});
