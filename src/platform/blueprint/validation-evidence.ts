import { randomUUID } from "node:crypto";

import { lockedEvidenceRegistry } from "../evidence/evidence-registry.js";
import type { EvidenceIngestionDiagnostics } from "../evidence/evidence-repository.js";
import type { EvidenceBatchResult, EvidenceEventInput } from "../evidence/evidence-types.js";
import type { F02ErrorCode, ValidationStage } from "./validation-types.js";

export type F02EvidenceEventType =
  | "F02-EVT-002"
  | "F02-EVT-003"
  | "F02-EVT-004"
  | "F02-EVT-007"
  | "F02-EVT-009"
  | "F02-EVT-010"
  | "F02-EVT-011"
  | "F02-EVT-012"
  | "F02-EVT-013";

/** Only Registry-allowed F02 properties; raw Blueprint / raw Intent have no slot here by construction. */
export type F02EvidenceProperties = {
  readonly content_hash?: string;
  readonly blueprint_schema_version?: string;
  readonly registry_version?: string;
  readonly registry_digest?: string;
  readonly runtime_version?: string;
  readonly validation_stage?: ValidationStage;
};

export interface F02EvidenceEvent {
  readonly event_type: F02EvidenceEventType;
  readonly trace_id: string;
  readonly error_code?: F02ErrorCode;
  readonly blueprint_hash?: string;
  readonly properties: F02EvidenceProperties;
}

/** The F07 server intake (EvidenceIngestionService) — validation, dedupe and product_event insert stay owned by F07. */
export interface F02EvidenceIntake {
  ingest(events: readonly unknown[]): Promise<EvidenceBatchResult>;
}

export interface F02EvidenceOptions {
  readonly intake: F02EvidenceIntake;
  readonly diagnostics: EvidenceIngestionDiagnostics;
  readonly newEventId?: () => string;
  readonly now?: () => Date;
}

/** Evidence envelope trace_id grammar: 32 lowercase hex, never all zeros (the UUID v4 version nibble guarantees it). */
export function newTraceId(): string {
  return randomUUID().replaceAll("-", "");
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
    ...(event.blueprint_hash === undefined ? {} : { blueprint_hash: event.blueprint_hash }),
    properties: event.properties
  };
}

/** F07: evidence delivery is non-blocking — intake rejections or failures are diagnostics, never product-flow errors. */
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
      options.diagnostics.reportNonBlockingFailure(new Error(`F02 evidence rejected by F07 intake: ${codes}`));
    }
  } catch (error: unknown) {
    options.diagnostics.reportNonBlockingFailure(error);
  }
}
