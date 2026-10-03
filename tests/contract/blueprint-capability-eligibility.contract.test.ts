import { describe, expect, test } from "vitest";

import { VALIDATOR_REGISTRY } from "../../generated/capabilities/validator-registry.js";
import type { ExecutionAdmissionDecision } from "../../src/platform/blueprint/execution-admission.js";
import { hashBlueprint } from "../../src/platform/blueprint/content-identity.js";
import type { TrustedRegistrySnapshot } from "../../src/platform/capabilities/execution-contract.js";
import { generateRegistryArtifacts, RegistryGenerationError } from "../../src/platform/capabilities/generate-registry.js";
import type { CapabilityDefinition, RegistrySource } from "../../src/platform/capabilities/schema/capability-definition.js";
import type { ValidatorRegistry } from "../../src/platform/capabilities/schema/validator-contract.js";
import { issueOf, nodeIndex, validBlueprint, type JsonRecord } from "./blueprint-validation-fixtures.js";
import {
  ADMISSION_ID,
  admitValidated,
  blueprintWithTextNode,
  cloneCapability,
  NOW,
  policyPatch,
  registrySource,
  requestAdmission,
  snapshotOf,
  snapshotStore,
  validateAgainst,
  withCompatibility,
  type AdmittedBlueprint
} from "./registry-snapshot-fixtures.js";

const BASE = registrySource("6.0.0");
const BASE_SNAPSHOT = snapshotOf(BASE);
const TEXT_NODE = `$.nodes[${nodeIndex("node_title")}].capability`;
const EXTRA_NODE = `$.nodes[${(validBlueprint().nodes as unknown[]).length}].capability`;
const INCOMPATIBLE_SCHEMA = { blueprintSchemaRange: ">=2.0.0 <3.0.0" };
const INCOMPATIBLE_RUNTIME = { minRuntimeVersion: "2.0.0", maxRuntimeVersion: "<3.0.0" };

function withVersion(candidate: JsonRecord, registryVersion: string): JsonRecord {
  return { ...candidate, registry_version: registryVersion };
}

function dependent(): CapabilityDefinition {
  return withCompatibility(cloneCapability("content.text", "content.dependent", "1.0.0"), {
    dependencies: [{ id: "content.helper", versionRange: "^1.0.0", required: true }]
  });
}

function helper(version: string, compatibility: Partial<CapabilityDefinition["compatibility"]> = {}): CapabilityDefinition {
  return withCompatibility(cloneCapability("content.text", "content.helper", version), compatibility);
}

function leaf(version: string, compatibility: Partial<CapabilityDefinition["compatibility"]> = {}): CapabilityDefinition {
  return withCompatibility(cloneCapability("content.text", "content.leaf", version), compatibility);
}

function withExtras(registryVersion: string, extras: readonly CapabilityDefinition[]): RegistrySource {
  return registrySource(registryVersion, [...BASE.capabilities, ...extras]);
}

function expectV04(snapshot: TrustedRegistrySnapshot, candidate: JsonRecord, expected: readonly [string, string, string]): void {
  const result = validateAgainst(candidate, snapshot);
  const [status, code, path] = expected;
  expect(result.report.status, `${snapshot.registry_version} ${code}`).toBe(status);
  expect(result.admissible).toBeUndefined();
  expect(issueOf(result)).toEqual({ code, stage: "V04", path });
}

