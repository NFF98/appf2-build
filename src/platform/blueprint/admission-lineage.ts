import { canonicalBlueprintBytes } from "./canonical-json.js";
import { hashCanonicalBlueprintBytes } from "./content-identity.js";

/** Durable `blueprint_content` columns needed to prove lineage; trust_status is read, never required to be VALIDATED. */
export interface LineageContentRow {
  readonly content_hash: string;
  readonly canonical_blueprint: unknown;
  readonly schema_version: string;
  readonly registry_version: string;
  readonly trust_status: string;
  readonly admitted_by_validation_run_id: string;
  readonly byte_size: number;
}

export interface LineageRunRow {
  readonly validation_run_id: string;
  readonly candidate_digest: string;
  readonly blueprint_hash: string | null;
  readonly schema_version: string;
  readonly registry_version: string;
  readonly status: string;
  readonly error_codes: unknown;
  readonly report: unknown;
  readonly trace_id: string;
}

export interface AdmissionLineageRecord {
  readonly content: LineageContentRow;
  readonly admitting_run: LineageRunRow | null;
}

/** Read-only port; it never writes blueprint_content or validation_run. */
export interface AdmissionLineageSource {
  readAdmissionLineage(contentHash: string): Promise<AdmissionLineageRecord | undefined>;
}

export type AdmissionLineageFailure =
  | "CONTENT_UNKNOWN"
  | "ADMITTING_RUN_MISSING"
  | "ADMITTING_RUN_NOT_PASSED"
  | "ADMITTING_RUN_HASH_MISMATCH"
  | "ADMITTING_REPORT_MISMATCH"
  | "VERSION_MISMATCH"
  | "BODY_INTEGRITY_FAILURE";

export type AdmissionLineage =
  | {
      readonly verified: true;
      readonly content_hash: string;
      readonly validation_run_id: string;
      readonly candidate_digest: string;
      readonly trace_id: string;
      readonly registry_digest: string;
      readonly trust_status: string;
    }
  | { readonly verified: false; readonly content_hash: string; readonly failure: AdmissionLineageFailure };

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Persisted canonical body still re-hashes to content_hash with its recorded byte_size and version metadata. */
function bodyIntact(content: LineageContentRow, contentHash: string): boolean {
  try {
    const raw = content.canonical_blueprint;
    const body: unknown = typeof raw === "string" ? JSON.parse(raw) : raw;
    const bytes = canonicalBlueprintBytes(body);
    return (
      hashCanonicalBlueprintBytes(bytes) === contentHash &&
      bytes.byteLength === content.byte_size &&
      isRecord(body) &&
      body.schema_version === content.schema_version &&
      body.registry_version === content.registry_version
    );
  } catch {
    return false;
  }
}

function reportMatches(run: LineageRunRow, contentHash: string): boolean {
  const { report } = run;
  return (
    isRecord(report) &&
    report.validation_run_id === run.validation_run_id &&
    report.status === "PASSED" &&
    report.content_hash === contentHash &&
    report.candidate_digest === run.candidate_digest &&
    report.trace_id === run.trace_id &&
    report.schema_version === run.schema_version &&
    report.registry_version === run.registry_version &&
    typeof report.registry_digest === "string" &&
    Array.isArray(report.issues) &&
    report.issues.length === 0
  );
}

function lineageFailure(content: LineageContentRow, run: LineageRunRow | null, contentHash: string): AdmissionLineageFailure | undefined {
  if (run === null || run.validation_run_id !== content.admitted_by_validation_run_id) {
    return "ADMITTING_RUN_MISSING";
  }
  if (run.status !== "PASSED" || !Array.isArray(run.error_codes) || run.error_codes.length > 0) {
    return "ADMITTING_RUN_NOT_PASSED";
  }
  if (content.content_hash !== contentHash || run.blueprint_hash !== contentHash) {
    return "ADMITTING_RUN_HASH_MISMATCH";
  }
  if (!reportMatches(run, contentHash)) {
    return "ADMITTING_REPORT_MISMATCH";
  }
  if (run.schema_version !== content.schema_version || run.registry_version !== content.registry_version) {
    return "VERSION_MISMATCH";
  }
  return bodyIntact(content, contentHash) ? undefined : "BODY_INTEGRITY_FAILURE";
}

/**
 * F02-AC-021: admitted content → its admitting validation_run, re-proven from durable rows only.
 * Independent of trust_status, so REVOKED / INCOMPATIBLE content keeps its original admission lineage.
 */
export async function verifyAdmissionLineage(contentHash: string, source: AdmissionLineageSource): Promise<AdmissionLineage> {
  const record = await source.readAdmissionLineage(contentHash);
  if (record === undefined) {
    return { verified: false, content_hash: contentHash, failure: "CONTENT_UNKNOWN" };
  }
  const { content, admitting_run: run } = record;
  const failure = lineageFailure(content, run, contentHash);
  if (failure !== undefined || run === null) {
    return { verified: false, content_hash: contentHash, failure: failure ?? "ADMITTING_RUN_MISSING" };
  }
  return {
    verified: true,
    content_hash: contentHash,
    validation_run_id: run.validation_run_id,
    candidate_digest: run.candidate_digest,
    trace_id: run.trace_id,
    registry_digest: String((run.report as Readonly<Record<string, unknown>>).registry_digest),
    trust_status: content.trust_status
  };
}
