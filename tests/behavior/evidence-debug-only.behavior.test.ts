import { describe, expect, test } from "vitest";

import lockedRegistryDocument from "../../build-spec/baselines/BS-P1-018/registries/evidence-event-registry.json" with {
  type: "json"
};
import { createEventsBatchHandler } from "../../src/edge/events-batch.js";
import {
  createBrowserEvidenceBatchTransport,
  RETRYABLE_INGESTION_REJECTION_CODES
} from "../../src/platform/evidence/evidence-batch-transport.js";
import {
  admitEvidenceEvent,
  type EvidenceCollectionClass
} from "../../src/platform/evidence/evidence-client-queue.js";
import { EvidenceIngestionService } from "../../src/platform/evidence/evidence-ingestion-service.js";
import { EvidenceQualityRecorder } from "../../src/platform/evidence/evidence-quality-recorder.js";
import { isProductionDeliverable } from "../../src/platform/evidence/evidence-queue-policy.js";
import {
  createEvidenceRegistry,
  lockedEvidenceRegistry,
  type EvidenceRegistryDocument
} from "../../src/platform/evidence/evidence-registry.js";
import { PostgresEvidenceQualitySourceRepository } from "../../src/platform/evidence/postgres-evidence-quality-repository.js";
import {
  POSTGRES_ENSURE_ANONYMOUS_IDENTITY_SQL,
  POSTGRES_INSERT_EVIDENCE_SQL,
  PostgresAnonymousIdentityRepository,
  PostgresEvidenceRepository
} from "../../src/platform/evidence/postgres-evidence-repository.js";
import { coreOutcomeEvent, productSampleEvent } from "../unit/evidence-queue-test-support.js";
import { FakeEvidenceRetentionPostgres } from "./evidence-retention-postgres-fake.js";

const DEBUG_ANONYMOUS_ID = "a2e4567e-e89b-42d3-a456-426614174000";
const CORE_ANONYMOUS_ID = "b2e4567e-e89b-42d3-a456-426614174000";
const BATCH_ID = "c2e4567e-e89b-42d3-a456-426614174000";

function registryWithDebugOnly(eventType: string): EvidenceRegistryDocument {
  const document: EvidenceRegistryDocument = lockedRegistryDocument;
  return {
    ...document,
    entries: document.entries.map(entry =>
      entry.event_type === eventType ? { ...entry, collection_class: "DEBUG_ONLY" } : entry
    )
  };
}

function proveClientAdmissionGuard(): void {
  const sample = productSampleEvent(1);
  const debugRegistry = createEvidenceRegistry(registryWithDebugOnly(sample.event_type));
  expect(debugRegistry.find(sample.event_type)?.collectionClass).toBe("DEBUG_ONLY");

  expect(admitEvidenceEvent(sample, debugRegistry)).toBeNull();
  expect(admitEvidenceEvent(sample)?.collectionClass).toBe("PRODUCT_SAMPLE");
  expect(admitEvidenceEvent(coreOutcomeEvent(1), debugRegistry)?.collectionClass).toBe("CORE_OUTCOME");

  expect(isProductionDeliverable("DEBUG_ONLY")).toBe(false);
  const deliverable: readonly EvidenceCollectionClass[] = ["CORE_OUTCOME", "RELIABILITY", "PRODUCT_SAMPLE"];
  expect(deliverable.every(isProductionDeliverable)).toBe(true);

  const lockedClasses = lockedRegistryDocument.entries.map(entry => entry.collection_class);
  expect(lockedClasses).not.toContain("DEBUG_ONLY");
  expect(lockedRegistryDocument.entries.every(entry =>
    lockedEvidenceRegistry.find(entry.event_type)?.collectionClass === entry.collection_class
  )).toBe(true);
}

// Server defense in depth: a registered DEBUG_ONLY event that bypasses the client guard is refused
// with non-retryable F07-ERR-016 before anonymous identity ensure and before product_event insert.
async function proveServerRejectsDebugOnly(): Promise<void> {
  const debugEvent = { ...productSampleEvent(2), anonymous_id: DEBUG_ANONYMOUS_ID };
  const coreEvent = { ...coreOutcomeEvent(2), anonymous_id: CORE_ANONYMOUS_ID };
  const unknownEvent = { ...productSampleEvent(3), event_type: "F00-EVT-999", anonymous_id: DEBUG_ANONYMOUS_ID };
  const database = new FakeEvidenceRetentionPostgres();
  const failures: unknown[] = [];
  const diagnostics = { reportNonBlockingFailure: (error: unknown) => { failures.push(error); } };
  const now = () => new Date("2026-10-05T00:00:00.000Z");
  let uuidIndex = 0;
  const randomUUID = () => {
    uuidIndex += 1;
    return `99999999-0000-4000-8000-${String(uuidIndex).padStart(12, "0")}`;
  };
  const handler = createEventsBatchHandler({
    ingestion: new EvidenceIngestionService({
      anonymousIdentities: new PostgresAnonymousIdentityRepository(database),
      evidence: new PostgresEvidenceRepository(database),
      diagnostics,
      now,
      registry: createEvidenceRegistry(registryWithDebugOnly(debugEvent.event_type))
    }),
    qualityRecorder: new EvidenceQualityRecorder({
      repository: new PostgresEvidenceQualitySourceRepository(database),
      diagnostics,
      now,
      randomUUID
    }),
    createRequestId: randomUUID
  });

  const response = await handler({ body: JSON.stringify({ batch_id: BATCH_ID, events: [debugEvent, coreEvent, unknownEvent] }) });

  expect(response).toMatchObject({
    status: 200,
    body: {
      data: {
        accepted: 1,
        duplicates: 0,
        rejected: 2,
        rejections: [
          { event_id: debugEvent.event_id, code: "F07-ERR-016", field: null },
          { event_id: unknownEvent.event_id, code: "F07-ERR-004" }
        ]
      }
    }
  });
  expect([...database.events.keys()]).toEqual([coreEvent.event_id]);
  expect(database.executed(POSTGRES_INSERT_EVIDENCE_SQL)).toBe(1);
  expect(database.executed(POSTGRES_ENSURE_ANONYMOUS_IDENTITY_SQL)).toBe(1);
  expect([...database.identities.keys()]).toEqual([CORE_ANONYMOUS_ID]);
  expect([...database.intakeObservations.values()]).toMatchObject([{
    batch_accepted: true,
    event_received_count: 3,
    accepted_count: 1,
    duplicate_count: 0,
    rejected_count: 2,
    unknown_event_type_count: 1,
    route_rejection_code: null
  }]);
  expect(failures).toEqual([]);

  expect(RETRYABLE_INGESTION_REJECTION_CODES).not.toContain("F07-ERR-016");
  const transport = createBrowserEvidenceBatchTransport(async () => new Response(JSON.stringify(response.body), { status: 200 }));
  expect(await transport.send({ batch_id: BATCH_ID, events: [debugEvent] })).toEqual({ ok: true });
}

describe("F07 DEBUG_ONLY production default", () => {
  test("TEST-F07-029 DEBUG_ONLY evidence is never admitted for durable production delivery by default", async () => {
    proveClientAdmissionGuard();
    await proveServerRejectsDebugOnly();
  });
});
