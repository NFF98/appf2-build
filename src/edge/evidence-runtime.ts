import { EvidenceIngestionService } from "../platform/evidence/evidence-ingestion-service.js";
import { EvidenceQualityRecorder } from "../platform/evidence/evidence-quality-recorder.js";
import type { EvidenceIngestionDiagnostics } from "../platform/evidence/evidence-repository.js";
import {
  EvidenceRetentionMaintenance,
  type EvidenceRetentionDiagnostics
} from "../platform/evidence/evidence-retention-maintenance.js";
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

// Production composition root for /api/v1/events/batch: the appf2-owned EvidenceQualityRecorder is
// always wired to durable Postgres quality sources; there is no optional/null observer path.
export function createProductionEventsBatchHandler(
  dependencies: EvidenceRuntimeDependencies
): (request: EventsBatchHttpRequest) => Promise<EventsBatchHttpResponse> {
  const now = runtimeClock(dependencies);
  const randomUUID = runtimeUuid(dependencies);
  return createEventsBatchHandler({
    ingestion: new EvidenceIngestionService({
      anonymousIdentities: new PostgresAnonymousIdentityRepository(dependencies.executor),
      evidence: new PostgresEvidenceRepository(dependencies.executor),
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
