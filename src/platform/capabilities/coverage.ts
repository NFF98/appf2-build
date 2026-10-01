import {
  CapabilityAdmissionError,
  createCapabilityAdmissionResolver,
  type CapabilityAdmission,
  type CompatibilityOutcome
} from "./admission.js";
import { computeRegistryDigest } from "./generate-registry.js";
import { CAPABILITY_REGISTRY_SOURCE } from "./registry.js";
import type {
  CapabilityDefinition,
  CapabilityRef,
  RegistrySource
} from "./schema/capability-definition.js";

export type RequirementCoverageStatus =
  | "COVERED"
  | "DEGRADED"
  | "UNSUPPORTED"
  | "EXTERNAL_REQUIRED";

export type CoverageStatus =
  | "FULLY_SUPPORTED"
  | "PARTIALLY_SUPPORTED"
  | "EXTERNAL_OR_HEAVY_REQUIRED"
  | "UNSUPPORTED";

export interface CapabilityRequirement {
  readonly requirement_id: string;
  readonly semantic_need: string;
  readonly required: boolean;
  readonly impact_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  readonly input_types: readonly string[];
  readonly output_types: readonly string[];
  readonly interaction_class: string;
  readonly constraints: readonly unknown[];
}

export interface CoverageResolutionRequest {
  readonly requirements: readonly CapabilityRequirement[];
  readonly suggestedCapabilities?: Readonly<Record<string, readonly CapabilityRef[]>>;
  readonly externalRequirementIds?: ReadonlySet<string>;
}

export interface CoverageResolutionContext {
  readonly source: RegistrySource;
  readonly trustedRuntimeRegistrationKeys: ReadonlySet<string>;
  readonly compatibilityOutcomes?: ReadonlyMap<string, CompatibilityOutcome>;
  readonly mode?: "PRODUCTION" | "EXPERIMENT";
}

export interface CoverageDegradation {
  readonly sourceCapabilityRef: CapabilityRef;
  readonly alternativeCapabilityRef: CapabilityRef;
  readonly preservesSemanticCore: true;
}

export interface RequirementCoverageResult {
  readonly requirementId: string;
  readonly status: RequirementCoverageStatus;
  readonly capabilityRefs: readonly CapabilityRef[];
  readonly degradation?: CoverageDegradation;
  readonly reason: string;
}

export interface CoverageGap {
  readonly requirementId: string;
  readonly description: string;
  readonly evidenceCode: string;
}

export interface CoverageResult {
  readonly registryVersion: string;
  readonly registryDigest: string;
  readonly status: CoverageStatus;
  readonly selected: readonly CapabilityRef[];
  readonly requirements: readonly RequirementCoverageResult[];
  readonly gaps: readonly CoverageGap[];
}

export interface CapabilityRejection {
  readonly capabilityRef: CapabilityRef;
  readonly code: CapabilityAdmissionError["code"];
}

export interface CoverageResolutionOutcome {
  readonly result: CoverageResult;
  readonly rejections: readonly CapabilityRejection[];
}

export class CoverageResolutionError extends Error {
  public constructor(
    public readonly code: "DUPLICATE_REQUIREMENT_ID",
    message: string
  ) {
    super(message);
    this.name = "CoverageResolutionError";
  }
}

interface ResolutionState {
  readonly definitionsByRef: ReadonlyMap<string, CapabilityDefinition>;
  readonly definitionsBySemanticNeed: ReadonlyMap<string, readonly CapabilityDefinition[]>;
  readonly knownCapabilityIds: ReadonlySet<string>;
  readonly rejections: Map<string, CapabilityRejection>;
  readonly admit: (ref: CapabilityRef) => CapabilityAdmission | undefined;
}

function refKey(ref: CapabilityRef): string {
  return `${ref.id}@${ref.version}`;
}

function toRef(definition: CapabilityDefinition): CapabilityRef {
  return { id: definition.id, version: definition.version };
}

function buildSemanticIndex(
  source: RegistrySource
): ReadonlyMap<string, readonly CapabilityDefinition[]> {
  const index = new Map<string, CapabilityDefinition[]>();
  for (const definition of source.capabilities) {
    const semanticKeys = new Set([
      definition.semantic.meaning,
      ...definition.semantic.intentClasses
    ]);
    for (const key of semanticKeys) {
      const matches = index.get(key) ?? [];
      matches.push(definition);
      index.set(key, matches);
    }
  }
  for (const matches of index.values()) {
    matches.sort((left, right) => refKey(toRef(left)).localeCompare(refKey(toRef(right))));
  }
  return index;
}

