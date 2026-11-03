import { describe, expect, it } from "vitest";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import { isMultiModulePlanEligible } from "../../src/platform/compiler/compose-validate.js";
import { TYPED_PLAN_POLICY } from "../../src/platform/compiler/prompts.js";
import type { CoverageResult } from "../../src/platform/capabilities/coverage.js";

const ACTIVE = ["layout.container", "content.text", "content.list",
  "input.text", "action.button", "data.stat", "input.number"];
const roles = ACTIVE.map(id => {
  const def = CAPABILITY_REGISTRY_SOURCE.capabilities.find(c => c.id === id);
  if (!def) throw Error("Missing active role in test registry: " + id);
  return { id, version: def.version };
});
const coverage = (): CoverageResult => ({
  registryVersion: CAPABILITY_REGISTRY_SOURCE.registryVersion,
  registryDigest: "sha256:" + "0".repeat(64),
  status: "FULLY_SUPPORTED", selected: roles, requirements: [], gaps: []
});

describe("Sprint 3.5 bounded multi-module Prompt B route", () => {
  it("teaches the provider all five real LifePilot modules, not obsolete four kinds", () => {
    for (const kind of ["RECORD_LIST", "TODAY_SUMMARY", "SHOPPING_LIST", "BUDGET", "HABIT"]) {
      expect(TYPED_PLAN_POLICY).toContain(kind);
    }
    expect(TYPED_PLAN_POLICY).not.toContain("ARITHMETIC, RECORD_LIST only.");
  });
  it("selects concise typed composition only for fully-covered complex role sets", () => {
    expect(isMultiModulePlanEligible(coverage(), 8)).toBe(true);
    expect(isMultiModulePlanEligible(coverage(), 4)).toBe(true);
    expect(isMultiModulePlanEligible(coverage(), 3)).toBe(false);
    expect(isMultiModulePlanEligible({...coverage(), selected:roles.slice(0,6)},8)).toBe(false);
    expect(isMultiModulePlanEligible({...coverage(), status: "PARTIALLY_SUPPORTED"}, 10)).toBe(false);
    expect(isMultiModulePlanEligible({...coverage(), gaps: [{
      requirementId: "x", description: "unsupported", evidenceCode: "UNSUPPORTED"
    }]}, 10)).toBe(false);
    // F02 Builder, not plan-selection, independently rejects a missing
    // numeric input if a BUDGET or SHOPPING_LIST module actually uses it.
    expect(isMultiModulePlanEligible({...coverage(), selected: roles.filter(r => r.id !== "input.number")}, 10)).toBe(false);
    expect(isMultiModulePlanEligible({...coverage(), certifiedProfile: "RECORD_LIST"}, 10)).toBe(false);
  });
});
