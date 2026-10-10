import { afterEach, expect, test } from "vitest";

import { WorkerPostgresExecutor } from "../../src/platform/blueprint/worker-postgres-executor.js";

const databaseUrl = process.env.APPF2_TEST_DATABASE_URL;
let executor: WorkerPostgresExecutor | null = null;

afterEach(async () => {
  await executor?.close();
  executor = null;
});

test.skipIf(databaseUrl === undefined)("real PostgreSQL execution role is non-superuser and cannot bypass RLS", async () => {
  executor = new WorkerPostgresExecutor({ connectionString: databaseUrl as string });
  const result = await executor.query<{ readonly rolsuper: boolean; readonly rolbypassrls: boolean }>(
    "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user",
    []
  );
  expect(result.rows).toHaveLength(1);
  expect(result.rows[0]).toEqual({ rolsuper: false, rolbypassrls: false });
});

test.skipIf(databaseUrl === undefined)("real PostgreSQL executor preserves parameter binding", async () => {
  executor = new WorkerPostgresExecutor({ connectionString: databaseUrl as string });
  const payload = "' OR 1=1 --";
  const result = await executor.query<{ readonly value: string }>("SELECT $1::text AS value", [payload]);
  expect(result.rows).toEqual([{ value: payload }]);
});
