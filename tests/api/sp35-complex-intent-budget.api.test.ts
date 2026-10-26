import { describe, expect, it } from "vitest";
import { INTENT_ROUTE_KEYS, ROUTE_LEASE_MS } from "../../src/platform/compiler/idempotency.js";
import { BLUEPRINT_ATTEMPT_TIMEOUTS_MS, MAX_PROVIDER_ATTEMPTS, MODEL_OPERATION_TIMEOUT_MS, RequestDeadline } from "../../src/platform/compiler/model-gateway.js";
import { BlueprintAttemptBudget } from "../../src/platform/compiler/provider-attempts.js";
import { COMPOSE_RESPONSE_SCHEMA, SYSTEM_POLICY } from "../../src/platform/compiler/prompts.js";

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

  it("gives F02 three bounded attempts within one 110-second lease and constrains invalid rule IDs", () => {
    const lease = ROUTE_LEASE_MS[INTENT_ROUTE_KEYS.compile];
    expect(lease).toBe(110_000);
    expect(BLUEPRINT_ATTEMPT_TIMEOUTS_MS).toEqual([45_000, 25_000, 25_000]);
    const budget = new BlueprintAttemptBudget();
    let now = 1_000;
    const deadline = new RequestDeadline(lease, () => now);
    for (const expected of BLUEPRINT_ATTEMPT_TIMEOUTS_MS) {
      expect(budget.take(deadline)).toBe(expected);
      now += expected;
    }
    expect(budget.remaining).toBe(0);
    expect(budget.take(deadline)).toBe(0);
    expect(deadline.remainingMs()).toBe(15_000);
    const rule = (COMPOSE_RESPONSE_SCHEMA as unknown as {
      properties: { rules: { items: { properties: { id: { pattern: string } } } } }
    }).properties.rules.items.properties.id;
    const idPattern = new RegExp(rule.pattern);
    expect(idPattern.test("task_total")).toBe(false);
    expect(idPattern.test("rule_task_total")).toBe(true);
    expect(SYSTEM_POLICY.BLUEPRINT_COMPOSE).toContain("EVERY rules[] entry");
  });

  it("requires exact V02 ValueSource keys and canonical path patterns in model schema", () => {
    const properties = COMPOSE_RESPONSE_SCHEMA.properties as Record<string, unknown>;
    const nodes = properties.nodes as { items: { properties: {
      bindings: { additionalProperties: { anyOf: Array<{ required: string[]; additionalProperties: boolean; properties: Record<string, { pattern?: string }> }> } }
    } } };
    const variants = nodes.items.properties.bindings.additionalProperties.anyOf;
    expect(variants).toHaveLength(6);
    expect(variants.every(v => v.additionalProperties === false)).toBe(true);
    expect(variants.map(v => v.required.join(","))).toEqual([
      "kind,value", "kind,key", "kind,rule_id", "kind,path", "kind,name,path", "kind,op,args"
    ]);
    expect(new RegExp(variants[4].properties.path.pattern ?? "").test("$.wrong")).toBe(false);
    expect(new RegExp(variants[4].properties.path.pattern ?? "").test("item.title")).toBe(true);
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
