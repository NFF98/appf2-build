import { describe, expect, test } from "vitest";

import { createF07EventsBatchHandler } from "../../src/edge/evidence-runtime.js";
import type { Appf2WorkerEnv } from "../../src/edge/worker-composition.js";
import { createWorkerFetch } from "../../src/edge/worker-entry.js";
import { WorkerPostgresExecutor } from "../../src/platform/blueprint/worker-postgres-executor.js";
import { F07EventExecutor } from "../../src/platform/evidence/f07-event-executor.js";

/** F07-EVENT-001: the production events factory requires the dedicated F07 executor; there is no Worker fallback. */
const UNUSED = { connectionString: "postgres://unused@127.0.0.1:1/unused" };
const diagnostics = { reportNonBlockingFailure: () => undefined, reportMaintenanceFailure: () => undefined };

const baseEnv = (): Appf2WorkerEnv => ({
  HYPERDRIVE_FRESH: UNUSED,
  HYPERDRIVE_F02_ADMISSION: UNUSED,
  HYPERDRIVE_F07_EVENTS: UNUSED,
  APPF2_MODEL_BASE_URL: "http://127.0.0.1:1/v1",
  APPF2_MODEL_API_KEY: "unused",
  APPF2_MODEL_NAME: "unused",
  APPF2_IDENTITY_COOKIE_SECRET: "0".repeat(64)
});

const identityFreeBatch = () =>
  JSON.stringify({
    batch_id: crypto.randomUUID(),
    events: [{
      event_id: crypto.randomUUID(),
      event_type: "F05-EVT-007",
      schema_version: "2.0.0",
      occurred_at: new Date().toISOString(),
      anonymous_id: null,
      function_id: "F05",
      properties: { share_mode: "DURABLE_REFERENCE" }
    }]
  });

describe("F07 events runtime: dedicated channel is mandatory", () => {
  test("missing / empty F07 binding is refused at construction; a general Worker executor is not accepted", () => {
    expect(() => new F07EventExecutor(undefined as never)).toThrow(/HYPERDRIVE_F07_EVENTS/u);
    expect(() => new F07EventExecutor({ connectionString: "" })).toThrow(/HYPERDRIVE_F07_EVENTS/u);
    const worker = new WorkerPostgresExecutor(UNUSED);
    // @ts-expect-error the general Worker executor is not an F07 Event-only executor
    expect(() => createF07EventsBatchHandler({ executor: worker, eventExecutor: worker, diagnostics })).toThrow(/dedicated F07/u);
    expect(() => createF07EventsBatchHandler({ executor: worker, eventExecutor: new F07EventExecutor(UNUSED), diagnostics })).not.toThrow();
  });

  test("Worker route without HYPERDRIVE_F07_EVENTS: events fail closed with 503 before any database access", async () => {
    const send = createWorkerFetch();
    const withoutF07 = Object.fromEntries(Object.entries(baseEnv()).filter(([name]) => name !== "HYPERDRIVE_F07_EVENTS")) as unknown as Appf2WorkerEnv;
    for (const env of [withoutF07, { ...baseEnv(), HYPERDRIVE_F07_EVENTS: { connectionString: "" } }]) {
      const response = await send(new Request("https://app.example/api/v1/events/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: identityFreeBatch()
      }), env);
      expect(response.status).toBe(503);
      expect(await response.json()).toEqual({ error: { code: "API-SERVICE-UNAVAILABLE" } });
    }
  });
});
