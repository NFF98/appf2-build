import { isUuid } from "../platform/evidence/evidence-validator.js";
import { INTENT_API_ERRORS, IntentApiError } from "../platform/compiler/f01-errors.js";
import { isValidIdempotencyKey } from "../platform/compiler/idempotency.js";
import { NO_REQUEST_DB_CONTEXT, type WorkerRequestDbContext } from "../platform/blueprint/worker-postgres-executor.js";
import { routeBlueprintDelivery, type BlueprintDeliveryFactory, type BlueprintDeliveryComposition } from "./blueprint-delivery.js";
import { routePublishedApps } from "./published-apps.js";
import {routeCodeBuilder} from "./code-builder-v2.js";
import {routeAgentReadiness} from "./agent-readiness.js";
import {routeAgentJobs,type AgentJobRouteDeps} from "./agent-jobs.js";
import { claimsMutationProof, reservedCreateIdempotencyKey, verifyMutationProof } from "./create-proof.js";
import { EVENTS_BATCH_ROUTE } from "./events-batch.js";
import { INTENTS_ROUTE, type IntentApiHttpResponse } from "./intent-api.js";
import { assertContinuitySecret, intentContinuityCookie, readIntentContinuity } from "./server-identity.js";
import {
  createBlueprintDeliveryComposition,
  createPublicShareDeliveryComposition,
  createWorkerRequestComposition,
  type Appf2WorkerEnv,
  type WorkerRequestComposition
} from "./worker-composition.js";

const API_PREFIX = "/api/v1/";
const HEALTH_ROUTE = "/api/v1/health";
const SCOPED_INTENT_ROUTE = /^\/api\/v1\/intents\/([^/]+)\/(?:answers|compile)$/u;

export interface WorkerCompositionFactories {
  readonly publicShare: (env:Appf2WorkerEnv,shareId:string)=>BlueprintDeliveryComposition;
  readonly intent: (env: Appf2WorkerEnv, context: WorkerRequestDbContext) => WorkerRequestComposition;
  readonly delivery: BlueprintDeliveryFactory;
}

export interface WorkerFetchOptions {
  readonly now?: () => number;
  /** Candidate-only DB injection for isolated API E2E; never permits bypassing PoP. */
  readonly agent?: AgentJobRouteDeps;
}

const PRODUCTION_FACTORIES: WorkerCompositionFactories = {
  intent: createWorkerRequestComposition,
  delivery: createBlueprintDeliveryComposition,
  publicShare: createPublicShareDeliveryComposition
};

type IntentMutationContext =
  | { readonly kind: "untrusted" }
  | { readonly kind: "proven-create"; readonly keyThumbprint: string; readonly idempotencyKey: string }
  | { readonly kind: "scoped"; readonly trustedAnonymousId: string; readonly intentId: string };

type IntentMutationGuard = IntentMutationContext | { readonly kind: "rejected"; readonly response: Response };

function json(body: Readonly<Record<string, unknown>>, status: number, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}

/** F01 envelope for a missing/invalid trusted context, emitted before any F01 durable write. */
function untrustedContextResponse(request: Request, path: string, reason: string): Response {
  const clientRequestId = request.headers.get("X-Request-Id");
  const requestId = clientRequestId !== null && isUuid(clientRequestId) ? clientRequestId : crypto.randomUUID();
  const failure = new IntentApiError("F01-ERR-001", { details: { violations: [{ path, reason }] } }).failure;
  return json(
    {
      request_id: requestId,
      error: {
        code: failure.code,
        message_key: INTENT_API_ERRORS[failure.code].message_key,
        retryable: failure.retryable,
        retry_after_seconds: failure.retry_after_seconds,
        details: failure.details
      }
    },
    failure.http_status,
    { "X-Request-Id": requestId }
  );
}

/** Same-origin first-party write: Fetch Metadata must not be cross-site and Origin must match. */
function isSameOriginWrite(request: Request, url: URL): boolean {
  const site = request.headers.get("Sec-Fetch-Site");
  if (site !== null && site !== "same-origin") return false;
  return request.headers.get("Origin") === url.origin;
}

interface IntentMutation {
  readonly request: Request;
  readonly url: URL;
  readonly body: Uint8Array<ArrayBuffer>;
  readonly secret: string;
  readonly nowMs: number;
}

