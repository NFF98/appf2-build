import { Client } from "pg";

import type { HyperdrivePostgresBinding } from "../blueprint/worker-postgres-executor.js";
import { isUuid } from "./evidence-field-schema.js";
import {
  POSTGRES_ENSURE_ANONYMOUS_IDENTITY_SQL,
  POSTGRES_INSERT_EVIDENCE_SQL,
  POSTGRES_READ_ANONYMOUS_IDENTITY_STATUS_SQL,
  POSTGRES_REFRESH_LAST_SEEN_SQL,
  type PostgresExecutor,
  type PostgresQueryResult
} from "./postgres-evidence-repository.js";

export const F07_EVENT_DB_ROLE = "appf2_f07_event";

interface F07EventContext {
  readonly anonymousId: string;
  readonly eventId: string;
}

function requiredUuid(value: unknown): string {
  if (!isUuid(value)) throw new Error("F07 event channel requires canonical uuid parameters.");
  return value.toLowerCase();
}

function identityContext(parameters: readonly unknown[]): F07EventContext {
  return { anonymousId: requiredUuid(parameters[0]), eventId: "" };
}

/** `$1` event_id, `$5` optional anonymous_id of POSTGRES_INSERT_EVIDENCE_SQL. */
function eventContext(parameters: readonly unknown[]): F07EventContext {
  const anonymousId = parameters[4];
  return { eventId: requiredUuid(parameters[0]), anonymousId: anonymousId === null ? "" : requiredUuid(anonymousId) };
}

const F07_EVENT_STATEMENTS: ReadonlyMap<string, (parameters: readonly unknown[]) => F07EventContext> = new Map([
  [POSTGRES_ENSURE_ANONYMOUS_IDENTITY_SQL, identityContext],
  [POSTGRES_READ_ANONYMOUS_IDENTITY_STATUS_SQL, identityContext],
  [POSTGRES_REFRESH_LAST_SEEN_SQL, identityContext],
  [POSTGRES_INSERT_EVIDENCE_SQL, eventContext]
]);

/**
 * F07-EVENT-001 Event-only channel over a dedicated binding whose LOGIN may assume only `appf2_f07_event`. Executes only
 * the locked identity-ensure / last-seen / product_event statements; each runs in its own transaction whose context is
 * bound to that statement's own uuid parameters, so one event can never touch another identity or event row. A browser
 * anonymous_id reaching this channel is correlation only and never enters the F01 / F02 Worker context.
 */
export class F07EventExecutor implements PostgresExecutor {
  private client: Client | null = null;

  public constructor(private readonly binding: HyperdrivePostgresBinding) {
    const connectionString = (binding as Partial<HyperdrivePostgresBinding> | undefined)?.connectionString;
    if (typeof connectionString !== "string" || connectionString.length === 0) {
      throw new Error("F07 event channel binding HYPERDRIVE_F07_EVENTS is not configured.");
    }
  }

  private async connectedClient(): Promise<Client> {
    if (this.client !== null) return this.client;
    const client = new Client({ connectionString: this.binding.connectionString });
    await client.connect();
    this.client = client;
    return client;
  }

  public async query<Row>(statement: string, parameters: readonly unknown[]): Promise<PostgresQueryResult<Row>> {
    const bind = F07_EVENT_STATEMENTS.get(statement);
    if (bind === undefined) throw new Error("F07 event channel executes only the locked event and identity statements.");
    const context = bind(parameters);
    const client = await this.connectedClient();
    try {
      await client.query("BEGIN");
      await client.query("SELECT set_config('app.f07_event_anonymous_id', $1, true), set_config('app.f07_event_id', $2, true)", [
        context.anonymousId,
        context.eventId
      ]);
      await client.query(`SET LOCAL ROLE ${F07_EVENT_DB_ROLE}`);
      const result = await client.query(statement, [...parameters]);
      await client.query("COMMIT");
      return { rows: result.rows as readonly Row[] };
    } catch (error) {
      try {
        await client.query("ROLLBACK");
      } catch {
        this.client = null;
        await client.end().catch(() => undefined);
      }
      throw error;
    }
  }

  public async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client !== null) await client.end();
  }
}
