import { expect } from "vitest";

import { createIntentApiHandler, type IntentApiHttpResponse } from "../../src/edge/intent-api.js";
import { PostgresBlueprintAdmissionRepository } from "../../src/platform/blueprint/postgres-blueprint-repository.js";
import type { F02EvidenceIntake } from "../../src/platform/blueprint/validation-evidence.js";
import type { CoverageResolutionRequest, CoverageResult } from "../../src/platform/capabilities/coverage.js";
import type { ValidatorRegistry } from "../../src/platform/capabilities/schema/validator-contract.js";
import type { CreateProgressSnapshot } from "../../src/platform/compiler/create-progress.js";
import { IntentCompilerService } from "../../src/platform/compiler/intent-service.js";
import type {
  ModelFailureKind,
  ModelGateway,
  ModelGatewayHealth,
  ModelGatewayRequest,
  ModelGatewayResponse
} from "../../src/platform/compiler/model-gateway.js";
import {
  PostgresCompilerRunRepository,
  PostgresIdempotencyRepository,
  PostgresIntentRepository
} from "../../src/platform/compiler/postgres-compiler-repository.js";
import { EvidenceIngestionService } from "../../src/platform/evidence/evidence-ingestion-service.js";
import type { EvidenceEventInput } from "../../src/platform/evidence/evidence-types.js";
import type { CapabilityHintV1, KnownInput, RequestedOutputDescriptor, StructuredIntentEnvelope } from "../../src/platform/intent/intent-contract.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";
import { validBlueprint } from "../contract/blueprint-validation-fixtures.js";
import { analysis, confirmed, knownInput, llmProposal } from "../contract/intent-envelope-fixtures.js";
import { FakeF01Postgres, FakeIdentityRepository } from "./f01-postgres-fake.js";

export const ANON = "00000000-0000-4000-8000-00000000a001";
export const OTHER_ANON = "00000000-0000-4000-8000-00000000a002";
export const SCRIPTED_ADAPTER = "scripted-test-adapter";
export const SCRIPTED_MODEL = "scripted-model-1";
export const RAW_INTENT_MARKER = "raw-intent-marker-公司聚餐-5b1e";

export class ManualClock {
  private currentMs: number;

  public constructor(startIso: string) {
    this.currentMs = Date.parse(startIso);
  }

  public readonly now = (): Date => new Date(this.currentMs);

  public advance(milliseconds: number): void {
    this.currentMs += milliseconds;
  }
}

export type GatewayStep = ModelGatewayResponse | ((request: ModelGatewayRequest) => Promise<ModelGatewayResponse> | ModelGatewayResponse);

export function succeeded(output: JsonValue, extra: Partial<ModelGatewayResponse> = {}): ModelGatewayResponse {
  return {
    status: "SUCCEEDED",
    structured_output: output,
    provider_metadata: { model_adapter: SCRIPTED_ADAPTER, provider_model: SCRIPTED_MODEL },
    token_usage: { input_tokens: 1200, output_tokens: 300 },
    latency_ms: 42,
    estimated_cost: 0.0021,
    ...extra
  };
}

export function failedWith(kind: ModelFailureKind, retryAfterSeconds?: number): ModelGatewayResponse {
  return {
    status: "FAILED",
    provider_metadata: { model_adapter: SCRIPTED_ADAPTER, provider_model: SCRIPTED_MODEL },
    latency_ms: 17,
    failure: retryAfterSeconds === undefined ? { kind } : { kind, retry_after_seconds: retryAfterSeconds }
  };
}

/** Provider-neutral fake: every call must be scripted, so an unexpected Prompt A / Prompt B call is observable. */
export class ScriptedModelGateway implements ModelGateway {
  public readonly modelAdapter = SCRIPTED_ADAPTER;
  public readonly requests: ModelGatewayRequest[] = [];
  public unscriptedCalls = 0;
  private readonly analysisSteps: GatewayStep[] = [];
  private readonly composeSteps: GatewayStep[] = [];

  public queueAnalysis(...steps: GatewayStep[]): this {
    this.analysisSteps.push(...steps);
    return this;
  }

  public queueCompose(...steps: GatewayStep[]): this {
    this.composeSteps.push(...steps);
    return this;
  }

  public analyzeIntent(request: ModelGatewayRequest): Promise<ModelGatewayResponse> {
    return this.run(this.analysisSteps, request);
  }

  public composeBlueprint(request: ModelGatewayRequest): Promise<ModelGatewayResponse> {
    return this.run(this.composeSteps, request);
  }

  public async health(): Promise<ModelGatewayHealth> {
    return { status: "OK", model_adapter: this.modelAdapter };
  }

  public calls(operation: ModelGatewayRequest["operation"]): ModelGatewayRequest[] {
    return this.requests.filter((request) => request.operation === operation);
  }

