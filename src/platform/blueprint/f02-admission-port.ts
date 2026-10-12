import { Client } from "pg";

import type {
  BlueprintAdmissionRepository,
  BlueprintContentRecord,
  ContentAdmissionOutcome,
  ValidationRunRecord
} from "./blueprint-admission.js";
import { hashBlueprint, hashCanonicalBlueprintBytes } from "./content-identity.js";
import {
  POSTGRES_ADMIT_BLUEPRINT_CONTENT_SQL,
  PostgresBlueprintAdmissionRepository,
  type PostgresExecutor,
  type PostgresQueryResult
} from "./postgres-blueprint-repository.js";
import type { HyperdrivePostgresBinding, WorkerRequestDbContext } from "./worker-postgres-executor.js";

export const F02_ADMISSION_DB_ROLE = "appf2_f02_admission";

/**
 * Executes exactly the locked F02 admission statement as `appf2_f02_admission` over the dedicated F02 binding, whose
 * LOGIN may assume only that role. There is no general-purpose query surface with the elevated role: any other
 * statement is refused before a connection is opened. One connection per admission; it is always closed.
 */
class F02AdmissionStatementExecutor implements PostgresExecutor {
  public constructor(
    private readonly binding: HyperdrivePostgresBinding,
    private readonly context: { readonly anonymousId: string; readonly intentId: string },
    private readonly admittingContentHash: string
  ) {}

  public async query<Row>(statement: string, parameters: readonly unknown[]): Promise<PostgresQueryResult<Row>> {
    if (statement !== POSTGRES_ADMIT_BLUEPRINT_CONTENT_SQL) {
      throw new Error("F02 admission port executes only the locked Blueprint admission statement.");
    }
    const client = new Client({ connectionString: this.binding.connectionString });
    await client.connect();
    try {
      await client.query("BEGIN");
      const settings: readonly (readonly [string, string])[] = [
        ["app.anonymous_id", this.context.anonymousId],
        ["app.intent_id", this.context.intentId],
        ["app.admitting_content_hash", this.admittingContentHash],
        ["app.trust_transition_content_hash", ""],
        ["app.evidence_source_row_id", ""],
        ["app.retention_policy_version", ""]
      ];
      for (const [key, value] of settings) await client.query("SELECT set_config($1, $2, true)", [key, value]);
      await client.query(`SET LOCAL ROLE ${F02_ADMISSION_DB_ROLE}`);
      const result = await client.query(statement, [...parameters]);
      await client.query("COMMIT");
      return { rows: result.rows as readonly Row[] };
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally {
      await client.end().catch(() => undefined);
    }
  }
}

/**
 * Split F02 repository: rejected/failed validation runs stay on the least-privilege Worker port; a sealed PASSED run
 * admits content only through the dedicated F02 port, with `app.admitting_content_hash` recomputed here from the exact
 * canonical bytes being stored (the caller's hash is compared, never trusted).
 */
export class SplitBlueprintAdmissionRepository implements BlueprintAdmissionRepository {
  private readonly worker: PostgresBlueprintAdmissionRepository;

  public constructor(
    workerExecutor: PostgresExecutor,
    private readonly admissionBinding: HyperdrivePostgresBinding,
    private readonly context: WorkerRequestDbContext
  ) {
    this.worker = new PostgresBlueprintAdmissionRepository(workerExecutor);
  }

  public recordValidationRun(run: ValidationRunRecord): Promise<void> {
    return this.worker.recordValidationRun(run);
  }

  public async admitValidatedContent(run: ValidationRunRecord, content: BlueprintContentRecord): Promise<ContentAdmissionOutcome> {
    const fromBytes = hashCanonicalBlueprintBytes(new TextEncoder().encode(content.canonical_blueprint));
    if (
      run.status !== "PASSED" ||
      fromBytes !== hashBlueprint(JSON.parse(content.canonical_blueprint)) ||
      fromBytes !== content.content_hash ||
      fromBytes !== run.blueprint_hash
    ) {
      throw new Error("F02 admission refused: content hash is not the server-computed hash of a PASSED run.");
    }
    const { anonymousId, intentId } = this.context;
    if (anonymousId === null || intentId === null) throw new Error("F02 admission refused: no verified intent context.");
    const port = new F02AdmissionStatementExecutor(this.admissionBinding, { anonymousId, intentId }, fromBytes);
    return new PostgresBlueprintAdmissionRepository(port).admitValidatedContent(run, content);
  }
}
