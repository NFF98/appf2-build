import { VALIDATOR_REGISTRY } from "../../generated/capabilities/validator-registry.js";
import { createExecutionAdmissionService } from "../platform/blueprint/execution-admission.js";
import { SplitBlueprintAdmissionRepository } from "../platform/blueprint/f02-admission-port.js";
import { PostgresOriginalIntentReadRepository } from "../platform/blueprint/original-intent-lineage.js";
import { PostgresPublishedShareRepository } from "../platform/blueprint/published-share-repository.js";
import type { PostgresExecutor } from "../platform/blueprint/postgres-blueprint-repository.js";
import { createBundledReleaseSource } from "../platform/capabilities/bundled-release.js";
import { BLUEPRINT_SCHEMA_RANGE, RUNTIME_VERSION } from "../platform/capabilities/registry.js";
import { CORE_CAPABILITY_HANDLERS } from "../platform/runtime/core-handlers.js";
import {
  WorkerPostgresExecutor,
  NO_REQUEST_DB_CONTEXT,
  type HyperdrivePostgresBinding,
  type WorkerRequestDbContext
} from "../platform/blueprint/worker-postgres-executor.js";
import { IntentCompilerService } from "../platform/compiler/intent-service.js";
import { OpenAiCompatibleModelGateway } from "../platform/compiler/openai-compatible-gateway.js";
import { appf2ModelProviderConfig, appf2ModelFallbackConfig } from "../platform/compiler/appf2-model-provider.js";
import { RateLimitFailoverGateway } from "../platform/compiler/rate-limit-failover-gateway.js";
import {
  PostgresCompilerRunRepository,
  PostgresIdempotencyRepository,
  PostgresIntentRepository
} from "../platform/compiler/postgres-compiler-repository.js";
import { EvidenceIngestionService } from "../platform/evidence/evidence-ingestion-service.js";
import { F07EventExecutor } from "../platform/evidence/f07-event-executor.js";
import {
  PostgresAnonymousIdentityRepository,
  PostgresEvidenceRepository
} from "../platform/evidence/postgres-evidence-repository.js";
import type { EvidenceIngestionDiagnostics } from "../platform/evidence/evidence-repository.js";
import type { EvidenceRetentionDiagnostics } from "../platform/evidence/evidence-retention-maintenance.js";
import type { BlueprintDeliveryComposition } from "./blueprint-delivery.js";
import { createF07EventsBatchHandler } from "./evidence-runtime.js";
import { createIntentApiHandler } from "./intent-api.js";

export interface Appf2WorkerEnv {
  readonly HYPERDRIVE_FRESH: HyperdrivePostgresBinding;
  /** Dedicated F02 admission login: member of `appf2_f02_admission` only, never of the general Worker login. */
  readonly HYPERDRIVE_F02_ADMISSION: HyperdrivePostgresBinding;
  /** Dedicated F07 Event-only login: member of `appf2_f07_event` only. */
  readonly HYPERDRIVE_F07_EVENTS: HyperdrivePostgresBinding;
  readonly APPF2_MODEL_BASE_URL: string;
  readonly APPF2_MODEL_API_KEY: string;
  readonly APPF2_MODEL_NAME: string;
  readonly APPF2_QA_BROWSER?: unknown;
  /** Candidate multi-file Job API: disabled unless explicitly enabled in a protected staging Worker. */
  readonly APPF2_AGENT_CANDIDATE_ENABLED?: string;
  /** Second independent opt-in for paid model dispatch: OFF unless "1". */
  readonly APPF2_AGENT_MODEL_EXECUTION_ENABLED?: string;
  /** Dedicated OpenAI key; never reuse the F01 provider's key or expose to browser. */
  readonly APPF2_OPENAI_AGENT_API_KEY?: string;
  /** Private Sandbox bridge: all three must match one owner-approved test Job. */
  readonly APPF2_AGENT_SANDBOX_EXECUTION_ENABLED?: string;
  readonly APPF2_SANDBOX_BROKER_URL?: string;
  readonly APPF2_SANDBOX_BROKER_TOKEN?: string;
  readonly APPF2_SANDBOX_ALLOWED_JOB_ID?: string;
  readonly APPF2_MODEL_PROVIDER?: "openai" | "xai" | "deepseek";
  /** Set only with explicit authorization to send a 429 retry to this provider. */
  readonly APPF2_MODEL_FALLBACK_PROVIDER?: "xai" | "deepseek";
  readonly APPF2_XAI_API_KEY?: string;
  readonly APPF2_XAI_MODEL_NAME?: string;
  readonly APPF2_DEEPSEEK_API_KEY?: string;
  readonly APPF2_DEEPSEEK_MODEL_NAME?: string;
  readonly APPF2_MODEL_INPUT_COST_PER_MILLION?: string;
  readonly APPF2_MODEL_OUTPUT_COST_PER_MILLION?: string;
  readonly APPF2_MODEL_OUTPUT_CAP_ANALYSIS?: string;
  readonly APPF2_MODEL_OUTPUT_CAP_BLUEPRINT?: string;
  readonly APPF2_IDENTITY_COOKIE_SECRET: string;
}

