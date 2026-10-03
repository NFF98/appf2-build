import { describe, expect, test } from "vitest";

import { admitBlueprint } from "../../src/platform/blueprint/blueprint-admission.js";
import { issueExecutionAdmission } from "../../src/platform/blueprint/execution-admission.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import { BLUEPRINT_SCHEMA_RANGE, RUNTIME_VERSION } from "../../src/platform/capabilities/registry.js";
import { encode, issueOf, nodeIndex, validBlueprint, withValue } from "./blueprint-validation-fixtures.js";
import {
  admitValidated,
  NOW,
  policyPatch,
  registrySource,
  requestAdmission,
  snapshotOf,
  snapshotStore,
  type AdmittedBlueprint
} from "./registry-snapshot-fixtures.js";

const BASE_SNAPSHOT = snapshotOf(registrySource("6.0.0"));
const REVOKED_CURRENT = snapshotOf(policyPatch(registrySource("6.0.0"), "6.0.3", "content.text", { executionStatus: "REVOKED" }));
const TITLE = nodeIndex("node_title");
const FORGED_FIELDS = [
  "trust_status",
  "executable",
  "schema_version",
  "registry_version",
  "registry_digest",
  "runtime_version",
  "validator_registry",
  "registry_snapshot",
  "current_registry_snapshot",
  "supported_blueprint_schema_range",
  "now",
  "admission"
] as const;

function forgedRequest(contentHash: string, accessed: Set<string>): Record<string, unknown> {
  const request: Record<string, unknown> = { content_hash: contentHash };
  for (const field of FORGED_FIELDS) {
    Object.defineProperty(request, field, {
      enumerable: true,
      get: () => {
        accessed.add(field);
        return field === "executable" ? true : field === "trust_status" ? "VALIDATED" : "9.9.9";
      }
    });
  }
  return request;
}

function expectCandidateFlagsCannotBypassValidation(): void {
  for (const key of ["trust_status", "executable", "content_hash", "registry_digest", "validated", "admission"]) {
    const result = validateBlueprintCandidate(encode(withValue([key], key === "executable" ? true : "VALIDATED")));
    expect(result.report.status, key).toBe("REJECTED");
    expect(result.admissible, key).toBeUndefined();
    expect(issueOf(result), key).toEqual({ code: "F02-ERR-002", stage: "V02", path: `$.${key}` });
  }
  for (const key of ["availability", "execution_status", "execution_contract_digest"]) {
    const result = validateBlueprintCandidate(encode(withValue(["nodes", TITLE, "capability", key], key === "availability" ? "ENABLED" : "ACTIVE")));
    expect(issueOf(result), key).toEqual({ code: "F02-ERR-002", stage: "V02", path: `$.nodes[${TITLE}].capability.${key}` });
  }
  expect(issueOf(validateBlueprintCandidate(encode(withValue(["nodes", TITLE, "trusted"], true))))).toEqual({
    code: "F02-ERR-002",
    stage: "V02",
    path: `$.nodes[${TITLE}].trusted`
  });
  const forgedRegistry = validateBlueprintCandidate(encode(withValue(["registry_version"], "6.0.3")));
  expect(forgedRegistry.report.status).toBe("INCOMPATIBLE");
  expect(issueOf(forgedRegistry)).toEqual({ code: "F02-ERR-004", stage: "V03", path: "$.registry_version" });
}

async function expectForgedAdmissionFieldsAreNeverRead(admitted: AdmittedBlueprint): Promise<void> {
  const accessed = new Set<string>();
  const revokedNow = snapshotStore({ pinned: [BASE_SNAPSHOT], current: async () => REVOKED_CURRENT });
  expect(await requestAdmission(admitted, revokedNow, forgedRequest(admitted.contentHash, accessed))).toMatchObject({
    kind: "DENIED",
    executable: false,
    stage: "E07",
    error_code: "F02-ERR-017",
    reason: "CAPABILITY_REVOKED"
  });

  const healthy = snapshotStore({ pinned: [BASE_SNAPSHOT], current: async () => BASE_SNAPSHOT });
  const allowed = await requestAdmission(admitted, healthy, forgedRequest(admitted.contentHash, accessed));
  expect(allowed.kind === "ALLOWED" ? allowed.admission : undefined).toMatchObject({
    content_hash: admitted.contentHash,
    trust_status: "VALIDATED",
    schema_version: "1.0.0",
    registry_version: "6.0.0",
    registry_digest: BASE_SNAPSHOT.registry_digest,
    runtime_version: RUNTIME_VERSION
  });
  expect([...accessed]).toEqual([]);

  const accessorHash = Object.defineProperty({}, "content_hash", { enumerable: true, get: () => admitted.contentHash });
  for (const request of [accessorHash, null, "content_hash", { content_hash: `sha256:${"f".repeat(64)}` }, { content_hash: "abc" }]) {
    expect(await requestAdmission(admitted, healthy, request)).toEqual({ kind: "NOT_FOUND", executable: false, stage: "E01", http_status: 404 });
  }
}

