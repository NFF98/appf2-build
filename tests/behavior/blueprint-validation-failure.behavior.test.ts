import { describe, expect, test } from "vitest";

import { VALIDATOR_REGISTRY } from "../../generated/capabilities/validator-registry.js";
import { admitBlueprint } from "../../src/platform/blueprint/blueprint-admission.js";
import { canonicalizeJson } from "../../src/platform/blueprint/canonical-json.js";
import { hashBlueprint } from "../../src/platform/blueprint/content-identity.js";
import {
  createExecutionAdmissionService,
  type ExecutionAdmissionService,
  type ExecutionContentSource
} from "../../src/platform/blueprint/execution-admission.js";
import { PostgresBlueprintAdmissionRepository } from "../../src/platform/blueprint/postgres-blueprint-repository.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import type { BlueprintValidationResult } from "../../src/platform/blueprint/validation-types.js";
import { CURRENT_BUNDLED_RELEASE, createBundledReleaseSource } from "../../src/platform/capabilities/bundled-release.js";
import type { ValidatorRegistry } from "../../src/platform/capabilities/schema/validator-contract.js";
import { FakeBlueprintPostgres } from "../contract/blueprint-postgres-fake.js";
import {
  actionIndex,
  nodeIndex,
  source,
  validBlueprint,
  withValue,
  type JsonRecord
} from "../contract/blueprint-validation-fixtures.js";
import { expectDenied, handlersFor, registryWithEntry, RUNTIME_VERSION, SCHEMA_RANGE } from "../contract/execution-safety-fixtures.js";

const TEXT = { id: "content.text", version: "1.0.0" };
const NOW = (): Date => new Date("2026-10-04T00:00:00.000Z");
const EXISTING_RUN = "00000000-0000-4000-8000-0000000000e0";
const REJECTED_BODY_MARKER = "rejected-candidate-body-marker-7f3a";

function runId(index: number): string {
  return `00000000-0000-4000-8000-${(index + 1).toString(16).padStart(12, "0")}`;
}

function nonPreserving(candidate: JsonRecord = validBlueprint()): JsonRecord {
  candidate.support = {
    coverage_status: "PARTIALLY_SUPPORTED",
    degradations: [{ requirement_id: "req_core", description: "核心計算改變", capability_refs: [TEXT], preserves_semantic_core: false }]
  };
  return candidate;
}

function withMarker(candidate: JsonRecord): JsonRecord {
  candidate.meta = { title: REJECTED_BODY_MARKER, description: REJECTED_BODY_MARKER };
  return candidate;
}

function tooManySteps(): JsonRecord {
  return withValue(["actions", actionIndex("action_reset"), "steps"], Array.from({ length: 17 }, () => ({ type: "RESET_STATE", target: "ALL_MUTABLE" })));
}

interface FailingCandidate {
  readonly label: string;
  readonly payload: string;
  readonly registry?: ValidatorRegistry;
  readonly status: "REJECTED" | "INCOMPATIBLE";
  readonly code: string;
  readonly stage: string;
}

const EXISTING_JSON = JSON.stringify(validBlueprint());
const DISABLED_TEXT = registryWithEntry(VALIDATOR_REGISTRY, TEXT, (entry) => ({ ...entry, availability: "DISABLED" }));
const NETWORK_TEXT = registryWithEntry(VALIDATOR_REGISTRY, TEXT, (entry) => ({
  ...entry,
  resource_budget: { ...entry.resource_budget, networkAccessAllowed: true }
}));

function failing(label: string, candidate: JsonRecord | string, code: string, stage: string, extra: Partial<FailingCandidate> = {}): FailingCandidate {
  const payload = typeof candidate === "string" ? candidate : JSON.stringify(candidate);
  return { label, payload, status: "REJECTED", code, stage, ...extra };
}

/** Refinements of the existing validated Blueprint that fail at every deterministic stage family. */
const FAILURES: readonly FailingCandidate[] = [
  failing("V01 truncated JSON", EXISTING_JSON.slice(0, -1), "F02-ERR-001", "V01"),
  failing("V01 duplicate key", `{"kind":"APP",${EXISTING_JSON.slice(1)}`, "F02-ERR-001", "V01"),
  failing("V02 unknown executable key", withValue(["extra"], true), "F02-ERR-002", "V02"),
  failing("V03 unknown Registry snapshot", withValue(["registry_version"], "6.0.0"), "F02-ERR-004", "V03", { status: "INCOMPATIBLE" }),
  failing("V04 unknown capability version", withValue(["nodes", nodeIndex("node_title"), "capability", "version"], "9.9.9"), "F02-ERR-005", "V04"),
  failing("V05 state initial type", withValue(["state", "people", "initial"], "four"), "F02-ERR-006", "V05"),
  failing("V06 missing child ref", withValue(["nodes", 0, "children", 0], "node_missing"), "F02-ERR-007", "V06"),
  failing("V07 missing STATE ref", withValue(["nodes", nodeIndex("node_stat"), "bindings", "value"], source.state("missing")), "F02-ERR-008", "V07"),
  failing("V08 SET_STATE to DERIVED", withValue(["actions", actionIndex("action_set_people"), "steps", 0, "target"], "per_person"), "F02-ERR-010", "V08"),
  failing("V09 steps per action", tooManySteps(), "F02-ERR-011", "V09"),
  failing("V10 network permission", validBlueprint(), "F02-ERR-012", "V10", { registry: NETWORK_TEXT }),
  failing("V11 semantic core not preserved", nonPreserving(), "F02-ERR-014", "V11"),
  failing("existing body re-validated after capability disabled", EXISTING_JSON, "F02-ERR-005", "V04", { registry: DISABLED_TEXT })
];

