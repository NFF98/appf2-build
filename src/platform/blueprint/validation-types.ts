export type ValidationStatus = "PASSED" | "REJECTED" | "INCOMPATIBLE";

export type ValidationStage =
  | "V01"
  | "V02"
  | "V03"
  | "V04"
  | "V05"
  | "V06"
  | "V07"
  | "V08"
  | "V12";

export type F02ErrorCode =
  | "F02-ERR-001"
  | "F02-ERR-002"
  | "F02-ERR-003"
  | "F02-ERR-004"
  | "F02-ERR-005"
  | "F02-ERR-006"
  | "F02-ERR-007"
  | "F02-ERR-008"
  | "F02-ERR-009"
  | "F02-ERR-010"
  | "F02-ERR-015";

export type CandidateSource = "COMPOSER" | "RESTORE" | "IMPORT";

export interface ValidationIssue {
  readonly error_code: F02ErrorCode;
  readonly severity: "ERROR";
  readonly stage: ValidationStage;
  readonly json_path: string | null;
  readonly capability_ref: string | null;
  readonly message_key: string;
  readonly retryable: boolean;
  readonly recovery_hint: string;
}

export interface ValidationResourceUsage {
  readonly blueprint_bytes: number | null;
  readonly node_count: number;
  readonly state_count: number;
  readonly rule_count: number;
  readonly action_count: number;
  readonly event_binding_count: number;
  readonly timer_count: number;
}

export interface ValidationReport {
  readonly validation_run_id: string | null;
  readonly candidate_digest: string;
  readonly status: ValidationStatus;
  readonly schema_version: string | null;
  readonly registry_version: string | null;
  readonly content_hash: string | null;
  readonly issues: readonly ValidationIssue[];
  readonly warnings: readonly [];
  readonly resource_usage: ValidationResourceUsage;
  readonly trace_id: string;
}

export interface BlueprintValidationContext {
  readonly candidate_source: CandidateSource;
  readonly trace_id: string;
  readonly compiler_run_id: string | null;
}

export interface ValidationRunRecord {
  readonly validation_run_id: string;
  readonly compiler_run_id: string | null;
  readonly candidate_digest: string;
  readonly blueprint_hash: string;
  readonly schema_version: string;
  readonly registry_version: string;
  readonly status: "PASSED";
  readonly error_codes: readonly string[];
  readonly report: ValidationReport;
  readonly created_at: string;
  readonly trace_id: string;
}

export type BlueprintTrustStatus = "VALIDATED" | "REVOKED" | "INCOMPATIBLE";

export interface BlueprintContentRecord {
  readonly content_hash: string;
  readonly canonical_blueprint: unknown;
  readonly canonical_bytes: Uint8Array;
  readonly schema_version: string;
  readonly registry_version: string;
  readonly trust_status: BlueprintTrustStatus;
  readonly created_at: string;
  readonly admitted_by_validation_run_id: string;
  readonly byte_size: number;
}

export interface BlueprintAdmission {
  readonly run: ValidationRunRecord;
  readonly content: BlueprintContentRecord;
}

export interface BlueprintAdmissionResult {
  readonly reused: boolean;
}

export type BlueprintValidationOutcome =
  | {
      readonly status: "PASSED";
      readonly validation_report: ValidationReport;
      readonly content_hash: string;
      readonly canonical_blueprint: unknown;
    }
  | {
      readonly status: "REJECTED" | "INCOMPATIBLE";
      readonly validation_report: ValidationReport;
    };

const RETRYABLE: Readonly<Record<F02ErrorCode, boolean>> = {
  "F02-ERR-001": false,
  "F02-ERR-002": true,
  "F02-ERR-003": false,
  "F02-ERR-004": true,
  "F02-ERR-005": true,
  "F02-ERR-006": true,
  "F02-ERR-007": true,
  "F02-ERR-008": true,
  "F02-ERR-009": true,
  "F02-ERR-010": true,
  "F02-ERR-015": false
};

export interface ValidationIssueInput {
  readonly error_code: F02ErrorCode;
  readonly stage: ValidationStage;
  readonly json_path: string | null;
  readonly capability_ref: string | null;
  readonly message_key: string;
}

export function validationIssue(input: ValidationIssueInput): ValidationIssue {
  return {
    error_code: input.error_code,
    severity: "ERROR",
    stage: input.stage,
    json_path: input.json_path,
    capability_ref: input.capability_ref,
    message_key: input.message_key,
    retryable: RETRYABLE[input.error_code],
    recovery_hint: input.message_key
  };
}

export class IssueCollector {
  private readonly issues: ValidationIssue[] = [];

  add(input: ValidationIssueInput): void {
    this.issues.push(validationIssue(input));
  }

  get list(): readonly ValidationIssue[] {
    return this.issues;
  }

  get failed(): boolean {
    return this.issues.length > 0;
  }
}
