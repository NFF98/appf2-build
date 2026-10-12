import type { ExecutionAdmissionDenial, ExecutionAdmissionService } from "../platform/blueprint/execution-admission.js";
import type { CanonicalBlueprintBodyRead, OriginalIntentLineage } from "../platform/blueprint/original-intent-lineage.js";
import type { WorkerRequestDbContext } from "../platform/blueprint/worker-postgres-executor.js";
import { isUuid } from "../platform/evidence/evidence-validator.js";
import {
  BLUEPRINT_GRANT_AUDIENCE,
  CONTENT_HASH_PATTERN,
  issueBlueprintAccessGrant,
  readBlueprintAccessGrant,
  type BlueprintAccessGrantClaims
} from "./blueprint-access-grant.js";
import { verifyReadProof } from "./create-proof.js";
import { readIntentContinuity } from "./server-identity.js";
import type { Appf2WorkerEnv, ClosableExecutor } from "./worker-composition.js";

const GRANT_ROUTE = /^\/api\/v1\/intents\/([^/]+)\/blueprint-access-grant$/u;
const BODY_ROUTE = /^\/b\/([^/]+)$/u;
const ADMISSION_ROUTE = /^\/api\/v1\/blueprints\/([^/]+)\/execution-admission$/u;

/** Per-request original-Intent read services, all bound to the RLS context the route verified. */
export interface BlueprintDeliveryComposition {
  readonly executor: ClosableExecutor;
  readonly lineage: {
    verifyLineage(contentHash: string): Promise<OriginalIntentLineage>;
    readCanonicalBody(contentHash: string): Promise<CanonicalBlueprintBodyRead>;
  };
  readonly admission: ExecutionAdmissionService;
}

export type BlueprintDeliveryFactory = (env: Appf2WorkerEnv, context: WorkerRequestDbContext) => BlueprintDeliveryComposition;

interface ApiError {
  readonly status: number;
  readonly code: string;
  readonly messageKey: string;
  readonly retryable: boolean;
}

const NOT_FOUND: ApiError = { status: 404, code: "API-RESOURCE-NOT-FOUND", messageKey: "recovery.api.resource_not_found", retryable: false };
const UNAVAILABLE: ApiError = {
  status: 503,
  code: "API-ADMISSION-TEMPORARILY-UNAVAILABLE",
  messageKey: "recovery.api.admission_temporarily_unavailable",
  retryable: true
};
const REVOKED: ApiError = { status: 410, code: "F02-ERR-016", messageKey: "recovery.f02.blueprint_revoked", retryable: false };
const INCOMPATIBLE: ApiError = { status: 422, code: "F02-ERR-017", messageKey: "recovery.f02.blueprint_incompatible", retryable: false };
const INTEGRITY: ApiError = { status: 500, code: "F02-ERR-015", messageKey: "recovery.f02.hash_integrity_failure", retryable: false };

/** EXECUTION-ADMISSION §9 HTTP mapping; E01 is the same uniform 404 as every authorization denial. */
const DENIAL_ERRORS: Readonly<Record<ExecutionAdmissionDenial["step"], ApiError>> = {
  E01: NOT_FOUND,
  E02: REVOKED,
  E03: INCOMPATIBLE,
  "E04-A": INCOMPATIBLE,
  "E04-B": INTEGRITY,
  E05: INCOMPATIBLE,
  E06: INCOMPATIBLE,
  E07: INCOMPATIBLE,
  E08: UNAVAILABLE
};

const PRIVATE_NO_STORE = "private, no-store";
const ADMISSION_CACHE = "private, max-age=0, must-revalidate";
const AUTHORIZATION_VARY = "Authorization, X-Appf2-Share-Id";

function envelope(body: Readonly<Record<string, unknown>>, status: number, headers: Readonly<Record<string, string>>): Response {
  return new Response(JSON.stringify({ request_id: crypto.randomUUID(), ...body }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers }
  });
}

function errorResponse(error: ApiError, cacheControl: string): Response {
  return envelope(
    { error: { code: error.code, message_key: error.messageKey, retryable: error.retryable, retry_after_seconds: null, details: {} } },
    error.status,
    { "Cache-Control": cacheControl, Vary: AUTHORIZATION_VARY }
  );
}

/** First-party read: fetch metadata must be same-origin when sent, Origin must match when sent, and one must exist. */
function isFirstPartyRead(request: Request, url: URL): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  const origin = request.headers.get("Origin");
  if (site !== null && site !== "same-origin") return false;
  if (origin !== null && origin !== url.origin) return false;
  return site !== null || origin !== null;
}

/** Exactly one `content_hash` query field and nothing else (F01-API-ID-001B). */
function exactContentHashQuery(url: URL): string | null {
  const keys = [...url.searchParams.keys()];
  const contentHash = url.searchParams.get("content_hash");
  return keys.length === 1 && keys[0] === "content_hash" && contentHash !== null && CONTENT_HASH_PATTERN.test(contentHash) ? contentHash : null;
}

interface DeliveryRequest {
  readonly request: Request;
  readonly url: URL;
  readonly env: Appf2WorkerEnv;
  readonly nowMs: number;
  readonly factory: BlueprintDeliveryFactory;
}

async function withComposition<T>(delivery: DeliveryRequest, context: WorkerRequestDbContext, run: (c: BlueprintDeliveryComposition) => Promise<T>): Promise<T> {
  const composition = delivery.factory(delivery.env, context);
  try {
    return await run(composition);
  } finally {
    await composition.executor.close().catch(() => undefined);
  }
}