  private async run(steps: GatewayStep[], request: ModelGatewayRequest): Promise<ModelGatewayResponse> {
    this.requests.push(request);
    const step = steps.shift();
    if (step === undefined) {
      this.unscriptedCalls += 1;
      return failedWith("REJECTED_REQUEST");
    }
    return typeof step === "function" ? step(request) : step;
  }
}

export const numericHint = (overrides: Partial<CapabilityHintV1> = {}): CapabilityHintV1 => ({
  hint_id: "enter_people",
  semantic_need: "numeric_input",
  required: true,
  impact_level: "MEDIUM",
  input_types: ["NUMBER"],
  output_types: ["NUMBER"],
  interaction_class: "numeric_input",
  constraint_item_ids: ["people_count"],
  source_item_ids: ["people_count"],
  ...overrides
});

export const resultHint = (overrides: Partial<CapabilityHintV1> = {}): CapabilityHintV1 => ({
  hint_id: "show_share",
  semantic_need: "result",
  required: true,
  impact_level: "MEDIUM",
  input_types: ["NUMBER"],
  output_types: ["NUMBER"],
  interaction_class: "result",
  constraint_item_ids: [],
  source_item_ids: ["per_person_amount"],
  ...overrides
});

const SHARE_OUTPUT: RequestedOutputDescriptor = {
  id: "per_person_amount",
  semantic_role: "result",
  description: "每人應付金額",
  source: "USER_EXPLICIT",
  output_type: "NUMBER",
  required: true
};

const PEOPLE = confirmed({ id: "people_count", semantic_role: "headcount", expected_value_type: "NUMBER", question_type: "NUMBER", resolved_value: 4 });

/** Prompt A output that passes the Clarification Gate (READY) with two registry-resolvable hints. */
export function readyAnalysis(options: { hints?: readonly CapabilityHintV1[]; knownInputs?: readonly KnownInput[] } = {}): StructuredIntentEnvelope {
  return {
    ...analysis({ constraints: [PEOPLE], known_inputs: options.knownInputs ?? [] }),
    requested_outputs: [SHARE_OUTPUT],
    capability_hints: [...(options.hints ?? [numericHint(), resultHint()])]
  };
}

export const DNP_ID = "card_pan";
export const DNP_SECRET = "4111-1111-PAN-SECRET-77";
export const DNP_OTHER_SECRET = "5500-0000-PAN-OTHER-88";

/** READY Prompt A output whose DO_NOT_PERSIST KnownInput is referenced by a constraint dependency and a capability hint. */
export function dnpReadyAnalysis(): StructuredIntentEnvelope {
  const base = readyAnalysis({
    knownInputs: [knownInput({ id: DNP_ID, value: DNP_SECRET, sensitivity: "DO_NOT_PERSIST" }), knownInput({ id: "payer", value: "Alice" })],
    hints: [numericHint(), resultHint({ source_item_ids: ["per_person_amount", DNP_ID] })]
  });
  return { ...base, constraints: base.constraints.map((item) => ({ ...item, depends_on_ids: [DNP_ID] })) };
}

/** Prompt A output that needs a required User answer (no safe default) before the gate can pass. */
export function clarifyingAnalysis(): StructuredIntentEnvelope {
  const headcount = llmProposal({
    id: "headcount",
    required_for_execution: true,
    can_default: false,
    expected_value_type: "NUMBER",
    question_type: "NUMBER",
    proposed_default: 10
  });
  return {
    ...analysis({ missing_fields: [headcount] }),
    requested_outputs: [SHARE_OUTPUT],
    capability_hints: [numericHint({ constraint_item_ids: [], source_item_ids: ["headcount"] }), resultHint()]
  };
}

export const blueprintCandidate = (): JsonValue => validBlueprint() as JsonValue;

export type HarnessOptions = {
  readonly coverage?: (request: CoverageResolutionRequest) => CoverageResult;
  readonly validatorRegistry?: ValidatorRegistry;
  /** Replaces the scripted gateway (e.g. the production OpenAI-compatible adapter over a fake fetch). */
  readonly gateway?: ModelGateway;
  /** Replaces the real F07 intake (e.g. a failing intake to prove Evidence is non-blocking). */
  readonly intake?: F02EvidenceIntake;
};

export type PostOptions = {
  readonly key?: string;
  readonly anon?: string | null;
  readonly headers?: Record<string, string | undefined>;
  readonly rawBody?: string | Uint8Array;
};

let harnessSeed = 0;