function proofOf(mutation: IntentMutation, idempotencyKey: string) {
  const { request, url, body, nowMs } = mutation;
  return verifyMutationProof({ method: request.method, path: url.pathname, body, idempotencyKey, headers: request.headers }, nowMs);
}

/** F01-API-ID-001A item 8: CREATE is accepted only with a valid PoP over the reserved per-key Idempotency-Key. */
async function guardCreate(mutation: IntentMutation): Promise<IntentMutationGuard> {
  const { request, url } = mutation;
  if (!isSameOriginWrite(request, url)) {
    return { kind: "rejected", response: untrustedContextResponse(request, "$context.origin", "CROSS_SITE_WRITE") };
  }
  const reject = (): IntentMutationGuard => ({ kind: "rejected", response: untrustedContextResponse(request, "$context.proof", "PROOF_INVALID") });
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (!claimsMutationProof(request.headers, idempotencyKey) || !isValidIdempotencyKey(idempotencyKey)) return reject();
  const proof = await proofOf(mutation, idempotencyKey);
  if (proof === null || idempotencyKey !== reservedCreateIdempotencyKey(proof.keyThumbprint)) return reject();
  return { kind: "proven-create", keyThumbprint: proof.keyThumbprint, idempotencyKey };
}

/** answers / compile: exact per-intent cookie AND a fresh signature from the same PoP key, or no trusted context at all. */
async function guardScoped(mutation: IntentMutation, rawIntentId: string): Promise<IntentMutationGuard> {
  const { request, url, secret, nowMs } = mutation;
  const reject = (): IntentMutationGuard => ({
    kind: "rejected",
    response: untrustedContextResponse(request, "$context.anonymous_id", "TRUSTED_IDENTITY_REQUIRED")
  });
  const idempotencyKey = request.headers.get("Idempotency-Key");
  if (!isSameOriginWrite(request, url) || !isUuid(rawIntentId) || !isValidIdempotencyKey(idempotencyKey)) return reject();
  const claims = await readIntentContinuity(request.headers.get("Cookie"), rawIntentId, secret, nowMs);
  if (claims === null) return reject();
  const proof = await proofOf(mutation, idempotencyKey);
  if (proof === null || proof.keyThumbprint !== claims.keyThumbprint) return reject();
  return { kind: "scoped", trustedAnonymousId: claims.anonymousId, intentId: rawIntentId };
}

async function guardIntentMutation(mutation: IntentMutation): Promise<IntentMutationGuard> {
  if (mutation.request.method !== "POST") return { kind: "untrusted" };
  assertContinuitySecret(mutation.secret);
  if (mutation.url.pathname === INTENTS_ROUTE) return guardCreate(mutation);
  const scoped = SCOPED_INTENT_ROUTE.exec(mutation.url.pathname);
  return scoped === null ? { kind: "untrusted" } : guardScoped(mutation, scoped[1] ?? "");
}

function bodyAnonymousId(bytes: Uint8Array): string | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    const anonymousId = (parsed as Record<string, unknown>).anonymous_id;
    return isUuid(anonymousId) ? anonymousId : null;
  } catch {
    return null;
  }
}

/** RLS context: only values the guard verified (PoP-signed CREATE body, or scoped cookie + same-key PoP). */
function requestDbContext(context: IntentMutationContext, body: Uint8Array): WorkerRequestDbContext {
  if (context.kind === "scoped") return { anonymousId: context.trustedAnonymousId, intentId: context.intentId };
  if (context.kind === "proven-create") return { anonymousId: bodyAnonymousId(body), intentId: null };
  return NO_REQUEST_DB_CONTEXT;
}

function createdIntentId(result: IntentApiHttpResponse): string | null {
  const data = result.body.data;
  if (typeof data !== "object" || data === null || Array.isArray(data)) return null;
  const intentId = (data as Record<string, unknown>).intent_id;
  return isUuid(intentId) ? intentId : null;
}