/** F01-API-ID-001B: scoped cookie + same-key fresh read proof + exact durable F01→F02 lineage, then a ≤60 s grant. */
async function issueGrant(delivery: DeliveryRequest, rawIntentId: string): Promise<Response> {
  const { request, url, env, nowMs } = delivery;
  const contentHash = exactContentHashQuery(url);
  if (request.method !== "GET" || !isFirstPartyRead(request, url) || !isUuid(rawIntentId) || contentHash === null) {
    return errorResponse(NOT_FOUND, PRIVATE_NO_STORE);
  }
  const claims = await readIntentContinuity(request.headers.get("Cookie"), rawIntentId, env.APPF2_IDENTITY_COOKIE_SECRET, nowMs);
  if (claims === null) return errorResponse(NOT_FOUND, PRIVATE_NO_STORE);
  const proof = await verifyReadProof({ path: url.pathname, contentHash, headers: request.headers }, nowMs);
  if (proof === null || proof.keyThumbprint !== claims.keyThumbprint) return errorResponse(NOT_FOUND, PRIVATE_NO_STORE);
  const lineage = await withComposition(delivery, { anonymousId: claims.anonymousId, intentId: rawIntentId }, (c) =>
    c.lineage.verifyLineage(contentHash)
  );
  if (!lineage.verified) return errorResponse(NOT_FOUND, PRIVATE_NO_STORE);
  const grant = await issueBlueprintAccessGrant(
    { intentId: rawIntentId, anonymousId: claims.anonymousId, contentHash, keyThumbprint: claims.keyThumbprint },
    env.APPF2_IDENTITY_COOKIE_SECRET,
    nowMs
  );
  return envelope(
    {
      data: {
        intent_blueprint_access_grant: grant.token,
        intent_id: grant.claims.intentId,
        content_hash: grant.claims.contentHash,
        key_thumbprint: grant.claims.keyThumbprint,
        audience: BLUEPRINT_GRANT_AUDIENCE,
        issued_at: new Date(grant.claims.issuedAt * 1000).toISOString(),
        expires_at: new Date(grant.claims.expiresAt * 1000).toISOString()
      }
    },
    200,
    { "Cache-Control": PRIVATE_NO_STORE }
  );
}

async function authorizedGrant(delivery: DeliveryRequest, contentHash: string): Promise<BlueprintAccessGrantClaims | null> {
  const { request, url, env, nowMs } = delivery;
  if (request.method !== "GET" || !isFirstPartyRead(request, url) || !CONTENT_HASH_PATTERN.test(contentHash) || url.search !== "") return null;
  return readBlueprintAccessGrant(request.headers.get("Authorization"), contentHash, env.APPF2_IDENTITY_COOKIE_SECRET, nowMs);
}

/** §8.1 item 5: the grant and lineage are revalidated on every read before any byte of the body is exposed. */
async function deliverBody(delivery: DeliveryRequest, contentHash: string): Promise<Response> {
  const grant = await authorizedGrant(delivery, contentHash);
  if (grant === null) return errorResponse(NOT_FOUND, PRIVATE_NO_STORE);
  const read = await withComposition(delivery, { anonymousId: grant.anonymousId, intentId: grant.intentId }, (c) =>
    c.lineage.readCanonicalBody(contentHash)
  );
  if (read.kind !== "FOUND") return errorResponse(NOT_FOUND, PRIVATE_NO_STORE);
  return new Response(new Uint8Array(read.bytes), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": PRIVATE_NO_STORE,
      Vary: AUTHORIZATION_VARY,
      "Referrer-Policy": "no-referrer"
    }
  });
}

/** A body-integrity failure still proves original-holder lineage; admission itself then reports E04-B. */
function lineageAuthorizes(lineage: OriginalIntentLineage): boolean {
  return lineage.verified || lineage.failure === "BODY_INTEGRITY_FAILURE";
}

/** Fresh EXECUTION-ADMISSION decision, only after grant + lineage authorization; never cached as an allow. */
async function admitExecution(delivery: DeliveryRequest, contentHash: string): Promise<Response> {
  const grant = await authorizedGrant(delivery, contentHash);
  if (grant === null) return errorResponse(NOT_FOUND, PRIVATE_NO_STORE);
  const decision = await withComposition(delivery, { anonymousId: grant.anonymousId, intentId: grant.intentId }, async (c) =>
    lineageAuthorizes(await c.lineage.verifyLineage(contentHash)) ? c.admission.admit(contentHash) : null
  );
  if (decision === null) return errorResponse(NOT_FOUND, PRIVATE_NO_STORE);
  if (!decision.executable) return errorResponse(DENIAL_ERRORS[decision.step], ADMISSION_CACHE);
  return envelope({ data: decision.admission }, 200, { "Cache-Control": ADMISSION_CACHE, Vary: AUTHORIZATION_VARY });
}

/** Routes the original-Intent read surface; returns undefined for any other path. Store outages map to 503. */
export async function routeBlueprintDelivery(delivery: DeliveryRequest): Promise<Response | undefined> {
  const { pathname } = delivery.url;
  const grant = GRANT_ROUTE.exec(pathname);
  const body = grant === null ? BODY_ROUTE.exec(pathname) : null;
  const admission = grant === null && body === null ? ADMISSION_ROUTE.exec(pathname) : null;
  if (grant === null && body === null && admission === null) return undefined;
  try {
    if (grant !== null) return await issueGrant(delivery, grant[1] ?? "");
    if (body !== null) return await deliverBody(delivery, body[1] ?? "");
    return await admitExecution(delivery, admission?.[1] ?? "");
  } catch {
    return errorResponse(UNAVAILABLE, PRIVATE_NO_STORE);
  }
}
