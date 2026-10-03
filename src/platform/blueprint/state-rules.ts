import type { TypeDescriptor } from "../capabilities/schema/validator-contract.js";
import { hasReservedPrefix } from "./blueprint-schema.js";
import {
  BLUEPRINT_STACK_DEPTH_GUARD,
  parseTypeDescriptor,
  TypeDescriptorError,
  valueConforms
} from "./type-descriptor.js";
import {
  collectReferences,
  inferValueSource,
  type StateTypeBinding,
  type TypingContext
} from "./value-source-typing.js";
import { fail, type Blueprint, type JsonValue, type MutableStateEntry } from "./validation-types.js";

const STATE_VERTEX = "state:";
const RULE_VERTEX = "rule:";

export interface StateAnalysis {
  readonly mutable: ReadonlyMap<string, TypeDescriptor>;
  readonly components: readonly (readonly string[])[];
  readonly selfReferencing: ReadonlySet<string>;
}

export interface ExpressionTypes {
  readonly lookupState: (key: string) => StateTypeBinding | undefined;
  readonly lookupRule: (ruleId: string) => TypeDescriptor | undefined;
}

function stateError(path: string, message: string): never {
  return fail("F02-ERR-006", "V05", path, message);
}

function parseMutableDescriptor(key: string, entry: MutableStateEntry): TypeDescriptor {
  const path = `$.state.${key}`;
  const raw: Record<string, JsonValue> = { type: entry.type };
  if (entry.constraints !== undefined) {
    raw.constraints = entry.constraints;
  }
  try {
    return parseTypeDescriptor(raw, path, { allowOptionalFields: false, depthGuard: BLUEPRINT_STACK_DEPTH_GUARD });
  } catch (error: unknown) {
    if (error instanceof TypeDescriptorError) {
      if (error.kind === "DEPTH_GUARD") {
        return fail("F02-ERR-011", "V09", error.path, error.message);
      }
      return stateError(error.path, error.message);
    }
    throw error;
  }
}

function dependencyGraph(blueprint: Blueprint): Map<string, string[]> {
  const derivedKeys = new Set(
    Object.keys(blueprint.state).filter((key) => blueprint.state[key]?.mode === "DERIVED")
  );
  const ruleIds = new Set(blueprint.rules.map((rule) => rule.id));
  const edges = new Map<string, string[]>();
  const addVertex = (vertex: string, references: ReturnType<typeof collectReferences>): void => {
    edges.set(vertex, [
      ...references.states.filter((key) => derivedKeys.has(key)).map((key) => STATE_VERTEX + key),
      ...references.rules.filter((id) => ruleIds.has(id)).map((id) => RULE_VERTEX + id)
    ]);
  };
  for (const key of derivedKeys) {
    const entry = blueprint.state[key];
    if (entry?.mode === "DERIVED") {
      addVertex(STATE_VERTEX + key, collectReferences(entry.expr));
    }
  }
  for (const rule of blueprint.rules) {
    addVertex(RULE_VERTEX + rule.id, collectReferences(rule.expr));
  }
  return edges;
}

interface TarjanFrame {
  readonly vertex: string;
  next: number;
}

class TarjanState {
  public readonly components: string[][] = [];
  private counter = 0;
  private readonly indices = new Map<string, number>();
  private readonly lowLinks = new Map<string, number>();
  private readonly stack: string[] = [];
  private readonly onStack = new Set<string>();

  public constructor(private readonly edges: ReadonlyMap<string, readonly string[]>) {}

  public visit(start: string): void {
    if (this.indices.has(start)) {
      return;
    }
    const work: TarjanFrame[] = [this.open(start)];
    for (let frame = work.at(-1); frame !== undefined; frame = work.at(-1)) {
      const successors = this.edges.get(frame.vertex) ?? [];
      const successor = successors[frame.next];
      if (successor !== undefined) {
        frame.next += 1;
        if (!this.indices.has(successor)) {
          work.push(this.open(successor));
        } else if (this.onStack.has(successor)) {
          this.lower(frame.vertex, this.indices.get(successor) as number);
        }
        continue;
      }
      work.pop();
      const parent = work.at(-1);
      if (parent !== undefined) {
        this.lower(parent.vertex, this.lowLinks.get(frame.vertex) as number);
      }
      if (this.lowLinks.get(frame.vertex) === this.indices.get(frame.vertex)) {
        this.close(frame.vertex);
      }
    }
  }

