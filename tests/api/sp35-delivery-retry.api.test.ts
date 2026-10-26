import { describe, expect, it } from "vitest";
import { createAppDeliveryClient } from "../../src/app/runtime/app-delivery.js";
import type { PopKeyring } from "../../src/app/create/pop-keyring.js";

const hash = "sha256:" + "a".repeat(64);
const keyring = { keyForIntent: () => ({ proofHeaders: async () => ({ "X-Appf2-PoP-Key": "test" }) }) } as unknown as PopKeyring;
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), {
  status, headers: { "Content-Type": "application/json" }
});
const grant = () => json({ intent_blueprint_access_grant: "test_grant_" + "g".repeat(64) });
const admitted = () => json({ executable: true, content_hash: hash, expires_at: "2027-01-01T00:00:00Z" });

describe("Sprint 3.5 read-only App delivery transport recovery", () => {
  it("retries one reset on holder grant GET and completes the exact admission sequence", async () => {
    const calls: string[] = [];
    let grantAttempts = 0;
    const client = createAppDeliveryClient(async (path, init) => {
      expect(init.method).toBe("GET");
      calls.push(path);
      if (path.includes("blueprint-access-grant")) {
        if (++grantAttempts === 1) throw new TypeError("read ECONNRESET");
        return grant();
      }
      if (path.startsWith("/b/")) return new Response('{"kind":"APP","nodes":[{"id":"node_a"}]}');
      if (path.endsWith("/execution-admission")) return admitted();
      throw Error("unexpected route");
    }, keyring);
    const result = await client.deliver("intent-1", hash);
    expect(result.ok).toBe(true);
    expect(calls).toHaveLength(4);
    expect(calls.filter(path => path.includes("blueprint-access-grant"))).toHaveLength(2);
    expect(calls.filter(path => path.endsWith("/execution-admission"))).toHaveLength(1);
  });

  it("retries temporary 503 but never turns the final server failure into PASS", async () => {
    let requests = 0;
    const client = createAppDeliveryClient(async () => {
      requests += 1;
      return json({ error: "unavailable" }, 503);
    }, keyring);
    expect(await client.deliver("intent-2", hash)).toEqual({ ok: false, failure: "TEMPORARILY_UNAVAILABLE" });
    expect(requests).toBe(3);
  });

  it("does not retry 404 or other permanent original-holder denial", async () => {
    let requests = 0;
    const client = createAppDeliveryClient(async () => {
      requests += 1;
      return json({}, 404);
    }, keyring);
    expect(await client.deliver("intent-3", hash)).toEqual({ ok: false, failure: "NOT_FOUND" });
    expect(requests).toBe(1);
  });

  it("never accepts a transport failure after the bounded third GET attempt", async () => {
    let requests = 0;
    const client = createAppDeliveryClient(async () => {
      requests += 1;
      throw new TypeError("read ECONNRESET");
    }, keyring);
    expect(await client.deliver("intent-4", hash)).toEqual({ ok: false, failure: "NETWORK" });
    expect(requests).toBe(3);
  });
});
