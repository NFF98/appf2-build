import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import { VALIDATOR_REGISTRY } from "../../generated/capabilities/validator-registry.js";
import { parseRuntimeBounds, parseVersionRange } from "../../src/platform/capabilities/compatibility-grammar.js";
import { generateRegistryArtifacts, RegistryGenerationError } from "../../src/platform/capabilities/generate-registry.js";
import { parseRegistryReleaseLedger, verifyReleaseBundle } from "../../src/platform/capabilities/registry-release.js";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import type { CapabilityDefinition } from "../../src/platform/capabilities/schema/capability-definition.js";
import type { RegistryReleaseBundle, RegistryReleaseLedger } from "../../src/platform/capabilities/schema/registry-release.js";
import type { ValidatorRegistry } from "../../src/platform/capabilities/schema/validator-contract.js";
import type { JsonRecord } from "./blueprint-validation-fixtures.js";
import {
  admit,
  bundleOf,
  definitionOf,
  expectDenied,
  expectIssue,
  expectPassed,
  handlersFor,
  ledgerOf,
  minimalBlueprint,
  registryWithEntry,
  replacing,
  sourceWith,
  storedContent,
  textNode,
  validate,
  variant
} from "./execution-safety-fixtures.js";

const TEXT = { id: "content.text", version: "1.0.0" };
const CARD = { id: "content.card", version: "1.0.0" };
const DEP = { id: "dep.cap", version: "1.0.0" };
type Change = (capabilities: readonly CapabilityDefinition[]) => readonly CapabilityDefinition[];

const lifecycle = (patch: Partial<CapabilityDefinition["lifecycle"]>) => (definition: CapabilityDefinition): CapabilityDefinition => ({
  ...definition,
  lifecycle: { ...definition.lifecycle, ...patch }
});
const compatibility = (patch: Partial<CapabilityDefinition["compatibility"]>) => (definition: CapabilityDefinition): CapabilityDefinition => ({
  ...definition,
  compatibility: { ...definition.compatibility, ...patch }
});
const executionDrift = (definition: CapabilityDefinition): CapabilityDefinition => ({
  ...definition,
  runtime: { ...definition.runtime, resourceBudget: { ...definition.runtime.resourceBudget, maxLocalStateBytes: 1024 } }
});
const bindingDrift = (definition: CapabilityDefinition): CapabilityDefinition => ({
  ...definition,
  runtime: { ...definition.runtime, registrationKey: `${definition.runtime.registrationKey}-v2` }
});
const compose = (...changes: readonly Change[]): Change => (capabilities) => changes.reduce((acc, change) => change(acc), capabilities);
const onText = (change: (definition: CapabilityDefinition) => CapabilityDefinition): Change => replacing(TEXT.id, TEXT.version, change);
const onCard = (change: (definition: CapabilityDefinition) => CapabilityDefinition): Change => replacing(CARD.id, CARD.version, change);

const DEP_TEMPLATE = definitionOf("logic.random");
const dep = (version: string, change: (definition: CapabilityDefinition) => CapabilityDefinition = (definition) => definition): CapabilityDefinition =>
  change(variant(DEP_TEMPLATE, DEP.id, version));
const textRequiresDep: Change = onText(compatibility({ dependencies: [{ id: DEP.id, versionRange: "^1.0.0", required: true }] }));
const withDeps = (...versions: readonly CapabilityDefinition[]): Change => (capabilities) => [...textRequiresDep(capabilities), ...versions];
const withoutText: Change = (capabilities) => capabilities.filter((definition) => definition.id !== TEXT.id);

const registryFor = (change: Change): ValidatorRegistry => bundleOf(sourceWith("7.0.0", change)).validator_registry;
const release = (version: string, change: Change): RegistryReleaseBundle => bundleOf(sourceWith(version, change));

const nodeBlueprint = (): JsonRecord => minimalBlueprint([textNode("node_text")]);
const degradationBlueprint = (ref = TEXT): JsonRecord =>
  minimalBlueprint([], {
    support: { coverage_status: "PARTIALLY_SUPPORTED", degradations: [{ requirement_id: "req_alt", description: "d", capability_refs: [ref], preserves_semantic_core: true }] }
  });