async function expectDurableTrustWinsOverClientFlags(admitted: AdmittedBlueprint): Promise<void> {
  const healthy = snapshotStore({ pinned: [BASE_SNAPSHOT], current: async () => BASE_SNAPSHOT });
  const stored = admitted.database.contents.get(admitted.contentHash)!;
  const expectations = [
    ["REVOKED", { stage: "E02", error_code: "F02-ERR-016", reason: "BLUEPRINT_REVOKED" }],
    ["INCOMPATIBLE", { stage: "E03", error_code: "F02-ERR-017", reason: "BLUEPRINT_INCOMPATIBLE" }],
    ["PENDING_REVIEW", { stage: "E04", reason: "TRUST_NOT_VALIDATED" }]
  ] as const;
  for (const [trustStatus, expected] of expectations) {
    stored.trust_status = trustStatus;
    const decision = await requestAdmission(admitted, healthy, forgedRequest(admitted.contentHash, new Set()));
    expect(decision, trustStatus).toEqual({ kind: "DENIED", executable: false, ...expected });
  }

  stored.trust_status = "REVOKED";
  const reused = await admitBlueprint(validateBlueprintCandidate(encode(validBlueprint())), admitted.repository, { now: () => NOW });
  expect(reused).toMatchObject({ status: "ADMITTED", reused: true, trustStatus: "REVOKED" });
  expect(reused).not.toHaveProperty("executable");
  expect((await requestAdmission(admitted, healthy)).kind).toBe("DENIED");
  stored.trust_status = "VALIDATED";
}

async function expectIntegrityAndInfrastructureFailClosed(admitted: AdmittedBlueprint): Promise<void> {
  const healthy = snapshotStore({ pinned: [BASE_SNAPSHOT], current: async () => BASE_SNAPSHOT });
  const stored = admitted.database.contents.get(admitted.contentHash)!;
  admitted.database.contents.set(admitted.contentHash, { ...stored, canonical_blueprint: { ...(stored.canonical_blueprint as object), kind: "APP", forged: true } });
  expect(await requestAdmission(admitted, healthy)).toEqual({ kind: "DENIED", executable: false, stage: "E04", reason: "CONTENT_INTEGRITY_FAILURE" });
  admitted.database.contents.set(admitted.contentHash, stored);

  const unavailable = await issueExecutionAdmission(
    { content_hash: admitted.contentHash },
    {
      blueprints: {
        loadExecutionRecord: async () => {
          throw new Error("connection reset");
        }
      },
      deployment: {
        runtimeVersion: RUNTIME_VERSION,
        supportedBlueprintSchemaRange: BLUEPRINT_SCHEMA_RANGE,
        snapshots: healthy,
        now: () => NOW,
        newAdmissionId: () => "unused"
      }
    }
  );
  expect(unavailable).toEqual({ kind: "UNAVAILABLE", executable: false, stage: "E08", http_status: 503, retryable: true });
}

describe("F02 client-supplied trust cannot bypass validation or execution admission", () => {
  test("TEST-F02-012 ignores client trust, executable, version, digest, Registry and runtime-context values in validation and fresh admission", async () => {
    expectCandidateFlagsCannotBypassValidation();
    const admitted = await admitValidated(validBlueprint(), BASE_SNAPSHOT);
    await expectForgedAdmissionFieldsAreNeverRead(admitted);
    await expectDurableTrustWinsOverClientFlags(admitted);
    await expectIntegrityAndInfrastructureFailClosed(admitted);
  });
});
