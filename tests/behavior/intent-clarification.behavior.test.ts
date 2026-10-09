import { describe, expect, test } from "vitest";

import { mergeReanalysis } from "../../src/platform/intent/analysis-merge.js";
import { submitClarificationAnswers } from "../../src/platform/intent/answer-merge.js";
import { evaluateClarificationPolicy } from "../../src/platform/intent/clarification-policy.js";
import { F01_CLARIFICATION_POLICY_VERSION, type StructuredIntentEnvelope } from "../../src/platform/intent/intent-contract.js";
import { restoreTrustedIntentState, startIntentClarification, type TrustedIntentState } from "../../src/platform/intent/intent-state.js";
import { questionIdFor } from "../../src/platform/intent/question-projection.js";
import { admitResolvedIntent, isResolvedIntentAdmission, parseCompileRequest } from "../../src/platform/intent/resolved-intent-gate.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";
import { createF01Harness, dataOf, errorOf, succeeded, type F01Harness } from "../api/f01-harness.js";
import {
  ADD_ON_OPTIONS,
  MENU_EDIT,
  MENU_PROPOSAL,
  SIX_TYPE_ASSUMPTIONS,
  editShapeAnalysis,
  expectedEditShapeAssumptions
} from "../contract/intent-edit-shape-fixtures.js";
import {
  NFF_POLICY_REF,
  analysis,
  answersBody,
  confirmed,
  findItem,
  item,
  knownInput,
  llmProposal,
  nffDefault,
  persisted,
  type EnvelopeSpec
} from "../contract/intent-envelope-fixtures.js";

const contractError = (code: string, reason?: string) =>
  expect.objectContaining({ code, ...(reason ? { violations: expect.arrayContaining([expect.objectContaining({ reason })]) } : {}) });

function questionFor(state: TrustedIntentState, itemId: string) {
  const question = evaluateClarificationPolicy(state).questions.find((candidate) => candidate.semantic_item_ids[0] === itemId);
  if (question === undefined) throw new Error(`no question for ${itemId}`);
  return question;
}

describe("F01-AC-001 User facts are never overwritten by LLM proposals", () => {
  const headcount = llmProposal({
    id: "headcount",
    required_for_execution: true,
    can_default: false,
    expected_value_type: "NUMBER",
    question_type: "NUMBER",
    proposed_default: 10
  });
  const start = () =>
    startIntentClarification(analysis({ missing_fields: [headcount], known_inputs: [knownInput({ id: "payer", value: "Alice" })] }));

  test("TEST-F01-001 a clarification answer replaces the conflicting LLM proposal with USER_EXPLICIT resolved_value", () => {
    const state = start();
    const merged = submitClarificationAnswers(state, answersBody([{ question_id: questionFor(state, "headcount").question_id, value: 12 }]));
    const target = findItem(merged.state.envelope, "headcount");

    expect(target).toMatchObject({ source: "USER_EXPLICIT", resolution_state: "CONFIRMED", resolved_value: 12, can_default: false });
    expect(target).not.toHaveProperty("proposed_default");
    expect(merged.evaluation.decision).toBe("READY");
    expect(merged.evaluation.visible_assumptions).toContainEqual(
      expect.objectContaining({ assumption_id: "headcount", classification: "FACT", resolved_value: 12 })
    );
  });

  test("TEST-F01-001 a later Prompt A re-analysis cannot overwrite confirmed User truth or User known inputs", () => {
    const state = start();
    const answered = submitClarificationAnswers(state, answersBody([{ question_id: questionFor(state, "headcount").question_id, value: 12 }]));
    const reanalysed = mergeReanalysis(
      answered.state,
      analysis({
        missing_fields: [{ ...headcount, can_default: true, proposed_default: 30 }],
        known_inputs: [knownInput({ id: "payer", value: "Bob", source: "DOMAIN_KNOWN" })]
      })
    );

    expect(findItem(reanalysed.state.envelope, "headcount")).toMatchObject({ source: "USER_EXPLICIT", resolved_value: 12 });
    expect(reanalysed.state.envelope.known_inputs).toEqual([knownInput({ id: "payer", value: "Alice" })]);
    expect(reanalysed.state.envelope.analysis_metadata.clarification_policy_state.changed_semantic_item_ids).toEqual([]);
    expect(reanalysed.evaluation.decision).toBe("READY");
  });

  test("TEST-F01-001 Prompt A cannot promote or drop a pending risk item to bypass User clarification", () => {
    const deposit = llmProposal({ id: "deposit", policy_risk_flags: ["MONEY"], proposed_default: "200" });
    const state = startIntentClarification(analysis({ candidate_rules: [deposit] }));

    const promoted = mergeReanalysis(state, analysis({ candidate_rules: [confirmed({ id: "deposit", policy_risk_flags: ["MONEY"], resolved_value: "0" })] }));
    expect(findItem(promoted.state.envelope, "deposit")).toEqual(deposit);
    expect(promoted.evaluation.questions.map((question) => question.policy_rule_id)).toEqual(["F01-POL-CP-003"]);

    const dropped = mergeReanalysis(state, analysis());
    expect(findItem(dropped.state.envelope, "deposit")).toEqual(deposit);
    expect(dropped.evaluation.decision).toBe("NEEDS_CLARIFICATION");
  });

  test("TEST-F01-001 accepting a proposal keeps proposal provenance instead of relabelling it USER_EXPLICIT", () => {
    const state = startIntentClarification(
      analysis({
        assumptions: [
          llmProposal({ id: "split", proposed_default: "EQUAL", source_ref: { origin_item_id: "split_hint" } }),
          nffDefault({ id: "currency", proposed_default: "TWD" })
        ]
      })
    );
    const merged = submitClarificationAnswers(
      state,
      answersBody([], [{ assumption_id: "split", decision: "ACCEPT" }, { assumption_id: "currency", decision: "ACCEPT", edited_value: null }])
    );

    expect(findItem(merged.state.envelope, "split")).toMatchObject({
      source: "USER_ACCEPTED_PROPOSAL",
      source_ref: { origin_item_id: "split_hint" },
      resolution_state: "CONFIRMED",
      resolved_value: "EQUAL",
      can_default: false
    });
    expect(findItem(merged.state.envelope, "currency")).toMatchObject({
      source: "NFF_DEFAULT",
      source_ref: NFF_POLICY_REF,
      resolution_state: "CONFIRMED",
      resolved_value: "TWD",
      can_default: false
    });
    expect(findItem(merged.state.envelope, "currency")).not.toHaveProperty("proposed_default");
    expect(merged.evaluation.decision).toBe("READY");
  });
});

