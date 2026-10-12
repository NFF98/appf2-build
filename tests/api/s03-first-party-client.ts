import { webcrypto } from "node:crypto";

import { createF01Client, type FetchLike } from "../../src/app/create/f01-client.js";
import { PopKeyring } from "../../src/app/create/pop-keyring.js";
import { readProofTranscript } from "../../src/edge/create-proof.js";
import type { S03Backend } from "./s03-worker-backend.js";

export const FIRST_PARTY_ORIGIN = "https://appf2.test";

interface StoredCookie {
  readonly pair: string;
  readonly path: string;
}

/** The browser behaviours delivery relies on: same-origin Fetch Metadata, first-party Origin on POST, path-scoped cookies. */
export class FirstPartyBrowser {
  public readonly keyring: PopKeyring;
  public readonly fetch: FetchLike;
  private readonly cookies = new Map<string, StoredCookie>();

  public constructor(private readonly backend: S03Backend, now: () => number = Date.now) {
    this.keyring = new PopKeyring({ subtle: webcrypto.subtle as SubtleCrypto, now });
    this.fetch = async (input, init) => {
      const url = new URL(input, FIRST_PARTY_ORIGIN);
      const headers = new Headers(init.headers);
      headers.set("Sec-Fetch-Site", "same-origin");
      if (init.method === "POST") headers.set("Origin", FIRST_PARTY_ORIGIN);
      const cookie = this.cookieFor(url.pathname);
      if (cookie !== "") headers.set("Cookie", cookie);
      const response = await backend.handle(new Request(url, { ...init, headers }));
      for (const line of response.headers.getSetCookie()) this.store(line);
      return response;
    };
  }

  public cookieFor(pathname: string): string {
    return [...this.cookies.values()]
      .filter(({ path }) => pathname === path || pathname.startsWith(path.endsWith("/") ? path : `${path}/`))
      .map(({ pair }) => pair)
      .join("; ");
  }

  /** Natural language → F01 READY → F02 BUILD_VALIDATED through the production browser client. */
  public async createValidated(rawIntent = "幫我做一個聚餐分帳工具"): Promise<{ intentId: string; contentHash: string }> {
    const client = createF01Client(this.fetch, this.keyring);
    const created = await client.createIntent(
      { anonymous_id: crypto.randomUUID(), intent_kind: "CREATE", raw_intent: rawIntent },
      { idempotencyKey: crypto.randomUUID() }
    );
    if (!created.ok) throw new Error(`create failed: ${JSON.stringify(created.failure)}`);
    const compiled = await client.compile(created.data.intentId, { intent_version: created.data.intentVersion }, { idempotencyKey: crypto.randomUUID() });
    if (!compiled.ok) throw new Error(`compile failed: ${JSON.stringify(compiled.failure)}`);
    return { intentId: compiled.data.intentId, contentHash: compiled.data.contentHash };
  }

  /** Fresh same-key read proof headers for the grant path, signed by the key bound at CREATE. */
  public async readProof(intentId: string, contentHash: string, grantPath = grantPathOf(intentId)): Promise<Record<string, string>> {
    const key = this.keyring.keyForIntent(intentId);
    if (key === undefined) throw new Error("no PoP key bound to intent");
    return key.proofHeaders((timestampMs) => readProofTranscript(grantPath, contentHash, timestampMs));
  }

  private store(line: string): void {
    const [pair = "", ...attributes] = line.split(";").map((part) => part.trim());
    const name = pair.slice(0, pair.indexOf("="));
    const path = attributes.find((attribute) => attribute.toLowerCase().startsWith("path="))?.slice(5) ?? "/";
    this.cookies.set(`${name}@${path}`, { pair, path });
  }
}

export const grantPathOf = (intentId: string): string => `/api/v1/intents/${intentId}/blueprint-access-grant`;