function createResolutionState(context: CoverageResolutionContext): ResolutionState {
  const definitionsByRef = new Map(
    context.source.capabilities.map((definition) => [refKey(toRef(definition)), definition])
  );
  const resolver = createCapabilityAdmissionResolver({
    source: context.source,
    trustedRuntimeRegistrationKeys: context.trustedRuntimeRegistrationKeys,
    compatibilityOutcomes: context.compatibilityOutcomes,
    allowExperimental: context.mode === "EXPERIMENT"
  });
  const rejections = new Map<string, CapabilityRejection>();
  return {
    definitionsByRef,
    definitionsBySemanticNeed: buildSemanticIndex(context.source),
    knownCapabilityIds: new Set(context.source.capabilities.map(({ id }) => id)),
    rejections,
    admit(ref): CapabilityAdmission | undefined {
      try {
        return resolver.admit({
          capability: ref,
          resourceUsage: {
            maxInstancesPerBlueprint: 0,
            maxSerializedPropsBytes: 0,
            maxLocalStateBytes: 0,
            maxEventBindings: 0,
            maxActionBindings: 0,
            maxConcurrentTimers: 0
          }
        });
      } catch (error: unknown) {
        if (error instanceof CapabilityAdmissionError) {
          rejections.set(refKey(ref), { capabilityRef: ref, code: error.code });
          return undefined;
        }
        throw error;
      }
    }
  };
}

function recordUnregisteredSuggestions(
  suggestedRefs: readonly CapabilityRef[],
  state: ResolutionState
): void {
  for (const ref of suggestedRefs) {
    if (state.definitionsByRef.has(refKey(ref))) {
      continue;
    }
    state.rejections.set(refKey(ref), {
      capabilityRef: ref,
      code: state.knownCapabilityIds.has(ref.id)
        ? "UNKNOWN_CAPABILITY_VERSION"
        : "UNKNOWN_CAPABILITY"
    });
  }
}

function orderedCandidates(
  requirement: CapabilityRequirement,
  request: CoverageResolutionRequest,
  state: ResolutionState
): readonly CapabilityDefinition[] {
  const semanticMatches = state.definitionsBySemanticNeed.get(requirement.semantic_need) ?? [];
  const matchingRefs = new Set(semanticMatches.map((definition) => refKey(toRef(definition))));
  const suggestedRefs = request.suggestedCapabilities?.[requirement.requirement_id] ?? [];
  recordUnregisteredSuggestions(suggestedRefs, state);
  const suggested = suggestedRefs
    .map((ref) => state.definitionsByRef.get(refKey(ref)))
    .filter(
      (definition): definition is CapabilityDefinition =>
        definition !== undefined && matchingRefs.has(refKey(toRef(definition)))
    );
  const ordered = new Map<string, CapabilityDefinition>();
  for (const definition of [...suggested, ...semanticMatches]) {
    ordered.set(refKey(toRef(definition)), definition);
  }
  return [...ordered.values()];
}

function admittedRefs(admission: CapabilityAdmission): readonly CapabilityRef[] {
  const refs = new Map<string, CapabilityRef>();
  for (const ref of [admission.capability, ...admission.requiredDependencies]) {
    refs.set(refKey(ref), ref);
  }
  return [...refs.values()];
}

function coveredResult(
  requirement: CapabilityRequirement,
  candidates: readonly CapabilityDefinition[],
  state: ResolutionState
): RequirementCoverageResult | undefined {
  for (const candidate of candidates) {
    const admission = state.admit(toRef(candidate));
    if (admission !== undefined) {
      return {
        requirementId: requirement.requirement_id,
        status: "COVERED",
        capabilityRefs: admittedRefs(admission),
        reason: `Exact registered semantic match: ${refKey(admission.capability)}.`
      };
    }
  }
  return undefined;
}

function degradedResult(
  requirement: CapabilityRequirement,
  candidates: readonly CapabilityDefinition[],
  state: ResolutionState
): RequirementCoverageResult | undefined {
  let semanticCoreLost = false;
  for (const candidate of candidates) {
    if (!candidate.degradation.allowed) {
      continue;
    }
    for (const alternative of candidate.degradation.alternatives) {
      const admission = state.admit(alternative);
      if (admission === undefined) {
        continue;
      }
      if (!candidate.degradation.preservesSemanticCore) {
        semanticCoreLost = true;
        continue;
      }
      return {
        requirementId: requirement.requirement_id,
        status: "DEGRADED",
        capabilityRefs: admittedRefs(admission),
        degradation: {
          sourceCapabilityRef: toRef(candidate),
          alternativeCapabilityRef: alternative,
          preservesSemanticCore: true
        },
        reason: `Declared degradation to ${refKey(alternative)} preserves semantic core.`
      };
    }
  }
  if (!semanticCoreLost) {
    return undefined;
  }
  return {
    requirementId: requirement.requirement_id,
    status: "UNSUPPORTED",
    capabilityRefs: [],
    reason: "F04-ERR-008 SEMANTIC_CORE_NOT_PRESERVED"
  };
}

