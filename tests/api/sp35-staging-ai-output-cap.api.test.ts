import { describe, expect, it, vi } from "vitest";
import { openAiCompatibleConfigFromEnv, OpenAiCompatibleModelGateway, type FetchLike } from "../../src/platform/compiler/openai-compatible-gateway.js";
import { appf2ModelProviderConfig } from "../../src/platform/compiler/appf2-model-provider.js";
import type { ModelGatewayRequest } from "../../src/platform/compiler/model-gateway.js";

const env = {
  APPF2_MODEL_API_KEY: "fake-test-key",
  APPF2_MODEL_BASE_URL: "https://api.openai.com/v1",
  APPF2_MODEL_NAME: "gpt-4.1",
  APPF2_MODEL_OUTPUT_CAP_ANALYSIS: "6000",
  APPF2_MODEL_OUTPUT_CAP_BLUEPRINT: "16000"
};
describe("Sprint 3.5 staging output token spending guard", () => {
  it("applies separate maximum completion token caps to model operations", async () => {
    const sent: number[] = [];
    const fetcher: FetchLike = async (_url, init) => {
      const body = JSON.parse(init.body ?? "{}") as {max_completion_tokens?: number};
      sent.push(body.max_completion_tokens ?? -1);
      return {
        status: 200, headers: { get: () => null },
        text: async () => JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] })
      };
    };
    const model = new OpenAiCompatibleModelGateway(appf2ModelProviderConfig(env).config, fetcher);
    for (const operation of ["INTENT_ANALYSIS", "BLUEPRINT_COMPOSE"] as const) {
      const request: ModelGatewayRequest = {
        operation, prompt_version: "test", response_schema: {}, input_payload: {},
        timeout_ms: 5000, trace_id: "test",
        provider_policy: { max_attempts: 1, structured_output: "JSON_SCHEMA" }
      };
      expect((await model.analyzeIntent(request)).status).toBe("SUCCEEDED");
    }
    expect(sent).toEqual([6000,16000]);
  });
  it("rejects incomplete or invalid caps before an API call", () => {
    expect(() => openAiCompatibleConfigFromEnv({...env, APPF2_MODEL_OUTPUT_CAP_BLUEPRINT: undefined})).toThrow();
    expect(() => openAiCompatibleConfigFromEnv({...env, APPF2_MODEL_OUTPUT_CAP_ANALYSIS: "-1"})).toThrow();
  });
  it("leaves non-staging model configuration unchanged", () => {
    expect(appf2ModelProviderConfig({APPF2_MODEL_API_KEY: "fake-test-key"}).config.outputCaps).toBeUndefined();
  });
});
