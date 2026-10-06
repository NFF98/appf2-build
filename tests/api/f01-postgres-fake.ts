import {
  POSTGRES_ADMIT_BLUEPRINT_CONTENT_SQL,
  POSTGRES_INSERT_VALIDATION_RUN_SQL,
  type PostgresExecutor,
  type PostgresQueryResult
} from "../../src/platform/blueprint/postgres-blueprint-repository.js";
import { INTENT_LIFECYCLE_STATUSES } from "../../src/platform/compiler/compiler-records.js";
import {
  POSTGRES_ACQUIRE_IDEMPOTENCY_ATTEMPT_SQL,
  POSTGRES_COMPLETE_IDEMPOTENCY_OPERATION_SQL,
  POSTGRES_CREATE_RECEIVED_INTENT_SQL,
  POSTGRES_FIND_SCOPED_INTENT_SQL,
  POSTGRES_FINISH_COMPILER_RUN_SQL,
  POSTGRES_INSERT_IDEMPOTENCY_OPERATION_SQL,
  POSTGRES_LIST_VALIDATION_OUTCOMES_SQL,
  POSTGRES_READ_IDEMPOTENCY_OPERATION_SQL,
  POSTGRES_READ_VALIDATED_RESULT_SQL,
  POSTGRES_START_COMPILER_RUN_SQL,
  POSTGRES_TRANSITION_INTENT_SQL
} from "../../src/platform/compiler/postgres-compiler-repository.js";
import type { AnonymousIdentityRepository, AnonymousIdentityStatus } from "../../src/platform/evidence/evidence-repository.js";
import { FakeBlueprintPostgres } from "../contract/blueprint-postgres-fake.js";

type Row = Record<string, unknown>;

export type StoredOperation = {
  idempotency_operation_id: string;
  anonymous_id: string;
  route_key: string;
  idempotency_key: string;
  request_digest: string;
  status: string;
  attempt_no: number;
  lease_expires_at: string | null;
  result_ref_type: string | null;
  result_ref_id: string | null;
  http_status: number | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string;
};

export type StoredIntent = {
  intent_id: string;
  anonymous_id: string;
  intent_kind: string;
  raw_intent: string | null;
  structured_intent: unknown;
  resolved_intent: unknown;
  lifecycle_status: string;
  intent_version: number;
  source_blueprint_hash: string | null;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
};

export type StoredCompilerRun = {
  compiler_run_id: string;
  intent_id: string;
  stage: string;
  status: string;
  prompt_version: string;
  schema_version: string;
  registry_version: string;
  model_adapter: string;
  provider_model: string | null;
  attempt_no: number;
  started_at: string;
  finished_at: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
  estimated_cost: number | null;
  failure_code: string | null;
  trace_id: string;
};

const ms = (value: string | null): number => (value === null ? Number.NaN : Date.parse(value));
const LIFECYCLE = new Set<string>(INTENT_LIFECYCLE_STATUSES);
const json = (text: unknown): unknown => (text === null ? null : (JSON.parse(String(text)) as unknown));

/**
 * In-memory interpreter of the exact T001 SQL constants, mirroring their WHERE guards (attempt ownership,
 * intent_version CAS, single-winner acquisition, late-completion rejection) and the migration constraints
 * (FKs incl. the staged validation_run → compiler_run FK, enum / JSON-object / unique checks).
 */
export class FakeF01Postgres implements PostgresExecutor {
  public readonly blueprint = new FakeBlueprintPostgres();
  public readonly identities = new Map<string, AnonymousIdentityStatus>();
  public readonly operations = new Map<string, StoredOperation>();
  public readonly intents = new Map<string, StoredIntent>();
  public readonly compilerRuns = new Map<string, StoredCompilerRun>();
  public readonly statements: string[] = [];
  /** Test hook run before a statement executes (used to interleave a competing attempt deterministically). */
  public beforeStatement: ((statement: string) => Promise<void> | void) | undefined;

