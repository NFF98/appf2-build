import type { BlueprintValidationResult } from "../../src/platform/blueprint/validation-types.js";

export type JsonRecord = Record<string, unknown>;

const lit = (value: unknown): JsonRecord => ({ kind: "LITERAL", value });
const state = (key: string): JsonRecord => ({ kind: "STATE", key });
const event = (path: string): JsonRecord => ({ kind: "EVENT", path });
const scope = (name: string, path: string): JsonRecord => ({ kind: "SCOPE", name, path });
const op = (name: string, ...args: JsonRecord[]): JsonRecord => ({ kind: "OP", op: name, args });

export const source = { lit, state, event, scope, op };

export function node(
  id: string,
  capability: string,
  version: string,
  fields: { props?: JsonRecord; bindings?: JsonRecord; events?: JsonRecord; children?: string[]; repeat?: JsonRecord } = {}
): JsonRecord {
  const result: JsonRecord = {
    id,
    capability: { id: capability, version },
    props: fields.props ?? {},
    bindings: fields.bindings ?? {},
    events: fields.events ?? {},
    children: fields.children ?? []
  };
  if (fields.repeat !== undefined) {
    result.repeat = fields.repeat;
  }
  return result;
}

function fixtureState(): JsonRecord {
  return {
    people: { mode: "MUTABLE", type: "NUMBER", initial: 4 },
    total: { mode: "MUTABLE", type: "NUMBER", initial: 120 },
    note: { mode: "MUTABLE", type: "STRING", initial: "", constraints: { max_length: 200 } },
    size: { mode: "MUTABLE", type: "ENUM", initial: "SMALL", constraints: { allowed: ["SMALL", "LARGE"] } },
    tip_enabled: { mode: "MUTABLE", type: "BOOLEAN", initial: false },
    selected_name: { mode: "MUTABLE", type: "STRING", initial: "", constraints: { max_length: 120 } },
    items: {
      mode: "MUTABLE",
      type: "LIST",
      initial: [{ name: "A", price: 10 }],
      constraints: {
        item: {
          type: "RECORD",
          constraints: {
            fields: {
              name: { type: "STRING", constraints: { max_length: 120 } },
              price: { type: "NUMBER", constraints: { min: 0 } }
            }
          }
        },
        max_length: 20
      }
    },
    per_person: { mode: "DERIVED", type: "NUMBER", expr: op("DIV", state("total"), state("people")) }
  };
}