describe("F01-AC-004 material proposals and defaults are visible", () => {
  const spec: EnvelopeSpec = {
    constraints: [confirmed({ id: "occasion", resolved_value: "team dinner" })],
    assumptions: [
      llmProposal({ id: "split", proposed_default: "EQUAL", user_visible: false }),
      nffDefault({ id: "currency", proposed_default: "TWD", user_visible: false }),
      llmProposal({ id: "theme", materiality: "COSMETIC", proposed_default: "dark", user_visible: false })
    ]
  };

  test("TEST-F01-004 a safe material proposal yields READY_WITH_VISIBLE_ASSUMPTIONS listing every material DEFAULT / PROPOSAL", () => {
    const evaluation = evaluateClarificationPolicy(startIntentClarification(analysis(spec)));

    expect(evaluation.decision).toBe("READY_WITH_VISIBLE_ASSUMPTIONS");
    expect(evaluation.triggered_rule_ids).toEqual(["F01-POL-CP-004", "F01-POL-CP-005", "F01-POL-CP-006"]);
    expect(evaluation.questions).toEqual([]);
    expect(evaluation.visible_assumptions).toEqual([
      expect.objectContaining({ assumption_id: "currency", classification: "DEFAULT", proposed_default: "TWD", source: "NFF_DEFAULT", source_ref: NFF_POLICY_REF }),
      expect.objectContaining({ assumption_id: "occasion", classification: "FACT", resolved_value: "team dinner" }),
      expect.objectContaining({ assumption_id: "split", classification: "PROPOSAL", proposed_default: "EQUAL", source: "LLM_PROPOSED" })
    ]);
  });

  test("TEST-F01-004 material proposals stay visible while other blockers need clarification", () => {
    const evaluation = evaluateClarificationPolicy(
      startIntentClarification(analysis({ ...spec, missing_fields: [item({ id: "date", required_for_execution: true })] }))
    );

    expect(evaluation.decision).toBe("NEEDS_CLARIFICATION");
    expect(evaluation.visible_assumptions.map((assumption) => [assumption.assumption_id, assumption.classification])).toEqual([
      ["currency", "DEFAULT"],
      ["date", "UNKNOWN"],
      ["occasion", "FACT"],
      ["split", "PROPOSAL"]
    ]);
  });

  test("TEST-F01-004 the resolved_intent gate refuses pending material assumptions until each one is decided", () => {
    const state = startIntentClarification(analysis(spec));
    expect(admitResolvedIntent(state)).toMatchObject({ admitted: false, reason: "MATERIAL_ASSUMPTIONS_PENDING" });

    const merged = submitClarificationAnswers(
      state,
      answersBody([], [{ assumption_id: "split", decision: "ACCEPT" }, { assumption_id: "currency", decision: "EDIT", edited_value: "USD" }])
    );
    const admission = admitResolvedIntent(merged.state);

    expect(findItem(merged.state.envelope, "currency")).toMatchObject({ source: "USER_EXPLICIT", resolved_value: "USD", source_ref: NFF_POLICY_REF });
    expect(admission).toMatchObject({ admitted: true, decision: "READY", unresolved_non_material_item_ids: ["theme"] });
    expect(isResolvedIntentAdmission(admission)).toBe(true);
  });

  test("TEST-F01-004 rejecting a proposal reopens material uncertainty as clarification instead of hiding it", () => {
    const state = startIntentClarification(analysis(spec));
    const merged = submitClarificationAnswers(state, answersBody([], [{ assumption_id: "split", decision: "REJECT" }]));

    expect(findItem(merged.state.envelope, "split")).toMatchObject({ source: "LLM_PROPOSED", resolution_state: "UNRESOLVED", can_default: false });
    expect(findItem(merged.state.envelope, "split")).not.toHaveProperty("proposed_default");
    expect(merged.evaluation.decision).toBe("NEEDS_CLARIFICATION");
    expect(merged.evaluation.questions).toEqual([expect.objectContaining({ semantic_item_ids: ["split"], policy_rule_id: "F01-POL-CP-003A" })]);
  });

  test("TEST-F01-004 only pending DEFAULT / PROPOSAL items accept assumption decisions", () => {
    const state = startIntentClarification(analysis({ ...spec, constraints: [...spec.constraints!, item({ id: "venue" })] }));

    for (const assumptionId of ["occasion", "venue", "missing"]) {
      expect(() => submitClarificationAnswers(state, answersBody([], [{ assumption_id: assumptionId, decision: "ACCEPT" }]))).toThrowError(
        contractError("F01-ERR-003", "ASSUMPTION_NOT_DECIDABLE")
      );
    }
    expect(() =>
      submitClarificationAnswers(state, answersBody([], [{ assumption_id: "split", decision: "EDIT", edited_value: 3 }]))
    ).toThrowError(contractError("F01-ERR-003", "ANSWER_TYPE_MISMATCH"));
  });
});

