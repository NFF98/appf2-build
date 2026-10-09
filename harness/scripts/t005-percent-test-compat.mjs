import fs from "node:fs";
import { execFileSync } from "node:child_process";

/**
 * One-shot 2026-10-09 Human-approved T005/T004 cross-Task test compatibility repair.
 * NOT a general maintenance permission: exact original main commit, locked Sprint/Task,
 * exact five-file governance diff, and byte-for-byte deletion of ONE stale assertion.
 * Once merged the permitted base no longer contains that assertion, so this cannot
 * authorize later implementation changes or modify any other CLOSED-Task test.
 */
export const T005_PERCENT_REPAIR_BASE = "fd7650b6629f4df5ae97a2b1c9269ad6b7f25346";
export const T005_PERCENT_TEST_PATH = "tests/e2e/f00-create-shell.spec.ts";
export const T005_PERCENT_TEST_ID = "TEST-F00-003";
export const T005_PERCENT_GATE_MARKER = "T005 exact one-shot percent test compatibility repair recognized";
const staleAssertion = "  await expect(page.getByText(/\\d+\\s*%/)).toHaveCount(0);\n";
const permittedFiles = Object.freeze([
  "tests/e2e/f00-create-shell.spec.ts",
  "harness/scripts/t005-percent-test-compat.mjs",
  "harness/scripts/validate-change-scope.mjs",
  "harness/scripts/validate-test-integrity.mjs",
  "ci/run-product-ci.mjs"
]);

export function exactNoPercentAssertionRemoval(before, after) {
  if (typeof before !== "string" || typeof after !== "string") return false;
  return before.split(staleAssertion).length === 2 && after === before.replace(staleAssertion, "");
}

export function exactT005RepairShape({ base, changed, current, build, beforeTest, afterTest }) {
  return base === T005_PERCENT_REPAIR_BASE &&
    current?.active_sprint === "SP-P1-003" &&
    current?.active_build_spec === "BS-P1-024" &&
    current?.active_task === "T005" &&
    current?.status === "ACTIVE" &&
    build?.active_baseline === "BS-P1-024" &&
    build?.implementation_enabled === true &&
    Array.isArray(changed) && changed.length === permittedFiles.length &&
    permittedFiles.every(file => changed.includes(file)) &&
    new Set(changed).size === permittedFiles.length &&
    exactNoPercentAssertionRemoval(beforeTest, afterTest);
}

const gitRead = (ref, rel) => {
  try { return execFileSync("git", ["show", ref + ":" + rel], { encoding: "utf8" }); }
  catch { return null; }
};

/** Used by all three gates; never trusts merely a mutable PR description or env flag. */
export function isExactT005PercentGovernanceRepair({ base, head, changed, current, build }) {
  if (!base || !head) return false;
  const beforeTest = gitRead(base, T005_PERCENT_TEST_PATH);
  const afterTest = gitRead(head, T005_PERCENT_TEST_PATH);
  if (!exactT005RepairShape({ base, changed, current, build, beforeTest, afterTest })) return false;
  try { return fs.readFileSync(T005_PERCENT_TEST_PATH, "utf8") === afterTest; }
  catch { return false; }
}

/** Positive and negative guard regression cases: invoked by governance gate on every CI run. */
export function testT005PercentRepairGuard() {
  const beforeTest = "prefix\n" + staleAssertion + "suffix\n";
  const afterTest = beforeTest.replace(staleAssertion, "");
  const current = { active_sprint: "SP-P1-003", active_build_spec: "BS-P1-024", active_task: "T005", status: "ACTIVE" };
  const build = { active_baseline: "BS-P1-024", implementation_enabled: true };
  const clean = { base: T005_PERCENT_REPAIR_BASE, changed: [...permittedFiles], current, build, beforeTest, afterTest };
  const cases = [
    ["exactly one deleted obsolete assertion", true, clean],
    ["wrong base commit", false, { ...clean, base: "0".repeat(40) }],
    ["wrong Task", false, { ...clean, current: { ...current, active_task: "T006" } }],
    ["paused sprint", false, { ...clean, current: { ...current, status: "HOLD" } }],
    ["wrong baseline", false, { ...clean, build: { ...build, active_baseline: "BS-P1-023" } }],
    ["duplicate obsolete assertions", false, { ...clean, beforeTest: beforeTest + staleAssertion }],
    ["other assertion edited", false, { ...clean, afterTest: afterTest.replace("prefix", "changed") }],
    ["assertion retained", false, { ...clean, afterTest: beforeTest }],
    ["extra implementation path", false, { ...clean, changed: [...permittedFiles, "src/app/evil.ts"] }],
    ["missing gate path", false, { ...clean, changed: permittedFiles.slice(0, -1) }],
    ["duplicate file path", false, { ...clean, changed: [...permittedFiles.slice(0, -1), permittedFiles[0]] }]
  ];
  for (const [label, expected, ctx] of cases) {
    if (exactT005RepairShape(ctx) !== expected) throw new Error("T005 bounded repair guard regression FAILED: " + label);
  }
  return cases.length;
}
