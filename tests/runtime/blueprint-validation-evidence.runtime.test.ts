import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { admitBlueprint } from "../../src/platform/blueprint/blueprint-admission.js";
import { canonicalizeJson } from "../../src/platform/blueprint/canonical-json.js";
import type { F02EvidenceOptions } from "../../src/platform/blueprint/validation-evidence.js";
import { isIssuedValidationReport } from "../../src/platform/blueprint/validate-blueprint.js";
import type { BlueprintValidationResult, ValidationReport } from "../../src/platform/blueprint/validation-types.js";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import type { RegistryReleaseBundle } from "../../src/platform/capabilities/schema/registry-release.js";
import { nodeIndex, validBlueprint, withValue, type JsonRecord } from "../contract/blueprint-validation-fixtures.js";
import { bundleOf, expectDenied, minimalBlueprint, replacing, sourceWith, textNode } from "../contract/execution-safety-fixtures.js";
import {
  durableStore,
  evidenceHarness,
  executionAdmission,
  expectRegistryShaped,
  NOW,
  releaseSource,
  sha256Digest,
  TRACE_ID,
  traceOf,
  uuid,
  validateBytes,
  type DurableStore,
  type EvidenceHarness
} from "./blueprint-evidence-support.js";

const BODY_MARKER = "raw-blueprint-body-marker-5be1";
const INTENT_MARKER = "raw-intent-marker-a77c 幫我做一個分帳工具";
const TEXT = { id: "content.text", version: "1.0.0" };
const MIGRATION = readFileSync(new URL("../../supabase/migrations/20261003120000_t002_blueprint_validation.sql", import.meta.url), "utf8");

function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

function marked(candidate: JsonRecord = validBlueprint()): JsonRecord {
  candidate.meta = { title: BODY_MARKER, description: INTENT_MARKER };
  return candidate;
}

function nonPreserving(): JsonRecord {
  const candidate = marked();
  candidate.support = {
    coverage_status: "PARTIALLY_SUPPORTED",
    degradations: [{ requirement_id: "req_core", description: INTENT_MARKER, capability_refs: [TEXT], preserves_semantic_core: false }]
  };
  return candidate;
}

const MARKED_JSON = JSON.stringify(marked());

interface FailingCandidate {
  readonly label: string;
  readonly bytes: Uint8Array;
  readonly status: "REJECTED" | "INCOMPATIBLE";
  readonly code: string;
  readonly stage: string;
}

function failing(label: string, bytes: Uint8Array, code: string, stage: string, status: FailingCandidate["status"] = "REJECTED"): FailingCandidate {
  return { label, bytes, status, code, stage };
}

const FAILURES: readonly FailingCandidate[] = [
  failing("V01 invalid UTF-8 (pre-parse)", Uint8Array.of(0x7b, 0x22, 0xff, 0xfe, 0x22, 0x7d), "F02-ERR-001", "V01"),
  failing("V01 truncated JSON (pre-parse)", utf8(MARKED_JSON.slice(0, -1)), "F02-ERR-001", "V01"),
  failing("V01 duplicate key (pre-parse)", utf8(`{"kind":"APP",${MARKED_JSON.slice(1)}`), "F02-ERR-001", "V01"),
  failing("V01 non-object root (pre-parse)", utf8(JSON.stringify([BODY_MARKER, INTENT_MARKER])), "F02-ERR-001", "V01"),
  failing("V01 payload over 512 KiB (pre-parse)", utf8(`${" ".repeat(524_289)}${MARKED_JSON}`), "F02-ERR-001", "V01"),
  failing("V02 unknown executable key", utf8(JSON.stringify(marked(withValue(["extra"], true)))), "F02-ERR-002", "V02"),
  failing("V03 unknown Registry snapshot", utf8(JSON.stringify(marked(withValue(["registry_version"], "6.0.0")))), "F02-ERR-004", "V03", "INCOMPATIBLE"),
  failing(
    "V04 unknown capability version",
    utf8(JSON.stringify(marked(withValue(["nodes", nodeIndex("node_title"), "capability", "version"], "9.9.9")))),
    "F02-ERR-005",
    "V04"
  ),
  failing("V11 semantic core not preserved", utf8(JSON.stringify(nonPreserving())), "F02-ERR-014", "V11")
];

