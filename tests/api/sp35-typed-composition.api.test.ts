import { describe, expect, it } from "vitest";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import { computeRegistryDigest } from "../../src/platform/capabilities/generate-registry.js";
import type { CoverageResult } from "../../src/platform/capabilities/coverage.js";
import { validateBlueprintCandidate } from "../../src/platform/blueprint/validate-blueprint.js";
import { lowerCompositionPlan, parseCompositionPlan, CompositionPlanError, type CompositionPlan } from "../../src/platform/compiler/typed-composition.js";
import { hydratedHarness } from "../runtime/runtime-fixtures.js";
import type { JsonRecord } from "../contract/blueprint-validation-fixtures.js";

const rid = "sha256:" + "a".repeat(64);
const coverage: CoverageResult = {
  registryVersion: CAPABILITY_REGISTRY_SOURCE.registryVersion,
  registryDigest: computeRegistryDigest(CAPABILITY_REGISTRY_SOURCE),
  status: "FULLY_SUPPORTED",
  selected: CAPABILITY_REGISTRY_SOURCE.capabilities.map(x => ({ id: x.id, version: x.version })),
  requirements: [],
  gaps: []
};
const context = { coverage, validRequirementIds: new Set([rid]) };
const display = { kind: "DISPLAY", key: "intro", requirement_ids: [rid], heading: "我的生活", body: "今天也要加油" } as const;
const form = { kind: "FORM", key: "profile", requirement_ids: [rid], heading: "資料表單", reset_label: "重設", fields: [
  { kind: "TEXT", key: "name", label: "名稱", max_length: 60, initial: "Amy" },
  { kind: "NUMBER", key: "age", label: "年齡", min: 0, max: 120, initial: 30 },
  { kind: "TOGGLE", key: "ready", label: "準備完成", initial: false }
] } as const;
const arithmetic = { kind: "ARITHMETIC", key: "calc", requirement_ids: [rid], heading: "加法", left_label: "數字 A", right_label: "數字 B", result_label: "結果", operation: "ADD", initial_left: 3, initial_right: 4 } as const;
const tasks = { kind: "RECORD_LIST", key: "todos", requirement_ids: [rid], heading: "待辦", record_title_key: "title", record_done_key: "done",
  input_label: "新任務", add_label: "新增", toggle_label: "完成", delete_label: "刪除", total_label: "總數", completed_label: "完成數", max_items: 3 } as const;
const plan = (modules: CompositionPlan["modules"]): CompositionPlan => ({ plan_version: "1.0.0", title: "測試 App", modules });

function validate(p: CompositionPlan) {
  return validateBlueprintCandidate(new TextEncoder().encode(JSON.stringify(lowerCompositionPlan(p, context))));
}

describe("BD-026 deterministic four-family typed composition", () => {
  it("rejects forged requirement references and invalid model-only fields", () => {
    expect(() => parseCompositionPlan({ ...plan([tasks]), extra_code: "alert('x')" } as never, context.validRequirementIds)).toThrow(CompositionPlanError);
    expect(() => parseCompositionPlan(plan([{ ...tasks, requirement_ids: ["sha256:" + "b".repeat(64)] }]), context.validRequirementIds)).toThrowError(/PLAN_UNTRUSTED_REFERENCE/);
    expect(() => parseCompositionPlan(plan([{ ...tasks, record_done_key: "title" }]), context.validRequirementIds)).toThrowError(/PLAN_SCHEMA_INVALID/);
    expect(() => parseCompositionPlan(plan([{ ...tasks, max_items: 501 }]), context.validRequirementIds)).toThrowError(/PLAN_SCHEMA_INVALID/);
    expect(() => parseCompositionPlan(plan([display, { ...display }]), context.validRequirementIds)).toThrowError(/PLAN_SCHEMA_INVALID/);
  });

  it("makes exact same candidate twice with one connected root and fully registered F04 refs", () => {
    const p = plan([display, form, arithmetic, tasks]);
    const a = lowerCompositionPlan(p, context), b = lowerCompositionPlan(p, context);
    expect(a).toEqual(b);
    expect(a.root_node_id).toBe("node_root");
    expect(a.nodes[0]?.id).toBe("node_root");
    expect(new Set(a.nodes.map(x => x.id)).size).toBe(a.nodes.length);
    expect(a.nodes.filter(x => x.repeat !== undefined)).toHaveLength(1);
    for (const node of a.nodes) expect(context.coverage.selected).toContainEqual(node.capability);
  });

  it.each([
    ["DISPLAY", plan([display])],
    ["FORM", plan([{ ...form, requirement_ids: [rid] }])],
    ["ARITHMETIC", plan([arithmetic])],
    ["RECORD_LIST", plan([tasks])],
    ["FOUR IN ONE", plan([display, { ...form, requirement_ids: [rid] }, arithmetic, tasks])]
  ])("admits F02 independently for %s", (_name, p) => {
    const result = validate(p);
    expect(result.report.issues).toEqual([]);
    expect(result.report.status).toBe("PASSED");
    expect(result.admissible?.blueprint.root_node_id).toBe("node_root");
  });

  it("refuses to invent a missing structural capability", () => {
    const reduced = { ...coverage, selected: coverage.selected.filter(x => x.id !== "layout.container") };
    expect(() => lowerCompositionPlan(plan([tasks]), { ...context, coverage: reduced })).toThrowError(/COMPOSITION_UNSUPPORTED/);
  });

  it("generates real F03 A/B/C per-row add, complete and delete operations", async () => {
    const bp = lowerCompositionPlan(plan([tasks]), context);
    const runtime = (await hydratedHarness(bp as unknown as JsonRecord)).runtime;
    function press(nodeId: string, index = 0, eventName = "press", payload: Record<string, string> = {}) {
      const key = runtime.nodeInstances().filter(x => x.key.node_id === nodeId)[index]?.key;
      expect(key).toBeDefined();
      const receipt = runtime.dispatch({ source_node_instance_key: key!, event_name: eventName, payload, origin: "USER" });
      expect(receipt).toMatchObject({ accepted: true });
    }
    for (const task of ["A", "B", "C"]) {
      press("node_m000_input", 0, "change", { value: task });
      press("node_m000_add");
    }
    expect(runtime.readState("s_m000_rows")).toEqual([{ title: "A", done: false }, { title: "B", done: false }, { title: "C", done: false }]);
    expect(runtime.readState("s_m000_draft")).toBe("");
    press("node_m000_input", 0, "change", { value: "D" });
    press("node_m000_add"); // full list: no extra row and draft preserved
    expect(runtime.readState("s_m000_draft")).toBe("D");
    press("node_m000_toggle", 1);
    expect(runtime.readState("s_m000_rows")).toEqual([{ title: "A", done: false }, { title: "B", done: true }, { title: "C", done: false }]);
    press("node_m000_remove", 0);
    expect(runtime.readState("s_m000_rows")).toEqual([{ title: "B", done: true }, { title: "C", done: false }]);
  });
});
