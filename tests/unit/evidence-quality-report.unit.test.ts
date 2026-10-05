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
  qualityReportRequestBytes,
  type EvidenceQualityReport
} from "../../src/platform/evidence/evidence-quality-report.js";
import {
  createIndexedDbEvidenceQualityReportStore,
  EVIDENCE_QUALITY_REPORT_STORE_LIMIT
} from "../../src/platform/evidence/evidence-quality-report-store.js";
import { EVIDENCE_LIMITS } from "../../src/platform/evidence/evidence-validator.js";
import { batchRejectionBody, canonicalBatchSuccessBody } from "./evidence-collector-test-support.js";
import { FakeIndexedDbFactory } from "./evidence-fake-indexeddb.js";
import {
  PageQualityReportStore,
  sealedQualityRecords,
  unsealedQualityRecords
} from "./evidence-quality-report-test-support.js";
import { largestValidEvent, ManualClock, QUEUE_T0 } from "./evidence-queue-test-support.js";

const REPORT = {
  report_id: "923e4567-e89b-42d3-a456-426614174000",
  local_queue_drop_count: 3,
  offline_expired_event_count: 0
};
const BATCH_ID = "a23e4567-e89b-42d3-a456-426614174000";
const QUEUE_DROP = { code: "F07-ERR-011", collection_class: "PRODUCT_SAMPLE" } as const;
const EXPIRY = { code: "F07-ERR-012", collection_class: "CORE_OUTCOME" } as const;

function uuidSequence(): () => string {
  let index = 0;
  return () => {
    index += 1;
    return sequenceId(index);
  };
}

function sequenceId(index: number): string {
  return `b23e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`;
}

function slotId(index: number): string {
  return `d23e4567-e89b-42d3-a456-${String(index).padStart(12, "0")}`;
}

function counts(drops: number, expired: number) {
  return { local_queue_drop_count: drops, offline_expired_event_count: expired };
}

