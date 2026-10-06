import { describe, expect, test } from "vitest";

import { RAW_INTENT_RETENTION_MS } from "../../src/platform/compiler/compose-validate.js";
import { MODEL_GATEWAY_ENV, OpenAiCompatibleModelGateway, openAiCompatibleConfigFromEnv, type FetchLike } from "../../src/platform/compiler/openai-compatible-gateway.js";
import { lockedEvidenceRegistry } from "../../src/platform/evidence/evidence-registry.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";
import {
  RAW_INTENT_MARKER,
  SCRIPTED_MODEL,
  blueprintCandidate,
  clarifyingAnalysis,
  createF01Harness,
  dataOf,
  failedWith,
  readyAnalysis,
  succeeded,
  type F01Harness
} from "../api/f01-harness.js";
import { validBlueprint } from "../contract/blueprint-validation-fixtures.js";

const TRACE = /^(?!0{32}$)[0-9a-f]{32}$/;
const ECONOMICS = ["input_tokens", "output_tokens", "estimated_cost", "token_usage", "cost"];
const f01Events = (h: F01Harness) => h.evidenceRows.filter((event) => event.function_id === "F01");

async function fullCreateFlow(h: F01Harness): Promise<{ intentId: string; questionId: string }> {
  h.gateway.queueAnalysis(succeeded(clarifyingAnalysis() as unknown as JsonValue));
  const created = dataOf(await h.create());
  const intentId = String(created.intent_id);
  const questionId = String((created.questions as { question_id: string }[])[0]?.question_id);
  const answered = dataOf(await h.answers(intentId, { answers: [{ question_id: questionId, value: 6 }], assumption_decisions: [], intent_version: created.intent_version }));
  h.gateway.queueCompose(succeeded(blueprintCandidate()));
  expect((await h.compile(intentId, Number(answered.intent_version))).status).toBe(200);
  return { intentId, questionId };
}

describe("F01-AC-023 Raw Intent is never required in telemetry", () => {
  test("TEST-F01-AC-023 create → answer → compile Evidence passes F07 and carries no Raw Intent, semantic payload or identity", async () => {
    const h = createF01Harness();
    const { intentId, questionId } = await fullCreateFlow(h);
    expect(h.diagnostics).toEqual([]);
    expect(f01Events(h).map((event) => event.event_type)).toEqual(
      expect.arrayContaining(["F01-EVT-001", "F01-EVT-002", "F01-EVT-003", "F01-EVT-004", "F01-EVT-007", "F01-EVT-008", "F01-EVT-009", "F01-EVT-010", "F01-EVT-013"])
    );
    const telemetry = JSON.stringify(h.evidenceRows);
    for (const forbidden of [RAW_INTENT_MARKER, "公司聚餐分帳工具", "per_person_amount", "headcount", questionId, "numeric_input", "resolved_intent", "structured_intent"]) {
      expect(telemetry, forbidden).not.toContain(forbidden);
    }
    for (const event of f01Events(h)) {
      expect(event, event.event_type).not.toHaveProperty("anonymous_id");
      expect(event).toMatchObject({ intent_id: intentId, trace_id: expect.stringMatching(TRACE) });
      const allowed = lockedEvidenceRegistry.find(event.event_type)?.allowedProperties ?? new Set<string>();
      expect(Object.keys(event.properties ?? {}).filter((key) => !allowed.has(key)), event.event_type).toEqual([]);
    }
    const record = h.db.intents.get(intentId)!;
    expect(record.raw_intent).toBe(RAW_INTENT_MARKER);
    expect(Date.parse(String(record.expires_at)) - h.clock.now().getTime()).toBe(RAW_INTENT_RETENTION_MS);
  });

  test("TEST-F01-AC-023 failure Evidence carries only stable codes and versions, and a failing intake never changes the API outcome", async () => {
    const h = createF01Harness();
    h.gateway.queueAnalysis(failedWith("PROVIDER_5XX"), failedWith("PROVIDER_5XX"));
    expect((await h.create()).status).toBe(502);
    const failures = f01Events(h).filter((event) => event.event_type === "F01-EVT-014");
    expect(failures.map((event) => [event.error_code, event.properties?.attempt_no])).toEqual([["F01-ERR-006", 1], ["F01-ERR-006", 2]]);
    expect(JSON.stringify(h.evidenceRows)).not.toContain(RAW_INTENT_MARKER);
    expect(h.diagnostics).toEqual([]);

    const unavailable = createF01Harness({ intake: { ingest: async () => Promise.reject(new Error("F07 intake down")) } });
    unavailable.gateway.queueAnalysis(succeeded(readyAnalysis() as unknown as JsonValue));
    const created = await unavailable.create();
    expect(created.status).toBe(200);
    expect(dataOf(created).status).toBe("READY");
    expect(unavailable.diagnostics.map(String)).toEqual(["Error: F07 intake down"]);
  });
});