async function intentResponse(
  mutation: IntentMutation,
  context: IntentMutationContext,
  dbContext: WorkerRequestDbContext,
  composition: WorkerRequestComposition
): Promise<Response> {
  const { request, url, body, secret, nowMs } = mutation;
  const keyProofRejected = (): Response => untrustedContextResponse(request, "$context.proof", "PROOF_INVALID");
  if (
    context.kind === "proven-create" &&
    dbContext.anonymousId !== null &&
    !(await composition.createKeys.available(context.idempotencyKey, dbContext.anonymousId))
  ) {
    return keyProofRejected();
  }
  const result = await composition.intent({
    method: request.method,
    path: url.pathname,
    headers: Object.fromEntries(request.headers.entries()),
    body,
    trustedAnonymousId: context.kind === "scoped" ? context.trustedAnonymousId : null
  });
  if (result === undefined) return json({ error: { code: "API-NOT-FOUND" } }, 404);
  // Lost a concurrent race for this proven CREATE key to another anonymous_id: same outcome as the pre-write check.
  if (context.kind === "proven-create" && composition.createKeys.heldElsewhere() && result.status !== 200) {
    return keyProofRejected();
  }
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...result.headers });
  if (context.kind === "proven-create" && result.status === 200) {
    const intentId = createdIntentId(result);
    if (intentId !== null && dbContext.anonymousId !== null) {
      headers.append(
        "Set-Cookie",
        await intentContinuityCookie({ intentId, anonymousId: dbContext.anonymousId, keyThumbprint: context.keyThumbprint }, secret, nowMs)
      );
    }
  }
  return new Response(JSON.stringify(result.body), { status: result.status, headers });
}

export function createWorkerFetch(factories: Partial<WorkerCompositionFactories> = {}, options: WorkerFetchOptions = {}) {
  const { intent: intentFactory, delivery: deliveryFactory, publicShare: publicShareFactory } = { ...PRODUCTION_FACTORIES, ...factories };
  const now = options.now ?? Date.now;
  return async (request: Request, env: Appf2WorkerEnv): Promise<Response> => {
    const url = new URL(request.url);
    const nowMs=now();
    const delivered = await routeBlueprintDelivery({
      request, url, env, nowMs, factory: deliveryFactory,publicShareFactory
    });
    if (delivered !== undefined) return delivered;
    const published=await routePublishedApps({request,url,env,nowMs,delivery:deliveryFactory});
    if(published!==undefined)return published;
    const readiness=routeAgentReadiness(request,url,env);
    if(readiness!==undefined)return readiness;
    const agentJob=await routeAgentJobs({request,url,env,nowMs,deps:options.agent});
    if(agentJob!==undefined)return agentJob;
    const codeApp=await routeCodeBuilder({request,url,env});
    if(codeApp!==undefined)return codeApp;
    if (!url.pathname.startsWith(API_PREFIX)) return json({ error: { code: "API-NOT-FOUND" } }, 404);
    if (url.pathname === HEALTH_ROUTE) return json({ data: { status: "UP" } }, 200);

    let composition: WorkerRequestComposition | null = null;
    try {
      const body = new Uint8Array(await request.arrayBuffer());
      if (url.pathname === EVENTS_BATCH_ROUTE) {
        if (request.method !== "POST") return json({ error: { code: "API-METHOD-NOT-ALLOWED" } }, 405);
        const mediaType = (request.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
        if (mediaType !== "application/json") return json({ error: { code: "API-UNSUPPORTED-MEDIA-TYPE" } }, 415);
        composition = intentFactory(env, NO_REQUEST_DB_CONTEXT);
        const response = await composition.events({ body, requestId: request.headers.get("X-Request-Id") ?? undefined });
        return json(response.body, response.status, response.headers);
      }
      const mutation: IntentMutation = { request, url, body, secret: env.APPF2_IDENTITY_COOKIE_SECRET, nowMs: now() };
      const guard = await guardIntentMutation(mutation);
      if (guard.kind === "rejected") return guard.response;
      const dbContext = requestDbContext(guard, body);
      composition = intentFactory(env, dbContext);
      return await intentResponse(mutation, guard, dbContext, composition);
    } catch {
      return json({ error: { code: "API-SERVICE-UNAVAILABLE" } }, 503);
    } finally {
      await composition?.executor.close().catch(() => undefined);
    }
  };
}

const fetch = createWorkerFetch();

export default { fetch };