const executionBlueprint = (): JsonRecord =>
  minimalBlueprint([textNode("node_text")], {
    support: { coverage_status: "PARTIALLY_SUPPORTED", degradations: [{ requirement_id: "req_card", description: "d", capability_refs: [CARD], preserves_semantic_core: true }] }
  });

const INELIGIBLE: readonly { readonly label: string; readonly change: Change; readonly code: "F02-ERR-004" | "F02-ERR-005" }[] = [
  { label: "DISABLED", change: onText(lifecycle({ availability: "DISABLED" })), code: "F02-ERR-005" },
  { label: "EXPERIMENTAL", change: onText(lifecycle({ availability: "EXPERIMENTAL" })), code: "F02-ERR-005" },
  { label: "execution_status REVOKED", change: onText(lifecycle({ executionStatus: "REVOKED" })), code: "F02-ERR-005" },
  { label: "Blueprint schema outside range", change: onText(compatibility({ blueprintSchemaRange: "^2.0.0" })), code: "F02-ERR-004" },
  { label: "runtime below inclusive min", change: onText(compatibility({ minRuntimeVersion: "1.0.1", maxRuntimeVersion: "<2.0.0" })), code: "F02-ERR-004" },
  { label: "runtime at exclusive max", change: onText(compatibility({ minRuntimeVersion: "0.9.0", maxRuntimeVersion: "<1.0.0" })), code: "F02-ERR-004" },
  { label: "dependency schema incompatible", change: withDeps(dep("1.0.0", compatibility({ blueprintSchemaRange: "^2.0.0" }))), code: "F02-ERR-005" },
  { label: "dependency runtime incompatible", change: withDeps(dep("1.0.0", compatibility({ minRuntimeVersion: "1.5.0" }))), code: "F02-ERR-005" },
  {
    label: "dependency transitively unavailable",
    change: compose(
      withDeps(dep("1.0.0", compatibility({ dependencies: [{ id: "leaf.cap", versionRange: "1.0.0", required: true }] }))),
      (capabilities) => [...capabilities, lifecycle({ availability: "DISABLED" })(variant(DEP_TEMPLATE, "leaf.cap", "1.0.0"))]
    ),
    code: "F02-ERR-005"
  },
  { label: "dependency REVOKED", change: withDeps(dep("1.0.0", lifecycle({ executionStatus: "REVOKED" }))), code: "F02-ERR-005" },
  { label: "dependency missing", change: textRequiresDep, code: "F02-ERR-005" }
];

function expectValidationEligibility(): void {
  for (const entry of INELIGIBLE) {
    const registry = registryFor(entry.change);
    const nodeResult = validate(nodeBlueprint(), registry);
    expectIssue(nodeResult, { code: entry.code, stage: "V04", path: "$.nodes[1].capability", ref: TEXT }, `V04 ${entry.label}`);
    expect(nodeResult.report.status, entry.label).toBe(entry.code === "F02-ERR-004" ? "INCOMPATIBLE" : "REJECTED");
    expectIssue(
      validate(degradationBlueprint(), registry),
      { code: "F02-ERR-014", stage: "V11", path: "$.support.degradations[0].capability_refs[0]", ref: TEXT },
      `V11 ${entry.label}`
    );
  }
  const unsupportedClass = registryWithEntry(VALIDATOR_REGISTRY, TEXT, (entry) => ({ ...entry, execution_class: "REMOTE_WORKER" as never }));
  expectIssue(validate(nodeBlueprint(), unsupportedClass), { code: "F02-ERR-005", stage: "V04", ref: TEXT }, "V04 unsupported execution_class");
  expectIssue(validate(degradationBlueprint(), unsupportedClass), { code: "F02-ERR-014", stage: "V11", ref: TEXT }, "V11 unsupported execution_class");
  expectIssue(validate(degradationBlueprint({ id: "content.text", version: "9.9.9" })), { code: "F02-ERR-014", stage: "V11" }, "V11 unknown ref");

  expectPassed(validate(nodeBlueprint(), registryFor(onText(compatibility({ minRuntimeVersion: "1.0.0", maxRuntimeVersion: "<1.0.1" })))), "runtime min inclusive / max exclusive");
  const newestDisabled = withDeps(dep("1.1.0", lifecycle({ availability: "DISABLED" })), dep("1.0.0"));
  expectPassed(validate(nodeBlueprint(), registryFor(newestDisabled)), "SemVer-descending first eligible dependency candidate");
}