type ShapeIntent = { readonly intentId: string; readonly version: number; readonly data: Record<string, unknown> };

async function createShapeIntent(h: F01Harness, envelope: StructuredIntentEnvelope = editShapeAnalysis()): Promise<ShapeIntent> {
  h.gateway.queueAnalysis(succeeded(envelope as unknown as JsonValue));
  const response = await h.create("create-shape");
  expect(response.status, JSON.stringify(response.body)).toBe(200);
  const data = dataOf(response);
  return { intentId: String(data.intent_id), version: Number(data.intent_version), data };
}

const assumptionsOf = (data: Record<string, unknown>) => data.visible_assumptions as Record<string, JsonValue>[];
const assumptionOf = (data: Record<string, unknown>, id: string) => assumptionsOf(data).find((entry) => entry.assumption_id === id);
const durableItem = (h: F01Harness, intentId: string, id: string) =>
  findItem(h.db.intents.get(intentId)!.structured_intent as StructuredIntentEnvelope, id);
const decisionsBody = (version: number, decisions: readonly Record<string, JsonValue>[]) => ({ answers: [], assumption_decisions: decisions, intent_version: version });

describe("F01-AC-004 F01-DATA-004A server-authoritative visible assumption edit shape", () => {
  test("TEST-F01-004 every pending DEFAULT / PROPOSAL projects its validated type, question type, choice options and OPEN_JSON_RECORD_V1 exactly", () => {
    const evaluation = evaluateClarificationPolicy(startIntentClarification(editShapeAnalysis()));

    expect(evaluation.decision).toBe("READY_WITH_VISIBLE_ASSUMPTIONS");
    expect(evaluation.questions).toEqual([]);
    expect(JSON.parse(JSON.stringify(evaluation.visible_assumptions))).toStrictEqual(expectedEditShapeAssumptions());
    const byId = new Map(evaluation.visible_assumptions.map((entry) => [entry.assumption_id, entry]));
    expect(byId.get("d_rounding")?.options).toStrictEqual([10, 1, "none"]);
    expect(byId.get("e_add_ons")?.options).toStrictEqual(ADD_ON_OPTIONS);
    for (const id of ["a_title", "b_headcount", "c_tip_included", "f_menu", "g_greeting", "h_theme", "occasion"]) {
      expect(byId.get(id), id).not.toHaveProperty("options");
    }
    for (const id of ["a_title", "b_headcount", "c_tip_included", "d_rounding", "e_add_ons", "g_greeting", "h_theme", "occasion"]) {
      expect(byId.get(id), id).not.toHaveProperty("record_edit_schema");
    }
    for (const id of ["h_theme", "occasion"]) {
      expect(byId.get(id), id).not.toHaveProperty("expected_value_type");
      expect(byId.get(id), id).not.toHaveProperty("question_type");
    }
  });

  test("TEST-F01-004 the real create and answers handlers return the same trusted edit shape and persist a native nested RECORD / LIST / ENUM EDIT as USER_EXPLICIT", async () => {
    const h = createF01Harness();
    const created = await createShapeIntent(h);
    expect(created.data.status).toBe("READY_WITH_VISIBLE_ASSUMPTIONS");
    expect(assumptionsOf(created.data)).toStrictEqual(expectedEditShapeAssumptions());

    const edited = await h.answers(
      created.intentId,
      decisionsBody(created.version, [
        { assumption_id: "f_menu", decision: "EDIT", edited_value: MENU_EDIT },
        { assumption_id: "e_add_ons", decision: "EDIT", edited_value: [0, { item: "cake", size: 6 }] },
        { assumption_id: "d_rounding", decision: "EDIT", edited_value: "none" },
        { assumption_id: "b_headcount", decision: "ACCEPT" }
      ]),
      "answers-edit"
    );
    expect(edited.status, JSON.stringify(edited.body)).toBe(200);
    const afterEdit = dataOf(edited);
    expect(afterEdit).toMatchObject({ status: "READY_WITH_VISIBLE_ASSUMPTIONS", intent_version: created.version + 1 });
    for (const id of ["a_title", "c_tip_included", "g_greeting"]) {
      expect(assumptionOf(afterEdit, id), id).toStrictEqual(assumptionOf(created.data, id));
    }
    expect(assumptionOf(afterEdit, "f_menu")).toStrictEqual({
      assumption_id: "f_menu",
      classification: "FACT",
      description: "Decide f_menu",
      materiality: "MATERIAL",
      impact_level: "MEDIUM",
      source: "USER_EXPLICIT",
      resolved_value: MENU_EDIT
    });
    expect(assumptionOf(afterEdit, "b_headcount")).toBeUndefined();

    expect(durableItem(h, created.intentId, "f_menu")).toMatchObject({ source: "USER_EXPLICIT", resolution_state: "CONFIRMED", can_default: false });
    expect(durableItem(h, created.intentId, "f_menu").resolved_value).toStrictEqual(MENU_EDIT);
    expect(durableItem(h, created.intentId, "f_menu")).not.toHaveProperty("proposed_default");
    expect(durableItem(h, created.intentId, "e_add_ons").resolved_value).toStrictEqual([0, { item: "cake", size: 6 }]);
    expect(durableItem(h, created.intentId, "d_rounding")).toMatchObject({ source: "USER_EXPLICIT", resolved_value: "none", source_ref: NFF_POLICY_REF });
    expect(durableItem(h, created.intentId, "b_headcount")).toMatchObject({ source: "NFF_DEFAULT", resolved_value: 8, source_ref: NFF_POLICY_REF });

    const finished = dataOf(
      await h.answers(
        created.intentId,
        decisionsBody(created.version + 1, [
          { assumption_id: "a_title", decision: "ACCEPT" },
          { assumption_id: "c_tip_included", decision: "EDIT", edited_value: true },
          { assumption_id: "g_greeting", decision: "ACCEPT" }
        ]),
        "answers-finish"
      )
    );
    expect(finished.status).toBe("READY");
    expect(assumptionsOf(finished).filter((entry) => entry.classification === "DEFAULT" || entry.classification === "PROPOSAL")).toEqual([]);
    expect(durableItem(h, created.intentId, "a_title")).toMatchObject({ source: "USER_ACCEPTED_PROPOSAL", resolved_value: "Team dinner split" });
    expect(durableItem(h, created.intentId, "c_tip_included")).toMatchObject({ source: "USER_EXPLICIT", resolved_value: true });
    expect(h.db.intents.get(created.intentId)?.lifecycle_status).toBe("READY");
  });
});

