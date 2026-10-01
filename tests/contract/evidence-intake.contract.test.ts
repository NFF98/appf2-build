import { describe, expect, test } from "vitest";

import { EvidenceIngestionService } from "../../src/platform/evidence/evidence-ingestion-service.js";
import type {
  AnonymousIdentityRepository,
  EvidenceRepository
} from "../../src/platform/evidence/evidence-repository.js";
import type {
  EvidenceEventInput,
  EvidenceWriteResult
} from "../../src/platform/evidence/evidence-types.js";
import { isUuid, validateEvidenceEvent } from "../../src/platform/evidence/evidence-validator.js";

const EVENT_ID = "123e4567-e89b-42d3-a456-426614174000";
const SHARE_ID = "223e4567-e89b-42d3-a456-426614174000";
const ANONYMOUS_ID = "323e4567-e89b-42d3-a456-426614174000";
const SESSION_ID = "423e4567-e89b-42d3-a456-426614174000";
const PERSISTED_EVENT_ID = "523e4567-e89b-42d3-a456-426614174000";
const NON_V4_UUIDS = {
  v1: "123e4567-e89b-12d3-a456-426614174000",
  v3: "123e4567-e89b-32d3-a456-426614174000",
  v5: "123e4567-e89b-52d3-a456-426614174000"
} as const;
const V4_ENVELOPE_FIELDS = ["event_id", "anonymous_id", "session_id", "share_id"] as const;
const SHA256 = `sha256:${"a".repeat(64)}`;

function validEvent(): Record<string, unknown> {
  return {
    event_id: EVENT_ID,
    event_type: "F05-EVT-007",
    schema_version: "2.0.0",
    occurred_at: "2026-09-27T01:23:45.000Z",
    anonymous_id: null,
    session_id: null,
    function_id: "F05",
    share_id: SHARE_ID,
    properties: { share_mode: "DURABLE_REFERENCE" }
  };
}

function validate(event: unknown) {
  return validateEvidenceEvent(event, JSON.stringify(event));
}

function invalidF03IntakeEvents(
  validTimeout: Record<string, unknown>
): readonly Record<string, unknown>[] {
  return [
    { ...validTimeout, schema_version: "2.0.0" },
    f03Event("F03-EVT-014", {
      operation_status: "TIMED_OUT",
      integrity_status: "UNKNOWN"
    }),
    f03Event("F03-EVT-014", { runtime_stage: "TIMED_OUT" }),
    f03Event("F03-EVT-015", { discard_reason: "INTEGRITY_FAILURE" }),
    f03Event("F03-EVT-010", { error_code: "F03-ERR-018" }),
    f03Event("F03-EVT-012", {
      operation_status: "PROCESSING",
      completed_checkpoint_count: 2,
      planned_checkpoint_count: 1
    })
  ];
}

function f03Event(
  eventType: string,
  properties: Record<string, unknown>,
  envelope: Record<string, unknown> = {}
): Record<string, unknown> {
  return {
    event_id: EVENT_ID,
    event_type: eventType,
    schema_version: "3.0.0",
    occurred_at: "2026-09-27T01:23:45.000Z",
    anonymous_id: null,
    session_id: null,
    function_id: "F03",
    ...envelope,
    properties
  };
}

function f16Event(properties: Record<string, unknown>): Record<string, unknown> {
  return {
    event_id: EVENT_ID,
    event_type: "F16-EVT-001",
    schema_version: "2.0.0",
    occurred_at: "2026-09-27T01:23:45.000Z",
    function_id: "F16",
    properties
  };
}

function expectRejected(event: unknown, code: string, field: string | null): void {
  expect(validate(event)).toMatchObject({ accepted: false, rejection: { code, field } });
}

