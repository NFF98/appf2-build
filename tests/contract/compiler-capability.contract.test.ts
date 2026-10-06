import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, test } from "vitest";

import { VALIDATOR_REGISTRY } from "../../generated/capabilities/validator-registry.js";
import { BLUEPRINT_SCHEMA_VERSION } from "../../src/platform/blueprint/validation-types.js";
import { REGISTRY_VERSION } from "../../src/platform/capabilities/registry.js";
import { MAX_PROVIDER_ATTEMPTS, isRetryableFailure, type ModelGatewayRequest } from "../../src/platform/compiler/model-gateway.js";
import {
  MODEL_GATEWAY_ENV,
  ModelGatewayConfigError,
  OpenAiCompatibleModelGateway,
  openAiCompatibleConfigFromEnv,
  type FetchLike
} from "../../src/platform/compiler/openai-compatible-gateway.js";
import { ENVELOPE_VERSION, EVALUATION_FIXTURE_VERSION, PROMPT_A_VERSION, PROMPT_B_VERSION } from "../../src/platform/compiler/prompts.js";
import { F02_REJECTION_CLASS, classifyRejection } from "../../src/platform/compiler/rejection-classification.js";
import { extractCapabilityRequirements, type ExtractorInput } from "../../src/platform/intent/capability-requirements.js";
import { F01_CLARIFICATION_POLICY_VERSION, IntentContractError } from "../../src/platform/intent/intent-contract.js";
import { startIntentClarification } from "../../src/platform/intent/intent-state.js";
import { canonicalJson, type JsonValue } from "../../src/platform/intent/json-value.js";
import { COMPILER_CATALOG_INTENT_CLASSES } from "../../src/platform/intent/semantic-descriptors.js";
import {
  SCRIPTED_ADAPTER,
  SCRIPTED_MODEL,
  blueprintCandidate,
  createF01Harness,
  dataOf,
  errorOf,
  failedWith,
  numericHint,
  readyAnalysis,
  resultHint,
  succeeded,
  type F01Harness
} from "../api/f01-harness.js";
import { actionIndex, nodeIndex, validBlueprint, withValue } from "./blueprint-validation-fixtures.js";
import { registryWithEntry } from "./execution-safety-fixtures.js";

const COMPILE_ROUTE = "POST /api/v1/intents/{intent_id}/compile";
const MIGRATION = readFileSync(new URL("../../supabase/migrations/20261006120000_t001_intent_compiler_persistence.sql", import.meta.url), "utf8");
const composeCount = (h: F01Harness): number => h.gateway.calls("BLUEPRINT_COMPOSE").length;

function contractFailure(run: () => unknown): IntentContractError {
  try {
    run();
  } catch (error: unknown) {
    if (error instanceof IntentContractError) return error;
    throw error;
  }
  throw new Error("expected an IntentContractError");
}

const extractorInput = (overrides: Partial<ExtractorInput> = {}): ExtractorInput => ({
  hints: [numericHint(), resultHint()],
  constraints: [{ id: "people_count", value: 4, value_type: "NUMBER" }],
  traceable_item_ids: new Set(["people_count", "per_person_amount"]),
  intent_classes: COMPILER_CATALOG_INTENT_CLASSES,
  ...overrides
});

