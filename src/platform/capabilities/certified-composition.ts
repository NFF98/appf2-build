import { CapabilityAdmissionError, createCapabilityAdmissionResolver } from "./admission.js";
import { computeRegistryDigest } from "./generate-registry.js";
import { CAPABILITY_REGISTRY_SOURCE } from "./registry.js";
import type { CapabilityRequirement, CoverageResult } from "./coverage.js";

/**
 * BD-026 F04 certified semantic role closure.
 *
 * Atomic capability coverage only yields the primitive widgets mentioned by Prompt A,
 * not the layout/row/stat/record roles needed for a working task list. This profile
 * explicitly checks the complete, bounded user-requested interaction signature, then
 * admits each role through the same canonical F04 admission resolver. Do not transform
 * arbitrary 'button + list' into a capable CRUD app.
 */
const RECORD_LIST_ROLES = [
  "layout.container", "content.text", "content.list",
  "input.text", "action.button", "data.stat"
] as const;

function matchesClass(
  requirements: readonly CapabilityRequirement[],
  interaction: string, pattern?: RegExp
): readonly CapabilityRequirement[] {
  return requirements.filter(r => r.interaction_class === interaction &&
    (pattern === undefined || pattern.test(r.semantic_need)));
}

function hasTaskListSignature(requirements: readonly CapabilityRequirement[]): boolean {
  // This certificate covers EXACTLY the six known interactions, not arbitrary extras.
  if (requirements.length !== 6) return false;
  const buttons = matchesClass(requirements, "button");
  // A closed multilingual token set, not a fuzzy semantic classifier. If a
  // mandatory feature is ambiguous, require clarification / certification.
  const add = buttons.filter(r => /(?:新增|添加|加入|新建|add|create)/i.test(r.semantic_need));
  const remove = buttons.filter(r => /(?:刪除|删除|移除|remove|delete)/i.test(r.semantic_need));
  const toggle = matchesClass(requirements, "toggle");
  const text = matchesClass(requirements, "text_input");
  const metric = matchesClass(requirements, "metric");
  const list = matchesClass(requirements, "repeated_content");
  return add.length === 1 && remove.length === 1 &&
    add[0]!.requirement_id !== remove[0]!.requirement_id &&
    toggle.length === 1 && text.length === 1 && metric.length === 1 && list.length === 1 &&
    [add[0], remove[0], toggle[0], text[0], metric[0]].every(x => x?.required === true) &&
    text[0]!.input_types.length === 1 && text[0]!.input_types[0] === "STRING" &&
    metric[0]!.output_types.length === 1 && metric[0]!.output_types[0] === "NUMBER";
}

function requiresUnsupportedCalendar(requirements: readonly CapabilityRequirement[]): CapabilityRequirement | undefined {
  // F03 has no supported day-clock/record completion timestamp. 'Today completed'
  // is NOT equal to total completed. Do not label a false total as a daily count.
  return matchesClass(requirements, "metric").find(r =>
    /(?:今天|今日|本日|當日|当日|当日|today|daily|current.day)/i.test(r.semantic_need));
}

function unsupportedCalendar(coverage: CoverageResult, requirement: CapabilityRequirement): CoverageResult {
  return {
    ...coverage,
    status: "UNSUPPORTED",
    requirements: coverage.requirements.map(r => r.requirementId === requirement.requirement_id ?
      { ...r, status: "UNSUPPORTED" as const, capabilityRefs: [], reason: "F04-COMPOSITION-CALENDAR_NOT_SUPPORTED" } : r),
    gaps: [...coverage.gaps.filter(g => g.requirementId !== requirement.requirement_id),
      { requirementId: requirement.requirement_id, description: "Today-only completion requires a supported date/time contract.", evidenceCode: "F04-EVT-006" }]
  };
}

/**
 * Runs on server-owned, admission-verified ResolvedIntent capabilities before Prompt B.
 * No provider can choose refs/versions, bypass runtime handler registration, or
 * authorize extra features. Fail-closed when trusted resolution is incompatible.
 */
export function certifyCompositeCoverage(
  coverage: CoverageResult,
  requirements: readonly CapabilityRequirement[]
): CoverageResult {
  if (!hasTaskListSignature(requirements)) return coverage;
  const temporal = requiresUnsupportedCalendar(requirements);
  if (coverage.requirements.some(r => r.status === "EXTERNAL_REQUIRED")) return coverage;
  if (coverage.registryVersion !== CAPABILITY_REGISTRY_SOURCE.registryVersion ||
      coverage.registryDigest !== computeRegistryDigest(CAPABILITY_REGISTRY_SOURCE)) return coverage;

  const definitions = CAPABILITY_REGISTRY_SOURCE.capabilities;
  const resolver = createCapabilityAdmissionResolver({
    source: CAPABILITY_REGISTRY_SOURCE,
    trustedRuntimeRegistrationKeys: new Set(definitions.map(x => x.runtime.registrationKey)),
    allowExperimental: false
  });
  const refs = new Map(coverage.selected.map(ref => [ref.id + "@" + ref.version, ref]));
  for (const id of RECORD_LIST_ROLES) {
    const definition = definitions.find(x => x.id === id &&
      x.lifecycle.availability === "ENABLED" && x.lifecycle.executionStatus === "ACTIVE");
    if (definition === undefined) return coverage;
    try {
      const result = resolver.admit({
        capability: { id, version: definition.version },
        resourceUsage: {
          maxInstancesPerBlueprint: 0, maxSerializedPropsBytes: 0,
          maxLocalStateBytes: 0, maxEventBindings: 0,
          maxActionBindings: 0, maxConcurrentTimers: 0
        }
      });
      for (const ref of [result.capability, ...result.requiredDependencies]) refs.set(ref.id + "@" + ref.version, ref);
    } catch (error) {
      if (error instanceof CapabilityAdmissionError) return coverage;
      throw error;
    }
  }
  // A certified composite fulfills these exact six semantic needs. Atomic F04
  // matching alone can mark e.g. a row toggle as unsupported even though the
  // typed F03 LIST_REPLACE_AT composition is independently proven.
  const roleFor = (r: CapabilityRequirement): string =>
    r.interaction_class === "text_input" ? "input.text" :
      r.interaction_class === "metric" ? "data.stat" :
        r.interaction_class === "repeated_content" ? "content.list" : "action.button";
  const covered = coverage.requirements.map(item => {
    const requirement = requirements.find(r => r.requirement_id === item.requirementId);
    if (requirement === undefined) return item;
    const role = roleFor(requirement);
    const canonical = definitions.find(def => def.id === role);
    if (canonical === undefined) return item;
    return {
      ...item, status: "COVERED" as const,
      capabilityRefs: [{ id: canonical.id, version: canonical.version }],
      reason: "F04_CERTIFIED_RECORD_LIST_COMPOSITION"
    };
  });
  return {
    ...coverage, certifiedProfile: temporal === undefined ? "RECORD_LIST" : "RECORD_LIST_TODAY",
    selected: [...refs.values()],
    status: "FULLY_SUPPORTED", requirements: covered,
    gaps: coverage.gaps.filter(gap => !requirements.some(r => r.requirement_id === gap.requirementId))
  };
}
