import { describe, expect, test } from "vitest";
import { CreationController } from "../../src/app/create/creation-controller.js";
import type { F01Client, F01Call } from "../../src/app/create/f01-client.js";
import type { F01Result, IntentDecision } from "../../src/app/create/f01-wire.js";
import { F01EvidenceBuffer } from "../../src/platform/compiler/compiler-evidence.js";
import type { CompilerRunRepository, AttemptGuard } from "../../src/platform/compiler/compiler-records.js";
import { ROUTE_LEASE_MS, INTENT_ROUTE_KEYS } from "../../src/platform/compiler/idempotency.js";
import { MAX_PROVIDER_ATTEMPTS, MODEL_OPERATION_TIMEOUT_MS, RequestDeadline, type ModelGateway, type ModelGatewayRequest } from "../../src/platform/compiler/model-gateway.js";
import { callProviderWithBoundedRetry } from "../../src/platform/compiler/provider-attempts.js";
import { SYSTEM_POLICY } from "../../src/platform/compiler/prompts.js";

const flush = (): Promise<void> => new Promise(resolve => setTimeout(resolve, 0));

describe("Sprint 3.5 LifePilot F01 resilience", () => {
  test("complex prompts preserve features and schema correction stays within two billed attempts", async () => {
    const requests: ModelGatewayRequest[] = [];
    let now = 0;
    const original = { raw_user_intent: "Create LifePilot with tasks, goals, habits, finance and calendar" };
    const gateway: ModelGateway = {
      modelAdapter: "fixture",
      health: async () => ({ status: "OK", model_adapter: "fixture" }),
      analyzeIntent: async request => {
        requests.push(request);
        now += 11_000;
        return {
          status: "SUCCEEDED",
          structured_output: { valid: requests.length === 2 },
          provider_metadata: { model_adapter: "fixture", provider_model: "fixture" },
          latency_ms: 11_000
        };
      },
      composeBlueprint: async () => { throw new Error("should not compose"); }
    };
    const runs = {
      startRun: async () => ({ attempt_no: requests.length + 1 }),
      finishRun: async () => undefined
    } as unknown as CompilerRunRepository;
    let sequence = 0;
    const result = await callProviderWithBoundedRetry({
      gateway, runs, guard: {} as AttemptGuard,
      deadline: new RequestDeadline(ROUTE_LEASE_MS[INTENT_ROUTE_KEYS.create], () => now),
      intentId: "test-intent", traceId: "test-trace", registryVersion: "test-registry",
      now: () => new Date(0), newId: () => "run-" + (++sequence),
      evidence: new F01EvidenceBuffer({ intent_id: "test-intent", trace_id: "test-trace", intent_kind: "CREATE" })
    }, {
      operation: "INTENT_ANALYSIS", promptVersion: "test", schemaVersion: "test",
      responseSchema: { type: "object" }, inputPayload: original,
      accept: value => JSON.stringify(value) === '{"valid":true}' ? value : null,
      rejectedOutputCode: "F01-ERR-002"
    });
    expect(result.attemptNo).toBe(2);
    expect(requests).toHaveLength(2);
    expect(requests[0]?.input_payload).toEqual(original);
    expect(requests[1]?.input_payload).toMatchObject({
      ...original, schema_retry_status: "PREVIOUS_OUTPUT_FAILED_VALIDATION"
    });
    expect(requests[0]?.timeout_ms).toBe(MODEL_OPERATION_TIMEOUT_MS.INTENT_ANALYSIS);
    expect(requests[1]?.timeout_ms).toBe(MODEL_OPERATION_TIMEOUT_MS.INTENT_ANALYSIS);
    expect(original).toEqual({ raw_user_intent: "Create LifePilot with tasks, goals, habits, finance and calendar" });
    expect(MAX_PROVIDER_ATTEMPTS).toBe(2);
    expect(SYSTEM_POLICY.INTENT_ANALYSIS).toContain("preserve every user-requested feature");
    expect(SYSTEM_POLICY.INTENT_ANALYSIS).toContain("schema_retry_status");
  });

  test("AI format and timeout are distinct, keep the prompt and preserve the retry idempotency key", async () => {
    const failures = ["F01-ERR-002", "F01-ERR-009"] as const;
    const seenKeys: string[] = [];
    const client: F01Client = {
      createIntent: async (_body, call: F01Call): Promise<F01Result<IntentDecision>> => {
        seenKeys.push(call.idempotencyKey);
        return { ok: false, failure: { kind: "API", code: failures[seenKeys.length - 1] ?? "F01-ERR-009", retryable: true, httpStatus: 502, violations: [] } };
      },
      submitAnswers: async () => { throw new Error("unexpected answers"); },
      compile: async () => { throw new Error("unexpected compile"); }
    };
    const prompt = "LifePilot: tasks, habits, calendar, journals and budgets";
    let counter = 0;
    const controller = new CreationController({
      client, anonymousId: () => "test-anonymous", newIdempotencyKey: () => "key-" + (++counter)
    });
    controller.start(prompt, null);
    await flush();
    expect(controller.getSnapshot()?.phase).toMatchObject({ kind: "RECOVERABLE_FAILURE", reason: "AI_FORMAT" });
    controller.retry();
    await flush();
    expect(controller.getSnapshot()?.phase).toMatchObject({ kind: "RECOVERABLE_FAILURE", reason: "AI_TIMEOUT" });
    expect(controller.getSnapshot()?.rawIntent).toBe(prompt);
    expect(seenKeys).toEqual(["key-1", "key-1"]);
  });
});
