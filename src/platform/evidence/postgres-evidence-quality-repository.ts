import type {
  EvidenceClientQualityReportRow,
  EvidenceIntakeObservationRow,
  EvidenceQualityReportWriteResult,
  EvidenceQualitySourceRepository
} from "./evidence-quality-recorder.js";
import type { PostgresExecutor } from "./postgres-evidence-repository.js";

export const POSTGRES_INSERT_INTAKE_OBSERVATION_SQL = `
INSERT INTO public.evidence_intake_observation (
  observation_id,
  received_at,
  batch_accepted,
  event_received_count,
  accepted_count,
  duplicate_count,
  rejected_count,
  unknown_event_type_count,
  route_rejection_code
)
VALUES (
  $1::uuid,
  $2::timestamptz,
  $3::boolean,
  $4::bigint,
  $5::bigint,
  $6::bigint,
  $7::bigint,
  $8::bigint,
  $9::text
)
ON CONFLICT (observation_id) DO NOTHING
`.trim();

export const POSTGRES_INSERT_CLIENT_QUALITY_REPORT_SQL = `
WITH inserted AS (
  INSERT INTO public.evidence_client_quality_report (
    report_id,
    received_at,
    local_queue_drop_count,
    offline_expired_event_count
  )
  VALUES ($1::uuid, $2::timestamptz, $3::bigint, $4::bigint)
  ON CONFLICT (report_id) DO NOTHING
  RETURNING report_id
)
SELECT CASE
  WHEN EXISTS (SELECT 1 FROM inserted) THEN 'INSERTED'
  ELSE 'DUPLICATE'
END AS outcome
`.trim();

interface OutcomeRow {
  readonly outcome: unknown;
}

export class PostgresEvidenceQualitySourceRepository implements EvidenceQualitySourceRepository {
  public constructor(private readonly executor: PostgresExecutor) {}

  public async insertIntakeObservation(row: EvidenceIntakeObservationRow): Promise<void> {
    await this.executor.query(POSTGRES_INSERT_INTAKE_OBSERVATION_SQL, [
      row.observation_id,
      row.received_at,
      row.batch_accepted,
      row.event_received_count,
      row.accepted_count,
      row.duplicate_count,
      row.rejected_count,
      row.unknown_event_type_count,
      row.route_rejection_code
    ]);
  }

  public async insertClientQualityReport(
    row: EvidenceClientQualityReportRow
  ): Promise<EvidenceQualityReportWriteResult> {
    const result = await this.executor.query<OutcomeRow>(POSTGRES_INSERT_CLIENT_QUALITY_REPORT_SQL, [
      row.report_id,
      row.received_at,
      row.local_queue_drop_count,
      row.offline_expired_event_count
    ]);
    const outcome = result.rows[0]?.outcome;
    if (outcome !== "INSERTED" && outcome !== "DUPLICATE") {
      throw new Error("PostgreSQL quality report insert returned no valid outcome");
    }
    return outcome;
  }
}