function validateText(payload: string, validationRunId: string, registry?: ValidatorRegistry): BlueprintValidationResult {
  return validateBlueprintCandidate(new TextEncoder().encode(payload), {
    validationRunId,
    traceId: `trace-${validationRunId}`,
    ...(registry === undefined ? {} : { registry })
  });
}

/** Test-only reader over the fake durable tables; production repository wiring is not part of this proof. */
function contentSource(database: FakeBlueprintPostgres): ExecutionContentSource {
  return {
    readContent: (contentHash) =>
      Promise.resolve().then(() => {
        const row = database.contents.get(contentHash);
        if (row === undefined) {
          return undefined;
        }
        const admittingRun = database.runs.get(row.admitted_by_validation_run_id);
        return {
          content_hash: row.content_hash,
          canonical_blueprint: row.canonical_blueprint,
          schema_version: row.schema_version,
          registry_version: row.registry_version,
          trust_status: row.trust_status,
          admitted_registry_digest: String(admittingRun?.report.registry_digest)
        };
      })
  };
}

function executionAdmission(database: FakeBlueprintPostgres): ExecutionAdmissionService {
  return createExecutionAdmissionService({
    content: contentSource(database),
    releases: createBundledReleaseSource({ bundledHandlers: handlersFor(CURRENT_BUNDLED_RELEASE) }),
    runtimeVersion: RUNTIME_VERSION,
    supportedBlueprintSchemaRange: SCHEMA_RANGE,
    now: NOW
  });
}

interface Durable {
  readonly database: FakeBlueprintPostgres;
  readonly repository: PostgresBlueprintAdmissionRepository;
  readonly admission: ExecutionAdmissionService;
}

function durable(): Durable {
  const database = new FakeBlueprintPostgres();
  return { database, repository: new PostgresBlueprintAdmissionRepository(database), admission: executionAdmission(database) };
}

async function admitExisting(store: Durable): Promise<string> {
  const existing = validateText(EXISTING_JSON, EXISTING_RUN);
  expect(existing.report.status).toBe("PASSED");
  expect(await admitBlueprint(existing, store.repository, { now: NOW })).toMatchObject({ status: "ADMITTED", reused: false });
  return existing.report.content_hash ?? "";
}

async function expectFailureRecordedOnly(store: Durable, failure: FailingCandidate, validationRunId: string): Promise<void> {
  const result = validateText(failure.payload, validationRunId, failure.registry);
  const [issue] = result.report.issues;
  expect(result.report.status, failure.label).toBe(failure.status);
  expect({ code: issue?.error_code, stage: issue?.stage }, failure.label).toEqual({ code: failure.code, stage: failure.stage });
  expect(result.admissible, failure.label).toBeUndefined();
  expect(result.report.content_hash, failure.label).toBeUndefined();

  const statementsBefore = store.database.statements.length;
  const outcome = await admitBlueprint(result, store.repository, { now: NOW });
  expect(outcome, failure.label).toEqual({ status: "NOT_ADMITTED", report: result.report });
  const issued = store.database.statements.slice(statementsBefore);
  expect(issued, failure.label).toHaveLength(1);
  expect(issued[0], failure.label).toMatch(/^INSERT INTO public\.validation_run/);
  expect(store.database.runs.get(validationRunId), failure.label).toMatchObject({
    status: failure.status,
    blueprint_hash: null,
    error_codes: [failure.code]
  });
}

async function expectExecutable(store: Durable, contentHash: string, label: string): Promise<void> {
  const decision = await store.admission.admit(contentHash);
  expect(decision.executable, label).toBe(true);
  expect(decision.executable ? decision.admission.content_hash : undefined, label).toBe(contentHash);
}

