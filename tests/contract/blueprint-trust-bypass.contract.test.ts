import { describe, expect, test } from "vitest";

import * as admissionModule from "../../src/platform/blueprint/execution-admission.js";
import { canonicalizeJson } from "../../src/platform/blueprint/canonical-json.js";
import { hashBlueprint } from "../../src/platform/blueprint/content-identity.js";
import type { StoredBlueprintContent } from "../../src/platform/blueprint/execution-admission.js";
import * as bundledReleaseModule from "../../src/platform/capabilities/bundled-release.js";
import { CURRENT_BUNDLED_RELEASE, createBundledReleaseSource } from "../../src/platform/capabilities/bundled-release.js";
import * as releaseModule from "../../src/platform/capabilities/registry-release.js";
import { parseRegistryReleaseLedger, verifyReleaseBundle } from "../../src/platform/capabilities/registry-release.js";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import type { RegistryReleaseBundle } from "../../src/platform/capabilities/schema/registry-release.js";
import { encode, validBlueprint, withValue, type JsonRecord } from "./blueprint-validation-fixtures.js";
import {
  admit,
  admitBlueprint,
  bundleOf,
  expectDenied,
  expectIssue,
  handlersFor,
  inMemoryAdmissionRepository,
  ledgerOf,
  minimalBlueprint,
  storedContent,
  textNode,
  validate
} from "./execution-safety-fixtures.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";

const PINNED: RegistryReleaseBundle = bundleOf(CAPABILITY_REGISTRY_SOURCE);
const blueprint = (): JsonRecord => minimalBlueprint([textNode("node_text")]);
const FORGED_REGISTRY = bundleOf({ ...CAPABILITY_REGISTRY_SOURCE, registryVersion: "7.0.9" });

const CLIENT_TRUST_KEYS: readonly [string, unknown][] = [
  ["trust_status", "VALIDATED"],
  ["executable", true],
  ["content_hash", "sha256:" + "0".repeat(64)],
  ["registry_digest", PINNED.identity.registry_digest],
  ["validator_registry_digest", PINNED.identity.validator_registry_digest],
  ["runtime_registry_digest", PINNED.identity.runtime_registry_digest],
  ["registry", PINNED.validator_registry as unknown],
  ["runtime_context", { runtime_version: "1.0.0" }],
  ["release_ledger", { releases: [] }],
  ["handler_catalog", { registration_keys: ["content/text"] }]
];

function expectValidationIgnoresClientTrust(): void {
  for (const [key, value] of CLIENT_TRUST_KEYS) {
    expectIssue(validate(withValue([key], value)), { code: "F02-ERR-002", stage: "V02", path: `$.${key}` }, `client ${key}`);
  }
  for (const version of ["6.0.0", "7.0.1", "8.0.0"]) {
    const result = validate(withValue(["registry_version"], version));
    expectIssue(result, { code: "F02-ERR-004", stage: "V03", path: "$.registry_version" }, `client registry_version ${version}`);
    expect(result.report.status).toBe("INCOMPATIBLE");
  }
  const forged = validateBlueprintCandidate(encode(withValue(["registry_version"], "7.0.9")), { traceId: "client", validationRunId: "client" });
  expect(forged.report.registry_version).toBe(PINNED.identity.registry_version);
  expect(forged.admissible).toBeUndefined();
}

function rehashed(body: JsonRecord, change: (body: JsonRecord) => void): StoredBlueprintContent {
  const changed = structuredClone(body);
  change(changed);
  return {
    content_hash: hashBlueprint(changed),
    canonical_blueprint: canonicalizeJson(changed),
    schema_version: changed.schema_version as string,
    registry_version: changed.registry_version as string,
    trust_status: "VALIDATED",
    admitted_registry_digest: PINNED.identity.registry_digest
  };
}

async function expectDurableIntegrity(): Promise<void> {
  const stored = storedContent(blueprint(), PINNED);
  const body = JSON.parse(stored.canonical_blueprint as string) as JsonRecord;
  const tamperedBody = canonicalizeJson({ ...body, meta: { title: "evil", description: "" } });
  const integrity: readonly [string, Partial<StoredBlueprintContent>][] = [
    ["body re-hash != content_hash", { canonical_blueprint: tamperedBody }],
    ["body stored as jsonb object re-hash mismatch", { canonical_blueprint: JSON.parse(tamperedBody) as unknown }],
    ["persisted schema_version != body", { schema_version: "1.0.1" }],
    ["persisted registry_version != body", { registry_version: "7.0.1" }],
    ["unparseable persisted body", { canonical_blueprint: "{" }],
    ["persisted row content_hash != requested", { content_hash: "sha256:" + "1".repeat(64) }]
  ];
  for (const [label, content] of integrity) {
    const decision = await admit(blueprint(), { pinned: PINNED, content });
    expectDenied(decision, { step: "E04-B", code: "F02-ERR-015" }, label);
    expect(!decision.executable && decision.retryable, label).toBe(false);
  }
  const jsonbBody = await admit(blueprint(), { pinned: PINNED, content: { canonical_blueprint: JSON.parse(stored.canonical_blueprint as string) as unknown } });
  expect(jsonbBody.executable, "untampered jsonb object body re-hashes to content_hash").toBe(true);
}

