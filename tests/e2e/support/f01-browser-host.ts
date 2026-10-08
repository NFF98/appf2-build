import type { Page, Route } from "@playwright/test";

import type { StructuredIntentEnvelope } from "../../../src/platform/intent/intent-contract.js";
import type { JsonValue } from "../../../src/platform/intent/json-value.js";
import { ANON, blueprintCandidate, createF01Harness, succeeded, type F01Harness } from "../../api/f01-harness.js";

/** F07 browser identity key; seeded with the harness identity so body and trusted context agree. */
export const ANONYMOUS_ID_STORAGE_KEY = "appf2.anonymous_id.v1";

export type RecordedCall = {
  readonly path: string;
  readonly idempotencyKey: string;
  readonly body: Record<string, unknown>;
  /** null when the host dropped the request at the network layer before it reached F01. */
  readonly status: number | null;
  readonly response: Record<string, unknown> | null;
};

type Interference = { readonly match: (path: string) => boolean; readonly apply: (route: Route) => Promise<boolean> };

/**
 * Hosts the production F01 `createIntentApiHandler` (real IntentCompilerService over the F01 fakes and a
 * scripted model gateway) behind the page's same-origin `/api/v1/intents*` calls. The Edge mount that
 * supplies the trusted anonymous context is not part of this repository yet, so the host plays that role.
 */
export class F01BrowserHost {
  public readonly harness: F01Harness = createF01Harness();
  public readonly calls: RecordedCall[] = [];
  private readonly interferences: Interference[] = [];

  public static async attach(page: Page): Promise<F01BrowserHost> {
    const host = new F01BrowserHost();
    await page.addInitScript(([key, id]) => window.localStorage.setItem(key, id), [ANONYMOUS_ID_STORAGE_KEY, ANON] as const);
    await page.route("**/api/v1/intents**", (route) => host.serve(route));
    return host;
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
      apply: async (route) => {
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
      apply: async () => {
        await gate;
        return false;
      }
    });
    return () => release();
  }

  public callsTo(suffix: string): RecordedCall[] {
    return this.calls.filter((call) => call.path.endsWith(suffix));
  }

  private async serve(route: Route): Promise<void> {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const body = (request.postDataJSON() ?? {}) as Record<string, unknown>;
    const idempotencyKey = request.headers()["idempotency-key"] ?? "";
    const index = this.interferences.findIndex((entry) => entry.match(path));
    if (index >= 0) {
      const [interference] = this.interferences.splice(index, 1);
      if (interference !== undefined && (await interference.apply(route))) {
        this.calls.push({ path, idempotencyKey, body, status: null, response: null });
        return;
      }
    }
    const response = await this.harness.handler({ method: request.method(), path, headers: request.headers(), body: request.postData() ?? "", trustedAnonymousId: ANON });
    if (response === undefined) return route.fulfill({ status: 404, body: "" });
    this.calls.push({ path, idempotencyKey, body, status: response.status, response: response.body as Record<string, unknown> });
    await route.fulfill({ status: response.status, headers: { ...response.headers, "content-type": "application/json" }, body: JSON.stringify(response.body) });
  }
}

export const isCreate = (path: string): boolean => path === "/api/v1/intents";
export const isAnswers = (path: string): boolean => path.endsWith("/answers");
export const isCompile = (path: string): boolean => path.endsWith("/compile");