describe("F01-AC-008 unknown Capabilities are never created by the LLM", () => {
  test("TEST-F01-008 the deterministic extractor derives stable content-addressed requirement_ids from semantic tuples", () => {
    const first = extractCapabilityRequirements(extractorInput());
    const reordered = extractCapabilityRequirements(extractorInput({
      hints: [resultHint({ hint_id: "other_id" }), numericHint({ hint_id: "renamed_hint" }), numericHint({ hint_id: "duplicate_tuple" })]
    }));
    expect(reordered).toEqual(first);
    expect(first).toHaveLength(2);
    const numeric = first.find((requirement) => requirement.semantic_need === "numeric_input")!;
    const { requirement_id: id, ...tuple } = numeric;
    expect(id).toBe(`sha256:${createHash("sha256").update(canonicalJson(tuple as unknown as JsonValue), "utf8").digest("hex")}`);
    expect(numeric.constraints).toEqual([{ semantic_item_id: "people_count", value: 4, value_type: "NUMBER" }]);
    expect(JSON.stringify(first)).not.toContain("hint_id");
    expect(first.map((requirement) => requirement.requirement_id)).toEqual([...first.map((requirement) => requirement.requirement_id)].sort());
  });

  test("TEST-F01-008 Capability IDs, runtime handler keys and unknown interaction classes in hints fail closed", () => {
    const cases: readonly [string, Record<string, unknown>, string][] = [
      ["capability id", { semantic_need: "use input.number widget" }, "CAPABILITY_IDENTITY_IN_SEMANTIC_NEED"],
      ["runtime handler key", { semantic_need: "render via input/number" }, "CAPABILITY_IDENTITY_IN_SEMANTIC_NEED"],
      ["provider metadata", { semantic_need: "ask gpt-4o for a widget" }, "PROVIDER_METADATA_IN_SEMANTIC_NEED"],
      ["code", { semantic_need: "() => fetch(x)" }, "CODE_IN_SEMANTIC_NEED"],
      ["unknown interaction class", { interaction_class: "quantum_widget" }, "UNKNOWN_INTERACTION_CLASS"]
    ];
    for (const [label, change, reason] of cases) {
      const envelope = readyAnalysis({ hints: [numericHint(change), resultHint()] });
      const failure = contractFailure(() => startIntentClarification(envelope));
      expect(failure.code, label).toBe("F01-ERR-002");
      expect(failure.violations.map((violation) => violation.reason), label).toContain(reason);
    }
  });

  test("TEST-F01-008 an unresolved source, unresolvable constraint or unknown class never becomes a final requirement", () => {
    const unresolved = contractFailure(() => extractCapabilityRequirements(extractorInput({ traceable_item_ids: new Set(["people_count"]) })));
    expect(unresolved).toMatchObject({ code: "F01-ERR-014", violations: [expect.objectContaining({ reason: "REQUIREMENT_SOURCE_NOT_RESOLVED" })] });
    const constraint = contractFailure(() => extractCapabilityRequirements(extractorInput({ constraints: [] })));
    expect(constraint.violations[0]?.reason).toBe("REQUIREMENT_CONSTRAINT_NOT_RESOLVED");
    const unknownClass = contractFailure(() => extractCapabilityRequirements(extractorInput({ intent_classes: new Set(["result"]) })));
    expect(unknownClass.violations[0]?.reason).toBe("UNKNOWN_INTERACTION_CLASS");
  });

  test("TEST-F01-008 Prompt B only sees F04-selected Capabilities and an unregistered CapabilityRef is never validated", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent();
    const invented = withValue(["nodes", nodeIndex("node_title"), "capability"], { id: "magic.widget", version: "1.0.0" }) as JsonValue;
    h.gateway.queueCompose(succeeded(invented), succeeded(invented));
    const response = await h.compile(intentId, version);
    const [request] = h.gateway.calls("BLUEPRINT_COMPOSE");
    const catalog = request?.input_payload.compiler_catalog as { id: string }[];
    const selected = (request?.input_payload.capability_coverage_result as { selected: { id: string }[] }).selected.map((ref) => ref.id);
    expect(catalog.map((entry) => entry.id).sort()).toEqual([...selected].sort());
    expect(selected).toEqual(expect.arrayContaining(["input.number", "data.stat"]));
    expect(JSON.stringify(request?.input_payload)).not.toContain("input/number");
    expect(response.status).toBe(422);
    expect(errorOf(response).code).toBe("F01-ERR-011");
    expect(h.db.blueprint.contents.size).toBe(0);
    expect([...h.db.blueprint.runs.values()].every((run) => run.status !== "PASSED")).toBe(true);
  });
});

const EXPECTED_RQ_008A: Readonly<Record<string, string>> = {
  "F02-ERR-001": "SCHEMA_FIXABLE", "F02-ERR-002": "SCHEMA_FIXABLE", "F02-ERR-003": "SCHEMA_FIXABLE", "F02-ERR-004": "CAPABILITY_FIXABLE",
  "F02-ERR-005": "CAPABILITY_FIXABLE", "F02-ERR-006": "SCHEMA_FIXABLE", "F02-ERR-007": "SCHEMA_FIXABLE", "F02-ERR-008": "SCHEMA_FIXABLE",
  "F02-ERR-009": "SCHEMA_FIXABLE", "F02-ERR-010": "SCHEMA_FIXABLE", "F02-ERR-011": "RESOURCE_TERMINAL", "F02-ERR-012": "SECURITY_TERMINAL",
  "F02-ERR-013": "SECURITY_TERMINAL", "F02-ERR-014": "CAPABILITY_FIXABLE", "F02-ERR-015": "SECURITY_TERMINAL", "F02-ERR-016": "SECURITY_TERMINAL",
  "F02-ERR-017": "CAPABILITY_FIXABLE"
};

