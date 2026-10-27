import { describe, expect, it, vi } from "vitest";
import { OpenAiCompatibleModelGateway, safeUpstream429Code, type FetchLike } from "../../src/platform/compiler/openai-compatible-gateway.js";
import type { ModelGatewayRequest } from "../../src/platform/compiler/model-gateway.js";

const request: ModelGatewayRequest = {
  operation: "BLUEPRINT_COMPOSE", prompt_version: "test", response_schema: {},
  input_payload: { title: "tasks" }, timeout_ms: 5000, trace_id: "trace",
  provider_policy: { max_attempts: 2, structured_output: "JSON_SCHEMA" }
};
const response = (status: number, body: unknown, retryAfter: string | null = null) => ({
  status, headers: { get: () => retryAfter }, text: async () => JSON.stringify(body)
});
const makeGateway = (fetcher: ReturnType<typeof vi.fn>) =>
  new OpenAiCompatibleModelGateway({ baseUrl: "https://api.openai.com/v1", apiKey: "test-secret", model: "gpt-4.1" }, fetcher as unknown as FetchLike);

describe("Sprint 3.5 safe 429 diagnosis and bounded recovery", () => {
  it.each(["rate_limit_exceeded", "insufficient_quota", "credit_balance_exhausted",
    "organization_usage_limit_exceeded", "organization_spend_limit_exceeded",
    "project_spend_limit_exceeded"])("recognizes %s without logging provider body", code => {
    expect(safeUpstream429Code({ error: { code, message: "private user details" } })).toBe(code);
  });
  it("never exposes untrusted error codes or provider messages", () => {
    expect(safeUpstream429Code({ error: { code: "secret-123", message: "private" } })).toBe("unknown");
    expect(safeUpstream429Code({ error: { type: "insufficient_quota" } })).toBe("insufficient_quota");
    expect(safeUpstream429Code({ error: "unknown" })).toBe("unknown");
    expect(safeUpstream429Code(null)).toBe("unknown");
  });
  it("does not retry insufficient quota", async () => {
    const fetcher = vi.fn().mockResolvedValue(response(429, { error: { code: "insufficient_quota" } }));
    const res = await makeGateway(fetcher).composeBlueprint(request);
    expect(res.failure?.kind).toBe("RATE_LIMITED");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("retries a transient 429 once when Retry-After is zero, then succeeds", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(response(429, { error: { code: "rate_limit_exceeded" } }, "0"))
      .mockResolvedValueOnce(response(200, { choices: [{ message: { content: '{"ok":true}' } }] }));
    const res = await makeGateway(fetcher).composeBlueprint(request);
    expect(res.status).toBe("SUCCEEDED");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("never retries a long Retry-After or an unknown 429", async () => {
    for (const [body, retryAfter] of [
      [{ error: { code: "rate_limit_exceeded" } }, "60"],
      [{ error: { code: "unknown" } }, "0"]
    ] as const) {
      const fetcher = vi.fn().mockResolvedValue(response(429, body, retryAfter));
      expect((await makeGateway(fetcher).analyzeIntent(request)).status).toBe("FAILED");
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
});
