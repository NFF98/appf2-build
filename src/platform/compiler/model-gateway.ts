import type { JsonRecord, JsonValue } from "../intent/json-value.js";

/** F01-RQ-007 appf2-owned operations; provider/model are operational metadata only. */
export type ModelOperation = "INTENT_ANALYSIS" | "BLUEPRINT_COMPOSE";

export type ProviderPolicy = {
  readonly max_attempts: number;
  readonly structured_output: "JSON_SCHEMA";
};

export type ModelGatewayRequest = {
  readonly operation: ModelOperation;
  readonly prompt_version: string;
  readonly response_schema: JsonRecord;
  readonly input_payload: JsonRecord;
  readonly timeout_ms: number;
  readonly trace_id: string;
  readonly provider_policy: ProviderPolicy;
};

/**
 * Adapter-normalised failure kinds. Only NETWORK / RATE_LIMITED / PROVIDER_5XX and the first INVALID_OUTPUT
 * are retryable (F01-POL-007); TIMEOUT and REJECTED_REQUEST never auto-retry.
 */
export type ModelFailureKind = "NETWORK" | "RATE_LIMITED" | "PROVIDER_5XX" | "TIMEOUT" | "INVALID_OUTPUT" | "REJECTED_REQUEST";

export type ModelFailure = {
  readonly kind: ModelFailureKind;
  readonly retry_after_seconds?: number;
};

export type ProviderMetadata = {
  readonly model_adapter: string;
  readonly provider_model: string | null;
};

export type TokenUsage = {
  readonly input_tokens: number | null;
  readonly output_tokens: number | null;
};

export type ModelGatewayResponse = {
  readonly status: "SUCCEEDED" | "FAILED";
  readonly structured_output?: JsonValue;
  readonly provider_metadata: ProviderMetadata;
  readonly token_usage?: TokenUsage;
  readonly latency_ms: number;
  readonly failure?: ModelFailure;
  /** Optional economics evidence computed server-side from adapter pricing config; never a provider payload. */
  readonly estimated_cost?: number | null;
};

export type ModelGatewayHealth = {
  readonly status: "OK" | "UNAVAILABLE";
  readonly model_adapter: string;
};

export interface ModelGateway {
  readonly modelAdapter: string;
  analyzeIntent(request: ModelGatewayRequest): Promise<ModelGatewayResponse>;
  composeBlueprint(request: ModelGatewayRequest): Promise<ModelGatewayResponse>;
  health(): Promise<ModelGatewayHealth>;
}

/** F01-POL-007 Phase 1 timeouts and attempt ceiling. */
export const MODEL_OPERATION_TIMEOUT_MS: Readonly<Record<ModelOperation, number>> = Object.freeze({
  INTENT_ANALYSIS: 15_000,
  BLUEPRINT_COMPOSE: 20_000
});
export const MAX_PROVIDER_ATTEMPTS = 2;

export const DEFAULT_PROVIDER_POLICY: ProviderPolicy = Object.freeze({
  max_attempts: MAX_PROVIDER_ATTEMPTS,
  structured_output: "JSON_SCHEMA"
});

export function isRetryableFailure(kind: ModelFailureKind, attemptNo: number): boolean {
  if (attemptNo >= MAX_PROVIDER_ATTEMPTS) return false;
  return kind === "NETWORK" || kind === "RATE_LIMITED" || kind === "PROVIDER_5XX" || (kind === "INVALID_OUTPUT" && attemptNo === 1);
}

/** Server route budget (F01 §23); every provider attempt is clipped to what is left of it. */
export class RequestDeadline {
  private readonly deadlineMs: number;

  public constructor(budgetMs: number, private readonly clock: () => number) {
    this.deadlineMs = clock() + budgetMs;
  }

  public remainingMs(): number {
    return Math.max(0, this.deadlineMs - this.clock());
  }

  public attemptTimeoutMs(operation: ModelOperation): number {
    return Math.min(MODEL_OPERATION_TIMEOUT_MS[operation], this.remainingMs());
  }
}
