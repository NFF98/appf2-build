import { INTENTS_PATH } from "../../src/app/create/f01-client.js";
import { PopKeyring, type PopKey } from "../../src/app/create/pop-keyring.js";
import { mutationProofTranscript, readProofTranscript, reservedCreateIdempotencyKey } from "../../src/edge/create-proof.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";
import { blueprintCandidate, readyAnalysis, succeeded } from "./f01-harness.js";
import { FIRST_PARTY_ORIGIN, FirstPartyBrowser, grantPathOf } from "./s03-first-party-client.js";
import { createS03Backend, type S03Backend } from "./s03-worker-backend.js";

/** The F01 harness ManualClock start; the Edge clock and every PoP signer start at the same instant. */
const WORLD_START_MS = Date.parse("2026-10-06T00:00:00.000Z");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export const RESOURCE_NOT_FOUND_ERROR = {
  code: "API-RESOURCE-NOT-FOUND",
  message_key: "recovery.api.resource_not_found",
  retryable: false,
  retry_after_seconds: null,
  details: {}
} as const;

export interface RawResponse {
  readonly status: number;
  readonly body: string;
  readonly headers: Headers;
}

export interface Holder {
  readonly browser: FirstPartyBrowser;
  readonly intentId: string;
  readonly contentHash: string;
}

/**
 * One production Worker (real F01 / F02 / delivery code over the in-memory SQL fakes) whose Edge clock, F01 durable
 * clock and every browser P-256 signer share a single manual time, so freshness and expiry are driven deterministically.
 */
export interface OriginalHolderWorld {
  readonly backend: S03Backend;
  now(): number;
  advance(milliseconds: number): void;
  handle(request: Request): Promise<RawResponse>;
  get(path: string, headers?: Record<string, string>): Promise<RawResponse>;
  /** A fresh nonextractable P-256 key from the production browser keyring; `clock` skews only its signatures. */
  key(clock?: () => number): Promise<PopKey>;
  /** Scripts one more READY Prompt A analysis for a CREATE issued outside {@link validatedHolder}. */
  queueReadyAnalysis(): void;
  /** Natural language → F01 READY → F02 BUILD_VALIDATED by a new first-party browser on this backend. */
  validatedHolder(): Promise<Holder>;
  /** Scoped cookie + same-key fresh signed GET for the holder's own grant path. */
  grantHeaders(holder: Holder): Promise<Record<string, string>>;
  anonymousIdOf(intentId: string): string;
}

export function createOriginalHolderWorld(): OriginalHolderWorld {
  let nowMs = WORLD_START_MS;
  const now = (): number => nowMs;
  const backend = createS03Backend({ now });
  let firstRun = true;

  const handle = async (request: Request): Promise<RawResponse> => {
    const response = await backend.handle(request);
    return { status: response.status, body: await response.text(), headers: response.headers };
  };

  return {
    backend,
    now,
    advance: (milliseconds) => {
      nowMs += milliseconds;
      backend.harness.clock.advance(milliseconds);
    },
    handle,
    get: (path, headers = {}) => handle(new Request(new URL(path, FIRST_PARTY_ORIGIN), { method: "GET", headers })),
    key: (clock = now) => new PopKeyring({ subtle: crypto.subtle, now: clock }).keyForCreate(crypto.randomUUID()),
    queueReadyAnalysis: () => {
      backend.harness.gateway.queueAnalysis(succeeded(readyAnalysis() as unknown as JsonValue));
    },
    validatedHolder: async () => {
      if (!firstRun) {
        backend.harness.gateway.queueAnalysis(succeeded(readyAnalysis() as unknown as JsonValue)).queueCompose(succeeded(blueprintCandidate()));
      }
      firstRun = false;
      const browser = new FirstPartyBrowser(backend, now);
      return { browser, ...(await browser.createValidated()) };
    },
    grantHeaders: async (holder) => ({
      "Sec-Fetch-Site": "same-origin",
      Cookie: holder.browser.cookieFor(grantPathOf(holder.intentId)),
      ...(await holder.browser.readProof(holder.intentId, holder.contentHash))
    }),
    anonymousIdOf: (intentId) => {
      const intent = backend.harness.db.intents.get(intentId);
      if (intent === undefined) throw new Error("unknown intent");
      return intent.anonymous_id;
    }
  };
}

export const grantUrl = (intentId: string, contentHash: string): string => `${grantPathOf(intentId)}?content_hash=${contentHash}`;

export const createBody = (anonymousId: string, rawIntent = "幫我做一個聚餐分帳工具"): string =>
  JSON.stringify({ anonymous_id: anonymousId, intent_kind: "CREATE", raw_intent: rawIntent });

export function firstPartyPost(path: string, body: string, headers: Record<string, string>): Request {
  return new Request(new URL(path, FIRST_PARTY_ORIGIN), {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: FIRST_PARTY_ORIGIN, "Sec-Fetch-Site": "same-origin", ...headers },
    body
  });
}

/** `Idempotency-Key` plus the F01-API-ID-001A P-256 proof over the exact method, path, body bytes and key. */
export async function signedMutationHeaders(key: PopKey, path: string, body: string, idempotencyKey: string): Promise<Record<string, string>> {
  const bytes = new TextEncoder().encode(body);
  return {
    "Idempotency-Key": idempotencyKey,
    ...(await key.proofHeaders((timestampMs) => mutationProofTranscript({ method: "POST", path, body: bytes, idempotencyKey }, timestampMs)))
  };
}

export async function signedCreate(key: PopKey, body: string): Promise<Request> {
  return firstPartyPost(INTENTS_PATH, body, await signedMutationHeaders(key, INTENTS_PATH, body, reservedCreateIdempotencyKey(key.thumbprint)));
}

/** F01-API-ID-001B read proof signed by an arbitrary key (e.g. an attacker's) for a given grant path and hash. */
export function readProofBy(key: PopKey, intentId: string, contentHash: string): Promise<Record<string, string>> {
  return key.proofHeaders((timestampMs) => readProofTranscript(grantPathOf(intentId), contentHash, timestampMs));
}

/** The `name=value` pair of the single Set-Cookie line a response issued. */
export function issuedCookie(response: RawResponse): string {
  const [line] = response.headers.getSetCookie();
  if (line === undefined) throw new Error("expected a Set-Cookie line");
  return line.split(";", 1)[0] ?? "";
}

export function jsonOf(response: RawResponse): Record<string, unknown> {
  return JSON.parse(response.body) as Record<string, unknown>;
}

export function dataOfRaw(response: RawResponse): Record<string, unknown> {
  return jsonOf(response).data as Record<string, unknown>;
}

/** The denial a client observes, with the per-request `request_id` checked and then removed so denials compare equal. */
export function denial(response: RawResponse): { status: number; error: unknown; cacheControl: string | null } {
  const { request_id: requestId, ...rest } = jsonOf(response);
  if (typeof requestId !== "string" || !UUID.test(requestId)) throw new Error(`denial without a valid request_id: ${response.body}`);
  if (Object.keys(rest).join() !== "error") throw new Error(`denial carries more than an error envelope: ${response.body}`);
  return { status: response.status, error: rest.error, cacheControl: response.headers.get("Cache-Control") };
}

export const UNIFORM_NOT_FOUND = { status: 404, error: RESOURCE_NOT_FOUND_ERROR, cacheControl: "private, no-store" } as const;
