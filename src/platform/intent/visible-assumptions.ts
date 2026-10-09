import {
  internalInvariant,
  type ImpactLevel,
  type IntentSource,
  type Materiality,
  type PolicyVisibleItem,
  type QuestionType,
  type SourceRef,
  type ValueType
} from "./intent-contract.js";
import { deepFreeze, type JsonValue } from "./json-value.js";
import type { ItemPolicyMatch } from "./policy-rules.js";
import { choiceOptionsOf, hasProjectableAnswerShape, valueFitsItem } from "./value-shape.js";

export const ASSUMPTION_CLASSIFICATIONS = ["FACT", "DEFAULT", "PROPOSAL", "UNKNOWN"] as const;
export type AssumptionClassification = (typeof ASSUMPTION_CLASSIFICATIONS)[number];

/**
 * F01-DATA-004A fixed RECORD edit descriptor. It only describes the existing open plain-record / JsonValue
 * validation; it is never a key whitelist, required-field schema or per-field domain rule.
 */
export const OPEN_JSON_RECORD_V1 = deepFreeze({
  kind: "OPEN_JSON_RECORD_V1",
  key_policy: "USER_DEFINED",
  value_kind: "JSON_VALUE",
  nested: true
} as const);
export type RecordEditSchema = typeof OPEN_JSON_RECORD_V1;

/**
 * F01-DATA-004A edit shape of a pending DEFAULT / PROPOSAL, copied from the validated target item only:
 * `options` iff SINGLE_CHOICE / MULTI_CHOICE, `record_edit_schema` iff STRUCTURED_FIELDS.
 */
export type AssumptionEditShape = {
  readonly expected_value_type: ValueType;
  readonly question_type: QuestionType;
  readonly options?: readonly JsonValue[];
  readonly record_edit_schema?: RecordEditSchema;
};

/**
 * F01-DATA-004 projection: FACT presents `resolved_value`, DEFAULT / PROPOSAL present the pending
 * `proposed_default` plus the F01-DATA-004A edit shape, UNKNOWN carries neither. Internal provenance is
 * reported unchanged.
 */
export type VisibleAssumption = {
  readonly assumption_id: string;
  readonly classification: AssumptionClassification;
  readonly description: string;
  readonly materiality: Materiality;
  readonly impact_level: ImpactLevel;
  readonly source: IntentSource;
  readonly source_ref?: SourceRef;
  readonly resolved_value?: JsonValue;
  readonly proposed_default?: JsonValue;
} & Partial<AssumptionEditShape>;

const FACT_SOURCES: ReadonlySet<IntentSource> = new Set(["USER_EXPLICIT", "DOMAIN_KNOWN", "USER_ACCEPTED_PROPOSAL"]);

/**
 * Returns null for states outside the four locked classes: an accepted NFF_DEFAULT is accepted-assumption
 * truth rather than a FACT, and this projection never invents a fifth label.
 */
export function classifyAssumption(item: PolicyVisibleItem): AssumptionClassification | null {
  switch (item.resolution_state) {
    case "CONFIRMED":
      return FACT_SOURCES.has(item.source) ? "FACT" : null;
    case "UNRESOLVED":
      return "UNKNOWN";
    case "PROPOSED":
      if (item.source === "NFF_DEFAULT") return "DEFAULT";
      return item.source === "LLM_PROPOSED" ? "PROPOSAL" : null;
  }
}

export function isPendingDecision(classification: AssumptionClassification | null): boolean {
  return classification === "DEFAULT" || classification === "PROPOSAL";
}

/**
 * F01-DATA-004A rule 6: a pending assumption whose type pairing, alternatives or pending value cannot be
 * projected is F01-ERR-014, so no apparently editable READY_WITH_VISIBLE_ASSUMPTIONS is ever emitted.
 */
export function projectEditShape(item: PolicyVisibleItem): AssumptionEditShape {
  const pending = item.proposed_default;
  if (!hasProjectableAnswerShape(item) || pending === undefined || !valueFitsItem(pending, item)) {
    internalInvariant("ASSUMPTION_EDIT_SHAPE_NOT_PROJECTABLE", `$.visible_assumptions[${item.id}]`);
  }
  const options = choiceOptionsOf(item);
  return {
    expected_value_type: item.expected_value_type,
    question_type: item.question_type,
    ...(options === undefined ? {} : { options }),
    ...(item.expected_value_type === "RECORD" ? { record_edit_schema: OPEN_JSON_RECORD_V1 } : {})
  };
}

function project(item: PolicyVisibleItem, classification: AssumptionClassification): VisibleAssumption {
  return {
    assumption_id: item.id,
    classification,
    description: item.description,
    materiality: item.materiality,
    impact_level: item.impact_level,
    source: item.source,
    ...(item.source_ref === undefined ? {} : { source_ref: item.source_ref }),
    ...(classification === "FACT" ? { resolved_value: item.resolved_value } : {}),
    ...(isPendingDecision(classification) ? { proposed_default: item.proposed_default, ...projectEditShape(item) } : {})
  };
}

/**
 * Every MATERIAL DEFAULT / PROPOSAL is visible regardless of `user_visible`; other classified items follow
 * `user_visible`. A CP-004 owner that cannot be presented as DEFAULT / PROPOSAL means corrupted state.
 */
export function projectVisibleAssumptions(matches: readonly ItemPolicyMatch[]): VisibleAssumption[] {
  const visible: VisibleAssumption[] = [];
  for (const { item, owner_rule_id } of matches) {
    const classification = classifyAssumption(item);
    if (owner_rule_id === "F01-POL-CP-004" && !isPendingDecision(classification)) {
      internalInvariant("MATERIAL_ASSUMPTION_NOT_PRESENTABLE", `$.visible_assumptions[${item.id}]`);
    }
    if (classification === null) continue;
    const materialPending = item.materiality === "MATERIAL" && isPendingDecision(classification);
    if (materialPending || item.user_visible) visible.push(project(item, classification));
  }
  return visible.sort((left, right) => (left.assumption_id < right.assumption_id ? -1 : 1));
}
