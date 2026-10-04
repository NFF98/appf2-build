import { expect } from "vitest";

import {
  createExecutionAdmissionService,
  type ExecutionAdmissionService
} from "../../src/platform/blueprint/execution-admission.js";
import type { F02EvidenceOptions } from "../../src/platform/blueprint/validation-evidence.js";
import { CURRENT_BUNDLED_RELEASE, createBundledReleaseSource } from "../../src/platform/capabilities/bundled-release.js";
import { EvidenceIngestionService } from "../../src/platform/evidence/evidence-ingestion-service.js";
import { lockedEvidenceRegistry } from "../../src/platform/evidence/evidence-registry.js";
import type { EvidenceBatchResult, EvidenceEventInput } from "../../src/platform/evidence/evidence-types.js";
import { validateEvidenceEvent } from "../../src/platform/evidence/evidence-validator.js";
import type { FakeBlueprintPostgres } from "../contract/blueprint-postgres-fake.js";
import { handlersFor, RUNTIME_VERSION, SCHEMA_RANGE } from "../contract/execution-safety-fixtures.js";

export const CANONICAL_TRACE = /^(?!0{32}$)[0-9a-f]{32}$/;
export const NOW = (): Date => new Date("2026-10-04T00:00:00.000Z");

/** Envelope fields an F02 server-side event may carry; everything else must be absent. */
const F02_ENVELOPE_FIELDS = new Set(["event_id", "event_type", "schema_version", "occurred_at", "function_id", "trace_id", "error_code"]);

export type EvidenceFailureMode = "NONE" | "INTAKE_THROWS" | "STORAGE_THROWS" | "INTAKE_REJECTS" | "DIAGNOSTICS_THROW";

export interface EvidenceCapture {
  readonly options: F02EvidenceOptions;
  /** Every raw event handed to F07 intake. */
  readonly ingested: unknown[];
  /** Durable product_event rows accepted by the real F07 intake. */
  readonly stored: EvidenceEventInput[];
  readonly batches: EvidenceBatchResult[];
  readonly diagnostics: unknown[];
}

/** Real F07 EvidenceIngestionService over in-memory product_event storage, with injectable delivery failures. */
export function evidenceCapture(mode: EvidenceFailureMode = "NONE"): EvidenceCapture {
  const ingested: unknown[] = [];
  const stored: EvidenceEventInput[] = [];
  const batches: EvidenceBatchResult[] = [];
  const diagnostics: unknown[] = [];
  const sink = {
    reportNonBlockingFailure: (error: unknown) => {
      diagnostics.push(error);
      if (mode === "DIAGNOSTICS_THROW") {
        throw new Error("simulated diagnostics sink failure");
      }
    }
  };
  const service = new EvidenceIngestionService({
    anonymousIdentities: {
      ensure: () => Promise.reject(new Error("F02 server Evidence must not carry anonymous_id.")),
      refreshLastSeen: () => Promise.resolve()
    },
    evidence: {
      insert: (event) => {
        if (mode === "STORAGE_THROWS") {
          return Promise.reject(new Error("simulated product_event storage failure"));
        }
        stored.push(event);
        return Promise.resolve("INSERTED");
      }
    },
    diagnostics: sink,
    now: NOW
  });
  const intake = {
    ingest: async (events: readonly unknown[]): Promise<EvidenceBatchResult> => {
      ingested.push(...events);
      if (mode === "INTAKE_THROWS" || mode === "DIAGNOSTICS_THROW") {
        throw new Error("simulated F07 intake outage");
      }
      if (mode === "INTAKE_REJECTS") {
        const rejected = { accepted: 0, duplicates: 0, rejected: events.length, rejections: events.map(() => ({ event_id: null, code: "F07-ERR-010" as const, field: null })), diagnostics: [] };
        batches.push(rejected);
        return rejected;
      }
      const result = await service.ingest(events);
      batches.push(result);
      return result;
    }
  };
  return { options: { intake, diagnostics: sink, now: NOW }, ingested, stored, batches, diagnostics };
}

/** Every handed-over event passes the locked BS-P1-013 Registry and carries only Registry-shaped F02 fields. */
export function expectRegistryShaped(capture: EvidenceCapture, label: string): void {
  for (const raw of capture.ingested) {
    const verdict = validateEvidenceEvent(raw, JSON.stringify(raw));
    expect(verdict, label).toMatchObject({ accepted: true });
    const event = raw as Record<string, unknown>;
    expect(Object.keys(event).filter((key) => key !== "properties" && !F02_ENVELOPE_FIELDS.has(key)), label).toEqual([]);
    const entry = lockedEvidenceRegistry.find(String(event.event_type));
    expect(entry?.functionId, label).toBe("F02");
    const properties = Object.keys((event.properties ?? {}) as Record<string, unknown>);
    expect(properties.filter((key) => !entry?.allowedProperties.has(key)), label).toEqual([]);
    expect(event.trace_id, label).toMatch(CANONICAL_TRACE);
  }
  expect(capture.batches.flatMap((batch) => batch.rejections), label).toEqual([]);
  expect(capture.stored, label).toHaveLength(capture.ingested.length);
  expect(capture.diagnostics, label).toEqual([]);
}

export function eventTypes(capture: EvidenceCapture): string[] {
  return capture.stored.map((event) => event.event_type);
}

/** Test-only fresh-admission reader over the fake durable tables (production wiring is POI-005, not T005). */
export function executionAdmission(database: FakeBlueprintPostgres): ExecutionAdmissionService {
  return createExecutionAdmissionService({
    content: {
      readContent: (contentHash) =>
        Promise.resolve().then(() => {
          const row = database.contents.get(contentHash);
          if (row === undefined) {
            return undefined;
          }
          return {
            content_hash: row.content_hash,
            canonical_blueprint: row.canonical_blueprint,
            schema_version: row.schema_version,
            registry_version: row.registry_version,
            trust_status: row.trust_status,
            admitted_registry_digest: String(database.runs.get(row.admitted_by_validation_run_id)?.report.registry_digest)
          };
        })
    },
    releases: createBundledReleaseSource({ bundledHandlers: handlersFor(CURRENT_BUNDLED_RELEASE) }),
    runtimeVersion: RUNTIME_VERSION,
    supportedBlueprintSchemaRange: SCHEMA_RANGE,
    now: NOW
  });
}

export function runId(index: number): string {
  return `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`;
}
