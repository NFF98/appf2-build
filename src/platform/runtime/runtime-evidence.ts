import type { F03ErrorCode } from "./runtime-errors.js";

export type RuntimeStatus = "UNINITIALIZED" | "HYDRATING" | "READY" | "RECOVERABLE_ERROR" | "FATAL_ERROR" | "DISPOSED";
export type IntegrityStatus = "PROVEN" | "UNKNOWN" | "ASSURANCE_DEGRADED" | "CORRUPTED";

/**
 * F03-EVT-001 runtime_hydration_started, -002 runtime_ready, -003 runtime_hydration_failed, -004 action_committed,
 * -005 action_rolled_back, -008 loop_guard_triggered, -010 runtime_fatal.
 */
export type RuntimeEvidenceType = "F03-EVT-001" | "F03-EVT-002" | "F03-EVT-003" | "F03-EVT-004" | "F03-EVT-005" | "F03-EVT-008" | "F03-EVT-010";

/**
 * Privacy-safe F03 trace record using only Evidence Registry envelope fields and the event's allowed
 * properties. No RuntimeOperation exists in this layer, so `operation_status` is omitted, never faked.
 */
export interface RuntimeEvidenceRecord {
  readonly event_type: RuntimeEvidenceType;
  readonly schema_version: "3.0.0";
  readonly function_id: "F03";
  readonly blueprint_hash?: string;
  readonly capability_id?: string;
  readonly error_code?: F03ErrorCode;
  readonly properties: {
    readonly runtime_version: string;
    readonly registry_version: string;
    readonly runtime_status: RuntimeStatus;
    readonly integrity_status?: IntegrityStatus;
  };
}

export interface RuntimeEvidenceSink {
  record(record: RuntimeEvidenceRecord): void;
}

export interface EvidenceDetail {
  readonly runtimeStatus: RuntimeStatus;
  readonly errorCode?: F03ErrorCode;
  readonly capabilityId?: string;
  readonly integrityStatus?: IntegrityStatus;
}

const BLUEPRINT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;

export class RuntimeEvidenceEmitter {
  public constructor(
    private readonly sink: RuntimeEvidenceSink | undefined,
    private readonly versions: { readonly runtime_version: string; readonly registry_version: string },
    private blueprintHash?: string
  ) {}

  public bindBlueprintHash(hash: string): void {
    this.blueprintHash = BLUEPRINT_HASH_PATTERN.test(hash) ? hash : undefined;
  }

  public emit(type: RuntimeEvidenceType, detail: EvidenceDetail): void {
    const record: RuntimeEvidenceRecord = {
      event_type: type,
      schema_version: "3.0.0",
      function_id: "F03",
      ...(this.blueprintHash === undefined ? {} : { blueprint_hash: this.blueprintHash }),
      ...(detail.capabilityId === undefined ? {} : { capability_id: detail.capabilityId }),
      ...(detail.errorCode === undefined ? {} : { error_code: detail.errorCode }),
      properties: {
        ...this.versions,
        runtime_status: detail.runtimeStatus,
        ...(detail.integrityStatus === undefined ? {} : { integrity_status: detail.integrityStatus })
      }
    };
    try {
      this.sink?.record(record);
    } catch {
      // F03 §39: telemetry failure must not block the Runtime path; the sink owns its own diagnostics.
    }
  }
}
