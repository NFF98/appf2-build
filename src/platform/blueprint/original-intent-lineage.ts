import { bodyIntact, reportMatches, type AdmissionLineageFailure, type LineageContentRow, type LineageRunRow } from "./admission-lineage.js";
import { canonicalBlueprintBytes } from "./canonical-json.js";
import type { ExecutionContentSource, StoredBlueprintContent } from "./execution-admission.js";
import type { PostgresExecutor } from "./postgres-blueprint-repository.js";

/**
 * EXECUTION-ADMISSION §8.1 original-Intent read under PG-001 RLS, for a content hash that may have been admitted by
 * another Intent first. Run as the Worker with the verified request context (`app.intent_id`, `app.anonymous_id`):
 *   own_*      = (A) this Intent's own PASSED validation_run for the hash, visible only through Worker RLS;
 *   original_* = (B) verdict + pinned registry_digest of the FIRST admitting run from
 *                `appf2_original_admission_integrity`, which returns no row unless (A) holds for the same context.
 * blueprint_content itself is visible only through `appf2_original_intent_lineage` (unchanged).
 */
export const POSTGRES_READ_ORIGINAL_INTENT_LINEAGE_SQL = `
WITH own_run AS (
  SELECT
    v.validation_run_id,
    v.candidate_digest,
    v.blueprint_hash,
    v.schema_version,
    v.registry_version,
    v.status,
    v.error_codes,
    v.report,
    v.trace_id
  FROM public.validation_run AS v
  JOIN public.compiler_run AS c ON c.compiler_run_id = v.compiler_run_id
  WHERE v.blueprint_hash = $1::text
    AND v.status = 'PASSED'
    AND c.intent_id = NULLIF(current_setting('app.intent_id', true), '')::uuid
  ORDER BY v.created_at DESC, v.validation_run_id
  LIMIT 1
)
SELECT
  content.content_hash,
  content.canonical_blueprint,
  content.schema_version,
  content.registry_version,
  content.trust_status,
  content.admitted_by_validation_run_id,
  content.byte_size,
  own_run.validation_run_id AS own_validation_run_id,
  own_run.candidate_digest AS own_candidate_digest,
  own_run.blueprint_hash AS own_blueprint_hash,
  own_run.schema_version AS own_schema_version,
  own_run.registry_version AS own_registry_version,
  own_run.status AS own_status,
  own_run.error_codes AS own_error_codes,
  own_run.report AS own_report,
  own_run.trace_id AS own_trace_id,
  original.verdict AS original_verdict,
  original.registry_digest AS original_registry_digest
FROM public.blueprint_content AS content
LEFT JOIN own_run ON true
LEFT JOIN LATERAL public.appf2_original_admission_integrity(content.content_hash) AS original ON true
WHERE content.content_hash = $1::text
`.trim();

interface OriginalIntentLineageRow extends LineageContentRow {
  readonly own_validation_run_id: string | null;
  readonly own_candidate_digest: string;
  readonly own_blueprint_hash: string | null;
  readonly own_schema_version: string;
  readonly own_registry_version: string;
  readonly own_status: string;
  readonly own_error_codes: unknown;
  readonly own_report: unknown;
  readonly own_trace_id: string;
  readonly original_verdict: string | null;
  readonly original_registry_digest: string | null;
}

export type OriginalIntentLineageFailure = AdmissionLineageFailure | "OWN_LINEAGE_MISSING" | "OWN_RUN_MISMATCH";

export type OriginalIntentLineage =
  | {
      readonly verified: true;
      readonly content_hash: string;
      readonly own_validation_run_id: string;
      readonly registry_digest: string;
      readonly trust_status: string;
    }
  | { readonly verified: false; readonly content_hash: string; readonly failure: OriginalIntentLineageFailure };

const ORIGINAL_FAILURES: ReadonlySet<string> = new Set<AdmissionLineageFailure>([
  "ADMITTING_RUN_MISSING",
  "ADMITTING_RUN_NOT_PASSED",
  "ADMITTING_RUN_HASH_MISMATCH",
  "ADMITTING_REPORT_MISMATCH",
  "VERSION_MISMATCH"
]);

function ownRun(row: OriginalIntentLineageRow): LineageRunRow | null {
  if (row.own_validation_run_id === null) return null;
  return {
    validation_run_id: row.own_validation_run_id,
    candidate_digest: row.own_candidate_digest,
    blueprint_hash: row.own_blueprint_hash,
    schema_version: row.own_schema_version,
    registry_version: row.own_registry_version,
    status: row.own_status,
    error_codes: row.own_error_codes,
    report: row.own_report,
    trace_id: row.own_trace_id
  };
}

