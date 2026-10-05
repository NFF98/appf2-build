import type {
  AnonymousIdentityRepository,
  AnonymousIdentityStatus,
  EvidenceIngestionDiagnostics,
  EvidenceRepository
} from "./evidence-repository.js";
import type {
  EvidenceBatchResult,
  EvidenceIntakeDiagnostic,
  EvidenceRejection
} from "./evidence-types.js";
import {
  clockInvalidDiagnostic,
  isClockInvalid
} from "./evidence-clock.js";
import { isProductionDeliverable } from "./evidence-queue-policy.js";
import { lockedEvidenceRegistry, type EvidenceRegistry } from "./evidence-registry.js";
import { validateEvidenceEvent } from "./evidence-validator.js";

export interface EvidenceIngestionDependencies {
  readonly anonymousIdentities: AnonymousIdentityRepository;
  readonly evidence: EvidenceRepository;
  readonly diagnostics: EvidenceIngestionDiagnostics;
  readonly now: () => Date;
  readonly registry?: EvidenceRegistry;
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
  private readonly registry: EvidenceRegistry;

  public constructor(private readonly dependencies: EvidenceIngestionDependencies) {
    this.registry = dependencies.registry ?? lockedEvidenceRegistry;
  }

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
      const validation = validateEvidenceEvent(candidate, serialized ?? "", this.registry);
      if (!validation.accepted) {
        rejections.push(validation.rejection);
        continue;
      }
      // F07-RQ-009 step 13: collection-class production policy runs before identity ensure and
      // product_event insert, so a DEBUG_ONLY event never touches either.
      const entry = this.registry.find(validation.event.event_type);
      if (entry !== undefined && !isProductionDeliverable(entry.collectionClass)) {
        rejections.push(rejected(candidate, "F07-ERR-016"));
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

    return {
      accepted,
      duplicates,
      rejected: rejections.length,
      rejections,
      diagnostics
    };
  }
}
