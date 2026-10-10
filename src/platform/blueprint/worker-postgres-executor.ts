import { Client } from "pg";

import type { PostgresExecutor, PostgresQueryResult } from "./postgres-blueprint-repository.js";

export interface HyperdrivePostgresBinding {
  readonly connectionString: string;
}

/** Request-scoped node-postgres adapter over Cloudflare Hyperdrive. */
export class WorkerPostgresExecutor implements PostgresExecutor {
  private client: Client | null = null;

  public constructor(private readonly binding: HyperdrivePostgresBinding) {}

  private async connectedClient(): Promise<Client> {
    if (this.client !== null) return this.client;
    const client = new Client({ connectionString: this.binding.connectionString });
    await client.connect();
    this.client = client;
    return client;
  }

  public async query<Row>(statement: string, parameters: readonly unknown[]): Promise<PostgresQueryResult<Row>> {
    const client = await this.connectedClient();
    const result = await client.query(statement, [...parameters]);
    return { rows: result.rows as readonly Row[] };
  }

  public async close(): Promise<void> {
    const client = this.client;
    this.client = null;
    if (client !== null) await client.end();
  }
}
