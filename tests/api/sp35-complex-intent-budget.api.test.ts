import { describe, expect, it } from "vitest";
import { INTENT_ROUTE_KEYS, ROUTE_LEASE_MS } from "../../src/platform/compiler/idempotency.js";
import { MAX_PROVIDER_ATTEMPTS, MODEL_OPERATION_TIMEOUT_MS, RequestDeadline } from "../../src/platform/compiler/model-gateway.js";

describe("Sprint 3.5 bounded complex-feature analysis budget", () => {
  it("allows two full legitimate analysis attempts within the CREATE route budget", () => {
    const total = ROUTE_LEASE_MS[INTENT_ROUTE_KEYS.create];
    const perAttempt = MODEL_OPERATION_TIMEOUT_MS.INTENT_ANALYSIS;
    expect(MAX_PROVIDER_ATTEMPTS).toBe(2);
    expect(total).toBeGreaterThanOrEqual(MAX_PROVIDER_ATTEMPTS * perAttempt + 5_000);
    const time = 1000;
    const deadline = new RequestDeadline(total, () => time);
    expect(deadline.attemptTimeoutMs("INTENT_ANALYSIS")).toBe(perAttempt);
  });

  it("still strictly clips each model attempt to remaining lease time", () => {
    let now = 1000;
    const deadline = new RequestDeadline(ROUTE_LEASE_MS[INTENT_ROUTE_KEYS.create], () => now);
    now += ROUTE_LEASE_MS[INTENT_ROUTE_KEYS.create] - 350;
    expect(deadline.attemptTimeoutMs("INTENT_ANALYSIS")).toBe(350);
    now += 350;
    expect(deadline.attemptTimeoutMs("INTENT_ANALYSIS")).toBe(0);
  });
});