function expectEnvelopeUuidRules(): void {
  const populated = { ...validEvent(), anonymous_id: ANONYMOUS_ID, session_id: SESSION_ID };
  expect(validate(populated).accepted).toBe(true);
  for (const field of V4_ENVELOPE_FIELDS) {
    const expected = field === "anonymous_id"
      ? { code: "F07-ERR-001", field: "anonymous_id" }
      : { code: "F07-ERR-003", field: "context" };
    for (const invalid of ["not-a-uuid", ...Object.values(NON_V4_UUIDS)]) {
      expectRejected({ ...populated, [field]: invalid }, expected.code, expected.field);
    }
  }
  for (const nonV4IntentId of Object.values(NON_V4_UUIDS)) {
    expect(validate({ ...populated, intent_id: nonV4IntentId }).accepted).toBe(true);
  }
  expectRejected({ ...populated, intent_id: "not-a-uuid" }, "F07-ERR-003", "context");
  expect(Object.values(NON_V4_UUIDS).every(uuid => isUuid(uuid))).toBe(true);
}

function expectSchemaVersionRules(): void {
  expectRejected({ ...validEvent(), schema_version: "1.0.0" }, "F07-ERR-003", "schema_version");
  expectRejected({ ...validEvent(), schema_version: "2.0" }, "F07-ERR-003", "schema_version");
  expect(validate(f03Event("F03-EVT-011", { operation_status: "STARTED" })).accepted).toBe(true);
  expectRejected(
    { ...f03Event("F03-EVT-011", { operation_status: "STARTED" }), schema_version: "2.0.0" },
    "F07-ERR-003",
    "schema_version"
  );
}

function expectPropertyOwnershipRules(): void {
  expectRejected(
    f03Event("F03-EVT-010", { error_code: "F03-ERR-018", integrity_status: "CORRUPTED" }),
    "F07-ERR-005",
    "error_code"
  );
  for (const reserved of ["share_id", "capability_id", "trace_id", "received_at"]) {
    expectRejected(
      { ...validEvent(), properties: { share_mode: "DURABLE_REFERENCE", [reserved]: SHARE_ID } },
      "F07-ERR-005",
      reserved
    );
  }
  expectRejected(
    { ...validEvent(), properties: { share_mode: "DURABLE_REFERENCE", correction_text: "private user content" } },
    "F07-ERR-005",
    "correction_text"
  );
  expectRejected(
    { ...validEvent(), properties: { correction_text: "private user content", error_code: "F05-ERR-001" } },
    "F07-ERR-005",
    "error_code"
  );
}

function expectPropertySchemaRules(): void {
  for (const shareMode of [42, "PRIVATE_MEDICAL_RESULT"]) {
    expectRejected({ ...validEvent(), properties: { share_mode: shareMode } }, "F07-ERR-003", "share_mode");
  }
  expect(validate(f16Event({ correction_id: NON_V4_UUIDS.v1, new_blueprint_hash: SHA256 })).accepted)
    .toBe(true);
  expectRejected(f16Event({ correction_id: "not-a-uuid" }), "F07-ERR-003", "correction_id");
  expectRejected(f16Event({ new_blueprint_hash: "sha256:ABC" }), "F07-ERR-003", "new_blueprint_hash");
  const processing = (properties: Record<string, unknown>) =>
    f03Event("F03-EVT-012", { operation_status: "PROCESSING", ...properties });
  expect(validate(processing({ progress_percent: 100, checkpoint_id: "c1" })).accepted).toBe(true);
  expectRejected(processing({ progress_percent: 100.5 }), "F07-ERR-003", "progress_percent");
  expectRejected(processing({ progress_percent: -1 }), "F07-ERR-003", "progress_percent");
  expectRejected(processing({ planned_checkpoint_count: 1.5 }), "F07-ERR-003", "planned_checkpoint_count");
  expectRejected(processing({ checkpoint_id: "" }), "F07-ERR-003", "checkpoint_id");
  expectRejected(processing({ checkpoint_id: "c".repeat(65) }), "F07-ERR-006", "checkpoint_id");
  expectRejected(
    f03Event("F03-EVT-012", { operation_status: "STARTED" }),
    "F07-ERR-003",
    "operation_status"
  );
}

