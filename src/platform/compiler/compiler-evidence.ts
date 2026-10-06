import { randomUUID } from "node:crypto";

import type { F02EvidenceIntake } from "../blueprint/validation-evidence.js";
import type { CoverageStatus } from "../capabilities/coverage.js";
import { lockedEvidenceRegistry } from "../evidence/evidence-registry.js";
import type { EvidenceIngestionDiagnostics } from "../evidence/evidence-repository.js";
import type { EvidenceEventInput } from "../evidence/evidence-types.js";
import type { IntentKind } from "./compiler-records.js";
import type { F01ErrorCode } from "./f01-errors.js";

export type F01EvidenceEventType =
  | "F01-EVT-001"
  | "F01-EVT-002"
  | "F01-EVT-003"
  | "F01-EVT-004"
  | "F01-EVT-005"
  | "F01-EVT-006"
  | "F01-EVT-007"
  | "F01-EVT-008"
  | "F01-EVT-009"
  | "F01-EVT-010"
  | "F01-EVT-011"
  | "F01-EVT-012"
  | "F01-EVT-013"
  | "F01-EVT-014";

/**
 * Only the F01 Registry `allowed_properties`. Raw Intent, structured / resolved payloads, raw model response,
 * token usage / cost (compiler_run owns economics) and triggered_rule_ids have no slot by construction.
 */
export type F01EvidenceProperties = {
  readonly intent_kind: IntentKind;
  readonly policy_version?: string;
  readonly prompt_version?: string;
  readonly blueprint_schema_version?: string;
  readonly registry_version?: string;
  readonly model_adapter?: string;
  readonly attempt_no?: number;
  readonly latency_ms?: number;
  readonly coverage_status?: CoverageStatus;
};

export interface F01EvidenceEvent {
  readonly event_type: F01EvidenceEventType;
  readonly intent_id: string;
  readonly trace_id: string;
  readonly error_code?: F01ErrorCode;
  readonly properties: F01EvidenceProperties;
}

export interface F01EvidenceOptions {
  readonly intake: F02EvidenceIntake;
  readonly diagnostics: EvidenceIngestionDiagnostics;
  readonly newEventId?: () => string;
  readonly now?: () => Date;
}

/** anonymous_id is deliberately omitted: server F01 events must not create identity linkage side effects. */
function envelope(event: F01EvidenceEvent, eventId: string, occurredAt: string): EvidenceEventInput {
  const entry = lockedEvidenceRegistry.find(event.event_type);
  if (entry === undefined) throw new Error(`F01 evidence event ${event.event_type} is not registered.`);
  return {
    event_id: eventId,
    event_type: event.event_type,
    schema_version: entry.schemaVersion,
    occurred_at: occurredAt,
    function_id: "F01",
    intent_id: event.intent_id,
    trace_id: event.trace_id,
    ...(event.error_code === undefined ? {} : { error_code: event.error_code }),
    properties: event.properties
  };
}

function reportDiagnostic(diagnostics: EvidenceIngestionDiagnostics, error: unknown): void {
  try {
    diagnostics.reportNonBlockingFailure(error);
  } catch {
    // A failing diagnostics sink must never turn committed F01 truth into a caller-visible failure.
  }
}

/** F07: Evidence delivery is non-blocking; rejections / failures become diagnostics, never product-flow errors. */
export async function emitF01Evidence(options: F01EvidenceOptions | undefined, events: readonly F01EvidenceEvent[]): Promise<void> {
  if (options === undefined || events.length === 0) return;
  try {
    const occurredAt = (options.now?.() ?? new Date()).toISOString();
    const newEventId = options.newEventId ?? randomUUID;
    const result = await options.intake.ingest(events.map((event) => envelope(event, newEventId(), occurredAt)));
    if (result.rejected > 0) {
      const codes = result.rejections.map((rejection) => `${rejection.code}:${rejection.field ?? "-"}`).join(", ");
      reportDiagnostic(options.diagnostics, new Error(`F01 evidence rejected by F07 intake: ${codes}`));
    }
  } catch (error: unknown) {
    reportDiagnostic(options.diagnostics, error);
  }
}

/** Registry `attempt_no` maximum; a larger durable compiler_run attempt number is simply not reported. */
const MAX_EVIDENCE_ATTEMPT_NO = 255;

/** Collects one request's events and flushes them once after durable truth is committed. */
export class F01EvidenceBuffer {
  private readonly events: F01EvidenceEvent[] = [];

  public constructor(
    private readonly base: { readonly intent_id: string; readonly trace_id: string; readonly intent_kind: IntentKind }
  ) {}

  public add(eventType: F01EvidenceEventType, properties: Omit<F01EvidenceProperties, "intent_kind"> = {}, errorCode?: F01ErrorCode): void {
    const { attempt_no: attemptNo, ...rest } = properties;
    this.events.push({
      event_type: eventType,
      intent_id: this.base.intent_id,
      trace_id: this.base.trace_id,
      ...(errorCode === undefined ? {} : { error_code: errorCode }),
      properties: {
        intent_kind: this.base.intent_kind,
        ...rest,
        ...(attemptNo !== undefined && attemptNo <= MAX_EVIDENCE_ATTEMPT_NO ? { attempt_no: attemptNo } : {})
      }
    });
  }

  public drain(): readonly F01EvidenceEvent[] {
    return this.events.splice(0, this.events.length);
  }
}
