import type { PolicyVisibleItem, StructuredIntentEnvelope } from "../../src/platform/intent/intent-contract.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";
import { NFF_POLICY_REF, analysis, confirmed, item, llmProposal, nffDefault, type EnvelopeSpec } from "./intent-envelope-fixtures.js";

/** F01-DATA-004A literal RECORD descriptor, written out from the locked contract rather than imported. */
export const OPEN_RECORD_DESCRIPTOR = Object.freeze({ kind: "OPEN_JSON_RECORD_V1", key_policy: "USER_DEFINED", value_kind: "JSON_VALUE", nested: true });

/** Mixed native scalar alternatives: a projection that stringifies or reorders them is observable. */
export const ROUNDING_OPTIONS: readonly JsonValue[] = Object.freeze([10, 1, "none"]);
/** LIST alternatives mixing string, nested record and number members. */
export const ADD_ON_OPTIONS: readonly JsonValue[] = Object.freeze(["drinks", { item: "cake", size: 6 }, 0]);
export const MENU_PROPOSAL: JsonValue = Object.freeze({
  main: "hotpot",
  courses: 3,
  spicy: true,
  extras: ["rice"],
  budget: { per_person: 600, currency: "TWD" },
  note: null
});

/** One pending DEFAULT / PROPOSAL per projected value type, plus a non-choice item that carries alternatives. */
export const SIX_TYPE_ASSUMPTIONS: readonly PolicyVisibleItem[] = Object.freeze([
  llmProposal({ id: "a_title", proposed_default: "Team dinner split" }),
  nffDefault({ id: "b_headcount", expected_value_type: "NUMBER", question_type: "NUMBER", proposed_default: 8 }),
  llmProposal({ id: "c_tip_included", expected_value_type: "BOOLEAN", question_type: "BOOLEAN", proposed_default: false }),
  nffDefault({ id: "d_rounding", expected_value_type: "ENUM", question_type: "SINGLE_CHOICE", alternatives: ROUNDING_OPTIONS, proposed_default: 10 }),
  llmProposal({ id: "e_add_ons", expected_value_type: "LIST", question_type: "MULTI_CHOICE", alternatives: ADD_ON_OPTIONS, proposed_default: ["drinks"] }),
  llmProposal({ id: "f_menu", expected_value_type: "RECORD", question_type: "STRUCTURED_FIELDS", proposed_default: MENU_PROPOSAL })
]);

/** FREE_TEXT ambiguity: alternatives exist on the item but must never be projected as options. */
export const FREE_TEXT_AMBIGUITY = llmProposal({ id: "g_greeting", alternatives: ["hi", "hello"], proposed_default: "hi" });

export function editShapeSpec(): EnvelopeSpec {
  return {
    constraints: [confirmed({ id: "occasion", resolved_value: "team dinner" })],
    assumptions: SIX_TYPE_ASSUMPTIONS,
    ambiguities: [FREE_TEXT_AMBIGUITY],
    missing_fields: [item({ id: "h_theme", materiality: "COSMETIC" })]
  };
}

export function editShapeAnalysis(): StructuredIntentEnvelope {
  return analysis(editShapeSpec());
}

/** Exact F01-DATA-004A edit-shape fields per pending assumption ID. */
export const EXPECTED_EDIT_SHAPES: Readonly<Record<string, Record<string, JsonValue>>> = Object.freeze({
  a_title: { expected_value_type: "STRING", question_type: "FREE_TEXT" },
  b_headcount: { expected_value_type: "NUMBER", question_type: "NUMBER" },
  c_tip_included: { expected_value_type: "BOOLEAN", question_type: "BOOLEAN" },
  d_rounding: { expected_value_type: "ENUM", question_type: "SINGLE_CHOICE", options: [10, 1, "none"] },
  e_add_ons: { expected_value_type: "LIST", question_type: "MULTI_CHOICE", options: ["drinks", { item: "cake", size: 6 }, 0] },
  f_menu: { expected_value_type: "RECORD", question_type: "STRUCTURED_FIELDS", record_edit_schema: { ...OPEN_RECORD_DESCRIPTOR } },
  g_greeting: { expected_value_type: "STRING", question_type: "FREE_TEXT" }
});

function pendingView(source: PolicyVisibleItem): Record<string, JsonValue> {
  return {
    assumption_id: source.id,
    classification: source.source === "NFF_DEFAULT" ? "DEFAULT" : "PROPOSAL",
    description: source.description,
    materiality: source.materiality,
    impact_level: source.impact_level,
    source: source.source,
    ...(source.source === "NFF_DEFAULT" ? { source_ref: { ...NFF_POLICY_REF } } : {}),
    proposed_default: source.proposed_default as JsonValue,
    ...EXPECTED_EDIT_SHAPES[source.id]
  };
}

/** Complete expected `visible_assumptions[]` (sorted by ID) for `editShapeSpec()` before any decision. */
export function expectedEditShapeAssumptions(): Record<string, JsonValue>[] {
  return [
    ...SIX_TYPE_ASSUMPTIONS.map(pendingView),
    pendingView(FREE_TEXT_AMBIGUITY),
    { assumption_id: "h_theme", classification: "UNKNOWN", description: "Decide h_theme", materiality: "COSMETIC", impact_level: "MEDIUM", source: "DOMAIN_KNOWN" },
    {
      assumption_id: "occasion",
      classification: "FACT",
      description: "Decide occasion",
      materiality: "MATERIAL",
      impact_level: "MEDIUM",
      source: "USER_EXPLICIT",
      resolved_value: "team dinner"
    }
  ];
}

/** Native JSON EDIT of the RECORD proposal: renamed / deleted / added keys, nested LIST + RECORD, null, number. */
export const MENU_EDIT: JsonValue = Object.freeze({
  main_dish: "sukiyaki",
  courses: 4,
  spicy: false,
  extras: ["rice", { side: "kimchi", qty: 2 }, null],
  budget: { per_person: 750.5, currency: "JPY", split: { mode: "EQUAL", rounding: [1, 10] } },
  "備註": "no peanuts"
});