describe("F01-AC-004 F01-DATA-004A invalid edits and malformed edit-shape metadata fail closed", () => {
  test("TEST-F01-004 EDIT values outside the projected shape are F01-ERR-003 without coercion or mutation, and a valid retry recovers", async () => {
    const h = createF01Harness();
    const created = await createShapeIntent(h);
    const invalid: readonly (readonly [string, JsonValue])[] = [
      ["b_headcount", "12"],
      ["c_tip_included", "true"],
      ["a_title", 7],
      ["d_rounding", "10"],
      ["d_rounding", 5],
      ["e_add_ons", ["drinks", "drinks"]],
      ["e_add_ons", ["wine"]],
      ["e_add_ons", "drinks"],
      ["f_menu", JSON.stringify(MENU_PROPOSAL)],
      ["f_menu", [MENU_PROPOSAL]],
      ["f_menu", 3]
    ];
    const before = structuredClone(h.db.intents.get(created.intentId));
    for (const [index, [id, value]] of invalid.entries()) {
      const response = await h.answers(created.intentId, decisionsBody(created.version, [{ assumption_id: id, decision: "EDIT", edited_value: value }]), `bad-${index}`);
      expect(response.status, `${id} ${JSON.stringify(value)}`).toBe(400);
      expect(errorOf(response)).toMatchObject({ code: "F01-ERR-003", details: { violations: [{ path: "$.assumption_decisions[0].edited_value", reason: "ANSWER_TYPE_MISMATCH" }] } });
    }
    expect(h.db.intents.get(created.intentId)).toEqual(before);

    const recovered = await h.answers(created.intentId, decisionsBody(created.version, [{ assumption_id: "f_menu", decision: "EDIT", edited_value: { only_key: [] } }]), "good-retry");
    expect(recovered.status, JSON.stringify(recovered.body)).toBe(200);
    expect(durableItem(h, created.intentId, "f_menu").resolved_value).toStrictEqual({ only_key: [] });
  });

  test("TEST-F01-004 missing, mismatched or inconsistent edit-shape metadata fails closed and never yields READY_WITH_VISIBLE_ASSUMPTIONS", async () => {
    const malformed: readonly Record<string, JsonValue>[] = [
      { expected_value_type: "ENUM", question_type: "FREE_TEXT" },
      { expected_value_type: "RECORD", question_type: "MULTI_CHOICE" },
      { expected_value_type: "ENUM", question_type: "SINGLE_CHOICE", alternatives: ["only", "only"] },
      { expected_value_type: "LIST", question_type: "MULTI_CHOICE", alternatives: ["x", "y"], proposed_default: ["z"] }
    ];
    for (const [index, patch] of malformed.entries()) {
      const h = createF01Harness();
      const output = { ...editShapeAnalysis(), assumptions: [{ ...SIX_TYPE_ASSUMPTIONS[0], ...patch }] } as unknown as JsonValue;
      h.gateway.queueAnalysis(succeeded(output), succeeded(output));
      const response = await h.create(`create-malformed-${index}`);
      expect([response.status, errorOf(response).code], JSON.stringify(patch)).toEqual([502, "F01-ERR-002"]);
      expect(JSON.stringify(response.body)).not.toContain("READY_WITH_VISIBLE_ASSUMPTIONS");
      expect([...h.db.intents.values()].map((intent) => intent.lifecycle_status)).toEqual(["ANALYSIS_FAILED"]);
    }

    const h = createF01Harness();
    const created = await createShapeIntent(h);
    const stored = h.db.intents.get(created.intentId)!;
    const envelope = stored.structured_intent as StructuredIntentEnvelope;
    stored.structured_intent = {
      ...envelope,
      assumptions: envelope.assumptions.map((entry) => (entry.id === "d_rounding" ? { ...entry, question_type: "FREE_TEXT" } : entry))
    };
    const before = structuredClone(stored);
    const response = await h.answers(created.intentId, decisionsBody(created.version, [{ assumption_id: "a_title", decision: "ACCEPT" }]), "answers-corrupt");
    expect([response.status, errorOf(response)]).toEqual([
      500,
      { code: "F01-ERR-014", message_key: "recovery.f01.internal_invariant", retryable: false, retry_after_seconds: null, details: {} }
    ]);
    expect(h.db.intents.get(created.intentId)).toEqual(before);
    expect(h.db.operationFor("POST /api/v1/intents/{intent_id}/answers", "answers-corrupt")).toMatchObject({ status: "FAILED_TERMINAL", error_code: "F01-ERR-014" });
  });
});