describe("F01-AC-011 F02 rejection is never bypassed or downgraded", () => {
  test("TEST-F01-AC-011 every F02 error maps to its locked RQ-008A class; unknown codes fail closed as integrity faults", () => {
    expect(F02_REJECTION_CLASS).toEqual(EXPECTED_RQ_008A);
    expect(classifyRejection(["F02-ERR-002", "F02-ERR-005"])).toMatchObject({ rejection_class: "CAPABILITY_FIXABLE" });
    expect(classifyRejection(["F02-ERR-002", "F02-ERR-011"])).toMatchObject({ rejection_class: "RESOURCE_TERMINAL", error_code: "F02-ERR-011" });
    expect(classifyRejection(["F02-ERR-011", "F02-ERR-013"])).toMatchObject({ rejection_class: "SECURITY_TERMINAL", error_code: "F02-ERR-013" });
    expect(classifyRejection(["F02-ERR-999"])).toEqual({ rejection_class: "SECURITY_TERMINAL", error_code: "F02-ERR-015" });
    expect(classifyRejection([])).toEqual({ rejection_class: "SECURITY_TERMINAL", error_code: "F02-ERR-015" });
  });

  test("TEST-F01-AC-011 SECURITY_TERMINAL F02-ERR-012 is never retried, recomposed or replayed as success", async () => {
    const network = registryWithEntry(VALIDATOR_REGISTRY, { id: "content.text", version: "1.0.0" }, (entry) => ({
      ...entry,
      resource_budget: { ...entry.resource_budget, networkAccessAllowed: true }
    }));
    const h = createF01Harness({ validatorRegistry: network });
    const { intentId, version } = await h.readyIntent();
    h.gateway.queueCompose(succeeded(blueprintCandidate()), succeeded(blueprintCandidate()));
    const response = await h.compile(intentId, version);
    expect(response.status).toBe(422);
    expect(errorOf(response)).toMatchObject({ code: "F01-ERR-012", retryable: false });
    expect(composeCount(h)).toBe(1);
    expect(h.db.operationFor(COMPILE_ROUTE, "compile-1")?.status).toBe("FAILED_TERMINAL");
    expect(errorOf(await h.compile(intentId, version)).code).toBe("F01-ERR-012");
    const fresh = await h.compile(intentId, Number(h.db.intents.get(intentId)?.intent_version), "compile-new-key");
    expect(errorOf(fresh).code).toBe("F01-ERR-012");
    expect(composeCount(h)).toBe(1);
    expect(h.db.intents.get(intentId)?.lifecycle_status).toBe("VALIDATION_REJECTED");
    expect(h.db.blueprint.contents.size).toBe(0);
  });

  test("TEST-F01-AC-011 RESOURCE_TERMINAL F02-ERR-011 is never same-body recomposed", async () => {
    const h = createF01Harness();
    const { intentId, version } = await h.readyIntent();
    const tooManySteps = withValue(["actions", actionIndex("action_reset"), "steps"], Array.from({ length: 17 }, () => ({ type: "RESET_STATE", target: "ALL_MUTABLE" })));
    h.gateway.queueCompose(succeeded(tooManySteps as JsonValue));
    const response = await h.compile(intentId, version);
    expect(errorOf(response)).toMatchObject({ code: "F01-ERR-011", retryable: false, details: { rejection_class: "RESOURCE_TERMINAL" } });
    const fresh = await h.compile(intentId, Number(h.db.intents.get(intentId)?.intent_version), "compile-new-key");
    expect(errorOf(fresh)).toMatchObject({ code: "F01-ERR-011", details: { rejection_class: "RESOURCE_TERMINAL" } });
    expect(composeCount(h)).toBe(1);
  });

  test("TEST-F01-AC-011 F02-ERR-015 integrity faults surface F01-ERR-014 and F02-ERR-016 revoked reuse surfaces F01-ERR-012", async () => {
    const h = createF01Harness();
    const first = await h.readyIntent(readyAnalysis(), "create-a");
    h.gateway.queueCompose(succeeded(blueprintCandidate()));
    const hash = String(dataOf(await h.compile(first.intentId, first.version, "compile-a")).content_hash);
    const stored = h.db.blueprint.contents.get(hash)!;

    h.db.blueprint.contents.set(hash, { ...stored, canonical_blueprint: { ...validBlueprint(), meta: { title: "tampered", description: "tampered" } } });
    const tampered = await h.readyIntent(readyAnalysis(), "create-b");
    h.gateway.queueCompose(succeeded(blueprintCandidate()));
    const integrity = await h.compile(tampered.intentId, tampered.version, "compile-b");
    expect(integrity.status).toBe(500);
    expect(errorOf(integrity)).toMatchObject({ code: "F01-ERR-014", details: {} });

    h.db.blueprint.contents.set(hash, { ...stored, trust_status: "REVOKED" });
    const revoked = await h.readyIntent(readyAnalysis(), "create-c");
    h.gateway.queueCompose(succeeded(blueprintCandidate()));
    expect(errorOf(await h.compile(revoked.intentId, revoked.version, "compile-c"))).toMatchObject({ code: "F01-ERR-012", retryable: false });
    const again = await h.compile(revoked.intentId, Number(h.db.intents.get(revoked.intentId)?.intent_version), "compile-c2");
    expect(errorOf(again).code).toBe("F01-ERR-012");
    expect(composeCount(h)).toBe(3);
    expect(h.db.intents.get(revoked.intentId)?.lifecycle_status).toBe("VALIDATION_REJECTED");
  });
});

