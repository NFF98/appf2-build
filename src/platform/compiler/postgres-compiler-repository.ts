import type { PostgresExecutor } from "../blueprint/postgres-blueprint-repository.js";
import type { JsonValue } from "../intent/json-value.js";
import type {
  AttemptGuard,
  CompileOutcomeReader,
  CompilerRunFinish,
  CompilerRunRepository,
  CompilerRunStart,
  IntentKind,
  IntentLifecycleStatus,
  IntentRecord,
  IntentRepository,
  IntentTransition,
  IntentWriteOutcome,
  NewIntentRecord,
  ValidatedResultRow,
  ValidationOutcomeRow
} from "./compiler-records.js";
import type {
  AttemptAcquisition,
  IdempotencyOperationRow,
  IdempotencyRepository,
  IdempotencyStatus,
  NewIdempotencyOperation,
  OperationCompletion,
  ResultRefType
} from "./idempotency.js";

const IDEMPOTENCY_COLUMNS = `
  idempotency_operation_id::text AS idempotency_operation_id,
  anonymous_id::text AS anonymous_id,
  route_key,
  idempotency_key,
  request_digest,
  status,
  attempt_no,
  lease_expires_at,
  result_ref_type,
  result_ref_id,
  http_status,
  error_code,
  created_at,
  updated_at,
  expires_at`;

export const POSTGRES_INSERT_IDEMPOTENCY_OPERATION_SQL = `
INSERT INTO public.idempotency_operation (
  idempotency_operation_id, anonymous_id, route_key, idempotency_key, request_digest,
  status, attempt_no, lease_expires_at, created_at, updated_at, expires_at
)
VALUES ($1::uuid, $2::uuid, $3::text, $4::text, $5::text, 'IN_PROGRESS', 1, $6::timestamptz, $7::timestamptz, $7::timestamptz, $8::timestamptz)
ON CONFLICT (anonymous_id, route_key, idempotency_key) DO NOTHING
RETURNING ${IDEMPOTENCY_COLUMNS}
`.trim();

export const POSTGRES_READ_IDEMPOTENCY_OPERATION_SQL = `
SELECT ${IDEMPOTENCY_COLUMNS}
FROM public.idempotency_operation
WHERE anonymous_id = $1::uuid AND route_key = $2::text AND idempotency_key = $3::text
`.trim();

/** Single-winner CAS: the WHERE re-checks status, attempt_no and the retry / takeover / TTL-reset condition. */
export const POSTGRES_ACQUIRE_IDEMPOTENCY_ATTEMPT_SQL = `
UPDATE public.idempotency_operation
SET status = 'IN_PROGRESS',
    attempt_no = attempt_no + 1,
    lease_expires_at = $4::timestamptz,
    updated_at = $5::timestamptz,
    request_digest = COALESCE($6::text, request_digest),
    created_at = COALESCE($7::timestamptz, created_at),
    expires_at = COALESCE($8::timestamptz, expires_at),
    result_ref_type = CASE WHEN $6::text IS NULL THEN result_ref_type END,
    result_ref_id = CASE WHEN $6::text IS NULL THEN result_ref_id END,
    http_status = CASE WHEN $6::text IS NULL THEN http_status END,
    error_code = CASE WHEN $6::text IS NULL THEN error_code END
WHERE idempotency_operation_id = $1::uuid
  AND status = $2::text
  AND attempt_no = $3::integer
  AND (
    ($6::text IS NOT NULL AND expires_at <= $5::timestamptz)
    OR ($6::text IS NULL AND status = 'FAILED_RETRYABLE')
    OR ($6::text IS NULL AND status = 'IN_PROGRESS' AND lease_expires_at <= $5::timestamptz)
  )
RETURNING ${IDEMPOTENCY_COLUMNS}
`.trim();

/** Late / superseded attempts match zero rows; an established result_ref is never replaced by NULL. */
export const POSTGRES_COMPLETE_IDEMPOTENCY_OPERATION_SQL = `
UPDATE public.idempotency_operation
SET status = $3::text,
    http_status = $4::integer,
    error_code = $5::text,
    result_ref_type = COALESCE($6::text, result_ref_type),
    result_ref_id = COALESCE($7::text, result_ref_id),
    lease_expires_at = NULL,
    updated_at = $8::timestamptz
WHERE idempotency_operation_id = $1::uuid
  AND attempt_no = $2::integer
  AND status = 'IN_PROGRESS'
RETURNING attempt_no
`.trim();

const ATTEMPT_OWNER_CTE = `
owner AS (
  SELECT 1
  FROM public.idempotency_operation
  WHERE idempotency_operation_id = $1::uuid AND attempt_no = $2::integer AND status = 'IN_PROGRESS'
  FOR UPDATE
)`;

