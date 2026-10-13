import { randomBytes } from "node:crypto";

import type { WorkerRequestDbContext } from "../../src/platform/blueprint/worker-postgres-executor.js";
import { verifyAdmissionLineage } from "../../src/platform/blueprint/admission-lineage.js";
import { POSTGRES_READ_ORIGINAL_INTENT_LINEAGE_SQL } from "../../src/platform/blueprint/original-intent-lineage.js";
import type { PostgresExecutor, PostgresQueryResult } from "../../src/platform/blueprint/postgres-blueprint-repository.js";
import { composeBlueprintDelivery, type Appf2WorkerEnv, type WorkerRequestComposition } from "../../src/edge/worker-composition.js";
import { createWorkerFetch } from "../../src/edge/worker-entry.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";
import { blueprintCandidate, createF01Harness, readyAnalysis, succeeded } from "./f01-harness.js";
import type { FakeF01Postgres } from "./f01-postgres-fake.js";

/** Provenance of every run on this backend: real Worker + F01/F02/F03 code, in-memory SQL fakes, scripted model. */
export const S03_BACKEND_PROVENANCE = "FIXTURE: real createWorkerFetch + IntentCompilerService + F02 validation over in-memory SQL fakes; scripted model (no live LLM)";

const UNUSED_BINDING = { connectionString: "postgres://unused.invalid/appf2" };

/**
 * Answers the one original-Intent read statement from the F01/F02 fakes with the PG-001 RLS meaning: no row unless
 * this request's intent (owned by its anonymous_id) has its own PASSED run for the hash; `original_*` is the first
 * admitting run's lineage verdict. Every other statement is refused so delivery can never touch anything else.
 */
export class FakeLineageExecutor implements PostgresExecutor {
  public constructor(
    private readonly db: FakeF01Postgres,
    private readonly context: WorkerRequestDbContext
  ) {}

  public async query<Row>(statement: string, parameters: readonly unknown[]): Promise<PostgresQueryResult<Row>> {
    if (statement !== POSTGRES_READ_ORIGINAL_INTENT_LINEAGE_SQL) throw new Error("statement outside the original-Intent read surface");
    const row = await this.lineageRow(String(parameters[0]));
    return { rows: row === null ? [] : [row as Row] };
  }

  public async close(): Promise<void> {}

  private async lineageRow(contentHash: string): Promise<Record<string, unknown> | null> {
    const { intentId, anonymousId } = this.context;
    const intent = intentId === null ? undefined : this.db.intents.get(intentId);
    const content = this.db.blueprint.contents.get(contentHash);
    if (intent === undefined || intent.anonymous_id !== anonymousId || content === undefined) return null;
    const own = [...this.db.blueprint.runs.values()]
      .filter((run) => run.status === "PASSED" && run.blueprint_hash === contentHash && this.db.compilerRuns.get(run.compiler_run_id ?? "")?.intent_id === intentId)
      .sort((left, right) => right.created_at.localeCompare(left.created_at))[0];
    if (own === undefined) return null;
    const admitting = this.db.blueprint.runs.get(content.admitted_by_validation_run_id) ?? null;
    const original = await verifyAdmissionLineage(contentHash, { readAdmissionLineage: async () => ({ content, admitting_run: admitting }) });
    // appf2_original_admission_integrity judges the admitting run only; body integrity is left to the repository.
    const verdict = original.verified || original.failure === "BODY_INTEGRITY_FAILURE" ? "VERIFIED" : original.failure;
    const reported = (admitting?.report as { registry_digest?: unknown } | undefined)?.registry_digest;
    return {
      ...content,
      own_validation_run_id: own.validation_run_id,
      own_candidate_digest: own.candidate_digest,
      own_blueprint_hash: own.blueprint_hash,
      own_schema_version: own.schema_version,
      own_registry_version: own.registry_version,
      own_status: own.status,
      own_error_codes: own.error_codes,
      own_report: own.report,
      own_trace_id: own.trace_id,
      original_verdict: verdict,
      original_registry_digest: verdict === "VERIFIED" && typeof reported === "string" ? reported : null
    };
  }
}

export interface S03Backend {
  readonly provenance: string;
  readonly env: Appf2WorkerEnv;
  readonly harness: ReturnType<typeof createF01Harness>;
  /** The production Worker fetch handler with in-memory compositions injected. */
  handle(request: Request): Promise<Response>;
  /** Model gateway calls so far (Prompt A analysis + Prompt B compose). */
  modelCalls(): number;
}

/** One scripted natural-language → READY → compiled Blueprint run (the F02 fixture: 人數 / 總額 / 每人金額). */
export function createS03Backend(options: { readonly now?: () => number } = {}): S03Backend {
  const harness = createF01Harness();
  harness.gateway.queueAnalysis(succeeded(readyAnalysis() as unknown as JsonValue)).queueCompose(succeeded(blueprintCandidate()));
  const env: Appf2WorkerEnv = {
    HYPERDRIVE_FRESH: UNUSED_BINDING,
    HYPERDRIVE_F02_ADMISSION: UNUSED_BINDING,
    HYPERDRIVE_F07_EVENTS: UNUSED_BINDING,
    APPF2_MODEL_BASE_URL: "https://model.invalid/v1",
    APPF2_MODEL_API_KEY: "unused",
    APPF2_MODEL_NAME: "unused",
    APPF2_IDENTITY_COOKIE_SECRET: randomBytes(32).toString("hex")
  };
  const intent = (): WorkerRequestComposition => ({
    executor: { close: async () => undefined },
    createKeys: { available: async () => true, heldElsewhere: () => false },
    intent: harness.handler,
    events: async () => ({ status: 503, headers: {}, body: { error: { code: "API-SERVICE-UNAVAILABLE" } } })
  });
  const worker = createWorkerFetch(
    { intent, delivery: (_env, context) => composeBlueprintDelivery(new FakeLineageExecutor(harness.db, context)) },
    options.now === undefined ? {} : { now: options.now }
  );
  return {
    provenance: S03_BACKEND_PROVENANCE,
    env,
    harness,
    handle: (request) => worker(request, env),
    modelCalls: () => harness.gateway.requests.length
  };
}
