import { expect } from "vitest";

import { admitBlueprint, type BlueprintAdmissionRepository } from "../../src/platform/blueprint/blueprint-admission.js";
import {
  createExecutionAdmissionService,
  type ExecutionAdmissionDecision,
  type StoredBlueprintContent
} from "../../src/platform/blueprint/execution-admission.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import type { BlueprintValidationResult, CapabilityRef } from "../../src/platform/blueprint/validation-types.js";
import { generateRegistryArtifacts } from "../../src/platform/capabilities/generate-registry.js";
import { createTrustedRuntimeHandlerCatalog } from "../../src/platform/capabilities/registry-release.js";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import type { CapabilityDefinition, RegistrySource } from "../../src/platform/capabilities/schema/capability-definition.js";
import type {
  RegistryReleaseBundle,
  RegistryReleaseIdentity,
  RegistryReleaseLedger,
  RegistryReleaseSource
} from "../../src/platform/capabilities/schema/registry-release.js";
import type { GeneratedCapabilityValidator, ValidatorRegistry } from "../../src/platform/capabilities/schema/validator-contract.js";
import { encode, source, type JsonRecord } from "./blueprint-validation-fixtures.js";

export const { lit, state, op } = source;
export const RUNTIME_VERSION = "1.0.0";
export const SCHEMA_RANGE = "^1.0.0";

export function container(id: string, children: readonly string[] = []): JsonRecord {
  return {
    id,
    capability: { id: "layout.container", version: "1.0.0" },
    props: { direction: lit("COLUMN"), gap: lit("MD"), align: lit("STRETCH") },
    bindings: {},
    events: {},
    children: [...children]
  };
}

export function textNode(id: string, text = "x", version = "1.0.0"): JsonRecord {
  return {
    id,
    capability: { id: "content.text", version },
    props: { role: lit("BODY") },
    bindings: { text: lit(text) },
    events: {},
    children: []
  };
}

export function capabilityNode(id: string, ref: CapabilityRef, fields: Partial<JsonRecord> = {}): JsonRecord {
  return { id, capability: { ...ref }, props: {}, bindings: {}, events: {}, children: [], ...fields };
}

/** Minimal valid Blueprint: one root container whose children are the supplied nodes. */
export function minimalBlueprint(children: readonly JsonRecord[] = [], overrides: JsonRecord = {}): JsonRecord {
  return {
    schema_version: "1.0.0",
    registry_version: "7.0.0",
    kind: "APP",
    meta: { title: "t", description: "" },
    support: { coverage_status: "FULLY_SUPPORTED", degradations: [] },
    state: {},
    rules: [],
    actions: [],
    nodes: [container("node_root", children.map((child) => child.id as string)), ...children],
    root_node_id: "node_root",
    result: { outputs: [] },
    ...overrides
  };
}

export function validate(candidate: unknown, registry?: ValidatorRegistry): BlueprintValidationResult {
  return validateBlueprintCandidate(encode(candidate), registry === undefined ? {} : { registry });
}

export interface ExpectedIssue {
  readonly code: string;
  readonly stage: string;
  readonly path?: string;
  readonly ref?: CapabilityRef;
}

export function expectIssue(result: BlueprintValidationResult, expected: ExpectedIssue, label: string): void {
  const [issue] = result.report.issues;
  expect(result.admissible, label).toBeUndefined();
  expect({ code: issue?.error_code, stage: issue?.stage }, label).toEqual({ code: expected.code, stage: expected.stage });
  if (expected.path !== undefined) {
    expect(issue?.json_path, label).toBe(expected.path);
  }
  if (expected.ref !== undefined) {
    expect(issue?.capability_ref, label).toEqual(expected.ref);
  }
}

export function expectPassed(result: BlueprintValidationResult, label: string): void {
  expect(result.report.issues, label).toEqual([]);
  expect(result.report.status, label).toBe("PASSED");
}

/** Deep-cloned trusted ValidatorRegistry with one exact entry rewritten (validation-time registry only). */
export function registryWithEntry(
  base: ValidatorRegistry,
  ref: CapabilityRef,
  change: (entry: GeneratedCapabilityValidator) => GeneratedCapabilityValidator
): ValidatorRegistry {
  const clone = structuredClone(base) as { capabilities: Record<string, Record<string, GeneratedCapabilityValidator>> };
  const versions = clone.capabilities[ref.id]!;
  versions[ref.version] = change(versions[ref.version]!);
  return clone as unknown as ValidatorRegistry;
}

