import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, test } from "vitest";

import {
  RegistryGenerationError,
  generateRegistryArtifacts,
  readCommittedReleaseLedger
} from "../../src/platform/capabilities/generate-registry.js";
import {
  assertLedgerAppendOnly,
  ledgerReleaseOf,
  parseRegistryReleaseLedger
} from "../../src/platform/capabilities/registry-release.js";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import type {
  CapabilityDefinition,
  RegistrySource
} from "../../src/platform/capabilities/schema/capability-definition.js";

function sourceWith(capabilities: readonly CapabilityDefinition[]): RegistrySource {
  return {
    ...CAPABILITY_REGISTRY_SOURCE,
    capabilities
  };
}

function expectGenerationError(action: () => unknown, code: RegistryGenerationError["code"]): void {
  try {
    action();
    throw new Error(`Expected RegistryGenerationError(${code}).`);
  } catch (error: unknown) {
    expect(error).toBeInstanceOf(RegistryGenerationError);
    expect((error as RegistryGenerationError).code).toBe(code);
  }
}

function readHistoricalArtifact(relativePath: string): unknown {
  const gitRef = process.env.BASE_SHA || "HEAD";
  const artifactPath = `generated/capabilities/${relativePath}`;
  execFileSync("git", ["rev-parse", "--verify", `${gitRef}^{commit}`], {
    encoding: "utf8"
  });
  const paths = execFileSync(
    "git",
    ["ls-tree", "-r", "--name-only", gitRef, "--", artifactPath],
    { encoding: "utf8" }
  )
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (!paths.includes(artifactPath)) {
    return undefined;
  }
  return JSON.parse(execFileSync("git", ["show", `${gitRef}:${artifactPath}`], { encoding: "utf8" })) as unknown;
}

async function committedLedger() {
  const ledger = await readCommittedReleaseLedger(resolve(process.cwd(), "generated/capabilities"));
  expect(ledger).toBeDefined();
  return ledger!;
}

function multiVersionCycle(
  first: CapabilityDefinition,
  second: CapabilityDefinition
): readonly CapabilityDefinition[] {
  const alphaV1: CapabilityDefinition = {
    ...first,
    id: "alpha.node",
    version: "1.0.0",
    runtime: { ...first.runtime, registrationKey: "alpha/node/v1" },
    compatibility: {
      ...first.compatibility,
      dependencies: [{ id: "beta.node", versionRange: "^1.0.0", required: true }]
    }
  };
  const alphaV2: CapabilityDefinition = {
    ...first,
    id: "alpha.node",
    version: "2.0.0",
    runtime: { ...first.runtime, registrationKey: "alpha/node/v2" },
    compatibility: { ...first.compatibility, dependencies: [] }
  };
  const betaV1: CapabilityDefinition = {
    ...second,
    id: "beta.node",
    version: "1.0.0",
    runtime: { ...second.runtime, registrationKey: "beta/node/v1" },
    compatibility: {
      ...second.compatibility,
      dependencies: [{ id: "alpha.node", versionRange: ">=1.0.0 <3.0.0", required: true }]
    }
  };
  return [alphaV1, alphaV2, betaV1];
}

