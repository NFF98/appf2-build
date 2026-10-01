import type { JsonObject, JsonValue } from "./strict-json.js";
import type { ValidationIssue } from "./validation-types.js";

export type ValueFamily =
  | "STATE_EXPR"
  | "RULE_EXPR"
  | "BINDING"
  | "PROP"
  | "RESULT"
  | "REPEAT"
  | "ACTION";

export type ValueScope = "GENERAL" | "ACTION" | "REPEAT";

export interface ValueLocation {
  readonly path: string;
  readonly value: JsonValue;
  readonly family: ValueFamily;
  readonly scope: ValueScope;
  readonly owner: string | null;
  readonly repeatAliases: ReadonlySet<string> | null;
}

export type StateValueType =
  | "NUMBER"
  | "STRING"
  | "BOOLEAN"
  | "ENUM"
  | "LIST"
  | "RECORD";

export interface StateModel {
  readonly key: string;
  readonly mode: "MUTABLE" | "DERIVED";
  readonly valueType: StateValueType;
  readonly expr: ValueLocation | null;
}

export interface RuleModel {
  readonly id: string;
  readonly expr: ValueLocation;
}

export interface ActionStepModel {
  readonly type: "SET_STATE" | "RESET_STATE" | "INVOKE_CAPABILITY";
  readonly path: string;
  readonly target: string | null;
  readonly value: ValueLocation | null;
  readonly when: ValueLocation | null;
  readonly targetNodeId: string | null;
  readonly capabilityAction: string | null;
  readonly args: readonly ValueLocation[];
}

export interface ActionModel {
  readonly id: string;
  readonly steps: readonly ActionStepModel[];
}

export interface RepeatModel {
  readonly items: ValueLocation;
  readonly aliases: ReadonlySet<string>;
}

export interface NodeModel {
  readonly id: string;
  readonly path: string;
  readonly capabilityId: string;
  readonly capabilityVersion: string;
  readonly props: readonly ValueLocation[];
  readonly bindings: readonly ValueLocation[];
  readonly events: ReadonlyMap<string, string>;
  readonly children: readonly string[];
  readonly repeat: RepeatModel | null;
}

export interface BlueprintModel {
  readonly document: JsonObject;
  readonly schemaVersion: string;
  readonly registryVersion: string;
  readonly states: ReadonlyMap<string, StateModel>;
  readonly rules: ReadonlyMap<string, RuleModel>;
  readonly actions: ReadonlyMap<string, ActionModel>;
  readonly nodes: ReadonlyMap<string, NodeModel>;
  readonly rootNodeId: string;
  readonly resultValues: readonly ValueLocation[];
  readonly eventBindingCount: number;
  readonly timerCount: number;
}

export interface SchemaOutcome {
  readonly issues: readonly ValidationIssue[];
  readonly model: BlueprintModel | null;
  readonly schemaVersion: string | null;
  readonly registryVersion: string | null;
}
