import type {
  CapabilityDefinition,
  CapabilityFamily,
  ContractKind,
  ExecutionClass,
  PermissionClass,
  ReplayClass,
  ResourceBudget
} from "../schema/capability-definition.js";
import type { ValidatorContract } from "../schema/validator-contract.js";
import {
  ACTION_ARG_SOURCE_KINDS,
  BOOLEAN,
  NUMBER,
  VIEW_SOURCE_KINDS,
  action,
  binding,
  enumOf,
  exact,
  field,
  list,
  prop,
  record,
  staticEvent,
  stateBinding,
  string,
  validator
} from "./validator-builders.js";

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
  readonly version?: string;
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
  readonly timerSlotsPerInstance: number;
  readonly operators?: readonly string[];
  readonly validator: ValidatorContract;
}

function defineCore(input: CoreDefinitionInput): CapabilityDefinition {
  const replayClass = input.replayClass ?? "DETERMINISTIC";
  const version = input.version ?? "1.0.0";
  return {
    id: input.id,
    version,
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
      propsSchema: { ref: `capability://${input.id}/${version}/props` },
      stateSchema: { ref: `capability://${input.id}/${version}/state` },
      inputs: [],
      outputs: [],
      actions: Object.keys(input.validator.actions),
      events: Object.keys(input.validator.events),
      bindings: Object.keys(input.validator.bindings),
      operators: input.operators ?? [],
      validator: input.validator
    },
    runtime: {
      execution: input.execution ?? "LOCAL_REACT",
      registrationKey: input.id.replace(".", "/"),
      deterministic: replayClass === "DETERMINISTIC",
      replayClass,
      permissionClass: input.permissionClass ?? "NONE",
      resourceBudget: {
        ...DEFAULT_RESOURCE_BUDGET
      },
      resourceUsage: { timerSlotsPerInstance: input.timerSlotsPerInstance }
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
      executionStatus: "ACTIVE",
      releaseRequirement: "RELEASE_BLOCKING"
    }
  };
}

const LABEL = prop(string(120));
const OPTIONAL_BOOLEAN_PROP = prop(BOOLEAN, { required: false });
const OPTIONAL_NUMBER_PROP = prop(NUMBER, { required: false });

