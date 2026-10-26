import { describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleModelGateway } from "../../src/platform/compiler/openai-compatible-gateway.js";
import { appf2ModelProviderConfig } from "../../src/platform/compiler/appf2-model-provider.js";

describe("APPf2 multi-provider server-only selection", () => {
  const env = {
    APPF2_MODEL_API_KEY: "test-openai-private",
    APPF2_MODEL_NAME: "gpt-4.1",
    APPF2_MODEL_BASE_URL: "https://api.openai.com/v1",
    APPF2_XAI_API_KEY: "test-xai-private",
    APPF2_XAI_MODEL_NAME: "grok-4.7",
    APPF2_DEEPSEEK_API_KEY: "test-deepseek-private",
    APPF2_DEEPSEEK_MODEL_NAME: "deepseek-flash"
  };

  it("calls native fetch with its original global receiver (Workers runtime)", async () => {
    vi.stubGlobal("fetch", function (this: unknown): Promise<Response> {
      expect(this).toBe(globalThis);
      return Promise.resolve(new Response(JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
        model: "gpt-4.1"
      }), { status: 200, headers: { "Content-Type": "application/json" } }));
    });
    try {
      const gateway = new OpenAiCompatibleModelGateway({
        baseUrl: "https://api.openai.com/v1",
        apiKey: "test-key",
        model: "gpt-4.1"
      });
      const result = await gateway.analyzeIntent({
        operation: "INTENT_ANALYSIS",
        prompt_version: "test",
        response_schema: { type: "object", properties: { ok: { type: "boolean" } } },
        input_payload: { test: true },
        timeout_ms: 3_000,
        trace_id: "test-trace",
        provider_policy: { max_attempts: 2, structured_output: "JSON_SCHEMA" }
      });
      expect(result.status).toBe("SUCCEEDED");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("defaults to OpenAI, does not fall back to other configured keys", () => {
    const selected = appf2ModelProviderConfig(env);
    expect(selected.provider).toBe("openai");
    expect(selected.config.baseUrl).toBe("https://api.openai.com/v1");
    expect(selected.config.model).toBe("gpt-4.1");
    expect(selected.config.apiKey).toBe("test-openai-private");
  });

  it("explicit xAI switch uses its own key and endpoint", () => {
    const selected = appf2ModelProviderConfig({ ...env, APPF2_MODEL_PROVIDER: "xai" });
    expect(selected.provider).toBe("xai");
    expect(selected.config.baseUrl).toBe("https://api.x.ai/v1");
    expect(selected.config.apiKey).toBe("test-xai-private");
    expect(selected.config.outputFormat).toBeUndefined();
  });

  it("explicit DeepSeek switch uses its own key and JSON output", () => {
    const selected = appf2ModelProviderConfig({ ...env, APPF2_MODEL_PROVIDER: "deepseek" });
    expect(selected.provider).toBe("deepseek");
    expect(selected.config.baseUrl).toBe("https://api.deepseek.com");
    expect(selected.config.apiKey).toBe("test-deepseek-private");
    expect(selected.config.outputFormat).toBe("json_object");
  });

  it("fails closed if chosen provider has no key rather than sending to OpenAI", () => {
    expect(() => appf2ModelProviderConfig({
      ...env, APPF2_MODEL_PROVIDER: "xai", APPF2_XAI_API_KEY: ""
    })).toThrow("APPF2_XAI_API_KEY");
  });

  it("rejects unsupported providers", () => {
    expect(() => appf2ModelProviderConfig({
      ...env, APPF2_MODEL_PROVIDER: "unknown"
    })).toThrow("APPF2_MODEL_PROVIDER");
  });

  it("does not permit OpenAI selection to send data to third-party origins", () => {
    expect(() => appf2ModelProviderConfig({
      ...env, APPF2_MODEL_BASE_URL: "https://attacker.example/v1"
    })).toThrow("APPF2_MODEL_BASE_URL");
  });
});
