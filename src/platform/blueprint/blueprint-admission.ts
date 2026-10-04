import { emitF02Evidence, type F02EvidenceEvent, type F02EvidenceOptions } from "./validation-evidence.js";
import { isIssuedValidationReport, isSealedPassedResult } from "./validate-blueprint.js";
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
  /** Server-side F02 validation evidence; omitted means no evidence emission. */
  readonly evidence?: F02EvidenceOptions;
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
  return Object.freeze({
    validation_run_id: report.validation_run_id,
    candidate_digest: report.candidate_digest,
    status: "REJECTED",
    schema_version: report.schema_version,
    registry_version: report.registry_version,
    registry_digest: report.registry_digest,
    issues: Object.freeze([Object.freeze({ error_code: "F02-ERR-015", stage: "V12", json_path: "$" } as const)]),
    trace_id: report.trace_id
  });
}

/** One terminal validation event per durable validation_run row, derived only from that row's trusted report. */
function validationOutcomeEvent(report: ValidationReport): F02EvidenceEvent {
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

function contentEvent(eventType: "F02-EVT-007" | "F02-EVT-009", report: ValidationReport, contentHash: string): F02EvidenceEvent {
  const admitted = eventType === "F02-EVT-007";
  return {
    event_type: eventType,
    trace_id: report.trace_id,
    ...(admitted ? { blueprint_hash: contentHash } : { error_code: "F02-ERR-015" }),
    properties: {
      content_hash: contentHash,
      blueprint_schema_version: report.schema_version,
      registry_version: report.registry_version,
      validation_stage: "V12"
    }
  };
}

export async function admitBlueprint(
  result: BlueprintValidationResult,
  repository: BlueprintAdmissionRepository,
  options: BlueprintAdmissionOptions = {}
): Promise<BlueprintAdmissionResult> {
  // The caller-owned result may be an accessor/Proxy: read it exactly once and never touch it again.
  const { report, admissible } = result;
  const createdAt = (options.now?.() ?? new Date()).toISOString();
  const compilerRunId = options.compilerRunId ?? null;
  if (admissible === undefined) {
    // Identity check first: a Proxy/copy never matches, and an issued report is deep-frozen so status cannot drift.
    // The static union says non-PASSED here, but the caller-owned value is untrusted at runtime.
    if (!isIssuedValidationReport(report) || (report as ValidationReport).status === "PASSED") {
      throw new Error("Only a validator-issued REJECTED or INCOMPATIBLE result can record validation_run evidence.");
    }
    await repository.recordValidationRun(runRecord(report, createdAt, compilerRunId));
    await emitF02Evidence(options.evidence, [validationOutcomeEvent(report)]);
    return { status: "NOT_ADMITTED", report };
  }
  if (!isSealedPassedResult(report, admissible)) {
    throw new Error("Only a validator-issued PASSED result can admit Blueprint content.");
  }
  const run = runRecord(report, createdAt, compilerRunId);
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
    const failure = integrityFailureReport(report);
    await repository.recordValidationRun(runRecord(failure, createdAt, compilerRunId));
    await emitF02Evidence(options.evidence, [
      validationOutcomeEvent(failure),
      contentEvent("F02-EVT-009", failure, admissible.contentHash)
    ]);
    return { status: "NOT_ADMITTED", report: failure };
  }
  // blueprint_admitted marks the one insert of a blueprint_content row; same-hash reuse keeps the existing trust_status.
  await emitF02Evidence(
    options.evidence,
    outcome.kind === "INSERTED"
      ? [validationOutcomeEvent(report), contentEvent("F02-EVT-007", report, admissible.contentHash)]
      : [validationOutcomeEvent(report)]
  );
  return {
    status: "ADMITTED",
    validationRunId: run.validation_run_id,
    contentHash: admissible.contentHash,
    reused: outcome.kind === "REUSED",
    trustStatus: outcome.kind === "REUSED" ? outcome.trustStatus : "VALIDATED"
  };
}