describe("canonical capability registry", () => {
  test("TEST-F04-AC-001 deterministically generates compiler, validator, runtime, and compatibility artifacts", async () => {
    const ledger = await committedLedger();
    const first = generateRegistryArtifacts(CAPABILITY_REGISTRY_SOURCE, ledger);
    const second = generateRegistryArtifacts(CAPABILITY_REGISTRY_SOURCE, ledger);

    expect(second).toEqual(first);
    expect(Object.keys(first.files).sort()).toEqual([
      "compatibility-manifest.json",
      "compiler-catalog.json",
      "registry-manifest.json",
      "registry-release-ledger.json",
      "runtime-registry.ts",
      "validator-registry.ts"
    ]);

    for (const [relativePath, expected] of Object.entries(first.files)) {
      const committed = await readFile(
        resolve(process.cwd(), "generated/capabilities", relativePath),
        "utf8"
      );
      expect(committed).toBe(expected);
    }
  });

  test("TEST-F04-002 rejects a changed source digest under the same registry version", async () => {
    const current = generateRegistryArtifacts(CAPABILITY_REGISTRY_SOURCE, await committedLedger());
    const first = CAPABILITY_REGISTRY_SOURCE.capabilities[0];
    expect(first).toBeDefined();
    const changed = sourceWith([
      {
        ...first!,
        semantic: {
          ...first!.semantic,
          meaning: `${first!.semantic.meaning} Changed without a version bump.`
        }
      },
      ...CAPABILITY_REGISTRY_SOURCE.capabilities.slice(1)
    ]);

    expectGenerationError(
      () => generateRegistryArtifacts(changed, current.ledger),
      "REGISTRY_VERSION_DIGEST_MISMATCH"
    );
    const historicalLedger = readHistoricalArtifact("registry-release-ledger.json");
    if (historicalLedger !== undefined) {
      assertLedgerAppendOnly(parseRegistryReleaseLedger(historicalLedger), current.ledger);
    }
    const historicalManifest = readHistoricalArtifact("registry-manifest.json") as Record<string, unknown> | undefined;
    const historicalVersion = historicalManifest?.registry_version;
    const recorded = typeof historicalVersion === "string" ? ledgerReleaseOf(current.ledger, historicalVersion) : undefined;
    if (recorded !== undefined) {
      expect(historicalManifest?.registry_digest).toBe(recorded.registry_digest);
    }
  });

  test("TEST-F04-003 rejects duplicate capability ID and version refs", () => {
    const duplicate = CAPABILITY_REGISTRY_SOURCE.capabilities[0];
    expect(duplicate).toBeDefined();

    expectGenerationError(
      () =>
        generateRegistryArtifacts(
          sourceWith([...CAPABILITY_REGISTRY_SOURCE.capabilities, duplicate!])
        ),
      "DUPLICATE_CAPABILITY_REF"
    );
  });

  test("TEST-F04-AC-006 binds compiler, validator, runtime, and compatibility artifacts to one identity", () => {
    const generated = generateRegistryArtifacts(CAPABILITY_REGISTRY_SOURCE);
    const compiler = JSON.parse(generated.files["compiler-catalog.json"]!) as Record<string, unknown>;
    const compatibility = JSON.parse(
      generated.files["compatibility-manifest.json"]!
    ) as Record<string, unknown>;
    const validator = generated.files["validator-registry.ts"]!;
    const runtime = generated.files["runtime-registry.ts"]!;

    expect(compiler.registry_version).toBe(generated.identity.registryVersion);
    expect(compiler.registry_digest).toBe(generated.identity.registryDigest);
    expect(compatibility.registry_version).toBe(generated.identity.registryVersion);
    expect(compatibility.registry_digest).toBe(generated.identity.registryDigest);
    expect(generated.identity.registryDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(validator).toContain(`"registry_version": "${generated.identity.registryVersion}"`);
    expect(validator).toContain(`"registry_digest": "${generated.identity.registryDigest}"`);
    expect(runtime).toContain(`"registry_version": "${generated.identity.registryVersion}"`);
    expect(runtime).toContain(`"registry_digest": "${generated.identity.registryDigest}"`);
  });

  test("TEST-F04-007 rejects a capability dependency cycle", () => {
    const [first, second, ...remaining] = CAPABILITY_REGISTRY_SOURCE.capabilities;
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    const cyclicFirst: CapabilityDefinition = {
      ...first!,
      compatibility: {
        ...first!.compatibility,
        dependencies: [{ id: second!.id, versionRange: "^1.0.0", required: true }]
      }
    };
    const cyclicSecond: CapabilityDefinition = {
      ...second!,
      compatibility: {
        ...second!.compatibility,
        dependencies: [{ id: first!.id, versionRange: "^1.0.0", required: true }]
      }
    };

    expectGenerationError(
      () => generateRegistryArtifacts(sourceWith([cyclicFirst, cyclicSecond, ...remaining])),
      "DEPENDENCY_CYCLE"
    );

    expectGenerationError(
      () => generateRegistryArtifacts(sourceWith(multiVersionCycle(first!, second!))),
      "DEPENDENCY_CYCLE"
    );
  });
});