/** Binds the logical operation to exactly one intent before provider work (F01-API-004). */
export const POSTGRES_CREATE_RECEIVED_INTENT_SQL = `
WITH bound AS (
  UPDATE public.idempotency_operation
  SET result_ref_type = 'INTENT', result_ref_id = $3::text
  WHERE idempotency_operation_id = $1::uuid
    AND attempt_no = $2::integer
    AND status = 'IN_PROGRESS'
    AND result_ref_id IS NULL
  RETURNING 1
)
INSERT INTO public.intent_record (
  intent_id, anonymous_id, intent_kind, raw_intent, structured_intent, resolved_intent,
  lifecycle_status, intent_version, source_blueprint_hash, created_at, updated_at, expires_at
)
SELECT $3::uuid, $4::uuid, $5::text, $6::text, NULL, NULL, 'RECEIVED', 1, $7::text, $8::timestamptz, $8::timestamptz, NULL
FROM bound
RETURNING intent_id::text AS intent_id
`.trim();

export const POSTGRES_FIND_SCOPED_INTENT_SQL = `
SELECT
  intent_id::text AS intent_id,
  anonymous_id::text AS anonymous_id,
  intent_kind,
  raw_intent,
  structured_intent,
  resolved_intent,
  lifecycle_status,
  intent_version,
  source_blueprint_hash,
  created_at,
  updated_at,
  expires_at
FROM public.intent_record
WHERE intent_id = $1::uuid AND anonymous_id = $2::uuid
`.trim();

/** intent_version CAS + attempt ownership in one statement: a stale attempt can never advance the lifecycle. */
export const POSTGRES_TRANSITION_INTENT_SQL = `
WITH ${ATTEMPT_OWNER_CTE.trim()},
updated AS (
  UPDATE public.intent_record
  SET lifecycle_status = $5::text,
      structured_intent = CASE WHEN $6::boolean THEN $7::jsonb ELSE structured_intent END,
      resolved_intent = CASE WHEN $8::boolean THEN $9::jsonb ELSE resolved_intent END,
      expires_at = CASE WHEN $10::boolean THEN $11::timestamptz ELSE expires_at END,
      intent_version = intent_version + 1,
      updated_at = $12::timestamptz
  WHERE intent_id = $3::uuid
    AND intent_version = $4::integer
    AND EXISTS (SELECT 1 FROM owner)
  RETURNING intent_version
)
SELECT
  EXISTS (SELECT 1 FROM owner) AS owner_current,
  (SELECT intent_version FROM updated) AS intent_version
`.trim();

export const POSTGRES_START_COMPILER_RUN_SQL = `
WITH ${ATTEMPT_OWNER_CTE.trim()},
inserted AS (
  INSERT INTO public.compiler_run (
    compiler_run_id, intent_id, stage, status, prompt_version, schema_version, registry_version,
    model_adapter, attempt_no, started_at, trace_id
  )
  SELECT
    $3::uuid, $4::uuid, $5::text, 'STARTED', $6::text, $7::text, $8::text, $9::text,
    COALESCE((SELECT max(attempt_no) FROM public.compiler_run WHERE intent_id = $4::uuid AND stage = $5::text), 0) + 1,
    $10::timestamptz, $11::text
  FROM owner
  RETURNING attempt_no
)
SELECT (SELECT attempt_no FROM inserted) AS attempt_no
`.trim();

export const POSTGRES_FINISH_COMPILER_RUN_SQL = `
UPDATE public.compiler_run
SET status = $2::text,
    provider_model = $3::text,
    finished_at = $4::timestamptz,
    latency_ms = $5::integer,
    input_tokens = $6::integer,
    output_tokens = $7::integer,
    estimated_cost = $8::numeric,
    failure_code = $9::text
WHERE compiler_run_id = $1::uuid AND status = 'STARTED'
`.trim();

export const POSTGRES_LIST_VALIDATION_OUTCOMES_SQL = `
SELECT
  run.validation_run_id::text AS validation_run_id,
  run.status,
  run.error_codes,
  run.created_at
FROM public.validation_run AS run
JOIN public.compiler_run AS compiler ON compiler.compiler_run_id = run.compiler_run_id
WHERE compiler.intent_id = $1::uuid
  AND ($2::timestamptz IS NULL OR run.created_at >= $2::timestamptz)
ORDER BY run.created_at DESC, run.validation_run_id DESC
LIMIT 16
`.trim();

