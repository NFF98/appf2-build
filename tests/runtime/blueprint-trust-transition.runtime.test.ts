import { describe, expect, test } from "vitest";

import { verifyAdmissionLineage } from "../../src/platform/blueprint/admission-lineage.js";
import { admitBlueprint } from "../../src/platform/blueprint/blueprint-admission.js";
import {
  createBlueprintTrustTransitionService,
  type BlueprintTrustTransitionService,
  type TrustTransitionRequest,
  type TrustTransitionServiceConfig
} from "../../src/platform/blueprint/blueprint-trust-transition.js";
import { canonicalizeJson } from "../../src/platform/blueprint/canonical-json.js";
import {
  PostgresAdmissionLineageSource,
  PostgresBlueprintAdmissionRepository,
  PostgresBlueprintTrustTransitionRepository,
  POSTGRES_COMPARE_AND_SET_TRUST_STATUS_SQL
} from "../../src/platform/blueprint/postgres-blueprint-repository.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import { FakeBlueprintPostgres, type StoredBlueprintContent } from "../contract/blueprint-postgres-fake.js";
import { expectDenied } from "../contract/execution-safety-fixtures.js";
import { validBlueprint, type JsonRecord } from "../contract/blueprint-validation-fixtures.js";
import {
  CANONICAL_TRACE,
  evidenceCapture,
  eventTypes,
  executionAdmission,
  expectRegistryShaped,
  NOW,
  runId,
  type EvidenceCapture,
  type EvidenceFailureMode
} from "./blueprint-evidence-support.js";

const UPSTREAM_TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const BODY_MARKER = "transition-raw-body-marker-31b9";
const INTENT_MARKER = "transition-raw-intent-marker-0d6e";
const UNKNOWN_HASH = `sha256:${"d".repeat(64)}`;

type Terminal = "REVOKED" | "INCOMPATIBLE";

interface Fixture {
  readonly database: FakeBlueprintPostgres;
  readonly capture: EvidenceCapture;
  readonly service: BlueprintTrustTransitionService;
  readonly contentHash: string;
  readonly body: JsonRecord;
}

function blueprint(title: string): JsonRecord {
  return { ...validBlueprint(), meta: { title, description: INTENT_MARKER } };
}

async function admitBody(database: FakeBlueprintPostgres, body: JsonRecord, validationRunId: string, capture?: EvidenceCapture) {
  const result = validateBlueprintCandidate(new TextEncoder().encode(JSON.stringify(body)), { validationRunId });
  return admitBlueprint(result, new PostgresBlueprintAdmissionRepository(database), { now: NOW, ...(capture === undefined ? {} : { evidence: capture.options }) });
}

async function fixture(mode: EvidenceFailureMode = "NONE", title = BODY_MARKER): Promise<Fixture> {
  const database = new FakeBlueprintPostgres();
  const body = blueprint(title);
  const admitted = await admitBody(database, body, runId(0));
  expect(admitted).toMatchObject({ status: "ADMITTED", reused: false });
  const capture = evidenceCapture(mode);
  const service = createBlueprintTrustTransitionService({ repository: new PostgresBlueprintTrustTransitionRepository(database), evidence: capture.options });
  return { database, capture, service, contentHash: admitted.status === "ADMITTED" ? admitted.contentHash : "", body };
}

function transition(target: Fixture, status: Terminal, traceId?: string) {
  const context = traceId === undefined ? undefined : { traceId };
  return status === "REVOKED" ? target.service.revoke(target.contentHash, context) : target.service.markIncompatible(target.contentHash, context);
}

/** Every blueprint_content column except trust_status, which is the only column a transition may change. */
function immutableColumns(row: StoredBlueprintContent | undefined): StoredBlueprintContent {
  return { ...structuredClone(row!), trust_status: "<excluded>" };
}

const SUCCESS_EVENT: Readonly<Record<Terminal, string>> = { REVOKED: "F02-EVT-008", INCOMPATIBLE: "F02-EVT-014" };
const EXECUTION_DENIAL: Readonly<Record<Terminal, { step: string; code: string }>> = {
  REVOKED: { step: "E02", code: "F02-ERR-016" },
  INCOMPATIBLE: { step: "E03", code: "F02-ERR-017" }
};
const OTHER: Readonly<Record<Terminal, Terminal>> = { REVOKED: "INCOMPATIBLE", INCOMPATIBLE: "REVOKED" };

