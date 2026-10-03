import type { TypeDescriptor } from "../capabilities/schema/validator-contract.js";
import {
  checkActionInvariants,
  referencedIds,
  resolveEventPayload,
  typeContractField,
  type TypedField,
  type TypedNodeFields
} from "./capability-contract.js";
import { RESET_ALL_MUTABLE } from "./blueprint-schema.js";
import { isAssignable } from "./type-descriptor.js";
import { containsSourceKind, inferValueSource, type TypingContext } from "./value-source-typing.js";
import { fail, type ActionStep, type Blueprint, type BlueprintAction, type ValueSource } from "./validation-types.js";
import type { ExpressionTypes } from "./state-rules.js";

export interface TypedNode {
  readonly fields: TypedNodeFields;
  readonly path: string;
  readonly scope: ReadonlyMap<string, TypeDescriptor>;
  readonly hasRepeatAncestor: boolean;
}

interface DispatchSite {
  readonly payload: TypeDescriptor;
  readonly scope: ReadonlyMap<string, TypeDescriptor>;
}

const DISPATCH_KINDS: ReadonlySet<ValueSource["kind"]> = new Set(["EVENT", "SCOPE"]);
const BOOLEAN: TypeDescriptor = { type: "BOOLEAN" };

function actionError(path: string, message: string): never {
  return fail("F02-ERR-010", "V08", path, message);
}

function collectDispatchSites(
  typedNodes: readonly TypedNode[],
  actionIds: ReadonlySet<string>,
  context: TypingContext
): ReadonlyMap<string, DispatchSite[]> {
  const sites = new Map<string, DispatchSite[]>();
  for (const { fields, path, scope } of typedNodes) {
    for (const [eventName, actionId] of Object.entries(fields.node.events)) {
      const eventPath = `${path}.events.${eventName}`;
      if (!actionIds.has(actionId)) {
        actionError(eventPath, "Event references an Action that does not exist.");
      }
      const payload = resolveEventPayload(fields, eventName, eventPath, context);
      const actionSites = sites.get(actionId) ?? [];
      actionSites.push({ payload, scope });
      sites.set(actionId, actionSites);
    }
    for (const [bindingKey, contract] of Object.entries(fields.capability.validator.bindings)) {
      const binding = fields.bindings.get(bindingKey);
      if (contract.reference === "ACTION_ID" && binding !== undefined) {
        if (referencedIds(binding.source).some((id) => !actionIds.has(id))) {
          actionError(`${path}.bindings.${bindingKey}`, "Binding references an Action that does not exist.");
        }
      }
    }
  }
  return sites;
}

function stepSources(step: ActionStep): readonly ValueSource[] {
  switch (step.type) {
    case "SET_STATE":
      return step.when === undefined ? [step.value] : [step.value, step.when];
    case "INVOKE_CAPABILITY": {
      const args = Object.values(step.args);
      return step.when === undefined ? args : [...args, step.when];
    }
    case "RESET_STATE":
      return [];
  }
}

function typeWhen(when: ValueSource | undefined, path: string, context: TypingContext): void {
  if (when !== undefined && !isAssignable(inferValueSource(when, `${path}.when`, context), BOOLEAN)) {
    actionError(`${path}.when`, "when must be assignable to BOOLEAN.");
  }
}

function mutableTarget(target: string, path: string, types: ExpressionTypes): TypeDescriptor {
  const state = types.lookupState(target);
  if (state === undefined || !state.mutable) {
    return actionError(`${path}.target`, "Action target must be an existing MUTABLE state.");
  }
  return state.descriptor;
}

function typeInvoke(
  step: Extract<ActionStep, { type: "INVOKE_CAPABILITY" }>,
  path: string,
  context: TypingContext,
  nodesById: ReadonlyMap<string, TypedNode>
): void {
  const target = nodesById.get(step.target_node_id);
  if (target === undefined) {
    actionError(`${path}.target_node_id`, "INVOKE_CAPABILITY target node does not exist.");
  }
  if (target.hasRepeatAncestor) {
    actionError(`${path}.target_node_id`, "INVOKE_CAPABILITY target must be a singleton node without a repeat ancestor.");
  }
  const actions = target.fields.capability.validator.actions;
  const contract = Object.hasOwn(actions, step.capability_action) ? actions[step.capability_action] : undefined;
  if (contract === undefined) {
    actionError(`${path}.capability_action`, "Capability does not declare this action.");
  }
  const typedArgs = new Map<string, TypedField>();
  for (const [key, source] of Object.entries(step.args)) {
    const argContract = Object.hasOwn(contract.args, key) ? contract.args[key] : undefined;
    if (argContract === undefined) {
      actionError(`${path}.args.${key}`, "Capability action does not declare this argument.");
    }
    typedArgs.set(key, typeContractField(source, argContract, `${path}.args.${key}`, context));
  }
  for (const [key, argContract] of Object.entries(contract.args)) {
    if (argContract.required && !typedArgs.has(key)) {
      actionError(`${path}.args.${key}`, "Capability action argument is required.");
    }
  }
  checkActionInvariants(target.fields, step.capability_action, typedArgs, path, context);
}

function typeStep(
  step: ActionStep,
  path: string,
  context: TypingContext,
  types: ExpressionTypes,
  nodesById: ReadonlyMap<string, TypedNode>
): void {
  switch (step.type) {
    case "SET_STATE": {
      const target = mutableTarget(step.target, path, types);
      if (!isAssignable(inferValueSource(step.value, `${path}.value`, context, target), target)) {
        actionError(`${path}.value`, "SET_STATE value is not assignable to the target state.");
      }
      typeWhen(step.when, path, context);
      return;
    }
    case "INVOKE_CAPABILITY":
      typeInvoke(step, path, context, nodesById);
      typeWhen(step.when, path, context);
      return;
    case "RESET_STATE":
      if (step.target !== RESET_ALL_MUTABLE) {
        mutableTarget(step.target, path, types);
      }
  }
}

function dispatchContexts(
  action: BlueprintAction,
  path: string,
  sites: readonly DispatchSite[],
  base: TypingContext
): readonly TypingContext[] {
  const needsDispatch = action.steps.some((step) =>
    stepSources(step).some((source) => containsSourceKind(source, DISPATCH_KINDS))
  );
  if (!needsDispatch) {
    return [base];
  }
  if (sites.length === 0) {
    actionError(path, "Action using EVENT or SCOPE requires at least one Node.events dispatch site.");
  }
  return sites.map((site) => ({ ...base, event: site.payload, scope: site.scope }));
}

export function validateActions(blueprint: Blueprint, typedNodes: readonly TypedNode[], types: ExpressionTypes): void {
  const base: TypingContext = { errorCode: "F02-ERR-010", stage: "V08", ...types };
  const actionIds = new Set(blueprint.actions.map((action) => action.id));
  const sites = collectDispatchSites(typedNodes, actionIds, base);
  const nodesById = new Map(typedNodes.map((typed) => [typed.fields.node.id, typed] as const));
  blueprint.actions.forEach((action, index) => {
    const path = `$.actions[${index}]`;
    for (const context of dispatchContexts(action, path, sites.get(action.id) ?? [], base)) {
      action.steps.forEach((step, stepIndex) => typeStep(step, `${path}.steps[${stepIndex}]`, context, types, nodesById));
    }
  });
}