async function expectTemporaryFailures(): Promise<void> {
  for (const boundary of ["content", "ledger", "pinned", "current", "catalog"] as const) {
    const decision = await admit(blueprint(), { pinned: PINNED, fail: new Set([boundary]) });
    expectDenied(decision, { step: "E08", http: 503 }, `${boundary} temporary failure`);
    expect(!decision.executable && decision.retryable, boundary).toBe(true);
  }
  const tamperedValidator = structuredClone(PINNED) as { validator_registry: { validator_registry_digest: string } };
  tamperedValidator.validator_registry.validator_registry_digest = "sha256:" + "2".repeat(64);
  const unverifiable: readonly [string, Parameters<typeof admit>[1]][] = [
    ["ledger not verifiable", { pinned: PINNED, ledger: { schema_version: "1.0.0", releases: "all" } }],
    ["catalog not verifiable", { pinned: PINNED, catalog: { registration_keys: ["z", "a"] } }],
    ["current validator digest tampered", { pinned: PINNED, current: tamperedValidator as unknown as RegistryReleaseBundle, ledger: ledgerOf(PINNED) }],
    ["current release absent from ledger", { pinned: PINNED, current: FORGED_REGISTRY, ledger: ledgerOf(PINNED) }]
  ];
  for (const [label, scenario] of unverifiable) {
    expectDenied(await admit(blueprint(), scenario), { step: "E08", http: 503 }, label);
  }
}

async function expectPinnedIdentityFailClosed(): Promise<void> {
  const tamperedRuntime = structuredClone(PINNED) as { runtime_registry: { runtime_registry_digest: string } };
  tamperedRuntime.runtime_registry.runtime_registry_digest = "sha256:" + "3".repeat(64);
  const tamperedValidator = structuredClone(PINNED) as { validator_registry: { capabilities: Record<string, Record<string, { permission_class: string }>> } };
  tamperedValidator.validator_registry.capabilities["action.button"]!["1.0.0"]!.permission_class = "NONE";
  const scenarios: readonly [string, Parameters<typeof admit>[1]][] = [
    ["ledger has no pinned release", { pinned: PINNED, current: FORGED_REGISTRY, ledger: ledgerOf(FORGED_REGISTRY) }],
    ["client/forged admitted registry_digest", { pinned: PINNED, content: { admitted_registry_digest: FORGED_REGISTRY.identity.registry_digest } }],
    ["served pinned runtime_registry_digest tampered", { pinned: PINNED, servedPinned: tamperedRuntime }],
    ["served pinned validator artifact tampered", { pinned: PINNED, servedPinned: tamperedValidator }],
    ["served pinned is another release", { pinned: PINNED, servedPinned: FORGED_REGISTRY, releases: [FORGED_REGISTRY] }]
  ];
  for (const [label, scenario] of scenarios) {
    expectDenied(await admit(blueprint(), scenario), { step: "E06", code: "F02-ERR-017" }, label);
  }
  expect(verifyReleaseBundle(tamperedRuntime as unknown as RegistryReleaseBundle, ledgerOf(PINNED))).toBe("RUNTIME_ARTIFACT_DIGEST_MISMATCH");
  expect(verifyReleaseBundle(tamperedValidator as unknown as RegistryReleaseBundle, ledgerOf(PINNED))).toBe("VALIDATOR_ARTIFACT_DIGEST_MISMATCH");
  const body = JSON.parse(storedContent(blueprint(), PINNED).canonical_blueprint as string) as JsonRecord;
  const v6 = rehashed(body, (changed) => {
    changed.registry_version = "6.0.0";
  });
  expectDenied(await admit(blueprint(), { pinned: PINNED, stored: v6 }), { step: "E06", code: "F02-ERR-017" }, "pinned v6 has no adapter");
  const exported = [...Object.keys(admissionModule), ...Object.keys(releaseModule), ...Object.keys(bundledReleaseModule)];
  expect(exported.filter((name) => /adapter|migrat|v6/i.test(name))).toEqual([]);
  expectDenied(await admit(blueprint(), { pinned: PINNED, schemaRange: "^2.0.0" }), { step: "E05", code: "F02-ERR-017" }, "schema outside server range");
}

