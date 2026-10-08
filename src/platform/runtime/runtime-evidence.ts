import type { F03ErrorCode } from "./runtime-errors.js";
import type { IntegrityStatus } from "./runtime-integrity.js";
import type { DiscardReason, OperationStatus, RuntimeOperation } from "./runtime-operation.js";

export type { IntegrityStatus } from "./runtime-integrity.js";
export type RuntimeStatus = "UNINITIALIZED" | "HYDRATING" | "READY" | "RECOVERABLE_ERROR" | "FATAL_ERROR" | "DISPOSED";

/**
 * Instance-level events: F03-EVT-001 runtime_hydration_started, -002 runtime_ready, -003 runtime_hydration_failed,
 * -004 action_committed, -005 action_rolled_back, -007 capability_runtime_failed, -008 loop_guard_triggered,
 * -010 runtime_fatal.
 */
export type InstanceEvidenceType =
  | "F03-EVT-001"
  | "F03-EVT-002"
  | "F03-EVT-003"
  | "F03-EVT-004"
  | "F03-EVT-005"
  | "F03-EVT-007"
  | "F03-EVT-008"
  | "F03-EVT-010";

/**
 * RuntimeOperation events: F03-EVT-011 runtime_operation_started, -012 runtime_checkpoint_completed,
 * -013 runtime_soft_timeout_observed, -014 runtime_operation_timed_out, -015 runtime_stale_completion_discarded,
 * -016 runtime_safe_state_restored.
 */
export type OperationEvidenceType = "F03-EVT-011" | "F03-EVT-012" | "F03-EVT-013" | "F03-EVT-014" | "F03-EVT-015" | "F03-EVT-016";
export type RuntimeEvidenceType = InstanceEvidenceType | OperationEvidenceType;

/**
 * Union of the F03 allowed properties. Each emitted record carries only the subset its event allows; instance events
 * never carry `operation_status`, so runtime_status and operation_status stay separate (F03-AC-037).
 */
export interface RuntimeEvidenceProperties {
  readonly runtime_status: RuntimeStatus;
  readonly runtime_version?: string;
  readonly registry_version?: string;
  readonly integrity_status?: IntegrityStatus;
  readonly operation_status?: OperationStatus;
  readonly operation_token?: string;
  readonly instance_session_id?: string;
  readonly instance_epoch?: number;
  readonly planned_checkpoint_count?: number;
  readonly checkpoint_id?: string;
  readonly completed_checkpoint_count?: number;
  readonly progress_percent?: number;
  readonly last_completed_checkpoint_id?: string;
  readonly discard_reason?: DiscardReason;
  readonly safe_surface?: "APP_CURRENT";
  readonly recovery_episode_id?: string;
}