function expectGrammar(): void {
  expect(parseRuntimeBounds("1.0.0", "<2.0.0")).toBeDefined();
  for (const [min, max] of [["1.0.0", "2.0.0"], ["1.0.0", "<=2.0.0"], ["^1.0.0", "<2.0.0"], ["1.0.0", "<1.0.0"], ["1.0.0", "< 2.0.0"]] as const) {
    expect(parseRuntimeBounds(min, max), `${min} ${max}`).toBeUndefined();
  }
  for (const range of ["1.0.0", "^1.0.0", ">=1.0.0 <2.0.0"]) {
    expect(parseVersionRange(range), range).toBeDefined();
  }
  for (const range of ["~1.0.0", ">1.0.0", "1.x", "*", "", ">=1.0.0  <2.0.0", ">=2.0.0 <1.0.0", ">=1.0.0", "<2.0.0", "1.0.0 || 2.0.0"]) {
    expect(parseVersionRange(range), range).toBeUndefined();
  }
  for (const change of [onText(compatibility({ maxRuntimeVersion: "2.0.0" })), onText(compatibility({ blueprintSchemaRange: "~1.0.0" }))]) {
    expectGeneration(() => bundleOf(sourceWith("7.0.0", change)), "INVALID_COMPATIBILITY_RANGE");
  }
}

function expectGeneration(action: () => unknown, code: RegistryGenerationError["code"]): void {
  expect(action).toThrowError(RegistryGenerationError);
  try {
    action();
  } catch (error: unknown) {
    expect((error as RegistryGenerationError).code).toBe(code);
  }
}

async function committedLedger(): Promise<RegistryReleaseLedger> {
  return parseRegistryReleaseLedger(JSON.parse(await readFile(resolve(process.cwd(), "generated/capabilities/registry-release-ledger.json"), "utf8")));
}

function expectLedgerIdentity(ledger: RegistryReleaseLedger, pinned: RegistryReleaseBundle): void {
  const generate = (version: string, change: Change, previous = ledger) => generateRegistryArtifacts(sourceWith(version, change), previous);
  expectGeneration(() => generate("7.0.0", onText(lifecycle({ availability: "DISABLED" }))), "REGISTRY_VERSION_DIGEST_MISMATCH");
  const mutated = structuredClone(pinned) as { validator_registry: { capabilities: Record<string, Record<string, { availability: string }>> } };
  mutated.validator_registry.capabilities[TEXT.id]![TEXT.version]!.availability = "DISABLED";
  expect(verifyReleaseBundle(mutated as unknown as RegistryReleaseBundle, ledger)).toBe("VALIDATOR_ARTIFACT_DIGEST_MISMATCH");
  const forged = release("7.0.0", onText(lifecycle({ availability: "DISABLED" })));
  expect(verifyReleaseBundle({ ...forged, identity: { ...forged.identity, registry_digest: pinned.identity.registry_digest } }, ledger)).not.toBeUndefined();
  expect(verifyReleaseBundle(forged, ledger)).toBe("RELEASE_NOT_IN_LEDGER");

  const patch = generate("7.0.1", onText(lifecycle({ executionStatus: "REVOKED" })));
  expect(patch.ledger.releases.map((entry) => entry.registry_version)).toEqual(["7.0.0", "7.0.1"]);
  expect(patch.ledger.capability_identities).toEqual(ledger.capability_identities);
  expectGeneration(() => generate("7.0.1", onText(executionDrift)), "CAPABILITY_VERSION_REUSE");
  expectGeneration(() => generate("7.0.1", onText(bindingDrift)), "CAPABILITY_VERSION_REUSE");
  const removed = generate("7.0.1", withoutText);
  expectGeneration(() => generate("7.0.2", onText(bindingDrift), removed.ledger), "CAPABILITY_VERSION_REUSE");
  expectGeneration(() => generate("7.0.2", onText(executionDrift), removed.ledger), "CAPABILITY_VERSION_REUSE");
  expect(generate("7.0.2", (capabilities) => capabilities, removed.ledger).ledger.releases).toHaveLength(3);
  expectGeneration(() => generate("6.9.0", (capabilities) => capabilities), "RELEASE_LEDGER_INVALID");
}

