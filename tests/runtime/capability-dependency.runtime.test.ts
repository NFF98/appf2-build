import { describe, expect, test } from "vitest";

import {
  admitCapability,
  CapabilityAdmissionError,
  GLOBAL_RESOURCE_CEILINGS,
  type CapabilityAdmissionContext,
  type CompatibilityOutcome
} from "../../src/platform/capabilities/admission.js";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import type {
  Availability,
  CapabilityDefinition,
  CapabilityDependency,
  RegistrySource
} from "../../src/platform/capabilities/schema/capability-definition.js";

const TEMPLATE = CAPABILITY_REGISTRY_SOURCE.capabilities[0]!;

function definition(
  id: string,
  version: string,
  dependencies: readonly CapabilityDependency[] = [],
  availability: Availability = "ENABLED"
): CapabilityDefinition {
  return {
    ...TEMPLATE,
    id,
    version,
    runtime: { ...TEMPLATE.runtime, registrationKey: `${id}/${version}` },
    compatibility: { ...TEMPLATE.compatibility, dependencies },
    lifecycle: { ...TEMPLATE.lifecycle, availability }
  };
}

function source(capabilities: readonly CapabilityDefinition[]): RegistrySource {
  return { ...CAPABILITY_REGISTRY_SOURCE, capabilities };
}

function context(
  registry: RegistrySource,
  excludedRuntimeKeys: readonly string[] = [],
  outcomes?: ReadonlyMap<string, CompatibilityOutcome>
): CapabilityAdmissionContext {
  const excluded = new Set(excludedRuntimeKeys);
  return {
    source: registry,
    trustedRuntimeRegistrationKeys: new Set(
      registry.capabilities
        .map(({ runtime }) => runtime.registrationKey)
        .filter((key) => !excluded.has(key))
    ),
    compatibilityOutcomes: outcomes
  };
}

function request(): unknown {
  return {
    capability: { id: "root.capability", version: "1.0.0" },
    resourceUsage: { ...GLOBAL_RESOURCE_CEILINGS }
  };
}

function expectDependencyFailure(
  registry: RegistrySource,
  admissionContext = context(registry)
): void {
  expectAdmissionFailure(registry, admissionContext, "CAPABILITY_DEPENDENCY_UNAVAILABLE");
}

function expectAdmissionFailure(
  registry: RegistrySource,
  admissionContext: CapabilityAdmissionContext,
  code: CapabilityAdmissionError["code"]
): void {
  expect(() => admitCapability(request(), admissionContext)).toThrowError(CapabilityAdmissionError);
  try {
    admitCapability(request(), admissionContext);
  } catch (error: unknown) {
    expect((error as CapabilityAdmissionError).code).toBe(code);
  }
}

describe("required capability dependency admission", () => {
  test("TEST-F04-AC-011 resolves eligible dependencies transitively and fails closed otherwise", () => {
    const base = definition("base.capability", "1.2.3");
    const leaf = definition("leaf.capability", "1.1.0", [
      { id: base.id, versionRange: "1.2.3", required: true }
    ]);
    const dependency = definition("dependency.capability", "1.5.0", [
      { id: leaf.id, versionRange: "^1.0.0", required: true }
    ]);
    const root = definition("root.capability", "1.0.0", [
      { id: dependency.id, versionRange: ">=1.0.0 <2.0.0", required: true }
    ]);
    const eligibleSource = source([root, dependency, leaf, base]);

    expect(admitCapability(request(), context(eligibleSource))).toEqual({
      capability: { id: root.id, version: root.version },
      requiredDependencies: [
        { id: base.id, version: base.version },
        { id: leaf.id, version: leaf.version },
        { id: dependency.id, version: dependency.version }
      ]
    });

    expectDependencyFailure(source([root]));
    expectDependencyFailure(source([root, definition(dependency.id, "2.0.0")]));

    const disabledDependency = definition(dependency.id, dependency.version, [], "DISABLED");
    const disabledSource = source([root, disabledDependency]);
    expectAdmissionFailure(
      disabledSource,
      context(disabledSource),
      "CAPABILITY_DEPENDENCY_UNAVAILABLE"
    );

    expectAdmissionFailure(
      eligibleSource,
      context(eligibleSource, [dependency.runtime.registrationKey]),
      "CAPABILITY_DEPENDENCY_UNAVAILABLE"
    );

    expectAdmissionFailure(
      eligibleSource,
      context(
        eligibleSource,
        [],
        new Map([[`${dependency.id}@${dependency.version}`, "REVOKED"]])
      ),
      "CAPABILITY_DEPENDENCY_UNAVAILABLE"
    );

    const unavailableLeaf = definition(leaf.id, leaf.version, leaf.compatibility.dependencies, "DISABLED");
    const unavailableTransitiveSource = source([root, dependency, unavailableLeaf, base]);
    expectAdmissionFailure(
      unavailableTransitiveSource,
      context(unavailableTransitiveSource),
      "CAPABILITY_DEPENDENCY_UNAVAILABLE"
    );

    const disabledNewer = definition(dependency.id, "1.9.0", [], "DISABLED");
    const eligibleOlder = definition(dependency.id, "1.5.0");
    const multiVersionRoot = definition(root.id, root.version, [
      { id: dependency.id, versionRange: "^1.0.0", required: true }
    ]);
    const multiVersionSource = source([multiVersionRoot, disabledNewer, eligibleOlder]);
    expect(admitCapability(request(), context(multiVersionSource))).toEqual({
      capability: { id: multiVersionRoot.id, version: multiVersionRoot.version },
      requiredDependencies: [{ id: eligibleOlder.id, version: eligibleOlder.version }]
    });

    const bridge = definition("bridge.capability", "1.0.0", [
      { id: dependency.id, versionRange: "^1.0.0", required: true }
    ]);
    const transitiveRoot = definition(root.id, root.version, [
      { id: bridge.id, versionRange: "1.0.0", required: true }
    ]);
    const transitiveMultiVersionSource = source([
      transitiveRoot,
      bridge,
      disabledNewer,
      eligibleOlder
    ]);
    expect(admitCapability(request(), context(transitiveMultiVersionSource))).toEqual({
      capability: { id: transitiveRoot.id, version: transitiveRoot.version },
      requiredDependencies: [
        { id: eligibleOlder.id, version: eligibleOlder.version },
        { id: bridge.id, version: bridge.version }
      ]
    });
  });
});