  /** F01 statements are interpreted here; F02 admission statements go to the existing blueprint fake. */
  public async query<R>(statement: string, parameters: readonly unknown[]): Promise<PostgresQueryResult<R>> {
    const hook = this.beforeStatement;
    if (hook !== undefined) await hook(statement);
    this.statements.push(statement);
    const handler = this.handlers.get(statement);
    if (handler !== undefined) return { rows: handler(parameters) as R[] };
    if (statement === POSTGRES_INSERT_VALIDATION_RUN_SQL || statement === POSTGRES_ADMIT_BLUEPRINT_CONTENT_SQL) {
      this.assertCompilerRunFk(parameters[1]);
    }
    return this.blueprint.query<R>(statement, parameters);
  }

  public operationFor(routeKey: string, idempotencyKey: string): StoredOperation | undefined {
    return [...this.operations.values()].find((row) => row.route_key === routeKey && row.idempotency_key === idempotencyKey);
  }

  private readonly handlers = new Map<string, (parameters: readonly unknown[]) => Row[]>([
    [POSTGRES_INSERT_IDEMPOTENCY_OPERATION_SQL, (p) => this.insertOperation(p)],
    [POSTGRES_READ_IDEMPOTENCY_OPERATION_SQL, (p) => this.readOperation(p)],
    [POSTGRES_ACQUIRE_IDEMPOTENCY_ATTEMPT_SQL, (p) => this.acquire(p)],
    [POSTGRES_COMPLETE_IDEMPOTENCY_OPERATION_SQL, (p) => this.complete(p)],
    [POSTGRES_CREATE_RECEIVED_INTENT_SQL, (p) => this.createIntent(p)],
    [POSTGRES_FIND_SCOPED_INTENT_SQL, (p) => this.findIntent(p)],
    [POSTGRES_TRANSITION_INTENT_SQL, (p) => this.transition(p)],
    [POSTGRES_START_COMPILER_RUN_SQL, (p) => this.startRun(p)],
    [POSTGRES_FINISH_COMPILER_RUN_SQL, (p) => this.finishRun(p)],
    [POSTGRES_LIST_VALIDATION_OUTCOMES_SQL, (p) => this.listOutcomes(p)],
    [POSTGRES_READ_VALIDATED_RESULT_SQL, (p) => this.readValidated(p)]
  ]);

  private assertCompilerRunFk(compilerRunId: unknown): void {
    if (compilerRunId !== null && !this.compilerRuns.has(String(compilerRunId))) {
      throw new Error("insert or update on table validation_run violates foreign key constraint validation_run_compiler_run_fk");
    }
  }

  private insertOperation(p: readonly unknown[]): Row[] {
    const [id, anon, route, key, digest, lease, now, expires] = p as string[];
    if ([...this.operations.values()].some((row) => row.anonymous_id === anon && row.route_key === route && row.idempotency_key === key)) return [];
    const row: StoredOperation = {
      idempotency_operation_id: id!,
      anonymous_id: anon!,
      route_key: route!,
      idempotency_key: key!,
      request_digest: digest!,
      status: "IN_PROGRESS",
      attempt_no: 1,
      lease_expires_at: lease!,
      result_ref_type: null,
      result_ref_id: null,
      http_status: null,
      error_code: null,
      created_at: now!,
      updated_at: now!,
      expires_at: expires!
    };
    this.operations.set(row.idempotency_operation_id, row);
    return [{ ...row }];
  }

  private readOperation(p: readonly unknown[]): Row[] {
    const [anon, route, key] = p as string[];
    const row = [...this.operations.values()].find((entry) => entry.anonymous_id === anon && entry.route_key === route && entry.idempotency_key === key);
    return row === undefined ? [] : [{ ...row }];
  }

