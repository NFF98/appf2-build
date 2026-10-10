import { VALIDATOR_REGISTRY } from "../../generated/capabilities/validator-registry.js";
import { PostgresBlueprintAdmissionRepository } from "../platform/blueprint/postgres-blueprint-repository.js";
import { WorkerPostgresExecutor, type HyperdrivePostgresBinding } from "../platform/blueprint/worker-postgres-executor.js";
import { IntentCompilerService } from "../platform/compiler/intent-service.js";
import { OpenAiCompatibleModelGateway, openAiCompatibleConfigFromEnv } from "../platform/compiler/openai-compatible-gateway.js";
import {
  PostgresCompilerRunRepository,
  PostgresIdempotencyRepository,
  PostgresIntentRepository
} from "../platform/compiler/postgres-compiler-repository.js";
import { EvidenceIngestionService } from "../platform/evidence/evidence-ingestion-service.js";
import {
  PostgresAnonymousIdentityRepository,
  PostgresEvidenceRepository
} from "../platform/evidence/postgres-evidence-repository.js";
import type { EvidenceIngestionDiagnostics } from "../platform/evidence/evidence-repository.js";
import { createProductionEventsBatchHandler } from "./evidence-runtime.js";
import { createIntentApiHandler } from "./intent-api.js";

export interface Appf2WorkerEnv {
  readonly HYPERDRIVE_FRESH: HyperdrivePostgresBinding;
  readonly APPF2_MODEL_BASE_URL: string;
  readonly APPF2_MODEL_API_KEY: string;
  readonly APPF2_MODEL_NAME: string;
  readonly APPF2_MODEL_INPUT_COST_PER_MILLION?: string;
  readonly APPF2_MODEL_OUTPUT_COST_PER_MILLION?: string;
  readonly APPF2_IDENTITY_COOKIE_SECRET: string;
}

export interface WorkerRequestComposition {
  readonly executor: WorkerPostgresExecutor;
  readonly intent: ReturnType<typeof createIntentApiHandler>;
  readonly events: ReturnType<typeof createProductionEventsBatchHandler>;
}

const diagnostics: EvidenceIngestionDiagnostics = {
  reportNonBlockingFailure: () => {
    console.error("APPF2 evidence diagnostic recorded.");
  }
};

export function createWorkerRequestComposition(env: Appf2WorkerEnv): WorkerRequestComposition {
  const executor = new WorkerPostgresExecutor(env.HYPERDRIVE_FRESH);
  const identities = new PostgresAnonymousIdentityRepository(executor);
  const intake = new EvidenceIngestionService({
    anonymousIdentities: identities,
    evidence: new PostgresEvidenceRepository(executor),
    diagnostics,
    now: () => new Date()
  });
  const runs = new PostgresCompilerRunRepository(executor);
  const gateway = new OpenAiCompatibleModelGateway(openAiCompatibleConfigFromEnv({
    APPF2_MODEL_BASE_URL: env.APPF2_MODEL_BASE_URL,
    APPF2_MODEL_API_KEY: env.APPF2_MODEL_API_KEY,
    APPF2_MODEL_NAME: env.APPF2_MODEL_NAME,
    APPF2_MODEL_INPUT_COST_PER_MILLION: env.APPF2_MODEL_INPUT_COST_PER_MILLION,
    APPF2_MODEL_OUTPUT_COST_PER_MILLION: env.APPF2_MODEL_OUTPUT_COST_PER_MILLION
  }));
  const service = new IntentCompilerService({
    intents: new PostgresIntentRepository(executor),
    runs,
    outcomes: runs,
    idempotency: new PostgresIdempotencyRepository(executor),
    identities,
    admission: new PostgresBlueprintAdmissionRepository(executor),
    gateway,
    validatorRegistry: VALIDATOR_REGISTRY,
    evidence: {
      intake,
      diagnostics,
      now: () => new Date(),
      newEventId: () => crypto.randomUUID()
    },
    clock: () => new Date(),
    newId: () => crypto.randomUUID(),
    newTraceId: () => crypto.randomUUID().replaceAll("-", "")
  });
  return {
    executor,
    intent: createIntentApiHandler({ service, createRequestId: () => crypto.randomUUID() }),
    events: createProductionEventsBatchHandler({
      executor,
      diagnostics,
      now: () => new Date(),
      randomUUID: () => crypto.randomUUID()
    })
  };
}