export function definitionOf(id: string, version = "1.0.0"): CapabilityDefinition {
  const found = CAPABILITY_REGISTRY_SOURCE.capabilities.find((entry) => entry.id === id && entry.version === version);
  expect(found, `${id}@${version}`).toBeDefined();
  return found!;
}

export function sourceWith(
  registryVersion: string,
  change: (capabilities: readonly CapabilityDefinition[]) => readonly CapabilityDefinition[] = (capabilities) => capabilities
): RegistrySource {
  return { ...CAPABILITY_REGISTRY_SOURCE, registryVersion, capabilities: change(CAPABILITY_REGISTRY_SOURCE.capabilities) };
}

export function replacing(id: string, version: string, change: (definition: CapabilityDefinition) => CapabilityDefinition) {
  return (capabilities: readonly CapabilityDefinition[]): readonly CapabilityDefinition[] =>
    capabilities.map((definition) => (definition.id === id && definition.version === version ? change(definition) : definition));
}

export function variant(template: CapabilityDefinition, id: string, version: string, overrides: Partial<CapabilityDefinition> = {}): CapabilityDefinition {
  return {
    ...template,
    id,
    version,
    runtime: { ...template.runtime, registrationKey: `${id.replace(".", "/")}/${version}` },
    ...overrides
  };
}

export function bundleOf(registrySource: RegistrySource): RegistryReleaseBundle {
  const generated = generateRegistryArtifacts(registrySource);
  return { identity: generated.release, validator_registry: generated.validatorRegistry, runtime_registry: generated.runtimeRegistry };
}

export function ledgerOf(...bundles: readonly RegistryReleaseBundle[]): RegistryReleaseLedger {
  return {
    schema_version: "1.0.0",
    releases: bundles.map((bundle): RegistryReleaseIdentity => ({ ...bundle.identity })),
    capability_identities: {}
  };
}

export function handlersFor(bundle: RegistryReleaseBundle, omit: readonly string[] = []): ReadonlyMap<string, unknown> {
  const keys = Object.values(bundle.runtime_registry.capabilities).flatMap((versions) =>
    Object.values(versions).map((binding) => binding.registration_key)
  );
  return new Map(keys.filter((key) => !omit.includes(key)).map((key) => [key, () => key] as const));
}

export interface AdmissionScenario {
  readonly pinned: RegistryReleaseBundle;
  readonly current?: RegistryReleaseBundle;
  readonly ledger?: unknown;
  readonly releases?: readonly RegistryReleaseBundle[];
  readonly handlers?: ReadonlyMap<string, unknown>;
  readonly content?: Partial<StoredBlueprintContent>;
  readonly fail?: ReadonlySet<"content" | "ledger" | "pinned" | "current" | "catalog">;
  readonly catalog?: unknown;
  readonly stored?: StoredBlueprintContent;
  /** Bundle the release source returns for the pinned lookup (e.g. a tampered artifact under the ledger identity). */
  readonly servedPinned?: unknown;
  readonly schemaRange?: string;
  readonly requestHash?: string;
  /** Untrusted extra request values a client might append; the public API accepts only content_hash. */
  readonly clientArgs?: readonly unknown[];
}

function failing<T>(fail: AdmissionScenario["fail"], key: "content" | "ledger" | "pinned" | "current" | "catalog", value: () => T): Promise<T> {
  return fail?.has(key) === true ? Promise.reject(new Error(`${key} timeout`)) : Promise.resolve().then(value);
}

/** Validates a Blueprint against the pinned release and stores it as durable VALIDATED content. */
export function storedContent(blueprint: JsonRecord, pinned: RegistryReleaseBundle): StoredBlueprintContent {
  const result = validate(blueprint, pinned.validator_registry);
  expectPassed(result, "pinned validation");
  const admissible = result.admissible!;
  return {
    content_hash: admissible.contentHash,
    canonical_blueprint: admissible.canonicalJson,
    schema_version: admissible.blueprint.schema_version,
    registry_version: admissible.blueprint.registry_version,
    trust_status: "VALIDATED",
    admitted_registry_digest: result.report.registry_digest
  };
}