export const POSTGRES_READ_VALIDATED_RESULT_SQL = `
SELECT
  run.validation_run_id::text AS validation_run_id,
  compiler.intent_id::text AS intent_id,
  content.content_hash,
  content.schema_version,
  content.registry_version,
  content.trust_status
FROM public.validation_run AS run
JOIN public.compiler_run AS compiler ON compiler.compiler_run_id = run.compiler_run_id
JOIN public.blueprint_content AS content ON content.content_hash = run.blueprint_hash
WHERE run.validation_run_id = $1::uuid AND run.status = 'PASSED'
`.trim();

function timestampText(value: unknown): string {
  if (typeof value === "string") return new Date(value).toISOString();
  if (value instanceof Date && Number.isFinite(value.getTime())) return value.toISOString();
  throw new Error("Invalid durable timestamp.");
}

const optionalTimestamp = (value: unknown): string | null => (value === null || value === undefined ? null : timestampText(value));
const nullableText = (value: unknown): string | null => (value === null || value === undefined ? null : String(value));

type RawRow = Readonly<Record<string, unknown>>;

function idempotencyRow(row: RawRow): IdempotencyOperationRow {
  return {
    idempotency_operation_id: String(row.idempotency_operation_id),
    anonymous_id: String(row.anonymous_id),
    route_key: String(row.route_key),
    idempotency_key: String(row.idempotency_key),
    request_digest: String(row.request_digest),
    status: row.status as IdempotencyStatus,
    attempt_no: Number(row.attempt_no),
    lease_expires_at: optionalTimestamp(row.lease_expires_at),
    result_ref_type: nullableText(row.result_ref_type) as ResultRefType | null,
    result_ref_id: nullableText(row.result_ref_id),
    http_status: row.http_status === null || row.http_status === undefined ? null : Number(row.http_status),
    error_code: nullableText(row.error_code),
    created_at: timestampText(row.created_at),
    updated_at: timestampText(row.updated_at),
    expires_at: timestampText(row.expires_at)
  };
}

function intentRow(row: RawRow): IntentRecord {
  return {
    intent_id: String(row.intent_id),
    anonymous_id: String(row.anonymous_id),
    intent_kind: row.intent_kind as IntentKind,
    raw_intent: nullableText(row.raw_intent),
    structured_intent: (row.structured_intent ?? null) as JsonValue | null,
    resolved_intent: (row.resolved_intent ?? null) as JsonValue | null,
    lifecycle_status: row.lifecycle_status as IntentLifecycleStatus,
    intent_version: Number(row.intent_version),
    source_blueprint_hash: nullableText(row.source_blueprint_hash),
    created_at: timestampText(row.created_at),
    updated_at: timestampText(row.updated_at),
    expires_at: optionalTimestamp(row.expires_at)
  };
}

const jsonParameter = (value: JsonValue | null | undefined): string | null => (value === undefined || value === null ? null : JSON.stringify(value));

export class PostgresIdempotencyRepository implements IdempotencyRepository {
  public constructor(private readonly executor: PostgresExecutor) {}

  public async insertIfAbsent(operation: NewIdempotencyOperation): Promise<IdempotencyOperationRow | null> {
    const result = await this.executor.query<RawRow>(POSTGRES_INSERT_IDEMPOTENCY_OPERATION_SQL, [
      operation.idempotency_operation_id,
      operation.anonymous_id,
      operation.route_key,
      operation.idempotency_key,
      operation.request_digest,
      operation.lease_expires_at,
      operation.created_at,
      operation.expires_at
    ]);
    const [row] = result.rows;
    return row === undefined ? null : idempotencyRow(row);
  }

  public async read(anonymousId: string, routeKey: string, idempotencyKey: string): Promise<IdempotencyOperationRow | undefined> {
    const result = await this.executor.query<RawRow>(POSTGRES_READ_IDEMPOTENCY_OPERATION_SQL, [anonymousId, routeKey, idempotencyKey]);
    const [row] = result.rows;
    return row === undefined ? undefined : idempotencyRow(row);
  }

  public async acquireAttempt(acquisition: AttemptAcquisition): Promise<IdempotencyOperationRow | null> {
    const result = await this.executor.query<RawRow>(POSTGRES_ACQUIRE_IDEMPOTENCY_ATTEMPT_SQL, [
      acquisition.idempotency_operation_id,
      acquisition.expected_status,
      acquisition.expected_attempt_no,
      acquisition.lease_expires_at,
      acquisition.now,
      acquisition.reset?.request_digest ?? null,
      acquisition.reset?.created_at ?? null,
      acquisition.reset?.expires_at ?? null
    ]);
    const [row] = result.rows;
    return row === undefined ? null : idempotencyRow(row);
  }

  public async complete(guard: AttemptGuard, completion: OperationCompletion): Promise<boolean> {
    const result = await this.executor.query<RawRow>(POSTGRES_COMPLETE_IDEMPOTENCY_OPERATION_SQL, [
      guard.idempotency_operation_id,
      guard.attempt_no,
      completion.status,
      completion.http_status,
      completion.error_code,
      completion.result_ref?.type ?? null,
      completion.result_ref?.id ?? null,
      guard.now
    ]);
    return result.rows.length === 1;
  }
}

