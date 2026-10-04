import { describe, expect, test } from "vitest";

import { evaluateClarificationPolicy } from "../../src/platform/intent/clarification-policy.js";
import { collectEnvelopeViolations } from "../../src/platform/intent/envelope-validation.js";
import {
  INTENT_SOURCES,
  POLICY_ITEM_COLLECTIONS,
  RESOLUTION_STATES,
  type PolicyItemCollection,
  type PolicyVisibleItem
} from "../../src/platform/intent/intent-contract.js";
import { restoreTrustedIntentState, startIntentClarification } from "../../src/platform/intent/intent-state.js";
import { admitResolvedIntent } from "../../src/platform/intent/resolved-intent-gate.js";
import { NFF_POLICY_REF, analysis, confirmed, item, knownInput, llmProposal, nffDefault, persisted } from "../contract/intent-envelope-fixtures.js";

const reasonsOf = (candidate: PolicyVisibleItem, trust: "UNTRUSTED_ANALYSIS" | "TRUSTED" = "UNTRUSTED_ANALYSIS") =>
  collectEnvelopeViolations(trust === "TRUSTED" ? persisted({ constraints: [candidate] }) : analysis({ constraints: [candidate] }), trust).map(
    (violation) => violation.reason
  );

describe("BF-045 state / value / source invariants run before policy evaluation", () => {
  const invalid: readonly [string, PolicyVisibleItem, string][] = [
    ["UNRESOLVED + can_default=true", item({ id: "x", can_default: true }), "CAN_DEFAULT_ONLY_FOR_PROPOSED"],
    ["DOMAIN_KNOWN + PROPOSED", item({ id: "x", resolution_state: "PROPOSED", proposed_default: "v" }), "PROPOSED_SOURCE_NOT_ALLOWED"],
    ["CONFIRMED without resolved_value", item({ id: "x", resolution_state: "CONFIRMED" }), "CONFIRMED_REQUIRES_RESOLVED_VALUE"],
    ["CONFIRMED with proposed_default", confirmed({ id: "x", resolved_value: "v", proposed_default: "w" }), "PROPOSED_DEFAULT_ONLY_FOR_PROPOSED"],
    ["CONFIRMED + can_default=true", confirmed({ id: "x", resolved_value: "v", can_default: true }), "CAN_DEFAULT_ONLY_FOR_PROPOSED"],
    ["UNRESOLVED with resolved_value", item({ id: "x", resolved_value: "v" }), "RESOLVED_VALUE_ONLY_FOR_CONFIRMED"],
    ["PROPOSED without proposed_default", item({ id: "x", source: "LLM_PROPOSED", resolution_state: "PROPOSED" }), "PROPOSED_REQUIRES_PROPOSED_DEFAULT"],
    ["PROPOSED with resolved_value", llmProposal({ id: "x", proposed_default: "v", resolved_value: "v" }), "RESOLVED_VALUE_ONLY_FOR_CONFIRMED"],
    ["USER_EXPLICIT not CONFIRMED", item({ id: "x", source: "USER_EXPLICIT" }), "USER_SOURCE_MUST_BE_CONFIRMED"],
    ["LLM_PROPOSED as CONFIRMED truth", item({ id: "x", source: "LLM_PROPOSED", resolution_state: "CONFIRMED", resolved_value: "v" }), "LLM_PROPOSAL_IS_NEVER_CONFIRMED_TRUTH"],
    ["resolved_value of the wrong type", confirmed({ id: "x", resolved_value: 3 }), "RESOLVED_VALUE_SHAPE_MISMATCH"],
    ["proposed_default outside alternatives", llmProposal({ id: "x", question_type: "SINGLE_CHOICE", expected_value_type: "ENUM", alternatives: ["a", "b"], proposed_default: "c" }), "PROPOSED_DEFAULT_SHAPE_MISMATCH"],
    ["question / value type mismatch", item({ id: "x", question_type: "NUMBER" }), "QUESTION_VALUE_TYPE_MISMATCH"],
    ["choice with < 2 distinct alternatives", item({ id: "x", question_type: "MULTI_CHOICE", expected_value_type: "LIST", alternatives: ["a", "a"] }), "AT_LEAST_TWO_DISTINCT_ALTERNATIVES_REQUIRED"],
    ["COSMETIC risk item", item({ id: "x", materiality: "COSMETIC", policy_risk_flags: ["MONEY"] }), "RISK_ITEM_MUST_BE_MATERIAL"],
    ["COSMETIC required item", item({ id: "x", materiality: "COSMETIC", required_for_execution: true }), "COSMETIC_CANNOT_BE_REQUIRED"],
    ["NFF_DEFAULT without policy provenance", llmProposal({ id: "x", source: "NFF_DEFAULT", proposed_default: "v" }), "NFF_DEFAULT_POLICY_PROVENANCE_REQUIRED"],
    ["self dependency", item({ id: "x", depends_on_ids: ["x"] }), "SELF_DEPENDENCY"],
    ["unknown dependency", item({ id: "x", depends_on_ids: ["ghost"] }), "UNKNOWN_DEPENDENCY"]
  ];

  for (const [label, candidate, reason] of invalid) {
    test(`${label} is rejected as F01-ERR-002 analysis and F01-ERR-014 persisted state`, () => {
      expect(reasonsOf(candidate)).toContain(reason);
      expect(reasonsOf(candidate, "TRUSTED")).toContain(reason);
      expect(() => startIntentClarification(analysis({ constraints: [candidate] }))).toThrowError(expect.objectContaining({ code: "F01-ERR-002" }));
      expect(() => restoreTrustedIntentState(persisted({ constraints: [candidate] }))).toThrowError(expect.objectContaining({ code: "F01-ERR-014" }));
    });
  }

  test("ambiguities need two distinct interpretations, IDs are unique across inputs and items, and graphs are acyclic", () => {
    expect(collectEnvelopeViolations(analysis({ ambiguities: [item({ id: "a", alternatives: ["only"] })] }), "UNTRUSTED_ANALYSIS")).toContainEqual(
      expect.objectContaining({ reason: "AT_LEAST_TWO_DISTINCT_ALTERNATIVES_REQUIRED" })
    );
    expect(collectEnvelopeViolations(analysis({ known_inputs: [knownInput({ id: "a" })], constraints: [item({ id: "a" })] }), "UNTRUSTED_ANALYSIS")).toContainEqual(
      expect.objectContaining({ reason: "DUPLICATE_SEMANTIC_ID" })
    );
    const cycle = analysis({ constraints: [item({ id: "a", depends_on_ids: ["b"] }), item({ id: "b", depends_on_ids: ["a"] })] });
    expect(collectEnvelopeViolations(cycle, "UNTRUSTED_ANALYSIS").map((violation) => violation.reason)).toEqual(["DEPENDENCY_CYCLE", "DEPENDENCY_CYCLE"]);
  });

  test("non-JSON values, unknown fields and a missing or foreign server policy state are rejected", () => {
    const withFunction = { ...analysis(), goal: () => "x" };
    expect(collectEnvelopeViolations(withFunction, "UNTRUSTED_ANALYSIS")).toEqual([{ path: "$", reason: "NON_JSON_VALUE" }]);
    expect(collectEnvelopeViolations({ ...analysis(), user_explicit_values: {} }, "UNTRUSTED_ANALYSIS")).toContainEqual(
      expect.objectContaining({ reason: "UNKNOWN_FIELD" })
    );
    expect(collectEnvelopeViolations(analysis(), "TRUSTED")).toContainEqual(expect.objectContaining({ reason: "CLARIFICATION_POLICY_STATE_REQUIRED" }));
    expect(collectEnvelopeViolations(persisted({}, { policy_version: "other" }), "TRUSTED")).toContainEqual(
      expect.objectContaining({ reason: "UNSUPPORTED_POLICY_VERSION" })
    );
  });

  test("accepted values live only in resolved_value: no parallel answer-value sidecar is accepted anywhere", () => {
    const itemWithSidecar = { ...confirmed({ id: "x", resolved_value: "v" }), user_explicit_values: { x: "v" } } as unknown as PolicyVisibleItem;
    expect(reasonsOf(itemWithSidecar, "TRUSTED")).toContain("UNKNOWN_FIELD");
    const metadataSidecar = persisted({});
    const state = metadataSidecar.analysis_metadata.clarification_policy_state as unknown as Record<string, unknown>;
    expect(
      collectEnvelopeViolations(
        { ...metadataSidecar, analysis_metadata: { clarification_policy_state: { ...state, user_explicit_values: {} } } },
        "TRUSTED"
      )
    ).toContainEqual(expect.objectContaining({ reason: "UNKNOWN_FIELD" }));
  });
});