function expectEnvelopeAwareRules(): void {
  const fatal = { runtime_status: "FATAL_ERROR", operation_status: "FAILED" };
  const integrityFailure = { error_code: "F03-ERR-018" };
  expect(
    validate(f03Event("F03-EVT-010", { ...fatal, integrity_status: "CORRUPTED" }, integrityFailure))
      .accepted
  ).toBe(true);
  expectRejected(f03Event("F03-EVT-010", fatal, integrityFailure), "F07-ERR-003", "integrity_status");
  expectRejected(
    f03Event("F03-EVT-010", { ...fatal, integrity_status: "PROVEN" }, integrityFailure),
    "F07-ERR-003",
    "integrity_status"
  );
  expect(validate(f03Event("F03-EVT-010", fatal, { error_code: "F03-ERR-001" })).accepted).toBe(true);
  expect(validate(f03Event("F03-EVT-010", fatal)).accepted).toBe(true);
}

function expectContextRules(): void {
  const contextCases: readonly (readonly [string, unknown])[] = [
    ["blueprint_hash", "sha256:ABC"],
    ["capability_id", "Not.Canonical"],
    ["error_code", "e1"],
    ["policy_rule_id", "-rule"],
    ["trace_id", "0".repeat(32)]
  ];
  for (const [field, value] of contextCases) {
    expectRejected({ ...validEvent(), [field]: value }, "F07-ERR-003", "context");
  }
  expect(validate({
    ...validEvent(),
    blueprint_hash: SHA256,
    capability_id: "share.restore",
    error_code: "F05-ERR-001",
    policy_rule_id: "F07-POL-001",
    trace_id: "4bf92f3577b34da6a3ce929d0e0e4736"
  }).accepted).toBe(true);
  expectRejected({ ...validEvent(), function_id: "F5" }, "F07-ERR-003", "function_id");
  expectRejected({ ...validEvent(), event_type: "f05-evt-007" }, "F07-ERR-003", "event_type");
  expectRejected({ ...validEvent(), occurred_at: "2026-09-27" }, "F07-ERR-003", "occurred_at");
  expectRejected({ ...validEvent(), event_id: undefined }, "F07-ERR-003", "context");
  expectRejected({ ...validEvent(), received_at: "2026-09-27T01:23:45.000Z" }, "F07-ERR-003", null);
}

class RecordingIdentities implements AnonymousIdentityRepository {
  public async ensure(): Promise<"ACTIVE"> {
    return "ACTIVE";
  }

  public async refreshLastSeen(): Promise<void> {
    return undefined;
  }
}

class RecordingProductEvents implements EvidenceRepository {
  public readonly eventIds: string[] = [];

  public async insert(event: EvidenceEventInput): Promise<EvidenceWriteResult> {
    this.eventIds.push(event.event_id);
    return "INSERTED";
  }
}

async function expectInvalidEventsNeverPersist(
  invalidEvents: readonly Record<string, unknown>[]
): Promise<void> {
  const productEvents = new RecordingProductEvents();
  const ingestion = new EvidenceIngestionService({
    anonymousIdentities: new RecordingIdentities(),
    evidence: productEvents,
    diagnostics: { reportNonBlockingFailure: () => undefined },
    now: () => new Date("2026-09-27T01:24:00.000Z")
  });

  const result = await ingestion.ingest([
    ...invalidEvents,
    { ...validEvent(), event_id: PERSISTED_EVENT_ID }
  ]);

  expect(result).toMatchObject({ accepted: 1, rejected: invalidEvents.length });
  expect(productEvents.eventIds).toEqual([PERSISTED_EVENT_ID]);
}

