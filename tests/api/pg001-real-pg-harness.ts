import { randomBytes, randomUUID } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { Client } from "pg";
import { afterAll, beforeAll, expect } from "vitest";

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
import { blueprintCandidate, readyAnalysis } from "./f01-harness.js";

/**
 * Real PostgreSQL harness (Supabase default privileges, then all migrations incl. PG-001) with four LOGIN NOSUPERUSER
 * NOBYPASSRLS NOINHERIT roles: general Worker (member of appf2_worker only), F02 admission (appf2_f02_admission only),
 * F02 trust (appf2_f02_trust only), F07 events (appf2_f07_event only). Model = local deterministic fixture (readyAnalysis / blueprintCandidate): wiring + authorization, not LLM
 * quality. PG-001 roles are cluster-global, so files using this harness must run sequentially.
 */
export const adminUrl = process.env.APPF2_TEST_ADMIN_DATABASE_URL;
const MIGRATIONS = new URL("../../supabase/migrations/", import.meta.url);
const PG001_ROLES = ["appf2_worker", "appf2_retention", "appf2_f02_admission", "appf2_f02_trust", "appf2_f07_event"];
/** Supabase platform defaults (read from the local stack's pg_default_acl / public ACL), replayed before migrations. */
const SUPABASE_DEFAULT_PRIVILEGES = [
  "GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role",
  "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role",
  "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role",
  "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role"
];
export const ORIGIN = "https://app.example";
export const CREATE_PATH = "/api/v1/intents";

export interface PopKey {
  readonly privateKey: CryptoKey;
  readonly spki: string;
  readonly createKey: string;
}

export interface Session {
  readonly key: PopKey;
  readonly anonymousId: string;
  readonly intentId: string;
  readonly intentVersion: number;
  readonly cookie: string;
}

export interface Outcome {
  readonly status: number;
  readonly code: string | null;
  readonly hash: string | null;
  readonly body: unknown;
}

export interface PostOptions {
  readonly cookie: string | null;
  readonly override?: Partial<Appf2WorkerEnv>;
  readonly headerPatch?: Readonly<Record<string, string | null>>;
  readonly sentBody?: string;
}

interface Login {
  readonly role: string;
  readonly grant: string;
  url: string;
}

export interface RealPgHarness {
  readonly logins: { readonly worker: Login; readonly admission: Login; readonly trust: Login; readonly events: Login };
  readonly env: () => Appf2WorkerEnv;
  readonly setProviderDown: (down: boolean) => void;
  readonly popKey: () => Promise<PopKey>;
  readonly signedPost: (key: PopKey, path: string, body: unknown, idempotencyKey: string, options: PostOptions) => Promise<Response>;
  readonly readOutcome: (response: Response) => Promise<Outcome>;
  readonly createIntent: (rawIntent?: string) => Promise<Session>;
  readonly compile: (session: Session, idempotencyKey: string, override?: Partial<Appf2WorkerEnv>, key?: PopKey, cookie?: string | null) => Promise<Outcome>;
  readonly sql: <Row>(statement: string, parameters?: readonly unknown[]) => Promise<Row[]>;
  readonly passedRunsFor: (intentId: string) => Promise<number>;
  readonly contents: () => Promise<{ content_hash: string; trust_status: string; admitted_by_validation_run_id: string }[]>;
  readonly sqlStateAs: (url: string, statements: readonly string[]) => Promise<string | null>;
  readonly scratchUrl: () => string;
}

async function newPopKey(): Promise<PopKey> {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
  const spki = new Uint8Array(await crypto.subtle.exportKey("spki", pair.publicKey));
  return { privateKey: pair.privateKey, spki: encodeBase64Url(spki), createKey: reservedCreateIdempotencyKey(await keyThumbprint(spki)) };
}

async function readOutcome(response: Response): Promise<Outcome> {
  const body = (await response.json().catch(() => null)) as
    | { data?: { content_hash?: string; blueprint?: { content_hash?: string } }; error?: { code?: string } }
    | null;
  return {
    status: response.status,
    code: body?.error?.code ?? null,
    hash: body?.data?.content_hash ?? body?.data?.blueprint?.content_hash ?? null,
    body
  };
}

async function sqlStateAs(url: string, statements: readonly string[]): Promise<string | null> {
  const client = new Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    for (const statement of statements) await client.query(statement);
    await client.query("ROLLBACK");
    return null;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    return String((error as { code?: unknown }).code);
  } finally {
    await client.end();
  }
}

