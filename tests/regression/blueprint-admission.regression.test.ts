import { expect, test } from "vitest";

import { canonicalBlueprintBytes } from "../../src/platform/blueprint/canonical-json.js";
import { hashBlueprint } from "../../src/platform/blueprint/content-identity.js";
import {
  BlueprintHashIntegrityFailure,
  MemoryBlueprintAdmissionRepository
} from "../../src/platform/blueprint/blueprint-repository.js";
import {
  INSERT_BLUEPRINT_CONTENT_SQL,
  INSERT_VALIDATION_RUN_SQL,
  PostgresBlueprintAdmissionRepository,
  SELECT_BLUEPRINT_CONTENT_SQL,
  type PostgresExecutor,
  type PostgresQueryResult,
  type PostgresTransactionScope
} from "../../src/platform/blueprint/postgres-blueprint-repository.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import type { BlueprintAdmission } from "../../src/platform/blueprint/validation-types.js";
import {
  COMPILER_RUN_ID,
  CREATED_AT,
  encodeBlueprint,
  sha256OfBytes,
  VALIDATION_RUN_ID,
  validationContext,
  validationDependencies,
  validBlueprint
} from "../contract/blueprint-validation-fixture.js";

class RollbackScope implements PostgresTransactionScope {
  committed = false;
  readonly executor = new ConflictExecutor();

  async transaction<T>(work: (executor: PostgresExecutor) => Promise<T>): Promise<T> {
    try {
      const result = await work(this.executor);
      this.committed = true;
      return result;
    } catch (error) {
      this.committed = false;
      throw error;
    }
  }
}

class ConflictExecutor implements PostgresExecutor {
  readonly statements: string[] = [];

  async query<Row>(
    statement: string,
    parameters: readonly unknown[]
  ): Promise<PostgresQueryResult<Row>> {
    this.statements.push(statement);
    if (statement === INSERT_VALIDATION_RUN_SQL) {
      return { rows: [] };
    }
    if (statement === INSERT_BLUEPRINT_CONTENT_SQL) {
      return { rows: [] };
    }
    return {
      rows: [{
        canonical_blueprint: { kind: "DIFFERENT" },
        schema_version: parameters.length === 1 ? "1.0.0" : "1.0.0",
        registry_version: "1.0.0",
        trust_status: "VALIDATED",
        created_at: CREATED_AT,
        admitted_by_validation_run_id: VALIDATION_RUN_ID,
        byte_size: 1
      }] as unknown as readonly Row[]
    };
  }
}

test("TEST-F02-AC-008 persists an admitted Blueprint as immutable blueprint_content", async () => {
  const bytes = encodeBlueprint(validBlueprint());
  const dependencies = validationDependencies();
  const outcome = await validateBlueprintCandidate(
    bytes,
    validationContext({ candidate_source: "COMPOSER", compiler_run_id: COMPILER_RUN_ID }),
    dependencies
  );

  expect(outcome.status).toBe("PASSED");
  if (outcome.status !== "PASSED") {
    return;
  }
  const content = await dependencies.repository.readContent(outcome.content_hash);
  const run = await dependencies.repository.readRun(VALIDATION_RUN_ID);
  expect(content).not.toBeNull();
  expect(run).not.toBeNull();
  if (content === null || run === null) {
    return;
  }
  expect(content.content_hash).toBe(hashBlueprint(validBlueprint()));
  expect(content.content_hash).toBe(outcome.content_hash);
  expect(content.trust_status).toBe("VALIDATED");
  expect(content.admitted_by_validation_run_id).toBe(VALIDATION_RUN_ID);
  expect(content.byte_size).toBe(canonicalBlueprintBytes(validBlueprint()).byteLength);
  expect(content.canonical_bytes).toEqual(canonicalBlueprintBytes(validBlueprint()));
  expect(run.status).toBe("PASSED");
  expect(run.compiler_run_id).toBe(COMPILER_RUN_ID);
  expect(run.candidate_digest).toBe(sha256OfBytes(bytes));
  expect(run.blueprint_hash).toBe(content.content_hash);
  expect(run.report.content_hash).toBe(content.content_hash);
  expect(JSON.stringify(run.report)).not.toContain("Split a bill");
  const mutable = content.canonical_blueprint as Record<string, unknown>;
  mutable.kind = "MUTATED";
  const reread = await dependencies.repository.readContent(outcome.content_hash);
  expect(reread?.canonical_bytes).toEqual(content.canonical_bytes);
  expect((reread?.canonical_blueprint as { kind?: string }).kind).toBe("APP");
});

