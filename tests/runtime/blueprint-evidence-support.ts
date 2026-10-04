import { createHash } from "node:crypto";

import { expect } from "vitest";

import { verifyAdmissionLineage, type AdmissionLineage } from "../../src/platform/blueprint/admission-lineage.js";
import {
  createExecutionAdmissionService,
  type ExecutionAdmissionService,
  type ExecutionContentSource
} from "../../src/platform/blueprint/execution-admission.js";
import {
  PostgresAdmissionLineageSource,
  PostgresBlueprintAdmissionRepository
} from "../../src/platform/blueprint/postgres-blueprint-repository.js";
import type { F02EvidenceOptions } from "../../src/platform/blueprint/validation-evidence.js";
import { validateBlueprintCandidate, type BlueprintValidationContext } from "../../src/platform/blueprint/validate-blueprint.js";
import type { BlueprintValidationResult } from "../../src/platform/blueprint/validation-types.js";
import { createTrustedRuntimeHandlerCatalog } from "../../src/platform/capabilities/registry-release.js";
import type { RegistryReleaseBundle, RegistryReleaseSource } from "../../src/platform/capabilities/schema/registry-release.js";
import { EvidenceIngestionService } from "../../src/platform/evidence/evidence-ingestion-service.js";
import { lockedEvidenceRegistry } from "../../src/platform/evidence/evidence-registry.js";
import type { AnonymousIdentityRepository, EvidenceRepository } from "../../src/platform/evidence/evidence-repository.js";
import type { EvidenceBatchResult, EvidenceEventInput, EvidenceWriteResult } from "../../src/platform/evidence/evidence-types.js";
import { FakeBlueprintPostgres } from "../contract/blueprint-postgres-fake.js";
import { handlersFor, ledgerOf, RUNTIME_VERSION, SCHEMA_RANGE } from "../contract/execution-safety-fixtures.js";

export const NOW = (): Date => new Date("2026-10-04T03:00:00.000Z");
export const TRACE_ID = /^(?!0{32}$)[0-9a-f]{32}$/;

export function uuid(index: number): string {
  return `00000000-0000-4000-8000-${index.toString(16).padStart(12, "0")}`;
}

export function traceOf(index: number): string {
  return (index + 1).toString(16).padStart(32, "0");
}

