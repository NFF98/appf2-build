import { vi } from "vitest";

import { CreationController } from "../../../src/app/create/creation-controller.js";
import type { CreationSession } from "../../../src/app/create/creation-session.js";
import { createF01Client, type FetchLike } from "../../../src/app/create/f01-client.js";
import type { StructuredIntentEnvelope } from "../../../src/platform/intent/intent-contract.js";
import type { JsonValue } from "../../../src/platform/intent/json-value.js";
import { ANON, blueprintCandidate, createF01Harness, succeeded, type F01Harness } from "../../api/f01-harness.js";

export type InProcessCall = {
  readonly path: string;
  readonly idempotencyKey: string;
  readonly body: string;
  /** null when the host dropped the request before it reached F01. */
  readonly status: number | null;
  /** Exactly the body the Browser client received. */
  readonly response: unknown;
};

type Interference = {
  readonly match: (path: string) => boolean;
  readonly gate?: Promise<void>;
  readonly drop?: boolean;
  readonly rewrite?: (body: Record<string, unknown>) => Record<string, unknown>;
};

/**
 * Production Browser F01 client + CreationController over the production F01 `createIntentApiHandler` (real
 * IntentCompilerService on the F01 fakes with a scripted model gateway). The host only plays the Edge mount that
 * supplies the trusted anonymous context; responses reach the client unchanged unless a test tampers explicitly.
 */
export class InProcessF01 {
  public readonly harness: F01Harness = createF01Harness();
  public readonly calls: InProcessCall[] = [];
  public readonly controller: CreationController;
  private readonly interferences: Interference[] = [];
  private keyCounter = 0;

  public constructor() {
    this.controller = new CreationController({
      client: createF01Client(this.fetchImpl),
      anonymousId: () => ANON,
      newIdempotencyKey: () => `browser-key-${++this.keyCounter}`
    });
  }

  public queueAnalysis(envelope: StructuredIntentEnvelope): this {
    this.harness.gateway.queueAnalysis(succeeded(envelope as unknown as JsonValue));
    return this;
  }

  public queueValidBlueprint(): this {
    this.harness.gateway.queueCompose(succeeded(blueprintCandidate()));
    return this;
  }

  /** Holds the next matching request until released, then lets it reach F01. */
  public holdNext(match: (path: string) => boolean): () => void {
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.interferences.push({ match, gate });
    return () => release();
  }

  /** Fails the next matching request at the network layer; it never reaches F01. */
  public dropNext(match: (path: string) => boolean): void {
    this.interferences.push({ match, drop: true });
  }

  /** Lets the next matching request reach F01, then hands the client a rewritten body. */
  public tamperNext(match: (path: string) => boolean, rewrite: (body: Record<string, unknown>) => Record<string, unknown>): void {
    this.interferences.push({ match, rewrite });
  }

  public callsTo(suffix: string): InProcessCall[] {
    return this.calls.filter((call) => call.path.endsWith(suffix));
  }

  public session(): CreationSession {
    const session = this.controller.getSnapshot();
    if (session === null) throw new Error("no creation session");
    return session;
  }

  /** Resolves once no F01 request is in flight (the controller's own busy flag). */
  public async settle(): Promise<CreationSession> {
    await vi.waitFor(() => {
      if (this.session().busy) throw new Error("F01 request still in flight");
    });
    return this.session();
  }

  private readonly fetchImpl: FetchLike = async (path, init) => {
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const body = typeof init.body === "string" ? init.body : "";
    const idempotencyKey = headers["idempotency-key"] ?? "";
    const index = this.interferences.findIndex((entry) => entry.match(path));
    const [interference] = index >= 0 ? this.interferences.splice(index, 1) : [];
    await interference?.gate;
    if (init.signal?.aborted === true) throw new DOMException("The request was aborted", "AbortError");
    if (interference?.drop === true) {
      this.calls.push({ path, idempotencyKey, body, status: null, response: null });
      throw new TypeError("Failed to fetch");
    }
    const response = await this.harness.handler({ method: init.method ?? "POST", path, headers, body, trustedAnonymousId: ANON });
    if (response === undefined) throw new Error(`F01 did not handle ${path}`);
    const original = response.body as Record<string, unknown>;
    const delivered = interference?.rewrite === undefined ? original : interference.rewrite(structuredClone(original));
    this.calls.push({ path, idempotencyKey, body, status: response.status, response: delivered });
    return new Response(JSON.stringify(delivered), { status: response.status, headers: { "content-type": "application/json" } });
  };
}

export const isCreate = (path: string): boolean => path === "/api/v1/intents";
export const isAnswers = (path: string): boolean => path.endsWith("/answers");
export const isCompile = (path: string): boolean => path.endsWith("/compile");
