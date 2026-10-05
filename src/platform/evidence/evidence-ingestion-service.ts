import type {
  AnonymousIdentityRepository,
  AnonymousIdentityStatus,
  EvidenceIngestionDiagnostics,
  EvidenceRepository
} from "./evidence-repository.js";
import type {
  EvidenceBatchResult,
  EvidenceIntakeDiagnostic,
  EvidenceRejection,
  EvidenceRejectionCode
} from "./evidence-types.js";
import {
  clockInvalidDiagnostic,
  isClockInvalid
} from "./evidence-clock.js";
import type {
  EvidenceIntakeObservation,
  EvidenceIntakeObserver
} from "./evidence-observability.js";
import { validateEvidenceEvent } from "./evidence-validator.js";

export interface EvidenceIngestionDependencies {
  readonly anonymousIdentities: AnonymousIdentityRepository;
  readonly evidence: EvidenceRepository;
  readonly diagnostics: EvidenceIngestionDiagnostics;
  readonly now: () => Date;
  readonly observer?: EvidenceIntakeObserver;
}

function intakeObservation(
  received: number,
  result: EvidenceBatchResult
): EvidenceIntakeObservation {
  const rejectionCodes: Partial<Record<EvidenceRejectionCode, number>> = {};
  for (const { code } of result.rejections) {
    rejectionCodes[code] = (rejectionCodes[code] ?? 0) + 1;
  }
  return {
    received,
    accepted: result.accepted,
    duplicates: result.duplicates,
    rejected: result.rejected,
    clock_invalid: result.diagnostics.length,
    rejection_codes: rejectionCodes
  };
}

function eventIdOf(event: unknown): string | null {
  if (typeof event !== "object" || event === null || !("event_id" in event)) {
    return null;
  }
  const eventId = event.event_id;
  return typeof eventId === "string" ? eventId : null;
}

function rejected(
  event: unknown,
  code: EvidenceRejection["code"],
  field: string | null = null
): EvidenceRejection {
  return { event_id: eventIdOf(event), code, field };
}

export class EvidenceIngestionService {
  public constructor(private readonly dependencies: EvidenceIngestionDependencies) {}

  private async ensureIdentity(
    anonymousId: string,
    receivedAt: string
  ): Promise<AnonymousIdentityStatus> {
    const status = await this.dependencies.anonymousIdentities.ensure(
      anonymousId,
      receivedAt
    );
    if (status === "ACTIVE") {
      try {
        await this.dependencies.anonymousIdentities.refreshLastSeen(
          anonymousId,
          receivedAt
        );
      } catch (error: unknown) {
        this.dependencies.diagnostics.reportNonBlockingFailure(error);
      }
    }
    return status;
  }

  public async ingest(events: readonly unknown[]): Promise<EvidenceBatchResult> {
    let accepted = 0;
    let duplicates = 0;
    const rejections: EvidenceRejection[] = [];
    const diagnostics: EvidenceIntakeDiagnostic[] = [];
    const identities = new Map<string, Promise<AnonymousIdentityStatus>>();

    for (const candidate of events) {
      const serialized = JSON.stringify(candidate);
      const validation = validateEvidenceEvent(candidate, serialized ?? "");
      if (!validation.accepted) {
        rejections.push(validation.rejection);
        continue;
      }

      const receivedAt = this.dependencies.now().toISOString();
      try {
        const anonymousId = validation.event.anonymous_id;
        if (anonymousId !== undefined && anonymousId !== null) {
          let identity = identities.get(anonymousId);
          if (identity === undefined) {
            identity = this.ensureIdentity(anonymousId, receivedAt);
            identities.set(anonymousId, identity);
          }
          if (await identity === "DISABLED") {
            rejections.push(
              rejected(candidate, "F07-ERR-002", "anonymous_id")
            );
            continue;
          }
        }
        const result = await this.dependencies.evidence.insert(
          validation.event,
          receivedAt
        );
        if (result === "INSERTED") {
          accepted += 1;
          if (isClockInvalid(validation.event.occurred_at, receivedAt)) {
            diagnostics.push(clockInvalidDiagnostic(validation.event.event_id));
          }
        } else if (result === "DUPLICATE") {
          duplicates += 1;
        } else {
          rejections.push(rejected(candidate, "F07-ERR-002", "anonymous_id"));
        }
      } catch (error: unknown) {
        this.dependencies.diagnostics.reportNonBlockingFailure(error);
        rejections.push(rejected(candidate, "F07-ERR-010"));
      }
    }

    const result: EvidenceBatchResult = {
      accepted,
      duplicates,
      rejected: rejections.length,
      rejections,
      diagnostics
    };
    this.observe(events.length, result);
    return result;
  }

  private observe(received: number, result: EvidenceBatchResult): void {
    const observer = this.dependencies.observer;
    if (observer === undefined) {
      return;
    }
    try {
      observer.observeIntake(intakeObservation(received, result));
    } catch (error: unknown) {
      this.dependencies.diagnostics.reportNonBlockingFailure(error);
    }
  }
}
