import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "pg";
import { afterAll, beforeAll, describe, expect, test } from "vitest";

import {
  encodeBase64Url,
  keyThumbprint,
  mutationProofTranscript,
  POP_KEY_HEADER,
  POP_SIGNATURE_HEADER,
  POP_TIMESTAMP_HEADER,
  reservedCreateIdempotencyKey
} from "../../src/edge/create-proof.js";
import type { Appf2WorkerEnv } from "../../src/edge/worker-composition.js";
import { createWorkerFetch } from "../../src/edge/worker-entry.js";
import { WorkerPostgresExecutor } from "../../src/platform/blueprint/worker-postgres-executor.js";
import { clarifyingAnalysis } from "./f01-harness.js";

/**
 * Real PostgreSQL: every migration (incl. PG-001) on a throwaway scratch database, a LOGIN NOSUPERUSER NOBYPASSRLS
 * NOINHERIT role that is only a member of appf2_worker, and the production Worker composition. The model endpoint is
 * a local deterministic `clarifyingAnalysis()` fixture: this verifies wiring and authorization, not LLM quality.
 */
const adminUrl = process.env.APPF2_TEST_ADMIN_DATABASE_URL;
const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);
const PG001_ROLES = ["appf2_worker", "appf2_retention", "appf2_f02_admission", "appf2_f02_trust", "appf2_f07_event"];
const ORIGIN = "https://app.example";
const CREATE_PATH = "/api/v1/intents";

const suffix = randomBytes(4).toString("hex");
const scratchDb = `appf2_pg001_it_${suffix}`;
const loginRole = `appf2_worker_login_it_${suffix}`;
const loginPassword = randomBytes(24).toString("hex");
const f02LoginRole = `appf2_f02_login_it_${suffix}`;
const f02LoginPassword = randomBytes(24).toString("hex");
let f02LoginUrl = "";

let admin: Client | null = null;
let setup: Client | null = null;
let modelStub: http.Server | null = null;
let loginUrl = "";
let env: Appf2WorkerEnv;
const send = createWorkerFetch();

interface PopKey {
  readonly privateKey: CryptoKey;
  readonly spki: string;
  readonly createKey: string;
}

async function popKey(): Promise<PopKey> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return { privateKey: pair.privateKey, spki: encodeBase64Url(spki), createKey: reservedCreateIdempotencyKey(await keyThumbprint(spki)) };
}

const createBody = (anonymousId: string): string =>
  JSON.stringify({ anonymous_id: anonymousId, intent_kind: "CREATE", raw_intent: "Split a dinner bill between friends" });