const SECRET = "sk-live-T001-SECRET-9f2c";
const PROVIDER_ENV = {
  [MODEL_GATEWAY_ENV.baseUrl]: "https://provider.example/v1/",
  [MODEL_GATEWAY_ENV.apiKey]: SECRET,
  [MODEL_GATEWAY_ENV.model]: "model-x",
  [MODEL_GATEWAY_ENV.inputCostPerMillion]: "0.5",
  [MODEL_GATEWAY_ENV.outputCostPerMillion]: "1.5"
};

type FetchCall = { url: string; headers: Record<string, string>; body: string };
const IMPORT_SPECIFIER = /from\s+"([^"]+)"/g;

function providerFetch(calls: FetchCall[], status = 200): FetchLike {
  return async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body ?? "" });
    const schema = init.body === undefined ? "" : String((JSON.parse(init.body) as { response_format: { json_schema: { name: string } } }).response_format.json_schema.name);
    const output = schema === "intent_analysis" ? readyAnalysis() : validBlueprint();
    const payload = status === 200
      ? { model: "model-x-2026", choices: [{ message: { content: JSON.stringify(output) } }], usage: { prompt_tokens: 900, completion_tokens: 250 } }
      : { error: { message: `Incorrect API key provided: ${SECRET}` } };
    return { status, headers: { get: () => null }, text: async () => JSON.stringify(payload) };
  };
}

function sourceFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((name) => {
    const path = join(root, name);
    return statSync(path).isDirectory() ? sourceFiles(path) : /\.(?:ts|tsx|js|mjs)$/.test(name) ? [path] : [];
  });
}

