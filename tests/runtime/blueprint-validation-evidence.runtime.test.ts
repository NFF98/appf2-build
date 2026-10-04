import { createHash } from "node:crypto";

import { describe, expect, test } from "vitest";

import { admitBlueprint, type BlueprintAdmissionResult } from "../../src/platform/blueprint/blueprint-admission.js";
import { canonicalizeJson } from "../../src/platform/blueprint/canonical-json.js";
import { PostgresBlueprintAdmissionRepository } from "../../src/platform/blueprint/postgres-blueprint-repository.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import { MAX_CANDIDATE_PAYLOAD_BYTES, type BlueprintValidationResult } from "../../src/platform/blueprint/validation-types.js";
import { FakeBlueprintPostgres } from "../contract/blueprint-postgres-fake.js";
import { validBlueprint, withValue, type JsonRecord } from "../contract/blueprint-validation-fixtures.js";
import {
  CANONICAL_TRACE,
  evidenceCapture,
  eventTypes,
  expectRegistryShaped,
  NOW,
  runId,
  type EvidenceCapture,
  type EvidenceFailureMode
} from "./blueprint-evidence-support.js";

const UPSTREAM_TRACE = "4bf92f3577b34da6a3ce929d0e0e4736";
const BODY_MARKER = "raw-blueprint-body-marker-5e21";
const INTENT_MARKER = "raw-user-intent-marker-a7c4";

interface Store {
  readonly database: FakeBlueprintPostgres;
  readonly repository: PostgresBlueprintAdmissionRepository;
  readonly capture: EvidenceCapture;
}

function store(mode: EvidenceFailureMode = "NONE"): Store {
  const database = new FakeBlueprintPostgres();
  return { database, repository: new PostgresBlueprintAdmissionRepository(database), capture: evidenceCapture(mode) };
}

function validateBytes(bytes: Uint8Array, validationRunId: string, traceId?: unknown): BlueprintValidationResult {
  return validateBlueprintCandidate(bytes, { validationRunId, ...(traceId === undefined ? {} : { traceId: traceId as string }) });
}

function validateText(text: string, validationRunId: string, traceId?: unknown): BlueprintValidationResult {
  return validateBytes(new TextEncoder().encode(text), validationRunId, traceId);
}

function admit(target: Store, result: BlueprintValidationResult): Promise<BlueprintAdmissionResult> {
  return admitBlueprint(result, target.repository, { now: NOW, evidence: target.capture.options });
}