  private open(vertex: string): TarjanFrame {
    this.indices.set(vertex, this.counter);
    this.lowLinks.set(vertex, this.counter);
    this.counter += 1;
    this.stack.push(vertex);
    this.onStack.add(vertex);
    return { vertex, next: 0 };
  }

  private lower(vertex: string, candidate: number): void {
    this.lowLinks.set(vertex, Math.min(this.lowLinks.get(vertex) as number, candidate));
  }

  private close(root: string): void {
    const component: string[] = [];
    for (let member = this.stack.pop(); member !== undefined; member = this.stack.pop()) {
      this.onStack.delete(member);
      component.push(member);
      if (member === root) {
        break;
      }
    }
    this.components.push(component);
  }
}

function isCyclic(component: readonly string[], selfReferencing: ReadonlySet<string>): boolean {
  return component.length > 1 || selfReferencing.has(component[0] as string);
}

export function validateStates(blueprint: Blueprint): StateAnalysis {
  const mutable = new Map<string, TypeDescriptor>();
  for (const key of Object.keys(blueprint.state)) {
    const entry = blueprint.state[key];
    if (hasReservedPrefix(key)) {
      stateError(`$.state.${key}`, "State key uses a platform-reserved prefix.");
    }
    if (entry?.mode === "MUTABLE") {
      const descriptor = parseMutableDescriptor(key, entry);
      if (!valueConforms(entry.initial, descriptor)) {
        stateError(`$.state.${key}.initial`, "Initial value does not conform to the declared TypeDescriptor.");
      }
      mutable.set(key, descriptor);
    }
  }
  const edges = dependencyGraph(blueprint);
  const selfReferencing = new Set([...edges].filter(([vertex, targets]) => targets.includes(vertex)).map(([vertex]) => vertex));
  const tarjan = new TarjanState(edges);
  for (const vertex of edges.keys()) {
    tarjan.visit(vertex);
  }
  for (const component of tarjan.components) {
    const derived = component.find((vertex) => vertex.startsWith(STATE_VERTEX));
    if (derived !== undefined && isCyclic(component, selfReferencing)) {
      stateError(`$.state.${derived.slice(STATE_VERTEX.length)}.expr`, "Derived state dependency graph contains a cycle.");
    }
  }
  return { mutable, components: tarjan.components, selfReferencing };
}

export function inferExpressionTypes(blueprint: Blueprint, analysis: StateAnalysis): ExpressionTypes {
  const derived = new Map<string, TypeDescriptor>();
  const rules = new Map<string, TypeDescriptor>();
  const ruleIndex = new Map(blueprint.rules.map((rule, index) => [rule.id, index] as const));
  const types: ExpressionTypes = {
    lookupState: (key) => {
      const mutable = analysis.mutable.get(key);
      if (mutable !== undefined) {
        return { descriptor: mutable, mutable: true };
      }
      const inferred = derived.get(key);
      return inferred === undefined ? undefined : { descriptor: inferred, mutable: false };
    },
    lookupRule: (ruleId) => rules.get(ruleId)
  };
  const context: TypingContext = { errorCode: "F02-ERR-009", stage: "V07", ...types };
  for (const component of analysis.components) {
    const [vertex] = component;
    if (vertex === undefined) {
      continue;
    }
    if (isCyclic(component, analysis.selfReferencing)) {
      const index = ruleIndex.get(vertex.slice(RULE_VERTEX.length)) ?? 0;
      fail("F02-ERR-009", "V07", `$.rules[${index}].expr`, "Rule dependency graph contains a cycle.");
    }
    if (vertex.startsWith(STATE_VERTEX)) {
      const key = vertex.slice(STATE_VERTEX.length);
      const entry = blueprint.state[key];
      if (entry?.mode === "DERIVED") {
        const path = `$.state.${key}`;
        const descriptor = inferValueSource(entry.expr, `${path}.expr`, context);
        if (descriptor.type !== entry.type) {
          fail("F02-ERR-009", "V07", `${path}.type`, "Derived declared type does not match the inferred type.");
        }
        derived.set(key, descriptor);
      }
      continue;
    }
    const ruleId = vertex.slice(RULE_VERTEX.length);
    const index = ruleIndex.get(ruleId) as number;
    const rule = blueprint.rules[index];
    if (rule !== undefined) {
      const descriptor = inferValueSource(rule.expr, `$.rules[${index}].expr`, context);
      if (descriptor.type !== rule.result_type) {
        fail("F02-ERR-009", "V07", `$.rules[${index}].result_type`, "Rule result_type does not match the inferred type.");
      }
      rules.set(ruleId, descriptor);
    }
  }
  return types;
}