export function validBlueprint(): JsonRecord {
  return {
    schema_version: "1.0.0",
    registry_version: "7.0.0",
    kind: "APP",
    meta: { title: "聚餐分帳", description: "依人數計算每人金額" },
    support: { coverage_status: "FULLY_SUPPORTED", degradations: [] },
    state: fixtureState(),
    rules: [{ id: "rule_can_split", result_type: "BOOLEAN", expr: op("GT", state("people"), lit(0)) }],
    actions: [
      { id: "action_set_people", steps: [{ type: "SET_STATE", target: "people", value: event("value") }] },
      { id: "action_set_note", steps: [{ type: "SET_STATE", target: "note", value: event("value") }] },
      { id: "action_set_size", steps: [{ type: "SET_STATE", target: "size", value: event("value") }] },
      {
        id: "action_toggle_tip",
        steps: [{ type: "SET_STATE", target: "tip_enabled", value: event("value"), when: { kind: "RULE", rule_id: "rule_can_split" } }]
      },
      { id: "action_pick_item", steps: [{ type: "SET_STATE", target: "selected_name", value: scope("item", "name") }] },
      {
        id: "action_roll",
        steps: [
          { type: "INVOKE_CAPABILITY", target_node_id: "node_random", capability_action: "sample_number", args: { min: lit(1), max: lit(6) } },
          { type: "INVOKE_CAPABILITY", target_node_id: "node_random", capability_action: "choose_item", args: { items: lit(["A", "B"]) } },
          { type: "INVOKE_CAPABILITY", target_node_id: "node_timer", capability_action: "start", args: {} },
          { type: "INVOKE_CAPABILITY", target_node_id: "node_score", capability_action: "increment", args: { delta: lit(1) } },
          { type: "INVOKE_CAPABILITY", target_node_id: "node_score", capability_action: "set", args: { value: lit(5) } }
        ]
      },
      { id: "action_reset", steps: [{ type: "RESET_STATE", target: "ALL_MUTABLE" }] }
    ],
    nodes: [
      node("node_root", "layout.container", "1.0.0", {
        props: { direction: lit("COLUMN"), gap: lit("MD"), align: lit("STRETCH") },
        children: ["node_title", "node_card", "node_list", "node_table", "node_roll", "node_random", "node_timer", "node_score", "node_notice"]
      }),
      node("node_title", "content.text", "1.0.0", { props: { role: lit("HEADING") }, bindings: { text: lit("聚餐分帳") } }),
      node("node_card", "content.card", "1.0.0", {
        bindings: { title: lit("輸入") },
        children: ["node_people", "node_note", "node_size", "node_tip", "node_stat"]
      }),
      node("node_people", "input.number", "1.0.0", {
        props: { label: lit("人數"), min: lit(1), max: lit(50), step: lit(1) },
        bindings: { bind: state("people") },
        events: { change: "action_set_people" }
      }),
      node("node_note", "input.text", "1.0.0", {
        props: { label: lit("備註"), max_length: lit(200) },
        bindings: { bind: state("note") },
        events: { change: "action_set_note" }
      }),
      node("node_size", "input.select", "2.0.0", {
        props: {
          label: lit("份量"),
          options: lit([
            { label: "小", value: "SMALL" },
            { label: "大", value: "LARGE" }
          ])
        },
        bindings: { bind: state("size") },
        events: { change: "action_set_size" }
      }),
      node("node_tip", "input.toggle", "1.0.0", { bindings: { bind: state("tip_enabled") }, events: { change: "action_toggle_tip" } }),
      node("node_stat", "data.stat", "1.0.0", {
        props: { label: lit("每人"), format: lit("NUMBER") },
        bindings: { value: state("per_person") }
      }),
      node("node_list", "content.list", "1.0.0", {
        repeat: { items: state("items"), item_alias: "item", index_alias: "index", max_items: 20 },
        children: ["node_item_row"]
      }),
      node("node_item_row", "layout.container", "1.0.0", {
        props: { direction: lit("ROW"), gap: lit("SM"), align: lit("CENTER") },
        children: ["node_item_name", "node_item_pick"]
      }),
      node("node_item_name", "content.text", "1.0.0", { props: { role: lit("BODY") }, bindings: { text: scope("item", "name") } }),
      node("node_item_pick", "action.button", "1.0.0", {
        props: { label: lit("選擇") },
        bindings: { disabled: op("EQ", scope("index", ""), lit(0)) },
        events: { press: "action_pick_item" }
      }),
      node("node_table", "data.table_basic", "1.0.0", {
        props: {
          columns: lit([
            { key: "name", label: "名稱", format: "TEXT" },
            { key: "price", label: "價格", format: "NUMBER" }
          ]),
          max_rows: lit(20)
        },
        bindings: { rows: state("items") }
      }),
      node("node_roll", "action.button", "1.0.0", { props: { label: lit("擲骰") }, events: { press: "action_roll" } }),
      node("node_random", "logic.random", "1.0.0"),
      node("node_timer", "logic.timer", "1.0.0", { props: { duration_ms: lit(60000) } }),
      node("node_score", "logic.score", "1.0.0", { props: { initial: lit(0), min: lit(0), max: lit(10) } }),
      node("node_notice", "system.notice", "1.0.0", {
        props: { severity: lit("INFO") },
        bindings: { message: lit("準備就緒"), action_refs: lit(["action_reset"]) }
      })
    ],
    root_node_id: "node_root",
    result: {
      outputs: [{ id: "per_person", label: "每人金額", value: state("per_person"), sensitivity: "NORMAL" }]
    }
  };
}

export function encode(candidate: unknown): Uint8Array {
  return new TextEncoder().encode(typeof candidate === "string" ? candidate : JSON.stringify(candidate));
}

export function issueOf(result: BlueprintValidationResult): { code: string; stage: string; path: string } {
  const [issue] = result.report.issues;
  return { code: issue?.error_code ?? "NONE", stage: issue?.stage ?? "NONE", path: issue?.json_path ?? "NONE" };
}

type Path = readonly (string | number)[];

export function mutate(candidate: JsonRecord, path: Path, update: (parent: JsonRecord | unknown[], key: string | number) => void): JsonRecord {
  let parent: unknown = candidate;
  for (const segment of path.slice(0, -1)) {
    parent = (parent as Record<string | number, unknown>)[segment];
  }
  update(parent as JsonRecord, path[path.length - 1] as string | number);
  return candidate;
}

export function withValue(path: Path, value: unknown): JsonRecord {
  return mutate(validBlueprint(), path, (parent, key) => {
    (parent as Record<string | number, unknown>)[key] = value;
  });
}

export function without(path: Path): JsonRecord {
  return mutate(validBlueprint(), path, (parent, key) => {
    delete (parent as Record<string | number, unknown>)[key];
  });
}

export function nodeIndex(id: string): number {
  const nodes = validBlueprint().nodes as JsonRecord[];
  return nodes.findIndex((entry) => entry.id === id);
}

export function actionIndex(id: string): number {
  const actions = validBlueprint().actions as JsonRecord[];
  return actions.findIndex((entry) => entry.id === id);
}
