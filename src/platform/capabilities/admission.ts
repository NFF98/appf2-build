import type {
  CapabilityDefinition,
  CapabilityRef,
  RegistrySource,
  ResourceBudget
} from "./schema/capability-definition.js";

export const GLOBAL_RESOURCE_CEILINGS = {
  maxInstancesPerBlueprint: 100,
  maxSerializedPropsBytes: 256 * 1024,
  maxLocalStateBytes: 128 * 1024,
  maxEventBindings: 200,
  maxActionBindings: 100,
  maxConcurrentTimers: 10
} as const;

type NumericResource = keyof typeof GLOBAL_RESOURCE_CEILINGS;
export type CompatibilityOutcome =
  | "COMPATIBLE"
  | "DEPRECATED_BUT_SUPPORTED"
  | "INCOMPATIBLE"
  | "REVOKED";

export interface CapabilityResourceUsage {
  readonly maxInstancesPerBlueprint: number;
  readonly maxSerializedPropsBytes: number;
  readonly maxLocalStateBytes: number;
  readonly maxEventBindings: number;
  readonly maxActionBindings: number;
  readonly maxConcurrentTimers: number;
}

export interface CapabilityAdmissionContext {
  readonly source: RegistrySource;
  readonly trustedRuntimeRegistrationKeys: ReadonlySet<string>;
  readonly compatibilityOutcomes?: ReadonlyMap<string, CompatibilityOutcome>;
  readonly allowExperimental?: boolean;
}

export interface CapabilityAdmission {
  readonly capability: CapabilityRef;
  readonly requiredDependencies: readonly CapabilityRef[];
}

export interface CapabilityAdmissionResolver {
  admit(request: unknown): CapabilityAdmission;
}

export class CapabilityAdmissionError extends Error {
  public constructor(
    public readonly code:
      | "UNKNOWN_CAPABILITY"
      | "UNKNOWN_CAPABILITY_VERSION"
      | "RUNTIME_HANDLER_MISSING"
      | "FORBIDDEN_EXECUTABLE_CONTENT"
      | "CAPABILITY_DISABLED"
      | "CAPABILITY_REVOKED"
      | "CAPABILITY_DEPENDENCY_UNAVAILABLE"
      | "REGISTRY_SNAPSHOT_MISMATCH"
      | "RESOURCE_LIMIT_EXCEEDED"
      | "INVALID_DEPENDENCY_VERSION_RANGE",
    message: string
  ) {
    super(message);
    this.name = "CapabilityAdmissionError";
  }
}

interface ParsedAdmissionRequest {
  readonly capability: CapabilityRef;
  readonly resourceUsage: CapabilityResourceUsage;
}

interface DependencyState {
  readonly context: CapabilityAdmissionContext;
  readonly byId: ReadonlyMap<string, readonly CapabilityDefinition[]>;
  readonly visiting: Set<string>;
  readonly admitted: Set<string>;
  readonly dependencies: CapabilityRef[];
}

const NUMERIC_RESOURCES = Object.keys(GLOBAL_RESOURCE_CEILINGS) as NumericResource[];
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

