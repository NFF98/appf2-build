import type { Page, Request, Route } from "@playwright/test";

import { reservedCreateIdempotencyKey, verifyMutationProof, verifyReadProof } from "../../../src/edge/create-proof.js";
import { IntentApiError } from "../../../src/platform/compiler/f01-errors.js";
import type { StructuredIntentEnvelope } from "../../../src/platform/intent/intent-contract.js";
import type { JsonValue } from "../../../src/platform/intent/json-value.js";
import { ANON, blueprintCandidate, createF01Harness, succeeded, type F01Harness } from "../../api/f01-harness.js";

/** F07 browser identity key; seeded with the harness identity so body and trusted context agree. */
export const ANONYMOUS_ID_STORAGE_KEY = "appf2.anonymous_id.v1";

export type ResponseBody = Record<string, unknown>;

export type RecordedCall = {
  readonly path: string;
  readonly idempotencyKey: string;
  readonly body: Record<string, unknown>;
  /** Thumbprint of the P-256 key whose PoP the host verified for this exact request; null when it did not verify. */
  readonly proofThumbprint: string | null;
  /** null when the host dropped the request at the network layer before it reached F01. */
  readonly status: number | null;
  /** Exactly what the Browser received (after any scripted tampering). */
  readonly response: ResponseBody | null;
};

/** A read-only original-holder Blueprint access-grant request (F01-API-ID-001B) the Browser made after F02 validation. */
export type DeliveryRead = {
  readonly method: string;
  readonly intentId: string;
  readonly contentHash: string | null;
  /** Thumbprint of the verified read-proof key; null when the proof did not verify. */
  readonly proofThumbprint: string | null;
  readonly status: number;
};

const SCOPED_MUTATION = /^\/api\/v1\/intents\/([^/]+)\/(?:answers|compile)$/u;
const ACCESS_GRANT = /^\/api\/v1\/intents\/([^/]+)\/blueprint-access-grant$/u;

function proofRejected(): { status: number; body: ResponseBody } {
  const { failure } = new IntentApiError("F01-ERR-001", { details: { violations: [{ path: "$context.proof", reason: "PROOF_INVALID" }] } });
  return { status: failure.http_status, body: { error: { code: failure.code, retryable: failure.retryable, details: failure.details } } };
}

type Interference = {
  readonly match: (path: string) => boolean;
  /** Runs before F01; resolving true means the request never reaches F01. */
  readonly before?: (route: Route) => Promise<boolean>;
  /** Rewrites the real F01 response body before the Browser sees it. */
  readonly rewrite?: (body: ResponseBody) => ResponseBody;
};

/**
 * Hosts the production F01 `createIntentApiHandler` (real IntentCompilerService over the F01 fakes and a
 * scripted model gateway) behind the page's same-origin `/api/v1/intents*` calls, and plays the Edge identity
 * role: every mutation must carry a P-256 PoP that the production verifier accepts over the exact bytes sent;
 * CREATE must use the reserved `appf2-create-v1.<thumbprint>` key of that same key, and answers / compile must be
 * signed by the key that created the intent. A rejected proof never reaches F01.
 *
 * Blueprint delivery is not hosted here: the read-only access-grant request is proof-checked, recorded in
 * {@link deliveryReads} and answered 404, so no grant, body or admission is ever issued by this host.
 */
export class F01BrowserHost {
  public readonly harness: F01Harness = createF01Harness();
  public readonly calls: RecordedCall[] = [];
  public readonly deliveryReads: DeliveryRead[] = [];
  /** Every request the page made (`METHOD absolute-url`), including static assets and any other origin. */
  public readonly requests: string[] = [];
  private readonly interferences: Interference[] = [];
  private readonly intentKeys = new Map<string, string>();

  public static async attach(page: Page): Promise<F01BrowserHost> {
    const host = new F01BrowserHost();
    page.on("request", (request: Request) => host.requests.push(`${request.method()} ${request.url()}`));
    await page.addInitScript(([key, id]) => window.localStorage.setItem(key, id), [ANONYMOUS_ID_STORAGE_KEY, ANON] as const);
    await page.route("**/api/v1/intents**", (route) => host.serve(route));
    return host;
  }

  /** Path + method of every same-origin `/api/` and `/b/` request the page made, in order. */
  public apiRequests(): string[] {
    return this.requests.flatMap((entry) => {
      const [method, href] = entry.split(" ", 2) as [string, string];
      const { pathname } = new URL(href);
      return pathname.startsWith("/api/") || pathname.startsWith("/b/") ? [`${method} ${pathname}`] : [];
    });
  }

  /** Origins of every request the page made; anything but the app origin is an outbound leak. */
  public requestOrigins(): string[] {
    return [...new Set(this.requests.map((entry) => new URL(entry.split(" ", 2)[1] ?? "").origin))];
  }

  public queueAnalysis(envelope: StructuredIntentEnvelope): this {
    this.harness.gateway.queueAnalysis(succeeded(envelope as unknown as JsonValue));
    return this;
  }

  public queueValidBlueprint(): this {
    this.harness.gateway.queueCompose(succeeded(blueprintCandidate()));
    return this;
  }

