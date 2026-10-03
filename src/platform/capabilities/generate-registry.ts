import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  assertResourceBudgetWithinGlobalCeilings,
  CapabilityAdmissionError,
  matchesCapabilityVersionRange
} from "./admission.js";
import { compareCodePoints } from "../blueprint/type-descriptor.js";
import { CAPABILITY_REGISTRY_SOURCE } from "./registry.js";
import type { CapabilityDefinition, RegistrySource } from "./schema/capability-definition.js";
import {
  CAPABILITY_ID_PATTERN,
  SEMVER_PATTERN,
  type GeneratedCapabilityValidator,
  type ValidatorRegistry
} from "./schema/validator-contract.js";
import { assertValidatorContract, ValidatorContractError } from "./validator-contract-check.js";

const BARE_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

export class RegistryGenerationError extends Error {
  public constructor(
    public readonly code:
      | "DUPLICATE_CAPABILITY_REF"
      | "DUPLICATE_REGISTRATION_KEY"
      | "DEPENDENCY_CYCLE"
      | "INVALID_CAPABILITY_ID"
      | "INVALID_VERSION"
      | "INVALID_DEPENDENCY_VERSION_RANGE"
      | "RESOURCE_CEILING_EXCEEDED"
      | "REGISTRY_VERSION_DIGEST_MISMATCH"
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
  readonly files: Readonly<Record<string, string>>;
}

interface RegistryManifest {
  readonly registry_version: string;
  readonly registry_digest: string;
  readonly capabilities: readonly {
    readonly id: string;
    readonly version: string;
  }[];
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => compareCodePoints(left, right))
        .map(([key, entry]) => [key, canonicalize(entry)])
    );
  }
  return value;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function capabilityRef(definition: CapabilityDefinition): string {
  return `${definition.id}@${definition.version}`;
}

function sortedDefinitions(source: RegistrySource): readonly CapabilityDefinition[] {
  return [...source.capabilities].sort((left, right) => compareCodePoints(capabilityRef(left), capabilityRef(right)));
}

export function canonicalRegistryDigest(digest: string): string {
  return BARE_DIGEST_PATTERN.test(digest) ? `sha256:${digest}` : digest;
}

