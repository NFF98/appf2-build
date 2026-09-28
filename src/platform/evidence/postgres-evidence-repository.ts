import type {
  AnonymousIdentityRepository,
  AnonymousIdentityStatus,
  EvidenceRepository
} from "./evidence-repository.js";
import type {
  EvidenceEventInput,
  EvidenceWriteResult
} from "./evidence-types.js";

export interface PostgresQueryResult<Row> {
  readonly rows: readonly Row[];
}

export interface PostgresExecutor {
  query<Row>(
    statement: string,
    parameters: readonly unknown[]
  ): Promise<PostgresQueryResult<Row>>;
}

export const POSTGRES_ENSURE_ANONYMOUS_IDENTITY_SQL = `
INSERT INTO public.anonymous_identity (
  anonymous_id, created_at, last_seen_at, status, created_source
)
VALUES ($1::uuid, $2::timestamptz, $2::timestamptz, 'ACTIVE', 'WEB_PHASE1')
ON CONFLICT (anonymous_id) DO NOTHING
RETURNING status
`.trim();

export const POSTGRES_READ_ANONYMOUS_IDENTITY_STATUS_SQL = `
SELECT status
FROM public.anonymous_identity
WHERE anonymous_id = $1::uuid
`.trim();

export const POSTGRES_REFRESH_LAST_SEEN_SQL = `
UPDATE public.anonymous_identity
SET last_seen_at = $2::timestamptz
WHERE anonymous_id = $1::uuid
  AND status = 'ACTIVE'
  AND last_seen_at <= $2::timestamptz - INTERVAL '24 hours'
`.trim();

export const POSTGRES_INSERT_EVIDENCE_SQL = `
WITH eligible AS (
  SELECT $5::uuid IS NULL OR EXISTS (
    SELECT 1
    FROM public.anonymous_identity
    WHERE anonymous_id = $5::uuid
      AND status = 'ACTIVE'
  ) AS allowed
),
inserted AS (
  INSERT INTO public.product_event (
    event_id,
    event_type,
    occurred_at,
    received_at,
    anonymous_id,
    session_id,
    function_id,
    intent_id,
    blueprint_hash,
    share_id,
    capability_id,
    error_code,
    policy_rule_id,
    trace_id,
    properties,
    schema_version
  )
  SELECT
    $1::uuid,
    $2::text,
    $3::timestamptz,
    $4::timestamptz,
    $5::uuid,
    $6::uuid,
    $7::text,
    $8::uuid,
    $9::text,
    $10::uuid,
    $11::text,
    $12::text,
    $13::text,
    $14::text,
    $15::jsonb,
    $16::text
  FROM eligible
  WHERE allowed
  ON CONFLICT (event_id) DO NOTHING
  RETURNING event_id
)
SELECT CASE
  WHEN NOT (SELECT allowed FROM eligible) THEN 'IDENTITY_DISABLED'
  WHEN EXISTS (SELECT 1 FROM inserted) THEN 'INSERTED'
  ELSE 'DUPLICATE'
END AS outcome
`.trim();

interface StatusRow {
  readonly status: string;
}

interface OutcomeRow {
  readonly outcome: EvidenceWriteResult;
}

function requiredFirst<Row>(rows: readonly Row[], operation: string): Row {
  const row = rows[0];
  if (row === undefined) {
    throw new Error(`PostgreSQL ${operation} returned no result`);
  }
  return row;
}

export class PostgresAnonymousIdentityRepository
implements AnonymousIdentityRepository {
  public constructor(private readonly executor: PostgresExecutor) {}

  public async ensure(
    anonymousId: string,
    seenAt: string
  ): Promise<AnonymousIdentityStatus> {
    const result = await this.executor.query<StatusRow>(
      POSTGRES_ENSURE_ANONYMOUS_IDENTITY_SQL,
      [anonymousId, seenAt]
    );
    const inserted = result.rows[0];
    const statusRow = inserted ?? requiredFirst(
      (
        await this.executor.query<StatusRow>(
          POSTGRES_READ_ANONYMOUS_IDENTITY_STATUS_SQL,
          [anonymousId]
        )
      ).rows,
      "identity status read"
    );
    const { status } = statusRow;
    return status === "ACTIVE" ? "ACTIVE" : "DISABLED";
  }

  public async refreshLastSeen(
    anonymousId: string,
    seenAt: string
  ): Promise<void> {
    await this.executor.query(POSTGRES_REFRESH_LAST_SEEN_SQL, [
      anonymousId,
      seenAt
    ]);
  }
}

export class PostgresEvidenceRepository implements EvidenceRepository {
  public constructor(private readonly executor: PostgresExecutor) {}

  public async insert(
    event: EvidenceEventInput,
    receivedAt: string
  ): Promise<EvidenceWriteResult> {
    const result = await this.executor.query<OutcomeRow>(
      POSTGRES_INSERT_EVIDENCE_SQL,
      [
        event.event_id,
        event.event_type,
        event.occurred_at,
        receivedAt,
        event.anonymous_id ?? null,
        event.session_id ?? null,
        event.function_id,
        event.intent_id ?? null,
        event.blueprint_hash ?? null,
        event.share_id ?? null,
        event.capability_id ?? null,
        event.error_code ?? null,
        event.policy_rule_id ?? null,
        event.trace_id ?? null,
        event.properties ?? {},
        event.schema_version
      ]
    );
    return requiredFirst(result.rows, "evidence insert").outcome;
  }
}