function resolveRequirement(
  requirement: CapabilityRequirement,
  request: CoverageResolutionRequest,
  state: ResolutionState
): RequirementCoverageResult {
  if (request.externalRequirementIds?.has(requirement.requirement_id) === true) {
    return {
      requirementId: requirement.requirement_id,
      status: "EXTERNAL_REQUIRED",
      capabilityRefs: [],
      reason: "Requirement is classified as external or heavy; no local capability was selected."
    };
  }
  const candidates = orderedCandidates(requirement, request, state);
  return (
    coveredResult(requirement, candidates, state) ??
    degradedResult(requirement, candidates, state) ?? {
      requirementId: requirement.requirement_id,
      status: "UNSUPPORTED",
      capabilityRefs: [],
      reason: "No eligible exact registered capability or safe declared degradation exists."
    }
  );
}

function aggregateStatus(
  requirements: readonly CapabilityRequirement[],
  results: readonly RequirementCoverageResult[]
): CoverageStatus {
  const requiredStatuses = results
    .filter((_, index) => requirements[index]!.required)
    .map(({ status }) => status);
  if (requiredStatuses.includes("UNSUPPORTED")) {
    return "UNSUPPORTED";
  }
  if (requiredStatuses.includes("EXTERNAL_REQUIRED")) {
    return "EXTERNAL_OR_HEAVY_REQUIRED";
  }
  if (requiredStatuses.includes("DEGRADED")) {
    return "PARTIALLY_SUPPORTED";
  }
  return "FULLY_SUPPORTED";
}

function gapFor(result: RequirementCoverageResult): CoverageGap | undefined {
  if (result.status === "COVERED") {
    return undefined;
  }
  const semanticCoreFailure = result.reason.includes("F04-ERR-008");
  return {
    requirementId: result.requirementId,
    description: result.reason,
    evidenceCode: semanticCoreFailure ? "F04-ERR-008" : "F04-EVT-006"
  };
}

function assertUniqueRequirements(requirements: readonly CapabilityRequirement[]): void {
  const ids = new Set<string>();
  for (const requirement of requirements) {
    if (ids.has(requirement.requirement_id)) {
      throw new CoverageResolutionError(
        "DUPLICATE_REQUIREMENT_ID",
        `Duplicate material requirement: ${requirement.requirement_id}`
      );
    }
    ids.add(requirement.requirement_id);
  }
}

export function canonicalCoverageContext(): CoverageResolutionContext {
  return {
    source: CAPABILITY_REGISTRY_SOURCE,
    trustedRuntimeRegistrationKeys: new Set(
      CAPABILITY_REGISTRY_SOURCE.capabilities.map(
        ({ runtime }) => runtime.registrationKey
      )
    ),
    mode: "PRODUCTION"
  };
}

export function resolveCapabilityCoverage(
  request: CoverageResolutionRequest,
  context: CoverageResolutionContext = canonicalCoverageContext()
): CoverageResult {
  return resolveCapabilityCoverageOutcome(request, context).result;
}

export function resolveCapabilityCoverageOutcome(
  request: CoverageResolutionRequest,
  context: CoverageResolutionContext = canonicalCoverageContext()
): CoverageResolutionOutcome {
  assertUniqueRequirements(request.requirements);
  const state = createResolutionState(context);
  const requirements = request.requirements.map((requirement) =>
    resolveRequirement(requirement, request, state)
  );
  const selected = new Map<string, CapabilityRef>();
  for (const result of requirements) {
    for (const ref of result.capabilityRefs) {
      selected.set(refKey(ref), ref);
    }
  }
  return {
    result: {
      registryVersion: context.source.registryVersion,
      registryDigest: computeRegistryDigest(context.source),
      status: aggregateStatus(request.requirements, requirements),
      selected: [...selected.values()],
      requirements,
      gaps: requirements.map(gapFor).filter((gap): gap is CoverageGap => gap !== undefined)
    },
    rejections: [...state.rejections.values()]
  };
}