const tipPolicy = item({
  id: "tip_policy",
  impact_level: "HIGH",
  question_type: "SINGLE_CHOICE",
  expected_value_type: "ENUM",
  alternatives: ["none", "10%"],
  depends_on_ids: ["region"]
});
const blockers: EnvelopeSpec = {
  known_inputs: [knownInput({ id: "venue", value: "Taipei" })],
  constraints: [item({ id: "region", resolution_state: "CONFIRMED", resolved_value: "TW", depends_on_ids: ["venue"] })],
  ambiguities: [tipPolicy],
  missing_fields: [item({ id: "x_field", required_for_execution: true }), item({ id: "y_field", required_for_execution: true })],
  assumptions: [confirmed({ id: "theme", materiality: "COSMETIC", resolved_value: "dark" })]
};
const tipQuestionId = questionIdFor("F01-POL-CP-002", ["tip_policy"]);
const askedItems = (state: TrustedIntentState) => evaluateClarificationPolicy(state).questions.map((question) => question.semantic_item_ids[0]);

describe("F01-AC-005 answered questions are not re-asked unless an upstream condition changed", () => {
  const restored = (changed: string[]) =>
    restoreTrustedIntentState(persisted(blockers, { answered_question_ids: [tipQuestionId], changed_semantic_item_ids: changed }));

  test("TEST-F01-005 an answered question stays suppressed when nothing or only an unrelated item changed", () => {
    expect(askedItems(restored([]))).toEqual(["x_field", "y_field"]);
    expect(askedItems(restored(["theme", "y_field"]))).toEqual(["x_field", "y_field"]);
  });

  test("TEST-F01-005 a change to the target or its recursive depends_on_ids closure reopens the question", () => {
    for (const changed of [["tip_policy"], ["region"], ["venue"]]) {
      const reopened = evaluateClarificationPolicy(restored(changed)).questions.find((question) => question.question_id === tipQuestionId);
      expect(reopened).toMatchObject({ semantic_item_ids: ["tip_policy"], policy_rule_id: "F01-POL-CP-002", options: ["none", "10%"] });
    }
  });

  test("TEST-F01-005 the changed set is a single-evaluation input and the next merge suppresses the question again", () => {
    const reopened = restored(["venue"]);
    expect(askedItems(reopened)).toEqual(["x_field", "y_field", "tip_policy"]);

    const next = submitClarificationAnswers(reopened, answersBody([{ question_id: questionFor(reopened, "x_field").question_id, value: "x" }]));

    expect(next.state.envelope.analysis_metadata.clarification_policy_state.changed_semantic_item_ids).toEqual(["x_field"]);
    expect(next.evaluation.questions.map((question) => question.semantic_item_ids[0])).toEqual(["y_field"]);
  });

  test("TEST-F01-005 a reopened question ranks below an otherwise identical question that was never asked", () => {
    const twin = { ...tipPolicy, id: "tip_policy_twin" };
    const state = restoreTrustedIntentState(
      persisted({ ...blockers, missing_fields: [], ambiguities: [twin, tipPolicy] }, { answered_question_ids: [tipQuestionId], changed_semantic_item_ids: ["venue"] })
    );
    expect(askedItems(state)).toEqual(["tip_policy_twin", "tip_policy"]);
  });

  test("TEST-F01-005 an end-to-end clarification round never re-asks answered questions", () => {
    const missing = ["a_field", "b_field", "c_field", "d_field"].map((id) => item({ id, required_for_execution: true }));
    const state = startIntentClarification(analysis({ missing_fields: missing }));
    const first = evaluateClarificationPolicy(state).questions;
    expect(first.map((question) => question.semantic_item_ids[0])).toEqual(["a_field", "b_field", "c_field"]);

    const merged = submitClarificationAnswers(state, answersBody(first.map((question) => ({ question_id: question.question_id, value: "ok" }))));

    expect(merged.evaluation.questions.map((question) => question.semantic_item_ids[0])).toEqual(["d_field"]);
    expect(merged.state.envelope.analysis_metadata.clarification_policy_state.answered_question_ids).toEqual(
      first.map((question) => question.question_id).sort()
    );
  });

  test("TEST-F01-005 a suppressed blocker whose truth is still unresolved fails as F01-ERR-014 instead of zero questions", () => {
    const onlyTip = restoreTrustedIntentState(
      persisted({ ...blockers, missing_fields: [] }, { answered_question_ids: [tipQuestionId], changed_semantic_item_ids: [] })
    );
    expect(() => evaluateClarificationPolicy(onlyTip)).toThrowError(contractError("F01-ERR-014", "SUPPRESSED_BLOCKER_UNRESOLVED"));
  });
});

