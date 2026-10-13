import { CORE_CAPABILITY_HANDLERS } from "../../src/platform/runtime/core-handlers.js";
import { blueprintWith, hydratedHarness, lit, node, op, state, event, type RuntimeHarness } from "./runtime-fixtures.js";
import type { JsonRecord } from "../contract/blueprint-validation-fixtures.js";

/**
 * Split-bill App whose `result.outputs` cover every sensitivity class: an AVAILABLE NORMAL output, an output that is
 * an F03 evaluation error while `divisor` is 0 (SENSITIVE), and a DO_NOT_PERSIST free-text output.
 */
export function resultBlueprint(overrides: { readonly total?: number; readonly title?: string } = {}): JsonRecord {
  return blueprintWith({
    meta: { title: overrides.title ?? "聚餐分帳", description: "" },
    state: {
      people: { mode: "MUTABLE", type: "NUMBER", initial: 4 },
      total: { mode: "MUTABLE", type: "NUMBER", initial: overrides.total ?? 120 },
      divisor: { mode: "MUTABLE", type: "NUMBER", initial: 0 },
      note: { mode: "MUTABLE", type: "STRING", initial: "私人備註", constraints: { max_length: 200 } }
    },
    actions: [
      { id: "action_set_people", steps: [{ type: "SET_STATE", target: "people", value: event("value") }] },
      { id: "action_set_note", steps: [{ type: "SET_STATE", target: "note", value: event("value") }] }
    ],
    nodes: [
      node("node_people", "input.number", "1.0.0", {
        props: { label: lit("人數"), min: lit(1), max: lit(50), step: lit(1) },
        bindings: { bind: state("people") },
        events: { change: "action_set_people" }
      }),
      node("node_note", "input.text", "1.0.0", {
        props: { label: lit("備註"), max_length: lit(200) },
        bindings: { bind: state("note") },
        events: { change: "action_set_note" }
      })
    ],
    result: {
      outputs: [
        { id: "per_person", label: "每人金額", value: op("DIV", state("total"), state("people")), sensitivity: "NORMAL" },
        { id: "ratio", label: "比例", value: op("DIV", lit(1), state("divisor")), sensitivity: "SENSITIVE" },
        { id: "note", label: "備註", value: state("note"), sensitivity: "DO_NOT_PERSIST" }
      ]
    }
  });
}

/** READY Instance driven by the production handler catalog (the one the browser and the Worker admission use). */
export function productionHarness(blueprint: JsonRecord): Promise<RuntimeHarness> {
  return hydratedHarness(blueprint, { trust: { handlers: CORE_CAPABILITY_HANDLERS } });
}
