import { isSealedPassedResult } from "./admissible-provenance.js";
import type {
  BlueprintValidationResult,
  F02ErrorCode,
  ValidationReport,
  ValidationStatus
} from "./validation-types.js";

export type BlueprintTrustStatus = "VALIDATED" | "REVOKED" | "INCOMPATIBLE";

export interface ValidationRunRecord {
  readonly validation_run_id: string;
  readonly compiler_run_id: string | null;
  readonly candidate_digest: string;
  readonly blueprint_hash: string | null;
  readonly schema_version: string;
  readonly registry_version: string;
  readonly status: ValidationStatus;
  readonly error_codes: readonly F02ErrorCode[];
  readonly report: ValidationReport;
  readonly created_at: string;
  readonly trace_id: string;
}

export interface BlueprintContentRecord {
  readonly content_hash: string;
  readonly canonical_blueprint: string;
  readonly schema_version: string;
  readonly registry_version: string;
  readonly trust_status: "VALIDATED";
  readonly created_at: string;
  readonly admitted_by_validation_run_id: string;
  readonly byte_size: number;
}

export type ContentAdmissionOutcome =
  | { readonly kind: "INSERTED" }
  | { readonly kind: "REUSED"; readonly trustStatus: BlueprintTrustStatus }
  | { readonly kind: "HASH_INTEGRITY_FAILURE" };

export interface BlueprintAdmissionRepository {
  recordValidationRun(run: ValidationRunRecord): Promise<void>;
  admitValidatedContent(run: ValidationRunRecord, content: BlueprintContentRecord): Promise<ContentAdmissionOutcome>;
}

export interface BlueprintAdmissionOptions {
  readonly compilerRunId?: string | null;
  readonly now?: () => Date;
}

export type BlueprintAdmissionResult =
  | {
      readonly status: "ADMITTED";
      readonly validationRunId: string;
      readonly contentHash: string;
      readonly reused: boolean;
      readonly trustStatus: BlueprintTrustStatus;
    }
  | { readonly status: "NOT_ADMITTED"; readonly report: ValidationReport };

function runRecord(
  report: ValidationReport,
  createdAt: string,
  compilerRunId: string | null
): ValidationRunRecord {
  return {
    validation_run_id: report.validation_run_id,
    compiler_run_id: compilerRunId,
    candidate_digest: report.candidate_digest,
    blueprint_hash: report.status === "PASSED" ? (report.content_hash ?? null) : null,
    schema_version: report.schema_version,
    registry_version: report.registry_version,
    status: report.status,
    error_codes: report.issues.map((issue) => issue.error_code),
    report,
    created_at: createdAt,
    trace_id: report.trace_id
  };
}

function integrityFailureReport(report: ValidationReport): ValidationReport {
  return {
    validation_run_id: report.validation_run_id,
    candidate_digest: report.candidate_digest,
    status: "REJECTED",
    schema_version: report.schema_version,
    registry_version: report.registry_version,
    registry_digest: report.registry_digest,
    issues: [{ error_code: "F02-ERR-015", stage: "V12", json_path: "$" }],
    trace_id: report.trace_id
  };
}

export async function admitBlueprint(
  result: BlueprintValidationResult,
  repository: BlueprintAdmissionRepository,
  options: BlueprintAdmissionOptions = {}
): Promise<BlueprintAdmissionResult> {
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const compilerRunId = options.compilerRunId ?? null;
  if (result.admissible === undefined) {
    await repository.recordValidationRun(runRecord(result.report, createdAt, compilerRunId));
    return { status: "NOT_ADMITTED", report: result.report };
  }
  if (!isSealedPassedResult(result.report, result.admissible)) {
    throw new Error("Only a validator-issued PASSED result can admit Blueprint content.");
  }
  const run = runRecord(result.report, createdAt, compilerRunId);
  const { admissible } = result;
  const outcome = await repository.admitValidatedContent(run, {
    content_hash: admissible.contentHash,
    canonical_blueprint: admissible.canonicalJson,
    schema_version: admissible.blueprint.schema_version,
    registry_version: admissible.blueprint.registry_version,
    trust_status: "VALIDATED",
    created_at: createdAt,
    admitted_by_validation_run_id: run.validation_run_id,
    byte_size: admissible.byteSize
  });
  if (outcome.kind === "HASH_INTEGRITY_FAILURE") {
    const report = integrityFailureReport(result.report);
    await repository.recordValidationRun(runRecord(report, createdAt, compilerRunId));
    return { status: "NOT_ADMITTED", report };
  }
  return {
    status: "ADMITTED",
    validationRunId: run.validation_run_id,
    contentHash: admissible.contentHash,
    reused: outcome.kind === "REUSED",
    trustStatus: outcome.kind === "REUSED" ? outcome.trustStatus : "VALIDATED"
  };
}