function ownRunIntact(run: LineageRunRow, content: LineageContentRow, contentHash: string): boolean {
  return (
    run.status === "PASSED" &&
    Array.isArray(run.error_codes) &&
    run.error_codes.length === 0 &&
    run.blueprint_hash === contentHash &&
    reportMatches(run, contentHash) &&
    run.schema_version === content.schema_version &&
    run.registry_version === content.registry_version
  );
}

function originalFailure(row: OriginalIntentLineageRow): OriginalIntentLineageFailure | undefined {
  if (row.original_verdict === null) return "OWN_LINEAGE_MISSING";
  if (row.original_verdict === "VERIFIED") return row.original_registry_digest === null ? "ADMITTING_REPORT_MISMATCH" : undefined;
  return ORIGINAL_FAILURES.has(row.original_verdict) ? (row.original_verdict as AdmissionLineageFailure) : "ADMITTING_REPORT_MISMATCH";
}

function judge(row: OriginalIntentLineageRow, contentHash: string): OriginalIntentLineage {
  const deny = (failure: OriginalIntentLineageFailure): OriginalIntentLineage => ({ verified: false, content_hash: contentHash, failure });
  const run = ownRun(row);
  if (run === null) return deny("OWN_LINEAGE_MISSING");
  if (row.content_hash !== contentHash || !ownRunIntact(run, row, contentHash)) return deny("OWN_RUN_MISMATCH");
  const original = originalFailure(row);
  if (original !== undefined) return deny(original);
  if (!bodyIntact(row, contentHash)) return deny("BODY_INTEGRITY_FAILURE");
  return {
    verified: true,
    content_hash: contentHash,
    own_validation_run_id: run.validation_run_id,
    registry_digest: row.original_registry_digest as string,
    trust_status: row.trust_status
  };
}

export type CanonicalBlueprintBodyRead = { readonly kind: "FOUND"; readonly bytes: Uint8Array } | { readonly kind: "NOT_ADMITTED" };

/** Selects no pinned release, so fresh execution admission denies at E06 when (A) or (B) cannot be re-proven. */
const UNPROVEN_ADMITTED_REGISTRY_DIGEST = "";

/**
 * Original-Intent read port (body delivery + ExecutionContentSource) over one RLS-scoped query. Trust status is
 * reported, never required: trust gating stays with execution admission / the read route. Database errors propagate
 * so callers map them to 503 / E08, never to an allow.
 */
export class PostgresOriginalIntentReadRepository implements ExecutionContentSource {
  public constructor(private readonly executor: PostgresExecutor) {}

  private async read(contentHash: string): Promise<{ row: OriginalIntentLineageRow; lineage: OriginalIntentLineage } | undefined> {
    const [row] = (await this.executor.query<OriginalIntentLineageRow>(POSTGRES_READ_ORIGINAL_INTENT_LINEAGE_SQL, [contentHash])).rows;
    return row === undefined ? undefined : { row, lineage: judge(row, contentHash) };
  }

  public async verifyLineage(contentHash: string): Promise<OriginalIntentLineage> {
    const read = await this.read(contentHash);
    return read?.lineage ?? { verified: false, content_hash: contentHash, failure: "CONTENT_UNKNOWN" };
  }

  public async readCanonicalBody(contentHash: string): Promise<CanonicalBlueprintBodyRead> {
    const read = await this.read(contentHash);
    if (read === undefined || !read.lineage.verified) return { kind: "NOT_ADMITTED" };
    const raw = read.row.canonical_blueprint;
    return { kind: "FOUND", bytes: canonicalBlueprintBytes(typeof raw === "string" ? JSON.parse(raw) : raw) };
  }

  /** Body integrity failures keep the stored row with the verified digest so admission reports E04-B itself. */
  public async readContent(contentHash: string): Promise<StoredBlueprintContent | undefined> {
    const read = await this.read(contentHash);
    if (read === undefined) return undefined;
    const { row, lineage } = read;
    const bodyOnly = !lineage.verified && lineage.failure === "BODY_INTEGRITY_FAILURE";
    const digest = lineage.verified || bodyOnly ? (row.original_registry_digest ?? UNPROVEN_ADMITTED_REGISTRY_DIGEST) : UNPROVEN_ADMITTED_REGISTRY_DIGEST;
    return {
      content_hash: row.content_hash,
      canonical_blueprint: row.canonical_blueprint,
      schema_version: row.schema_version,
      registry_version: row.registry_version,
      trust_status: row.trust_status,
      admitted_registry_digest: digest
    };
  }
}
