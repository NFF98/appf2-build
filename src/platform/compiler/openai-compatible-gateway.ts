import type { JsonValue } from "../intent/json-value.js";
import { isJsonValue, isPlainRecord } from "../intent/json-value.js";
import type {
  ModelFailureKind,
  ModelGateway,
  ModelGatewayHealth,
  ModelGatewayRequest,
  ModelGatewayResponse,
  TokenUsage
} from "./model-gateway.js";
import { SYSTEM_POLICY } from "./prompts.js";

export const OPENAI_COMPATIBLE_ADAPTER_ID = "openai-compatible";

/** Server-only env names; deliberately not VITE_/PUBLIC_-prefixed so no browser bundle can inline them. */
export const MODEL_GATEWAY_ENV = Object.freeze({
  baseUrl: "APPF2_MODEL_BASE_URL",
  apiKey: "APPF2_MODEL_API_KEY",
  model: "APPF2_MODEL_NAME",
  inputCostPerMillion: "APPF2_MODEL_INPUT_COST_PER_MILLION",
  outputCostPerMillion: "APPF2_MODEL_OUTPUT_COST_PER_MILLION"
});

export type ModelPricing = {
  readonly input_per_million: number;
  readonly output_per_million: number;
};

export type OpenAiCompatibleConfig = {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly pricing?: ModelPricing;
  /** DeepSeek ChatCompletions supports JSON object mode; keep schema mode for OpenAI/xAI. */
  readonly outputFormat?: "json_schema" | "json_object";
};

export type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string; signal: AbortSignal }) => Promise<{
  readonly status: number;
  readonly headers: { get(name: string): string | null };
  text(): Promise<string>;
}>;

export class ModelGatewayConfigError extends Error {
  public constructor(missing: readonly string[]) {
    super(`Model gateway server configuration is missing: ${missing.join(", ")}.`);
    this.name = "ModelGatewayConfigError";
  }
}

function pricingFrom(env: Readonly<Record<string, string | undefined>>): ModelPricing | undefined {
  const input = Number(env[MODEL_GATEWAY_ENV.inputCostPerMillion]);
  const output = Number(env[MODEL_GATEWAY_ENV.outputCostPerMillion]);
  return Number.isFinite(input) && Number.isFinite(output) && input >= 0 && output >= 0 && env[MODEL_GATEWAY_ENV.inputCostPerMillion] !== undefined
    ? { input_per_million: input, output_per_million: output }
    : undefined;
}

/** Reads server env only; the error names missing variables and never echoes a configured value. */
export function openAiCompatibleConfigFromEnv(env: Readonly<Record<string, string | undefined>>): OpenAiCompatibleConfig {
  const baseUrl = env[MODEL_GATEWAY_ENV.baseUrl]?.trim() ?? "";
  const apiKey = env[MODEL_GATEWAY_ENV.apiKey]?.trim() ?? "";
  const model = env[MODEL_GATEWAY_ENV.model]?.trim() ?? "";
  const missing = [
    [MODEL_GATEWAY_ENV.baseUrl, baseUrl],
    [MODEL_GATEWAY_ENV.apiKey, apiKey],
    [MODEL_GATEWAY_ENV.model, model]
  ].filter(([, value]) => value === "").map(([name]) => name as string);
  if (missing.length > 0) throw new ModelGatewayConfigError(missing);
  const pricing = pricingFrom(env);
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, model, ...(pricing === undefined ? {} : { pricing }) };
}

/** Never log provider body, arbitrary error strings, request IDs or secrets. */
const SAFE_UPSTREAM_429_CODES = new Set([
  "rate_limit_exceeded", "insufficient_quota", "credit_balance_exhausted",
  "organization_usage_limit_exceeded", "organization_spend_limit_exceeded",
  "project_spend_limit_exceeded"
]);

export function safeUpstream429Code(body: unknown): string {
  if (!isPlainRecord(body) || !isPlainRecord(body.error)) return "unknown";
  const code = body.error.code;
  if (typeof code === "string" && SAFE_UPSTREAM_429_CODES.has(code)) return code;
  return body.error.type === "insufficient_quota" ? "insufficient_quota" : "unknown";
}

function failureKindForStatus(status: number): ModelFailureKind {
  if (status === 429) return "RATE_LIMITED";
  if (status >= 500) return "PROVIDER_5XX";
  return "REJECTED_REQUEST";
}

function retryAfterSeconds(header: string | null): number | undefined {
  const seconds = header === null ? Number.NaN : Number(header);
  return Number.isInteger(seconds) && seconds >= 0 ? seconds : undefined;
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;
}

type ParsedCompletion = { readonly output: JsonValue | undefined; readonly usage: TokenUsage; readonly providerModel: string | null };

/** Only the first choice's JSON content becomes (untrusted) structured output; raw provider text is discarded. */
function parseCompletion(body: unknown): ParsedCompletion {
  const record = isPlainRecord(body) ? body : {};
  const usage = isPlainRecord(record.usage) ? record.usage : {};
  const choices = Array.isArray(record.choices) ? record.choices : [];
  const first: unknown = choices[0];
  const message = isPlainRecord(first) && isPlainRecord(first.message) ? first.message : {};
  const content = typeof message.content === "string" ? parseJson(message.content) : undefined;
  return {
    output: isPlainRecord(content) && isJsonValue(content) ? content : undefined,
    usage: { input_tokens: nonNegativeInteger(usage.prompt_tokens), output_tokens: nonNegativeInteger(usage.completion_tokens) },
    providerModel: typeof record.model === "string" ? record.model.slice(0, 128) : null
  };
}