  private acquire(p: readonly unknown[]): Row[] {
    const [id, expectedStatus, expectedAttempt, lease, now, resetDigest, resetCreated, resetExpires] = p as [string, string, number, string, string, string | null, string | null, string | null];
    const row = this.operations.get(id);
    if (row === undefined || row.status !== expectedStatus || row.attempt_no !== expectedAttempt) return [];
    const reset = resetDigest !== null;
    const eligible = reset
      ? ms(row.expires_at) <= ms(now)
      : row.status === "FAILED_RETRYABLE" || (row.status === "IN_PROGRESS" && ms(row.lease_expires_at) <= ms(now));
    if (!eligible) return [];
    Object.assign(row, { status: "IN_PROGRESS", attempt_no: row.attempt_no + 1, lease_expires_at: lease, updated_at: now });
    if (reset) {
      Object.assign(row, { request_digest: resetDigest, created_at: resetCreated, expires_at: resetExpires, result_ref_type: null, result_ref_id: null, http_status: null, error_code: null });
    }
    return [{ ...row }];
  }

  private complete(p: readonly unknown[]): Row[] {
    const [id, attempt, status, http, error, refType, refId, now] = p as [string, number, string, number, string | null, string | null, string | null, string];
    const row = this.operations.get(id);
    if (row === undefined || row.attempt_no !== attempt || row.status !== "IN_PROGRESS") return [];
    const typeMissing = (refType ?? row.result_ref_type) === null;
    const idMissing = (refId ?? row.result_ref_id) === null;
    if (typeMissing !== idMissing) throw new Error("idempotency_operation result_ref pair check violation");
    Object.assign(row, {
      status,
      http_status: http,
      error_code: error,
      result_ref_type: refType ?? row.result_ref_type,
      result_ref_id: refId ?? row.result_ref_id,
      lease_expires_at: null,
      updated_at: now
    });
    return [{ attempt_no: row.attempt_no }];
  }

  private ownsAttempt(operationId: unknown, attempt: unknown): boolean {
    const row = this.operations.get(String(operationId));
    return row !== undefined && row.attempt_no === attempt && row.status === "IN_PROGRESS";
  }

  private createIntent(p: readonly unknown[]): Row[] {
    const [opId, attempt, intentId, anon, kind, raw, hash, now] = p as [string, number, string, string, string, string, string | null, string];
    const operation = this.operations.get(opId);
    if (!this.ownsAttempt(opId, attempt) || operation === undefined || operation.result_ref_id !== null) return [];
    if (!this.identities.has(anon)) throw new Error("intent_record violates foreign key constraint intent_record_anonymous_id_fkey");
    if (this.intents.has(intentId)) throw new Error("duplicate key value violates intent_record_pkey");
    Object.assign(operation, { result_ref_type: "INTENT", result_ref_id: intentId });
    this.intents.set(intentId, {
      intent_id: intentId,
      anonymous_id: anon,
      intent_kind: kind,
      raw_intent: raw,
      structured_intent: null,
      resolved_intent: null,
      lifecycle_status: "RECEIVED",
      intent_version: 1,
      source_blueprint_hash: hash,
      created_at: now,
      updated_at: now,
      expires_at: null
    });
    return [{ intent_id: intentId }];
  }

  private findIntent(p: readonly unknown[]): Row[] {
    const [intentId, anon] = p as string[];
    const row = this.intents.get(intentId!);
    return row === undefined || row.anonymous_id !== anon ? [] : [structuredClone(row)];
  }

  private transition(p: readonly unknown[]): Row[] {
    const [opId, attempt, intentId, expected, status, setStructured, structured, setResolved, resolved, setExpires, expires, now] = p as [
      string, number, string, number, string, boolean, string | null, boolean, string | null, boolean, string | null, string
    ];
    const owner = this.ownsAttempt(opId, attempt);
    const row = this.intents.get(intentId);
    if (!owner || row === undefined || row.intent_version !== expected) return [{ owner_current: owner, intent_version: null }];
    if (!LIFECYCLE.has(status)) throw new Error("intent_record_lifecycle_status_check violation");
    const next = {
      structured_intent: setStructured ? json(structured) : row.structured_intent,
      resolved_intent: setResolved ? json(resolved) : row.resolved_intent
    };
    if (next.resolved_intent !== null && next.structured_intent === null) throw new Error("intent_record_resolved_requires_structured violation");
    Object.assign(row, next, { lifecycle_status: status, intent_version: row.intent_version + 1, updated_at: now, expires_at: setExpires ? expires : row.expires_at });
    return [{ owner_current: true, intent_version: row.intent_version }];
  }