function sha256(bytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function markedBlueprint(): JsonRecord {
  return { ...validBlueprint(), meta: { title: BODY_MARKER, description: INTENT_MARKER } };
}

/** Durable validation_run.trace_id, the issued report trace and every emitted F02 event trace are one canonical value. */
async function expectTraceLinked(target: Store, result: BlueprintValidationResult, label: string): Promise<string> {
  const before = target.capture.stored.length;
  await admit(target, result);
  const trace = result.report.trace_id;
  expect(trace, label).toMatch(CANONICAL_TRACE);
  expect(target.database.runs.get(result.report.validation_run_id)?.trace_id, label).toBe(trace);
  expect(target.database.runs.get(result.report.validation_run_id)?.report.trace_id, label).toBe(trace);
  const emitted = target.capture.stored.slice(before);
  expect(emitted.length, label).toBeGreaterThan(0);
  expect(emitted.map((event) => event.trace_id), label).toEqual(emitted.map(() => trace));
  return trace;
}

async function expectUpstreamTraceCanonicalized(): Promise<void> {
  const target = store();
  const json = JSON.stringify(validBlueprint());
  const preserved = await expectTraceLinked(target, validateText(json, runId(0), UPSTREAM_TRACE), "canonical upstream");
  expect(preserved).toBe(UPSTREAM_TRACE);
  const malformed: readonly [string, unknown][] = [
    ["missing", undefined],
    ["empty", ""],
    ["malformed text", "trace-00000000-0000-4000-8000-000000000001"],
    ["all-zero", "0".repeat(32)],
    ["uppercase", UPSTREAM_TRACE.toUpperCase()],
    ["31 chars", UPSTREAM_TRACE.slice(1)],
    ["33 chars", `${UPSTREAM_TRACE}a`],
    ["UUID with hyphens", "4bf92f35-77b3-4da6-a3ce-929d0e0e4736"],
    ["non-string", 42]
  ];
  const generated = new Set<string>();
  for (const [index, [label, upstream]] of malformed.entries()) {
    const trace = await expectTraceLinked(target, validateText(json, runId(index + 1), upstream), label);
    expect(trace, label).not.toBe(upstream);
    generated.add(trace);
  }
  expect(generated.size).toBe(malformed.length);
  expectRegistryShaped(target.capture, "trace canonicalization");
}

async function expectPreParseFailuresTraceable(): Promise<void> {
  const target = store();
  const payloads: readonly [string, Uint8Array][] = [
    ["truncated JSON", new TextEncoder().encode(JSON.stringify(validBlueprint()).slice(0, -1))],
    ["invalid UTF-8", Uint8Array.from([0x7b, 0xff, 0xfe, 0x7d])],
    ["empty payload", new Uint8Array()],
    ["oversize payload", new Uint8Array(MAX_CANDIDATE_PAYLOAD_BYTES + 1).fill(0x20)]
  ];
  for (const [index, [label, bytes]] of payloads.entries()) {
    const first = validateBytes(bytes, runId(index * 2), "not-a-trace");
    const second = validateBytes(bytes, runId(index * 2 + 1));
    expect(first.report.candidate_digest, label).toBe(sha256(bytes));
    expect(second.report.candidate_digest, label).toBe(first.report.candidate_digest);
    expect(first.report.issues, label).toEqual([expect.objectContaining({ error_code: "F02-ERR-001", stage: "V01" })]);
    const before = target.capture.stored.length;
    const trace = await expectTraceLinked(target, first, label);
    expect(target.database.runs.get(runId(index * 2)), label).toMatchObject({
      status: "REJECTED",
      candidate_digest: sha256(bytes),
      blueprint_hash: null,
      error_codes: ["F02-ERR-001"],
      trace_id: trace
    });
    expect(target.capture.stored.slice(before), label).toEqual([
      expect.objectContaining({ event_type: "F02-EVT-003", error_code: "F02-ERR-001", trace_id: trace, properties: expect.objectContaining({ validation_stage: "V01" }) })
    ]);
  }
  expect(target.database.contents.size).toBe(0);
  expectRegistryShaped(target.capture, "pre-parse failures");
}

async function expectOutcomeEventsPerTerminalStatus(): Promise<void> {
  const target = store();
  const compact = JSON.stringify(validBlueprint());
  const passed = validateText(compact, runId(0));
  const reused = validateText(JSON.stringify(validBlueprint(), null, 2), runId(1));
  const rejected = validateText(JSON.stringify(withValue(["extra"], true)), runId(2));
  const incompatible = validateText(JSON.stringify(withValue(["registry_version"], "6.0.0")), runId(3));
  const contentHash = passed.report.content_hash ?? "";

  expect(passed.report.candidate_digest).not.toBe(contentHash);
  expect(reused.report.candidate_digest).not.toBe(passed.report.candidate_digest);
  expect(reused.report.content_hash).toBe(contentHash);
  for (const result of [passed, reused, rejected, incompatible]) {
    await expectTraceLinked(target, result, result.report.status);
  }
  expect(eventTypes(target.capture)).toEqual(["F02-EVT-002", "F02-EVT-007", "F02-EVT-002", "F02-EVT-003", "F02-EVT-004"]);
  const [passedEvent, admittedEvent, , rejectedEvent, incompatibleEvent] = target.capture.stored;
  expect(passedEvent?.properties).toEqual({ content_hash: contentHash, blueprint_schema_version: "1.0.0", registry_version: "7.0.0", validation_stage: "V12" });
  expect(admittedEvent?.properties).toMatchObject({ content_hash: contentHash, validation_stage: "V12" });
  expect(rejectedEvent).toMatchObject({ error_code: "F02-ERR-002", properties: { validation_stage: "V02" } });
  expect(incompatibleEvent).toMatchObject({ error_code: "F02-ERR-004", properties: { validation_stage: "V03" } });
  expect([...target.database.contents.keys()]).toEqual([contentHash]);
  expect(target.database.contents.get(contentHash)?.admitted_by_validation_run_id).toBe(runId(0));
  const serialized = JSON.stringify(target.capture.stored);
  for (const digest of [passed, reused, rejected, incompatible].map((result) => result.report.candidate_digest)) {
    expect(serialized).not.toContain(digest);
  }

  const collision = store();
  collision.database.contents.set(contentHash, { ...target.database.contents.get(contentHash)!, canonical_blueprint: { tampered: true } });
  const integrity = validateText(compact, runId(4));
  await expectTraceLinked(collision, integrity, "hash integrity failure");
  expect(collision.capture.stored).toEqual([
    expect.objectContaining({ event_type: "F02-EVT-003", error_code: "F02-ERR-015", properties: expect.objectContaining({ validation_stage: "V12" }) }),
    expect.objectContaining({ event_type: "F02-EVT-009", error_code: "F02-ERR-015", properties: expect.objectContaining({ content_hash: contentHash }) })
  ]);
  expectRegistryShaped(target.capture, "terminal outcomes");
  expectRegistryShaped(collision.capture, "integrity outcome");
}

function fabricatedReport(status: "REJECTED" | "INCOMPATIBLE", genuine: BlueprintValidationResult): Record<string, unknown> {
  return {
    validation_run_id: runId(90),
    candidate_digest: genuine.report.candidate_digest,
    status,
    schema_version: "1.0.0",
    registry_version: "7.0.0",
    registry_digest: genuine.report.registry_digest,
    issues: [{ error_code: status === "REJECTED" ? "F02-ERR-002" : "F02-ERR-004", stage: status === "REJECTED" ? "V02" : "V03", json_path: "$" }],
    trace_id: UPSTREAM_TRACE
  };
}

function withAccessor(report: unknown): unknown {
  return Object.defineProperty({}, "report", { get: () => report, enumerable: true });
}

/** Caller-fabricated or altered terminal reports write zero validation_run rows and zero outcome Evidence. */
async function expectForgedTerminalReportsWriteNothing(): Promise<void> {
  const target = store();
  const rejected = validateText(JSON.stringify(withValue(["extra"], true)), runId(10));
  const incompatible = validateText(JSON.stringify(withValue(["registry_version"], "6.0.0")), runId(11));
  const passed = validateText(JSON.stringify(validBlueprint()), runId(12));
  const forgeries: readonly [string, unknown][] = [
    ["fabricated REJECTED", { report: fabricatedReport("REJECTED", rejected) }],
    ["fabricated INCOMPATIBLE", { report: fabricatedReport("INCOMPATIBLE", incompatible) }],
    ["spread copy", { report: { ...rejected.report } }],
    ["structuredClone result", structuredClone(rejected)],
    ["structuredClone report", { report: structuredClone(incompatible.report) }],
    ["REJECTED relabelled INCOMPATIBLE", { report: { ...rejected.report, status: "INCOMPATIBLE" } }],
    ["INCOMPATIBLE relabelled REJECTED", { report: { ...incompatible.report, status: "REJECTED" } }],
    ["spoofed trace", { report: { ...rejected.report, trace_id: UPSTREAM_TRACE } }],
    ["spoofed candidate_digest", { report: { ...rejected.report, candidate_digest: passed.report.candidate_digest } }],
    ["Proxy over genuine report", { report: new Proxy(rejected.report, {}) }],
    ["prototype-inherited report", { report: Object.create(incompatible.report) as unknown }],
    ["accessor wrapper over copy", withAccessor({ ...incompatible.report })],
    ["PASSED report without admissible", { report: passed.report }]
  ];
  for (const [label, forged] of forgeries) {
    await expect(admit(target, forged as BlueprintValidationResult), label).rejects.toThrow("validator-issued");
  }
  expect(target.database.statements).toEqual([]);
  expect(target.database.runs.size).toBe(0);
  expect(target.capture.ingested).toEqual([]);

  const [issue] = rejected.report.issues;
  expect(() => Object.assign(rejected.report, { status: "PASSED" })).toThrow(TypeError);
  expect(() => Object.assign(incompatible.report, { trace_id: UPSTREAM_TRACE })).toThrow(TypeError);
  expect(() => (rejected.report.issues as unknown[]).push({ error_code: "F02-ERR-015" })).toThrow(TypeError);
  expect(() => Object.assign(issue as object, { error_code: "F02-ERR-001" })).toThrow(TypeError);

  for (const genuine of [rejected, incompatible]) {
    expect(await admit(target, genuine)).toEqual({ status: "NOT_ADMITTED", report: genuine.report });
  }
  expect([...target.database.runs.keys()]).toEqual([runId(10), runId(11)]);
  expect(eventTypes(target.capture)).toEqual(["F02-EVT-003", "F02-EVT-004"]);
  expectRegistryShaped(target.capture, "genuine reports after forgeries");
}

function expectNoRawContent(capture: EvidenceCapture, forbidden: readonly string[], label: string): void {
  const serialized = JSON.stringify([capture.ingested, capture.stored]);
  for (const value of forbidden) {
    expect(serialized, label).not.toContain(value);
  }
}

async function expectEvidenceCarriesNoRawPayload(): Promise<void> {
  const target = store();
  const marked = markedBlueprint();
  const markedJson = JSON.stringify(marked);
  const passed = validateText(markedJson, runId(20));
  const rejected = validateText(JSON.stringify({ ...marked, raw_intent: INTENT_MARKER }), runId(21));
  const incompatible = validateText(JSON.stringify({ ...marked, registry_version: "6.0.0" }), runId(22));
  const preParse = validateText(`{"intent":"${INTENT_MARKER}"`, runId(23));
  for (const result of [passed, rejected, incompatible, preParse]) {
    await admit(target, result);
  }
  expect(eventTypes(target.capture)).toEqual(["F02-EVT-002", "F02-EVT-007", "F02-EVT-003", "F02-EVT-004", "F02-EVT-003"]);
  expectNoRawContent(target.capture, [BODY_MARKER, INTENT_MARKER, canonicalizeJson(marked), markedJson, "canonical_blueprint", "candidate_payload"], "validation Evidence");
  expectRegistryShaped(target.capture, "raw payload exclusion");
}

async function expectEvidenceFailureNeverBlocksOutcome(): Promise<void> {
  const modes: readonly EvidenceFailureMode[] = ["INTAKE_THROWS", "STORAGE_THROWS", "INTAKE_REJECTS", "DIAGNOSTICS_THROW"];
  for (const mode of modes) {
    const target = store(mode);
    const passed = validateText(JSON.stringify(validBlueprint()), runId(30));
    const rejected = validateText(JSON.stringify(withValue(["extra"], true)), runId(31));
    expect(await admit(target, passed), mode).toMatchObject({ status: "ADMITTED", reused: false, trustStatus: "VALIDATED" });
    expect(await admit(target, rejected), mode).toEqual({ status: "NOT_ADMITTED", report: rejected.report });
    expect(target.database.contents.get(passed.report.content_hash ?? "")?.trust_status, mode).toBe("VALIDATED");
    expect([...target.database.runs.keys()], mode).toEqual([runId(30), runId(31)]);
    expect(target.capture.stored, mode).toEqual([]);
    expect(target.capture.diagnostics.length, mode).toBeGreaterThanOrEqual(2);
  }
}

describe("F02 validation Evidence and canonical trace", () => {
  test("TEST-F02-AC-019 every validation is traceable by canonical trace, candidate_digest, terminal status and stage/error", async () => {
    await expectUpstreamTraceCanonicalized();
    await expectPreParseFailuresTraceable();
    await expectOutcomeEventsPerTerminalStatus();
    await expectForgedTerminalReportsWriteNothing();
  });

  test("TEST-F02-AC-020 validation Evidence never needs or carries raw Blueprint / Intent and stays non-blocking", async () => {
    await expectEvidenceCarriesNoRawPayload();
    await expectEvidenceFailureNeverBlocksOutcome();
  });
});