export class OpenAiCompatibleModelGateway implements ModelGateway {
  public readonly modelAdapter = OPENAI_COMPATIBLE_ADAPTER_ID;

  public constructor(
    private readonly config: OpenAiCompatibleConfig,
    // Workers' native fetch requires its global receiver. Never invoke a saved
    // unbound native fetch as this.fetchImpl (Illegal invocation / TypeError).
    private readonly fetchImpl: FetchLike = (url, init) => globalThis.fetch(url, init),
    private readonly clock: () => number = Date.now
  ) {}

  public analyzeIntent(request: ModelGatewayRequest): Promise<ModelGatewayResponse> {
    return this.complete(request);
  }

  public composeBlueprint(request: ModelGatewayRequest): Promise<ModelGatewayResponse> {
    return this.complete(request);
  }

  public async health(): Promise<ModelGatewayHealth> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5_000);
    try {
      const response = await this.fetchImpl(`${this.config.baseUrl}/models`, { method: "GET", headers: this.headers(), signal: controller.signal });
      return { status: response.status < 400 ? "OK" : "UNAVAILABLE", model_adapter: this.modelAdapter };
    } catch {
      return { status: "UNAVAILABLE", model_adapter: this.modelAdapter };
    } finally {
      clearTimeout(timer);
    }
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.config.apiKey}`, "Content-Type": "application/json" };
  }

  private requestBody(request: ModelGatewayRequest): string {
    return JSON.stringify({
      model: this.config.model,
      temperature: 0,
      messages: [
        { role: "system", content: SYSTEM_POLICY[request.operation] },
        { role: "user", content: JSON.stringify(request.input_payload) }
      ],
      response_format: this.config.outputFormat === "json_object"
        ? { type: "json_object" }
        : {
          type: "json_schema",
          json_schema: { name: request.operation.toLowerCase(), strict: false, schema: request.response_schema }
        }
    });
  }

  private estimatedCost(usage: TokenUsage): number | null {
    const pricing = this.config.pricing;
    if (pricing === undefined || usage.input_tokens === null || usage.output_tokens === null) return null;
    return (usage.input_tokens * pricing.input_per_million + usage.output_tokens * pricing.output_per_million) / 1_000_000;
  }

  private async complete(request: ModelGatewayRequest): Promise<ModelGatewayResponse> {
    const started = this.clock();
    const metadata = { model_adapter: this.modelAdapter, provider_model: this.config.model };
    const failed = (kind: ModelFailureKind, retryAfter?: number): ModelGatewayResponse => ({
      status: "FAILED",
      provider_metadata: metadata,
      latency_ms: Math.max(0, this.clock() - started),
      failure: retryAfter === undefined ? { kind } : { kind, retry_after_seconds: retryAfter }
    });
    if (request.timeout_ms <= 0) return failed("TIMEOUT");
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), request.timeout_ms);
    try {
      // One bounded retry ONLY for an explicitly identified transient provider
      // rate limit. Never retry exhausted billing/quota, unknown 429, or other
      // failures. Keep the operation's original deadline and attempt policy.
      const maxAttempts = Math.min(2, request.provider_policy.max_attempts);
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const response = await this.fetchImpl(`${this.config.baseUrl}/chat/completions`, {
          method: "POST",
          headers: this.headers(),
          body: this.requestBody(request),
          signal: controller.signal
        });
        if (response.status < 200 || response.status >= 300) {
          // Safe diagnostics only: never log request payload, provider body or bearer key.
          console.warn("APPF2_MODEL_UPSTREAM_STATUS=" + response.status);
          const after = retryAfterSeconds(response.headers.get("retry-after"));
          if (response.status === 429) {
            const raw = await response.text().catch(() => "");
            const code = raw.length <= 8192 ? safeUpstream429Code(parseJson(raw)) : "unknown";
            console.warn("APPF2_MODEL_UPSTREAM_429_CODE=" + code);
            const delay = (after ?? 1) * 1000;
            const remaining = request.timeout_ms - (this.clock() - started);
            if (code === "rate_limit_exceeded" && attempt + 1 < maxAttempts &&
                delay <= 2000 && remaining >= delay + 2000 && !controller.signal.aborted) {
              if (delay > 0) await new Promise<void>(resolve => setTimeout(resolve, delay));
              if (controller.signal.aborted) return failed("TIMEOUT");
              continue;
            }
          }
          return failed(failureKindForStatus(response.status), after);
        }
        const parsed = parseCompletion(parseJson(await response.text()));
        if (parsed.output === undefined) return { ...failed("INVALID_OUTPUT"), token_usage: parsed.usage };
        return {
          status: "SUCCEEDED",
          structured_output: parsed.output,
          provider_metadata: { ...metadata, provider_model: parsed.providerModel ?? this.config.model },
          token_usage: parsed.usage,
          latency_ms: Math.max(0, this.clock() - started),
          estimated_cost: this.estimatedCost(parsed.usage)
        };
      }
      return failed("RATE_LIMITED");
    } catch (error: unknown) {
      const kind = error instanceof Error ? error.name.replace(/[^A-Za-z]/gu, "").slice(0,32) : "UNKNOWN";
      console.warn("APPF2_MODEL_UPSTREAM_TRANSPORT=" + kind +
        " ABORTED=" + String(controller.signal.aborted));
      return failed(controller.signal.aborted ? "TIMEOUT" : "NETWORK");
    } finally {
      clearTimeout(timer);
    }
  }
}
