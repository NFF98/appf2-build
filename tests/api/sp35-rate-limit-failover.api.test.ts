import { describe, expect, it, vi } from "vitest";
import { appf2ModelFallbackConfig } from "../../src/platform/compiler/appf2-model-provider.js";
import { RateLimitFailoverGateway } from "../../src/platform/compiler/rate-limit-failover-gateway.js";
import type { ModelGateway, ModelGatewayRequest, ModelGatewayResponse } from "../../src/platform/compiler/model-gateway.js";

const env = {
  APPF2_MODEL_PROVIDER: "openai",
  APPF2_MODEL_API_KEY: "private-primary",
  APPF2_MODEL_BASE_URL: "https://api.openai.com/v1",
  APPF2_MODEL_NAME: "gpt-4.1",
  APPF2_XAI_API_KEY: "private-xai",
  APPF2_XAI_MODEL_NAME: "grok-test",
  APPF2_DEEPSEEK_API_KEY: "private-deepseek",
  APPF2_DEEPSEEK_MODEL_NAME: "deepseek-test"
};
const request: ModelGatewayRequest = {
  operation: "BLUEPRINT_COMPOSE",
  prompt_version: "v1",
  response_schema: { type: "object" },
  input_payload: { user_request: "Add task" },
  timeout_ms: 10_000,
  trace_id: "trace",
  provider_policy: { max_attempts: 2, structured_output: "JSON_SCHEMA" }
};
const ok: ModelGatewayResponse = {
  status: "SUCCEEDED", structured_output: { ok: true },
  latency_ms: 600, provider_metadata: { model_adapter: "openai-compatible", provider_model: "backup" }
};
function failed(kind: "RATE_LIMITED" | "PROVIDER_5XX" | "TIMEOUT", latency_ms = 500): ModelGatewayResponse {
  return { status: "FAILED", latency_ms, failure: { kind },
    provider_metadata: { model_adapter: "openai-compatible", provider_model: "main" } };
}
function gateway(result: ModelGatewayResponse) {
  const composeBlueprint = vi.fn(async (requestValue: ModelGatewayRequest) => { void requestValue; return result; });
  const analyzeIntent = vi.fn(async (_request: ModelGatewayRequest) => result);
  const model: ModelGateway = {
    modelAdapter: "openai-compatible", composeBlueprint, analyzeIntent,
    health: async () => ({ status: "OK", model_adapter: "openai-compatible" })
  };
  return { model, composeBlueprint, analyzeIntent };
}

describe("Sprint 3.5 explicit, time-bounded upstream 429 fallback", () => {
  it("does not enable a fallback merely because other keys are present", () => {
    expect(appf2ModelFallbackConfig(env)).toBeUndefined();
    expect(appf2ModelFallbackConfig({ ...env, APPF2_MODEL_FALLBACK_PROVIDER: "  " })).toBeUndefined();
  });

  it("requires explicit permission and key/model for xAI, DeepSeek", () => {
    expect(appf2ModelFallbackConfig({ ...env, APPF2_MODEL_FALLBACK_PROVIDER: "xai" }))
      .toMatchObject({ provider: "xai", config: { baseUrl: "https://api.x.ai/v1", model: "grok-test" } });
    expect(appf2ModelFallbackConfig({ ...env, APPF2_MODEL_FALLBACK_PROVIDER: "deepseek" }))
      .toMatchObject({ provider: "deepseek", config: { outputFormat: "json_object" } });
    expect(() => appf2ModelFallbackConfig({
      ...env, APPF2_MODEL_FALLBACK_PROVIDER: "xai", APPF2_XAI_API_KEY: ""
    })).toThrow("APPF2_XAI_API_KEY");
    expect(() => appf2ModelFallbackConfig({
      ...env, APPF2_MODEL_FALLBACK_PROVIDER: "openai"
    })).toThrow("APPF2_MODEL_FALLBACK_PROVIDER");
    expect(() => appf2ModelFallbackConfig({
      ...env, APPF2_MODEL_PROVIDER: "xai", APPF2_MODEL_FALLBACK_PROVIDER: "xai"
    })).toThrow("must differ");
  });

  it("retries once through explicit backup after 429 with remaining time only", async () => {
    const primary = gateway(failed("RATE_LIMITED", 2_500));
    const backup = gateway(ok);
    const model = new RateLimitFailoverGateway(primary.model, backup.model);
    expect(await model.composeBlueprint(request)).toMatchObject({
      status: "SUCCEEDED", latency_ms: 3_100
    });
    expect(primary.composeBlueprint).toHaveBeenCalledTimes(1);
    expect(backup.composeBlueprint).toHaveBeenCalledTimes(1);
    expect(backup.composeBlueprint).toHaveBeenCalledWith({
      ...request, timeout_ms: 7_500
    });
  });

  it("never sends unrelated failures, timeouts, success, or near-expired 429 to alternate", async () => {
    for (const result of [failed("PROVIDER_5XX"), failed("TIMEOUT"), failed("RATE_LIMITED", 9_000), ok]) {
      const primary = gateway(result);
      const backup = gateway(ok);
      const model = new RateLimitFailoverGateway(primary.model, backup.model);
      expect(await model.analyzeIntent(request)).toEqual(result);
      expect(backup.analyzeIntent).not.toHaveBeenCalled();
    }
  });

  it("does not replay on backup failure or keep retrying a 429 loop", async () => {
    const primary = gateway(failed("RATE_LIMITED", 250));
    const backup = gateway(failed("RATE_LIMITED", 500));
    const model = new RateLimitFailoverGateway(primary.model, backup.model);
    expect(await model.composeBlueprint(request)).toMatchObject({
      status: "FAILED", latency_ms: 750, failure: { kind: "RATE_LIMITED" }
    });
    expect(primary.composeBlueprint).toHaveBeenCalledTimes(1);
    expect(backup.composeBlueprint).toHaveBeenCalledTimes(1);
  });
});