/** Success → exactly one EVT008/EVT014; stale replay and terminal rewrite → no update, no further success Evidence. */
async function expectSuccessfulTransition(status: Terminal): Promise<void> {
  const target = await fixture();
  const before = immutableColumns(target.database.contents.get(target.contentHash));
  const lineageBefore = await verifyAdmissionLineage(target.contentHash, new PostgresAdmissionLineageSource(target.database));

  const result = await transition(target, status, UPSTREAM_TRACE);
  expect(result, status).toEqual({ status: "TRANSITIONED", content_hash: target.contentHash, previous_status: "VALIDATED", new_status: status, trace_id: UPSTREAM_TRACE });
  expect(target.database.contents.get(target.contentHash)?.trust_status, status).toBe(status);
  expect(immutableColumns(target.database.contents.get(target.contentHash)), status).toEqual(before);
  expect(await verifyAdmissionLineage(target.contentHash, new PostgresAdmissionLineageSource(target.database)), status).toEqual(
    lineageBefore.verified ? { ...lineageBefore, trust_status: status } : lineageBefore
  );
  expect(target.capture.stored, status).toEqual([
    expect.objectContaining({
      event_type: SUCCESS_EVENT[status],
      function_id: "F02",
      trace_id: UPSTREAM_TRACE,
      properties: { content_hash: target.contentHash, blueprint_schema_version: "1.0.0", registry_version: "7.0.0", validation_stage: "TRUST" }
    })
  ]);
  expect(target.capture.stored[0]?.error_code, status).toBeUndefined();

  for (const [label, attempt] of [
    ["replay", () => transition(target, status, UPSTREAM_TRACE)],
    ["terminal rewrite", () => transition(target, OTHER[status])]
  ] as const) {
    expect(await attempt(), `${status} ${label}`).toMatchObject({ status: "NOT_TRANSITIONED", reason: "STATUS_MISMATCH" });
  }
  expect(target.database.contents.get(target.contentHash)?.trust_status, status).toBe(status);
  expect(eventTypes(target.capture), status).toEqual([SUCCESS_EVENT[status]]);

  const eventsBefore = target.capture.stored.length;
  expectDenied(await executionAdmission(target.database).admit(target.contentHash), EXECUTION_DENIAL[status], `${status} execution`);
  expect(target.capture.stored.length, "execution denial is not transition Evidence").toBe(eventsBefore);
  expectRegistryShaped(target.capture, status);
}

/** Same-hash revalidation reuses immutable content and can never reset a terminal trust status. */
async function expectRevalidationCannotReset(status: Terminal): Promise<void> {
  const target = await fixture();
  await transition(target, status);
  const before = structuredClone(target.database.contents.get(target.contentHash));
  const capture = evidenceCapture();
  const reused = await admitBody(target.database, target.body, runId(1), capture);
  expect(reused, status).toEqual({ status: "ADMITTED", validationRunId: runId(1), contentHash: target.contentHash, reused: true, trustStatus: status });
  expect(target.database.contents.get(target.contentHash), status).toEqual(before);
  expect(eventTypes(capture), status).toEqual(["F02-EVT-002"]);
  expectDenied(await executionAdmission(target.database).admit(target.contentHash), EXECUTION_DENIAL[status], `${status} after reuse`);
}

async function expectNoAuthorityOutsideCas(): Promise<void> {
  const target = await fixture();
  expect(Object.keys(target.service).sort()).toEqual(["markIncompatible", "revoke"]);
  expect(Object.isFrozen(target.service)).toBe(true);
  const clientShaped = target.service.revoke as (hash: string, ...client: unknown[]) => ReturnType<BlueprintTrustTransitionService["revoke"]>;
  expect(await clientShaped(target.contentHash, { traceId: "client-trace", trust_status: "VALIDATED", new_status: "VALIDATED" }, "VALIDATED")).toMatchObject({
    status: "TRANSITIONED",
    new_status: "REVOKED",
    trace_id: expect.stringMatching(CANONICAL_TRACE)
  });
  expect(target.capture.stored[0]?.trace_id).not.toBe("client-trace");

  const repository = new PostgresBlueprintTrustTransitionRepository(target.database);
  const base: TrustTransitionRequest = { content_hash: target.contentHash, previous_status: "VALIDATED", new_status: "REVOKED", trace_id: UPSTREAM_TRACE };
  const forged: readonly [string, Record<string, unknown>][] = [
    ["terminal → VALIDATED", { previous_status: "REVOKED", new_status: "VALIDATED" }],
    ["VALIDATED → VALIDATED", { new_status: "VALIDATED" }],
    ["REVOKED → INCOMPATIBLE", { previous_status: "REVOKED", new_status: "INCOMPATIBLE" }],
    ["non-canonical trace", { trace_id: "client-trace" }],
    ["non-canonical hash", { content_hash: "not-a-hash" }]
  ];
  const statementsBefore = target.database.statements.length;
  for (const [label, change] of forged) {
    await expect(repository.compareAndSetTrustStatus({ ...base, ...change } as unknown as TrustTransitionRequest), label).rejects.toThrow(TypeError);
  }
  expect(target.database.statements.length).toBe(statementsBefore);
  const sqlGuard = await target.database.query<{ transitioned: boolean }>(POSTGRES_COMPARE_AND_SET_TRUST_STATUS_SQL, [target.contentHash, "REVOKED", "VALIDATED"]);
  expect(sqlGuard.rows[0]?.transitioned).toBe(false);
  expect(target.database.contents.get(target.contentHash)?.trust_status).toBe("REVOKED");
  expect(eventTypes(target.capture)).toEqual(["F02-EVT-008"]);
  expect(() => createBlueprintTrustTransitionService({ repository } as unknown as TrustTransitionServiceConfig)).toThrow(TypeError);
}

