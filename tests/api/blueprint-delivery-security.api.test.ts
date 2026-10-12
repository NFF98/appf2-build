import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import { issueBlueprintAccessGrant } from "../../src/edge/blueprint-access-grant.js";
import { routeBlueprintDelivery, type BlueprintDeliveryComposition } from "../../src/edge/blueprint-delivery.js";
import type { BlueprintContentRecord } from "../../src/platform/blueprint/blueprint-admission.js";
import type { ExecutionAdmissionDenial } from "../../src/platform/blueprint/execution-admission.js";
import { FIRST_PARTY_ORIGIN, FirstPartyBrowser, grantPathOf } from "./s03-first-party-client.js";
import { createS03Backend, type S03Backend } from "./s03-worker-backend.js";

const NOT_FOUND = { status: 404, code: "API-RESOURCE-NOT-FOUND" };
const GRANT_COOKIE = "__Secure-appf2.intent.v1";

interface Holder {
  readonly backend: S03Backend;
  readonly browser: FirstPartyBrowser;
  readonly intentId: string;
  readonly contentHash: string;
}

async function validatedHolder(now?: () => number): Promise<Holder> {
  const backend = createS03Backend(now === undefined ? {} : { now });
  const browser = new FirstPartyBrowser(backend, now);
  return { backend, browser, ...(await browser.createValidated()) };
}

interface RawRead {
  readonly path: string;
  readonly headers?: Record<string, string>;
  readonly method?: string;
}

async function raw(backend: S03Backend, { path, headers = {}, method = "GET" }: RawRead): Promise<{ status: number; body: string; headers: Headers }> {
  const response = await backend.handle(new Request(new URL(path, FIRST_PARTY_ORIGIN), { method, headers }));
  return { status: response.status, body: await response.text(), headers: response.headers };
}

const errorCode = (body: string): string | undefined => (JSON.parse(body) as { error?: { code?: string } }).error?.code;

async function grantHeaders(holder: Holder, overrides: Record<string, string | null> = {}): Promise<Record<string, string>> {
  const base: Record<string, string> = {
    "Sec-Fetch-Site": "same-origin",
    Cookie: holder.browser.cookieFor(grantPathOf(holder.intentId)),
    ...(await holder.browser.readProof(holder.intentId, holder.contentHash))
  };
  for (const [name, value] of Object.entries(overrides)) {
    if (value === null) delete base[name];
    else base[name] = value;
  }
  return base;
}

const grantUrl = (holder: Holder, query = `content_hash=${holder.contentHash}`): string => `${grantPathOf(holder.intentId)}?${query}`;

async function issuedGrant(holder: Holder): Promise<string> {
  const response = await raw(holder.backend, { path: grantUrl(holder), headers: await grantHeaders(holder) });
  expect(response.status).toBe(200);
  return (JSON.parse(response.body) as { data: { intent_blueprint_access_grant: string } }).data.intent_blueprint_access_grant;
}

const bearer = (token: string): Record<string, string> => ({ Authorization: `Bearer ${token}`, "Sec-Fetch-Site": "same-origin" });

