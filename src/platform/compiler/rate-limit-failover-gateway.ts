import type {
  ModelGateway, ModelGatewayHealth, ModelGatewayRequest, ModelGatewayResponse
} from "./model-gateway.js";

/** A single consented alternative, attempted only after a verified upstream 429.
 * Never retries rejected, invalid, or timed-out requests or silently sends data
 * to another provider. Existing per-operation deadline remains authoritative. */
export class RateLimitFailoverGateway implements ModelGateway {
  public readonly modelAdapter: string;

  public constructor(
    private readonly primary: ModelGateway,
    private readonly alternate: ModelGateway
  ) {
    this.modelAdapter = primary.modelAdapter;
  }

  public health(): Promise<ModelGatewayHealth> {
    return this.primary.health();
  }

  public analyzeIntent(request: ModelGatewayRequest): Promise<ModelGatewayResponse> {
    return this.complete("analyzeIntent", request);
  }

  public composeBlueprint(request: ModelGatewayRequest): Promise<ModelGatewayResponse> {
    return this.complete("composeBlueprint", request);
  }

  private async complete(
    operation: "analyzeIntent" | "composeBlueprint", request: ModelGatewayRequest
  ): Promise<ModelGatewayResponse> {
    const first = await this.primary[operation](request);
    if (first.status !== "FAILED" || first.failure?.kind !== "RATE_LIMITED") return first;
    const remaining = request.timeout_ms - first.latency_ms;
    // Do not replay after the budget is effectively consumed.
    if (!Number.isFinite(remaining) || remaining < 2_000) return first;
    const second = await this.alternate[operation]({ ...request, timeout_ms: remaining });
    return { ...second, latency_ms: first.latency_ms + second.latency_ms };
  }
}
