import { describe, expect, test } from "vitest";

import {
  admitCapability,
  CapabilityAdmissionError,
  GLOBAL_RESOURCE_CEILINGS,
  type CapabilityAdmissionContext,
  type CapabilityResourceUsage
} from "../../src/platform/capabilities/admission.js";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import type {
  CapabilityDefinition,
  RegistrySource
} from "../../src/platform/capabilities/schema/capability-definition.js";

const VALID_USAGE: CapabilityResourceUsage = { ...GLOBAL_RESOURCE_CEILINGS };

function trustedKeys(source: RegistrySource): ReadonlySet<string> {
  return new Set(source.capabilities.map(({ runtime }) => runtime.registrationKey));
}

function context(
  source: RegistrySource = CAPABILITY_REGISTRY_SOURCE,
  compatibilityOutcomes?: CapabilityAdmissionContext["compatibilityOutcomes"]
): CapabilityAdmissionContext {
  return {
    source,
    trustedRuntimeRegistrationKeys: trustedKeys(source),
    compatibilityOutcomes
  };
}

function request(id = "content.text", version = "1.0.0"): unknown {
  return {
    capability: { id, version },
    resourceUsage: VALID_USAGE
  };
}

function expectAdmissionError(action: () => unknown, code: CapabilityAdmissionError["code"]): void {
  expect(action).toThrowError(CapabilityAdmissionError);
  try {
    action();
  } catch (error: unknown) {
    expect((error as CapabilityAdmissionError).code).toBe(code);
  }
}

function sourceReplacing(
  original: CapabilityDefinition,
  replacement: CapabilityDefinition
): RegistrySource {
  return {
    ...CAPABILITY_REGISTRY_SOURCE,
    capabilities: CAPABILITY_REGISTRY_SOURCE.capabilities.map((definition) =>
      definition === original ? replacement : definition
    )
  };
}

describe("capability trust admission contract", () => {
  test("TEST-F04-004 rejects unknown capability IDs and exact versions without fallback", () => {
    expectAdmissionError(
      () => admitCapability(request("unknown.capability"), context()),
      "UNKNOWN_CAPABILITY"
    );
    expectAdmissionError(
      () => admitCapability(request("content.text", "1.0.1"), context()),
      "UNKNOWN_CAPABILITY_VERSION"
    );
  });

  test("TEST-F04-005 rejects an ENABLED capability without its trusted bundled runtime mapping", () => {
    const admissionContext: CapabilityAdmissionContext = {
      source: CAPABILITY_REGISTRY_SOURCE,
      trustedRuntimeRegistrationKeys: new Set<string>()
    };

    expectAdmissionError(
      () => admitCapability(request(), admissionContext),
      "RUNTIME_HANDLER_MISSING"
    );
  });

  test("TEST-F04-009 denies DISABLED lifecycle availability and REVOKED compatibility", () => {
    const original = CAPABILITY_REGISTRY_SOURCE.capabilities.find(({ id }) => id === "content.text");
    expect(original).toBeDefined();
    const disabled: CapabilityDefinition = {
      ...original!,
      lifecycle: { ...original!.lifecycle, availability: "DISABLED" }
    };
    const disabledSource = sourceReplacing(original!, disabled);

    expectAdmissionError(
      () => admitCapability(request(), context(disabledSource)),
      "CAPABILITY_DISABLED"
    );
    expectAdmissionError(
      () =>
        admitCapability(
          request(),
          context(
            CAPABILITY_REGISTRY_SOURCE,
            new Map([["content.text@1.0.0", "REVOKED"]])
          )
        ),
      "CAPABILITY_REVOKED"
    );
  });
});