describe("F01-AC-018 provider secrets never reach the Client or the Blueprint", () => {
  test("TEST-F01-AC-018 the production adapter keeps the key in the server Authorization header only", async () => {
    const calls: FetchCall[] = [];
    const gateway = new OpenAiCompatibleModelGateway(openAiCompatibleConfigFromEnv(PROVIDER_ENV), providerFetch(calls));
    const h = createF01Harness({ gateway });
    const created = await h.create();
    const createdData = dataOf(created);
    const compiled = await h.compile(String(createdData.intent_id), Number(createdData.intent_version));
    expect(compiled.status, JSON.stringify(compiled.body)).toBe(200);
    expect(calls.map((call) => call.url)).toEqual(["https://provider.example/v1/chat/completions", "https://provider.example/v1/chat/completions"]);
    expect(calls.every((call) => call.headers.Authorization === `Bearer ${SECRET}` && !call.body.includes(SECRET))).toBe(true);
    const everythingClientOrDurable = JSON.stringify([created, compiled, [...h.db.intents.values()], [...h.db.operations.values()], [...h.db.compilerRuns.values()], [...h.db.blueprint.runs.values()], [...h.db.blueprint.contents.values()], h.evidenceRows]);
    expect(everythingClientOrDurable).not.toContain(SECRET);
    expect(everythingClientOrDurable).not.toContain("Bearer");
  });

  test("TEST-F01-AC-018 provider errors and configuration errors never echo the key", async () => {
    const h = createF01Harness({ gateway: new OpenAiCompatibleModelGateway(openAiCompatibleConfigFromEnv(PROVIDER_ENV), providerFetch([], 401)) });
    const response = await h.create();
    expect(response.status).toBe(502);
    expect(errorOf(response)).toMatchObject({ code: "F01-ERR-006", details: {} });
    expect(JSON.stringify([response, [...h.db.compilerRuns.values()], h.evidenceRows, h.diagnostics.map(String)])).not.toContain(SECRET);
    let configError: unknown;
    try {
      openAiCompatibleConfigFromEnv({ [MODEL_GATEWAY_ENV.apiKey]: SECRET });
    } catch (error: unknown) {
      configError = error;
    }
    expect(configError).toBeInstanceOf(ModelGatewayConfigError);
    expect(String((configError as Error).message)).toContain(MODEL_GATEWAY_ENV.baseUrl);
    expect(String((configError as Error).message)).not.toContain(SECRET);
  });

  test("TEST-F01-AC-018 no browser-exposed env prefix, provider SDK or compiler import crosses the Client boundary", () => {
    for (const name of Object.values(MODEL_GATEWAY_ENV)) expect(name).not.toMatch(/^(?:VITE_|PUBLIC_|NEXT_PUBLIC_)/);
    const root = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
    const serverFiles = [...sourceFiles(join(root, "src/platform/compiler")), join(root, "src/edge/intent-api.ts")];
    expect(serverFiles.length).toBeGreaterThan(5);
    for (const file of serverFiles) {
      const imports = [...readFileSync(file, "utf8").matchAll(IMPORT_SPECIFIER)].map((match) => match[1] ?? "");
      expect(imports.filter((specifier) => !specifier.startsWith(".") && !specifier.startsWith("node:")), file).toEqual([]);
    }
    for (const file of sourceFiles(join(root, "src/app"))) {
      const text = readFileSync(file, "utf8");
      expect(text, file).not.toMatch(/platform\/compiler|edge\/intent-api|APPF2_MODEL_/);
    }
  });
});