export class PostgresIntentRepository implements IntentRepository {
  public constructor(private readonly executor: PostgresExecutor) {}

  public async createReceivedIntent(guard: AttemptGuard, record: NewIntentRecord): Promise<"CREATED" | "STALE_ATTEMPT"> {
    const result = await this.executor.query<RawRow>(POSTGRES_CREATE_RECEIVED_INTENT_SQL, [
      guard.idempotency_operation_id,
      guard.attempt_no,
      record.intent_id,
      record.anonymous_id,
      record.intent_kind,
      record.raw_intent,
      record.source_blueprint_hash,
      guard.now
    ]);
    return result.rows.length === 1 ? "CREATED" : "STALE_ATTEMPT";
  }

  public async findScopedIntent(intentId: string, anonymousId: string): Promise<IntentRecord | undefined> {
    const result = await this.executor.query<RawRow>(POSTGRES_FIND_SCOPED_INTENT_SQL, [intentId, anonymousId]);
    const [row] = result.rows;
    return row === undefined ? undefined : intentRow(row);
  }

  public async transitionIntent(guard: AttemptGuard, transition: IntentTransition): Promise<IntentWriteOutcome> {
    const result = await this.executor.query<RawRow>(POSTGRES_TRANSITION_INTENT_SQL, [
      guard.idempotency_operation_id,
      guard.attempt_no,
      transition.intent_id,
      transition.expected_version,
      transition.lifecycle_status,
      transition.structured_intent !== undefined,
      jsonParameter(transition.structured_intent),
      transition.resolved_intent !== undefined,
      jsonParameter(transition.resolved_intent),
      transition.expires_at !== undefined,
      transition.expires_at ?? null,
      guard.now
    ]);
    const [row] = result.rows;
    if (row === undefined || row.owner_current !== true) return { kind: "STALE_ATTEMPT" };
    return row.intent_version === null || row.intent_version === undefined
      ? { kind: "VERSION_CONFLICT" }
      : { kind: "WRITTEN", intent_version: Number(row.intent_version) };
  }
}

export class PostgresCompilerRunRepository implements CompilerRunRepository, CompileOutcomeReader {
  public constructor(private readonly executor: PostgresExecutor) {}

  public async startRun(guard: AttemptGuard, run: CompilerRunStart): Promise<{ readonly attempt_no: number } | "STALE_ATTEMPT"> {
    const result = await this.executor.query<RawRow>(POSTGRES_START_COMPILER_RUN_SQL, [
      guard.idempotency_operation_id,
      guard.attempt_no,
      run.compiler_run_id,
      run.intent_id,
      run.stage,
      run.prompt_version,
      run.schema_version,
      run.registry_version,
      run.model_adapter,
      run.started_at,
      run.trace_id
    ]);
    const attemptNo = result.rows[0]?.attempt_no;
    return attemptNo === null || attemptNo === undefined ? "STALE_ATTEMPT" : { attempt_no: Number(attemptNo) };
  }

  public async finishRun(run: CompilerRunFinish): Promise<void> {
    await this.executor.query(POSTGRES_FINISH_COMPILER_RUN_SQL, [
      run.compiler_run_id,
      run.status,
      run.provider_model,
      run.finished_at,
      run.latency_ms,
      run.input_tokens,
      run.output_tokens,
      run.estimated_cost,
      run.failure_code
    ]);
  }

  public async listValidationOutcomes(intentId: string, since: string | null): Promise<readonly ValidationOutcomeRow[]> {
    const result = await this.executor.query<RawRow>(POSTGRES_LIST_VALIDATION_OUTCOMES_SQL, [intentId, since]);
    return result.rows.map((row) => ({
      validation_run_id: String(row.validation_run_id),
      status: row.status as ValidationOutcomeRow["status"],
      error_codes: Array.isArray(row.error_codes) ? (row.error_codes as readonly unknown[]) : [],
      created_at: timestampText(row.created_at)
    }));
  }

  public async readValidatedResult(validationRunId: string): Promise<ValidatedResultRow | undefined> {
    const result = await this.executor.query<RawRow>(POSTGRES_READ_VALIDATED_RESULT_SQL, [validationRunId]);
    const [row] = result.rows;
    return row === undefined
      ? undefined
      : {
          validation_run_id: String(row.validation_run_id),
          intent_id: String(row.intent_id),
          content_hash: String(row.content_hash),
          schema_version: String(row.schema_version),
          registry_version: String(row.registry_version),
          trust_status: String(row.trust_status)
        };
  }
}
