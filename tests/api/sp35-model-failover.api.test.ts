import { describe, expect, it, vi } from "vitest";
import { appf2ModelFallbackConfig, appf2ModelProviderConfig } from "../../src/platform/compiler/appf2-model-provider.js";
import { RateLimitFailoverGateway } from "../../src/platform/compiler/rate-limit-failover-gateway.js";
import type { ModelGateway, ModelGatewayRequest, ModelGatewayResponse } from "../../src/platform/compiler/model-gateway.js";

const request: ModelGatewayRequest = {
  operation: "BLUEPRINT_COMPOSE", prompt_version: "test", response_schema: {},
  input_payload: { title: "Tasks" }, timeout_ms: 10_000, trace_id: "trace",
  provider_policy: { max_attempts: 2, structured_output: "JSON_SCHEMA" }
};
const failed = (kind: "RATE_LIMITED" | "REJECTED_REQUEST" | "TIMEOUT", latency_ms = 100): ModelGatewayResponse => ({
  status: "FAILED", provider_metadata: { model_adapter: "openai-compatible", provider_model: "primary" },
  failure: { kind }, latency_ms
});
const successful: ModelGatewayResponse = {
  status: "SUCCEEDED", structured_output: { ok: true },
  provider_metadata: { model_adapter: "openai-compatible", provider_model: "grok" }, latency_ms: 350
};
function gateway(reply: ModelGatewayResponse): ModelGateway & {
  composeBlueprint: ReturnType<typeof vi.fn>;
} {
  return {
    modelAdapter: "openai-compatible",
    analyzeIntent: vi.fn().mockResolvedValue(reply),
    composeBlueprint: vi.fn().mockResolvedValue(reply),
    health: vi.fn().mockResolvedValue({ status: "OK", model_adapter: "openai-compatible" })
  };
}
const env = {
  APPF2_MODEL_API_KEY: "fake-openai-secret", APPF2_MODEL_NAME: "gpt-4.1",
  APPF2_MODEL_BASE_URL: "https://api.openai.com/v1",
  APPF2_XAI_API_KEY: "fake-xai-secret", APPF2_XAI_MODEL_NAME: "grok-4",
  APPF2_DEEPSEEK_API_KEY: "fake-deepseek-secret", APPF2_DEEPSEEK_MODEL_NAME: "deepseek-chat"
};

describe("Sprint 3.5 explicit multi-AI 429 fallback", () => {
  it("has NO default fallback, even if two other API keys exist", () => {
    expect(appf2ModelProviderConfig(env).provider).toBe("openai");
    expect(appf2ModelFallbackConfig(env)).toBeUndefined();
  });

  it("uses the chosen xAI endpoint only when expressly configured", () => {
    const config = appf2ModelFallbackConfig({ ...env, APPF2_MODEL_FALLBACK_PROVIDER: "xai" });
    expect(config?.provider).toBe("xai");
    expect(config?.config.baseUrl).toBe("https://api.x.ai/v1");
    expect(config?.config.model).toBe("grok-4");
  });

  it("requires valid, distinct and credentialed alternative", () => {
    expect(() => appf2ModelFallbackConfig({ ...env, APPF2_MODEL_FALLBACK_PROVIDER: "openai" })).toThrow();
    expect(() => appf2ModelFallbackConfig({
      ...env, APPF2_MODEL_PROVIDER: "xai", APPF2_MODEL_FALLBACK_PROVIDER: "xai"
    })).toThrow();
    expect(() => appf2ModelFallbackConfig({
      ...env, APPF2_MODEL_FALLBACK_PROVIDER: "deepseek", APPF2_DEEPSEEK_API_KEY: ""
    })).toThrow();
  });

  it("falls back exactly once after primary RATE_LIMITED, respecting remaining budget", async () => {
    const primary = gateway(failed("RATE_LIMITED", 250));
    const backup = gateway(successful);
    const result = await new RateLimitFailoverGateway(primary, backup).composeBlueprint(request);
    expect(result.status).toBe("SUCCEEDED");
    expect(result.provider_metadata.provider_model).toBe("grok");
    expect(result.latency_ms).toBe(600);
    expect(primary.composeBlueprint).toHaveBeenCalledTimes(1);
    expect(backup.composeBlueprint).toHaveBeenCalledTimes(1);
    expect(backup.composeBlueprint.mock.calls[0]?.[0]).toMatchObject({
      trace_id: "trace", timeout_ms: 9750
    });
  });

  it("never transfers data after non-429 failures or exhausted time", async () => {
    const backup = gateway(successful);
    for (const first of [failed("REJECTED_REQUEST"), failed("TIMEOUT"), failed("RATE_LIMITED", 9500)]) {
      const response = await new RateLimitFailoverGateway(gateway(first), backup).analyzeIntent(request);
      expect(response.status).toBe("FAILED");
    }
    expect(backup.composeBlueprint).not.toHaveBeenCalled();
    expect(backup.analyzeIntent).not.toHaveBeenCalled();
  });

  it("does not hide secondary provider failures as success", async () => {
    const result = await new RateLimitFailoverGateway(gateway(failed("RATE_LIMITED")), gateway(failed("TIMEOUT")))
      .composeBlueprint(request);
    expect(result.status).toBe("FAILED");
    expect(result.failure?.kind).toBe("TIMEOUT");
  });
});