export async function admit(blueprint: JsonRecord, scenario: AdmissionScenario): Promise<ExecutionAdmissionDecision> {
  const base = scenario.stored ?? storedContent(blueprint, scenario.pinned);
  const stored = { ...base, ...scenario.content };
  const requestHash = base.content_hash;
  const current = scenario.current ?? scenario.pinned;
  const known = [scenario.pinned, current, ...(scenario.releases ?? [])];
  const releases: RegistryReleaseSource = {
    loadReleaseLedger: () => failing(scenario.fail, "ledger", () => scenario.ledger ?? ledgerOf(...uniqueByVersion(known))),
    loadPinnedRelease: (identity) =>
      failing(scenario.fail, "pinned", () =>
        scenario.servedPinned === undefined
          ? known.find((bundle) => sameTuple(bundle.identity, identity))
          : (scenario.servedPinned as RegistryReleaseBundle)
      ),
    loadCurrentRelease: () => failing(scenario.fail, "current", () => current),
    loadRuntimeHandlerCatalog: () =>
      failing(scenario.fail, "catalog", () => scenario.catalog ?? createTrustedRuntimeHandlerCatalog(scenario.handlers ?? handlersFor(scenario.pinned)))
  };
  const service = createExecutionAdmissionService({
    content: { readContent: (hash) => failing(scenario.fail, "content", () => (hash === requestHash ? stored : undefined)) },
    releases,
    runtimeVersion: RUNTIME_VERSION,
    supportedBlueprintSchemaRange: scenario.schemaRange ?? SCHEMA_RANGE,
    now: () => new Date("2026-10-04T00:00:00.000Z"),
    newAdmissionId: () => "00000000-0000-4000-8000-000000000000"
  });
  const admitWithClientValues = service.admit as (contentHash: string, ...clientArgs: unknown[]) => Promise<ExecutionAdmissionDecision>;
  return admitWithClientValues(scenario.requestHash ?? requestHash, ...(scenario.clientArgs ?? []));
}

function sameTuple(left: RegistryReleaseIdentity, right: RegistryReleaseIdentity): boolean {
  return (
    left.registry_version === right.registry_version &&
    left.registry_digest === right.registry_digest &&
    left.validator_registry_digest === right.validator_registry_digest &&
    left.runtime_registry_digest === right.runtime_registry_digest
  );
}

function uniqueByVersion(bundles: readonly RegistryReleaseBundle[]): readonly RegistryReleaseBundle[] {
  const byVersion = new Map(bundles.map((bundle) => [bundle.identity.registry_version, bundle] as const));
  return [...byVersion.values()].sort((left, right) =>
    left.identity.registry_version.localeCompare(right.identity.registry_version, "en", { numeric: true })
  );
}

export interface ExpectedDenial {
  readonly step: string;
  readonly code?: string;
  readonly http?: number;
  readonly reason?: string;
}

export function expectDenied(decision: ExecutionAdmissionDecision, expected: ExpectedDenial, label: string): void {
  expect(decision.executable, label).toBe(false);
  if (decision.executable) {
    return;
  }
  expect(decision.step, label).toBe(expected.step);
  expect(decision.error_code, label).toBe(expected.code);
  expect(decision.http_status, label).toBe(expected.http);
  if (expected.reason !== undefined) {
    expect(`${decision.reason} ${decision.eligibility?.reason ?? ""} ${decision.eligibility?.cause?.reason ?? ""}`, label).toContain(expected.reason);
  }
}

export function inMemoryAdmissionRepository(): BlueprintAdmissionRepository & { trust: Map<string, "VALIDATED" | "REVOKED" | "INCOMPATIBLE"> } {
  const trust = new Map<string, "VALIDATED" | "REVOKED" | "INCOMPATIBLE">();
  return {
    trust,
    recordValidationRun: () => Promise.resolve(),
    admitValidatedContent: (_run, content) => {
      const existing = trust.get(content.content_hash);
      if (existing !== undefined) {
        return Promise.resolve({ kind: "REUSED" as const, trustStatus: existing });
      }
      trust.set(content.content_hash, "VALIDATED");
      return Promise.resolve({ kind: "INSERTED" as const });
    }
  };
}

export { admitBlueprint };