/** Privacy-safe F03 trace record using only Evidence Registry envelope fields and the event's allowed properties. */
export interface RuntimeEvidenceRecord {
  readonly event_type: RuntimeEvidenceType;
  readonly schema_version: "3.0.0";
  readonly function_id: "F03";
  readonly blueprint_hash?: string;
  readonly capability_id?: string;
  readonly error_code?: F03ErrorCode;
  readonly properties: RuntimeEvidenceProperties;
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

export type OperationEvidence =
  | { readonly type: "F03-EVT-011" }
  | { readonly type: "F03-EVT-012"; readonly checkpointId: string }
  | { readonly type: "F03-EVT-013" }
  | { readonly type: "F03-EVT-014" }
  | { readonly type: "F03-EVT-015"; readonly discardReason: DiscardReason }
  | { readonly type: "F03-EVT-016" };

export interface OperationEvidenceContext {
  readonly runtimeStatus: RuntimeStatus;
  readonly instanceSessionId: string;
}

export interface EmitterOptions {
  /** F07 PRODUCT_SAMPLE events (EVT-011 / EVT-012) are emitted only when the host's sampling decision admits them. */
  readonly productSampled?: boolean;
}

const BLUEPRINT_HASH_PATTERN = /^sha256:[0-9a-f]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function progressOf(operation: RuntimeOperation): { readonly progress_percent?: number } {
  const percent = operation.handle.projection().progress_percent;
  return percent === undefined ? {} : { progress_percent: percent };
}

function operationSpecific(evidence: OperationEvidence, operation: RuntimeOperation): Partial<RuntimeEvidenceProperties> {
  const planned = operation.checkpointPlan?.length;
  switch (evidence.type) {
    case "F03-EVT-011":
      return planned === undefined ? {} : { planned_checkpoint_count: planned };
    case "F03-EVT-012": {
      const projection = operation.handle.projection();
      return { checkpoint_id: evidence.checkpointId, completed_checkpoint_count: projection.completed_checkpoints, ...(planned === undefined ? {} : { planned_checkpoint_count: planned }), ...progressOf(operation) };
    }
    case "F03-EVT-013": {
      const last = operation.lastCompletedCheckpoint;
      return { ...(last === undefined ? {} : { last_completed_checkpoint_id: last }), ...progressOf(operation) };
    }
    case "F03-EVT-014":
      return { integrity_status: "PROVEN" };
    case "F03-EVT-015":
      return { discard_reason: evidence.discardReason };
    case "F03-EVT-016": {
      const episode = operation.recoveryEpisodeId;
      return { safe_surface: "APP_CURRENT", ...(episode !== undefined && UUID_PATTERN.test(episode) ? { recovery_episode_id: episode } : {}) };
    }
  }
}

export class RuntimeEvidenceEmitter {
  private readonly productSampled: boolean;
  private blueprintHash: string | undefined;

  public constructor(
    private readonly sink: RuntimeEvidenceSink | undefined,
    private readonly versions: { readonly runtime_version: string; readonly registry_version: string },
    options: EmitterOptions = {}
  ) {
    this.productSampled = options.productSampled ?? false;
  }

  public bindBlueprintHash(hash: string): void {
    this.blueprintHash = BLUEPRINT_HASH_PATTERN.test(hash) ? hash : undefined;
  }

  public emit(type: InstanceEvidenceType, detail: EvidenceDetail): void {
    this.record(type, detail, {
      ...this.versions,
      runtime_status: detail.runtimeStatus,
      ...(detail.integrityStatus === undefined ? {} : { integrity_status: detail.integrityStatus })
    });
  }

  public emitOperation(evidence: OperationEvidence, operation: RuntimeOperation, context: OperationEvidenceContext): void {
    if ((evidence.type === "F03-EVT-011" || evidence.type === "F03-EVT-012") && !this.productSampled) {
      return;
    }
    const errorCode: F03ErrorCode | undefined = evidence.type === "F03-EVT-014" ? "F03-ERR-021" : undefined;
    this.record(
      evidence.type,
      { runtimeStatus: context.runtimeStatus, errorCode },
      {
        operation_token: operation.token,
        instance_session_id: context.instanceSessionId,
        instance_epoch: operation.instanceEpoch,
        runtime_status: context.runtimeStatus,
        operation_status: operation.status,
        ...operationSpecific(evidence, operation)
      }
    );
  }

  private record(type: RuntimeEvidenceType, detail: EvidenceDetail, properties: RuntimeEvidenceProperties): void {
    const record: RuntimeEvidenceRecord = {
      event_type: type,
      schema_version: "3.0.0",
      function_id: "F03",
      ...(this.blueprintHash === undefined ? {} : { blueprint_hash: this.blueprintHash }),
      ...(detail.capabilityId === undefined ? {} : { capability_id: detail.capabilityId }),
      ...(detail.errorCode === undefined ? {} : { error_code: detail.errorCode }),
      properties
    };
    try {
      this.sink?.record(record);
    } catch {
      // F03 §39: telemetry failure must not block the Runtime path; the sink owns its own diagnostics.
    }
  }
}
