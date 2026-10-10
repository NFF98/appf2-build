import { EVENTS_BATCH_ROUTE } from "./events-batch.js";
import { INTENTS_ROUTE, type IntentApiHttpResponse } from "./intent-api.js";
import { readTrustedAnonymousId, trustedAnonymousCookie } from "./server-identity.js";
import {
  createWorkerRequestComposition,
  type Appf2WorkerEnv,
  type WorkerRequestComposition
} from "./worker-composition.js";

const API_PREFIX = "/api/v1/";
const HEALTH_ROUTE = "/api/v1/health";

type CompositionFactory = (env: Appf2WorkerEnv) => WorkerRequestComposition;

function json(body: Readonly<Record<string, unknown>>, status: number, headers: Readonly<Record<string, string>> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers }
  });
}

function requestHeaders(request: Request): Readonly<Record<string, string>> {
  return Object.fromEntries(request.headers.entries());
}

function createAnonymousId(body: Uint8Array): string | null {
  try {
    const parsed: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed) || !("anonymous_id" in parsed)) return null;
    return typeof parsed.anonymous_id === "string" ? parsed.anonymous_id : null;
  } catch {
    return null;
  }
}

async function intentResponse(
  request: Request,
  body: Uint8Array,
  trustedAnonymousId: string | null,
  env: Appf2WorkerEnv,
  handler: WorkerRequestComposition["intent"]
): Promise<Response> {
  const url = new URL(request.url);
  const result: IntentApiHttpResponse | undefined = await handler({
    method: request.method,
    path: url.pathname,
    headers: requestHeaders(request),
    body,
    trustedAnonymousId
  });
  if (result === undefined) return json({ error: { code: "API-NOT-FOUND" } }, 404);
  const headers = new Headers({ "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...result.headers });
  if (url.pathname === INTENTS_ROUTE && request.method === "POST" && result.status >= 200 && result.status < 300) {
    const anonymousId = createAnonymousId(body);
    if (trustedAnonymousId === null && anonymousId !== null) {
      headers.append("Set-Cookie", await trustedAnonymousCookie(anonymousId, env.APPF2_IDENTITY_COOKIE_SECRET));
    }
  }
  return new Response(JSON.stringify(result.body), { status: result.status, headers });
}

export function createWorkerFetch(compositionFactory: CompositionFactory = createWorkerRequestComposition) {
  return async (request: Request, env: Appf2WorkerEnv): Promise<Response> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith(API_PREFIX)) return json({ error: { code: "API-NOT-FOUND" } }, 404);
    if (url.pathname === HEALTH_ROUTE) return json({ data: { status: "UP" } }, 200);

    let composition: WorkerRequestComposition | null = null;
    try {
      composition = compositionFactory(env);
      const body = new Uint8Array(await request.arrayBuffer());
      if (url.pathname === EVENTS_BATCH_ROUTE) {
        if (request.method !== "POST") return json({ error: { code: "API-METHOD-NOT-ALLOWED" } }, 405);
        const mediaType=(request.headers.get("content-type")||"").split(";",1)[0].trim().toLowerCase();
        if (mediaType !== "application/json") return json({ error: { code: "API-UNSUPPORTED-MEDIA-TYPE" } }, 415);
        const response = await composition.events({ body, requestId: request.headers.get("X-Request-Id") ?? undefined });
        return json(response.body, response.status, response.headers);
      }
      const trustedAnonymousId = await readTrustedAnonymousId(request, env.APPF2_IDENTITY_COOKIE_SECRET);
      return await intentResponse(request, body, trustedAnonymousId, env, composition.intent);
    } catch {
      return json({ error: { code: "API-SERVICE-UNAVAILABLE" } }, 503);
    } finally {
      await composition?.executor.close().catch(() => undefined);
    }
  };
}

const fetch = createWorkerFetch();

export default { fetch };
