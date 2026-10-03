import { readFileSync } from "node:fs";

import { describe, expect, test } from "vitest";

import { admitBlueprint } from "../../src/platform/blueprint/blueprint-admission.js";
import { canonicalizeJson } from "../../src/platform/blueprint/canonical-json.js";
import { PostgresBlueprintAdmissionRepository } from "../../src/platform/blueprint/postgres-blueprint-repository.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import { FakeBlueprintPostgres } from "./blueprint-postgres-fake.js";
import { validBlueprint, type JsonRecord } from "./blueprint-validation-fixtures.js";

const MIGRATION = readFileSync(
  new URL("../../supabase/migrations/20261003120000_t002_blueprint_validation.sql", import.meta.url),
  "utf8"
);
const RUN_A = "00000000-0000-4000-8000-00000000000a";
const RUN_B = "00000000-0000-4000-8000-00000000000b";
const RUN_C = "00000000-0000-4000-8000-00000000000c";
const NOW = (): Date => new Date("2026-10-03T12:00:00.000Z");

function reverseKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(reverseKeys);
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as JsonRecord).reverse();
    return Object.fromEntries(entries.map(([key, child]) => [key, reverseKeys(child)]));
  }
  return value;
}

function validate(text: string, validationRunId: string): ReturnType<typeof validateBlueprintCandidate> {
  return validateBlueprintCandidate(new TextEncoder().encode(text), { validationRunId, traceId: `trace-${validationRunId}` });
}

function sqlSection(startMarker: string, endMarker: string): string {
  const start = MIGRATION.indexOf(startMarker);
  const end = MIGRATION.indexOf(endMarker, start);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(end).toBeGreaterThan(start);
  return MIGRATION.slice(start, end);
}