describe("F01-AC-019 provider retry is bounded", () => {
  test("TEST-F01-019 retryable failures stop after MAX_PROVIDER_ATTEMPTS and each attempt is its own compiler_run", async () => {
    expect(MAX_PROVIDER_ATTEMPTS).toBe(2);
    const h = createF01Harness();
    h.gateway.queueAnalysis(failedWith("PROVIDER_5XX"), failedWith("PROVIDER_5XX"), failedWith("PROVIDER_5XX"));
    const response = await h.create();
    expect(response.status).toBe(502);
    expect(errorOf(response)).toMatchObject({ code: "F01-ERR-006", retryable: true });
    expect(h.gateway.calls("INTENT_ANALYSIS")).toHaveLength(2);
    expect([...h.db.compilerRuns.values()].map((run) => [run.attempt_no, run.status, run.failure_code])).toEqual([
      [1, "FAILED", "F01-ERR-006"],
      [2, "FAILED", "F01-ERR-006"]
    ]);

    const limited = createF01Harness();
    limited.gateway.queueAnalysis(failedWith("RATE_LIMITED", 7), failedWith("RATE_LIMITED", 7));
    const throttled = await limited.create();
    expect(throttled.status).toBe(429);
    expect(errorOf(throttled)).toMatchObject({ code: "F01-ERR-005", retryable: true, retry_after_seconds: 7 });
    expect(throttled.headers["Retry-After"]).toBe("7");
  });

  test("TEST-F01-019 timeouts and deterministic provider rejections are never auto-retried", async () => {
    const cases: readonly [Parameters<typeof failedWith>[0], number, string][] = [["TIMEOUT", 504, "F01-ERR-009"], ["REJECTED_REQUEST", 502, "F01-ERR-006"]];
    for (const [kind, status, code] of cases) {
      const h = createF01Harness();
      h.gateway.queueAnalysis(failedWith(kind), succeeded(readyAnalysis() as unknown as JsonValue));
      const response = await h.create();
      expect([response.status, errorOf(response).code], kind).toEqual([status, code]);
      expect(h.gateway.calls("INTENT_ANALYSIS"), kind).toHaveLength(1);
    }
    expect([isRetryableFailure("NETWORK", 1), isRetryableFailure("RATE_LIMITED", 1), isRetryableFailure("PROVIDER_5XX", 1), isRetryableFailure("INVALID_OUTPUT", 1)]).toEqual([true, true, true, true]);
    expect([isRetryableFailure("TIMEOUT", 1), isRetryableFailure("REJECTED_REQUEST", 1), isRetryableFailure("NETWORK", 2)]).toEqual([false, false, false]);
  });

  test("TEST-F01-019 one invalid structured output is retried once; every attempt is clipped to the server route budget", async () => {
    const h = createF01Harness();
    h.gateway.queueAnalysis(succeeded({ not: "an envelope" }), succeeded(readyAnalysis() as unknown as JsonValue));
    const created = dataOf(await h.create());
    expect(h.gateway.calls("INTENT_ANALYSIS").map((request) => request.timeout_ms)).toEqual([15_000, 15_000]);
    h.gateway.queueCompose((request: ModelGatewayRequest) => {
      expect(request.timeout_ms).toBe(20_000);
      h.clock.advance(25_000);
      return failedWith("PROVIDER_5XX");
    }, succeeded(blueprintCandidate()));
    expect((await h.compile(String(created.intent_id), Number(created.intent_version))).status).toBe(200);
    expect(h.gateway.calls("BLUEPRINT_COMPOSE").map((request) => request.timeout_ms)).toEqual([20_000, 5_000]);

    const exhausted = createF01Harness();
    exhausted.gateway.queueAnalysis(() => {
      exhausted.clock.advance(21_000);
      return failedWith("PROVIDER_5XX");
    }, succeeded(readyAnalysis() as unknown as JsonValue));
    expect(errorOf(await exhausted.create()).code).toBe("F01-ERR-006");
    expect(exhausted.gateway.calls("INTENT_ANALYSIS")).toHaveLength(1);
  });

  test("TEST-F01-019 the production adapter normalises provider failures into bounded retry kinds", async () => {
    const config = openAiCompatibleConfigFromEnv(PROVIDER_ENV);
    const request: ModelGatewayRequest = { operation: "INTENT_ANALYSIS", prompt_version: PROMPT_A_VERSION, response_schema: {}, input_payload: {}, timeout_ms: 1_000, trace_id: "a".repeat(32), provider_policy: { max_attempts: 2, structured_output: "JSON_SCHEMA" } };
    const respond = (status: number, text: string, retryAfter: string | null = null): FetchLike => async () => ({ status, headers: { get: () => retryAfter }, text: async () => text });
    const kindOf = async (fetchImpl: FetchLike, overrides: Partial<ModelGatewayRequest> = {}) => (await new OpenAiCompatibleModelGateway(config, fetchImpl).analyzeIntent({ ...request, ...overrides })).failure;
    expect(await kindOf(respond(429, "{}", "3"))).toEqual({ kind: "RATE_LIMITED", retry_after_seconds: 3 });
    expect(await kindOf(respond(503, "{}"))).toEqual({ kind: "PROVIDER_5XX" });
    expect(await kindOf(respond(400, "{}"))).toEqual({ kind: "REJECTED_REQUEST" });
    expect(await kindOf(respond(200, JSON.stringify({ choices: [{ message: { content: "not json" } }] })))).toEqual({ kind: "INVALID_OUTPUT" });
    expect(await kindOf(async () => Promise.reject(new Error("socket hang up")))).toEqual({ kind: "NETWORK" });
    const hanging: FetchLike = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted"))));
    expect(await kindOf(hanging, { timeout_ms: 5 })).toEqual({ kind: "TIMEOUT" });
    expect(await kindOf(respond(200, "{}"), { timeout_ms: 0 })).toEqual({ kind: "TIMEOUT" });
  });
});

