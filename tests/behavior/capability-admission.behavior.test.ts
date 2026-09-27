import { describe, expect, test } from "vitest";

import {
  admitCapability,
  CapabilityAdmissionError,
  GLOBAL_RESOURCE_CEILINGS
} from "../../src/platform/capabilities/admission.js";
import {
  generateRegistryArtifacts,
  RegistryGenerationError
} from "../../src/platform/capabilities/generate-registry.js";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import type {
  CapabilityDefinition,
  ResourceBudget
} from "../../src/platform/capabilities/schema/capability-definition.js";

const BASE_BUDGET: ResourceBudget = {
  ...GLOBAL_RESOURCE_CEILINGS,
  mediaAutoplayAllowed: false,
  networkAccessAllowed: false
};

function expectAdmissionError(action: () => unknown, code: CapabilityAdmissionError["code"]): void {
  expect(action).toThrowError(CapabilityAdmissionError);
  try {
    action();
  } catch (error: unknown) {
    expect((error as CapabilityAdmissionError).code).toBe(code);
  }
}

function validRequest(): Record<string, unknown> {
  return {
    capability: { id: "content.text", version: "1.0.0" },
    resourceUsage: { ...GLOBAL_RESOURCE_CEILINGS }
  };
}

function admit(request: unknown): unknown {
  return admitCapability(request, {
    source: CAPABILITY_REGISTRY_SOURCE,
    trustedRuntimeRegistrationKeys: new Set(
      CAPABILITY_REGISTRY_SOURCE.capabilities.map(({ runtime }) => runtime.registrationKey)
    )
  });
}

function sourceWithBudget(budget: ResourceBudget) {
  const [first, ...remaining] = CAPABILITY_REGISTRY_SOURCE.capabilities;
  const changed: CapabilityDefinition = {
    ...first!,
    runtime: { ...first!.runtime, resourceBudget: budget }
  };
  return { ...CAPABILITY_REGISTRY_SOURCE, capabilities: [changed, ...remaining] };
}

describe("capability admission safety behavior", () => {
  test("TEST-F04-008 accepts only the strict declarative contract and rejects executable references", () => {
    expect(admit(validRequest())).toEqual({
      capability: { id: "content.text", version: "1.0.0" },
      requiredDependencies: []
    });

    const forbiddenInputs: readonly unknown[] = [
      { ...validRequest(), javascriptSource: "return window.location" },
      { ...validRequest(), functionBody: "return 1" },
      { ...validRequest(), modulePath: "./untrusted.js" },
      { ...validRequest(), npmPackage: "untrusted-package" },
      { ...validRequest(), dynamicImportUrl: "https://example.invalid/code.js" },
      { ...validRequest(), handler: "override" },
      { ...validRequest(), eval: "payload" },
      { ...validRequest(), shellCommand: "whoami" },
      {
        ...validRequest(),
        capability: { id: "content.text", version: "1.0.0", modulePath: "./override.js" }
      },
      () => "executable"
    ];

    for (const input of forbiddenInputs) {
      expectAdmissionError(() => admit(input), "FORBIDDEN_EXECUTABLE_CONTENT");
    }
  });

  test("TEST-F04-AC-010 enforces below, equal, and plus-one for every numeric ceiling", () => {
    for (const [resource, ceiling] of Object.entries(GLOBAL_RESOURCE_CEILINGS)) {
      const below = { ...BASE_BUDGET, [resource]: ceiling - 1 };
      const equal = { ...BASE_BUDGET, [resource]: ceiling };
      const above = { ...BASE_BUDGET, [resource]: ceiling + 1 };

      expect(() => generateRegistryArtifacts(sourceWithBudget(below))).not.toThrow();
      expect(() => generateRegistryArtifacts(sourceWithBudget(equal))).not.toThrow();
      try {
        generateRegistryArtifacts(sourceWithBudget(above));
        throw new Error(`Expected ${resource} above its ceiling to be rejected.`);
      } catch (error: unknown) {
        expect(error).toBeInstanceOf(RegistryGenerationError);
        expect((error as RegistryGenerationError).code).toBe("RESOURCE_CEILING_EXCEEDED");
      }

      const belowRequest = {
        ...validRequest(),
        resourceUsage: { ...GLOBAL_RESOURCE_CEILINGS, [resource]: ceiling - 1 }
      };
      const aboveRequest = {
        ...validRequest(),
        resourceUsage: { ...GLOBAL_RESOURCE_CEILINGS, [resource]: ceiling + 1 }
      };
      expect(admit(belowRequest)).toMatchObject({ capability: { id: "content.text" } });
      expect(admit(validRequest())).toMatchObject({ capability: { id: "content.text" } });
      expectAdmissionError(() => admit(aboveRequest), "RESOURCE_LIMIT_EXCEEDED");
    }
  });
});