function expectPolicyDenialsAtV04(): void {
  const disabled = snapshotOf(policyPatch(BASE, "6.0.1", "content.text", { availability: "DISABLED" }));
  const experimental = snapshotOf(policyPatch(BASE, "6.0.2", "content.text", { availability: "EXPERIMENTAL" }));
  const revoked = snapshotOf(policyPatch(BASE, "6.0.3", "content.text", { executionStatus: "REVOKED" }));
  for (const snapshot of [disabled, experimental, revoked]) {
    expectV04(snapshot, withVersion(validBlueprint(), snapshot.registry_version), ["REJECTED", "F02-ERR-005", TEXT_NODE]);
  }

  const textEntry = BASE_SNAPSHOT.validator_registry.capabilities["content.text"]!["1.0.0"]!;
  const untrustedClass: ValidatorRegistry = {
    ...BASE_SNAPSHOT.validator_registry,
    capabilities: {
      ...BASE_SNAPSHOT.validator_registry.capabilities,
      "content.text": { "1.0.0": { ...textEntry, execution_class: "REMOTE_WORKER" as never } }
    }
  };
  expectV04({ ...BASE_SNAPSHOT, validator_registry: untrustedClass }, validBlueprint(), ["REJECTED", "F02-ERR-005", TEXT_NODE]);

  const runtime = validateAgainst(validBlueprint(), BASE_SNAPSHOT, "2.0.0");
  expect(runtime.report.status).toBe("INCOMPATIBLE");
  expect(issueOf(runtime)).toEqual({ code: "F02-ERR-004", stage: "V04", path: "$.nodes[0].capability" });

  const future = snapshotOf(withExtras("6.1.0", [withCompatibility(cloneCapability("content.text", "content.future", "1.0.0"), INCOMPATIBLE_SCHEMA)]));
  expectV04(future, blueprintWithTextNode("6.1.0", "content.future", "1.0.0"), ["INCOMPATIBLE", "F02-ERR-004", EXTRA_NODE]);
}

function expectDependencyDenialsAtV04(): void {
  const cases: readonly (readonly [string, readonly CapabilityDefinition[]])[] = [
    ["6.2.0", [dependent(), helper("1.0.0", INCOMPATIBLE_SCHEMA)]],
    ["6.3.0", [dependent(), helper("1.0.0", INCOMPATIBLE_RUNTIME)]],
    ["6.4.0", [dependent(), helper("1.0.0", { dependencies: [{ id: "content.leaf", versionRange: "^1.0.0", required: true }] }), leaf("1.0.0", INCOMPATIBLE_SCHEMA)]]
  ];
  for (const [version, extras] of cases) {
    expectV04(snapshotOf(withExtras(version, extras)), blueprintWithTextNode(version, "content.dependent", "1.0.0"), [
      "REJECTED",
      "F02-ERR-005",
      EXTRA_NODE
    ]);
  }

  const fallback = snapshotOf(withExtras("6.5.0", [dependent(), helper("1.1.0", INCOMPATIBLE_SCHEMA), helper("1.0.0")]));
  expect(validateAgainst(blueprintWithTextNode("6.5.0", "content.dependent", "1.0.0"), fallback).report.status).toBe("PASSED");
}

function expectRevokeAndDisablePublishNewSnapshots(): void {
  expect(BASE_SNAPSHOT.registry_digest).toBe(VALIDATOR_REGISTRY.registry_digest);
  const baseText = BASE_SNAPSHOT.validator_registry.capabilities["content.text"]!["1.0.0"]!;
  for (const [version, lifecycle] of [
    ["6.0.1", { availability: "DISABLED" }],
    ["6.0.3", { executionStatus: "REVOKED" }]
  ] as const) {
    const patch = snapshotOf(policyPatch(BASE, version, "content.text", lifecycle));
    const patchedText = patch.validator_registry.capabilities["content.text"]!["1.0.0"]!;
    expect(patch.registry_version).not.toBe(BASE_SNAPSHOT.registry_version);
    expect(patch.registry_digest).not.toBe(BASE_SNAPSHOT.registry_digest);
    expect(patchedText.execution_contract_digest).toBe(baseText.execution_contract_digest);
    expect([patchedText.availability, patchedText.execution_status]).not.toEqual([baseText.availability, baseText.execution_status]);
  }
  const previous = { registryVersion: "6.0.0", registryDigest: BASE_SNAPSHOT.registry_digest };
  let code: string | undefined;
  try {
    generateRegistryArtifacts(policyPatch(BASE, "6.0.0", "content.text", { executionStatus: "REVOKED" }), previous);
  } catch (error: unknown) {
    code = error instanceof RegistryGenerationError ? error.code : "UNEXPECTED";
  }
  expect(code).toBe("REGISTRY_VERSION_DIGEST_MISMATCH");
}

function denial(stage: string, reason: string, id?: string): Partial<ExecutionAdmissionDecision> {
  const ref = id === undefined ? {} : { capability_ref: { id, version: "1.0.0" } };
  return { kind: "DENIED", executable: false, stage, error_code: "F02-ERR-017", reason, ...ref } as Partial<ExecutionAdmissionDecision>;
}