describe("locked evidence event intake contract", () => {
  test("TEST-F07-006 rejects an unknown event_type", () => {
    const event = { ...validEvent(), event_type: "F05-EVT-999" };

    expect(validate(event)).toEqual({
      accepted: false,
      rejection: {
        event_id: EVENT_ID,
        code: "F07-ERR-004",
        field: "event_type"
      }
    });
  });

  test("TEST-F07-AC-007 rejects function_id and event_type registry mismatch", () => {
    const event = { ...validEvent(), function_id: "F06" };

    expect(validate(event)).toEqual({
      accepted: false,
      rejection: {
        event_id: EVENT_ID,
        code: "F07-ERR-014",
        field: "function_id"
      }
    });
  });

  test("TEST-F07-008 revalidates intake against Evidence Registry v3 envelope, ownership, schema and narrowing", async () => {
    const validTimeout = f03Event("F03-EVT-014", {
      runtime_status: "RECOVERABLE_ERROR",
      operation_status: "TIMED_OUT",
      integrity_status: "PROVEN"
    });
    expect(validate(validTimeout).accepted).toBe(true);
    const invalidEvents = invalidF03IntakeEvents(validTimeout);
    for (const invalid of invalidEvents) {
      expect(validate(invalid).accepted).toBe(false);
    }

    expectEnvelopeUuidRules();
    expectSchemaVersionRules();
    expectPropertyOwnershipRules();
    expectPropertySchemaRules();
    expectEnvelopeAwareRules();
    expectContextRules();
    await expectInvalidEventsNeverPersist([
      ...invalidEvents,
      { ...validEvent(), event_id: NON_V4_UUIDS.v1 },
      { ...validEvent(), anonymous_id: NON_V4_UUIDS.v5 },
      { ...validEvent(), properties: { share_mode: "DURABLE_REFERENCE", error_code: "F05-ERR-001" } }
    ]);
  });

  test("TEST-F07-009 accepts evidence without raw Intent or Result and rejects either raw form", () => {
    expect(validate(validEvent()).accepted).toBe(true);

    const withRawIntent = { ...validEvent(), raw_intent: "build my private app" };
    const withRawResult = {
      ...validEvent(),
      properties: { share_mode: { result: "private output" } }
    };
    const rawIntentUnderAllowedKey = {
      ...validEvent(),
      properties: { share_mode: "build my private app" }
    };

    expect(validate(withRawIntent)).toMatchObject({
      accepted: false,
      rejection: { code: "F07-ERR-003" }
    });
    expect(validate(withRawResult)).toMatchObject({
      accepted: false,
      rejection: { code: "F07-ERR-005", field: "share_mode" }
    });
    expect(validate(rawIntentUnderAllowedKey)).toMatchObject({
      accepted: false,
      rejection: { code: "F07-ERR-003", field: "share_mode" }
    });
  });
});

describe("locked evidence payload and context bounds", () => {
  test("TEST-F07-AC-012 enforces event, properties, string and nesting bounds", () => {
    const oversizedEvent = {
      ...validEvent(),
      properties: { share_mode: "x".repeat(8 * 1024) }
    };
    const oversizedProperties = {
      ...validEvent(),
      properties: { share_mode: "x".repeat(4 * 1024) }
    };
    const oversizedString = {
      ...validEvent(),
      properties: { share_mode: "x".repeat(257) }
    };
    const excessiveDepth = {
      ...validEvent(),
      properties: {
        share_mode: { level_one: { level_two: { level_three: true } } }
      }
    };

    for (const event of [
      oversizedEvent,
      oversizedProperties,
      oversizedString,
      excessiveDepth
    ]) {
      expect(validate(event)).toMatchObject({
        accepted: false,
        rejection: { code: "F07-ERR-006" }
      });
    }
  });

  test("rejects unsupported schema versions and malformed context identifiers", () => {
    expect(validate({ ...validEvent(), schema_version: "1.0.0" })).toMatchObject({
      accepted: false,
      rejection: { code: "F07-ERR-003", field: "schema_version" }
    });
    expect(validate({ ...validEvent(), share_id: "not-a-uuid" })).toMatchObject({
      accepted: false,
      rejection: { code: "F07-ERR-003", field: "context" }
    });
  });

  test("rejects a malformed anonymous_id as ANONYMOUS_ID_INVALID without treating null as invalid", () => {
    expect(validate({ ...validEvent(), anonymous_id: "not-a-uuid" })).toEqual({
      accepted: false,
      rejection: {
        event_id: EVENT_ID,
        code: "F07-ERR-001",
        field: "anonymous_id"
      }
    });
    expect(validate({ ...validEvent(), anonymous_id: null }).accepted).toBe(true);
  });
});
