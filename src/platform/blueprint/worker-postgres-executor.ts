import { Client } from "pg";

import type { PostgresExecutor, PostgresQueryResult } from "./postgres-blueprint-repository.js";

export interface HyperdrivePostgresBinding {
  readonly connectionString: string;
}

/**
 * Request identity bound by the Worker entry after PoP / scoped-cookie verification. F01-API-ID-001: anonymous_id is
 * continuity correlation only, never an owner credential; `intentId` is set only from a verified scoped cookie.
 */
export interface WorkerRequestDbContext {
  readonly anonymousId: string | null;
  readonly intentId: string | null;
}

export const NO_REQUEST_DB_CONTEXT: WorkerRequestDbContext = Object.freeze({ anonymousId: null, intentId: null });

export const WORKER_DB_ROLE = "appf2_worker";
export const CREATE_KEY_SINGLE_HOLDER_INDEX = "idempotency_operation_create_key_single_holder";

const CONTEXT_KEYS = [
  "app.anonymous_id",
  "app.intent_id",
  "app.admitting_content_hash",
  "app.trust_transition_content_hash",
  "app.evidence_source_row_id",
  "app.retention_policy_version"
] as const;

/**
 * Request-scoped node-postgres adapter over Cloudflare Hyperdrive. F01 repositories rely on per-statement durability
 * (idempotency lease, attempt fencing), so every statement is its own transaction:
 * BEGIN -> transaction-local `app.*` context -> SET LOCAL ROLE appf2_worker -> statement -> COMMIT (ROLLBACK on error).
 * Context and role end with the transaction, so nothing carries over to a pooled server connection.
 */
export class WorkerPostgresExecutor implements PostgresExecutor {
  private client: Client | null = null;
  private readonly context: ReadonlyMap<string, string>;
  private keyHeldElsewhere = false;

  public constructor(
    private readonly binding: HyperdrivePostgresBinding,
    context: WorkerRequestDbContext = NO_REQUEST_DB_CONTEXT
  ) {
    const values = new Map<string, string>(CONTEXT_KEYS.map((key) => [key, ""]));
    values.set("app.anonymous_id", context.anonymousId ?? "");
    values.set("app.intent_id", context.intentId ?? "");
    this.context = values;
  }

  /** True only after SQLSTATE 23505 on the single-holder CREATE key index in this request; nothing else is classified. */
  public get createKeyHeldElsewhere(): boolean {
    return this.keyHeldElsewhere;
  }

  private async connectedClient(): Promise<Client> {
    if (this.client !== null) return this.client;
    const client = new Client({ connectionString: this.binding.connectionString });
    await client.connect();
    this.client = client;
    return client;
  }

  public async query<Row>(statement: string, parameters: readonly unknown[]): Promise<PostgresQueryResult<Row>> {
    const client = await this.connectedClient();
    try {
      await client.query("BEGIN");
      for (const [key, value] of this.context) await client.query("SELECT set_config($1, $2, true)", [key, value]);
      await client.query(`SET LOCAL ROLE ${WORKER_DB_ROLE}`);
      const result = await client.query(statement, [...parameters]);
      await client.query("COMMIT");
      return { rows: result.rows as readonly Row[] };
    } catch (error) {
      const failure = error as { code?: unknown; constraint?: unknown };
      if (failure.code === "23505" && failure.constraint === CREATE_KEY_SINGLE_HOLDER_INDEX) this.keyHeldElsewhere = true;
      try {
        await client.query("ROLLBACK");
      } catch {
        this.client = null;
        await client.end().catch(() => undefined);
      }
      throw error;
    }
  }

  /** F01-API-ID-001A item 4: true when the proven CREATE key is unused or already held by this anonymous_id. */
  public async createKeyAvailable(idempotencyKey: string, anonymousId: string): Promise<boolean> {
    const result = await this.query<{ readonly available: boolean }>(
      "SELECT public.appf2_create_key_available($1::text, $2::uuid) AS available",
      [idempotencyKey, anonymousId]
    );
    return result.rows[0]?.available === true;
  }

  public async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client !== null) await client.end();
  }
}