describe("F01-AC-005 a real re-analysis of a same-ID DOMAIN_KNOWN upstream fact reopens only dependent answered questions", () => {
  const domainVenue = (value: string) => knownInput({ id: "venue", value, source: "DOMAIN_KNOWN" });
  const domainSpec = (venue: string, overrides: EnvelopeSpec = {}, note = "n1"): EnvelopeSpec => ({
    ...blockers,
    known_inputs: [domainVenue(venue), knownInput({ id: "payer", value: "Alice" }), knownInput({ id: "note", value: note, source: "DOMAIN_KNOWN" })],
    ...overrides
  });
  const changedIds = (state: TrustedIntentState) => state.envelope.analysis_metadata.clarification_policy_state.changed_semantic_item_ids;
  const inputOf = (state: TrustedIntentState, id: string) => state.envelope.known_inputs.find((input) => input.id === id);

  test("TEST-F01-005 a real re-analysis refreshes a same-ID DOMAIN_KNOWN fact into canonical truth and the changed set without touching User truth", () => {
    const state = startIntentClarification(analysis(domainSpec("Taipei")));
    const answered = submitClarificationAnswers(state, answersBody([{ question_id: tipQuestionId, value: "10%" }]));

    const moved = mergeReanalysis(answered.state, analysis(domainSpec("Tokyo")));
    expect(inputOf(moved.state, "venue")).toEqual(domainVenue("Tokyo"));
    expect(changedIds(moved.state)).toEqual(["venue"]);
    expect(moved.state.envelope.analysis_metadata.clarification_policy_state.answered_question_ids).toEqual([tipQuestionId]);
    expect(findItem(moved.state.envelope, "tip_policy")).toMatchObject({ source: "USER_EXPLICIT", resolved_value: "10%" });
    expect(moved.evaluation.questions.map((question) => question.semantic_item_ids[0])).toEqual(["x_field", "y_field"]);

    expect(changedIds(mergeReanalysis(answered.state, analysis(domainSpec("Taipei"))).state)).toEqual([]);
    expect(changedIds(mergeReanalysis(answered.state, analysis(domainSpec("Taipei", {}, "n2"))).state)).toEqual(["note"]);

    const conflicting = mergeReanalysis(
      answered.state,
      analysis(
        domainSpec("Taipei", {
          known_inputs: [domainVenue("Taipei"), knownInput({ id: "payer", value: "Bob", source: "DOMAIN_KNOWN" })],
          ambiguities: [{ ...tipPolicy, resolution_state: "CONFIRMED", resolved_value: "none" }]
        })
      )
    );
    expect(inputOf(conflicting.state, "payer")).toEqual(knownInput({ id: "payer", value: "Alice" }));
    expect(findItem(conflicting.state.envelope, "tip_policy")).toMatchObject({ source: "USER_EXPLICIT", resolved_value: "10%" });
    expect(changedIds(conflicting.state)).toEqual([]);
  });

  test("TEST-F01-005 a real DOMAIN_KNOWN upstream re-analysis change reopens the answered downstream question; same value or unrelated change does not", () => {
    const trusted = restoreTrustedIntentState(persisted(domainSpec("Taipei"), { answered_question_ids: [tipQuestionId] }));
    expect(askedItems(trusted)).toEqual(["x_field", "y_field"]);

    const moved = mergeReanalysis(trusted, analysis(domainSpec("Tokyo")));
    expect(inputOf(moved.state, "venue")).toEqual(domainVenue("Tokyo"));
    expect(changedIds(moved.state)).toEqual(["venue"]);
    expect(moved.evaluation.questions.map((question) => question.semantic_item_ids[0])).toEqual(["x_field", "y_field", "tip_policy"]);
    expect(moved.evaluation.questions[2]).toMatchObject({ question_id: tipQuestionId, policy_rule_id: "F01-POL-CP-002" });

    const settled = mergeReanalysis(moved.state, analysis(domainSpec("Tokyo")));
    expect(changedIds(settled.state)).toEqual([]);
    expect(settled.evaluation.questions.map((question) => question.semantic_item_ids[0])).toEqual(["x_field", "y_field"]);

    for (const [spec, changed] of [
      [domainSpec("Taipei"), []],
      [domainSpec("Taipei", {}, "n2"), ["note"]],
      [domainSpec("Taipei", { known_inputs: [domainVenue("Taipei"), knownInput({ id: "payer", value: "Bob", source: "DOMAIN_KNOWN" })] }), []]
    ] as const) {
      const merged = mergeReanalysis(trusted, analysis(spec));
      expect(changedIds(merged.state)).toEqual(changed);
      expect(inputOf(merged.state, "payer")).toEqual(knownInput({ id: "payer", value: "Alice" }));
      expect(merged.evaluation.questions.map((question) => question.semantic_item_ids[0])).toEqual(["x_field", "y_field"]);
    }
  });

  test("TEST-F01-005 a refreshed policy-visible DOMAIN_KNOWN fact reopens its dependents, while analysis cannot retract it", () => {
    const region = (resolved_value: string) => item({ id: "region", resolution_state: "CONFIRMED", resolved_value, depends_on_ids: ["venue"] });
    const trusted = restoreTrustedIntentState(persisted(domainSpec("Taipei"), { answered_question_ids: [tipQuestionId] }));

    const moved = mergeReanalysis(trusted, analysis(domainSpec("Taipei", { constraints: [region("JP")] })));
    expect(findItem(moved.state.envelope, "region")).toEqual(region("JP"));
    expect(changedIds(moved.state)).toEqual(["region"]);
    expect(moved.evaluation.questions.map((question) => question.question_id)).toContain(tipQuestionId);

    const retracted = mergeReanalysis(trusted, analysis(domainSpec("Taipei", { constraints: [item({ id: "region", depends_on_ids: ["venue"] })] })));
    expect(findItem(retracted.state.envelope, "region")).toEqual(region("TW"));
    expect(changedIds(retracted.state)).toEqual([]);
    expect(retracted.evaluation.questions.map((question) => question.question_id)).not.toContain(tipQuestionId);
  });
});

