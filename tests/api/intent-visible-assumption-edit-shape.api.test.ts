import { describe, expect, test } from "vitest";

import type { StructuredIntentEnvelope } from "../../src/platform/intent/intent-contract.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";
import { MENU_EDIT, editShapeAnalysis, expectedEditShapeAssumptions } from "../contract/intent-edit-shape-fixtures.js";
import { analysis, llmProposal } from "../contract/intent-envelope-fixtures.js";
import { OTHER_ANON, createF01Harness, dataOf, errorOf, succeeded, type F01Harness } from "./f01-harness.js";

const ANSWERS_ROUTE = "POST /api/v1/intents/{intent_id}/answers";

async function createdShapeIntent(h: F01Harness, envelope: StructuredIntentEnvelope = editShapeAnalysis()) {
  h.gateway.queueAnalysis(succeeded(envelope as unknown as JsonValue));
  const response = await h.create("create-shape");
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const data = dataOf(response);
  return { intentId: String(data.intent_id), version: Number(data.intent_version), data };
}

const decisions = (version: number, entries: readonly Record<string, JsonValue>[]) => ({ answers: [], assumption_decisions: entries, intent_version: version });
const menuEdit = (version: number) => decisions(version, [{ assumption_id: "f_menu", decision: "EDIT", edited_value: MENU_EDIT }]);

describe("F01-DATA-004A edit shape over F01-API-001 / F01-API-002", () => {
  test("F01-DATA-004A idempotent create and answers replays return the identical projected edit shape", async () => {
    const h = createF01Harness();
    const created = await createdShapeIntent(h);
    expect(dataOf(await h.create("create-shape"))).toStrictEqual(created.data);
    expect(h.gateway.calls("INTENT_ANALYSIS")).toHaveLength(1);

    const first = dataOf(await h.answers(created.intentId, menuEdit(created.version), "answers-menu"));
    const replay = dataOf(await h.answers(created.intentId, menuEdit(created.version), "answers-menu"));
    expect(replay).toStrictEqual(first);
    expect(h.db.intents.get(created.intentId)?.intent_version).toBe(created.version + 1);
    const conflict = await h.answers(created.intentId, decisions(created.version, [{ assumption_id: "f_menu", decision: "EDIT", edited_value: { other: 1 } }]), "answers-menu");
    expect([conflict.status, errorOf(conflict).code]).toEqual([409, "API-IDEMPOTENCY-CONFLICT"]);
  });

  test("F01-DATA-004A a stale intent_version EDIT is 409 without mutation and the fresh projection stays usable", async () => {
    const h = createF01Harness();
    const created = await createdShapeIntent(h);
    await h.answers(created.intentId, decisions(created.version, [{ assumption_id: "a_title", decision: "ACCEPT" }]), "answers-advance");
    const before = structuredClone(h.db.intents.get(created.intentId));

    const stale = await h.answers(created.intentId, menuEdit(created.version), "answers-stale");
    expect([stale.status, errorOf(stale).code, errorOf(stale).retryable]).toEqual([409, "F01-ERR-004", true]);
    expect(h.db.intents.get(created.intentId)).toEqual(before);

    const fresh = await h.answers(created.intentId, menuEdit(created.version + 1), "answers-fresh");
    expect(fresh.status, JSON.stringify(fresh.body)).toBe(200);
    const pending = (dataOf(fresh).visible_assumptions as Record<string, JsonValue>[]).filter((entry) => entry.classification !== "FACT");
    const expected = expectedEditShapeAssumptions().filter((entry) => !["a_title", "f_menu", "occasion"].includes(String(entry.assumption_id)));
    expect(pending).toStrictEqual(expected);
  });

  test("F01-DATA-004A a foreign anonymous identity cannot read or edit the projected shape", async () => {
    const h = createF01Harness();
    const created = await createdShapeIntent(h);
    const before = structuredClone(h.db.intents.get(created.intentId));
    const foreign = await h.post(`/api/v1/intents/${created.intentId}/answers`, menuEdit(created.version), { anon: OTHER_ANON, key: "answers-foreign" });
    expect([foreign.status, errorOf(foreign).code]).toEqual([404, "F01-ERR-015"]);
    const text = JSON.stringify(foreign.body);
    for (const leak of ["OPEN_JSON_RECORD_V1", "hotpot", "visible_assumptions", "options"]) expect(text).not.toContain(leak);
    expect(h.db.intents.get(created.intentId)).toEqual(before);
  });

  test("F01-DATA-004A FACT, UNKNOWN and risk-flagged items stay non-decidable despite visible metadata", async () => {
    const h = createF01Harness();
    const risky = llmProposal({ id: "deposit", policy_risk_flags: ["MONEY"], expected_value_type: "NUMBER", question_type: "NUMBER", proposed_default: 200 });
    const base = editShapeAnalysis();
    const created = await createdShapeIntent(h, { ...base, candidate_rules: [risky] });
    expect(created.data.status).toBe("NEEDS_CLARIFICATION");
    expect((created.data.visible_assumptions as Record<string, JsonValue>[]).find((entry) => entry.assumption_id === "deposit")).toMatchObject({
      classification: "PROPOSAL",
      expected_value_type: "NUMBER",
      question_type: "NUMBER"
    });
    const cases = [
      [{ assumption_id: "occasion", decision: "EDIT", edited_value: "lunch" }, "$.assumption_decisions[0].assumption_id", "ASSUMPTION_NOT_DECIDABLE"],
      [{ assumption_id: "h_theme", decision: "ACCEPT" }, "$.assumption_decisions[0].assumption_id", "ASSUMPTION_NOT_DECIDABLE"],
      [{ assumption_id: "deposit", decision: "EDIT", edited_value: 100 }, "$.assumption_decisions[0].decision", "RISK_ITEM_REQUIRES_CLARIFICATION_ANSWER"]
    ] as const;
    const before = structuredClone(h.db.intents.get(created.intentId));
    for (const [index, [entry, path, reason]] of cases.entries()) {
      const response = await h.answers(created.intentId, decisions(created.version, [entry]), `non-decidable-${index}`);
      expect([response.status, errorOf(response).code], reason).toEqual([400, "F01-ERR-003"]);
      expect(errorOf(response).details).toEqual({ violations: [{ path, reason }] });
      expect(h.db.operationFor(ANSWERS_ROUTE, `non-decidable-${index}`)).toMatchObject({ status: "FAILED_TERMINAL", error_code: "F01-ERR-003" });
    }
    expect(h.db.intents.get(created.intentId)).toEqual(before);
  });

  test("F01-DATA-004A a Client cannot submit its own edit-shape metadata or alternatives", async () => {
    const h = createF01Harness();
    const created = await createdShapeIntent(h, analysis({ assumptions: editShapeAnalysis().assumptions }));
    const before = structuredClone(h.db.intents.get(created.intentId));
    for (const field of ["options", "expected_value_type", "question_type", "record_edit_schema", "alternatives"]) {
      const body = decisions(created.version, [{ assumption_id: "d_rounding", decision: "EDIT", edited_value: 7, [field]: [7] }]);
      const response = await h.answers(created.intentId, body, `forged-${field}`);
      expect([response.status, errorOf(response).code], field).toEqual([400, "F01-ERR-001"]);
    }
    expect(h.db.intents.get(created.intentId)).toEqual(before);
  });
});