export function computeRegistryDigest(source: RegistrySource): string {
  const canonicalSource = {
    registryVersion: source.registryVersion,
    runtimeVersion: source.runtimeVersion,
    blueprintSchemaRange: source.blueprintSchemaRange,
    capabilities: sortedDefinitions(source)
  };
  return createHash("sha256").update(canonicalJson(canonicalSource)).digest("hex");
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

function assertSafetyContracts(definitions: readonly CapabilityDefinition[]): void {
  for (const definition of definitions) {
    try {
      assertResourceBudgetWithinGlobalCeilings(definition.runtime.resourceBudget);
    } catch (error: unknown) {
      if (error instanceof CapabilityAdmissionError) {
        throw new RegistryGenerationError("RESOURCE_CEILING_EXCEEDED", error.message);
      }
      throw error;
    }
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
  const definitions = sortedDefinitions(source);
  assertValidIdentifiers(definitions);
  assertUniqueRefs(definitions);
  assertAcyclicDependencies(definitions);
  assertSafetyContracts(definitions);
  assertValidatorContracts(definitions);
}

export function assertRegistryVersionIntegrity(
  previous: RegistryIdentity | undefined,
  current: RegistryIdentity
): void {
  if (
    previous !== undefined &&
    previous.registryVersion === current.registryVersion &&
    canonicalRegistryDigest(previous.registryDigest) !== canonicalRegistryDigest(current.registryDigest)
  ) {
    throw new RegistryGenerationError(
      "REGISTRY_VERSION_DIGEST_MISMATCH",
      `Registry version ${current.registryVersion} is already bound to digest ${previous.registryDigest}.`
    );
  }
}

function jsonArtifact(value: unknown): string {
  return `${JSON.stringify(canonicalize(value), null, 2)}\n`;
}

const GENERATED_HEADER = "// Generated from the canonical Capability Registry. Do not edit.\n";

function typescriptArtifact(name: string, value: unknown): string {
  return `${GENERATED_HEADER}export const ${name} = ${JSON.stringify(canonicalize(value), null, 2)} as const;\n`;
}

function validatorRegistryArtifact(value: ValidatorRegistry): string {
  return `${GENERATED_HEADER}import type { ValidatorRegistry } from "../../src/platform/capabilities/schema/validator-contract.js";\n\nexport const VALIDATOR_REGISTRY: ValidatorRegistry = ${JSON.stringify(
    canonicalize(value),
    null,
    2
  )};\n`;
}

function buildValidatorRegistry(
  identity: RegistryIdentity,
  definitions: readonly CapabilityDefinition[]
): ValidatorRegistry {
  const capabilities: Record<string, Record<string, GeneratedCapabilityValidator>> = {};
  for (const definition of definitions) {
    const versions = capabilities[definition.id] ?? {};
    versions[definition.version] = {
      id: definition.id,
      version: definition.version,
      validator: definition.contract.validator,
      permission_class: definition.runtime.permissionClass,
      resource_budget: definition.runtime.resourceBudget,
      compatibility: definition.compatibility,
      degradation: definition.degradation
    };
    capabilities[definition.id] = versions;
  }
  return {
    registry_version: identity.registryVersion,
    registry_digest: identity.registryDigest,
    capabilities
  };
}

export function generateRegistryArtifacts(
  source: RegistrySource,
  previousIdentity?: RegistryIdentity
): GeneratedRegistryArtifacts {
  validateRegistrySource(source);
  const definitions = sortedDefinitions(source);
  const identity = {
    registryVersion: source.registryVersion,
    registryDigest: canonicalRegistryDigest(computeRegistryDigest(source))
  };
  assertRegistryVersionIntegrity(previousIdentity, identity);

  const registryManifest: RegistryManifest = {
    registry_version: identity.registryVersion,
    registry_digest: identity.registryDigest,
    capabilities: definitions.map(({ id, version }) => ({ id, version }))
  };
  const compilerCatalog = {
    registry_version: identity.registryVersion,
    registry_digest: identity.registryDigest,
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
  const validatorRegistry = buildValidatorRegistry(identity, definitions);
  const runtimeRegistry = {
    registryVersion: identity.registryVersion,
    registryDigest: identity.registryDigest,
    capabilities: definitions.map((definition) => ({
      id: definition.id,
      version: definition.version,
      registrationKey: definition.runtime.registrationKey,
      execution: definition.runtime.execution,
      deterministic: definition.runtime.deterministic,
      replayClass: definition.runtime.replayClass
    }))
  };
  const compatibilityManifest = {
    registry_version: identity.registryVersion,
    registry_digest: identity.registryDigest,
    runtime_version: source.runtimeVersion,
    blueprint_schema_range: source.blueprintSchemaRange,
    capabilities: definitions.map((definition) => ({
      id: definition.id,
      version: definition.version,
      availability: definition.lifecycle.availability,
      min_runtime_version: definition.compatibility.minRuntimeVersion,
      max_runtime_version: definition.compatibility.maxRuntimeVersion,
      blueprint_schema_range: definition.compatibility.blueprintSchemaRange,
      deprecated: false,
      replacement: null
    }))
  };

  return {
    identity,
    files: {
      "registry-manifest.json": jsonArtifact(registryManifest),
      "compiler-catalog.json": jsonArtifact(compilerCatalog),
      "validator-registry.ts": validatorRegistryArtifact(validatorRegistry),
      "runtime-registry.ts": typescriptArtifact("RUNTIME_REGISTRY", runtimeRegistry),
      "compatibility-manifest.json": jsonArtifact(compatibilityManifest)
    }
  };
}

async function readPreviousIdentity(path: string): Promise<RegistryIdentity | undefined> {
  try {
    const previous = JSON.parse(await readFile(path, "utf8")) as {
      registry_version?: unknown;
      registry_digest?: unknown;
    };
    if (typeof previous.registry_version === "string" && typeof previous.registry_digest === "string") {
      return {
        registryVersion: previous.registry_version,
        registryDigest: previous.registry_digest
      };
    }
    return undefined;
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export async function writeRegistryArtifacts(outputDirectory: string): Promise<RegistryIdentity> {
  const manifestPath = resolve(outputDirectory, "registry-manifest.json");
  const previousIdentity = await readPreviousIdentity(manifestPath);
  const generated = generateRegistryArtifacts(CAPABILITY_REGISTRY_SOURCE, previousIdentity);
  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(
    Object.entries(generated.files).map(([relativePath, contents]) =>
      writeFile(resolve(outputDirectory, relativePath), contents, "utf8")
    )
  );
  return generated.identity;
}