describe("F01-AC-006 same Envelope + policy version yields the same decision", () => {
  const spec: EnvelopeSpec = {
    known_inputs: [knownInput({ id: "venue" })],
    missing_fields: [item({ id: "m_exec", required_for_execution: true, impact_level: "CRITICAL" })],
    ambiguities: [item({ id: "m_div", impact_level: "HIGH", alternatives: ["a", "b"] })],
    candidate_rules: [
      item({ id: "m_perm", policy_risk_flags: ["PERMISSION"], impact_level: "LOW" }),
      item({ id: "c_high", impact_level: "HIGH" }),
      item({ id: "c_dep", depends_on_ids: ["venue"] }),
      item({ id: "child", depends_on_ids: ["c_dep"] }),
      item({ id: "c_b" }),
      item({ id: "c_a" })
    ],
    assumptions: [llmProposal({ id: "split", proposed_default: "EQUAL" })]
  };
  const reversed = (envelope: StructuredIntentEnvelope): StructuredIntentEnvelope => ({
    ...envelope,
    known_inputs: [...envelope.known_inputs].reverse(),
    constraints: [...envelope.constraints].reverse(),
    candidate_rules: [...envelope.candidate_rules].reverse(),
    missing_fields: [...envelope.missing_fields].reverse(),
    ambiguities: [...envelope.ambiguities].reverse(),
    assumptions: [...envelope.assumptions].reverse()
  });

  test("TEST-F01-006 repeated evaluation and repeated restore of the same persisted Envelope are identical", () => {
    const document = persisted(spec);
    const state = restoreTrustedIntentState(document);
    const first = evaluateClarificationPolicy(state);

    expect(evaluateClarificationPolicy(state)).toEqual(first);
    expect(evaluateClarificationPolicy(restoreTrustedIntentState(JSON.parse(JSON.stringify(document))))).toEqual(first);
    expect(evaluateClarificationPolicy(restoreTrustedIntentState(reversed(document)))).toEqual(first);
    expect(first.policy_version).toBe(F01_CLARIFICATION_POLICY_VERSION);
  });

  test("TEST-F01-006 ranking is lexicographic over policy tier, impact, requirement, downstream unknowns and stable ID", () => {
    const evaluation = evaluateClarificationPolicy(startIntentClarification(analysis(spec)));
    expect(evaluation.questions.map((question) => question.semantic_item_ids[0])).toEqual(["m_perm", "m_exec", "m_div"]);
    expect(evaluation.triggered_rule_ids).toEqual(["F01-POL-CP-003", "F01-POL-CP-001", "F01-POL-CP-002", "F01-POL-CP-003A", "F01-POL-CP-004"]);

    const coreOnly = evaluateClarificationPolicy(startIntentClarification(analysis({ ...spec, missing_fields: [], ambiguities: [], candidate_rules: spec.candidate_rules!.slice(1) })));
    expect(coreOnly.questions.map((question) => question.semantic_item_ids[0])).toEqual(["c_high", "c_dep", "c_a"]);
  });

  test("TEST-F01-006 question identity depends only on policy_rule_id and target ID, never on prompt wording", () => {
    const wording = (description: string) =>
      evaluateClarificationPolicy(startIntentClarification(analysis({ missing_fields: [item({ id: "date", description, required_for_execution: true })] }))).questions[0]!;

    expect(wording("When is dinner?").question_id).toBe(wording("請問聚餐日期？").question_id);
    expect(wording("When is dinner?").question_id).toBe(questionIdFor("F01-POL-CP-001", ["date"]));
    expect(questionIdFor("F01-POL-CP-001", ["date"])).not.toBe(questionIdFor("F01-POL-CP-003A", ["date"]));
  });
});