describe("F01-AC-022 prompt / schema / registry / model adapter versions are traceable", () => {
  test("TEST-F01-AC-022 compiler_run, Prompt B input, durable Envelope, response and Evidence carry the pinned versions", async () => {
    const h = createF01Harness();
    const claimed = { ...readyAnalysis(), analysis_metadata: { prompt_version: "attacker-claimed-v9" } };
    const { intentId, version } = await h.readyIntent(claimed);
    h.gateway.queueCompose(succeeded(blueprintCandidate()));
    const compiled = dataOf(await h.compile(intentId, version));
    const structured = h.db.intents.get(intentId)?.structured_intent as { analysis_metadata: { prompt_version: string; clarification_policy_state: { policy_version: string } } };
    expect(structured.analysis_metadata.prompt_version).toBe(PROMPT_A_VERSION);
    expect(structured.analysis_metadata.clarification_policy_state.policy_version).toBe(F01_CLARIFICATION_POLICY_VERSION);
    const runs = [...h.db.compilerRuns.values()];
    const trace = { registry_version: REGISTRY_VERSION, model_adapter: SCRIPTED_ADAPTER, provider_model: SCRIPTED_MODEL, trace_id: expect.stringMatching(/^[0-9a-f]{32}$/) };
    expect(runs.find((run) => run.stage === "INTENT_ANALYSIS")).toMatchObject({ prompt_version: PROMPT_A_VERSION, schema_version: ENVELOPE_VERSION, ...trace });
    expect(runs.find((run) => run.stage === "BLUEPRINT_COMPOSE")).toMatchObject({ prompt_version: PROMPT_B_VERSION, schema_version: BLUEPRINT_SCHEMA_VERSION, ...trace });
    expect(h.gateway.calls("BLUEPRINT_COMPOSE")[0]?.input_payload).toMatchObject({
      prompt_version: PROMPT_B_VERSION,
      schema_version: BLUEPRINT_SCHEMA_VERSION,
      registry_version: REGISTRY_VERSION,
      model_adapter: SCRIPTED_ADAPTER,
      evaluation_fixture_version: EVALUATION_FIXTURE_VERSION
    });
    expect(compiled).toMatchObject({ schema_version: BLUEPRINT_SCHEMA_VERSION, registry_version: REGISTRY_VERSION });
    const byType = new Map(h.evidenceRows.map((event) => [event.event_type, event.properties]));
    expect(byType.get("F01-EVT-002")).toMatchObject({ prompt_version: PROMPT_A_VERSION, model_adapter: SCRIPTED_ADAPTER, policy_version: F01_CLARIFICATION_POLICY_VERSION });
    expect(byType.get("F01-EVT-010")).toMatchObject({ prompt_version: PROMPT_B_VERSION, model_adapter: SCRIPTED_ADAPTER, blueprint_schema_version: BLUEPRINT_SCHEMA_VERSION, registry_version: REGISTRY_VERSION });
    expect(byType.get("F01-EVT-013")).toMatchObject({ blueprint_schema_version: BLUEPRINT_SCHEMA_VERSION, registry_version: REGISTRY_VERSION });
  });

  test("TEST-F01-AC-022 the migration makes every compiler_run version column mandatory", () => {
    const compilerRun = MIGRATION.slice(MIGRATION.indexOf("CREATE TABLE public.compiler_run"), MIGRATION.indexOf("CREATE TABLE public.idempotency_operation"));
    for (const column of ["prompt_version", "schema_version", "registry_version", "model_adapter", "trace_id"]) {
      expect(compilerRun, column).toMatch(new RegExp(`\\b${column} text NOT NULL`));
    }
  });
});

describe("T001 persistence migration", () => {
  test("creates the three F01 tables expand-only with the staged validation_run → compiler_run FK", () => {
    expect(MIGRATION).toContain("CREATE TABLE public.intent_record");
    expect(MIGRATION).toContain("CONSTRAINT idempotency_operation_scope_key UNIQUE (anonymous_id, route_key, idempotency_key)");
    expect(MIGRATION).toMatch(/UNIQUE \(intent_id, stage, attempt_no\)/);
    expect(MIGRATION).toMatch(/ADD CONSTRAINT validation_run_compiler_run_fk[\s\S]*NOT VALID/);
    expect(MIGRATION).toContain("VALIDATE CONSTRAINT validation_run_compiler_run_fk");
    for (const table of ["intent_record", "compiler_run", "idempotency_operation"]) expect(MIGRATION).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY`);
    expect(MIGRATION).not.toMatch(/\bDROP\s+(?:TABLE|COLUMN)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i);
  });
});