async function provenCreate(key: PopKey, body: string): Promise<Response> {
  const timestamp = Date.now();
  const bytes = new TextEncoder().encode(body);
  const transcript = await mutationProofTranscript({ method: "POST", path: CREATE_PATH, body: bytes, idempotencyKey: key.createKey }, timestamp);
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, transcript));
  return send(new Request(`${ORIGIN}${CREATE_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      "Sec-Fetch-Site": "same-origin",
      "Idempotency-Key": key.createKey,
      [POP_KEY_HEADER]: key.spki,
      [POP_SIGNATURE_HEADER]: encodeBase64Url(signature),
      [POP_TIMESTAMP_HEADER]: String(timestamp)
    },
    body
  }), env);
}

interface ErrorBody {
  readonly data?: { readonly intent_id?: string };
  readonly error?: { readonly code?: string; readonly details?: { readonly violations?: readonly { readonly reason?: string }[] } };
}

async function outcome(response: Response) {
  const body = (await response.json()) as ErrorBody;
  return {
    status: response.status,
    intentId: body.data?.intent_id ?? null,
    error: body.error === undefined ? null : `${body.error.code}/${body.error.details?.violations?.[0]?.reason ?? "-"}`,
    cookie: response.headers.get("set-cookie")
  };
}

async function durableState() {
  const result = await (setup as Client).query(`SELECT
    (SELECT count(*)::int FROM public.intent_record) AS intents,
    (SELECT count(*)::int FROM public.idempotency_operation) AS operations,
    (SELECT count(*)::int FROM public.anonymous_identity) AS identities`);
  return result.rows[0] as { intents: number; operations: number; identities: number };
}

beforeAll(async () => {
  if (adminUrl === undefined) return;
  const target = new URL(adminUrl);
  if (!["127.0.0.1", "localhost", "[::1]"].includes(target.hostname)) {
    throw new Error("APPF2_TEST_ADMIN_DATABASE_URL must point to a loopback test database");
  }
  admin = new Client({ connectionString: adminUrl });
  await admin.connect();
  const existing = await admin.query("SELECT rolname FROM pg_roles WHERE rolname = ANY($1)", [PG001_ROLES]);
  if (existing.rowCount !== 0) throw new Error("PG-001 roles already exist in this cluster; use a cluster without them");
  await admin.query(`CREATE DATABASE ${scratchDb}`);
  const scratch = new URL(adminUrl);
  scratch.pathname = `/${scratchDb}`;
  setup = new Client({ connectionString: scratch.href });
  await setup.connect();
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
    await setup.query(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  }
  await setup.query(
    `CREATE ROLE ${loginRole} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD '${loginPassword}'`
  );
  await setup.query(`GRANT appf2_worker TO ${loginRole}`);
  const login = new URL(scratch.href);
  login.username = loginRole;
  login.password = loginPassword;
  loginUrl = login.href;
  await setup.query(
    `CREATE ROLE ${f02LoginRole} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD '${f02LoginPassword}'`
  );
  await setup.query(`GRANT appf2_f02_admission TO ${f02LoginRole}`);
  const f02Login = new URL(scratch.href);
  f02Login.username = f02LoginRole;
  f02Login.password = f02LoginPassword;
  f02LoginUrl = f02Login.href;

  const fixture = JSON.stringify(clarifyingAnalysis());
  modelStub = http.createServer((request, response) => {
    request.resume();
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({
      model: "local-deterministic-fixture",
      choices: [{ message: { role: "assistant", content: fixture } }],
      usage: { prompt_tokens: 1, completion_tokens: 1 }
    }));
  });
  await new Promise<void>((resolve) => modelStub?.listen(0, "127.0.0.1", resolve));
  env = {
    HYPERDRIVE_FRESH: { connectionString: loginUrl },
    HYPERDRIVE_F02_ADMISSION: { connectionString: f02LoginUrl },
    HYPERDRIVE_F07_EVENTS: { connectionString: "postgres://unused" },
    APPF2_MODEL_BASE_URL: `http://127.0.0.1:${(modelStub.address() as AddressInfo).port}/v1`,
    APPF2_MODEL_API_KEY: "local-deterministic-fixture",
    APPF2_MODEL_NAME: "local-deterministic-fixture",
    APPF2_IDENTITY_COOKIE_SECRET: randomBytes(32).toString("hex")
  };
}, 60_000);

afterAll(async () => {
  await new Promise<void>((resolve) => (modelStub === null ? resolve() : modelStub.close(() => resolve())));
  await setup?.end().catch(() => undefined);
  if (admin === null) return;
  await admin.query(`DROP DATABASE IF EXISTS ${scratchDb} WITH (FORCE)`);
  for (const role of [loginRole, f02LoginRole, ...PG001_ROLES]) await admin.query(`DROP ROLE IF EXISTS ${role}`);
  await admin.end();
}, 60_000);