export interface ClosableExecutor {
  close(): Promise<void>;
}

/** F01-API-ID-001A item 4: one proven CREATE PoP key binds one logical CREATE across anonymous_ids. */
export interface CreateKeyBinding {
  available(idempotencyKey: string, anonymousId: string): Promise<boolean>;
  heldElsewhere(): boolean;
}

type EventsHandler = ReturnType<typeof createF07EventsBatchHandler>;

export interface WorkerRequestComposition {
  readonly executor: ClosableExecutor;
  readonly createKeys: CreateKeyBinding;
  readonly intent: ReturnType<typeof createIntentApiHandler>;
  readonly events: EventsHandler;
}

const diagnostics: EvidenceIngestionDiagnostics & EvidenceRetentionDiagnostics = {
  reportNonBlockingFailure: () => {
    console.error("APPF2 evidence diagnostic recorded.");
  },
  reportMaintenanceFailure: () => {
    console.error("APPF2 evidence retention diagnostic recorded.");
  }
};

export function createWorkerRequestComposition(env: Appf2WorkerEnv, context: WorkerRequestDbContext): WorkerRequestComposition {
  const executor = new WorkerPostgresExecutor(env.HYPERDRIVE_FRESH, context);
  const identities = new PostgresAnonymousIdentityRepository(executor);
  const intake = new EvidenceIngestionService({
    anonymousIdentities: identities,
    evidence: new PostgresEvidenceRepository(executor),
    diagnostics,
    now: () => new Date()
  });
  const runs = new PostgresCompilerRunRepository(executor);
  const aiConfig = {
    APPF2_MODEL_PROVIDER: env.APPF2_MODEL_PROVIDER,
    APPF2_MODEL_FALLBACK_PROVIDER: env.APPF2_MODEL_FALLBACK_PROVIDER,
    APPF2_MODEL_BASE_URL: env.APPF2_MODEL_BASE_URL,
    APPF2_MODEL_API_KEY: env.APPF2_MODEL_API_KEY,
    APPF2_MODEL_NAME: env.APPF2_MODEL_NAME,
    APPF2_XAI_API_KEY: env.APPF2_XAI_API_KEY,
    APPF2_XAI_MODEL_NAME: env.APPF2_XAI_MODEL_NAME,
    APPF2_DEEPSEEK_API_KEY: env.APPF2_DEEPSEEK_API_KEY,
    APPF2_DEEPSEEK_MODEL_NAME: env.APPF2_DEEPSEEK_MODEL_NAME,
    APPF2_MODEL_INPUT_COST_PER_MILLION: env.APPF2_MODEL_INPUT_COST_PER_MILLION,
    APPF2_MODEL_OUTPUT_COST_PER_MILLION: env.APPF2_MODEL_OUTPUT_COST_PER_MILLION,
    APPF2_MODEL_OUTPUT_CAP_ANALYSIS: env.APPF2_MODEL_OUTPUT_CAP_ANALYSIS,
    APPF2_MODEL_OUTPUT_CAP_BLUEPRINT: env.APPF2_MODEL_OUTPUT_CAP_BLUEPRINT
  };
  const primary = new OpenAiCompatibleModelGateway(appf2ModelProviderConfig(aiConfig).config);
  const alternative = appf2ModelFallbackConfig(aiConfig);
  const gateway = alternative === undefined ? primary :
    new RateLimitFailoverGateway(primary, new OpenAiCompatibleModelGateway(alternative.config));
  /* Existing compiler request remains one logical operation, even if explicit
   * failover after 429 uses one consented alternative. */
  const service = new IntentCompilerService({
    intents: new PostgresIntentRepository(executor),
    runs,
    outcomes: runs,
    idempotency: new PostgresIdempotencyRepository(executor),
    identities,
    admission: new SplitBlueprintAdmissionRepository(executor, env.HYPERDRIVE_F02_ADMISSION, context),
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
  // Built on the first events request only: a missing F07 binding fails that route closed (503), never other routes.
  let eventExecutor: F07EventExecutor | null = null;
  let events: EventsHandler | null = null;
  const eventsHandler = (): EventsHandler => {
    if (events !== null) return events;
    eventExecutor = new F07EventExecutor(env.HYPERDRIVE_F07_EVENTS);
    events = createF07EventsBatchHandler({
      executor,
      eventExecutor,
      diagnostics,
      now: () => new Date(),
      randomUUID: () => crypto.randomUUID()
    });
    return events;
  };
  return {
    executor: {
      close: async () => {
        await Promise.all([executor.close(), eventExecutor?.close()]);
      }
    },
    createKeys: {
      available: (idempotencyKey, anonymousId) => executor.createKeyAvailable(idempotencyKey, anonymousId),
      heldElsewhere: () => executor.createKeyHeldElsewhere
    },
    intent: createIntentApiHandler({ service, createRequestId: () => crypto.randomUUID() }),
    events: (request) => eventsHandler()(request)
  };
}

/** Original-Intent body read + fresh execution admission against the deployment's actual bundled handler catalog. */
export function createBlueprintDeliveryComposition(env: Appf2WorkerEnv, context: WorkerRequestDbContext): BlueprintDeliveryComposition {
  return composeBlueprintDelivery(new WorkerPostgresExecutor(env.HYPERDRIVE_FRESH, context));
}

/** Public F05 recipient: exact ACTIVE share is checked by a narrow DB function on every request.
 * No original Intent cookie, grant or model invocation is used for a recipient. */
export function createPublicShareDeliveryComposition(env:Appf2WorkerEnv,shareId:string):BlueprintDeliveryComposition{
  const executor=new WorkerPostgresExecutor(env.HYPERDRIVE_FRESH,NO_REQUEST_DB_CONTEXT);
  const content=new PostgresPublishedShareRepository(executor,shareId);
  return {
    executor,
    lineage:{
      verifyLineage:async hash=>{
        const row=await content.readContent(hash);
        return row!==undefined && row.content_hash===hash && row.trust_status==="VALIDATED"
          ? {verified:true as const,content_hash:hash,own_validation_run_id:shareId,registry_digest:row.admitted_registry_digest,trust_status:row.trust_status}
          : {verified:false as const,content_hash:hash,failure:"CONTENT_UNKNOWN" as const};
      },
      readCanonicalBody:(hash)=>content.readCanonicalBody(hash)
    },
    admission:createExecutionAdmissionService({
      content,releases:createBundledReleaseSource({bundledHandlers:CORE_CAPABILITY_HANDLERS}),
      runtimeVersion:RUNTIME_VERSION,supportedBlueprintSchemaRange:BLUEPRINT_SCHEMA_RANGE
    })
  };
}

/** The executor must already be bound to the verified request RLS context. */
export function composeBlueprintDelivery(executor: PostgresExecutor & ClosableExecutor): BlueprintDeliveryComposition {
  const lineage = new PostgresOriginalIntentReadRepository(executor);
  return {
    executor,
    lineage,
    admission: createExecutionAdmissionService({
      content: lineage,
      releases: createBundledReleaseSource({ bundledHandlers: CORE_CAPABILITY_HANDLERS }),
      runtimeVersion: RUNTIME_VERSION,
      supportedBlueprintSchemaRange: BLUEPRINT_SCHEMA_RANGE
    })
  };
}