const PINNED: RegistryReleaseBundle = bundleOf(CAPABILITY_REGISTRY_SOURCE);

const CURRENT_DENIALS: readonly { readonly label: string; readonly current: RegistryReleaseBundle; readonly reason: string }[] = [
  { label: "direct ref REVOKED by PATCH release", current: release("7.0.1", onText(lifecycle({ executionStatus: "REVOKED" }))), reason: "CAPABILITY_REVOKED" },
  { label: "direct ref DISABLED", current: release("7.0.1", onText(lifecycle({ availability: "DISABLED" }))), reason: "CAPABILITY_NOT_ENABLED" },
  { label: "direct ref missing in current", current: release("7.0.1", withoutText), reason: "UNKNOWN_CAPABILITY" },
  { label: "direct ref runtime incompatible", current: release("7.0.1", onText(compatibility({ minRuntimeVersion: "1.0.1" }))), reason: "RUNTIME_INCOMPATIBLE" },
  { label: "degradation ref REVOKED", current: release("7.0.1", onCard(lifecycle({ executionStatus: "REVOKED" }))), reason: "CAPABILITY_REVOKED" },
  { label: "direct execution_contract_digest drift", current: release("7.0.1", onText(executionDrift)), reason: "EXECUTION_IDENTITY_DRIFT" },
  { label: "direct runtime_binding_digest drift", current: release("7.0.1", onText(bindingDrift)), reason: "EXECUTION_IDENTITY_DRIFT" },
  { label: "degradation execution_contract_digest drift", current: release("7.0.1", onCard(executionDrift)), reason: "EXECUTION_IDENTITY_DRIFT" },
  { label: "degradation runtime_binding_digest drift", current: release("7.0.1", onCard(bindingDrift)), reason: "EXECUTION_IDENTITY_DRIFT" }
];

async function expectFreshCurrentEligibility(): Promise<void> {
  const allowed = await admit(executionBlueprint(), { pinned: PINNED });
  expect(allowed.executable).toBe(true);
  if (allowed.executable) {
    expect(allowed.admission).toMatchObject({ ...PINNED.identity, trust_status: "VALIDATED", runtime_version: "1.0.0", issued_at: "2026-10-04T00:00:00.000Z", expires_at: "2026-10-04T00:00:30.000Z" });
  }
  for (const entry of CURRENT_DENIALS) {
    expectDenied(await admit(executionBlueprint(), { pinned: PINNED, current: entry.current }), { step: "E07", code: "F02-ERR-017", reason: entry.reason }, entry.label);
  }
}

async function expectFreshDependencyEligibility(): Promise<void> {
  const pinned = release("7.0.0", withDeps(dep("1.0.0")));
  const scenarios: readonly { readonly label: string; readonly current: RegistryReleaseBundle; readonly allowed: boolean; readonly reason?: string }[] = [
    { label: "same-ref dependency execution drift", current: release("7.0.1", withDeps(dep("1.0.0", executionDrift))), allowed: false, reason: "EXECUTION_IDENTITY_DRIFT" },
    { label: "same-ref dependency runtime drift", current: release("7.0.1", withDeps(dep("1.0.0", bindingDrift))), allowed: false, reason: "EXECUTION_IDENTITY_DRIFT" },
    { label: "new eligible version absent from pinned", current: release("7.0.1", withDeps(dep("1.1.0"), dep("1.0.0", executionDrift))), allowed: true },
    { label: "new version absent from pinned but DISABLED", current: release("7.0.1", withDeps(dep("1.1.0", lifecycle({ availability: "DISABLED" })), dep("1.0.0", executionDrift))), allowed: false, reason: "CAPABILITY_DEPENDENCY_UNAVAILABLE" },
    { label: "dependency schema incompatible", current: release("7.0.1", withDeps(dep("1.1.0", compatibility({ blueprintSchemaRange: "^2.0.0" })))), allowed: false, reason: "BLUEPRINT_SCHEMA_INCOMPATIBLE" },
    { label: "dependency runtime incompatible", current: release("7.0.1", withDeps(dep("1.1.0", compatibility({ minRuntimeVersion: "1.5.0" })))), allowed: false, reason: "RUNTIME_INCOMPATIBLE" },
    {
      label: "dependency transitively unavailable",
      current: release(
        "7.0.1",
        compose(withDeps(dep("1.1.0", compatibility({ dependencies: [{ id: "leaf.cap", versionRange: "1.0.0", required: true }] }))), (capabilities) => [
          ...capabilities,
          lifecycle({ availability: "DISABLED" })(variant(DEP_TEMPLATE, "leaf.cap", "1.0.0"))
        ])
      ),
      allowed: false,
      reason: "CAPABILITY_DEPENDENCY_UNAVAILABLE"
    }
  ];
  for (const scenario of scenarios) {
    const decision = await admit(nodeBlueprint(), { pinned, current: scenario.current, handlers: handlersFor(pinned) });
    if (scenario.allowed) {
      expect(decision.executable, scenario.label).toBe(true);
    } else {
      expectDenied(decision, { step: "E07", code: "F02-ERR-017", reason: scenario.reason }, scenario.label);
    }
  }
}