describe.skipIf(adminUrl === undefined)("GOV-CASE-PG-001 Worker on real PostgreSQL with RLS", () => {
  test("Worker login role is non-superuser, cannot bypass RLS, and statements run as appf2_worker", async () => {
    const anonymousId = randomUUID();
    const executor = new WorkerPostgresExecutor({ connectionString: loginUrl }, { anonymousId, intentId: null });
    try {
      const role = await executor.query<{ rolsuper: boolean; rolbypassrls: boolean }>(
        "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = session_user",
        []
      );
      expect(role.rows).toEqual([{ rolsuper: false, rolbypassrls: false }]);
      const scoped = await executor.query<{ role: string; anonymous_id: string; payload: string }>(
        "SELECT current_user AS role, current_setting('app.anonymous_id', true) AS anonymous_id, $1::text AS payload",
        ["' OR 1=1 --"]
      );
      expect(scoped.rows).toEqual([{ role: "appf2_worker", anonymous_id: anonymousId, payload: "' OR 1=1 --" }]);
    } finally {
      await executor.close();
    }
  });

  test("proven CREATE succeeds with a scoped cookie; same-key retry returns the same intent", async () => {
    const key = await popKey();
    const anonymousId = randomUUID();
    const first = await outcome(await provenCreate(key, createBody(anonymousId)));
    expect(first.status).toBe(200);
    expect(first.cookie).toContain(`Path=/api/v1/intents/${first.intentId}/`);
    const before = await durableState();
    const retry = await outcome(await provenCreate(key, createBody(anonymousId)));
    expect(retry.status).toBe(200);
    expect(retry.intentId).toBe(first.intentId);
    expect((await durableState()).intents).toBe(before.intents);
  });

  test("RLS hides another anonymous_id's intent from the Worker role", async () => {
    const owner = randomUUID();
    const created = await outcome(await provenCreate(await popKey(), createBody(owner)));
    expect(created.status).toBe(200);
    const visibleTo = async (anonymousId: string) => {
      const executor = new WorkerPostgresExecutor({ connectionString: loginUrl }, { anonymousId, intentId: null });
      try {
        const rows = await executor.query<{ n: number }>("SELECT count(*)::int AS n FROM public.intent_record WHERE intent_id = $1", [created.intentId]);
        return rows.rows[0]?.n;
      } finally {
        await executor.close();
      }
    };
    expect(await visibleTo(owner)).toBe(1);
    expect(await visibleTo(randomUUID())).toBe(0);
  });

  test("unsigned CREATE and same PoP key under another anonymous_id are 400 with zero F01 writes and no cookie", async () => {
    const key = await popKey();
    expect((await outcome(await provenCreate(key, createBody(randomUUID())))).status).toBe(200);
    const before = await durableState();
    const unsigned = await send(new Request(`${ORIGIN}${CREATE_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Origin: ORIGIN, "Idempotency-Key": "legacy-create" },
      body: createBody(randomUUID())
    }), env);
    expect(await outcome(unsigned)).toMatchObject({ status: 400, error: "F01-ERR-001/PROOF_INVALID", cookie: null });
    const reused = await outcome(await provenCreate(key, createBody(randomUUID())));
    expect(reused).toMatchObject({ status: 400, error: "F01-ERR-001/PROOF_INVALID", cookie: null });
    expect(await durableState()).toEqual(before);
  });

  test("concurrent same PoP key from two anonymous_ids: one intent, one holder, one cookie, loser 400 F01-ERR-001", async () => {
    for (let round = 0; round < 3; round += 1) {
      const key = await popKey();
      const results = await Promise.all([randomUUID(), randomUUID()].map(async (anonymousId) => outcome(await provenCreate(key, createBody(anonymousId)))));
      expect(results.map((result) => result.status).sort()).toEqual([200, 400]);
      expect(results.find((result) => result.status === 400)?.error).toBe("F01-ERR-001/PROOF_INVALID");
      expect(results.filter((result) => result.cookie !== null)).toHaveLength(1);
      const held = await (setup as Client).query(
        "SELECT count(*)::int AS operations, count(DISTINCT anonymous_id)::int AS holders FROM public.idempotency_operation WHERE idempotency_key = $1",
        [key.createKey]
      );
      expect(held.rows[0]).toEqual({ operations: 1, holders: 1 });
    }
  });
});
