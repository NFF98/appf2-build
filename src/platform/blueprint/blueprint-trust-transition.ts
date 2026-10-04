import { canonicalTraceId, emitF02Evidence, isCanonicalTraceId, trustTransitionEvent, type F02EvidenceOptions } from "./validation-evidence.js";

export type TerminalTrustStatus = "REVOKED" | "INCOMPATIBLE";

const CONTENT_HASH = /^sha256:[0-9a-f]{64}$/;
const TERMINAL_STATUSES: ReadonlySet<string> = new Set<TerminalTrustStatus>(["REVOKED", "INCOMPATIBLE"]);

/** Controlled transition input (F02 §34): the only accepted shape is VALIDATED → terminal status. */
export interface TrustTransitionRequest {
  readonly content_hash: string;
  readonly previous_status: "VALIDATED";
  readonly new_status: TerminalTrustStatus;
  readonly trace_id: string;
}

export type TrustTransitionWriteOutcome =
  | { readonly kind: "TRANSITIONED"; readonly schema_version: string; readonly registry_version: string }
  | { readonly kind: "STATUS_MISMATCH" }
  | { readonly kind: "UNKNOWN_CONTENT" };

/** Repository boundary: compare-and-set only; there is deliberately no arbitrary trust_status writer. */
export interface BlueprintTrustTransitionRepository {
  compareAndSetTrustStatus(request: TrustTransitionRequest): Promise<TrustTransitionWriteOutcome>;
}

export interface TrustTransitionContext {
  /** Server tracing context; kept only when F07-canonical, otherwise replaced. */
  readonly traceId?: string;
}

export type TrustTransitionResult =
  | {
      readonly status: "TRANSITIONED";
      readonly content_hash: string;
      readonly previous_status: "VALIDATED";
      readonly new_status: TerminalTrustStatus;
      readonly trace_id: string;
    }
  | {
      readonly status: "NOT_TRANSITIONED";
      readonly reason: "UNKNOWN_CONTENT" | "STATUS_MISMATCH";
      readonly content_hash: string;
      readonly trace_id: string;
    };

/** Server/governance/deployment-owned configuration; public callers never reach this service. */
export interface TrustTransitionServiceConfig {
  readonly repository: BlueprintTrustTransitionRepository;
  readonly evidence: F02EvidenceOptions;
}

/** Each method fixes its own target status, so no caller input can choose trust_status. */
export interface BlueprintTrustTransitionService {
  revoke(contentHash: string, context?: TrustTransitionContext): Promise<TrustTransitionResult>;
  markIncompatible(contentHash: string, context?: TrustTransitionContext): Promise<TrustTransitionResult>;
}

export function isCanonicalContentHash(value: unknown): value is string {
  return typeof value === "string" && CONTENT_HASH.test(value);
}

/** Repository-side guard: rejects any request that is not a canonical VALIDATED → terminal CAS before I/O. */
export function assertTrustTransitionRequest(request: TrustTransitionRequest): void {
  if (
    !isCanonicalContentHash(request.content_hash) ||
    request.previous_status !== "VALIDATED" ||
    !TERMINAL_STATUSES.has(request.new_status) ||
    !isCanonicalTraceId(request.trace_id)
  ) {
    throw new TypeError("Trust transition must be a canonical VALIDATED → REVOKED | INCOMPATIBLE compare-and-set.");
  }
}

async function transition(
  config: TrustTransitionServiceConfig,
  contentHash: unknown,
  newStatus: TerminalTrustStatus,
  context: TrustTransitionContext | undefined
): Promise<TrustTransitionResult> {
  const traceId = canonicalTraceId(context?.traceId);
  if (!isCanonicalContentHash(contentHash)) {
    return { status: "NOT_TRANSITIONED", reason: "UNKNOWN_CONTENT", content_hash: String(contentHash), trace_id: traceId };
  }
  const outcome = await config.repository.compareAndSetTrustStatus({
    content_hash: contentHash,
    previous_status: "VALIDATED",
    new_status: newStatus,
    trace_id: traceId
  });
  if (outcome.kind !== "TRANSITIONED") {
    return { status: "NOT_TRANSITIONED", reason: outcome.kind, content_hash: contentHash, trace_id: traceId };
  }
  // Durable trust truth is already committed; Evidence is attempted afterwards and can never roll it back.
  await emitF02Evidence(config.evidence, [
    trustTransitionEvent({
      new_status: newStatus,
      content_hash: contentHash,
      schema_version: outcome.schema_version,
      registry_version: outcome.registry_version,
      trace_id: traceId
    })
  ]);
  return { status: "TRANSITIONED", content_hash: contentHash, previous_status: "VALIDATED", new_status: newStatus, trace_id: traceId };
}

export function createBlueprintTrustTransitionService(config: TrustTransitionServiceConfig): BlueprintTrustTransitionService {
  if (typeof config.repository?.compareAndSetTrustStatus !== "function" || typeof config.evidence?.intake?.ingest !== "function") {
    throw new TypeError("Trust transition service requires a CAS repository and an F07 evidence intake.");
  }
  return Object.freeze({
    revoke: (contentHash: string, context?: TrustTransitionContext) => transition(config, contentHash, "REVOKED", context),
    markIncompatible: (contentHash: string, context?: TrustTransitionContext) =>
      transition(config, contentHash, "INCOMPATIBLE", context)
  });
}