describe("F01-AC-017 Client cannot bypass the policy with resolved_intent or server-owned state", () => {
  const ready = () => startIntentClarification(analysis({ constraints: [confirmed({ id: "occasion", resolved_value: "dinner" })] }));
  const blocked = () => startIntentClarification(analysis({ missing_fields: [item({ id: "date", required_for_execution: true })] }));

  test("TEST-F01-SEC-007 answer submissions carrying resolved / policy state are F01-ERR-001", () => {
    const state = blocked();
    const questionId = questionFor(state, "date").question_id;
    const forged = {
      resolved_intent: { goal: "dinner" },
      resolved_value: "2026-10-10",
      answered_question_ids: [questionId],
      changed_semantic_item_ids: ["date"],
      clarification_policy_state: { answered_question_ids: [questionId] },
      structured_intent: {}
    };
    for (const [field, value] of Object.entries(forged)) {
      expect(() => submitClarificationAnswers(state, { ...answersBody([]), [field]: value })).toThrowError(
        contractError("F01-ERR-001", "SERVER_OWNED_FIELD")
      );
    }
    expect(() =>
      submitClarificationAnswers(state, answersBody([{ question_id: questionId, value: "2026-10-10", resolved_value: "x" } as never]))
    ).toThrowError(contractError("F01-ERR-001", "SERVER_OWNED_FIELD"));
    expect(evaluateClarificationPolicy(state).decision).toBe("NEEDS_CLARIFICATION");
  });

  test("TEST-F01-SEC-007 compile requests cannot carry resolved_intent or a claimed decision", () => {
    for (const field of ["resolved_intent", "status", "triggered_rule_ids"]) {
      expect(() => parseCompileRequest({ intent_version: 4, [field]: "READY" })).toThrowError(contractError("F01-ERR-001", "SERVER_OWNED_FIELD"));
    }
    expect(parseCompileRequest({ intent_version: 4, client_context: { locale: "zh-TW" } })).toEqual({
      intent_version: 4,
      source_blueprint_hash: null,
      client_context: { locale: "zh-TW" }
    });
  });

  test("TEST-F01-SEC-007 the resolved_intent gate admits only server-sealed READY state", () => {
    const sealed = ready();
    const copies: unknown[] = [JSON.parse(JSON.stringify(sealed)), structuredClone(sealed), { ...sealed }, { envelope: sealed.envelope }];
    for (const copy of copies) {
      expect(() => admitResolvedIntent(copy as TrustedIntentState)).toThrowError(contractError("F01-ERR-014", "UNTRUSTED_CLARIFICATION_STATE"));
    }
    expect(admitResolvedIntent(blocked())).toMatchObject({ admitted: false, decision: "NEEDS_CLARIFICATION", reason: "CLARIFICATION_REQUIRED" });

    const admission = admitResolvedIntent(sealed);
    expect(isResolvedIntentAdmission(admission)).toBe(true);
    expect(isResolvedIntentAdmission({ ...admission })).toBe(false);
    expect(Object.isFrozen(sealed.envelope.analysis_metadata.clarification_policy_state)).toBe(true);
  });

  test("TEST-F01-SEC-007 Prompt A output cannot seed server-owned policy state or claim User decisions", () => {
    const withState = persisted({ missing_fields: [item({ id: "date", required_for_execution: true })] }, { answered_question_ids: [questionIdFor("F01-POL-CP-001", ["date"])] });
    expect(() => startIntentClarification(withState)).toThrowError(contractError("F01-ERR-002", "SERVER_OWNED_POLICY_STATE"));
    expect(() =>
      startIntentClarification(analysis({ assumptions: [item({ id: "split", source: "USER_ACCEPTED_PROPOSAL", resolution_state: "CONFIRMED", resolved_value: "EQUAL" })] }))
    ).toThrowError(contractError("F01-ERR-002", "USER_DECISION_NOT_ASSERTABLE_BY_ANALYSIS"));
    expect(() =>
      startIntentClarification(analysis({ assumptions: [nffDefault({ id: "currency", proposed_default: "TWD", resolution_state: "CONFIRMED", resolved_value: "TWD", can_default: false })] }))
    ).toThrowError(contractError("F01-ERR-002"));
  });

  test("TEST-F01-SEC-007 answers must target a currently emitted question and caller mutation never reaches sealed state", () => {
    const input = analysis({ missing_fields: [item({ id: "date", required_for_execution: true })] });
    const state = startIntentClarification(input);
    (input.missing_fields as unknown as unknown[]).length = 0;

    expect(evaluateClarificationPolicy(state).decision).toBe("NEEDS_CLARIFICATION");
    expect(() => submitClarificationAnswers(state, answersBody([{ question_id: questionIdFor("F01-POL-CP-003A", ["date"]), value: "x" }]))).toThrowError(
      contractError("F01-ERR-003", "QUESTION_NOT_ELIGIBLE")
    );
    expect(() => submitClarificationAnswers(state, answersBody([{ question_id: questionFor(state, "date").question_id, value: 7 }]))).toThrowError(
      contractError("F01-ERR-003", "ANSWER_TYPE_MISMATCH")
    );
  });
});
