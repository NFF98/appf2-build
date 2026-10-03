import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalizeJson } from "../blueprint/canonical-json.js";
import { compareCodePoints } from "../blueprint/type-descriptor.js";
import {
  assertResourceBudgetWithinGlobalCeilings,
  CapabilityAdmissionError,
  matchesCapabilityVersionRange
} from "./admission.js";
import { parseRuntimeBounds, parseVersionRange } from "./compatibility-grammar.js";
import {
  appendRegistryRelease,
  computeExecutionContractDigest,
  computeRuntimeBindingDigest,
  computeRuntimeRegistryDigest,
  computeValidatorRegistryDigest,
  emptyRegistryReleaseLedger,
  parseRegistryReleaseLedger,
  RegistryLedgerError,
  sha256CanonicalDigest,
  type CapabilityIdentityEntry,
  type ExecutionContractInput
} from "./registry-release.js";
import { CAPABILITY_REGISTRY_SOURCE } from "./registry.js";
import type { CapabilityDefinition, RegistrySource } from "./schema/capability-definition.js";
import type {
  RegistryReleaseIdentity,
  RegistryReleaseLedger,
  RuntimeCapabilityBinding,
  RuntimeRegistry
} from "./schema/registry-release.js";
import {
  CAPABILITY_ID_PATTERN,
  SEMVER_PATTERN,
  type GeneratedCapabilityValidator,
  type ValidatorRegistry
} from "./schema/validator-contract.js";
import { assertValidatorContract, ValidatorContractError } from "./validator-contract-check.js";

export const REGISTRY_RELEASE_LEDGER_FILE = "registry-release-ledger.json";
const SHA256_PREFIX = "sha256:";

export class RegistryGenerationError extends Error {
  public constructor(
    public readonly code:
      | "DUPLICATE_CAPABILITY_REF"
      | "DUPLICATE_REGISTRATION_KEY"
      | "DEPENDENCY_CYCLE"
      | "INVALID_CAPABILITY_ID"
      | "INVALID_VERSION"
      | "INVALID_DEPENDENCY_VERSION_RANGE"
      | "INVALID_COMPATIBILITY_RANGE"
      | "RESOURCE_CEILING_EXCEEDED"
      | "REGISTRY_VERSION_DIGEST_MISMATCH"
      | "CAPABILITY_VERSION_REUSE"
      | "RELEASE_LEDGER_INVALID"
      | "REGISTRY_GENERATION_INVALID",
    message: string
  ) {
    super(message);
    this.name = "RegistryGenerationError";
  }
}

export interface RegistryIdentity {
  readonly registryVersion: string;
  readonly registryDigest: string;
}

export interface GeneratedRegistryArtifacts {
  readonly identity: RegistryIdentity;
  readonly release: RegistryReleaseIdentity;
  readonly ledger: RegistryReleaseLedger;
  readonly validatorRegistry: ValidatorRegistry;
  readonly runtimeRegistry: RuntimeRegistry;
  readonly files: Readonly<Record<string, string>>;
}

function capabilityRef(definition: CapabilityDefinition): string {
  return `${definition.id}@${definition.version}`;
}

function sortedDefinitions(source: RegistrySource): readonly CapabilityDefinition[] {
  return [...source.capabilities].sort((left, right) => compareCodePoints(capabilityRef(left), capabilityRef(right)));
}

/** Bare hex source digest; the cross-contract `registry_digest` token is `sha256:<hex>`. */
export function computeRegistryDigest(source: RegistrySource): string {
  return sha256CanonicalDigest({
    registryVersion: source.registryVersion,
    runtimeVersion: source.runtimeVersion,
    blueprintSchemaRange: source.blueprintSchemaRange,
    capabilities: sortedDefinitions(source)
  }).slice(SHA256_PREFIX.length);
}

function assertValidIdentifiers(definitions: readonly CapabilityDefinition[]): void {
  for (const definition of definitions) {
    if (!CAPABILITY_ID_PATTERN.test(definition.id)) {
      throw new RegistryGenerationError(
        "INVALID_CAPABILITY_ID",
        `Invalid capability id: ${definition.id}`
      );
    }
    if (!SEMVER_PATTERN.test(definition.version)) {
      throw new RegistryGenerationError(
        "INVALID_VERSION",
        `Invalid capability version for ${definition.id}: ${definition.version}`
      );
    }
  }
}