describe("F02 immutable blueprint_content persistence", () => {
  test("TEST-F02-AC-008 stores an admitted Blueprint once as immutable content-addressed blueprint_content", async () => {
    const database = new FakeBlueprintPostgres();
    const repository = new PostgresBlueprintAdmissionRepository(database);
    const first = validate(JSON.stringify(validBlueprint()), RUN_A);
    const reordered = validate(JSON.stringify(reverseKeys(validBlueprint()), null, 2), RUN_B);

    expect(first.report.status).toBe("PASSED");
    expect(reordered.report.status).toBe("PASSED");
    expect(reordered.report.candidate_digest).not.toBe(first.report.candidate_digest);
    expect(reordered.report.content_hash).toBe(first.report.content_hash);

    const inserted = await admitBlueprint(first, repository, { now: NOW });
    expect(inserted).toEqual({
      status: "ADMITTED",
      validationRunId: RUN_A,
      contentHash: first.report.content_hash,
      reused: false,
      trustStatus: "VALIDATED"
    });
    const contentHash = first.report.content_hash ?? "";
    const stored = database.contents.get(contentHash);
    expect(stored).toMatchObject({
      content_hash: contentHash,
      schema_version: "1.0.0",
      registry_version: "6.0.0",
      trust_status: "VALIDATED",
      admitted_by_validation_run_id: RUN_A,
      byte_size: new TextEncoder().encode(first.admissible?.canonicalJson ?? "").byteLength,
      created_at: NOW().toISOString()
    });
    expect(canonicalizeJson(stored?.canonical_blueprint)).toBe(canonicalizeJson(validBlueprint()));
    expect(database.runs.get(RUN_A)).toMatchObject({ status: "PASSED", blueprint_hash: contentHash, error_codes: [] });

    const reused = await admitBlueprint(reordered, repository, { now: NOW });
    expect(reused).toEqual({ status: "ADMITTED", validationRunId: RUN_B, contentHash, reused: true, trustStatus: "VALIDATED" });
    expect(database.contents.size).toBe(1);
    expect(database.contents.get(contentHash)).toEqual(stored);
    expect(database.runs.get(RUN_B)).toMatchObject({ status: "PASSED", blueprint_hash: contentHash });

    const tampered = new FakeBlueprintPostgres();
    tampered.contents.set(contentHash, { ...(stored as NonNullable<typeof stored>), canonical_blueprint: { tampered: true } });
    const tamperedBefore = structuredClone(tampered.contents.get(contentHash));
    const collision = await admitBlueprint(validate(JSON.stringify(validBlueprint()), RUN_C), new PostgresBlueprintAdmissionRepository(tampered), { now: NOW });
    expect(collision.status).toBe("NOT_ADMITTED");
    expect(collision.status === "NOT_ADMITTED" ? collision.report.issues : []).toEqual([
      { error_code: "F02-ERR-015", stage: "V12", json_path: "$" }
    ]);
    expect(tampered.contents.get(contentHash)).toEqual(tamperedBefore);
    expect(tampered.runs.get(RUN_C)).toMatchObject({ status: "REJECTED", blueprint_hash: null, error_codes: ["F02-ERR-015"] });

    const blueprintContent = sqlSection("CREATE TABLE public.blueprint_content", "CREATE FUNCTION");
    expect(blueprintContent).toMatch(/content_hash text PRIMARY KEY\s+CHECK \(content_hash ~ '\^sha256:\[0-9a-f\]\{64\}\$'\)/);
    expect(blueprintContent).toContain("canonical_blueprint jsonb NOT NULL");
    expect(blueprintContent).toContain("CHECK (trust_status IN ('VALIDATED', 'REVOKED', 'INCOMPATIBLE'))");
    expect(blueprintContent).toMatch(/REFERENCES public\.validation_run \(validation_run_id\)\s+DEFERRABLE INITIALLY DEFERRED/);
    const trigger = sqlSection("CREATE FUNCTION public.blueprint_content_reject_immutable_update", "CREATE INDEX");
    for (const column of ["content_hash", "canonical_blueprint", "schema_version", "registry_version", "created_at", "admitted_by_validation_run_id"]) {
      expect(trigger, column).toContain(`NEW.${column} IS DISTINCT FROM OLD.${column}`);
    }
    expect(trigger).not.toContain("NEW.trust_status");
    expect(trigger).toContain("SET search_path = pg_catalog");
    expect(trigger).toContain("BEFORE UPDATE ON public.blueprint_content");
    expect(MIGRATION).toContain("ALTER TABLE public.blueprint_content ENABLE ROW LEVEL SECURITY;");
  });

  test("records rejected and incompatible validation runs without writing blueprint_content", async () => {
    const database = new FakeBlueprintPostgres();
    const repository = new PostgresBlueprintAdmissionRepository(database);
    const rejected = validate(JSON.stringify({ ...validBlueprint(), extra: true }), RUN_A);
    const incompatible = validate(JSON.stringify({ ...validBlueprint(), registry_version: "3.0.0" }), RUN_B);

    expect((await admitBlueprint(rejected, repository, { now: NOW })).status).toBe("NOT_ADMITTED");
    expect((await admitBlueprint(incompatible, repository, { now: NOW })).status).toBe("NOT_ADMITTED");
    expect(database.contents.size).toBe(0);
    expect(database.runs.get(RUN_A)).toMatchObject({ status: "REJECTED", blueprint_hash: null, error_codes: ["F02-ERR-002"] });
    expect(database.runs.get(RUN_B)).toMatchObject({ status: "INCOMPATIBLE", blueprint_hash: null, error_codes: ["F02-ERR-004"] });

    const validationRun = sqlSection("CREATE TABLE public.validation_run", "CREATE FUNCTION public.validation_run_reject_mutation");
    expect(validationRun).toContain("compiler_run_id uuid NULL,");
    expect(validationRun).not.toContain("REFERENCES");
    expect(validationRun).toContain("CHECK (status IN ('PASSED', 'REJECTED', 'INCOMPATIBLE'))");
    expect(validationRun).toContain("CHECK ((status = 'PASSED') = (blueprint_hash IS NOT NULL))");
    expect(MIGRATION).toContain("ALTER TABLE public.validation_run ENABLE ROW LEVEL SECURITY;");
  });

  test("BF-037 keeps validation_run an insert-only terminal row: reruns insert new rows and the database rejects UPDATE / DELETE", async () => {
    const database = new FakeBlueprintPostgres();
    const repository = new PostgresBlueprintAdmissionRepository(database);
    await admitBlueprint(validate(JSON.stringify(validBlueprint()), RUN_A), repository, { now: NOW });
    const firstRun = structuredClone(database.runs.get(RUN_A));
    await admitBlueprint(validate(JSON.stringify(validBlueprint()), RUN_B), repository, { now: NOW });
    await admitBlueprint(validate(JSON.stringify({ ...validBlueprint(), extra: true }), RUN_C), repository, { now: NOW });

    expect(database.runs.get(RUN_A)).toEqual(firstRun);
    expect([...database.runs.keys()]).toEqual([RUN_A, RUN_B, RUN_C]);
    for (const statement of database.statements) {
      expect(statement).not.toMatch(/\b(?:UPDATE|DELETE\s+FROM|TRUNCATE)\s+(?:public\.)?validation_run\b/i);
      expect(statement).not.toMatch(/INSERT INTO public\.validation_run[\s\S]*ON CONFLICT/);
    }

    const rejectMutation = sqlSection("CREATE FUNCTION public.validation_run_reject_mutation", "CREATE TABLE public.blueprint_content");
    expect(rejectMutation).toContain("SET search_path = pg_catalog");
    expect(rejectMutation).toMatch(/BEGIN\s+RAISE EXCEPTION 'validation_run rows are insert-only terminal trust evidence \(% rejected\)', TG_OP\s+USING ERRCODE = 'check_violation';\s+END;/);
    expect(rejectMutation).toMatch(
      /CREATE TRIGGER validation_run_insert_only\s+BEFORE UPDATE OR DELETE ON public\.validation_run\s+FOR EACH ROW\s+EXECUTE FUNCTION public\.validation_run_reject_mutation\(\);/
    );
    expect(rejectMutation).toMatch(
      /CREATE TRIGGER validation_run_reject_truncate\s+BEFORE TRUNCATE ON public\.validation_run\s+FOR EACH STATEMENT\s+EXECUTE FUNCTION public\.validation_run_reject_mutation\(\);/
    );
    expect(MIGRATION).not.toMatch(/\bWHEN\s*\(/);
  });
});
