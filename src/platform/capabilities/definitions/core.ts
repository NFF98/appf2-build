import type {
  CapabilityDefinition,
  CapabilityFamily,
  ContractKind,
  ExecutionClass,
  PermissionClass,
  ReplayClass,
  ResourceBudget
} from "../schema/capability-definition.js";

const DEFAULT_RESOURCE_BUDGET: ResourceBudget = {
  maxInstancesPerBlueprint: 100,
  maxSerializedPropsBytes: 256 * 1024,
  maxLocalStateBytes: 128 * 1024,
  maxEventBindings: 200,
  maxActionBindings: 100,
  maxConcurrentTimers: 10,
  mediaAutoplayAllowed: false,
  networkAccessAllowed: false
};

interface CoreDefinitionInput {
  readonly id: string;
  readonly displayName: string;
  readonly family: CapabilityFamily;
  readonly kind: ContractKind;
  readonly meaning: string;
  readonly intentClasses: readonly string[];
  readonly selectionHints: readonly string[];
  readonly rejectionHints?: readonly string[];
  readonly execution?: ExecutionClass;
  readonly replayClass?: ReplayClass;
  readonly permissionClass?: PermissionClass;
  readonly actions?: readonly string[];
  readonly events?: readonly string[];
  readonly bindings?: readonly string[];
  readonly operators?: readonly string[];
}

function defineCore(input: CoreDefinitionInput): CapabilityDefinition {
  const replayClass = input.replayClass ?? "DETERMINISTIC";
  return {
    id: input.id,
    version: "1.0.0",
    family: input.family,
    displayName: input.displayName,
    semantic: {
      meaning: input.meaning,
      intentClasses: input.intentClasses,
      selectionHints: input.selectionHints,
      rejectionHints: input.rejectionHints ?? []
    },
    contract: {
      kind: input.kind,
      propsSchema: { ref: `capability://${input.id}/1.0.0/props` },
      stateSchema: { ref: `capability://${input.id}/1.0.0/state` },
      inputs: [],
      outputs: [],
      actions: input.actions ?? [],
      events: input.events ?? [],
      bindings: input.bindings ?? [],
      operators: input.operators ?? []
    },
    runtime: {
      execution: input.execution ?? "LOCAL_REACT",
      registrationKey: input.id.replace(".", "/"),
      deterministic: replayClass === "DETERMINISTIC",
      replayClass,
      permissionClass: input.permissionClass ?? "NONE",
      resourceBudget: {
        ...DEFAULT_RESOURCE_BUDGET
      }
    },
    product: {
      shareability: "FULL",
      remixability: "FULL",
      persistenceClass: "BLUEPRINT",
      sensitiveFields: [],
      socialPotential: "NONE",
      costClass: "FREE_LOCAL"
    },
    compatibility: {
      minRuntimeVersion: "1.0.0",
      maxRuntimeVersion: "<2.0.0",
      blueprintSchemaRange: ">=1.0.0 <2.0.0",
      dependencies: []
    },
    degradation: {
      allowed: false,
      alternatives: [],
      preservesSemanticCore: true
    },
    lifecycle: {
      targetHorizon: "CORE",
      maturity: "TESTED",
      availability: "ENABLED",
      releaseRequirement: "RELEASE_BLOCKING"
    }
  };
}

