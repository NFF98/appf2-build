import {
  internalInvariant,
  type ImpactLevel,
  type IntentSource,
  type Materiality,
  type PolicyVisibleItem,
  type SourceRef
} from "./intent-contract.js";
import type { JsonValue } from "./json-value.js";
import type { ItemPolicyMatch } from "./policy-rules.js";

export const ASSUMPTION_CLASSIFICATIONS = ["FACT", "DEFAULT", "PROPOSAL", "UNKNOWN"] as const;
export type AssumptionClassification = (typeof ASSUMPTION_CLASSIFICATIONS)[number];

export type VisibleAssumption = {
  readonly assumption_id: string;
  readonly classification: AssumptionClassification;
  readonly description: string;
  readonly materiality: Materiality;
  readonly impact_level: ImpactLevel;
  readonly source: IntentSource;
  readonly source_ref?: SourceRef;
  readonly proposed_value?: JsonValue;
};

const FACT_SOURCES: ReadonlySet<IntentSource> = new Set(["USER_EXPLICIT", "DOMAIN_KNOWN", "USER_ACCEPTED_PROPOSAL"]);

/**
 * F01-DATA-004 canonical classification. Returns null for states outside the four locked classes
 * (e.g. an already-accepted NFF_DEFAULT); this function never invents a fifth label.
 */
export function classifyAssumption(item: PolicyVisibleItem): AssumptionClassification | null {
  switch (item.resolution_state) {
    case "CONFIRMED":
      return FACT_SOURCES.has(item.source) ? "FACT" : null;
    case "UNRESOLVED":
      return item.proposed_default === undefined ? "UNKNOWN" : null;
    case "PROPOSED":
      if (item.source === "NFF_DEFAULT") return "DEFAULT";
      if (item.source === "LLM_PROPOSED") return "PROPOSAL";
      return null;
  }
}

function isPendingDecision(classification: AssumptionClassification | null): boolean {
  return classification === "DEFAULT" || classification === "PROPOSAL";
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
    ...(isPendingDecision(classification) ? { proposed_value: item.proposed_default } : {})
  };
}

/**
 * Every MATERIAL DEFAULT / PROPOSAL is always visible regardless of `user_visible`; other classified
 * items follow `user_visible`. A CP-004 item that cannot be presented as DEFAULT / PROPOSAL has no
 * contract-authorized assumption review path and fails closed as F01-ERR-014.
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
