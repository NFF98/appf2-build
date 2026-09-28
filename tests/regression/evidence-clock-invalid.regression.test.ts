import { expect, test } from "vitest";

import { EvidenceIngestionService } from "../../src/platform/evidence/evidence-ingestion-service.js";
import { effectiveEventAt } from "../../src/platform/evidence/evidence-clock.js";
import { POSTGRES_INSERT_EVIDENCE_SQL } from "../../src/platform/evidence/postgres-evidence-repository.js";
import type {
  AnonymousIdentityRepository,
  EvidenceIngestionDiagnostics,
  EvidenceRepository
} from "../../src/platform/evidence/evidence-repository.js";
import type {
  EvidenceEventInput,
  EvidenceWriteResult
} from "../../src/platform/evidence/evidence-types.js";

const RECEIVED_AT = "2026-09-27T02:00:00.000Z";
const RETRY_RECEIVED_AT = "2026-09-27T03:00:00.000Z";
const EXACTLY_TEN_MINUTES = "2026-09-27T02:10:00.000Z";
const ELEVEN_MINUTES = "2026-09-27T02:11:00.000Z";
const NORMAL_OCCURRED_AT = "2026-09-27T01:23:45.000Z";
const SOURCE_ERROR = "F05-ERR-001";

class RecordingIdentities implements AnonymousIdentityRepository {
  public async ensure(): Promise<"ACTIVE"> {
    return "ACTIVE";
  }

  public async refreshLastSeen(): Promise<void> {
    return undefined;
  }
}

class RecordingEvidence implements EvidenceRepository {
  public readonly events = new Map<string, EvidenceEventInput>();
  public readonly receivedAtByEventId = new Map<string, string>();

  public async insert(
    event: EvidenceEventInput,
    receivedAt: string
  ): Promise<EvidenceWriteResult> {
    if (this.events.has(event.event_id)) {
      return "DUPLICATE";
    }
    this.events.set(event.event_id, event);
    this.receivedAtByEventId.set(event.event_id, receivedAt);
    return "INSERTED";
  }
}

function envelope(index: number, occurredAt: string): Record<string, unknown> {
  return {
    event_id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    event_type: "F05-EVT-007",
    schema_version: "1.0.0",
    occurred_at: occurredAt,
    anonymous_id: "423e4567-e89b-42d3-a456-426614174000",
    session_id: "623e4567-e89b-42d3-a456-426614174000",
    function_id: "F05",
    share_id: "723e4567-e89b-42d3-a456-426614174000",
    error_code: SOURCE_ERROR,
    properties: { share_mode: "DURABLE_REFERENCE" }
  };
}

test("TEST-F07-031 derives effective_event_at and keeps duplicate clock classification stable", async () => {
  const evidence = new RecordingEvidence();
  const clock = { current: new Date(RECEIVED_AT) };
  const ingestion = new EvidenceIngestionService({
    anonymousIdentities: new RecordingIdentities(),
    evidence,
    diagnostics: {
      reportNonBlockingFailure() {
        return undefined;
      }
    } satisfies EvidenceIngestionDiagnostics,
    now: () => clock.current
  });
  const clockInvalid = envelope(1, ELEVEN_MINUTES);
  const exactSkew = envelope(2, EXACTLY_TEN_MINUTES);
  const normal = envelope(3, NORMAL_OCCURRED_AT);

  const first = await ingestion.ingest([clockInvalid, exactSkew, normal]);
  clock.current = new Date(RETRY_RECEIVED_AT);
  const retry = await ingestion.ingest([clockInvalid]);

  const firstReceived = evidence.receivedAtByEventId.get(String(clockInvalid.event_id));
  const exactReceived = evidence.receivedAtByEventId.get(String(exactSkew.event_id));
  const normalReceived = evidence.receivedAtByEventId.get(String(normal.event_id));
  const storedInvalid = evidence.events.get(String(clockInvalid.event_id));

  expect(first).toMatchObject({
    accepted: 3,
    duplicates: 0,
    rejected: 0,
    rejections: [],
    diagnostics: [
      {
        event_id: clockInvalid.event_id,
        code: "F07-ERR-013",
        field: "occurred_at",
        action: "USE_RECEIVED_AT"
      }
    ]
  });
  expect(retry).toEqual({
    accepted: 0,
    duplicates: 1,
    rejected: 0,
    rejections: [],
    diagnostics: []
  });
  expect(firstReceived).toBe(RECEIVED_AT);
  expect(evidence.receivedAtByEventId.get(String(clockInvalid.event_id))).toBe(
    RECEIVED_AT
  );
  expect(storedInvalid?.occurred_at).toBe(ELEVEN_MINUTES);
  expect(storedInvalid?.error_code).toBe(SOURCE_ERROR);
  expect(storedInvalid?.error_code).not.toBe("F07-ERR-013");
  expect(effectiveEventAt(ELEVEN_MINUTES, firstReceived ?? "")).toBe(RECEIVED_AT);
  expect(effectiveEventAt(EXACTLY_TEN_MINUTES, exactReceived ?? "")).toBe(
    EXACTLY_TEN_MINUTES
  );
  expect(effectiveEventAt(NORMAL_OCCURRED_AT, normalReceived ?? "")).toBe(
    NORMAL_OCCURRED_AT
  );
  expect(POSTGRES_INSERT_EVIDENCE_SQL).toContain("ON CONFLICT (event_id) DO NOTHING");
  expect(POSTGRES_INSERT_EVIDENCE_SQL).not.toContain("F07-ERR-013");
});
