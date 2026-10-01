import { canonicalBlueprintBytes } from "./canonical-json.js";
import {
  BlueprintHashIntegrityFailure,
  sameCanonicalBytes,
  type BlueprintAdmissionWriter
} from "./blueprint-repository.js";
import type {
  BlueprintAdmission,
  BlueprintAdmissionResult,
  BlueprintContentRecord
} from "./validation-types.js";

export interface PostgresQueryResult<Row> {
  readonly rows: readonly Row[];
}

export interface PostgresExecutor {
  query<Row>(
    statement: string,
    parameters: readonly unknown[]
  ): Promise<PostgresQueryResult<Row>>;
}

export interface PostgresTransactionScope {
  transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T>;
}

export const INSERT_VALIDATION_RUN_SQL = `
INSERT INTO public.validation_run (
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
  trace_id
) VALUES (
  $1::uuid,
  $2::uuid,
  $3::text,
  $4::text,
  $5::text,
  $6::text,
  'PASSED',
  $7::jsonb,
  $8::jsonb,
  $9::timestamptz,
  $10::text
)
`.trim();

export const INSERT_BLUEPRINT_CONTENT_SQL = `
INSERT INTO public.blueprint_content (
  content_hash,
  canonical_blueprint,
  schema_version,
  registry_version,
  trust_status,
  created_at,
  admitted_by_validation_run_id,
  byte_size
) VALUES (
  $1::text,
  $2::jsonb,
  $3::text,
  $4::text,
  'VALIDATED',
  $5::timestamptz,
  $6::uuid,
  $7::integer
)
ON CONFLICT (content_hash) DO NOTHING
RETURNING content_hash
`.trim();

export const SELECT_BLUEPRINT_CONTENT_SQL = `
SELECT
  canonical_blueprint,
  schema_version,
  registry_version,
  trust_status,
  created_at,
  admitted_by_validation_run_id,
  byte_size
FROM public.blueprint_content
WHERE content_hash = $1::text
`.trim();

interface ContentRow {
  readonly canonical_blueprint: unknown;
  readonly schema_version: string;
  readonly registry_version: string;
  readonly trust_status: BlueprintContentRecord["trust_status"];
  readonly created_at: string;
  readonly admitted_by_validation_run_id: string;
  readonly byte_size: number;
}

export class PostgresBlueprintAdmissionRepository implements BlueprintAdmissionWriter {
  constructor(private readonly scope: PostgresTransactionScope) {}

  async admit(input: BlueprintAdmission): Promise<BlueprintAdmissionResult> {
    return this.scope.transaction(async (executor) => {
      await executor.query(INSERT_VALIDATION_RUN_SQL, runParameters(input));
      const inserted = await executor.query<{ content_hash: string }>(
        INSERT_BLUEPRINT_CONTENT_SQL,
        contentParameters(input)
      );
      if (inserted.rows.length > 0) {
        return { reused: false };
      }
      const existing = await executor.query<ContentRow>(
        SELECT_BLUEPRINT_CONTENT_SQL,
        [input.content.content_hash]
      );
      const row = existing.rows[0];
      if (row === undefined) {
        throw new Error("blueprint_content row missing after insert-or-get.");
      }
      if (!storedContentMatches(row, input.content)) {
        throw new BlueprintHashIntegrityFailure();
      }
      return { reused: true };
    });
  }
}

function runParameters(input: BlueprintAdmission): readonly unknown[] {
  return [
    input.run.validation_run_id,
    input.run.compiler_run_id,
    input.run.candidate_digest,
    input.run.blueprint_hash,
    input.run.schema_version,
    input.run.registry_version,
    JSON.stringify(input.run.error_codes),
    JSON.stringify(input.run.report),
    input.run.created_at,
    input.run.trace_id
  ];
}

function contentParameters(input: BlueprintAdmission): readonly unknown[] {
  return [
    input.content.content_hash,
    new TextDecoder().decode(input.content.canonical_bytes),
    input.content.schema_version,
    input.content.registry_version,
    input.content.created_at,
    input.content.admitted_by_validation_run_id,
    input.content.byte_size
  ];
}

function storedContentMatches(row: ContentRow, incoming: BlueprintContentRecord): boolean {
  const storedBytes = canonicalBlueprintBytes(row.canonical_blueprint);
  return row.byte_size === incoming.byte_size
    && row.schema_version === incoming.schema_version
    && row.registry_version === incoming.registry_version
    && sameCanonicalBytes(storedBytes, incoming.canonical_bytes);
}
