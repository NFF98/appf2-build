import { describe, expect, test } from "vitest";

import { VALIDATOR_REGISTRY } from "../../generated/capabilities/validator-registry.js";
import {
  createExecutionAdmissionService,
  type BlueprintTrustReader,
  type CapabilityExecutionDiagnostic,
  type ExecutionAdmissionDecision,
  type ExecutionDeployment
} from "../../src/platform/blueprint/execution-admission.js";
import {
  validateBlueprintCandidate,
  type BlueprintValidationContext
} from "../../src/platform/blueprint/validate-blueprint.js";
import type { BlueprintValidationResult, CapabilityRef } from "../../src/platform/blueprint/validation-types.js";
import type { ExecutionClass } from "../../src/platform/capabilities/schema/capability-definition.js";
import type {
  GeneratedCapabilityValidator,
  ValidatorRegistry
} from "../../src/platform/capabilities/schema/validator-contract.js";
import { encode, validBlueprint } from "./blueprint-validation-fixtures.js";
import {
  ADMISSION_ID,
  ISSUED_AT,
  admittedContent,
  deployment,
  setTrustStatus,
  snapshotOf,
  type AdmittedContent
} from "./execution-admission-harness.js";
import { registryAdding, registryWith } from "./validator-registry-variants.js";

const TEXT = "content.text@1.0.0";
const TEXT_REF: CapabilityRef = { id: "content.text", version: "1.0.0" };
const CONTAINER_REF: CapabilityRef = { id: "layout.container", version: "1.0.0" };
const TEXT_PATH = "$.nodes[1].capability";
const HELPER = VALIDATOR_REGISTRY.capabilities["content.text"]!["1.0.0"]!;

type Patch = (capability: GeneratedCapabilityValidator) => GeneratedCapabilityValidator;

const disabled: Patch = (capability) => ({ ...capability, availability: "DISABLED" });
const experimental: Patch = (capability) => ({ ...capability, availability: "EXPERIMENTAL" });
const revoked: Patch = (capability) => ({ ...capability, execution_status: "REVOKED" });
const remoteClass: Patch = (capability) => ({ ...capability, execution_class: "REMOTE_WORKER" as ExecutionClass });
const futureSchema: Patch = (capability) => ({
  ...capability,
  compatibility: { ...capability.compatibility, blueprintSchemaRange: ">=2.0.0 <3.0.0" }
});

function dependsOn(id: string, versionRange: string, required = true): Patch {
  return (capability) => ({
    ...capability,
    compatibility: { ...capability.compatibility, dependencies: [{ id, versionRange, required }] }
  });
}

function helper(patch: Patch = (capability) => capability): GeneratedCapabilityValidator {
  return patch({ ...HELPER, id: "dep.helper", version: "1.0.0" });
}

function textWithHelper(helperCapability: GeneratedCapabilityValidator, range = "^1.0.0"): ValidatorRegistry {
  return registryWith({ [TEXT]: dependsOn("dep.helper", range) }, registryAdding(helperCapability));
}

function validate(context: BlueprintValidationContext): BlueprintValidationResult {
  return validateBlueprintCandidate(encode(validBlueprint()), context);
}

function expectV04(
  result: BlueprintValidationResult,
  label: string,
  expected: { code: "F02-ERR-004" | "F02-ERR-005"; path?: string; ref?: CapabilityRef }
): void {
  expect(result.report.status, label).toBe(expected.code === "F02-ERR-004" ? "INCOMPATIBLE" : "REJECTED");
  expect(result.report.issues, label).toEqual([
    {
      error_code: expected.code,
      stage: "V04",
      json_path: expected.path ?? TEXT_PATH,
      capability_ref: expected.ref ?? TEXT_REF
    }
  ]);
  expect(result.admissible, label).toBeUndefined();
}

function issue(content: AdmittedContent, overrides: Partial<ExecutionDeployment> = {}): Promise<ExecutionAdmissionDecision> {
  return createExecutionAdmissionService(content.repository, deployment(overrides)).issueExecutionAdmission(content.contentHash);
}

function currentRegistry(registry: ValidatorRegistry): Partial<ExecutionDeployment> {
  return { registrySnapshots: new Map([[registry.registry_version, snapshotOf(registry)]]) };
}

function capabilityDenial(
  reason: CapabilityExecutionDiagnostic["reason"],
  ref: CapabilityRef = TEXT_REF
): ExecutionAdmissionDecision {
  return {
    kind: "DENIED",
    step: "E07",
    executable: false,
    error_code: "F02-ERR-017",
    diagnostic: { capability_ref: ref, reason }
  };
}