function modelStubServer(isDown: () => boolean): http.Server {
  return http.createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const name = (JSON.parse(Buffer.concat(chunks).toString("utf8")) as { response_format?: { json_schema?: { name?: string } } })
        .response_format?.json_schema?.name;
      const output = name === "intent_analysis" ? readyAnalysis() : name === "blueprint_compose" ? blueprintCandidate() : null;
      if (isDown() || output === null) {
        response.writeHead(503, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ error: { message: "provider unavailable" } }));
        return;
      }
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        model: "local-deterministic-fixture",
        choices: [{ message: { role: "assistant", content: JSON.stringify(output) } }],
        usage: { prompt_tokens: 1, completion_tokens: 1 }
      }));
    });
  });
}

/** Loopback-only scratch database with every migration applied, plus the dedicated test logins. */
async function provisionScratch(url: string, scratchDb: string, logins: readonly Login[]): Promise<{ admin: Client; setup: Client; scratchHref: string }> {
  if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname)) throw new Error("APPF2_TEST_ADMIN_DATABASE_URL must be loopback");
  const admin = new Client({ connectionString: url });
  await admin.connect();
  const existing = await admin.query("SELECT rolname FROM pg_roles WHERE rolname = ANY($1)", [PG001_ROLES]);
  if (existing.rowCount !== 0) throw new Error("PG-001 roles already exist in this cluster; use a cluster without them");
  await admin.query(`CREATE DATABASE ${scratchDb}`);
  const scratch = new URL(url);
  scratch.pathname = `/${scratchDb}`;
  const setup = new Client({ connectionString: scratch.href });
  await setup.connect();
  for (const statement of SUPABASE_DEFAULT_PRIVILEGES) await setup.query(statement);
  for (const file of readdirSync(MIGRATIONS).filter((name) => name.endsWith(".sql")).sort()) {
    await setup.query(readFileSync(new URL(file, MIGRATIONS), "utf8"));
  }
  for (const login of logins) {
    const password = randomBytes(24).toString("hex");
    await setup.query(
      `CREATE ROLE ${login.role} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD '${password}'`
    );
    await setup.query(`GRANT ${login.grant} TO ${login.role}`);
    const loginUrl = new URL(scratch.href);
    loginUrl.username = login.role;
    loginUrl.password = password;
    login.url = loginUrl.href;
  }
  return { admin, setup, scratchHref: scratch.href };
}