async function expectForgedResultsNeverPersist(store: Durable): Promise<void> {
  const rejectedCandidate = withMarker(nonPreserving());
  const rejected = validateText(JSON.stringify(rejectedCandidate), runId(100));
  const genuine = validateText(EXISTING_JSON, runId(101));
  expect(rejected.report.status).toBe("REJECTED");
  expect(genuine.admissible).toBeDefined();
  const genuineAdmissible = genuine.admissible!;
  const rejectedJson = canonicalizeJson(rejectedCandidate);
  const rejectedHash = hashBlueprint(rejectedCandidate);
  const forgedAdmissible = { blueprint: rejectedCandidate, canonicalJson: rejectedJson, byteSize: rejectedJson.length, contentHash: rejectedHash };
  const forgeries: readonly [string, unknown][] = [
    ["rejected report relabelled PASSED", { report: { ...rejected.report, status: "PASSED", content_hash: rejectedHash, issues: [] }, admissible: forgedAdmissible }],
    ["rejected report carrying a genuine admissible", { ...rejected, admissible: genuineAdmissible }],
    ["genuine report with rejected body spliced in", { report: genuine.report, admissible: { ...genuineAdmissible, canonicalJson: rejectedJson, contentHash: rejectedHash } }],
    ["copied genuine report", { report: { ...genuine.report }, admissible: genuineAdmissible }],
    ["copied genuine admissible", { report: genuine.report, admissible: { ...genuineAdmissible } }]
  ];
  const statementsBefore = store.database.statements.length;
  for (const [label, forged] of forgeries) {
    await expect(admitBlueprint(forged as BlueprintValidationResult, store.repository, { now: NOW }), label).rejects.toThrow("validator-issued");
  }
  expect(() => Object.assign(genuineAdmissible, { canonicalJson: rejectedJson })).toThrow(TypeError);
  expect(() => Object.assign(genuine.report, { content_hash: rejectedHash })).toThrow(TypeError);
  expect(store.database.statements.length).toBe(statementsBefore);
  expect(store.database.contents.has(rejectedHash)).toBe(false);
  expectDenied(await store.admission.admit(rejectedHash), { step: "E01", http: 404 }, "forged rejected body hash");
}

describe("F02 validation failure isolation", () => {
  test("TEST-F02-AC-013 validation failure at any stage never corrupts an existing validated Blueprint", async () => {
    const store = durable();
    const existingHash = await admitExisting(store);
    const existingRow = structuredClone(store.database.contents.get(existingHash));
    const existingRun = structuredClone(store.database.runs.get(EXISTING_RUN));
    await expectExecutable(store, existingHash, "before failures");

    for (const [index, failure] of FAILURES.entries()) {
      await expectFailureRecordedOnly(store, failure, runId(index));
      expect(store.database.contents.get(existingHash), failure.label).toEqual(existingRow);
      await expectExecutable(store, existingHash, `after ${failure.label}`);
    }

    expect([...store.database.contents.keys()]).toEqual([existingHash]);
    expect(store.database.contents.get(existingHash)).toEqual(existingRow);
    expect(store.database.contents.get(existingHash)?.trust_status).toBe("VALIDATED");
    expect(store.database.runs.get(EXISTING_RUN)).toEqual(existingRun);
    expect(store.database.runs.size).toBe(FAILURES.length + 1);

    const reused = await admitBlueprint(validateText(EXISTING_JSON, runId(FAILURES.length)), store.repository, { now: NOW });
    expect(reused).toMatchObject({ status: "ADMITTED", contentHash: existingHash, reused: true, trustStatus: "VALIDATED" });
    expect(store.database.contents.get(existingHash)).toEqual(existingRow);
  });

  test("TEST-F02-AC-014 a rejected candidate body never becomes an executable durable artifact", async () => {
    const store = durable();
    const candidates: readonly [string, JsonRecord, string][] = [
      ["semantic core not preserved", withMarker(nonPreserving()), "REJECTED"],
      ["unknown executable key", withMarker(withValue(["extra"], true)), "REJECTED"],
      ["unknown capability", withMarker(withValue(["nodes", nodeIndex("node_title"), "capability", "version"], "9.9.9")), "REJECTED"],
      ["incompatible Registry snapshot", withMarker(withValue(["registry_version"], "6.0.0")), "INCOMPATIBLE"]
    ];
    for (const [index, [label, candidate, status]] of candidates.entries()) {
      const result = validateText(JSON.stringify(candidate), runId(index));
      expect(result.report.status, label).toBe(status);
      expect(result.admissible, label).toBeUndefined();
      expect(JSON.stringify(result.report), label).not.toContain(REJECTED_BODY_MARKER);
      expect(await admitBlueprint(result, store.repository, { now: NOW }), label).toMatchObject({ status: "NOT_ADMITTED" });
      const run = store.database.runs.get(runId(index));
      expect(run, label).toMatchObject({ status, blueprint_hash: null, candidate_digest: result.report.candidate_digest });
      expect(JSON.stringify(run), label).not.toContain(REJECTED_BODY_MARKER);
      expectDenied(await store.admission.admit(hashBlueprint(candidate)), { step: "E01", http: 404 }, `${label} canonical hash`);
      expectDenied(await store.admission.admit(result.report.candidate_digest), { step: "E01", http: 404 }, `${label} candidate digest`);
    }
    expect(store.database.contents.size).toBe(0);
    for (const statement of store.database.statements) {
      expect(statement).not.toContain("public.blueprint_content");
    }

    await expectForgedResultsNeverPersist(store);
    expect(store.database.contents.size).toBe(0);
  });
});