describe("F02 capability execution eligibility and fresh execution admission", () => {
  test("TEST-F02-011 denies disabled, revoked or incompatible capabilities at V04 and again at fresh execution admission", async () => {
    const v04Rejections: readonly [string, ValidatorRegistry][] = [
      ["availability DISABLED", registryWith({ [TEXT]: disabled })],
      ["availability EXPERIMENTAL", registryWith({ [TEXT]: experimental })],
      ["execution_status REVOKED", registryWith({ [TEXT]: revoked })],
      ["required dependency missing", registryWith({ [TEXT]: dependsOn("dep.missing", "^1.0.0") })],
      ["required dependency disabled", textWithHelper(helper(disabled))],
      ["required dependency revoked", textWithHelper(helper(revoked))],
      ["required dependency version unsatisfied", textWithHelper(helper(), "^2.0.0")],
      ["transitive dependency missing", textWithHelper(helper(dependsOn("dep.missing", "^1.0.0")))],
      ["execution_class outside the trusted local allowlist", registryWith({ [TEXT]: remoteClass })]
    ];
    for (const [label, registry] of v04Rejections) {
      expectV04(validate({ registry }), label, { code: "F02-ERR-005" });
    }
    expectV04(validate({ registry: registryWith({ [TEXT]: futureSchema }) }), "Blueprint schema outside capability range", {
      code: "F02-ERR-004"
    });
    for (const runtimeVersion of ["2.0.0", "0.9.0"]) {
      expectV04(validate({ runtimeVersion }), `trusted runtime ${runtimeVersion}`, {
        code: "F02-ERR-004",
        path: "$.nodes[0].capability",
        ref: CONTAINER_REF
      });
    }
    expect(validate({ registry: textWithHelper(helper()) }).report.status).toBe("PASSED");
    expect(validate({ registry: registryWith({ [TEXT]: dependsOn("dep.missing", "^1.0.0", false) }) }).report.status).toBe("PASSED");

    const content = await admittedContent();
    const allowed = await issue(content);
    expect(allowed).toEqual({
      kind: "ALLOWED",
      admission: {
        admission_version: "1.0.0",
        admission_id: ADMISSION_ID,
        content_hash: content.contentHash,
        executable: true,
        trust_status: "VALIDATED",
        schema_version: "1.0.0",
        registry_version: VALIDATOR_REGISTRY.registry_version,
        registry_digest: VALIDATOR_REGISTRY.registry_digest,
        runtime_version: "1.0.0",
        issued_at: ISSUED_AT,
        expires_at: "2026-10-04T12:00:30.000Z"
      }
    });

    const withoutText = { ...VALIDATOR_REGISTRY, capabilities: { ...VALIDATOR_REGISTRY.capabilities } };
    delete (withoutText.capabilities as Record<string, unknown>)["content.text"];
    const currentEligibility: readonly [Partial<ExecutionDeployment>, ExecutionAdmissionDecision][] = [
      [currentRegistry(registryWith({ [TEXT]: disabled })), capabilityDenial("CAPABILITY_DISABLED")],
      [currentRegistry(registryWith({ [TEXT]: experimental })), capabilityDenial("CAPABILITY_DISABLED")],
      [currentRegistry(registryWith({ [TEXT]: revoked })), capabilityDenial("CAPABILITY_REVOKED")],
      [currentRegistry(textWithHelper(helper(revoked))), capabilityDenial("CAPABILITY_DEPENDENCY_UNAVAILABLE")],
      [currentRegistry(registryWith({ [TEXT]: remoteClass })), capabilityDenial("EXECUTION_CLASS_UNSUPPORTED")],
      [currentRegistry(registryWith({ [TEXT]: futureSchema })), capabilityDenial("CAPABILITY_INCOMPATIBLE")],
      [{ runtimeVersion: "2.0.0" }, capabilityDenial("CAPABILITY_INCOMPATIBLE", CONTAINER_REF)],
      [currentRegistry(withoutText), capabilityDenial("UNKNOWN_CAPABILITY")]
    ];
    for (const [overrides, expected] of currentEligibility) {
      expect(await issue(content, overrides)).toEqual(expected);
    }

    const incompatible = { kind: "DENIED", executable: false, error_code: "F02-ERR-017" } as const;
    const tamperedSnapshot = {
      registrySnapshots: new Map([
        [VALIDATOR_REGISTRY.registry_version, { ...snapshotOf(), registry_digest: `sha256:${"0".repeat(64)}` }]
      ])
    };
    expect(await issue(content, { supportedBlueprintSchemaRange: ">=2.0.0 <3.0.0" })).toEqual({ ...incompatible, step: "E05" });
    expect(await issue(content, { registrySnapshots: new Map() })).toEqual({ ...incompatible, step: "E06" });
    expect(await issue(content, tamperedSnapshot)).toEqual({ ...incompatible, step: "E06" });
    expect(
      await issue(content, { supportedBlueprintSchemaRange: ">=2.0.0 <3.0.0", registrySnapshots: new Map() })
    ).toEqual({ ...incompatible, step: "E05" });

    setTrustStatus(content, "QUARANTINED");
    expect(await issue(content)).toEqual({ kind: "DENIED", step: "E04", executable: false });
    setTrustStatus(content, "INCOMPATIBLE");
    expect(await issue(content, currentRegistry(registryWith({ [TEXT]: revoked })))).toEqual({ ...incompatible, step: "E03" });
    setTrustStatus(content, "REVOKED");
    expect(await issue(content, { registrySnapshots: new Map() })).toEqual({
      kind: "DENIED",
      step: "E02",
      executable: false,
      error_code: "F02-ERR-016"
    });

    const notFound = { kind: "NOT_FOUND", step: "E01", executable: false, http_status: 404 };
    const service = createExecutionAdmissionService(content.repository, deployment());
    expect(await service.issueExecutionAdmission(`sha256:${"f".repeat(64)}`)).toEqual(notFound);
    expect(await service.issueExecutionAdmission("../../etc/passwd")).toEqual(notFound);

    const failingReader: BlueprintTrustReader = {
      getBlueprintTrust: () => Promise.reject(new Error("connection reset"))
    };
    expect(await createExecutionAdmissionService(failingReader, deployment()).issueExecutionAdmission(content.contentHash)).toEqual({
      kind: "UNAVAILABLE",
      step: "E08",
      executable: false,
      http_status: 503,
      retryable: true
    });
  });
});
