export interface EvidenceEventInput {
  readonly event_id: string;
  readonly event_type: string;
  readonly schema_version: string;
  readonly occurred_at: string;
  readonly anonymous_id?: string | null;
  readonly session_id?: string | null;
  readonly function_id: string;
  readonly intent_id?: string | null;
  readonly blueprint_hash?: string | null;
  readonly share_id?: string | null;
  readonly capability_id?: string | null;
  readonly error_code?: string | null;
  readonly policy_rule_id?: string | null;
  readonly trace_id?: string | null;
  readonly properties?: Readonly<Record<string, unknown>> | null;
}

export interface EvidenceBatchInput {
  readonly batch_id: string;
  readonly events: readonly unknown[];
}

export type EvidenceRejectionCode =
  | "F07-ERR-001"
  | "F07-ERR-002"
  | "F07-ERR-003"
  | "F07-ERR-004"
  | "F07-ERR-005"
  | "F07-ERR-006"
  | "F07-ERR-007"
  | "F07-ERR-010"
  | "F07-ERR-014"
  | "F07-ERR-016";

export interface EvidenceRejection {
  readonly event_id: string | null;
  readonly code: EvidenceRejectionCode;
  readonly field: string | null;
}

export type EventValidationResult =
  | {
      readonly accepted: true;
      readonly event: EvidenceEventInput;
    }
  | {
      readonly accepted: false;
      readonly rejection: EvidenceRejection;
    };

export type EvidenceWriteResult =
  | "INSERTED"
  | "DUPLICATE"
  | "IDENTITY_DISABLED";

export type EvidenceDiagnosticCode = "F07-ERR-013";
export type EvidenceDiagnosticAction = "USE_RECEIVED_AT";

export interface EvidenceIntakeDiagnostic {
  readonly event_id: string;
  readonly code: EvidenceDiagnosticCode;
  readonly field: string;
  readonly action: EvidenceDiagnosticAction;
}

export interface EvidenceBatchResult {
  readonly accepted: number;
  readonly duplicates: number;
  readonly rejected: number;
  readonly rejections: readonly EvidenceRejection[];
  readonly diagnostics: readonly EvidenceIntakeDiagnostic[];
}

export interface EvidenceEventTimeProjection {
  readonly event_id: string;
  readonly occurred_at: string;
  readonly received_at: string;
  readonly effective_event_at: string;
}