/** Registers beforeAll / afterAll for the calling test file; scratch DB and logins are dropped afterwards. */
export function realPgHarness(label: string): RealPgHarness {
  const suffix = randomBytes(4).toString("hex");
  const scratchDb = `appf2_${label}_it_${suffix}`;
  const logins = {
    worker: { role: `appf2_worker_login_${label}_${suffix}`, grant: "appf2_worker", url: "" },
    admission: { role: `appf2_f02_login_${label}_${suffix}`, grant: "appf2_f02_admission", url: "" },
    trust: { role: `appf2_trust_login_${label}_${suffix}`, grant: "appf2_f02_trust", url: "" },
    events: { role: `appf2_f07_login_${label}_${suffix}`, grant: "appf2_f07_event", url: "" }
  };
  const send = createWorkerFetch();
  let admin: Client | null = null;
  let setup: Client | null = null;
  let modelStub: http.Server | null = null;
  let providerDown = false;
  let env: Appf2WorkerEnv | null = null;
  let scratchHref = "";

  beforeAll(async () => {
    if (adminUrl === undefined) return;
    ({ admin, setup, scratchHref } = await provisionScratch(adminUrl, scratchDb, Object.values(logins)));
    const stub = modelStubServer(() => providerDown);
    modelStub = stub;
    await new Promise<void>((resolve) => stub.listen(0, "127.0.0.1", resolve));
    env = {
      HYPERDRIVE_FRESH: { connectionString: logins.worker.url },
      HYPERDRIVE_F02_ADMISSION: { connectionString: logins.admission.url },
      HYPERDRIVE_F07_EVENTS: { connectionString: logins.events.url },
      APPF2_MODEL_BASE_URL: `http://127.0.0.1:${(stub.address() as AddressInfo).port}/v1`,
      APPF2_MODEL_API_KEY: "local-deterministic-fixture",
      APPF2_MODEL_NAME: "local-deterministic-fixture",
      APPF2_IDENTITY_COOKIE_SECRET: randomBytes(32).toString("hex")
    };
  }, 90_000);

  afterAll(async () => {
    await new Promise<void>((resolve) => (modelStub === null ? resolve() : modelStub.close(() => resolve())));
    await setup?.end().catch(() => undefined);
    if (adminUrl === undefined) return;
    const cleanup = admin ?? new Client({ connectionString: adminUrl });
    if (admin === null) await cleanup.connect();
    try {
      const created = (await cleanup.query("SELECT 1 FROM pg_database WHERE datname = $1", [scratchDb])).rowCount === 1;
      if (!created) return;
      await cleanup.query(`DROP DATABASE ${scratchDb} WITH (FORCE)`);
      for (const role of [...Object.values(logins).map((login) => login.role), ...PG001_ROLES]) await cleanup.query(`DROP ROLE IF EXISTS ${role}`);
    } finally {
      await cleanup.end();
    }
  }, 60_000);

  const currentEnv = (): Appf2WorkerEnv => {
    if (env === null) throw new Error("real PostgreSQL harness is not initialised");
    return env;
  };

  async function signedPost(key: PopKey, path: string, body: unknown, idempotencyKey: string, options: PostOptions): Promise<Response> {
    const { cookie, override, headerPatch = {}, sentBody } = options;
    const text = JSON.stringify(body);
    const timestamp = Date.now();
    const transcript = await mutationProofTranscript({ method: "POST", path, body: new TextEncoder().encode(text), idempotencyKey }, timestamp);
    const signature = new Uint8Array(await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key.privateKey, transcript));
    const headers = new Headers({
      "Content-Type": "application/json",
      Origin: ORIGIN,
      "Sec-Fetch-Site": "same-origin",
      "Idempotency-Key": idempotencyKey,
      ...(cookie === null ? {} : { Cookie: cookie }),
      [POP_KEY_HEADER]: key.spki,
      [POP_SIGNATURE_HEADER]: encodeBase64Url(signature),
      [POP_TIMESTAMP_HEADER]: String(timestamp)
    });
    for (const [name, value] of Object.entries(headerPatch)) {
      if (value === null) headers.delete(name);
      else headers.set(name, value);
    }
    return send(new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: sentBody ?? text }), { ...currentEnv(), ...override });
  }

  async function createIntent(rawIntent = "Split a dinner bill between friends"): Promise<Session> {
    const key = await newPopKey();
    const anonymousId = randomUUID();
    const response = await signedPost(key, CREATE_PATH, { anonymous_id: anonymousId, intent_kind: "CREATE", raw_intent: rawIntent }, key.createKey, { cookie: null });
    const body = (await response.json()) as { data: { intent_id: string; intent_version: number; status: string } };
    expect(response.status).toBe(200);
    expect(body.data.status).toBe("READY");
    const cookie = response.headers.get("set-cookie")?.split(";", 1)[0];
    expect(cookie).toBeDefined();
    return { key, anonymousId, intentId: body.data.intent_id, intentVersion: body.data.intent_version, cookie: cookie as string };
  }

  const compile = async (session: Session, idempotencyKey: string, override?: Partial<Appf2WorkerEnv>, key: PopKey = session.key, cookie: string | null = session.cookie) =>
    readOutcome(await signedPost(key, `${CREATE_PATH}/${session.intentId}/compile`, { intent_version: session.intentVersion }, idempotencyKey, { cookie, override }));

  async function sql<Row>(statement: string, parameters: readonly unknown[] = []): Promise<Row[]> {
    if (setup === null) throw new Error("real PostgreSQL harness is not initialised");
    return (await setup.query(statement, [...parameters])).rows as Row[];
  }

  const passedRunsFor = async (intentId: string): Promise<number> =>
    (await sql<{ n: number }>(
      `SELECT count(*)::int AS n FROM public.validation_run v JOIN public.compiler_run c ON c.compiler_run_id = v.compiler_run_id
       WHERE c.intent_id = $1 AND v.status = 'PASSED'`,
      [intentId]
    ))[0]?.n ?? -1;

  const contents = async (): Promise<{ content_hash: string; trust_status: string; admitted_by_validation_run_id: string }[]> =>
    sql("SELECT content_hash, trust_status, admitted_by_validation_run_id FROM public.blueprint_content ORDER BY content_hash");

  return {
    logins,
    env: currentEnv,
    setProviderDown: (down) => {
      providerDown = down;
    },
    popKey: newPopKey,
    signedPost,
    readOutcome,
    createIntent,
    compile,
    sql,
    passedRunsFor,
    contents,
    sqlStateAs,
    scratchUrl: () => scratchHref
  };
}