export const CORE_CAPABILITY_DEFINITIONS: readonly CapabilityDefinition[] = [
  defineCore({
    id: "layout.container",
    timerSlotsPerInstance: 0,
    displayName: "Layout Container",
    family: "LAYOUT",
    kind: "VIEW",
    meaning: "Compose child nodes with bounded layout configuration.",
    intentClasses: ["layout", "grouping"],
    selectionHints: ["Use to arrange child nodes in rows or columns."],
    validator: validator({
      props: {
        direction: prop(enumOf("ROW", "COLUMN")),
        gap: prop(enumOf("NONE", "XS", "SM", "MD", "LG", "XL")),
        align: prop(enumOf("START", "CENTER", "END", "STRETCH"))
      },
      composition: { children: true, repeat: false }
    })
  }),
  defineCore({
    id: "content.text",
    timerSlotsPerInstance: 0,
    displayName: "Text",
    family: "CONTENT",
    kind: "VIEW",
    meaning: "Present literal or derived text.",
    intentClasses: ["text", "label", "heading"],
    selectionHints: ["Use for human-readable textual content."],
    validator: validator({
      props: { role: prop(enumOf("BODY", "LABEL", "HEADING", "CAPTION")) },
      bindings: { text: binding(string(8192), VIEW_SOURCE_KINDS) }
    })
  }),
  defineCore({
    id: "content.card",
    timerSlotsPerInstance: 0,
    displayName: "Content Card",
    family: "CONTENT",
    kind: "VIEW",
    meaning: "Present a semantically grouped content card.",
    intentClasses: ["card", "grouped_content"],
    selectionHints: ["Use when related content needs a titled group."],
    validator: validator({
      bindings: {
        title: binding(string(120), VIEW_SOURCE_KINDS, { required: false }),
        description: binding(string(500), VIEW_SOURCE_KINDS, { required: false })
      },
      composition: { children: true, repeat: false }
    })
  }),
  defineCore({
    id: "content.list",
    timerSlotsPerInstance: 0,
    displayName: "Content List",
    family: "CONTENT",
    kind: "VIEW",
    meaning: "Present a bounded list using a declarative item template.",
    intentClasses: ["list", "repeated_content"],
    selectionHints: ["Use for bounded repeated content."],
    rejectionHints: ["Do not use arbitrary template code."],
    validator: validator({
      composition: { children: true, repeat: true, repeat_required: true }
    })
  }),
  defineCore({
    id: "action.button",
    timerSlotsPerInstance: 0,
    displayName: "Action Button",
    family: "INPUT",
    kind: "INPUT",
    meaning: "Trigger an action from an explicit user gesture.",
    intentClasses: ["action", "button"],
    selectionHints: ["Use for user-initiated actions."],
    permissionClass: "USER_GESTURE",
    validator: validator({
      props: { label: LABEL },
      bindings: { disabled: binding(BOOLEAN, VIEW_SOURCE_KINDS, { required: false }) },
      events: { press: staticEvent() }
    })
  }),
  defineCore({
    id: "input.number",
    timerSlotsPerInstance: 0,
    displayName: "Number Input",
    family: "INPUT",
    kind: "INPUT",
    meaning: "Edit a numeric value bound to typed runtime state.",
    intentClasses: ["numeric_input", "calculator", "budget"],
    selectionHints: ["Use when the user must edit a numeric value."],
    rejectionHints: ["Do not use for display-only values."],
    validator: validator({
      props: {
        label: LABEL,
        min: OPTIONAL_NUMBER_PROP,
        max: OPTIONAL_NUMBER_PROP,
        step: prop(NUMBER, { required: false, invariants: ["NUM_GT_ZERO"] }),
        required: OPTIONAL_BOOLEAN_PROP
      },
      bindings: { bind: stateBinding(NUMBER) },
      events: { change: staticEvent({ value: NUMBER }) },
      invariant_ids: ["INPUT_NUMBER_BOUNDS"]
    })
  }),
  defineCore({
    id: "input.text",
    timerSlotsPerInstance: 0,
    displayName: "Text Input",
    family: "INPUT",
    kind: "INPUT",
    meaning: "Edit bounded text bound to typed runtime state.",
    intentClasses: ["text_input", "form"],
    selectionHints: ["Use when the user must enter bounded text."],
    validator: validator({
      props: {
        label: LABEL,
        max_length: prop(NUMBER, { invariants: ["NUM_INT_RANGE_0_8192"] }),
        placeholder: prop(string(500), { required: false }),
        required: OPTIONAL_BOOLEAN_PROP
      },
      bindings: { bind: stateBinding(string(8192)) },
      events: {
        change: {
          payload: {
            kind: "BOUND_STRING_NARROWED_BY_PROP",
            binding_key: "bind",
            prop_key: "max_length"
          },
          invariant_ids: []
        }
      },
      invariant_ids: ["INPUT_TEXT_BOUND"]
    })
  }),
  defineCore({
    id: "input.select",
    timerSlotsPerInstance: 0,
    version: "2.0.0",
    displayName: "Select Input",
    family: "INPUT",
    kind: "INPUT",
    meaning: "Select one STRING value from a bounded local option set.",
    intentClasses: ["selection", "chooser", "form"],
    selectionHints: ["Use for a bounded set of local STRING options."],
    rejectionHints: ["Do not use a remote option loader in Phase 1."],
    validator: validator({
      props: {
        label: LABEL,
        options: prop(list(record({ label: string(120), value: string(8192) }), 500)),
        required: OPTIONAL_BOOLEAN_PROP
      },
      bindings: { bind: stateBinding({ kind: "ANY_ENUM" }) },
      events: {
        change: {
          payload: { kind: "BOUND_STATE_DESCRIPTOR", binding_key: "bind" },
          invariant_ids: []
        }
      },
      invariant_ids: ["SELECT_ENUM_DOMAIN"]
    })
  }),
  defineCore({
    id: "input.toggle",
    timerSlotsPerInstance: 0,
    displayName: "Toggle Input",
    family: "INPUT",
    kind: "INPUT",
    meaning: "Edit a boolean value bound to typed runtime state.",
    intentClasses: ["boolean_input", "toggle", "form"],
    selectionHints: ["Use for a boolean choice."],
    validator: validator({
      bindings: { bind: stateBinding(BOOLEAN) },
      events: { change: staticEvent({ value: BOOLEAN }) }
    })
  }),
  defineCore({
    id: "data.stat",
    timerSlotsPerInstance: 0,
    displayName: "Statistic",
    family: "DATA",
    kind: "VIEW",
    meaning: "Present an important value or metric.",
    intentClasses: ["statistic", "metric", "result"],
    selectionHints: ["Use to emphasize a single value."],
    validator: validator({
      props: {
        label: LABEL,
        format: prop(enumOf("NUMBER", "TEXT", "PERCENT", "CURRENCY_DISPLAY"), { required: false })
      },
      bindings: {
        value: binding(
          {
            kind: "ONE_OF",
            options: [exact(NUMBER), exact(string(8192)), exact(BOOLEAN), { kind: "ANY_ENUM" }]
          },
          VIEW_SOURCE_KINDS
        )
      },
      invariant_ids: ["STAT_FORMAT"]
    })
  }),
  defineCore({
    id: "data.table_basic",
    timerSlotsPerInstance: 0,
    displayName: "Basic Table",
    family: "DATA",
    kind: "VIEW",
    meaning: "Present bounded rows and columns without executable cell renderers.",
    intentClasses: ["table", "tabular_data"],
    selectionHints: ["Use for bounded tabular data."],
    rejectionHints: ["Do not use arbitrary cell renderer code."],
    validator: validator({
      props: {
        columns: prop(
          list(
            record({
              key: string(64),
              label: string(120),
              format: enumOf("TEXT", "NUMBER", "PERCENT", "CURRENCY_DISPLAY")
            }),
            500
          )
        ),
        max_rows: prop(NUMBER, { invariants: ["NUM_INT_RANGE_0_500"] })
      },
      bindings: {
        rows: binding(
          { kind: "LIST_OF", item: { kind: "ANY_RECORD" }, max_length: 500 },
          ["STATE", "RULE", "OP", "SCOPE"]
        )
      },
      invariant_ids: ["TABLE_COLUMNS", "TABLE_ROWS_BOUND"]
    })
  }),
  defineCore({
    id: "logic.random",
    timerSlotsPerInstance: 0,
    displayName: "Seeded Random",
    family: "LOGIC",
    kind: "LOGIC",
    meaning: "Produce bounded random outcomes through the Runtime RNG service.",
    intentClasses: ["randomizer", "chooser", "dice"],
    selectionHints: ["Use when a seeded random outcome is required."],
    execution: "LOCAL_RULE",
    replayClass: "SEEDED",
    validator: validator({
      actions: {
        sample_number: action(
          {
            min: field(NUMBER, ACTION_ARG_SOURCE_KINDS),
            max: field(NUMBER, ACTION_ARG_SOURCE_KINDS)
          },
          ["RANDOM_MIN_MAX"]
        ),
        choose_item: action({ items: field(list(string(8192), 500), ACTION_ARG_SOURCE_KINDS) })
      },
      capability_state: record(
        { last_number: NUMBER, last_index: NUMBER, last_item: string(8192) },
        ["last_number", "last_index", "last_item"]
      )
    })
  }),
  defineCore({
    id: "logic.timer",
    timerSlotsPerInstance: 1,
    displayName: "Timer",
    family: "LOGIC",
    kind: "LOGIC",
    meaning: "Maintain bounded timer state.",
    intentClasses: ["timer", "countdown"],
    selectionHints: ["Use for bounded countdown or elapsed-time behavior."],
    execution: "LOCAL_RULE",
    replayClass: "TIME_DEPENDENT",
    validator: validator({
      props: { duration_ms: prop(NUMBER, { invariants: ["NUM_INTEGER", "NUM_GTE_ZERO"] }) },
      actions: { start: action(), pause: action(), resume: action(), reset: action() },
      events: { complete: staticEvent() },
      capability_state: record({
        status: enumOf("IDLE", "RUNNING", "PAUSED", "COMPLETE"),
        duration_ms: NUMBER,
        remaining_ms: NUMBER
      })
    })
  }),
  defineCore({
    id: "logic.score",
    timerSlotsPerInstance: 0,
    displayName: "Score",
    family: "GAME",
    kind: "LOGIC",
    meaning: "Maintain bounded score state.",
    intentClasses: ["score", "counter", "game"],
    selectionHints: ["Use for a bounded score or counter."],
    execution: "LOCAL_RULE",
    validator: validator({
      props: {
        initial: OPTIONAL_NUMBER_PROP,
        min: OPTIONAL_NUMBER_PROP,
        max: OPTIONAL_NUMBER_PROP
      },
      actions: {
        increment: action({ delta: field(NUMBER, ACTION_ARG_SOURCE_KINDS) }),
        set: action({ value: field(NUMBER, ACTION_ARG_SOURCE_KINDS) }),
        reset: action()
      },
      events: { change: staticEvent({ value: NUMBER }) },
      capability_state: record({ value: NUMBER }),
      invariant_ids: ["SCORE_BOUNDS"]
    })
  }),
  defineCore({
    id: "system.notice",
    timerSlotsPerInstance: 0,
    displayName: "System Notice",
    family: "SYSTEM",
    kind: "VIEW",
    meaning: "Present a human-facing notice or recovery direction.",
    intentClasses: ["notice", "status", "recovery"],
    selectionHints: ["Use for safe consumer-facing status and recovery messages."],
    rejectionHints: ["Do not expose raw internal error details."],
    validator: validator({
      props: { severity: prop(enumOf("INFO", "SUCCESS", "WARNING", "ERROR")) },
      bindings: {
        title: binding(string(120), VIEW_SOURCE_KINDS, { required: false }),
        message: binding(string(1000), VIEW_SOURCE_KINDS),
        action_refs: binding(list(string(64), 16), ["LITERAL"], {
          required: false,
          reference: "ACTION_ID"
        })
      }
    })
  })
];