  /** Drops the next matching request at the network layer (the Browser sees a failed fetch). */
  public dropNext(match: (path: string) => boolean): void {
    this.interferences.push({
      match,
      before: async (route) => {
        await route.abort("failed");
        return true;
      }
    });
  }

  /** Holds the next matching request until the returned release is called, then lets it reach F01. */
  public holdNext(match: (path: string) => boolean): () => void {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.interferences.push({
      match,
      before: async () => {
        await gate;
        return false;
      }
    });
    return () => release();
  }

  /** Lets the next matching request reach F01, then hands the Browser a rewritten (e.g. malformed) body. */
  public tamperNext(match: (path: string) => boolean, rewrite: (body: ResponseBody) => ResponseBody): void {
    this.interferences.push({ match, rewrite });
  }

  public callsTo(suffix: string): RecordedCall[] {
    return this.calls.filter((call) => call.path.endsWith(suffix));
  }

  private async serve(route: Route): Promise<void> {
    const url = new URL(route.request().url());
    const grant = ACCESS_GRANT.exec(url.pathname);
    if (grant !== null) return this.refuseDelivery(route, url, grant[1] ?? "");
    return this.serveMutation(route, url.pathname);
  }

  /** The proof key this mutation verifiably carries, or null when it must not reach F01. */
  private async verifiedMutationKey(request: Request, path: string, idempotencyKey: string): Promise<string | null> {
    const raw = request.postDataBuffer();
    const proof = await verifyMutationProof(
      { method: request.method(), path, body: new Uint8Array(raw ?? new Uint8Array()), idempotencyKey, headers: new Headers(request.headers()) },
      Date.now()
    );
    if (proof === null) return null;
    if (path === "/api/v1/intents") return idempotencyKey === reservedCreateIdempotencyKey(proof.keyThumbprint) ? proof.keyThumbprint : null;
    const scoped = SCOPED_MUTATION.exec(path);
    return scoped !== null && this.intentKeys.get(scoped[1] ?? "") === proof.keyThumbprint ? proof.keyThumbprint : null;
  }

  private async serveMutation(route: Route, path: string): Promise<void> {
    const request = route.request();
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    const idempotencyKey = request.headers()["idempotency-key"] ?? "";
    const proofThumbprint = await this.verifiedMutationKey(request, path, idempotencyKey);
    const index = this.interferences.findIndex((entry) => entry.match(path));
    const [interference] = index >= 0 ? this.interferences.splice(index, 1) : [];
    if (interference?.before !== undefined && (await interference.before(route))) {
      this.calls.push({ path, idempotencyKey, body, proofThumbprint, status: null, response: null });
      return;
    }
    if (proofThumbprint === null) {
      const rejected = proofRejected();
      this.calls.push({ path, idempotencyKey, body, proofThumbprint, status: rejected.status, response: rejected.body });
      return route.fulfill({ status: rejected.status, headers: { "content-type": "application/json" }, body: JSON.stringify(rejected.body) });
    }
    const response = await this.harness.handler({ method: request.method(), path, headers: request.headers(), body: request.postData() ?? "", trustedAnonymousId: ANON });
    if (response === undefined) return route.fulfill({ status: 404, body: "" });
    const delivered = interference?.rewrite === undefined ? (response.body as ResponseBody) : interference.rewrite(structuredClone(response.body as ResponseBody));
    this.bindCreatedIntent(path, response, proofThumbprint);
    this.calls.push({ path, idempotencyKey, body, proofThumbprint, status: response.status, response: delivered });
    await route.fulfill({ status: response.status, headers: { ...response.headers, "content-type": "application/json" }, body: JSON.stringify(delivered) });
  }

  /** A successful CREATE binds its intent to the proving key, as the Edge continuity cookie does. */
  private bindCreatedIntent(path: string, response: { readonly status: number; readonly body: unknown }, thumbprint: string): void {
    if (path !== "/api/v1/intents" || response.status !== 200) return;
    const intentId = (response.body as { data?: { intent_id?: unknown } }).data?.intent_id;
    if (typeof intentId === "string") this.intentKeys.set(intentId, thumbprint);
  }

  private async refuseDelivery(route: Route, url: URL, intentId: string): Promise<void> {
    const request = route.request();
    const contentHash = url.searchParams.get("content_hash");
    const proof =
      request.method() === "GET" && contentHash !== null
        ? await verifyReadProof({ path: url.pathname, contentHash, headers: new Headers(request.headers()) }, Date.now())
        : null;
    const proofThumbprint = proof !== null && this.intentKeys.get(intentId) === proof.keyThumbprint ? proof.keyThumbprint : null;
    const status = proofThumbprint === null ? 401 : 404;
    this.deliveryReads.push({ method: request.method(), intentId, contentHash, proofThumbprint, status });
    await route.fulfill({ status, headers: { "content-type": "application/json" }, body: JSON.stringify({ error: { code: status === 401 ? "API-UNAUTHORIZED" : "API-NOT-FOUND" } }) });
  }
}

export const isCreate = (path: string): boolean => path === "/api/v1/intents";
export const isAnswers = (path: string): boolean => path.endsWith("/answers");
export const isCompile = (path: string): boolean => path.endsWith("/compile");
