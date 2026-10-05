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
  qualityOnlyRequestBytes,
  qualityReportRequestBytes
} from "../../src/platform/evidence/evidence-quality-report.js";
import {
  createIndexedDbEvidenceQualityReportStore,
  EVIDENCE_QUALITY_REPORT_DATABASE,
  EVIDENCE_QUALITY_REPORT_STORE_LIMIT
} from "../../src/platform/evidence/evidence-quality-report-store.js";
import { EVIDENCE_LIMITS } from "../../src/platform/evidence/evidence-validator.js";
import { batchRejectionBody, canonicalBatchSuccessBody } from "./evidence-collector-test-support.js";
import { FakeIndexedDbFactory } from "./evidence-fake-indexeddb.js";
import { largestValidEvent, ManualClock, QUEUE_T0 } from "./evidence-queue-test-support.js";

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

function storedReports(factory: FakeIndexedDbFactory): Map<string, unknown> {
  return factory.database(EVIDENCE_QUALITY_REPORT_DATABASE.name).records(EVIDENCE_QUALITY_REPORT_DATABASE.reportStore);
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

  test("the ledger seals one report, resends it unchanged and starts a new delta after acknowledge", () => {
    const ledger = new EvidenceQualityReportLedger(uuidSequence());
    expect(ledger.current()).toBeNull();

    ledger.observeQueueDrop({ code: "F07-ERR-011", collection_class: "PRODUCT_SAMPLE" });
    ledger.observeQueueDrop({ code: "F07-ERR-012", collection_class: "CORE_OUTCOME" });
    ledger.observeQueueDrop({ code: "F07-ERR-012", collection_class: "RELIABILITY" });
    const sealed = ledger.current();
    expect(sealed).toEqual({
      report_id: "b23e4567-e89b-42d3-a456-000000000001",
      local_queue_drop_count: 1,
      offline_expired_event_count: 2
    });

    ledger.observeQueueDrop({ code: "F07-ERR-011", collection_class: "PRODUCT_SAMPLE" });
    expect(ledger.current()).toBe(sealed);
    ledger.acknowledge({ ...REPORT });
    expect(ledger.current()).toBe(sealed);

    if (sealed === null) {
      throw new Error("sealed report expected");
    }
    ledger.acknowledge(sealed);
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
    expect(qualityOnlyRequestBytes(REPORT)).toBe(bytes(withReport));

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

describe("F07 quality_report durable pending reports", () => {
  test("a sealed report survives its page in durable storage and a later page resends it before newer deltas", async () => {
    const factory = new FakeIndexedDbFactory();
    const clock = new ManualClock(QUEUE_T0);
    const firstPage = new EvidenceQualityReportLedger(
      uuidSequence(),
      createIndexedDbEvidenceQualityReportStore(factory),
      clock.now
    );
    firstPage.observeQueueDrop({ code: "F07-ERR-011", collection_class: "PRODUCT_SAMPLE" });
    firstPage.observeQueueDrop({ code: "F07-ERR-012", collection_class: "CORE_OUTCOME" });
    const sealed = firstPage.current();
    clock.set(QUEUE_T0 + 1);
    firstPage.observeQueueDrop({ code: "F07-ERR-012", collection_class: "RELIABILITY" });
    expect(firstPage.current()).toBe(sealed);
    const handedOff = firstPage.sealForHandoff();
    await firstPage.settled();

    expect(handedOff).toEqual([
      { report_id: "b23e4567-e89b-42d3-a456-000000000001", local_queue_drop_count: 1, offline_expired_event_count: 1 },
      { report_id: "b23e4567-e89b-42d3-a456-000000000002", local_queue_drop_count: 0, offline_expired_event_count: 1 }
    ]);
    expect(handedOff[0]).toBe(sealed);
    expect([...storedReports(factory).values()]).toEqual([
      { ...handedOff[0], sealed_at: QUEUE_T0 },
      { ...handedOff[1], sealed_at: QUEUE_T0 + 1 }
    ]);

    clock.set(QUEUE_T0 + 2);
    const laterPage = new EvidenceQualityReportLedger(
      () => "c23e4567-e89b-42d3-a456-000000000001",
      createIndexedDbEvidenceQualityReportStore(factory),
      clock.now
    );
    laterPage.observeQueueDrop({ code: "F07-ERR-011", collection_class: "PRODUCT_SAMPLE" });
    await laterPage.restored();
    expect(laterPage.current()).toEqual(handedOff[0]);
    expect(laterPage.sealForHandoff()).toEqual([
      ...handedOff,
      { report_id: "c23e4567-e89b-42d3-a456-000000000001", local_queue_drop_count: 1, offline_expired_event_count: 0 }
    ]);

    laterPage.acknowledge({ ...REPORT });
    laterPage.acknowledge(handedOff[0] ?? REPORT);
    await laterPage.settled();
    expect([...storedReports(factory).keys()]).toEqual([
      "b23e4567-e89b-42d3-a456-000000000002",
      "c23e4567-e89b-42d3-a456-000000000001"
    ]);
    expect(laterPage.current()).toEqual(handedOff[1]);
  });

  test("the durable report store keeps only bounded valid records, dedupes report_id and survives storage failure", async () => {
    const factory = new FakeIndexedDbFactory();
    const store = createIndexedDbEvidenceQualityReportStore(factory);
    const sealedAt = (index: number) => ({
      report: { ...REPORT, report_id: `d23e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}` },
      sealedAt: QUEUE_T0 + index
    });

    await store.save(sealedAt(2));
    await store.save({ ...sealedAt(2), report: { ...sealedAt(2).report, local_queue_drop_count: 9 } });
    const records = storedReports(factory);
    records.set("e23e4567-e89b-42d3-a456-426614174000", { ...REPORT, report_id: "e23e4567-e89b-42d3-a456-426614174000", sealed_at: 1, session_id: REPORT.report_id });
    records.set("f23e4567-e89b-42d3-a456-426614174000", { ...REPORT, report_id: "f23e4567-e89b-42d3-a456-426614174000", local_queue_drop_count: 0 });
    await store.save(sealedAt(1));
    expect([...storedReports(factory).values()]).toEqual([
      { ...sealedAt(2).report, sealed_at: QUEUE_T0 + 2 },
      { ...sealedAt(1).report, sealed_at: QUEUE_T0 + 1 }
    ]);
    expect(await store.load()).toEqual([sealedAt(1), sealedAt(2)]);

    for (let index = 3; index <= EVIDENCE_QUALITY_REPORT_STORE_LIMIT + 5; index += 1) {
      await store.save(sealedAt(index));
    }
    expect(storedReports(factory).size).toBe(EVIDENCE_QUALITY_REPORT_STORE_LIMIT);
    expect(storedReports(factory).has(sealedAt(EVIDENCE_QUALITY_REPORT_STORE_LIMIT + 1).report.report_id)).toBe(false);
    await store.remove(sealedAt(1).report.report_id);
    expect(storedReports(factory).has(sealedAt(1).report.report_id)).toBe(false);

    factory.failWrites = true;
    const ledger = new EvidenceQualityReportLedger(uuidSequence(), store, () => QUEUE_T0);
    await ledger.restored();
    expect(ledger.current()).toEqual(sealedAt(2).report);
    ledger.observeQueueDrop({ code: "F07-ERR-011", collection_class: "PRODUCT_SAMPLE" });
    ledger.acknowledge(sealedAt(2).report);
    await ledger.settled();
    expect(ledger.current()).toEqual(sealedAt(3).report);
    expect(storedReports(factory).has(sealedAt(2).report.report_id)).toBe(true);
  });
});