async function decide(admitted: AdmittedBlueprint, pinned: TrustedRegistrySnapshot, current: TrustedRegistrySnapshot): Promise<ExecutionAdmissionDecision> {
  return requestAdmission(admitted, snapshotStore({ pinned: [pinned], current: async () => current }));
}

async function expectCurrentPolicyDenialsAtE07(): Promise<void> {
  const admitted = await admitValidated(validBlueprint(), BASE_SNAPSHOT);
  const allowed = await decide(admitted, BASE_SNAPSHOT, BASE_SNAPSHOT);
  expect(allowed).toEqual({
    kind: "ALLOWED",
    admission: {
      admission_version: "1.0.0",
      admission_id: ADMISSION_ID,
      content_hash: admitted.contentHash,
      executable: true,
      trust_status: "VALIDATED",
      schema_version: "1.0.0",
      registry_version: "6.0.0",
      registry_digest: BASE_SNAPSHOT.registry_digest,
      runtime_version: "1.0.0",
      issued_at: NOW.toISOString(),
      expires_at: new Date(NOW.getTime() + 30_000).toISOString()
    }
  });

  const disabled = snapshotOf(policyPatch(BASE, "6.0.1", "content.text", { availability: "DISABLED" }));
  expect(await decide(admitted, BASE_SNAPSHOT, disabled)).toEqual(denial("E07", "CAPABILITY_UNAVAILABLE", "content.text"));
  const revoked = snapshotOf(policyPatch(BASE, "6.0.3", "content.text", { executionStatus: "REVOKED" }));
  expect(await decide(admitted, BASE_SNAPSHOT, revoked)).toEqual(denial("E07", "CAPABILITY_REVOKED", "content.text"));

  const withoutNotice = snapshotOf(registrySource("6.0.5", BASE.capabilities.filter(({ id }) => id !== "system.notice")));
  expect(await decide(admitted, BASE_SNAPSHOT, withoutNotice)).toEqual(denial("E07", "CURRENT_SNAPSHOT_MISSING_REF", "system.notice"));

  const drifted = snapshotOf(
    registrySource(
      "6.0.6",
      BASE.capabilities.map((definition) =>
        definition.id === "content.text"
          ? { ...definition, runtime: { ...definition.runtime, resourceBudget: { ...definition.runtime.resourceBudget, maxInstancesPerBlueprint: 50 } } }
          : definition
      )
    )
  );
  expect(await decide(admitted, BASE_SNAPSHOT, drifted)).toEqual(denial("E07", "EXECUTION_CONTRACT_DIGEST_DRIFT", "content.text"));
}

async function expectCurrentDependencyDenialsAtE07(): Promise<void> {
  const leafDependency = { dependencies: [{ id: "content.leaf", versionRange: "^1.0.0", required: true }] };
  const lineage = [dependent(), helper("1.0.0", leafDependency), leaf("1.0.0")];
  const pinned = snapshotOf(withExtras("6.6.0", lineage));
  const admitted = await admitValidated(blueprintWithTextNode("6.6.0", "content.dependent", "1.0.0"), pinned);
  expect((await decide(admitted, pinned, pinned)).kind).toBe("ALLOWED");

  const currents: readonly RegistrySource[] = [
    withExtras("6.6.1", [dependent(), helper("1.1.0", { ...INCOMPATIBLE_SCHEMA, ...leafDependency }), leaf("1.0.0")]),
    withExtras("6.6.2", [dependent(), helper("1.2.0", { ...INCOMPATIBLE_RUNTIME, ...leafDependency }), leaf("1.0.0")]),
    withExtras("6.6.3", [dependent(), helper("1.0.0", leafDependency), leaf("1.1.0", INCOMPATIBLE_SCHEMA)]),
    policyPatch(withExtras("6.6.4", lineage), "6.6.4", "content.helper", { executionStatus: "REVOKED" })
  ];
  for (const current of currents) {
    expect(await decide(admitted, pinned, snapshotOf(current)), current.registryVersion).toEqual(
      denial("E07", "CAPABILITY_DEPENDENCY_UNAVAILABLE", "content.dependent")
    );
  }
}