async function expectPinnedHandlerBinding(): Promise<void> {
  const tamperedRuntime = structuredClone(PINNED) as { runtime_registry: { capabilities: Record<string, Record<string, { registration_key: string }>> } };
  tamperedRuntime.runtime_registry.capabilities[TEXT.id]![TEXT.version]!.registration_key = "content/text-evil";
  expectDenied(
    await admit(nodeBlueprint(), { pinned: PINNED, servedPinned: tamperedRuntime, handlers: new Map([...handlersFor(PINNED), ["content/text-evil", () => "evil"]]) }),
    { step: "E06", code: "F02-ERR-017" },
    "pinned RuntimeRegistry identity mismatch"
  );
  const missingPinnedKey = await admit(nodeBlueprint(), { pinned: PINNED, handlers: handlersFor(PINNED, ["content/text"]) });
  expectDenied(missingPinnedKey, { step: "E08", http: 503, reason: "RUNTIME_HANDLER_MISSING" }, "missing pinned direct Node key");
  const substitute = new Map([...handlersFor(PINNED, ["content/text"]), ["content/text-v2", () => "current"]]);
  expectDenied(await admit(nodeBlueprint(), { pinned: PINNED, handlers: substitute }), { step: "E08", http: 503, reason: "RUNTIME_HANDLER_MISSING" }, "current mapping cannot substitute");
  const addDep: Change = (capabilities) => [...capabilities, dep("1.0.0")];
  const currentWithDep = release("7.0.1", addDep);
  expectDenied(
    await admit(degradationBlueprint(DEP), {
      pinned: PINNED,
      stored: storedContent(degradationBlueprint(DEP), release("7.0.0", addDep)),
      content: { admitted_registry_digest: PINNED.identity.registry_digest },
      current: currentWithDep,
      ledger: ledgerOf(PINNED, currentWithDep)
    }),
    { step: "E06", code: "F02-ERR-017" },
    "degradation ref absent from pinned ValidatorRegistry"
  );
  const currentRemap = release("7.0.1", onText(bindingDrift));
  expectDenied(
    await admit(nodeBlueprint(), { pinned: PINNED, current: currentRemap, handlers: handlersFor(currentRemap) }),
    { step: "E07", code: "F02-ERR-017", reason: "EXECUTION_IDENTITY_DRIFT" },
    "current re-mapped handler never replaces pinned binding"
  );
}

describe("F02 disabled / revoked / incompatible capabilities never admit or execute", () => {
  test("TEST-F02-011 enforces V04/V11 eligibility, Registry v7 release identity and fresh E07 pinned/current execution checks", async () => {
    expectValidationEligibility();
    expectGrammar();
    expectLedgerIdentity(await committedLedger(), PINNED);
    await expectFreshCurrentEligibility();
    await expectFreshDependencyEligibility();
    await expectPinnedHandlerBinding();
    expectDenied(await admit(nodeBlueprint(), { pinned: PINNED, content: { trust_status: "REVOKED" } }), { step: "E02", code: "F02-ERR-016" }, "durable REVOKED");
    expectDenied(await admit(nodeBlueprint(), { pinned: PINNED, content: { trust_status: "INCOMPATIBLE" } }), { step: "E03", code: "F02-ERR-017" }, "durable INCOMPATIBLE");
  });
});