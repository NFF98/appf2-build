import type { AdmissionLineageRecord, AdmissionLineageSource, LineageContentRow } from "./admission-lineage.js";
import type {
  BlueprintAdmissionRepository,
  BlueprintContentRecord,
  BlueprintTrustStatus,
  ContentAdmissionOutcome,
  ValidationRunRecord
} from "./blueprint-admission.js";

export interface PostgresQueryResult<Row> {
  readonly rows: readonly Row[];
}

export interface PostgresExecutor {
  query<Row>(statement: string, parameters: readonly unknown[]): Promise<PostgresQueryResult<Row>>;
}

const VALIDATION_RUN_COLUMNS = `
    validation_run_id,
    compiler_run_id,
    candidate_digest,
    blueprint_hash,
    schema_version,
    registry_version,
    status,
    error_codes,
    report,
    created_at,
    trace_id`;

const VALIDATION_RUN_VALUES = `
    $1::uuid,
    $2::uuid,
    $3::text,
    $4::text,
    $5::text,
    $6::text,
    $7::text,
    $8::jsonb,
    $9::jsonb,
    $10::timestamptz,
    $11::text`;

export const POSTGRES_INSERT_VALIDATION_RUN_SQL = `
INSERT INTO public.validation_run (${VALIDATION_RUN_COLUMNS}
)
VALUES (${VALIDATION_RUN_VALUES}
)
`.trim();

export const POSTGRES_ADMIT_BLUEPRINT_CONTENT_SQL = `
WITH content AS (
  INSERT INTO public.blueprint_content (
    content_hash,
    canonical_blueprint,
    schema_version,
    registry_version,
    trust_status,
    created_at,
    admitted_by_validation_run_id,
    byte_size
  )
  VALUES (
    $4::text,
    $12::jsonb,
    $13::text,
    $14::text,
    'VALIDATED',
    $10::timestamptz,
    $1::uuid,
    $15::integer
  )
  ON CONFLICT (content_hash) DO UPDATE
    SET trust_status = public.blueprint_content.trust_status
  RETURNING
    admitted_by_validation_run_id = $1::uuid AS inserted,
    canonical_blueprint = $12::jsonb AND byte_size = $15::integer AS body_matches,
    trust_status
),
run AS (
  INSERT INTO public.validation_run (${VALIDATION_RUN_COLUMNS}
  )
  SELECT ${VALIDATION_RUN_VALUES}
  FROM content
  WHERE content.body_matches
  RETURNING validation_run_id
)
SELECT
  content.inserted,
  content.body_matches,
  content.trust_status,
  EXISTS (SELECT 1 FROM run) AS run_recorded
FROM content
`.trim();

export const POSTGRES_READ_ADMISSION_LINEAGE_SQL = `
SELECT
  content.content_hash,
  content.canonical_blueprint,
  content.schema_version,
  content.registry_version,
  content.trust_status,
  content.admitted_by_validation_run_id,
  content.byte_size,
  run.validation_run_id AS run_validation_run_id,
  run.candidate_digest AS run_candidate_digest,
  run.blueprint_hash AS run_blueprint_hash,
  run.schema_version AS run_schema_version,
  run.registry_version AS run_registry_version,
  run.status AS run_status,
  run.error_codes AS run_error_codes,
  run.report AS run_report,
  run.trace_id AS run_trace_id
FROM public.blueprint_content AS content
LEFT JOIN public.validation_run AS run
  ON run.validation_run_id = content.admitted_by_validation_run_id
WHERE content.content_hash = $1::text
`.trim();

export interface AdmissionLineageRow extends LineageContentRow {
  readonly run_validation_run_id: string | null;
  readonly run_candidate_digest: string | null;
  readonly run_blueprint_hash: string | null;
  readonly run_schema_version: string | null;
  readonly run_registry_version: string | null;
  readonly run_status: string | null;
  readonly run_error_codes: unknown;
  readonly run_report: unknown;
  readonly run_trace_id: string | null;
}

interface AdmissionRow {
  readonly inserted: boolean;
  readonly body_matches: boolean;
  readonly trust_status: BlueprintTrustStatus;
  readonly run_recorded: boolean;
}

function validationRunParameters(run: ValidationRunRecord): unknown[] {
  return [
    run.validation_run_id,
    run.compiler_run_id,
    run.candidate_digest,
    run.blueprint_hash,
    run.schema_version,
    run.registry_version,
    run.status,
    JSON.stringify(run.error_codes),
    JSON.stringify(run.report),
    run.created_at,
    run.trace_id
  ];
}

export class PostgresBlueprintAdmissionRepository implements BlueprintAdmissionRepository {
  public constructor(private readonly executor: PostgresExecutor) {}

  public async recordValidationRun(run: ValidationRunRecord): Promise<void> {
    await this.executor.query(POSTGRES_INSERT_VALIDATION_RUN_SQL, validationRunParameters(run));
  }

  public async admitValidatedContent(
    run: ValidationRunRecord,
    content: BlueprintContentRecord
  ): Promise<ContentAdmissionOutcome> {
    if (run.status !== "PASSED" || run.blueprint_hash !== content.content_hash) {
      throw new Error("Only a PASSED validation run can admit its own content hash.");
    }
    const result = await this.executor.query<AdmissionRow>(POSTGRES_ADMIT_BLUEPRINT_CONTENT_SQL, [
      ...validationRunParameters(run),
      content.canonical_blueprint,
      content.schema_version,
      content.registry_version,
      content.byte_size
    ]);
    const [row] = result.rows;
    if (row === undefined) {
      throw new Error("Blueprint content admission returned no row.");
    }
    if (!row.body_matches) {
      return { kind: "HASH_INTEGRITY_FAILURE" };
    }
    if (!row.run_recorded) {
      throw new Error("Blueprint content admission did not record its validation run.");
    }
    return row.inserted ? { kind: "INSERTED" } : { kind: "REUSED", trustStatus: row.trust_status };
  }
}

function lineageRecord(row: AdmissionLineageRow): AdmissionLineageRecord {
  const content: LineageContentRow = {
    content_hash: row.content_hash,
    canonical_blueprint: row.canonical_blueprint,
    schema_version: row.schema_version,
    registry_version: row.registry_version,
    trust_status: row.trust_status,
    admitted_by_validation_run_id: row.admitted_by_validation_run_id,
    byte_size: row.byte_size
  };
  if (row.run_validation_run_id === null) {
    return { content, admitting_run: null };
  }
  return {
    content,
    admitting_run: {
      validation_run_id: row.run_validation_run_id,
      candidate_digest: row.run_candidate_digest ?? "",
      blueprint_hash: row.run_blueprint_hash,
      schema_version: row.run_schema_version ?? "",
      registry_version: row.run_registry_version ?? "",
      status: row.run_status ?? "",
      error_codes: row.run_error_codes,
      report: row.run_report,
      trace_id: row.run_trace_id ?? ""
    }
  };
}

/** Read-only lineage port: one row joins blueprint_content to its admitting validation_run. */
export class PostgresAdmissionLineageSource implements AdmissionLineageSource {
  public constructor(private readonly executor: PostgresExecutor) {}

  public async readAdmissionLineage(contentHash: string): Promise<AdmissionLineageRecord | undefined> {
    const result = await this.executor.query<AdmissionLineageRow>(POSTGRES_READ_ADMISSION_LINEAGE_SQL, [contentHash]);
    const [row] = result.rows;
    return row === undefined ? undefined : lineageRecord(row);
  }
}