async function expectNoFalseSuccessEvidence(): Promise<void> {
  const target = await fixture();
  expect(await target.service.revoke(UNKNOWN_HASH)).toMatchObject({ status: "NOT_TRANSITIONED", reason: "UNKNOWN_CONTENT" });
  const statementsBefore = target.database.statements.length;
  expect(await target.service.markIncompatible("sha256:NOT-CANONICAL")).toMatchObject({ status: "NOT_TRANSITIONED", reason: "UNKNOWN_CONTENT" });
  expect(target.database.statements.length).toBe(statementsBefore);

  target.database.failNext = POSTGRES_COMPARE_AND_SET_TRUST_STATUS_SQL;
  await expect(target.service.revoke(target.contentHash)).rejects.toThrow("simulated database write failure");
  expect(target.database.contents.get(target.contentHash)?.trust_status).toBe("VALIDATED");
  expect(target.capture.ingested).toEqual([]);

  const [first, second] = await Promise.all([target.service.revoke(target.contentHash), target.service.markIncompatible(target.contentHash)]);
  expect([first?.status, second?.status].sort()).toEqual(["NOT_TRANSITIONED", "TRANSITIONED"]);
  expect(eventTypes(target.capture)).toHaveLength(1);
  expectRegistryShaped(target.capture, "concurrent transitions");
}

async function expectEvidenceFailureKeepsTerminalStatus(): Promise<void> {
  const modes: readonly EvidenceFailureMode[] = ["INTAKE_THROWS", "STORAGE_THROWS", "INTAKE_REJECTS", "DIAGNOSTICS_THROW"];
  for (const [index, mode] of modes.entries()) {
    const status: Terminal = index % 2 === 0 ? "REVOKED" : "INCOMPATIBLE";
    const target = await fixture(mode);
    expect(await transition(target, status), mode).toMatchObject({ status: "TRANSITIONED", new_status: status });
    expect(target.database.contents.get(target.contentHash)?.trust_status, mode).toBe(status);
    expect(target.capture.stored, mode).toEqual([]);
    expect(target.capture.diagnostics.length, mode).toBeGreaterThanOrEqual(1);
    expectDenied(await executionAdmission(target.database).admit(target.contentHash), EXECUTION_DENIAL[status], `${mode} execution`);
  }
}

async function expectNoRawPayloadInTransitionEvidence(): Promise<void> {
  const target = await fixture();
  await target.service.revoke(target.contentHash, { traceId: "malformed" });
  const serialized = JSON.stringify([target.capture.ingested, target.capture.stored]);
  for (const forbidden of [BODY_MARKER, INTENT_MARKER, canonicalizeJson(target.body), "canonical_blueprint"]) {
    expect(serialized).not.toContain(forbidden);
  }
  expect(target.capture.stored[0]?.trace_id).toMatch(CANONICAL_TRACE);
  expectRegistryShaped(target.capture, "raw payload exclusion");
}

describe("F02 trusted Blueprint trust transitions", () => {
  test("TEST-F02-AC-022 trusted server CAS VALIDATED→REVOKED|INCOMPATIBLE emits EVT008/EVT014 without mutating body or admission lineage", async () => {
    for (const status of ["REVOKED", "INCOMPATIBLE"] as const) {
      await expectSuccessfulTransition(status);
      await expectRevalidationCannotReset(status);
    }
    await expectNoAuthorityOutsideCas();
    await expectNoFalseSuccessEvidence();
    await expectEvidenceFailureKeepsTerminalStatus();
    await expectNoRawPayloadInTransitionEvidence();
  });
});
