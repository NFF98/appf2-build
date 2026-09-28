import type { EvidenceIntakeDiagnostic } from "./evidence-types.js";

export const EVIDENCE_CLOCK_SKEW_LIMIT_MS = 10 * 60 * 1000;

export function isClockInvalid(occurredAt: string, receivedAt: string): boolean {
  return Date.parse(occurredAt) > Date.parse(receivedAt) + EVIDENCE_CLOCK_SKEW_LIMIT_MS;
}

export function effectiveEventAt(occurredAt: string, receivedAt: string): string {
  return isClockInvalid(occurredAt, receivedAt) ? receivedAt : occurredAt;
}

export function clockInvalidDiagnostic(eventId: string): EvidenceIntakeDiagnostic {
  return {
    event_id: eventId,
    code: "F07-ERR-013",
    field: "occurred_at",
    action: "USE_RECEIVED_AT"
  };
}
