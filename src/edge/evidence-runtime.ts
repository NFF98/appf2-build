import { EvidenceIngestionService } from "../platform/evidence/evidence-ingestion-service.js";
import { EvidenceQualityRecorder } from "../platform/evidence/evidence-quality-recorder.js";
import type { EvidenceIngestionDiagnostics } from "../platform/evidence/evidence-repository.js";
import {
  EvidenceRetentionMaintenance,
  type EvidenceRetentionDiagnostics
} from "../platform/evidence/evidence-retention-maintenance.js";
import { F07EventExecutor } from "../platform/evidence/f07-event-executor.js";
import { PostgresEvidenceQualitySourceRepository } from "../platform/evidence/postgres-evidence-quality-repository.js";
import {
  PostgresAnonymousIdentityRepository,
  PostgresEvidenceRepository,
  type PostgresExecutor
} from "../platform/evidence/postgres-evidence-repository.js";
import { createPostgresEvidenceRetentionSources } from "../platform/evidence/postgres-evidence-retention-repository.js";
import {
  createEventsBatchHandler,
  type EventsBatchHttpRequest,
  type EventsBatchHttpResponse
} from "./events-batch.js";

export interface EvidenceRuntimeDependencies {
  readonly executor: PostgresExecutor;
  readonly diagnostics: EvidenceIngestionDiagnostics & EvidenceRetentionDiagnostics;
  readonly now?: () => Date;
  readonly randomUUID?: () => string;
}

function runtimeClock(dependencies: EvidenceRuntimeDependencies): () => Date {
  return dependencies.now ?? (() => new Date());
}

function runtimeUuid(dependencies: EvidenceRuntimeDependencies): () => string {
  return dependencies.randomUUID ?? (() => globalThis.crypto.randomUUID());
}

function eventsBatchHandler(
  dependencies: EvidenceRuntimeDependencies,
  ingestionExecutor: PostgresExecutor
): (request: EventsBatchHttpRequest) => Promise<EventsBatchHttpResponse> {
  const now = runtimeClock(dependencies);
  const randomUUID = runtimeUuid(dependencies);
  return createEventsBatchHandler({
    ingestion: new EvidenceIngestionService({
      anonymousIdentities: new PostgresAnonymousIdentityRepository(ingestionExecutor),
      evidence: new PostgresEvidenceRepository(ingestionExecutor),
      diagnostics: dependencies.diagnostics,
      now
    }),
    qualityRecorder: new EvidenceQualityRecorder({
      repository: new PostgresEvidenceQualitySourceRepository(dependencies.executor),
      diagnostics: dependencies.diagnostics,
      now,
      randomUUID
    }),
    createRequestId: randomUUID
  });
}

// T008 composition root for /api/v1/events/batch: the appf2-owned EvidenceQualityRecorder is
// always wired to durable Postgres quality sources; there is no optional/null observer path.
export function createProductionEventsBatchHandler(
  dependencies: EvidenceRuntimeDependencies
): (request: EventsBatchHttpRequest) => Promise<EventsBatchHttpResponse> {
  return eventsBatchHandler(dependencies, dependencies.executor);
}

export interface F07EventsRuntimeDependencies extends EvidenceRuntimeDependencies {
  /** F07-EVENT-001: required dedicated Event-only channel; the general Worker executor is not assignable here. */
  readonly eventExecutor: F07EventExecutor;
}

// PG-001 Worker composition root for /api/v1/events/batch: anonymous_identity + product_event go only through the
// F07 Event-only channel; quality sources stay on `executor`. No fallback.
export function createF07EventsBatchHandler(
  dependencies: F07EventsRuntimeDependencies
): (request: EventsBatchHttpRequest) => Promise<EventsBatchHttpResponse> {
  if (!(dependencies.eventExecutor instanceof F07EventExecutor)) {
    throw new Error("F07 events require the dedicated F07 Event-only executor.");
  }
  return eventsBatchHandler(dependencies, dependencies.eventExecutor);
}

// Production retention owner over every Evidence source class; a scheduler only calls run().
export function createProductionEvidenceRetentionMaintenance(
  dependencies: EvidenceRuntimeDependencies
): EvidenceRetentionMaintenance {
  return new EvidenceRetentionMaintenance({
    sources: createPostgresEvidenceRetentionSources(dependencies.executor),
    diagnostics: dependencies.diagnostics,
    now: runtimeClock(dependencies)
  });
}