function expectNoRawContent(serialized: string, label: string): void {
  expect(serialized, `${label} raw Blueprint body`).not.toContain(BODY_MARKER);
  expect(serialized, `${label} raw Intent`).not.toContain(INTENT_MARKER);
}

function runsJson(store: DurableStore): string {
  return JSON.stringify([...store.database.runs.values()]);
}

function expectDeterministicCandidateDigest(): void {
  const bytes = utf8(MARKED_JSON);
  const first = validateBytes(bytes, { validationRunId: uuid(1), traceId: traceOf(1) });
  const second = validateBytes(utf8(MARKED_JSON), { validationRunId: uuid(2), traceId: traceOf(2) });
  const reformatted = validateBytes(utf8(JSON.stringify(marked(), null, 2)), { validationRunId: uuid(3), traceId: traceOf(3) });
  expect(first.report.candidate_digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  expect(first.report.candidate_digest).toBe(sha256Digest(bytes));
  expect(second.report.candidate_digest).toBe(first.report.candidate_digest);
  expect(reformatted.report.candidate_digest, "exact bytes, not logical content").not.toBe(first.report.candidate_digest);
  expect(reformatted.report.content_hash).toBe(first.report.content_hash);
  expect(first.report.candidate_digest, "candidate_digest is intake identity, never the content hash").not.toBe(first.report.content_hash);
  for (const failure of FAILURES) {
    const again = validateBytes(failure.bytes.slice(), { validationRunId: uuid(4), traceId: traceOf(4) });
    expect(validateBytes(failure.bytes).report.candidate_digest, failure.label).toBe(sha256Digest(failure.bytes));
    expect(again.report.candidate_digest, failure.label).toBe(sha256Digest(failure.bytes));
  }
}

async function expectInvalidCandidatesTraceable(): Promise<void> {
  const store = durableStore();
  const evidence = evidenceHarness(0x100);
  for (const [index, failure] of FAILURES.entries()) {
    const runId = uuid(0x100 + index);
    const traceId = traceOf(0x100 + index);
    const result = validateBytes(failure.bytes, { validationRunId: runId, traceId });
    expect(await admitBlueprint(result, store.repository, { now: NOW, evidence: evidence.options }), failure.label).toEqual({
      status: "NOT_ADMITTED",
      report: result.report
    });
    expect(store.database.runs.get(runId), failure.label).toMatchObject({
      candidate_digest: sha256Digest(failure.bytes),
      status: failure.status,
      blueprint_hash: null,
      error_codes: [failure.code],
      trace_id: traceId,
      report: { status: failure.status, trace_id: traceId, issues: [{ error_code: failure.code, stage: failure.stage }] }
    });
    const events = evidence.productEvents.byTrace(traceId);
    const eventType = failure.status === "REJECTED" ? "F02-EVT-003" : "F02-EVT-004";
    expect(events.map((event) => [event.event_type, event.error_code, event.properties?.validation_stage]), failure.label).toEqual([
      [eventType, failure.code, failure.stage]
    ]);
    expect(events[0]?.blueprint_hash, failure.label).toBeUndefined();
  }
  expect(evidence.diagnostics).toEqual([]);
  expect(store.database.contents.size).toBe(0);
  expectNoRawContent(runsJson(store), "validation_run");
  expectNoRawContent(JSON.stringify(evidence.productEvents.rows), "product_event");
  for (const event of evidence.productEvents.rows) {
    const joined = [...store.database.runs.values()].filter((run) => run.trace_id === event.trace_id);
    expect(joined).toHaveLength(1);
    expect(joined[0]?.error_codes).toEqual([event.error_code]);
  }
}

async function expectDefaultTraceIdJoinsEvidence(): Promise<void> {
  const store = durableStore();
  const evidence = evidenceHarness(0x200);
  const rejected = validateBytes(FAILURES[0]!.bytes);
  const passed = validateBytes(utf8(MARKED_JSON));
  expect(rejected.report.trace_id).toMatch(TRACE_ID);
  expect(passed.report.trace_id).toMatch(TRACE_ID);
  expect(passed.report.trace_id).not.toBe(rejected.report.trace_id);
  await admitBlueprint(rejected, store.repository, { now: NOW, evidence: evidence.options });
  expect(await admitBlueprint(passed, store.repository, { now: NOW, evidence: evidence.options })).toMatchObject({ status: "ADMITTED" });
  expect(evidence.diagnostics).toEqual([]);
  expect(evidence.productEvents.byTrace(rejected.report.trace_id).map((event) => event.event_type)).toEqual(["F02-EVT-003"]);
  expect(evidence.productEvents.byTrace(passed.report.trace_id).map((event) => event.event_type)).toEqual(["F02-EVT-002", "F02-EVT-007"]);
  expect(store.database.runs.get(rejected.report.validation_run_id)?.trace_id).toBe(rejected.report.trace_id);
  expect(store.database.runs.get(passed.report.validation_run_id)?.trace_id).toBe(passed.report.trace_id);
}

function accessorResult(read: () => unknown): unknown {
  return Object.defineProperty({}, "report", { get: read, enumerable: true });
}

interface GenuineFailures {
  readonly rejected: BlueprintValidationResult;
  readonly incompatible: BlueprintValidationResult;
  readonly passed: BlueprintValidationResult;
}

function genuineFailures(): GenuineFailures {
  const rejected = validateBytes(utf8(JSON.stringify(nonPreserving())), { validationRunId: uuid(0x300), traceId: traceOf(0x300) });
  const incompatible = validateBytes(utf8(JSON.stringify(marked(withValue(["registry_version"], "6.0.0")))), {
    validationRunId: uuid(0x301),
    traceId: traceOf(0x301)
  });
  const passed = validateBytes(utf8(MARKED_JSON), { validationRunId: uuid(0x302), traceId: traceOf(0x302) });
  expect([rejected.report.status, incompatible.report.status, passed.report.status]).toEqual(["REJECTED", "INCOMPATIBLE", "PASSED"]);
  return { rejected, incompatible, passed };
}

/** Hostile fabricated / copied / relabelled / Proxy / accessor failing results that were never issued by the validator. */
function hostileFailures({ rejected, incompatible, passed }: GenuineFailures): readonly [string, unknown][] {
  const fabricated = {
    validation_run_id: uuid(0x3f0),
    candidate_digest: sha256Digest(utf8("fabricated candidate")),
    schema_version: "1.0.0",
    registry_version: "7.0.0",
    registry_digest: rejected.report.registry_digest,
    trace_id: traceOf(0x3f0)
  };
  const v02 = [{ error_code: "F02-ERR-002", stage: "V02", json_path: "$" }];
  return [
    ["fabricated internal REJECTED", { report: { ...fabricated, status: "REJECTED", issues: v02 } }],
    ["fabricated internal INCOMPATIBLE", { report: { ...fabricated, status: "INCOMPATIBLE", issues: [{ error_code: "F02-ERR-004", stage: "V03", json_path: "$" }] } }],
    ["copied genuine REJECTED", { report: { ...rejected.report } }],
    ["structured-clone genuine INCOMPATIBLE", { report: structuredClone(incompatible.report) }],
    ["REJECTED relabelled INCOMPATIBLE", { report: { ...rejected.report, status: "INCOMPATIBLE" } }],
    ["INCOMPATIBLE relabelled REJECTED with another error", { report: { ...incompatible.report, status: "REJECTED", issues: v02 } }],
    ["genuine REJECTED with spoofed trace_id", { report: { ...rejected.report, trace_id: traceOf(0x3f1) } }],
    ["genuine REJECTED with spoofed candidate_digest", { report: { ...rejected.report, candidate_digest: fabricated.candidate_digest } }],
    ["transparent Proxy over genuine REJECTED", { report: new Proxy(rejected.report, {}) }],
    ["relabelling Proxy over genuine INCOMPATIBLE", { report: new Proxy(incompatible.report, { get: (target, key) => (key === "status" ? "REJECTED" : Reflect.get(target, key)) }) }],
    ["accessor yielding a fabricated report", accessorResult(() => ({ ...rejected.report, validation_run_id: uuid(0x3f2) }))],
    ["genuine PASSED report without its admissible", { report: passed.report }],
    ["genuine PASSED report relabelled REJECTED", { report: { ...passed.report, status: "REJECTED", issues: v02 } }]
  ];
}

async function expectFabricatedFailuresNeverRecorded(): Promise<void> {
  const store = durableStore();
  const evidence = evidenceHarness(0x300);
  const genuine = genuineFailures();
  const { rejected, incompatible, passed } = genuine;
  expect([rejected, incompatible, passed].map((result) => isIssuedValidationReport(result.report))).toEqual([true, true, true]);
  for (const [label, forged] of hostileFailures(genuine)) {
    const report = (forged as { readonly report: ValidationReport }).report;
    expect(isIssuedValidationReport(report), label).toBe(report === passed.report);
    await expect(admitBlueprint(forged as BlueprintValidationResult, store.repository, { now: NOW, evidence: evidence.options }), label).rejects.toThrow(
      "validator-issued"
    );
  }
  expect(store.database.statements).toEqual([]);
  expect(store.database.runs.size).toBe(0);
  expect(evidence.productEvents.rows).toEqual([]);
  expect(evidence.batches).toEqual([]);

  const mutations: readonly [string, () => unknown][] = [
    ["REJECTED status", () => Object.assign(rejected.report, { status: "PASSED" })],
    ["INCOMPATIBLE trace_id", () => Object.assign(incompatible.report, { trace_id: traceOf(0x3f3) })],
    ["INCOMPATIBLE candidate_digest", () => Object.assign(incompatible.report, { candidate_digest: sha256Digest(utf8("x")) })],
    ["REJECTED issues push", () => (rejected.report.issues as unknown[]).push({ error_code: "F02-ERR-002", stage: "V02", json_path: "$" })],
    ["REJECTED issue error_code", () => Object.assign(rejected.report.issues[0]!, { error_code: "F02-ERR-002" })]
  ];
  for (const [label, mutate] of mutations) {
    expect(mutate, label).toThrow(TypeError);
  }

  expect(await admitBlueprint(rejected, store.repository, { now: NOW, evidence: evidence.options })).toEqual({ status: "NOT_ADMITTED", report: rejected.report });
  expect(await admitBlueprint(incompatible, store.repository, { now: NOW, evidence: evidence.options })).toEqual({
    status: "NOT_ADMITTED",
    report: incompatible.report
  });
  expect([...store.database.runs.keys()]).toEqual([uuid(0x300), uuid(0x301)]);
  expect(store.database.runs.get(uuid(0x300))).toMatchObject({ status: "REJECTED", error_codes: ["F02-ERR-014"], candidate_digest: rejected.report.candidate_digest });
  expect(store.database.runs.get(uuid(0x301))).toMatchObject({ status: "INCOMPATIBLE", error_codes: ["F02-ERR-004"], candidate_digest: incompatible.report.candidate_digest });
  expect(evidence.productEvents.rows.map((event) => [event.event_type, event.trace_id])).toEqual([
    ["F02-EVT-003", traceOf(0x300)],
    ["F02-EVT-004", traceOf(0x301)]
  ]);
}

/** A V12 hash-integrity collision is traced (validation_run + events), and its admission-built report cannot be replayed. */
async function expectIntegrityFailureTracedNotReplayable(): Promise<void> {
  const store = durableStore();
  const evidence = evidenceHarness(0x380);
  const first = validateBytes(utf8(MARKED_JSON), { validationRunId: uuid(0x380), traceId: traceOf(0x380) });
  await admitBlueprint(first, store.repository, { now: NOW });
  const contentHash = first.report.content_hash ?? "";
  const row = store.database.contents.get(contentHash)!;
  store.database.contents.set(contentHash, { ...row, canonical_blueprint: { tampered: true } });

  const second = validateBytes(utf8(MARKED_JSON), { validationRunId: uuid(0x381), traceId: traceOf(0x381) });
  const collision = await admitBlueprint(second, store.repository, { now: NOW, evidence: evidence.options });
  expect(collision.status).toBe("NOT_ADMITTED");
  const failure = collision.status === "NOT_ADMITTED" ? collision.report : first.report;
  expect(store.database.runs.get(uuid(0x381))).toMatchObject({ status: "REJECTED", error_codes: ["F02-ERR-015"], trace_id: traceOf(0x381) });
  expect(evidence.productEvents.byTrace(traceOf(0x381)).map((event) => [event.event_type, event.error_code, event.properties?.validation_stage])).toEqual([
    ["F02-EVT-003", "F02-ERR-015", "V12"],
    ["F02-EVT-009", "F02-ERR-015", "V12"]
  ]);
  const statementsBefore = store.database.statements.length;
  await expect(admitBlueprint({ report: failure } as BlueprintValidationResult, store.repository, { now: NOW })).rejects.toThrow("validator-issued");
  expect(store.database.statements.length).toBe(statementsBefore);
}

async function expectEvidenceCarriesNoRawBody(): Promise<void> {
  const store = durableStore();
  const evidence = evidenceHarness(0x400);
  const candidates: readonly Uint8Array[] = [
    utf8(MARKED_JSON),
    utf8(JSON.stringify(marked(), null, 1)),
    utf8(JSON.stringify(nonPreserving())),
    utf8(MARKED_JSON.slice(0, -1)),
    utf8(JSON.stringify(marked(withValue(["registry_version"], "6.0.0"))))
  ];
  const results = candidates.map((bytes, index) => validateBytes(bytes, { validationRunId: uuid(0x400 + index), traceId: traceOf(0x400 + index) }));
  for (const result of results) {
    await admitBlueprint(result, store.repository, { now: NOW, evidence: evidence.options });
  }
  const rows = evidence.productEvents.rows;
  const contentHash = results[0]!.report.content_hash ?? "";
  expect(evidence.diagnostics).toEqual([]);
  expect(evidence.batches.map((batch) => batch.rejected)).toEqual([0, 0, 0, 0, 0]);
  expect(rows.map((event) => event.event_type)).toEqual(["F02-EVT-002", "F02-EVT-007", "F02-EVT-002", "F02-EVT-003", "F02-EVT-003", "F02-EVT-004"]);
  expectRegistryShaped(rows, "validation evidence");

  const telemetry = JSON.stringify(rows);
  expectNoRawContent(telemetry, "product_event");
  expectNoRawContent(runsJson(store), "validation_run");
  expect(telemetry).not.toContain(canonicalizeJson(store.database.contents.get(contentHash)?.canonical_blueprint));
  for (const result of results) {
    expect(telemetry, "candidate_digest is never reused as an evidence identity").not.toContain(result.report.candidate_digest);
  }
  expect(rows.filter((event) => event.blueprint_hash !== undefined).map((event) => [event.event_type, event.blueprint_hash])).toEqual([["F02-EVT-007", contentHash]]);

  const outcomes: Record<string, number> = {};
  for (const event of rows) {
    const key = `${event.event_type}|${String(event.properties?.validation_stage ?? "-")}|${event.error_code ?? "-"}`;
    outcomes[key] = (outcomes[key] ?? 0) + 1;
  }
  expect(outcomes).toEqual({
    "F02-EVT-002|V12|-": 2,
    "F02-EVT-007|V12|-": 1,
    "F02-EVT-003|V11|F02-ERR-014": 1,
    "F02-EVT-003|V01|F02-ERR-001": 1,
    "F02-EVT-004|V03|F02-ERR-004": 1
  });
  for (const [index, result] of results.entries()) {
    const run = [...store.database.runs.values()].find((entry) => entry.trace_id === traceOf(0x400 + index));
    expect(run, `trace join ${index}`).toMatchObject({ candidate_digest: result.report.candidate_digest, status: result.report.status });
  }
}

async function expectIntakeRefusesRawBodyCarriers(): Promise<void> {
  const evidence = evidenceHarness(0x500);
  const base = {
    event_type: "F02-EVT-003",
    schema_version: "2.0.0",
    occurred_at: NOW().toISOString(),
    function_id: "F02",
    trace_id: traceOf(0x500),
    error_code: "F02-ERR-002"
  };
  const rawBody = JSON.stringify({ meta: { title: BODY_MARKER } });
  const result = await evidence.options.intake.ingest([
    { ...base, event_id: uuid(0xe0501), properties: { blueprint_json: rawBody } },
    { ...base, event_id: uuid(0xe0502), properties: { raw_intent: INTENT_MARKER } },
    { ...base, event_id: uuid(0xe0503), properties: { blueprint: { meta: { title: BODY_MARKER } } } },
    { ...base, event_id: uuid(0xe0504), properties: { validation_stage: BODY_MARKER } },
    { ...base, event_id: uuid(0xe0505), candidate_body: rawBody, properties: {} }
  ]);
  expect(result.accepted).toBe(0);
  expect(result.rejections.map((rejection) => [rejection.code, rejection.field])).toEqual([
    ["F07-ERR-005", "blueprint_json"],
    ["F07-ERR-005", "raw_intent"],
    ["F07-ERR-005", "blueprint"],
    ["F07-ERR-003", "validation_stage"],
    ["F07-ERR-003", null]
  ]);
  expect(evidence.productEvents.rows).toEqual([]);
}

async function expectEvidenceFailureNeverBlocksAdmission(): Promise<void> {
  const store = durableStore();
  const diagnostics: unknown[] = [];
  const unavailable: F02EvidenceOptions = {
    intake: { ingest: () => Promise.reject(new Error("product_event unavailable")) },
    diagnostics: { reportNonBlockingFailure: (error) => diagnostics.push(error) },
    now: NOW
  };
  const passed = validateBytes(utf8(MARKED_JSON), { validationRunId: uuid(0x600), traceId: traceOf(0x600) });
  const rejected = validateBytes(utf8(JSON.stringify(nonPreserving())), { validationRunId: uuid(0x601), traceId: traceOf(0x601) });
  expect(await admitBlueprint(passed, store.repository, { now: NOW, evidence: unavailable })).toMatchObject({ status: "ADMITTED", reused: false });
  expect(await admitBlueprint(rejected, store.repository, { now: NOW, evidence: unavailable })).toEqual({ status: "NOT_ADMITTED", report: rejected.report });
  expect([store.database.runs.size, store.database.contents.size, diagnostics.length]).toEqual([2, 1, 2]);

  const evidence = evidenceHarness(0x602);
  const nonConformant = validateBytes(utf8(MARKED_JSON.slice(0, -1)), { validationRunId: uuid(0x602), traceId: "trace-not-hex" });
  expect(await admitBlueprint(nonConformant, store.repository, { now: NOW, evidence: evidence.options })).toMatchObject({ status: "NOT_ADMITTED" });
  expect(evidence.productEvents.rows).toEqual([]);
  expect(evidence.diagnostics).toHaveLength(1);
  expect(store.database.runs.get(uuid(0x602))).toMatchObject({ status: "REJECTED", trace_id: "trace-not-hex", error_codes: ["F02-ERR-001"] });
}

const PINNED: RegistryReleaseBundle = bundleOf(CAPABILITY_REGISTRY_SOURCE);
const TEXT_REVOKED_PATCH: RegistryReleaseBundle = bundleOf(
  sourceWith(
    "7.0.1",
    replacing(TEXT.id, TEXT.version, (definition) => ({ ...definition, lifecycle: { ...definition.lifecycle, executionStatus: "REVOKED" } }))
  )
);
const IMMUTABLE_COLUMNS = ["content_hash", "canonical_blueprint", "schema_version", "registry_version", "created_at", "admitted_by_validation_run_id", "byte_size"] as const;

interface AdmittedContent {
  readonly store: DurableStore;
  readonly contentHash: string;
  readonly bytes: Uint8Array;
  readonly body: unknown;
  readonly admittingRun: unknown;
}

async function admittedContent(runIndex: number): Promise<AdmittedContent> {
  const store = durableStore();
  const bytes = utf8(JSON.stringify(minimalBlueprint([textNode("node_text", BODY_MARKER)])));
  const result = validateBytes(bytes, { registry: PINNED.validator_registry, validationRunId: uuid(runIndex), traceId: traceOf(runIndex) });
  expect(await admitBlueprint(result, store.repository, { now: NOW })).toMatchObject({ status: "ADMITTED", reused: false });
  const contentHash = result.report.content_hash ?? "";
  return { store, contentHash, bytes, body: immutableBody(store, contentHash), admittingRun: structuredClone(store.database.runs.get(uuid(runIndex))) };
}

function immutableBody(store: DurableStore, contentHash: string): unknown {
  const row = store.database.contents.get(contentHash);
  return structuredClone(Object.fromEntries(IMMUTABLE_COLUMNS.map((column) => [column, row?.[column]])));
}

async function expectBodyUnchanged(content: AdmittedContent, runIndex: number, trustStatus: string, label: string): Promise<void> {
  expect(immutableBody(content.store, content.contentHash), label).toEqual(content.body);
  expect(content.store.database.runs.get(uuid(runIndex)), label).toEqual(content.admittingRun);
  expect(await content.store.lineage(content.contentHash), label).toMatchObject({ verified: true, validation_run_id: uuid(runIndex), trust_status: trustStatus });
}

interface DecisionCase {
  readonly content: AdmittedContent;
  readonly evidence: EvidenceHarness;
  readonly traceIndex: number;
  readonly current?: RegistryReleaseBundle;
  readonly failRead?: boolean;
}

async function decideAndTrace(decision: DecisionCase, terminal: string, errorCode?: string): Promise<void> {
  const traceId = traceOf(decision.traceIndex);
  const service = executionAdmission(decision.content.store.database, {
    releases: releaseSource(PINNED, decision.current ?? PINNED),
    evidence: decision.evidence.options,
    traceId,
    failRead: decision.failRead === true
  });
  const outcome = await service.admit(decision.content.contentHash);
  expect(outcome.executable, terminal).toBe(terminal === "F02-EVT-011");
  const events = decision.evidence.productEvents.byTrace(traceId);
  expect(events.map((event) => [event.event_type, event.blueprint_hash, event.error_code, event.properties?.content_hash]), terminal).toEqual([
    ["F02-EVT-010", decision.content.contentHash, undefined, decision.content.contentHash],
    [terminal, decision.content.contentHash, errorCode, decision.content.contentHash]
  ]);
}

async function expectDurableTrustOutcomesTraced(): Promise<void> {
  const runIndex = 0x700;
  const content = await admittedContent(runIndex);
  const evidence = evidenceHarness(0x700);
  const row = content.store.database.contents.get(content.contentHash)!;

  await decideAndTrace({ content, evidence, traceIndex: 0x710 }, "F02-EVT-011");
  row.trust_status = "REVOKED";
  await decideAndTrace({ content, evidence, traceIndex: 0x711 }, "F02-EVT-012", "F02-ERR-016");
  await expectBodyUnchanged(content, runIndex, "REVOKED", "after durable REVOKED");

  const rerun = validateBytes(content.bytes, { registry: PINNED.validator_registry, validationRunId: uuid(0x701), traceId: traceOf(0x701) });
  expect(await admitBlueprint(rerun, content.store.repository, { now: NOW, evidence: evidence.options })).toEqual({
    status: "ADMITTED",
    validationRunId: uuid(0x701),
    contentHash: content.contentHash,
    reused: true,
    trustStatus: "REVOKED"
  });
  expect(evidence.productEvents.byTrace(traceOf(0x701)).map((event) => event.event_type), "reuse never re-announces admission").toEqual(["F02-EVT-002"]);
  expect(content.store.database.runs.get(uuid(0x701))).toMatchObject({ status: "PASSED", blueprint_hash: content.contentHash });
  await decideAndTrace({ content, evidence, traceIndex: 0x712 }, "F02-EVT-012", "F02-ERR-016");
  await expectBodyUnchanged(content, runIndex, "REVOKED", "after same-hash reuse");

  row.trust_status = "INCOMPATIBLE";
  await decideAndTrace({ content, evidence, traceIndex: 0x713 }, "F02-EVT-012", "F02-ERR-017");
  await expectBodyUnchanged(content, runIndex, "INCOMPATIBLE", "after durable INCOMPATIBLE");
  expect(evidence.diagnostics).toEqual([]);
  expectRegistryShaped(evidence.productEvents.rows, "trust evidence");
  expectNoRawContent(JSON.stringify(evidence.productEvents.rows), "trust evidence");
}

async function expectCurrentReleaseOutcomesTraced(): Promise<void> {
  const runIndex = 0x720;
  const content = await admittedContent(runIndex);
  const evidence = evidenceHarness(0x720);
  expectDenied(
    await executionAdmission(content.store.database, { releases: releaseSource(PINNED, TEXT_REVOKED_PATCH), evidence: evidenceHarness().options, traceId: traceOf(0x7ff) }).admit(content.contentHash),
    { step: "E07", code: "F02-ERR-017", reason: "CAPABILITY_REVOKED" },
    "current release revoked content.text"
  );
  await decideAndTrace({ content, evidence, traceIndex: 0x721, current: TEXT_REVOKED_PATCH }, "F02-EVT-012", "F02-ERR-017");
  await expectBodyUnchanged(content, runIndex, "VALIDATED", "after current-release revoke");
  await decideAndTrace({ content, evidence, traceIndex: 0x722, failRead: true }, "F02-EVT-013");
  await expectBodyUnchanged(content, runIndex, "VALIDATED", "after temporary failure");
  expect(evidence.diagnostics).toEqual([]);
}

function expectTrustColumnIsTheOnlyMutableColumn(): void {
  const trigger = MIGRATION.slice(
    MIGRATION.indexOf("CREATE FUNCTION public.blueprint_content_reject_immutable_update"),
    MIGRATION.indexOf("CREATE TRIGGER blueprint_content_immutable_columns")
  );
  for (const column of IMMUTABLE_COLUMNS.filter((name) => name !== "byte_size")) {
    expect(trigger, column).toContain(`NEW.${column} IS DISTINCT FROM OLD.${column}`);
  }
  expect(trigger).not.toContain("NEW.trust_status");
  expect(MIGRATION).toContain("CHECK (trust_status IN ('VALIDATED', 'REVOKED', 'INCOMPATIBLE'))");
  expect(MIGRATION).toMatch(/CREATE TRIGGER validation_run_insert_only\s+BEFORE UPDATE OR DELETE ON public\.validation_run/);
}

describe("F02 validation evidence and trust traceability", () => {
  test("TEST-F02-AC-019 every validation run is traceable by deterministic candidate_digest, terminal status, stage / error and trace_id", async () => {
    expectDeterministicCandidateDigest();
    await expectInvalidCandidatesTraceable();
    await expectDefaultTraceIdJoinsEvidence();
    await expectFabricatedFailuresNeverRecorded();
    await expectIntegrityFailureTracedNotReplayable();
  });

  test("TEST-F02-AC-020 validation observability needs no raw Blueprint body or raw Intent in telemetry", async () => {
    await expectEvidenceCarriesNoRawBody();
    await expectIntakeRefusesRawBodyCarriers();
    await expectEvidenceFailureNeverBlocksAdmission();
  });

  test("TEST-F02-AC-022 trust revoke / incompatible outcomes are traceable without mutating the immutable Blueprint body", async () => {
    await expectDurableTrustOutcomesTraced();
    await expectCurrentReleaseOutcomesTraced();
    expectTrustColumnIsTheOnlyMutableColumn();
  });
});