export const CORE_CAPABILITY_DEFINITIONS: readonly CapabilityDefinition[] = [
  defineCore({
    id: "layout.container",
    displayName: "Layout Container",
    family: "LAYOUT",
    kind: "VIEW",
    meaning: "Compose child nodes with bounded layout configuration.",
    intentClasses: ["layout", "grouping"],
    selectionHints: ["Use to arrange child nodes in rows or columns."],
    bindings: ["children"]
  }),
  defineCore({
    id: "content.text",
    displayName: "Text",
    family: "CONTENT",
    kind: "VIEW",
    meaning: "Present literal or derived text.",
    intentClasses: ["text", "label", "heading"],
    selectionHints: ["Use for human-readable textual content."],
    bindings: ["text"]
  }),
  defineCore({
    id: "content.card",
    displayName: "Content Card",
    family: "CONTENT",
    kind: "VIEW",
    meaning: "Present a semantically grouped content card.",
    intentClasses: ["card", "grouped_content"],
    selectionHints: ["Use when related content needs a titled group."],
    bindings: ["title", "description", "children"]
  }),
  defineCore({
    id: "content.list",
    displayName: "Content List",
    family: "CONTENT",
    kind: "VIEW",
    meaning: "Present a bounded list using a declarative item template.",
    intentClasses: ["list", "repeated_content"],
    selectionHints: ["Use for bounded repeated content."],
    rejectionHints: ["Do not use arbitrary template code."],
    bindings: ["items", "item_template"]
  }),
  defineCore({
    id: "action.button",
    displayName: "Action Button",
    family: "INPUT",
    kind: "INPUT",
    meaning: "Trigger an action from an explicit user gesture.",
    intentClasses: ["action", "button"],
    selectionHints: ["Use for user-initiated actions."],
    permissionClass: "USER_GESTURE",
    events: ["press"],
    bindings: ["disabled"]
  }),
  defineCore({
    id: "input.number",
    displayName: "Number Input",
    family: "INPUT",
    kind: "INPUT",
    meaning: "Edit a numeric value bound to typed runtime state.",
    intentClasses: ["numeric_input", "calculator", "budget"],
    selectionHints: ["Use when the user must edit a numeric value."],
    rejectionHints: ["Do not use for display-only values."],
    events: ["change"],
    bindings: ["bind"]
  }),
  defineCore({
    id: "input.text",
    displayName: "Text Input",
    family: "INPUT",
    kind: "INPUT",
    meaning: "Edit bounded text bound to typed runtime state.",
    intentClasses: ["text_input", "form"],
    selectionHints: ["Use when the user must enter bounded text."],
    events: ["change"],
    bindings: ["bind"]
  }),
  defineCore({
    id: "input.select",
    displayName: "Select Input",
    family: "INPUT",
    kind: "INPUT",
    meaning: "Select one value from a bounded local option set.",
    intentClasses: ["selection", "chooser", "form"],
    selectionHints: ["Use for a bounded set of local options."],
    rejectionHints: ["Do not use a remote option loader in Phase 1."],
    events: ["change"],
    bindings: ["bind"]
  }),
  defineCore({
    id: "input.toggle",
    displayName: "Toggle Input",
    family: "INPUT",
    kind: "INPUT",
    meaning: "Edit a boolean value bound to typed runtime state.",
    intentClasses: ["boolean_input", "toggle", "form"],
    selectionHints: ["Use for a boolean choice."],
    events: ["change"],
    bindings: ["bind"]
  }),
  defineCore({
    id: "data.stat",
    displayName: "Statistic",
    family: "DATA",
    kind: "VIEW",
    meaning: "Present an important value or metric.",
    intentClasses: ["statistic", "metric", "result"],
    selectionHints: ["Use to emphasize a single value."],
    bindings: ["value"]
  }),
  defineCore({
    id: "data.table_basic",
    displayName: "Basic Table",
    family: "DATA",
    kind: "VIEW",
    meaning: "Present bounded rows and columns without executable cell renderers.",
    intentClasses: ["table", "tabular_data"],
    selectionHints: ["Use for bounded tabular data."],
    rejectionHints: ["Do not use arbitrary cell renderer code."],
    bindings: ["rows"]
  }),
  defineCore({
    id: "logic.random",
    displayName: "Seeded Random",
    family: "LOGIC",
    kind: "LOGIC",
    meaning: "Produce bounded random outcomes through the Runtime RNG service.",
    intentClasses: ["randomizer", "chooser", "dice"],
    selectionHints: ["Use when a seeded random outcome is required."],
    execution: "LOCAL_RULE",
    replayClass: "SEEDED",
    actions: ["sample_number", "choose_item"]
  }),
  defineCore({
    id: "logic.timer",
    displayName: "Timer",
    family: "LOGIC",
    kind: "LOGIC",
    meaning: "Maintain bounded timer state.",
    intentClasses: ["timer", "countdown"],
    selectionHints: ["Use for bounded countdown or elapsed-time behavior."],
    execution: "LOCAL_RULE",
    replayClass: "TIME_DEPENDENT",
    actions: ["start", "pause", "resume", "reset"],
    events: ["complete"]
  }),
  defineCore({
    id: "logic.score",
    displayName: "Score",
    family: "GAME",
    kind: "LOGIC",
    meaning: "Maintain bounded score state.",
    intentClasses: ["score", "counter", "game"],
    selectionHints: ["Use for a bounded score or counter."],
    execution: "LOCAL_RULE",
    actions: ["increment", "set", "reset"],
    events: ["change"]
  }),
  defineCore({
    id: "system.notice",
    displayName: "System Notice",
    family: "SYSTEM",
    kind: "VIEW",
    meaning: "Present a human-facing notice or recovery direction.",
    intentClasses: ["notice", "status", "recovery"],
    selectionHints: ["Use for safe consumer-facing status and recovery messages."],
    rejectionHints: ["Do not expose raw internal error details."],
    bindings: ["action_refs"]
  })
];