async function expectPinnedAndCurrentSnapshotFailures(): Promise<void> {
  const admitted = await admitValidated(validBlueprint(), BASE_SNAPSHOT);
  const unavailable = await requestAdmission(admitted, snapshotStore({ pinned: [], current: async () => BASE_SNAPSHOT }));
  expect(unavailable).toEqual(denial("E06", "PINNED_SNAPSHOT_UNAVAILABLE"));
  const forgedPinned = snapshotOf(policyPatch(BASE, "6.0.0", "content.text", { executionStatus: "REVOKED" }));
  expect(await decide(admitted, forgedPinned, BASE_SNAPSHOT)).toEqual(denial("E06", "PINNED_SNAPSHOT_INTEGRITY_MISMATCH"));

  const e08 = { kind: "UNAVAILABLE", executable: false, stage: "E08", http_status: 503, retryable: true };
  const lookupFailure = snapshotStore({
    pinned: [BASE_SNAPSHOT],
    current: async () => {
      throw new Error("registry snapshot service timeout");
    }
  });
  expect(await requestAdmission(admitted, lookupFailure)).toEqual(e08);
  const textEntry = BASE_SNAPSHOT.validator_registry.capabilities["content.text"]!["1.0.0"]!;
  const tamperedEntry: TrustedRegistrySnapshot = {
    ...BASE_SNAPSHOT,
    validator_registry: {
      ...BASE_SNAPSHOT.validator_registry,
      capabilities: {
        ...BASE_SNAPSHOT.validator_registry.capabilities,
        "content.text": { "1.0.0": { ...textEntry, resource_budget: { ...textEntry.resource_budget, maxInstancesPerBlueprint: 1 } } }
      }
    }
  };
  const wrapperMismatch: TrustedRegistrySnapshot = { ...BASE_SNAPSHOT, registry_digest: `sha256:${"0".repeat(64)}` };
  for (const current of [tamperedEntry, wrapperMismatch]) {
    expect(await decide(admitted, BASE_SNAPSHOT, current)).toEqual(e08);
  }
}

async function expectNoV5ExecutionAdapter(): Promise<void> {
  const admitted = await admitValidated(validBlueprint(), BASE_SNAPSHOT);
  const v5Body = withVersion(validBlueprint(), "5.0.0");
  const v5Hash = hashBlueprint(v5Body);
  const runId = "00000000-0000-4000-8000-0000000000f5";
  admitted.database.contents.set(v5Hash, {
    content_hash: v5Hash,
    canonical_blueprint: v5Body,
    schema_version: "1.0.0",
    registry_version: "5.0.0",
    trust_status: "VALIDATED",
    created_at: NOW.toISOString(),
    admitted_by_validation_run_id: runId,
    byte_size: 1
  });
  const v5Snapshot = snapshotOf(registrySource("5.0.0"));
  admitted.database.runs.set(runId, { ...admitted.database.runs.values().next().value!, validation_run_id: runId, report: { registry_digest: v5Snapshot.registry_digest } });
  const store = snapshotStore({ pinned: [v5Snapshot], current: async () => BASE_SNAPSHOT });
  expect(await requestAdmission(admitted, store, { content_hash: v5Hash })).toEqual(denial("E06", "PINNED_SNAPSHOT_INTEGRITY_MISMATCH"));
  const noV5 = snapshotStore({ pinned: [BASE_SNAPSHOT], current: async () => BASE_SNAPSHOT });
  expect(await requestAdmission(admitted, noV5, { content_hash: v5Hash })).toEqual(denial("E06", "PINNED_SNAPSHOT_UNAVAILABLE"));
}

describe("F02 Registry v6 capability eligibility and fresh execution admission", () => {
  test("TEST-F02-011 never admits or executes disabled, revoked or incompatible capabilities, including recursive dependencies and current snapshot drift", async () => {
    expectPolicyDenialsAtV04();
    expectDependencyDenialsAtV04();
    expectRevokeAndDisablePublishNewSnapshots();
    await expectCurrentPolicyDenialsAtE07();
    await expectCurrentDependencyDenialsAtE07();
    await expectPinnedAndCurrentSnapshotFailures();
    await expectNoV5ExecutionAdapter();
  });
});
