import type {
  EvidenceEventInput,
  EvidenceEventTimeProjection,
  EvidenceWriteResult
} from "./evidence-types.js";

export type AnonymousIdentityStatus = "ACTIVE" | "DISABLED";

export interface AnonymousIdentityRepository {
  ensure(anonymousId: string, seenAt: string): Promise<AnonymousIdentityStatus>;
  refreshLastSeen(anonymousId: string, seenAt: string): Promise<void>;
}

export interface EvidenceRepository {
  insert(
    event: EvidenceEventInput,
    receivedAt: string
  ): Promise<EvidenceWriteResult>;
}

export interface EvidenceIngestionDiagnostics {
  reportNonBlockingFailure(error: unknown): void;
}

export interface EvidenceEventTimeQuery {
  lookupByEventIds(
    eventIds: readonly string[]
  ): Promise<readonly EvidenceEventTimeProjection[]>;
}