describe("F01-AC-024 token / cost / latency are measurable per compiler_run", () => {
  test("TEST-F01-AC-024 every provider attempt is one compiler_run row with tokens, cost and latency; Evidence holds no economics", async () => {
    const h = createF01Harness();
    h.gateway.queueAnalysis(failedWith("PROVIDER_5XX"), succeeded(readyAnalysis() as unknown as JsonValue));
    const created = dataOf(await h.create());
    h.gateway.queueCompose(succeeded(blueprintCandidate(), { token_usage: { input_tokens: 3000, output_tokens: 900 }, latency_ms: 88, estimated_cost: 0.0063 }));
    expect((await h.compile(String(created.intent_id), Number(created.intent_version))).status).toBe(200);

    const runs = [...h.db.compilerRuns.values()].map(({ stage, attempt_no, status, input_tokens, output_tokens, estimated_cost, latency_ms, provider_model }) =>
      ({ stage, attempt_no, status, input_tokens, output_tokens, estimated_cost, latency_ms, provider_model }));
    expect(runs).toEqual([
      { stage: "INTENT_ANALYSIS", attempt_no: 1, status: "FAILED", input_tokens: null, output_tokens: null, estimated_cost: null, latency_ms: 17, provider_model: SCRIPTED_MODEL },
      { stage: "INTENT_ANALYSIS", attempt_no: 2, status: "SUCCEEDED", input_tokens: 1200, output_tokens: 300, estimated_cost: 0.0021, latency_ms: 42, provider_model: SCRIPTED_MODEL },
      { stage: "BLUEPRINT_COMPOSE", attempt_no: 1, status: "SUCCEEDED", input_tokens: 3000, output_tokens: 900, estimated_cost: 0.0063, latency_ms: 88, provider_model: SCRIPTED_MODEL }
    ]);
    for (const run of h.db.compilerRuns.values()) expect(Date.parse(String(run.finished_at))).toBeGreaterThanOrEqual(Date.parse(run.started_at));
    const costPerSuccessfulIntent = [...h.db.compilerRuns.values()].reduce((sum, run) => sum + (run.estimated_cost ?? 0), 0);
    expect(costPerSuccessfulIntent).toBeCloseTo(0.0084, 10);

    const byType = (type: string) => f01Events(h).filter((event) => event.event_type === type).map((event) => event.properties?.latency_ms);
    expect([byType("F01-EVT-014"), byType("F01-EVT-002"), byType("F01-EVT-010")]).toEqual([[17], [42], [88]]);
    for (const event of h.evidenceRows) for (const key of ECONOMICS) expect(event.properties, event.event_type).not.toHaveProperty(key);
  });

  test("TEST-F01-AC-024 the production adapter reports provider token usage and prices it from server configuration", async () => {
    let tick = 1_000;
    const clock = (): number => (tick += 25);
    const fetchImpl: FetchLike = async (_url, init) => {
      const schema = (JSON.parse(String(init.body)) as { response_format: { json_schema: { name: string } } }).response_format.json_schema.name;
      const content = JSON.stringify(schema === "intent_analysis" ? readyAnalysis() : validBlueprint());
      return { status: 200, headers: { get: () => null }, text: async () => JSON.stringify({ model: "model-x-2026", choices: [{ message: { content } }], usage: { prompt_tokens: 900, completion_tokens: 250 } }) };
    };
    const env = {
      [MODEL_GATEWAY_ENV.baseUrl]: "https://provider.example/v1",
      [MODEL_GATEWAY_ENV.apiKey]: "sk-test",
      [MODEL_GATEWAY_ENV.model]: "model-x",
      [MODEL_GATEWAY_ENV.inputCostPerMillion]: "0.5",
      [MODEL_GATEWAY_ENV.outputCostPerMillion]: "1.5"
    };
    const h = createF01Harness({ gateway: new OpenAiCompatibleModelGateway(openAiCompatibleConfigFromEnv(env), fetchImpl, clock) });
    expect((await h.create()).status).toBe(200);
    const [run] = [...h.db.compilerRuns.values()];
    expect(run).toMatchObject({ input_tokens: 900, output_tokens: 250, latency_ms: 25, provider_model: "model-x-2026", model_adapter: "openai-compatible" });
    expect(run?.estimated_cost).toBeCloseTo((900 * 0.5 + 250 * 1.5) / 1_000_000, 12);

    const unpriced = createF01Harness({
      gateway: new OpenAiCompatibleModelGateway(openAiCompatibleConfigFromEnv({ ...env, [MODEL_GATEWAY_ENV.inputCostPerMillion]: undefined }), fetchImpl, clock)
    });
    expect((await unpriced.create()).status).toBe(200);
    expect([...unpriced.db.compilerRuns.values()][0]).toMatchObject({ input_tokens: 900, output_tokens: 250, estimated_cost: null });
  });
});