  private startRun(p: readonly unknown[]): Row[] {
    const [opId, attempt] = p as [string, number];
    const [runId, intentId, stage, prompt, schema, registry, adapter, started, trace] = p.slice(2) as string[];
    if (!this.ownsAttempt(opId, attempt)) return [{ attempt_no: null }];
    if (!this.intents.has(intentId!)) throw new Error("compiler_run violates foreign key constraint compiler_run_intent_id_fkey");
    const attemptNo = 1 + Math.max(0, ...[...this.compilerRuns.values()].filter((run) => run.intent_id === intentId && run.stage === stage).map((run) => run.attempt_no));
    this.compilerRuns.set(runId!, {
      compiler_run_id: runId!,
      intent_id: intentId!,
      stage: stage!,
      status: "STARTED",
      prompt_version: prompt!,
      schema_version: schema!,
      registry_version: registry!,
      model_adapter: adapter!,
      provider_model: null,
      attempt_no: attemptNo,
      started_at: started!,
      finished_at: null,
      latency_ms: null,
      input_tokens: null,
      output_tokens: null,
      estimated_cost: null,
      failure_code: null,
      trace_id: trace!
    });
    return [{ attempt_no: attemptNo }];
  }

  private finishRun(p: readonly unknown[]): Row[] {
    const [runId, status, providerModel, finished, latency, inTokens, outTokens, cost, failureCode] = p as [string, string, string | null, string, number, number | null, number | null, number | null, string | null];
    const run = this.compilerRuns.get(runId);
    if (run === undefined || run.status !== "STARTED") return [];
    if (failureCode !== null && !/^F01-ERR-[0-9]{3}$/.test(failureCode)) throw new Error("compiler_run_failure_code_check violation");
    Object.assign(run, { status, provider_model: providerModel, finished_at: finished, latency_ms: latency, input_tokens: inTokens, output_tokens: outTokens, estimated_cost: cost, failure_code: failureCode });
    return [];
  }

  private listOutcomes(p: readonly unknown[]): Row[] {
    const [intentId, since] = p as [string, string | null];
    return [...this.blueprint.runs.values()]
      .filter((run) => run.compiler_run_id !== null && this.compilerRuns.get(run.compiler_run_id)?.intent_id === intentId)
      .filter((run) => since === null || ms(run.created_at) >= ms(since))
      .sort((left, right) => ms(right.created_at) - ms(left.created_at) || (left.validation_run_id < right.validation_run_id ? 1 : -1))
      .slice(0, 16)
      .map((run) => ({ validation_run_id: run.validation_run_id, status: run.status, error_codes: run.error_codes, created_at: run.created_at }));
  }

  private readValidated(p: readonly unknown[]): Row[] {
    const run = this.blueprint.runs.get(String(p[0]));
    if (run?.status !== "PASSED" || run.compiler_run_id === null || run.blueprint_hash === null) return [];
    const compiler = this.compilerRuns.get(run.compiler_run_id);
    const content = this.blueprint.contents.get(run.blueprint_hash);
    if (compiler === undefined || content === undefined) return [];
    return [{
      validation_run_id: run.validation_run_id,
      intent_id: compiler.intent_id,
      content_hash: content.content_hash,
      schema_version: content.schema_version,
      registry_version: content.registry_version,
      trust_status: content.trust_status
    }];
  }
}

export class FakeIdentityRepository implements AnonymousIdentityRepository {
  public constructor(private readonly database: FakeF01Postgres) {}

  public async ensure(anonymousId: string): Promise<AnonymousIdentityStatus> {
    const existing = this.database.identities.get(anonymousId);
    if (existing !== undefined) return existing;
    this.database.identities.set(anonymousId, "ACTIVE");
    return "ACTIVE";
  }

  public async refreshLastSeen(): Promise<void> {}
}