test("identical canonical content is reused and hash mismatch rolls back", async () => {
  const first = validationDependencies();
  const compact = encodeBlueprint(validBlueprint());
  const pretty = new TextEncoder().encode(JSON.stringify(validBlueprint(), null, 2));
  const firstOutcome = await validateBlueprintCandidate(compact, validationContext(), first);
  expect(firstOutcome.status).toBe("PASSED");
  if (firstOutcome.status !== "PASSED") {
    return;
  }
  const second = validationDependencies(
    first.repository,
    () => "423e4567-e89b-42d3-a456-426614174333"
  );
  const secondOutcome = await validateBlueprintCandidate(pretty, validationContext(), second);
  expect(secondOutcome.status).toBe("PASSED");
  const original = await first.repository.readContent(firstOutcome.content_hash);
  const secondRun = await first.repository.readRun("423e4567-e89b-42d3-a456-426614174333");
  expect(original?.admitted_by_validation_run_id).toBe(VALIDATION_RUN_ID);
  expect(original?.created_at).toBe("2026-10-02T00:00:00.000Z");
  expect(secondRun?.blueprint_hash).toBe(firstOutcome.content_hash);
  expect(secondRun?.validation_run_id).not.toBe(original?.admitted_by_validation_run_id);

  const conflicting = new MemoryBlueprintAdmissionRepository({
    contents: [{
      content_hash: firstOutcome.content_hash,
      canonical_blueprint: { kind: "DIFFERENT" },
      canonical_bytes: canonicalBlueprintBytes({ kind: "DIFFERENT" }),
      schema_version: "1.0.0",
      registry_version: "1.0.0",
      trust_status: "VALIDATED",
      created_at: "2026-10-01T00:00:00.000Z",
      admitted_by_validation_run_id: "523e4567-e89b-42d3-a456-426614174444",
      byte_size: canonicalBlueprintBytes({ kind: "DIFFERENT" }).byteLength
    }]
  });
  const conflict = await validateBlueprintCandidate(
    compact,
    validationContext(),
    validationDependencies(conflicting, () => "623e4567-e89b-42d3-a456-426614174555")
  );
  expect(conflict.status).toBe("REJECTED");
  expect(conflict.validation_report.issues[0]).toMatchObject({
    error_code: "F02-ERR-015",
    stage: "V12",
    message_key: "hash_integrity_failure"
  });
  expect(conflict.validation_report.content_hash).toBeNull();
  expect(await conflicting.readRun("623e4567-e89b-42d3-a456-426614174555")).toBeNull();
  const preserved = await conflicting.readContent(firstOutcome.content_hash);
  expect(preserved?.canonical_bytes).toEqual(canonicalBlueprintBytes({ kind: "DIFFERENT" }));
  expect(preserved?.admitted_by_validation_run_id).toBe("523e4567-e89b-42d3-a456-426614174444");
});

test("postgres admission inserts the validation run before content and rolls back hash mismatch", async () => {
  const scope = new RollbackScope();
  const repository = new PostgresBlueprintAdmissionRepository(scope);
  const admission: BlueprintAdmission = {
    run: {
      validation_run_id: VALIDATION_RUN_ID,
      compiler_run_id: null,
      candidate_digest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      blueprint_hash: hashBlueprint(validBlueprint()),
      schema_version: "1.0.0",
      registry_version: "1.0.0",
      status: "PASSED",
      error_codes: [],
      report: {
        validation_run_id: VALIDATION_RUN_ID,
        candidate_digest: "sha256:0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        status: "PASSED",
        schema_version: "1.0.0",
        registry_version: "1.0.0",
        content_hash: hashBlueprint(validBlueprint()),
        issues: [],
        warnings: [],
        resource_usage: {
          blueprint_bytes: 1,
          node_count: 1,
          state_count: 0,
          rule_count: 0,
          action_count: 0,
          event_binding_count: 0,
          timer_count: 0
        },
        trace_id: "trace-sp2-t002"
      },
      created_at: CREATED_AT,
      trace_id: "trace-sp2-t002"
    },
    content: {
      content_hash: hashBlueprint(validBlueprint()),
      canonical_blueprint: validBlueprint(),
      canonical_bytes: canonicalBlueprintBytes(validBlueprint()),
      schema_version: "1.0.0",
      registry_version: "1.0.0",
      trust_status: "VALIDATED",
      created_at: CREATED_AT,
      admitted_by_validation_run_id: VALIDATION_RUN_ID,
      byte_size: canonicalBlueprintBytes(validBlueprint()).byteLength
    }
  };

  await expect(repository.admit(admission)).rejects.toBeInstanceOf(BlueprintHashIntegrityFailure);
  expect(scope.committed).toBe(false);
  expect(scope.executor.statements).toEqual([
    INSERT_VALIDATION_RUN_SQL,
    INSERT_BLUEPRINT_CONTENT_SQL,
    SELECT_BLUEPRINT_CONTENT_SQL
  ]);
  expect(INSERT_BLUEPRINT_CONTENT_SQL).toContain("ON CONFLICT (content_hash) DO NOTHING");
  expect(INSERT_BLUEPRINT_CONTENT_SQL).not.toContain("DO UPDATE");
  expect(INSERT_VALIDATION_RUN_SQL).not.toContain("INSERT INTO public.compiler_run");
  expect(INSERT_VALIDATION_RUN_SQL).toContain("$2::uuid");
});