function refKey(ref: CapabilityRef): string {
  return `${ref.id}@${ref.version}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertExactKeys(record: Record<string, unknown>, allowed: readonly string[]): void {
  const allowedKeys = new Set(allowed);
  const forbidden = Object.keys(record).find((key) => !allowedKeys.has(key));
  if (forbidden !== undefined) {
    throw new CapabilityAdmissionError(
      "FORBIDDEN_EXECUTABLE_CONTENT",
      `Admission input contains forbidden key: ${forbidden}`
    );
  }
}

function parseResourceUsage(value: unknown): CapabilityResourceUsage {
  if (!isRecord(value)) {
    throw new CapabilityAdmissionError("RESOURCE_LIMIT_EXCEEDED", "Resource usage must be an object.");
  }
  assertExactKeys(value, NUMERIC_RESOURCES);
  const parsed = Object.fromEntries(
    NUMERIC_RESOURCES.map((resource) => {
      const amount = value[resource];
      if (!Number.isSafeInteger(amount) || (amount as number) < 0) {
        throw new CapabilityAdmissionError(
          "RESOURCE_LIMIT_EXCEEDED",
          `${resource} must be a non-negative safe integer.`
        );
      }
      return [resource, amount];
    })
  );
  return parsed as unknown as CapabilityResourceUsage;
}

function parseAdmissionRequest(value: unknown): ParsedAdmissionRequest {
  if (!isRecord(value)) {
    throw new CapabilityAdmissionError(
      "FORBIDDEN_EXECUTABLE_CONTENT",
      "Capability admission input must be declarative data."
    );
  }
  assertExactKeys(value, ["capability", "resourceUsage"]);
  if (!isRecord(value.capability)) {
    throw new CapabilityAdmissionError("UNKNOWN_CAPABILITY", "Capability ref must be an object.");
  }
  assertExactKeys(value.capability, ["id", "version"]);
  if (typeof value.capability.id !== "string" || typeof value.capability.version !== "string") {
    throw new CapabilityAdmissionError("UNKNOWN_CAPABILITY", "Capability ref must contain id and version.");
  }
  return {
    capability: { id: value.capability.id, version: value.capability.version },
    resourceUsage: parseResourceUsage(value.resourceUsage)
  };
}

function parseVersion(version: string): readonly [number, number, number] | undefined {
  const match = SEMVER_PATTERN.exec(version);
  return match === null
    ? undefined
    : [Number(match[1]), Number(match[2]), Number(match[3])];
}

function compareVersions(left: readonly number[], right: readonly number[]): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function caretUpperBound(version: readonly [number, number, number]): readonly [number, number, number] {
  if (version[0] > 0) {
    return [version[0] + 1, 0, 0];
  }
  return version[1] > 0 ? [0, version[1] + 1, 0] : [0, 0, version[2] + 1];
}

export function matchesCapabilityVersionRange(version: string, range: string): boolean {
  const candidate = parseVersion(version);
  if (candidate === undefined) {
    return false;
  }
  const exact = parseVersion(range);
  if (exact !== undefined) {
    return compareVersions(candidate, exact) === 0;
  }
  if (range.startsWith("^")) {
    const minimum = parseVersion(range.slice(1));
    return (
      minimum !== undefined &&
      compareVersions(candidate, minimum) >= 0 &&
      compareVersions(candidate, caretUpperBound(minimum)) < 0
    );
  }
  const bounded = /^>=(\d+\.\d+\.\d+) <(\d+\.\d+\.\d+)$/.exec(range);
  if (bounded !== null) {
    const minimum = parseVersion(bounded[1]!);
    const maximum = parseVersion(bounded[2]!);
    return (
      minimum !== undefined &&
      maximum !== undefined &&
      compareVersions(candidate, minimum) >= 0 &&
      compareVersions(candidate, maximum) < 0
    );
  }
  throw new CapabilityAdmissionError(
    "INVALID_DEPENDENCY_VERSION_RANGE",
    `Unsupported dependency version range: ${range}`
  );
}

export function compareCapabilityVersions(left: string, right: string): number {
  const leftVersion = parseVersion(left);
  const rightVersion = parseVersion(right);
  if (leftVersion === undefined || rightVersion === undefined) {
    throw new CapabilityAdmissionError("INVALID_DEPENDENCY_VERSION_RANGE", `Invalid SemVer: ${left} / ${right}`);
  }
  return compareVersions(leftVersion, rightVersion);
}

export function isRuntimeVersionBoundSyntax(minRuntimeVersion: string, maxRuntimeVersion: string): boolean {
  const maximum = maxRuntimeVersion.startsWith("<") ? maxRuntimeVersion.slice(1) : maxRuntimeVersion;
  return parseVersion(minRuntimeVersion) !== undefined && parseVersion(maximum) !== undefined;
}

export function matchesRuntimeCompatibility(
  runtimeVersion: string,
  minRuntimeVersion: string,
  maxRuntimeVersion: string
): boolean {
  const runtime = parseVersion(runtimeVersion);
  const minimum = parseVersion(minRuntimeVersion);
  const exclusive = maxRuntimeVersion.startsWith("<");
  const maximum = parseVersion(exclusive ? maxRuntimeVersion.slice(1) : maxRuntimeVersion);
  if (runtime === undefined || minimum === undefined || maximum === undefined) {
    return false;
  }
  const upper = compareVersions(runtime, maximum);
  return compareVersions(runtime, minimum) >= 0 && (exclusive ? upper < 0 : upper <= 0);
}

export function assertResourceBudgetWithinGlobalCeilings(budget: ResourceBudget): void {
  for (const resource of NUMERIC_RESOURCES) {
    if (!Number.isSafeInteger(budget[resource]) || budget[resource] < 0) {
      throw new CapabilityAdmissionError(
        "RESOURCE_LIMIT_EXCEEDED",
        `${resource} must be a non-negative safe integer.`
      );
    }
    if (budget[resource] > GLOBAL_RESOURCE_CEILINGS[resource]) {
      throw new CapabilityAdmissionError(
        "RESOURCE_LIMIT_EXCEEDED",
        `${resource} exceeds the Phase 1 global ceiling.`
      );
    }
  }
}

function assertEligible(definition: CapabilityDefinition, context: CapabilityAdmissionContext): void {
  const outcome = context.compatibilityOutcomes?.get(refKey(definition)) ?? "COMPATIBLE";
  if (definition.lifecycle.executionStatus === "REVOKED" || outcome === "REVOKED") {
    throw new CapabilityAdmissionError("CAPABILITY_REVOKED", `${refKey(definition)} is revoked.`);
  }
  const unavailable =
    definition.lifecycle.availability === "DISABLED" ||
    (definition.lifecycle.availability === "EXPERIMENTAL" && context.allowExperimental !== true);
  if (unavailable) {
    throw new CapabilityAdmissionError("CAPABILITY_DISABLED", `${refKey(definition)} is disabled.`);
  }
  if (outcome === "INCOMPATIBLE") {
    throw new CapabilityAdmissionError(
      "REGISTRY_SNAPSHOT_MISMATCH",
      `${refKey(definition)} is incompatible with the current registry snapshot.`
    );
  }
  if (!context.trustedRuntimeRegistrationKeys.has(definition.runtime.registrationKey)) {
    throw new CapabilityAdmissionError(
      "RUNTIME_HANDLER_MISSING",
      `${refKey(definition)} has no trusted bundled runtime mapping.`
    );
  }
}

function buildVersionIndex(source: RegistrySource): ReadonlyMap<string, readonly CapabilityDefinition[]> {
  const byId = new Map<string, CapabilityDefinition[]>();
  for (const definition of source.capabilities) {
    const definitions = byId.get(definition.id) ?? [];
    definitions.push(definition);
    byId.set(definition.id, definitions);
  }
  for (const definitions of byId.values()) {
    definitions.sort((left, right) => {
      const leftVersion = parseVersion(left.version);
      const rightVersion = parseVersion(right.version);
      return leftVersion === undefined || rightVersion === undefined
        ? right.version.localeCompare(left.version)
        : compareVersions(rightVersion, leftVersion);
    });
  }
  return byId;
}

function copyTrialState(target: DependencyState, trial: DependencyState): void {
  target.visiting.clear();
  target.admitted.clear();
  for (const key of trial.visiting) {
    target.visiting.add(key);
  }
  for (const key of trial.admitted) {
    target.admitted.add(key);
  }
  target.dependencies.splice(0, target.dependencies.length, ...trial.dependencies);
}

function trialState(state: DependencyState): DependencyState {
  return {
    context: state.context,
    byId: state.byId,
    visiting: new Set(state.visiting),
    admitted: new Set(state.admitted),
    dependencies: [...state.dependencies]
  };
}

function resolveRequiredDependency(
  id: string,
  versionRange: string,
  state: DependencyState
): CapabilityDefinition {
  const candidates = (state.byId.get(id) ?? []).filter((candidate) =>
    matchesCapabilityVersionRange(candidate.version, versionRange)
  );
  for (const candidate of candidates) {
    const trial = trialState(state);
    try {
      admitDependencies(candidate, trial);
      copyTrialState(state, trial);
      return candidate;
    } catch (error: unknown) {
      if (!(error instanceof CapabilityAdmissionError)) {
        throw error;
      }
    }
  }
  throw new CapabilityAdmissionError(
    "CAPABILITY_DEPENDENCY_UNAVAILABLE",
    `Required dependency ${id}@${versionRange} is unavailable.`
  );
}

function admitDependencies(definition: CapabilityDefinition, state: DependencyState): void {
  const key = refKey(definition);
  if (state.admitted.has(key)) {
    return;
  }
  if (state.visiting.has(key)) {
    throw new CapabilityAdmissionError(
      "CAPABILITY_DEPENDENCY_UNAVAILABLE",
      `Dependency cycle reached at ${key}.`
    );
  }
  state.visiting.add(key);
  assertEligible(definition, state.context);
  for (const dependency of definition.compatibility.dependencies) {
    if (!dependency.required) {
      continue;
    }
    const resolved = resolveRequiredDependency(dependency.id, dependency.versionRange, state);
    state.dependencies.push({ id: resolved.id, version: resolved.version });
  }
  state.visiting.delete(key);
  state.admitted.add(key);
}

function assertUsageWithinBudget(
  usage: CapabilityResourceUsage,
  budget: ResourceBudget
): void {
  assertResourceBudgetWithinGlobalCeilings(budget);
  for (const resource of NUMERIC_RESOURCES) {
    if (usage[resource] > budget[resource]) {
      throw new CapabilityAdmissionError(
        "RESOURCE_LIMIT_EXCEEDED",
        `${resource} exceeds the capability budget.`
      );
    }
  }
}

function admitParsed(
  parsed: ParsedAdmissionRequest,
  context: CapabilityAdmissionContext,
  versionIndex: ReadonlyMap<string, readonly CapabilityDefinition[]>
): CapabilityAdmission {
  const versions = versionIndex.get(parsed.capability.id);
  if (versions === undefined) {
    throw new CapabilityAdmissionError(
      "UNKNOWN_CAPABILITY",
      `Unknown capability id: ${parsed.capability.id}`
    );
  }
  const definition = versions.find(({ version }) => version === parsed.capability.version);
  if (definition === undefined) {
    throw new CapabilityAdmissionError(
      "UNKNOWN_CAPABILITY_VERSION",
      `Unknown capability version: ${refKey(parsed.capability)}`
    );
  }
  assertUsageWithinBudget(parsed.resourceUsage, definition.runtime.resourceBudget);
  const dependencies: CapabilityRef[] = [];
  admitDependencies(definition, {
    context,
    byId: versionIndex,
    visiting: new Set<string>(),
    admitted: new Set<string>(),
    dependencies
  });
  return { capability: parsed.capability, requiredDependencies: dependencies };
}

export function createCapabilityAdmissionResolver(
  context: CapabilityAdmissionContext
): CapabilityAdmissionResolver {
  const versionIndex = buildVersionIndex(context.source);
  return {
    admit(request: unknown): CapabilityAdmission {
      return admitParsed(parseAdmissionRequest(request), context, versionIndex);
    }
  };
}

export function admitCapability(
  request: unknown,
  context: CapabilityAdmissionContext
): CapabilityAdmission {
  return createCapabilityAdmissionResolver(context).admit(request);
}