function assertUniqueRefs(definitions: readonly CapabilityDefinition[]): void {
  const refs = new Set<string>();
  const registrationKeys = new Set<string>();
  for (const definition of definitions) {
    const ref = capabilityRef(definition);
    if (refs.has(ref)) {
      throw new RegistryGenerationError("DUPLICATE_CAPABILITY_REF", `Duplicate capability ref: ${ref}`);
    }
    refs.add(ref);

    if (registrationKeys.has(definition.runtime.registrationKey)) {
      throw new RegistryGenerationError(
        "DUPLICATE_REGISTRATION_KEY",
        `Duplicate runtime registration key: ${definition.runtime.registrationKey}`
      );
    }
    registrationKeys.add(definition.runtime.registrationKey);
  }
}

function assertAcyclicDependencies(definitions: readonly CapabilityDefinition[]): void {
  const knownIds = new Set(definitions.map((definition) => definition.id));
  const dependencies = new Map<string, Set<string>>();
  for (const definition of definitions) {
    const declaredDependencies = dependencies.get(definition.id) ?? new Set<string>();
    for (const dependency of definition.compatibility.dependencies) {
      if (knownIds.has(dependency.id)) {
        declaredDependencies.add(dependency.id);
      }
    }
    dependencies.set(definition.id, declaredDependencies);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (id: string, path: readonly string[]): void => {
    if (visiting.has(id)) {
      const cycleStart = path.indexOf(id);
      const cycle = [...path.slice(cycleStart), id].join(" -> ");
      throw new RegistryGenerationError("DEPENDENCY_CYCLE", `Capability dependency cycle: ${cycle}`);
    }
    if (visited.has(id)) {
      return;
    }

    visiting.add(id);
    for (const dependencyId of dependencies.get(id) ?? []) {
      visit(dependencyId, [...path, id]);
    }
    visiting.delete(id);
    visited.add(id);
  };

  for (const definition of definitions) {
    visit(definition.id, []);
  }
}

function assertCompatibilityGrammar(definition: CapabilityDefinition): void {
  const { minRuntimeVersion, maxRuntimeVersion, blueprintSchemaRange } = definition.compatibility;
  if (parseRuntimeBounds(minRuntimeVersion, maxRuntimeVersion) === undefined) {
    throw new RegistryGenerationError(
      "INVALID_COMPATIBILITY_RANGE",
      `${capabilityRef(definition)} runtime range must be inclusive SemVer min with exclusive <SemVer max and min < max.`
    );
  }
  if (parseVersionRange(blueprintSchemaRange) === undefined) {
    throw new RegistryGenerationError(
      "INVALID_COMPATIBILITY_RANGE",
      `${capabilityRef(definition)} blueprintSchemaRange must be SemVer, ^SemVer or a non-empty >=SemVer <SemVer.`
    );
  }
}

function assertResourceAndPolicy(definition: CapabilityDefinition): void {
  const { resourceBudget, resourceUsage } = definition.runtime;
  try {
    assertResourceBudgetWithinGlobalCeilings(resourceBudget);
  } catch (error: unknown) {
    if (error instanceof CapabilityAdmissionError) {
      throw new RegistryGenerationError("RESOURCE_CEILING_EXCEEDED", error.message);
    }
    throw error;
  }
  const timerSlots: unknown = resourceUsage?.timerSlotsPerInstance;
  if (typeof timerSlots !== "number" || !Number.isSafeInteger(timerSlots) || timerSlots < 0) {
    throw new RegistryGenerationError(
      "REGISTRY_GENERATION_INVALID",
      `${capabilityRef(definition)} must explicitly declare resourceUsage.timerSlotsPerInstance as a non-negative integer.`
    );
  }
  const enabled = definition.lifecycle.availability === "ENABLED";
  if (enabled && (resourceBudget.mediaAutoplayAllowed || resourceBudget.networkAccessAllowed)) {
    throw new RegistryGenerationError(
      "REGISTRY_GENERATION_INVALID",
      `${capabilityRef(definition)} is ENABLED with media autoplay or network access allowed.`
    );
  }
}

function assertDependencyRanges(definition: CapabilityDefinition): void {
  for (const dependency of definition.compatibility.dependencies) {
    try {
      matchesCapabilityVersionRange("0.0.0", dependency.versionRange);
    } catch (error: unknown) {
      if (error instanceof CapabilityAdmissionError) {
        throw new RegistryGenerationError("INVALID_DEPENDENCY_VERSION_RANGE", error.message);
      }
      throw error;
    }
  }
}

function assertValidatorContracts(definitions: readonly CapabilityDefinition[]): void {
  for (const definition of definitions) {
    try {
      assertValidatorContract(definition);
    } catch (error: unknown) {
      if (error instanceof ValidatorContractError) {
        throw new RegistryGenerationError("REGISTRY_GENERATION_INVALID", error.message);
      }
      throw error;
    }
  }
}

export function validateRegistrySource(source: RegistrySource): void {
  if (!SEMVER_PATTERN.test(source.registryVersion) || !SEMVER_PATTERN.test(source.runtimeVersion)) {
    throw new RegistryGenerationError("INVALID_VERSION", "Registry and runtime versions must be SemVer.");
  }
  if (parseVersionRange(source.blueprintSchemaRange) === undefined) {
    throw new RegistryGenerationError("INVALID_COMPATIBILITY_RANGE", "Registry blueprintSchemaRange is not canonical.");
  }
  const definitions = sortedDefinitions(source);
  assertValidIdentifiers(definitions);
  assertUniqueRefs(definitions);
  assertAcyclicDependencies(definitions);
  for (const definition of definitions) {
    assertCompatibilityGrammar(definition);
    assertResourceAndPolicy(definition);
    assertDependencyRanges(definition);
  }
  assertValidatorContracts(definitions);
}

function jsonArtifact(value: unknown): string {
  return `${JSON.stringify(JSON.parse(canonicalizeJson(value)), null, 2)}\n`;
}

const GENERATED_HEADER = "// Generated from the canonical Capability Registry. Do not edit.\n";
const SCHEMA_IMPORT_ROOT = "../../src/platform/capabilities/schema";

function typedArtifact(typeName: string, modulePath: string, constName: string, value: unknown): string {
  return `${GENERATED_HEADER}import type { ${typeName} } from "${SCHEMA_IMPORT_ROOT}/${modulePath}";\n\nexport const ${constName}: ${typeName} = ${JSON.stringify(
    JSON.parse(canonicalizeJson(value)),
    null,
    2
  )};\n`;
}

function validatorEntry(definition: CapabilityDefinition): GeneratedCapabilityValidator {
  const contract: ExecutionContractInput = {
    id: definition.id,
    version: definition.version,
    validator: definition.contract.validator,
    permission_class: definition.runtime.permissionClass,
    resource_budget: definition.runtime.resourceBudget,
    resource_usage: definition.runtime.resourceUsage,
    execution_class: definition.runtime.execution,
    compatibility: definition.compatibility,
    degradation: definition.degradation
  };
  return {
    ...contract,
    execution_contract_digest: computeExecutionContractDigest(contract),
    availability: definition.lifecycle.availability,
    execution_status: definition.lifecycle.executionStatus
  };
}

function buildValidatorRegistry(source: RegistrySource, registryDigest: string, definitions: readonly CapabilityDefinition[]): ValidatorRegistry {
  const capabilities: Record<string, Record<string, GeneratedCapabilityValidator>> = {};
  for (const definition of definitions) {
    capabilities[definition.id] = { ...capabilities[definition.id], [definition.version]: validatorEntry(definition) };
  }
  const body = {
    registry_version: source.registryVersion,
    registry_digest: registryDigest,
    runtime_version: source.runtimeVersion,
    capabilities
  };
  return { ...body, validator_registry_digest: computeValidatorRegistryDigest(body) };
}

function buildRuntimeRegistry(source: RegistrySource, registryDigest: string, definitions: readonly CapabilityDefinition[]): RuntimeRegistry {
  const capabilities: Record<string, Record<string, RuntimeCapabilityBinding>> = {};
  for (const definition of definitions) {
    const binding: RuntimeCapabilityBinding = {
      registration_key: definition.runtime.registrationKey,
      execution_class: definition.runtime.execution,
      runtime_binding_digest: computeRuntimeBindingDigest(definition.id, definition.version, definition.runtime.registrationKey)
    };
    capabilities[definition.id] = { ...capabilities[definition.id], [definition.version]: binding };
  }
  const body = { registry_version: source.registryVersion, registry_digest: registryDigest, capabilities };
  return { ...body, runtime_registry_digest: computeRuntimeRegistryDigest(body) };
}

function capabilityIdentities(
  validatorRegistry: ValidatorRegistry,
  runtimeRegistry: RuntimeRegistry
): readonly CapabilityIdentityEntry[] {
  return Object.entries(validatorRegistry.capabilities).flatMap(([id, versions]) =>
    Object.entries(versions).map(([version, entry]) => ({
      id,
      version,
      execution_contract_digest: entry.execution_contract_digest,
      runtime_binding_digest: runtimeRegistry.capabilities[id]![version]!.runtime_binding_digest
    }))
  );
}

function appendRelease(
  previousLedger: RegistryReleaseLedger,
  release: RegistryReleaseIdentity,
  identities: readonly CapabilityIdentityEntry[]
): RegistryReleaseLedger {
  try {
    return appendRegistryRelease(previousLedger, release, identities);
  } catch (error: unknown) {
    if (error instanceof RegistryLedgerError) {
      throw new RegistryGenerationError(error.code, error.message);
    }
    throw error;
  }
}

function descriptiveArtifacts(
  source: RegistrySource,
  release: RegistryReleaseIdentity,
  definitions: readonly CapabilityDefinition[]
): Readonly<Record<string, string>> {
  const registryManifest = {
    ...release,
    runtime_version: source.runtimeVersion,
    capabilities: definitions.map(({ id, version }) => ({ id, version }))
  };
  const compilerCatalog = {
    registry_version: release.registry_version,
    registry_digest: release.registry_digest,
    capabilities: definitions.map((definition) => ({
      id: definition.id,
      version: definition.version,
      meaning: definition.semantic.meaning,
      intent_classes: definition.semantic.intentClasses,
      selection_hints: definition.semantic.selectionHints,
      rejection_hints: definition.semantic.rejectionHints,
      public_parameters: [
        ...Object.keys(definition.contract.validator.props),
        ...Object.keys(definition.contract.validator.bindings)
      ],
      events: definition.contract.events
    }))
  };
  const compatibilityManifest = {
    registry_version: release.registry_version,
    registry_digest: release.registry_digest,
    runtime_version: source.runtimeVersion,
    blueprint_schema_range: source.blueprintSchemaRange,
    capabilities: definitions.map((definition) => ({
      id: definition.id,
      version: definition.version,
      availability: definition.lifecycle.availability,
      execution_status: definition.lifecycle.executionStatus,
      execution_class: definition.runtime.execution,
      min_runtime_version: definition.compatibility.minRuntimeVersion,
      max_runtime_version: definition.compatibility.maxRuntimeVersion,
      blueprint_schema_range: definition.compatibility.blueprintSchemaRange,
      deprecated: false,
      replacement: null
    }))
  };
  return {
    "registry-manifest.json": jsonArtifact(registryManifest),
    "compiler-catalog.json": jsonArtifact(compilerCatalog),
    "compatibility-manifest.json": jsonArtifact(compatibilityManifest)
  };
}

export function generateRegistryArtifacts(
  source: RegistrySource,
  previousLedger: RegistryReleaseLedger = emptyRegistryReleaseLedger()
): GeneratedRegistryArtifacts {
  validateRegistrySource(source);
  const definitions = sortedDefinitions(source);
  const registryDigest = `${SHA256_PREFIX}${computeRegistryDigest(source)}`;
  const validatorRegistry = buildValidatorRegistry(source, registryDigest, definitions);
  const runtimeRegistry = buildRuntimeRegistry(source, registryDigest, definitions);
  const release: RegistryReleaseIdentity = {
    registry_version: source.registryVersion,
    registry_digest: registryDigest,
    validator_registry_digest: validatorRegistry.validator_registry_digest,
    runtime_registry_digest: runtimeRegistry.runtime_registry_digest
  };
  const ledger = appendRelease(previousLedger, release, capabilityIdentities(validatorRegistry, runtimeRegistry));
  return {
    identity: { registryVersion: source.registryVersion, registryDigest },
    release,
    ledger,
    validatorRegistry,
    runtimeRegistry,
    files: {
      ...descriptiveArtifacts(source, release, definitions),
      [REGISTRY_RELEASE_LEDGER_FILE]: canonicalizeJson(ledger),
      "validator-registry.ts": typedArtifact("ValidatorRegistry", "validator-contract.js", "VALIDATOR_REGISTRY", validatorRegistry),
      "runtime-registry.ts": typedArtifact("RuntimeRegistry", "registry-release.js", "RUNTIME_REGISTRY", runtimeRegistry)
    }
  };
}

export async function readCommittedReleaseLedger(outputDirectory: string): Promise<RegistryReleaseLedger | undefined> {
  try {
    return parseRegistryReleaseLedger(JSON.parse(await readFile(resolve(outputDirectory, REGISTRY_RELEASE_LEDGER_FILE), "utf8")));
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function writeRegistryArtifacts(outputDirectory: string): Promise<RegistryReleaseIdentity> {
  const previousLedger = await readCommittedReleaseLedger(outputDirectory);
  const generated = generateRegistryArtifacts(CAPABILITY_REGISTRY_SOURCE, previousLedger);
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(
    Object.entries(generated.files).map(([relativePath, contents]) =>
      writeFile(resolve(outputDirectory, relativePath), contents, "utf8")
    )
  );
  return generated.release;
}
