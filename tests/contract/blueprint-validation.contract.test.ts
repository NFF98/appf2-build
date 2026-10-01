import { readFile } from "node:fs/promises";

import { describe, expect, test } from "vitest";

import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import {
  encodeBlueprint,
  sha256OfBytes,
  validationContext,
  validationDependencies,
  validBlueprint
} from "./blueprint-validation-fixture.js";

describe("Blueprint validation contract", () => {
  test("TEST-F02-004 rejects an unknown top-level executable key", async () => {
    const blueprint = validBlueprint();
    blueprint.runtime_exec = "secret-executable-body";
    const bytes = encodeBlueprint(blueprint);
    const dependencies = validationDependencies();

    const outcome = await validateBlueprintCandidate(bytes, validationContext(), dependencies);
    const report = outcome.validation_report;

    expect(outcome.status).toBe("REJECTED");
    expect(report.candidate_digest).toBe(sha256OfBytes(bytes));
    expect(report.content_hash).toBeNull();
    expect(report.issues.map((issue) => issue.error_code)).toContain("F02-ERR-002");
    expect(report.issues.map((issue) => issue.stage)).toContain("V02");
    expect(report.issues.map((issue) => issue.message_key)).toContain("unknown_key");
    expect(JSON.stringify(report)).not.toContain("secret-executable-body");
    expect("canonical_blueprint" in report).toBe(false);
    expect(await dependencies.repository.readRun("123e4567-e89b-42d3-a456-426614174000")).toBeNull();
  });

  test("TEST-F02-005 rejects unknown capability ID and unknown exact version", async () => {
    const unknownId = validBlueprint();
    (unknownId.nodes as Array<Record<string, unknown>>)[1] = {
      id: "node_budget",
      capability: { id: "input.not_registered", version: "1.0.0" },
      bindings: { bind: { kind: "STATE", key: "budget" } }
    };
    const unknownVersion = validBlueprint();
    (unknownVersion.nodes as Array<Record<string, unknown>>)[1] = {
      id: "node_budget",
      capability: { id: "input.number", version: "9.9.9" },
      bindings: { bind: { kind: "STATE", key: "budget" } }
    };
    const idBytes = encodeBlueprint(unknownId);
    const versionBytes = encodeBlueprint(unknownVersion);
    const dependencies = validationDependencies();

    const idOutcome = await validateBlueprintCandidate(idBytes, validationContext(), dependencies);
    const versionOutcome = await validateBlueprintCandidate(
      versionBytes,
      validationContext(),
      dependencies
    );

    expect(idOutcome.status).toBe("REJECTED");
    expect(versionOutcome.status).toBe("REJECTED");
    for (const outcome of [idOutcome, versionOutcome]) {
      expect(outcome.validation_report.issues[0]).toMatchObject({
        error_code: "F02-ERR-005",
        stage: "V04",
        message_key: "capability_not_found"
      });
      expect(outcome.validation_report.content_hash).toBeNull();
    }
    expect(idOutcome.validation_report.issues[0]?.capability_ref).toBe("input.not_registered@1.0.0");
    expect(versionOutcome.validation_report.issues[0]?.capability_ref).toBe("input.number@9.9.9");
    expect(await dependencies.repository.readContent(
      "sha256:0000000000000000000000000000000000000000000000000000000000000000"
    )).toBeNull();
  });
});

test("T002 migration defines validation_run and blueprint_content without a compiler_run FK", async () => {
  const migration = await readFile(
    new URL(
      "../../supabase/migrations/20261002120000_t002_blueprint_admission.sql",
      import.meta.url
    ),
    "utf8"
  );

  expect(migration).toContain("CREATE TABLE public.validation_run");
  expect(migration).toContain("CREATE TABLE public.blueprint_content");
  expect(migration).toContain("compiler_run_id uuid NULL");
  expect(migration).not.toMatch(/REFERENCES\s+public\.compiler_run/);
  expect(migration).not.toMatch(/compiler_run_id[^;\n]*REFERENCES/);
  expect(migration).toContain("candidate_digest text NOT NULL");
  expect(migration).toContain("candidate_digest ~ '^sha256:[0-9a-f]{64}$'");
  expect(migration).toContain("CHECK (status IN ('PASSED', 'REJECTED', 'INCOMPATIBLE'))");
  expect(migration).toContain("validation_run_blueprint_hash_status_ck");
  expect(migration).toContain("CONSTRAINT blueprint_content_admitted_by_validation_run_fk");
  expect(migration).toContain("REFERENCES public.validation_run (validation_run_id)");
  expect(migration).not.toMatch(/ON DELETE CASCADE/i);
  expect(migration).toContain("CHECK (trust_status IN ('VALIDATED', 'REVOKED', 'INCOMPATIBLE'))");
  expect(migration).toContain("validation_run_compiler_run_id_idx");
  expect(migration).toContain("validation_run_status_created_at_idx");
  expect(migration).toContain("blueprint_content_created_at_idx");
  expect(migration).toContain("blueprint_content_schema_registry_trust_idx");
  expect(migration).toContain("blueprint_content_reject_immutable_update");
  expect(migration).not.toContain("NEW.trust_status IS DISTINCT FROM OLD.trust_status");
  expect(migration).toContain("NEW.content_hash IS DISTINCT FROM OLD.content_hash");
  expect(migration).toContain("NEW.canonical_blueprint IS DISTINCT FROM OLD.canonical_blueprint");
  expect(migration).toContain("NEW.admitted_by_validation_run_id IS DISTINCT FROM OLD.admitted_by_validation_run_id");
  expect(migration).toContain("ENABLE ROW LEVEL SECURITY");
  expect(migration).not.toMatch(/IF\s+NOT\s+EXISTS/i);
  expect(migration).not.toMatch(/\bGRANT\b/);
  expect(migration).not.toContain("product_event");
});
