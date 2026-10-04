import { randomUUID } from "node:crypto";

import { lockedEvidenceRegistry } from "../evidence/evidence-registry.js";
import type { EvidenceIngestionDiagnostics } from "../evidence/evidence-repository.js";
import type { EvidenceBatchResult, EvidenceEventInput } from "../evidence/evidence-types.js";
import type { F02ErrorCode, ValidationReport, ValidationStage } from "./validation-types.js";

/** F07 canonical trace grammar (Evidence Registry envelope `trace_id`). */
const CANONICAL_TRACE_ID = /^(?!0{32}$)[0-9a-f]{32}$/;

/** Evidence-only stage vocabulary; `TRUST` never appears on a ValidationIssue. */
export type F02EvidenceStage = ValidationStage | "TRUST";

export type F02EvidenceEventType =
  | "F02-EVT-002"
  | "F02-EVT-003"
  | "F02-EVT-004"
  | "F02-EVT-007"
  | "F02-EVT-008"
  | "F02-EVT-009"
  | "F02-EVT-014";

/** Only Registry-allowed F02 properties; raw Blueprint body / candidate bytes / Intent have no slot by construction. */
export type F02EvidenceProperties = {
  readonly content_hash?: string;
  readonly blueprint_schema_version: string;
  readonly registry_version: string;
  readonly validation_stage?: F02EvidenceStage;
};

export interface F02EvidenceEvent {
  readonly event_type: F02EvidenceEventType;
  readonly trace_id: string;
  readonly error_code?: F02ErrorCode;
  readonly properties: F02EvidenceProperties;
}

/** The F07 server intake (EvidenceIngestionService): validation, dedupe and product_event insert stay owned by F07. */
export interface F02EvidenceIntake {
  ingest(events: readonly unknown[]): Promise<EvidenceBatchResult>;
}

export interface F02EvidenceOptions {
  readonly intake: F02EvidenceIntake;
  readonly diagnostics: EvidenceIngestionDiagnostics;
  readonly newEventId?: () => string;
  readonly now?: () => Date;
}

export function isCanonicalTraceId(value: unknown): value is string {
  return typeof value === "string" && CANONICAL_TRACE_ID.test(value);
}

/** 32 lowercase hex; the UUID v4 version nibble guarantees it is never all zeros. */
export function newCanonicalTraceId(): string {
  return randomUUID().replaceAll("-", "");
}

/** Trusted F02 boundary: keep a canonical upstream trace, otherwise replace it before any report/run/Evidence exists. */
export function canonicalTraceId(upstream: unknown): string {
  return isCanonicalTraceId(upstream) ? upstream : newCanonicalTraceId();
}

/** Terminal validation outcome Evidence derived only from the issued ValidationReport. */
export function validationOutcomeEvent(report: ValidationReport): F02EvidenceEvent {
  const versions = { blueprint_schema_version: report.schema_version, registry_version: report.registry_version };
  if (report.status === "PASSED") {
    return {
      event_type: "F02-EVT-002",
      trace_id: report.trace_id,
      properties: { ...versions, content_hash: report.content_hash, validation_stage: "V12" }
    };
  }
  const [issue] = report.issues;
  return {
    event_type: report.status === "REJECTED" ? "F02-EVT-003" : "F02-EVT-004",
    trace_id: report.trace_id,
    ...(issue === undefined ? {} : { error_code: issue.error_code }),
    properties: { ...versions, ...(issue === undefined ? {} : { validation_stage: issue.stage }) }
  };
}

/** V12 content Evidence: the one blueprint_content insert, or a same-hash body integrity failure. */
export function contentEvent(
  eventType: "F02-EVT-007" | "F02-EVT-009",
  report: ValidationReport,
  contentHash: string
): F02EvidenceEvent {
  return {
    event_type: eventType,
    trace_id: report.trace_id,
    ...(eventType === "F02-EVT-009" ? { error_code: "F02-ERR-015" as const } : {}),
    properties: {
      content_hash: contentHash,
      blueprint_schema_version: report.schema_version,
      registry_version: report.registry_version,
      validation_stage: "V12"
    }
  };
}

export interface TrustTransitionEvidence {
  readonly new_status: "REVOKED" | "INCOMPATIBLE";
  readonly content_hash: string;
  readonly schema_version: string;
  readonly registry_version: string;
  readonly trace_id: string;
}

/** Successful durable trust transition: REVOKED → F02-EVT-008, INCOMPATIBLE → F02-EVT-014. */
export function trustTransitionEvent(transition: TrustTransitionEvidence): F02EvidenceEvent {
  return {
    event_type: transition.new_status === "REVOKED" ? "F02-EVT-008" : "F02-EVT-014",
    trace_id: transition.trace_id,
    properties: {
      content_hash: transition.content_hash,
      blueprint_schema_version: transition.schema_version,
      registry_version: transition.registry_version,
      validation_stage: "TRUST"
    }
  };
}

function envelope(event: F02EvidenceEvent, eventId: string, occurredAt: string): EvidenceEventInput {
  const entry = lockedEvidenceRegistry.find(event.event_type);
  if (entry === undefined) {
    throw new Error(`F02 evidence event ${event.event_type} is not registered.`);
  }
  return {
    event_id: eventId,
    event_type: event.event_type,
    schema_version: entry.schemaVersion,
    occurred_at: occurredAt,
    function_id: "F02",
    trace_id: event.trace_id,
    ...(event.error_code === undefined ? {} : { error_code: event.error_code }),
    properties: event.properties
  };
}

function reportDiagnostic(diagnostics: EvidenceIngestionDiagnostics, error: unknown): void {
  try {
    diagnostics.reportNonBlockingFailure(error);
  } catch {
    // A failing diagnostics sink must not turn already-committed durable truth into a caller-visible failure.
  }
}

/** F07: Evidence delivery is non-blocking; intake rejections or failures become diagnostics, never product-flow errors. */
export async function emitF02Evidence(options: F02EvidenceOptions | undefined, events: readonly F02EvidenceEvent[]): Promise<void> {
  if (options === undefined || events.length === 0) {
    return;
  }
  try {
    const occurredAt = (options.now?.() ?? new Date()).toISOString();
    const newEventId = options.newEventId ?? randomUUID;
    const result = await options.intake.ingest(events.map((event) => envelope(event, newEventId(), occurredAt)));
    if (result.rejected > 0) {
      const codes = result.rejections.map((rejection) => `${rejection.code}:${rejection.field ?? "-"}`).join(", ");
      reportDiagnostic(options.diagnostics, new Error(`F02 evidence rejected by F07 intake: ${codes}`));
    }
  } catch (error: unknown) {
    reportDiagnostic(options.diagnostics, error);
  }
}