describe("BF-044 policy totality over every valid single-item state", () => {
  const VALUES = { CONFIRMED: { resolved_value: "a" }, PROPOSED: { proposed_default: "a" }, UNRESOLVED: {} } as const;

  const VARIANTS = ["material", "risk", "required", "cosmetic"] as const;

  function candidates(): [PolicyItemCollection, PolicyVisibleItem][] {
    const axes = POLICY_ITEM_COLLECTIONS.flatMap((collection) =>
      INTENT_SOURCES.flatMap((source) =>
        RESOLUTION_STATES.flatMap((state) =>
          [true, false].flatMap((canDefault) =>
            VARIANTS.flatMap((variant) => (["LOW", "HIGH"] as const).map((impact) => ({ collection, source, state, canDefault, variant, impact })))
          )
        )
      )
    );
    return axes.map(({ collection, source, state, canDefault, variant, impact }) => [
      collection,
      item({
        id: "x",
        source,
        ...(source === "NFF_DEFAULT" ? { source_ref: { ...NFF_POLICY_REF } } : {}),
        resolution_state: state,
        ...VALUES[state],
        can_default: canDefault,
        materiality: variant === "cosmetic" ? "COSMETIC" : "MATERIAL",
        policy_risk_flags: variant === "risk" ? ["MONEY"] : [],
        required_for_execution: variant === "required",
        impact_level: impact,
        alternatives: ["a", "b"]
      })
    ]);
  }

  test("each valid state yields exactly one locked outcome and READY never hides unresolved MATERIAL truth", () => {
    let valid = 0;
    for (const [collection, candidate] of candidates()) {
      const document = persisted({ [collection]: [candidate] });
      if (collectEnvelopeViolations(document, "TRUSTED").length > 0) continue;
      valid += 1;
      const evaluation = evaluateClarificationPolicy(restoreTrustedIntentState(document));
      const unresolvedMaterial = candidate.materiality === "MATERIAL" && candidate.resolution_state !== "CONFIRMED";

      if (evaluation.decision === "NEEDS_CLARIFICATION") expect(evaluation.questions).toHaveLength(1);
      else expect(evaluation.questions).toEqual([]);
      if (evaluation.decision === "READY_WITH_VISIBLE_ASSUMPTIONS") {
        expect(evaluation.triggered_rule_ids).toEqual(["F01-POL-CP-004"]);
        expect(evaluation.visible_assumptions).toEqual([expect.objectContaining({ assumption_id: "x", proposed_default: "a" })]);
      }
      if (evaluation.decision === "READY") expect(unresolvedMaterial).toBe(false);
      if (candidate.policy_risk_flags.length > 0 && candidate.source !== "USER_EXPLICIT") expect(evaluation.decision).toBe("NEEDS_CLARIFICATION");
      expect(admitResolvedIntent(restoreTrustedIntentState(document)).admitted).toBe(evaluation.decision === "READY");
    }
    expect(valid).toBeGreaterThan(100);
  });

  test("a READY_WITH_VISIBLE_ASSUMPTIONS state can only be reached from CP-004 safe material proposals", () => {
    const evaluation = evaluateClarificationPolicy(
      startIntentClarification(analysis({ assumptions: [nffDefault({ id: "a", proposed_default: "x" }), llmProposal({ id: "b", proposed_default: "y", materiality: "COSMETIC" })] }))
    );
    expect(evaluation.decision).toBe("READY_WITH_VISIBLE_ASSUMPTIONS");
    expect(evaluation.triggered_rule_ids).toEqual(["F01-POL-CP-004", "F01-POL-CP-005"]);
  });
});