export function createF01Harness(options: HarnessOptions = {}) {
  harnessSeed += 1;
  const seed = harnessSeed.toString(16).padStart(4, "0");
  let idCounter = 0;
  let traceCounter = 0;
  const newId = (): string => `00000000-0000-4000-8${seed.slice(-3)}-${(++idCounter).toString(16).padStart(12, "0")}`;
  const newTraceId = (): string => `${seed}${(++traceCounter).toString(16).padStart(28, "0")}`;
  const clock = new ManualClock("2026-10-06T00:00:00.000Z");
  const db = new FakeF01Postgres();
  const identities = new FakeIdentityRepository(db);
  const evidenceRows: EvidenceEventInput[] = [];
  const diagnostics: unknown[] = [];
  const diagnosticsSink = { reportNonBlockingFailure: (error: unknown) => diagnostics.push(error) };
  const intake = new EvidenceIngestionService({
    anonymousIdentities: identities,
    evidence: {
      insert: async (event) => {
        evidenceRows.push(event);
        return "INSERTED" as const;
      }
    },
    diagnostics: diagnosticsSink,
    now: clock.now
  });
  const gateway = new ScriptedModelGateway();
  const progress: CreateProgressSnapshot[] = [];
  const runs = new PostgresCompilerRunRepository(db);
  const service = new IntentCompilerService({
    intents: new PostgresIntentRepository(db),
    runs,
    outcomes: runs,
    idempotency: new PostgresIdempotencyRepository(db),
    identities,
    admission: new PostgresBlueprintAdmissionRepository(db),
    gateway: options.gateway ?? gateway,
    evidence: { intake: options.intake ?? intake, diagnostics: diagnosticsSink, now: clock.now, newEventId: newId },
    clock: clock.now,
    newId,
    newTraceId,
    ...(options.coverage === undefined ? {} : { coverage: options.coverage }),
    ...(options.validatorRegistry === undefined ? {} : { validatorRegistry: options.validatorRegistry }),
    progressObserver: (snapshot) => progress.push(snapshot)
  });
  const handler = createIntentApiHandler({ service, createRequestId: newId });

  async function post(path: string, body: unknown, postOptions: PostOptions = {}): Promise<IntentApiHttpResponse> {
    const response = await handler({
      method: "POST",
      path,
      headers: { "Content-Type": "application/json", "Idempotency-Key": postOptions.key ?? "key-default", ...postOptions.headers },
      body: postOptions.rawBody ?? JSON.stringify(body),
      trustedAnonymousId: postOptions.anon === undefined ? ANON : postOptions.anon
    });
    if (response === undefined) throw new Error(`route ${path} was not handled`);
    return response;
  }

  const createBody = (raw = RAW_INTENT_MARKER): Record<string, unknown> => ({ anonymous_id: ANON, intent_kind: "CREATE", raw_intent: raw });
  const create = (key = "create-1", body: unknown = createBody()) => post("/api/v1/intents", body, { key });
  const answers = (intentId: string, body: unknown, key = "answers-1") => post(`/api/v1/intents/${intentId}/answers`, body, { key });
  const compile = (intentId: string, intentVersion: number, key = "compile-1") => post(`/api/v1/intents/${intentId}/compile`, { intent_version: intentVersion }, { key });
  const compileWith = (intentId: string, intentVersion: number, ephemeralInputs: unknown, key = "compile-1") =>
    post(`/api/v1/intents/${intentId}/compile`, { intent_version: intentVersion, ephemeral_inputs: ephemeralInputs }, { key });
  /** Every durable row this harness persists (intent / compiler_run / idempotency / F02 / Evidence / diagnostics). */
  const durableText = (): string =>
    JSON.stringify([
      [...db.intents.values()],
      [...db.compilerRuns.values()],
      [...db.operations.values()],
      [...db.blueprint.runs.values()],
      [...db.blueprint.contents.values()],
      evidenceRows,
      diagnostics.map(String)
    ]);

  /** READY intent created through the real API (Prompt A scripted). */
  async function readyIntent(analysisOutput: StructuredIntentEnvelope = readyAnalysis(), key = "create-ready"): Promise<{ intentId: string; version: number }> {
    gateway.queueAnalysis(succeeded(analysisOutput as unknown as JsonValue));
    const response = await create(key);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const data = dataOf(response);
    expect(data.status).toBe("READY");
    return { intentId: String(data.intent_id), version: Number(data.intent_version) };
  }

  return { clock, db, gateway, service, handler, evidenceRows, diagnostics, progress, post, create, createBody, answers, compile, compileWith, durableText, readyIntent };
}

export type F01Harness = ReturnType<typeof createF01Harness>;

export function dataOf(response: IntentApiHttpResponse): Record<string, unknown> {
  const data = response.body.data;
  if (typeof data !== "object" || data === null) throw new Error(`response has no data: ${JSON.stringify(response.body)}`);
  return data as Record<string, unknown>;
}

export function errorOf(response: IntentApiHttpResponse): { code: string; message_key: string; retryable: boolean; retry_after_seconds: number | null; details: Record<string, unknown> } {
  const error = response.body.error;
  if (typeof error !== "object" || error === null) throw new Error(`response has no error: ${JSON.stringify(response.body)}`);
  return error as ReturnType<typeof errorOf>;
}

export function progressOf(response: IntentApiHttpResponse): CreateProgressSnapshot {
  return dataOf(response).progress as CreateProgressSnapshot;
}