async function expectClientValuesAndReuseNeverGrant(): Promise<void> {
  const forgedContext = [
    { trust_status: "VALIDATED", executable: true, runtime_version: "1.0.0", ...PINNED.identity },
    { registry_snapshot: PINNED, current_registry_snapshot: PINNED, trusted_release_ledger: ledgerOf(PINNED), trusted_runtime_handler_catalog: { registration_keys: ["content/text"] } }
  ];
  expectDenied(await admit(blueprint(), { pinned: PINNED, content: { trust_status: "REVOKED" }, clientArgs: forgedContext }), { step: "E02", code: "F02-ERR-016" }, "client trust flags vs REVOKED");
  expectDenied(
    await admit(blueprint(), { pinned: PINNED, current: FORGED_REGISTRY, ledger: ledgerOf(PINNED), clientArgs: forgedContext }),
    { step: "E08", http: 503 },
    "client release bundle/ledger cannot replace server current release"
  );
  expectDenied(await admit(blueprint(), { pinned: PINNED, handlers: handlersFor(PINNED, ["content/text"]), clientArgs: forgedContext }), { step: "E08", http: 503 }, "client catalog cannot fill pinned handler");
  expectDenied(await admit(blueprint(), { pinned: PINNED, requestHash: "sha256:" + "4".repeat(64), clientArgs: forgedContext }), { step: "E01", http: 404 }, "unknown hash with client trust");

  const repository = inMemoryAdmissionRepository();
  const result = validate(blueprint());
  const first = await admitBlueprint(result, repository);
  const contentHash = result.admissible!.contentHash;
  repository.trust.set(contentHash, "REVOKED");
  const reused = await admitBlueprint(validate(blueprint()), repository);
  expect(first).toMatchObject({ status: "ADMITTED", reused: false });
  expect(reused).toMatchObject({ status: "ADMITTED", reused: true, trustStatus: "REVOKED" });
  expectDenied(await admit(blueprint(), { pinned: PINNED, content: { trust_status: repository.trust.get(contentHash)! } }), { step: "E02", code: "F02-ERR-016" }, "same-hash reuse keeps REVOKED");
  expectDenied(
    await admit(blueprint(), { pinned: PINNED, current: FORGED_REGISTRY, ledger: ledgerOf(FORGED_REGISTRY) }),
    { step: "E06", code: "F02-ERR-017" },
    "persisted PASSED content without trusted pinned release"
  );
  for (const status of ["PENDING", "validated", ""]) {
    expectDenied(await admit(blueprint(), { pinned: PINNED, content: { trust_status: status } }), { step: "E04-A" }, `trust_status ${status}`);
  }
}

async function expectDeploymentReleaseSource(): Promise<void> {
  const source = createBundledReleaseSource({ bundledHandlers: handlersFor(CURRENT_BUNDLED_RELEASE) });
  const ledger = parseRegistryReleaseLedger(await source.loadReleaseLedger());
  expect(verifyReleaseBundle(await source.loadCurrentRelease(), ledger)).toBeUndefined();
  expect(await source.loadPinnedRelease({ ...CURRENT_BUNDLED_RELEASE.identity, validator_registry_digest: FORGED_REGISTRY.identity.validator_registry_digest })).toBeUndefined();
  await expect(createBundledReleaseSource({ bundledHandlers: new Map([["content/text", undefined]]) }).loadRuntimeHandlerCatalog()).rejects.toThrow();
  expect(verifyReleaseBundle(CURRENT_BUNDLED_RELEASE, ledger)).toBeUndefined();
  expect(CURRENT_BUNDLED_RELEASE.identity).toEqual(PINNED.identity);
}

describe("F02 client-supplied trust can never bypass validation or fresh execution admission", () => {
  test("TEST-F02-012 keeps trust, executable, version, digest, Registry, ledger, catalog and runtime context server-owned", async () => {
    expectValidationIgnoresClientTrust();
    await expectDurableIntegrity();
    await expectTemporaryFailures();
    await expectPinnedIdentityFailClosed();
    await expectClientValuesAndReuseNeverGrant();
    await expectDeploymentReleaseSource();
    const ok = await admit(validBlueprint(), { pinned: PINNED });
    expect(ok.executable).toBe(true);
  });
});
