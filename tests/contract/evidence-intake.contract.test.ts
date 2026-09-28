import { describe, expect, test } from "vitest";

import { validateEvidenceEvent } from "../../src/platform/evidence/evidence-validator.js";

const EVENT_ID = "123e4567-e89b-42d3-a456-426614174000";
const SHARE_ID = "223e4567-e89b-42d3-a456-426614174000";

function validEvent(): Record<string, unknown> {
  return {
    event_id: EVENT_ID,
    event_type: "F05-EVT-007",
    schema_version: "1.0.0",
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
    { ...validTimeout, schema_version: "1.0.0" },
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
  schemaVersion = "2.0.0"
): Record<string, unknown> {
  return {
    event_id: EVENT_ID,
    event_type: eventType,
    schema_version: schemaVersion,
    occurred_at: "2026-09-27T01:23:45.000Z",
    anonymous_id: null,
    session_id: null,
    function_id: "F03",
    properties
  };
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

  test("TEST-F07-008 enforces property allowlist, schema and F03 narrowing", () => {
    const forbiddenName = {
      ...validEvent(),
      properties: {
        share_mode: "DURABLE_REFERENCE",
        correction_text: "private user content"
      }
    };
    expect(validate(forbiddenName)).toEqual({
      accepted: false,
      rejection: {
        event_id: EVENT_ID,
        code: "F07-ERR-005",
        field: "correction_text"
      }
    });
    for (const shareMode of [42, "PRIVATE_MEDICAL_RESULT"]) {
      expect(
        validate({ ...validEvent(), properties: { share_mode: shareMode } })
      ).toMatchObject({
        accepted: false,
        rejection: { code: "F07-ERR-003", field: "share_mode" }
      });
    }

    const validTimeout = f03Event("F03-EVT-014", {
      runtime_status: "RECOVERABLE_ERROR",
      operation_status: "TIMED_OUT",
      integrity_status: "PROVEN"
    });
    expect(validate(validTimeout).accepted).toBe(true);
    expect(
      validate(
        f03Event("F03-EVT-010", {
          error_code: "F03-ERR-018",
          integrity_status: "CORRUPTED",
          runtime_status: "FATAL_ERROR",
          operation_status: "FAILED"
        })
      ).accepted
    ).toBe(true);
    for (const invalid of invalidF03IntakeEvents(validTimeout)) {
      expect(validate(invalid).accepted).toBe(false);
    }
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
    expect(validate({ ...validEvent(), schema_version: "2.0.0" })).toMatchObject({
      accepted: false,
      rejection: { code: "F07-ERR-003", field: "schema_version" }
    });
    expect(validate({ ...validEvent(), share_id: "not-a-uuid" })).toMatchObject({
      accepted: false,
      rejection: { code: "F07-ERR-003", field: "context" }
    });
  });
});
