import { describe, expect, test } from "vitest";

import { VALIDATOR_REGISTRY } from "../../generated/capabilities/validator-registry.js";
import { admitBlueprint, UntrustedValidationResultError } from "../../src/platform/blueprint/blueprint-admission.js";
import {
  assertExecutable,
  createExecutionAdmissionService,
  createExecutionRuntimeContext,
  UntrustedExecutionContextError,
  type ExecutionRuntimeContext
} from "../../src/platform/blueprint/execution-admission.js";
import { PostgresBlueprintAdmissionRepository } from "../../src/platform/blueprint/postgres-blueprint-repository.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import type { BlueprintValidationResult } from "../../src/platform/blueprint/validation-types.js";
import { FakeBlueprintPostgres } from "./blueprint-postgres-fake.js";
import { encode, validBlueprint, type JsonRecord } from "./blueprint-validation-fixtures.js";
import { admittedContent, deployment, setTrustStatus, snapshotOf } from "./execution-admission-harness.js";

const CLIENT_AUTHORITY_CLAIMS: Readonly<JsonRecord> = {
  trust_status: "VALIDATED",
  executable: true,
  registry_digest: VALIDATOR_REGISTRY.registry_digest,
  runtime_version: "1.0.0",
  validator_registry: { registry_version: "5.0.0" },
  execution_runtime_context: { runtime_version: "1.0.0" },
  content_hash: `sha256:${"a".repeat(64)}`
};

function validate(candidate: unknown): BlueprintValidationResult {
  return validateBlueprintCandidate(encode(candidate));
}

describe("F02 server-owned trust boundary", () => {
  test("TEST-F02-012 never lets client-supplied trust, executable, version or registry context bypass validation or admission", async () => {
    for (const [key, value] of Object.entries(CLIENT_AUTHORITY_CLAIMS)) {
      const claimed = validate({ ...validBlueprint(), [key]: value });
      expect(claimed.report.status, key).toBe("REJECTED");
      expect(claimed.report.issues, key).toEqual([{ error_code: "F02-ERR-002", stage: "V02", json_path: `$.${key}` }]);
      expect(claimed.report.content_hash, key).toBeUndefined();
    }
    const claimedNode = validBlueprint();
    (claimedNode.nodes as JsonRecord[])[0]!.executable = true;
    expect(validate(claimedNode).report.issues).toEqual([{ error_code: "F02-ERR-002", stage: "V02", json_path: "$.nodes[0].executable" }]);
    const claimedVersion = validate({ ...validBlueprint(), registry_version: "4.0.0" });
    expect(claimedVersion.report.status).toBe("INCOMPATIBLE");
    expect(claimedVersion.report.registry_version).toBe(VALIDATOR_REGISTRY.registry_version);

    const database = new FakeBlueprintPostgres();
    const repository = new PostgresBlueprintAdmissionRepository(database);
    const genuine = validate(validBlueprint());
    const rejected = validate({ ...validBlueprint(), trust_status: "VALIDATED" });
    const forgeries: readonly unknown[] = [
      { ...genuine },
      structuredClone(genuine),
      { ...rejected },
      {
        report: { ...rejected.report, status: "PASSED", content_hash: `sha256:${"b".repeat(64)}`, issues: [] },
        admissible: genuine.admissible
      }
    ];
    for (const forged of forgeries) {
      await expect(admitBlueprint(forged as BlueprintValidationResult, repository)).rejects.toBeInstanceOf(
        UntrustedValidationResultError
      );
    }
    expect(database.statements).toEqual([]);

    const content = await admittedContent();
    const record = await content.repository.getBlueprintTrust(content.contentHash);
    expect(record).toBeDefined();
    const trusted = createExecutionRuntimeContext(deployment(), VALIDATOR_REGISTRY.registry_version);
    expect(assertExecutable(record!, trusted)).toBeUndefined();
    const forgedContexts: readonly ExecutionRuntimeContext[] = [
      { ...trusted },
      {
        runtime_version: "1.0.0",
        supported_blueprint_schema_range: ">=1.0.0 <2.0.0",
        registry_snapshot: snapshotOf(),
        now: new Date()
      }
    ];
    for (const forged of forgedContexts) {
      expect(() => assertExecutable(record!, forged)).toThrowError(UntrustedExecutionContextError);
    }

    const service = createExecutionAdmissionService(content.repository, deployment());
    for (const [trustStatus, expected] of [
      ["REVOKED", { kind: "DENIED", step: "E02", executable: false, error_code: "F02-ERR-016" }],
      ["INCOMPATIBLE", { kind: "DENIED", step: "E03", executable: false, error_code: "F02-ERR-017" }]
    ] as const) {
      setTrustStatus(content, trustStatus);
      const reused = await admitBlueprint(validate(validBlueprint()), content.repository);
      expect(reused).toMatchObject({ status: "ADMITTED", reused: true, trustStatus });
      expect(reused).not.toHaveProperty("executable");
      expect(await service.issueExecutionAdmission(content.contentHash)).toEqual(expected);
    }
  });
});
