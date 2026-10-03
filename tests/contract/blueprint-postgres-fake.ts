import { canonicalizeJson } from "../../src/platform/blueprint/canonical-json.js";
import {
  POSTGRES_ADMIT_BLUEPRINT_CONTENT_SQL,
  POSTGRES_INSERT_VALIDATION_RUN_SQL,
  type PostgresExecutor,
  type PostgresQueryResult
} from "../../src/platform/blueprint/postgres-blueprint-repository.js";

export interface StoredValidationRun {
  readonly validation_run_id: string;
  readonly compiler_run_id: string | null;
  readonly candidate_digest: string;
  readonly blueprint_hash: string | null;
  readonly schema_version: string;
  readonly registry_version: string;
  readonly status: string;
  readonly error_codes: unknown;
  readonly report: Record<string, unknown>;
  readonly created_at: string;
  readonly trace_id: string;
}

export interface StoredBlueprintContent {
  readonly content_hash: string;
  readonly canonical_blueprint: unknown;
  readonly schema_version: string;
  readonly registry_version: string;
  trust_status: string;
  readonly created_at: string;
  readonly admitted_by_validation_run_id: string;
  readonly byte_size: number;
}

const DIGEST = /^sha256:[0-9a-f]{64}$/;

export class FakeBlueprintPostgres implements PostgresExecutor {
  public readonly runs = new Map<string, StoredValidationRun>();
  public readonly contents = new Map<string, StoredBlueprintContent>();
  public readonly statements: string[] = [];

  public async query<Row>(statement: string, parameters: readonly unknown[]): Promise<PostgresQueryResult<Row>> {
    this.statements.push(statement);
    if (statement === POSTGRES_INSERT_VALIDATION_RUN_SQL) {
      this.insertRun(parameters);
      return { rows: [] };
    }
    if (statement === POSTGRES_ADMIT_BLUEPRINT_CONTENT_SQL) {
      return { rows: [this.admit(parameters) as Row] };
    }
    throw new Error("Unexpected SQL statement.");
  }

  private insertRun(parameters: readonly unknown[]): void {
    const [id, compilerRunId, digest, hash, schema, registry, status, errorCodes, report, createdAt, traceId] = parameters as [
      string,
      string | null,
      string,
      string | null,
      string,
      string,
      string,
      string,
      string,
      string,
      string
    ];
    if (this.runs.has(id)) {
      throw new Error("duplicate key value violates validation_run_pkey");
    }
    if (!DIGEST.test(digest) || (hash !== null && !DIGEST.test(hash))) {
      throw new Error("validation_run digest check violation");
    }
    if (!["PASSED", "REJECTED", "INCOMPATIBLE"].includes(status) || (status === "PASSED") !== (hash !== null)) {
      throw new Error("validation_run status/blueprint_hash check violation");
    }
    this.runs.set(id, {
      validation_run_id: id,
      compiler_run_id: compilerRunId,
      candidate_digest: digest,
      blueprint_hash: hash,
      schema_version: schema,
      registry_version: registry,
      status,
      error_codes: JSON.parse(errorCodes) as unknown,
      report: JSON.parse(report) as Record<string, unknown>,
      created_at: createdAt,
      trace_id: traceId
    });
  }

  private admit(parameters: readonly unknown[]): Record<string, unknown> {
    const runId = parameters[0] as string;
    const hash = parameters[3] as string;
    const createdAt = parameters[9] as string;
    const [body, schema, registry, byteSize] = parameters.slice(11) as [string, string, string, number];
    const existing = this.contents.get(hash);
    const bodyMatches =
      existing === undefined ||
      (canonicalizeJson(existing.canonical_blueprint) === canonicalizeJson(JSON.parse(body)) && existing.byte_size === byteSize);
    const stored = existing ?? {
      content_hash: hash,
      canonical_blueprint: JSON.parse(body) as unknown,
      schema_version: schema,
      registry_version: registry,
      trust_status: "VALIDATED",
      created_at: createdAt,
      admitted_by_validation_run_id: runId,
      byte_size: byteSize
    };
    if (bodyMatches) {
      this.insertRun(parameters.slice(0, 11));
      this.contents.set(hash, stored);
    }
    return {
      inserted: stored.admitted_by_validation_run_id === runId,
      body_matches: bodyMatches,
      trust_status: stored.trust_status,
      run_recorded: bodyMatches
    };
  }
}