function requireReport(report: EvidenceQualityReport | null | undefined): EvidenceQualityReport {
  if (report === null || report === undefined) {
    throw new Error("quality report expected");
  }
  return report;
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

describe("F07 quality_report durable counts", () => {
  test("every observed drop is durable before any terminal handoff; sealing happens only in prepare and never mutates a sealed report", async () => {
    const factory = new FakeIndexedDbFactory();
    const clock = new ManualClock(QUEUE_T0);
    const page = new PageQualityReportStore(createIndexedDbEvidenceQualityReportStore(factory));
    const ledger = new EvidenceQualityReportLedger(uuidSequence(), page, clock.now);

    ledger.observeQueueDrop(QUEUE_DROP);
    ledger.observeQueueDrop(EXPIRY);
    await ledger.settled();
    expect(ledger.current()).toBeNull();
    expect([...unsealedQualityRecords(factory).values()]).toEqual([{ report_id: sequenceId(1), ...counts(1, 1) }]);
    expect(sealedQualityRecords(factory).size).toBe(0);

    await ledger.prepare();
    const sealed = requireReport(ledger.current());
    expect(sealed).toEqual({ report_id: sequenceId(1), ...counts(1, 1) });
    expect([...sealedQualityRecords(factory).values()]).toEqual([{ ...sealed, sealed_at: QUEUE_T0 }]);
    expect(unsealedQualityRecords(factory).size).toBe(0);

    clock.set(QUEUE_T0 + 1);
    ledger.observeQueueDrop(EXPIRY);
    await ledger.settled();
    await ledger.prepare();
    expect(ledger.current()).toBe(sealed);
    expect([...sealedQualityRecords(factory).values()]).toEqual([{ ...sealed, sealed_at: QUEUE_T0 }]);
    expect([...unsealedQualityRecords(factory).values()]).toEqual([{ report_id: sequenceId(2), ...counts(0, 1) }]);

    const calls = page.calls;
    expect(ledger.handoffReports()).toEqual([sealed]);
    expect(page.calls).toBe(calls);
    expect(ledger.current()).toBe(sealed);

    ledger.acknowledge({ ...REPORT });
    ledger.acknowledge(sealed);
    await ledger.prepare();
    expect(ledger.current()).toEqual({ report_id: sequenceId(2), ...counts(0, 1) });
    expect([...sealedQualityRecords(factory).values()]).toEqual([
      { report_id: sequenceId(2), ...counts(0, 1), sealed_at: QUEUE_T0 + 1 }
    ]);
    expect(unsealedQualityRecords(factory).size).toBe(0);
  });

  test("a later page restores the terminated page's sealed and unsealed counts with the same report_id", async () => {
    const factory = new FakeIndexedDbFactory();
    const clock = new ManualClock(QUEUE_T0);
    const firstStore = new PageQualityReportStore(createIndexedDbEvidenceQualityReportStore(factory));
    const first = new EvidenceQualityReportLedger(uuidSequence(), firstStore, clock.now);
    first.observeQueueDrop(QUEUE_DROP);
    first.observeQueueDrop(EXPIRY);
    await first.prepare();
    const sealed = requireReport(first.current());
    first.observeQueueDrop(EXPIRY);
    await first.settled();

    expect(firstStore.inFlight).toBe(0);
    const storageCalls = firstStore.calls;
    const handedOff = first.handoffReports();
    firstStore.terminate();
    expect(firstStore.calls).toBe(storageCalls);
    expect(handedOff).toEqual([sealed]);
    expect([...sealedQualityRecords(factory).values()]).toEqual([{ ...sealed, sealed_at: QUEUE_T0 }]);
    expect([...unsealedQualityRecords(factory).values()]).toEqual([{ report_id: sequenceId(2), ...counts(0, 1) }]);

    clock.set(QUEUE_T0 + 1);
    const later = new EvidenceQualityReportLedger(
      () => "c23e4567-e89b-42d3-a456-000000000001",
      createIndexedDbEvidenceQualityReportStore(factory),
      clock.now
    );
    await later.prepare();
    expect(later.current()).toEqual(sealed);
    expect(later.handoffReports()).toEqual([sealed]);

    later.acknowledge(sealed);
    await later.prepare();
    expect(later.current()).toEqual({ report_id: sequenceId(2), ...counts(0, 1) });
    expect([...sealedQualityRecords(factory).keys()]).toEqual([sequenceId(2)]);
    expect(unsealedQualityRecords(factory).size).toBe(0);
  });
});

describe("F07 quality_report durable store bound and integrity", () => {
  test("at the sealed-report bound new counts stay durable in one unsealed report, no sealed report changes and none is memory-only", async () => {
    const factory = new FakeIndexedDbFactory();
    const store = createIndexedDbEvidenceQualityReportStore(factory);
    for (let index = 1; index <= EVIDENCE_QUALITY_REPORT_STORE_LIMIT; index += 1) {
      await store.accumulate(counts(1, 0), () => slotId(index));
      await store.seal(QUEUE_T0 + index);
    }
    const full = [...sealedQualityRecords(factory).values()];
    expect(full).toHaveLength(EVIDENCE_QUALITY_REPORT_STORE_LIMIT);
    const fullReports = full.map(record => {
      const stored = record as EvidenceQualityReport;
      return { report_id: stored.report_id, ...counts(stored.local_queue_drop_count, stored.offline_expired_event_count) };
    });

    const overflowId = slotId(EVIDENCE_QUALITY_REPORT_STORE_LIMIT + 1);
    const page = new PageQualityReportStore(store);
    const ledger = new EvidenceQualityReportLedger(() => overflowId, page, () => QUEUE_T0 + 100);
    ledger.observeQueueDrop(EXPIRY);
    ledger.observeQueueDrop(EXPIRY);
    await ledger.prepare();
    expect(await store.seal(QUEUE_T0 + 100)).toHaveLength(EVIDENCE_QUALITY_REPORT_STORE_LIMIT);
    expect([...sealedQualityRecords(factory).values()]).toEqual(full);
    expect([...unsealedQualityRecords(factory).values()]).toEqual([{ report_id: overflowId, ...counts(0, 2) }]);
    expect(ledger.handoffReports()).toEqual(fullReports);

    ledger.observeQueueDrop(QUEUE_DROP);
    await ledger.settled();
    expect([...sealedQualityRecords(factory).values()]).toEqual(full);
    expect([...unsealedQualityRecords(factory).values()]).toEqual([{ report_id: overflowId, ...counts(1, 2) }]);
    expect(sealedQualityRecords(factory).size + unsealedQualityRecords(factory).size)
      .toBe(EVIDENCE_QUALITY_REPORT_STORE_LIMIT + 1);
    expect(page.inFlight).toBe(0);

    for (const report of fullReports) {
      expect(ledger.current()).toEqual(report);
      ledger.acknowledge(requireReport(ledger.current()));
      await ledger.prepare();
    }
    expect(ledger.current()).toEqual({ report_id: overflowId, ...counts(1, 2) });
    expect([...sealedQualityRecords(factory).values()]).toEqual([
      { report_id: overflowId, ...counts(1, 2), sealed_at: QUEUE_T0 + 100 }
    ]);
    expect(unsealedQualityRecords(factory).size).toBe(0);
  });

  test("the durable store deletes malformed records, folds stray unsealed records and changes nothing when a write fails", async () => {
    const factory = new FakeIndexedDbFactory();
    const store = createIndexedDbEvidenceQualityReportStore(factory);
    await store.accumulate(counts(0, 1), () => slotId(1));
    unsealedQualityRecords(factory).set(slotId(2), { report_id: slotId(2), ...counts(2, 0) });
    unsealedQualityRecords(factory).set("not-a-uuid", { report_id: "not-a-uuid", ...counts(5, 0) });
    sealedQualityRecords(factory).set(slotId(3), { ...REPORT, report_id: slotId(3), sealed_at: 1, session_id: REPORT.report_id });
    sealedQualityRecords(factory).set(slotId(4), { report_id: slotId(4), ...counts(0, 0), sealed_at: 1 });

    expect(await store.load()).toEqual([]);
    expect(sealedQualityRecords(factory).size).toBe(0);
    expect(await store.seal(QUEUE_T0)).toEqual([{ report: { report_id: slotId(1), ...counts(2, 1) }, sealedAt: QUEUE_T0 }]);
    expect(unsealedQualityRecords(factory).size).toBe(0);

    await expect(store.accumulate(counts(1, 0), () => "not-a-uuid")).rejects.toThrow();
    expect(unsealedQualityRecords(factory).size).toBe(0);

    factory.failWrites = true;
    await expect(store.accumulate(counts(1, 0), () => slotId(5))).rejects.toThrow();
    await expect(store.seal(QUEUE_T0 + 1)).resolves.toHaveLength(1);
    expect(unsealedQualityRecords(factory).size).toBe(0);

    const ledger = new EvidenceQualityReportLedger(uuidSequence(), store, () => QUEUE_T0 + 1);
    await ledger.restored();
    const restored = requireReport(ledger.current());
    expect(restored).toEqual({ report_id: slotId(1), ...counts(2, 1) });
    ledger.observeQueueDrop(QUEUE_DROP);
    ledger.acknowledge(restored);
    await ledger.settled();
    expect(ledger.current()).toEqual({ report_id: expect.any(String), ...counts(1, 0) });
    expect(sealedQualityRecords(factory).has(slotId(1))).toBe(true);
    expect(unsealedQualityRecords(factory).size).toBe(0);
  });
});
