import { expect } from "vitest";

import { VALIDATOR_REGISTRY } from "../../generated/capabilities/validator-registry.js";
import { admitBlueprint } from "../../src/platform/blueprint/blueprint-admission.js";
import type { ExecutionDeployment, TrustedRegistrySnapshot } from "../../src/platform/blueprint/execution-admission.js";
import { PostgresBlueprintAdmissionRepository } from "../../src/platform/blueprint/postgres-blueprint-repository.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import type { ValidatorRegistry } from "../../src/platform/capabilities/schema/validator-contract.js";
import { FakeBlueprintPostgres } from "./blueprint-postgres-fake.js";
import { encode, validBlueprint } from "./blueprint-validation-fixtures.js";

export const ISSUED_AT = "2026-10-04T12:00:00.000Z";
export const ADMISSION_ID = "00000000-0000-4000-8000-0000000000ad";

export interface AdmittedContent {
  readonly database: FakeBlueprintPostgres;
  readonly repository: PostgresBlueprintAdmissionRepository;
  readonly contentHash: string;
}

export async function admittedContent(candidate: unknown = validBlueprint()): Promise<AdmittedContent> {
  const database = new FakeBlueprintPostgres();
  const repository = new PostgresBlueprintAdmissionRepository(database);
  const admitted = await admitBlueprint(validateBlueprintCandidate(encode(candidate)), repository);
  expect(admitted.status).toBe("ADMITTED");
  if (admitted.status !== "ADMITTED") {
    throw new Error("Fixture content was not admitted.");
  }
  expect(admitted.trustStatus).toBe("VALIDATED");
  return { database, repository, contentHash: admitted.contentHash };
}

export function snapshotOf(registry: ValidatorRegistry = VALIDATOR_REGISTRY): TrustedRegistrySnapshot {
  return {
    registry_version: registry.registry_version,
    registry_digest: registry.registry_digest,
    validator_registry: registry
  };
}

export function deployment(overrides: Partial<ExecutionDeployment> = {}): ExecutionDeployment {
  return {
    runtimeVersion: "1.0.0",
    supportedBlueprintSchemaRange: ">=1.0.0 <2.0.0",
    registrySnapshots: new Map([[VALIDATOR_REGISTRY.registry_version, snapshotOf()]]),
    now: () => new Date(ISSUED_AT),
    newAdmissionId: () => ADMISSION_ID,
    ...overrides
  };
}

export function setTrustStatus(content: AdmittedContent, trustStatus: string): void {
  const stored = content.database.contents.get(content.contentHash);
  if (stored === undefined) {
    throw new Error("Admitted content is missing from the fake database.");
  }
  stored.trust_status = trustStatus;
}