describe("original-holder Blueprint delivery boundary", () => {
  test("the original holder gets a short-lived grant bound to intent, hash and PoP key, and /b plus admission accept it", async () => {
    const holder = await validatedHolder();
    const cookieHeader = holder.browser.cookieFor(grantPathOf(holder.intentId));
    expect(cookieHeader.startsWith(`${GRANT_COOKIE}=`)).toBe(true);
    expect(holder.browser.cookieFor("/b/" + holder.contentHash)).toBe("");
    expect(holder.browser.cookieFor(`/api/v1/blueprints/${holder.contentHash}/execution-admission`)).toBe("");

    const issued = await raw(holder.backend, { path: grantUrl(holder), headers: await grantHeaders(holder) });
    expect(issued.status).toBe(200);
    expect(issued.headers.get("Cache-Control")).toBe("private, no-store");
    const data = (JSON.parse(issued.body) as { data: Record<string, string | string[]> }).data;
    const key = holder.browser.keyring.keyForIntent(holder.intentId);
    expect(data).toMatchObject({
      intent_id: holder.intentId,
      content_hash: holder.contentHash,
      key_thumbprint: key?.thumbprint,
      audience: ["blueprint:read", "share:create"]
    });
    expect(Date.parse(String(data.expires_at)) - Date.parse(String(data.issued_at))).toBeLessThanOrEqual(60_000);

    const body = await raw(holder.backend, { path: `/b/${holder.contentHash}`, headers: bearer(String(data.intent_blueprint_access_grant)) });
    expect(body.status).toBe(200);
    expect(body.headers.get("Cache-Control")).toBe("private, no-store");
    expect(body.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(`sha256:${createHash("sha256").update(body.body, "utf8").digest("hex")}`).toBe(holder.contentHash);

    const admission = await raw(holder.backend, {
      path: `/api/v1/blueprints/${holder.contentHash}/execution-admission`,
      headers: bearer(String(data.intent_blueprint_access_grant))
    });
    expect(admission.status).toBe(200);
    expect(admission.headers.get("Cache-Control")).toBe("private, max-age=0, must-revalidate");
    expect(JSON.parse(admission.body)).toMatchObject({ data: { executable: true, content_hash: holder.contentHash, trust_status: "VALIDATED" } });
  });

  test("grant issuance answers one uniform 404 unless cookie, same-key fresh proof, exact query and first-party metadata all hold", async () => {
    const holder = await validatedHolder();
    const stranger = await validatedHolder();
    const strangerProof = await stranger.browser.readProof(stranger.intentId, holder.contentHash, grantPathOf(holder.intentId));
    let clock = Date.now();
    const stale = await validatedHolder(() => clock);
    const staleHeaders = await grantHeaders(stale);
    const cases: Record<string, RawRead> = {
      "cookie only, no PoP": {
        path: grantUrl(holder),
        headers: { "Sec-Fetch-Site": "same-origin", Cookie: holder.browser.cookieFor(grantPathOf(holder.intentId)) }
      },
      "PoP only, no cookie": { path: grantUrl(holder), headers: await grantHeaders(holder, { Cookie: null }) },
      "another intent's cookie": {
        path: grantUrl(holder),
        headers: await grantHeaders(holder, { Cookie: stranger.browser.cookieFor(grantPathOf(stranger.intentId)) })
      },
      "a foreign key's proof": { path: grantUrl(holder), headers: { ...(await grantHeaders(holder)), ...strangerProof } },
      "proof signed for another path": {
        path: grantUrl(holder),
        headers: { ...(await grantHeaders(holder)), ...(await holder.browser.readProof(holder.intentId, holder.contentHash, "/api/v1/intents")) }
      },
      "extra query field": { path: grantUrl(holder, `content_hash=${holder.contentHash}&x=1`), headers: await grantHeaders(holder) },
      "cross-site fetch metadata": { path: grantUrl(holder), headers: await grantHeaders(holder, { "Sec-Fetch-Site": "cross-site" }) },
      "foreign Origin": { path: grantUrl(holder), headers: await grantHeaders(holder, { Origin: "https://evil.test" }) },
      "no fetch metadata and no Origin": { path: grantUrl(holder), headers: await grantHeaders(holder, { "Sec-Fetch-Site": null }) },
      "POST instead of GET": { path: grantUrl(holder), headers: await grantHeaders(holder), method: "POST" },
      "hash this intent never validated": { path: grantUrl(holder, `content_hash=sha256:${"0".repeat(64)}`), headers: await grantHeaders(holder) }
    };
    for (const [name, read] of Object.entries(cases)) {
      const response = await raw(holder.backend, read);
      expect({ name, status: response.status, code: errorCode(response.body) }).toEqual({ name, ...NOT_FOUND });
      expect(response.body).not.toContain("intent_blueprint_access_grant");
    }
    clock += 91_000;
    const staleResponse = await raw(stale.backend, { path: grantUrl(stale), headers: staleHeaders });
    expect({ status: staleResponse.status, code: errorCode(staleResponse.body) }).toEqual(NOT_FOUND);
  });

  test("/b and admission refuse missing, forged, foreign-hash, expired or query-carrying grants without exposing body bytes", async () => {
    let now = Date.now();
    const holder = await validatedHolder(() => now);
    const token = await issuedGrant(holder);
    const otherHash = `sha256:${"2".repeat(64)}`;
    const [payload = "", mac = ""] = token.split(".");
    const forged = `${payload}.${mac.slice(0, -2)}${mac.endsWith("AA") ? "BB" : "AA"}`;
    const reads: Record<string, RawRead> = {
      "no Authorization": { path: `/b/${holder.contentHash}`, headers: { "Sec-Fetch-Site": "same-origin" } },
      "forged MAC": { path: `/b/${holder.contentHash}`, headers: bearer(forged) },
      "grant for another hash": { path: `/b/${otherHash}`, headers: bearer(token) },
      "query string on /b": { path: `/b/${holder.contentHash}?download=1`, headers: bearer(token) },
      "cross-site /b": { path: `/b/${holder.contentHash}`, headers: { ...bearer(token), "Sec-Fetch-Site": "cross-site" } },
      "admission without grant": { path: `/api/v1/blueprints/${holder.contentHash}/execution-admission`, headers: { "Sec-Fetch-Site": "same-origin" } },
      "admission with forged grant": { path: `/api/v1/blueprints/${holder.contentHash}/execution-admission`, headers: bearer(forged) }
    };
    for (const [name, read] of Object.entries(reads)) {
      const response = await raw(holder.backend, read);
      expect({ name, status: response.status, code: errorCode(response.body) }).toEqual({ name, ...NOT_FOUND });
    }
    expect((await raw(holder.backend, { path: `/b/${holder.contentHash}`, headers: bearer(token) })).status).toBe(200);
    now += 61_000;
    const expired = await raw(holder.backend, { path: `/b/${holder.contentHash}`, headers: bearer(token) });
    expect({ status: expired.status, code: errorCode(expired.body) }).toEqual(NOT_FOUND);
  });
});

describe("fresh execution admission on the delivery surface", () => {
  test("fresh admission reports a revoked or integrity-broken Blueprint through the contract codes, never as executable", async () => {
    const holder = await validatedHolder();
    const token = await issuedGrant(holder);
    const admissionPath = `/api/v1/blueprints/${holder.contentHash}/execution-admission`;
    const contents = holder.backend.harness.db.blueprint.contents;
    const record = contents.get(holder.contentHash);
    if (record === undefined) throw new Error("validated content missing");

    contents.set(holder.contentHash, { ...record, trust_status: "REVOKED" } as unknown as BlueprintContentRecord);
    const revoked = await raw(holder.backend, { path: admissionPath, headers: bearer(token) });
    expect({ status: revoked.status, code: errorCode(revoked.body) }).toEqual({ status: 410, code: "F02-ERR-016" });
    expect(revoked.headers.get("Cache-Control")).toBe("private, max-age=0, must-revalidate");

    const tampered: unknown = JSON.parse(JSON.stringify(record.canonical_blueprint).replace("聚餐分帳", "聚餐分账"));
    contents.set(holder.contentHash, { ...record, trust_status: "VALIDATED", canonical_blueprint: tampered } as BlueprintContentRecord);
    const broken = await raw(holder.backend, { path: admissionPath, headers: bearer(token) });
    expect({ status: broken.status, code: errorCode(broken.body) }).toEqual({ status: 500, code: "F02-ERR-015" });
    const brokenBody = await raw(holder.backend, { path: `/b/${holder.contentHash}`, headers: bearer(token) });
    expect({ status: brokenBody.status, code: errorCode(brokenBody.body) }).toEqual(NOT_FOUND);
  });

  test("every admission denial step maps to its EXECUTION-ADMISSION HTTP status and a store outage to retryable 503", async () => {
    const secret = "a".repeat(64);
    const nowMs = Date.now();
    const contentHash = `sha256:${"1".repeat(64)}`;
    const grant = await issueBlueprintAccessGrant(
      { intentId: crypto.randomUUID(), anonymousId: crypto.randomUUID(), contentHash, keyThumbprint: "t".repeat(43) },
      secret,
      nowMs
    );
    const admit = async (decide: () => Promise<ExecutionAdmissionDenial>) => {
      const composition = {
        executor: { close: async () => undefined },
        lineage: {
          verifyLineage: async () => ({ verified: true, content_hash: contentHash, own_validation_run_id: "r", registry_digest: "d", trust_status: "VALIDATED" }),
          readCanonicalBody: async () => ({ kind: "NOT_ADMITTED" })
        },
        admission: { admit: decide }
      } as unknown as BlueprintDeliveryComposition;
      const url = new URL(`/api/v1/blueprints/${contentHash}/execution-admission`, FIRST_PARTY_ORIGIN);
      const response = await routeBlueprintDelivery({
        request: new Request(url, { headers: bearer(grant.token) }),
        url,
        env: { APPF2_IDENTITY_COOKIE_SECRET: secret } as never,
        nowMs,
        factory: () => composition
      });
      if (response === undefined) throw new Error("admission route not matched");
      return { status: response.status, code: errorCode(await response.text()), cache: response.headers.get("Cache-Control") };
    };
    const expected = {
      E01: [404, "API-RESOURCE-NOT-FOUND"],
      E02: [410, "F02-ERR-016"],
      E03: [422, "F02-ERR-017"],
      "E04-A": [422, "F02-ERR-017"],
      "E04-B": [500, "F02-ERR-015"],
      E05: [422, "F02-ERR-017"],
      E06: [422, "F02-ERR-017"],
      E07: [422, "F02-ERR-017"],
      E08: [503, "API-ADMISSION-TEMPORARILY-UNAVAILABLE"]
    } as const;
    for (const [step, [status, code]] of Object.entries(expected)) {
      const denial = { executable: false, step, retryable: step === "E08", reason: "test" } as ExecutionAdmissionDenial;
      expect({ step, ...(await admit(async () => denial)) }).toEqual({ step, status, code, cache: "private, max-age=0, must-revalidate" });
    }
    expect(await admit(async () => Promise.reject(new Error("store down")))).toEqual({
      status: 503,
      code: "API-ADMISSION-TEMPORARILY-UNAVAILABLE",
      cache: "private, no-store"
    });
  });
});
