import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { CAPABILITY_REGISTRY_SOURCE } from "./registry.js";
import type { CapabilityDefinition, RegistrySource } from "./schema/capability-definition.js";

const CAPABILITY_ID_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/;
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export class RegistryGenerationError extends Error {
  public constructor(
    public readonly code:
      | "DUPLICATE_CAPABILITY_REF"
      | "DUPLICATE_REGISTRATION_KEY"
      | "DEPENDENCY_CYCLE"
      | "INVALID_CAPABILITY_ID"
      | "INVALID_VERSION"
      | "REGISTRY_VERSION_DIGEST_MISMATCH",
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
        .sort(([left], [right]) => left.localeCompare(right))
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
  return [...source.capabilities].sort((left, right) => capabilityRef(left).localeCompare(capabilityRef(right)));
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

export function validateRegistrySource(source: RegistrySource): void {
  if (!SEMVER_PATTERN.test(source.registryVersion) || !SEMVER_PATTERN.test(source.runtimeVersion)) {
    throw new RegistryGenerationError("INVALID_VERSION", "Registry and runtime versions must be SemVer.");
  }
  const definitions = sortedDefinitions(source);
  assertValidIdentifiers(definitions);
  assertUniqueRefs(definitions);
  assertAcyclicDependencies(definitions);
}

export function assertRegistryVersionIntegrity(
  previous: RegistryIdentity | undefined,
  current: RegistryIdentity
): void {
  if (
    previous !== undefined &&
    previous.registryVersion === current.registryVersion &&
    previous.registryDigest !== current.registryDigest
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

function typescriptArtifact(name: string, value: unknown): string {
  return `// Generated from the canonical Capability Registry. Do not edit.\nexport const ${name} = ${JSON.stringify(
    canonicalize(value),
    null,
    2
  )} as const;\n`;
}

export function generateRegistryArtifacts(
  source: RegistrySource,
  previousIdentity?: RegistryIdentity
): GeneratedRegistryArtifacts {
  validateRegistrySource(source);
  const definitions = sortedDefinitions(source);
  const identity = {
    registryVersion: source.registryVersion,
    registryDigest: computeRegistryDigest(source)
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
      public_parameters: definition.contract.bindings,
      events: definition.contract.events
    }))
  };
  const validatorRegistry = {
    registryVersion: identity.registryVersion,
    registryDigest: identity.registryDigest,
    capabilities: definitions.map((definition) => ({
      id: definition.id,
      version: definition.version,
      propsSchema: definition.contract.propsSchema,
      stateSchema: definition.contract.stateSchema,
      inputs: definition.contract.inputs,
      outputs: definition.contract.outputs,
      actions: definition.contract.actions,
      events: definition.contract.events,
      bindings: definition.contract.bindings,
      operators: definition.contract.operators,
      permissionClass: definition.runtime.permissionClass,
      resourceBudget: definition.runtime.resourceBudget,
      compatibility: definition.compatibility,
      degradation: definition.degradation
    }))
  };
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
      "validator-registry.ts": typescriptArtifact("VALIDATOR_REGISTRY", validatorRegistry),
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