export function sha256Digest(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

export function validateBytes(bytes: Uint8Array, context: BlueprintValidationContext = {}): BlueprintValidationResult {
  return validateBlueprintCandidate(bytes, context);
}

/** product_event table stand-in behind the real F07 EvidenceIngestionService (event_id dedupe like the durable row). */
export class ProductEventTable implements EvidenceRepository {
  public readonly rows: EvidenceEventInput[] = [];

  public insert(event: EvidenceEventInput): Promise<EvidenceWriteResult> {
    if (this.rows.some((row) => row.event_id === event.event_id)) {
      return Promise.resolve("DUPLICATE");
    }
    this.rows.push(structuredClone(event));
    return Promise.resolve("INSERTED");
  }

  public byTrace(traceId: string): readonly EvidenceEventInput[] {
    return this.rows.filter((row) => row.trace_id === traceId);
  }
}

const SERVER_EVENTS_HAVE_NO_IDENTITY: AnonymousIdentityRepository = {
  ensure: () => Promise.reject(new Error("F02 server events never carry anonymous_id.")),
  refreshLastSeen: () => Promise.resolve()
};

export interface EvidenceHarness {
  readonly productEvents: ProductEventTable;
  readonly diagnostics: unknown[];
  readonly batches: EvidenceBatchResult[];
  readonly options: F02EvidenceOptions;
}

export function evidenceHarness(firstEventIndex = 1): EvidenceHarness {
  const productEvents = new ProductEventTable();
  const diagnostics: unknown[] = [];
  const batches: EvidenceBatchResult[] = [];
  const report = { reportNonBlockingFailure: (error: unknown) => diagnostics.push(error) };
  const service = new EvidenceIngestionService({
    anonymousIdentities: SERVER_EVENTS_HAVE_NO_IDENTITY,
    evidence: productEvents,
    diagnostics: report,
    now: NOW
  });
  let next = firstEventIndex;
  return {
    productEvents,
    diagnostics,
    batches,
    options: {
      intake: {
        ingest: async (events) => {
          const result = await service.ingest(events);
          batches.push(result);
          return result;
        }
      },
      diagnostics: report,
      newEventId: () => uuid(0xe0000 + next++),
      now: NOW
    }
  };
}

/** Every stored F02 event uses only Registry-allowed properties for its event_type, all scalar strings. */
export function expectRegistryShaped(events: readonly EvidenceEventInput[], label: string): void {
  for (const event of events) {
    const entry = lockedEvidenceRegistry.find(event.event_type);
    expect(entry, `${label} ${event.event_type}`).toBeDefined();
    expect(event.function_id, label).toBe("F02");
    expect(event.schema_version, label).toBe(entry?.schemaVersion);
    for (const [key, value] of Object.entries(event.properties ?? {})) {
      expect(entry?.allowedProperties.has(key), `${label} ${event.event_type}.${key}`).toBe(true);
      expect(typeof value, `${label} ${event.event_type}.${key}`).toBe("string");
    }
  }
}

export interface DurableStore {
  readonly database: FakeBlueprintPostgres;
  readonly repository: PostgresBlueprintAdmissionRepository;
  lineage(contentHash: string): Promise<AdmissionLineage>;
  durableJson(): string;
}

export function durableStore(): DurableStore {
  const database = new FakeBlueprintPostgres();
  const lineageSource = new PostgresAdmissionLineageSource(database);
  return {
    database,
    repository: new PostgresBlueprintAdmissionRepository(database),
    lineage: (contentHash) => verifyAdmissionLineage(contentHash, lineageSource),
    durableJson: () => JSON.stringify([...database.contents.values(), ...database.runs.values()])
  };
}

/** Test-only reader over the fake durable tables; production repository wiring (POI-005) is not part of this proof. */
export function contentSource(database: FakeBlueprintPostgres, failRead = false): ExecutionContentSource {
  return {
    readContent: (contentHash) => {
      if (failRead) {
        return Promise.reject(new Error("blueprint repository timeout"));
      }
      const row = database.contents.get(contentHash);
      if (row === undefined) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve({
        content_hash: row.content_hash,
        canonical_blueprint: row.canonical_blueprint,
        schema_version: row.schema_version,
        registry_version: row.registry_version,
        trust_status: row.trust_status,
        admitted_registry_digest: String(database.runs.get(row.admitted_by_validation_run_id)?.report.registry_digest)
      });
    }
  };
}

export function releaseSource(pinned: RegistryReleaseBundle, current: RegistryReleaseBundle = pinned): RegistryReleaseSource {
  const known = pinned === current ? [pinned] : [pinned, current];
  return {
    loadReleaseLedger: () => Promise.resolve(ledgerOf(...known)),
    loadPinnedRelease: (identity) =>
      Promise.resolve(known.find((bundle) => bundle.identity.registry_digest === identity.registry_digest)),
    loadCurrentRelease: () => Promise.resolve(current),
    loadRuntimeHandlerCatalog: () => Promise.resolve(createTrustedRuntimeHandlerCatalog(handlersFor(pinned)))
  };
}

export interface AdmissionServiceOptions {
  readonly releases: RegistryReleaseSource;
  readonly evidence: F02EvidenceOptions;
  readonly traceId: string;
  readonly failRead?: boolean;
}

export function executionAdmission(database: FakeBlueprintPostgres, options: AdmissionServiceOptions): ExecutionAdmissionService {
  return createExecutionAdmissionService({
    content: contentSource(database, options.failRead === true),
    releases: options.releases,
    runtimeVersion: RUNTIME_VERSION,
    supportedBlueprintSchemaRange: SCHEMA_RANGE,
    now: NOW,
    newAdmissionId: () => uuid(0xa0000),
    evidence: options.evidence,
    newTraceId: () => options.traceId
  });
}
