import type { DescriptorType, EnumMember, TypeDescriptor } from "../capabilities/schema/validator-contract.js";
import {
  DescriptorJoinError,
  joinDescriptors,
  resolveDescriptorPath,
  scalarSingletonDescriptor,
  STRING_MAX_LENGTH_CEILING,
  valueConforms,
  isAssignable
} from "./type-descriptor.js";
import { fail, type F02ErrorCode, type ValidationStage, type ValueSource } from "./validation-types.js";

export interface StateTypeBinding {
  readonly descriptor: TypeDescriptor;
  readonly mutable: boolean;
}

export interface TypingContext {
  readonly errorCode: F02ErrorCode;
  readonly stage: ValidationStage;
  readonly lookupState: (key: string) => StateTypeBinding | undefined;
  readonly lookupRule: (ruleId: string) => TypeDescriptor | undefined;
  readonly event?: TypeDescriptor;
  readonly scope?: ReadonlyMap<string, TypeDescriptor>;
}

type OperatorTyping = (
  args: readonly ValueSource[],
  path: string,
  context: TypingContext,
  expected: TypeDescriptor | undefined
) => TypeDescriptor;

const UNBOUNDED_NUMBER: TypeDescriptor = { type: "NUMBER" };
const BOOLEAN: TypeDescriptor = { type: "BOOLEAN" };

function typingError(context: TypingContext, path: string, message: string): never {
  return fail(context.errorCode, context.stage, path, message);
}

function assertArity(
  args: readonly ValueSource[],
  path: string,
  context: TypingContext,
  arity: { readonly min: number; readonly max?: number }
): void {
  if (args.length < arity.min || (arity.max !== undefined && args.length > arity.max)) {
    typingError(context, `${path}.args`, "Operator arity does not match its F03 signature.");
  }
}

function inferArgs(
  args: readonly ValueSource[],
  path: string,
  context: TypingContext,
  expected?: TypeDescriptor
): TypeDescriptor[] {
  return args.map((arg, index) => inferValueSource(arg, `${path}.args[${index}]`, context, expected));
}

function requireTypes(
  descriptors: readonly TypeDescriptor[],
  allowed: readonly DescriptorType[],
  path: string,
  context: TypingContext
): void {
  descriptors.forEach((descriptor, index) => {
    if (!allowed.includes(descriptor.type)) {
      typingError(context, `${path}.args[${index}]`, `Operator argument must be ${allowed.join(" | ")}.`);
    }
  });
}

function numeric(min: number, max?: number): OperatorTyping {
  return (args, path, context) => {
    assertArity(args, path, context, max === undefined ? { min } : { min, max });
    requireTypes(inferArgs(args, path, context), ["NUMBER"], path, context);
    return UNBOUNDED_NUMBER;
  };
}

function boolean(min: number, max?: number): OperatorTyping {
  return (args, path, context) => {
    assertArity(args, path, context, max === undefined ? { min } : { min, max });
    requireTypes(inferArgs(args, path, context), ["BOOLEAN"], path, context);
    return BOOLEAN;
  };
}

function enumPrimitive(descriptor: TypeDescriptor): string | undefined {
  return descriptor.type === "ENUM" ? typeof descriptor.constraints.allowed[0] : undefined;
}

function inferEqualityOperands(args: readonly ValueSource[], path: string, context: TypingContext): TypeDescriptor[] {
  const result: (TypeDescriptor | undefined)[] = args.map((arg, index) =>
    arg.kind === "LITERAL" ? undefined : inferValueSource(arg, `${path}.args[${index}]`, context)
  );
  return args.map((arg, index) => {
    const known = result[index];
    if (known !== undefined) {
      return known;
    }
    const peer = result[1 - index];
    return inferValueSource(arg, `${path}.args[${index}]`, context, peer?.type === "ENUM" ? peer : undefined);
  });
}

const equality: OperatorTyping = (args, path, context) => {
  assertArity(args, path, context, { min: 2, max: 2 });
  const [left, right] = inferEqualityOperands(args, path, context);
  if (left === undefined || right === undefined) {
    return typingError(context, path, "EQ/NEQ requires two operands.");
  }
  requireTypes([left, right], ["NUMBER", "STRING", "BOOLEAN", "ENUM"], path, context);
  if (left.type !== right.type || enumPrimitive(left) !== enumPrimitive(right)) {
    typingError(context, path, "EQ/NEQ operands must share one base type and ENUM member primitive.");
  }
  return BOOLEAN;
};

const ordering: OperatorTyping = (args, path, context) => {
  assertArity(args, path, context, { min: 2, max: 2 });
  const [left, right] = inferArgs(args, path, context);
  if (left === undefined || right === undefined || left.type !== right.type) {
    return typingError(context, path, "Ordering operands must share one base type.");
  }
  requireTypes([left, right], ["NUMBER", "STRING"], path, context);
  return BOOLEAN;
};

function join(descriptors: readonly TypeDescriptor[], path: string, context: TypingContext): TypeDescriptor {
  try {
    return joinDescriptors(descriptors);
  } catch (error: unknown) {
    if (error instanceof DescriptorJoinError) {
      return typingError(context, path, error.message);
    }
    throw error;
  }
}

const conditional: OperatorTyping = (args, path, context, expected) => {
  assertArity(args, path, context, { min: 3, max: 3 });
  const [condition, whenTrue, whenFalse] = args as readonly [ValueSource, ValueSource, ValueSource];
  requireTypes([inferValueSource(condition, `${path}.args[0]`, context)], ["BOOLEAN"], path, context);
  return join(
    [
      inferValueSource(whenTrue, `${path}.args[1]`, context, expected),
      inferValueSource(whenFalse, `${path}.args[2]`, context, expected)
    ],
    path,
    context
  );
};

const coalesce: OperatorTyping = (args, path, context, expected) => {
  assertArity(args, path, context, { min: 2 });
  return join(inferArgs(args, path, context, expected), path, context);
};

function listAggregate(requireNumberItems: boolean, allowString: boolean): OperatorTyping {
  return (args, path, context) => {
    assertArity(args, path, context, { min: 1, max: 1 });
    const [operand] = inferArgs(args, path, context);
    const valid =
      (operand?.type === "LIST" && (!requireNumberItems || operand.constraints.item.type === "NUMBER")) ||
      (allowString && operand?.type === "STRING");
    if (!valid) {
      typingError(context, `${path}.args[0]`, "Aggregate operand does not match its F03 signature.");
    }
    return UNBOUNDED_NUMBER;
  };
}

const concat: OperatorTyping = (args, path, context) => {
  assertArity(args, path, context, { min: 2 });
  const operands = inferArgs(args, path, context);
  requireTypes(operands, ["STRING"], path, context);
  const maxLength = operands.reduce(
    (total, operand) => total + (operand.type === "STRING" ? operand.constraints.max_length : 0),
    0
  );
  if (maxLength > STRING_MAX_LENGTH_CEILING) {
    typingError(context, path, "CONCAT result max_length exceeds 8192.");
  }
  return { type: "STRING", constraints: { max_length: maxLength } };
};

const stringTransform: OperatorTyping = (args, path, context) => {
  assertArity(args, path, context, { min: 1, max: 1 });
  const [operand] = inferArgs(args, path, context);
  if (operand?.type !== "STRING") {
    return typingError(context, `${path}.args[0]`, "String operator requires a STRING operand.");
  }
  return operand;
};

/** Type-checked bounded local list edits; the target descriptor enforces the final length and item type. */
const listEdit = (mode: "APPEND" | "REMOVE_AT" | "REPLACE_AT"): OperatorTyping =>
  (args, path, context) => {
    const count = mode === "REPLACE_AT" ? 3 : 2;
    assertArity(args, path, context, { min: count, max: count });
    const source = args[0];
    if (source === undefined) return typingError(context, path, "Missing LIST operand.");
    const list = inferValueSource(source, `${path}.args[0]`, context);
    if (list.type !== "LIST") return typingError(context, `${path}.args[0]`, "LIST edit requires LIST.");
    if (mode !== "APPEND") {
      const index = args[1];
      if (index === undefined) return typingError(context, path, "Missing LIST index.");
      requireTypes([inferValueSource(index, `${path}.args[1]`, context)], ["NUMBER"], path, context);
    }
    if (mode !== "REMOVE_AT") {
      const itemIndex = mode === "APPEND" ? 1 : 2;
      const item = args[itemIndex];
      if (item === undefined) return typingError(context, path, "Missing LIST item.");
      const typed = inferValueSource(item, `${path}.args[${itemIndex}]`, context, list.constraints.item);
      if (!isAssignable(typed, list.constraints.item)) {
        return typingError(context, `${path}.args[${itemIndex}]`, "LIST item is not assignable.");
      }
    }
    return list;
  };

/** Typecheck a declared RECORD field edit; no dynamic field names or schema expansion. */
const recordSet: OperatorTyping = (args, path, context) => {
  assertArity(args, path, context, { min: 3, max: 3 });
  const recordSource = args[0];
  if (recordSource === undefined) return typingError(context, path, "Missing RECORD operand.");
  const record = inferValueSource(recordSource, `${path}.args[0]`, context);
  if (record.type !== "RECORD") return typingError(context, path, "RECORD_SET requires RECORD.");
  const key = args[1];
  if (key?.kind !== "LITERAL" || typeof key.value !== "string") {
    return typingError(context, `${path}.args[1]`, "RECORD_SET field must be a static STRING.");
  }
  const field = record.constraints.fields[key.value];
  if (field === undefined) return typingError(context, `${path}.args[1]`, "RECORD_SET field is undeclared.");
  const replacement = args[2];
  if (replacement === undefined) return typingError(context, path, "Missing replacement.");
  const typed = inferValueSource(replacement, `${path}.args[2]`, context, field);
  if (!isAssignable(typed, field)) {
    return typingError(context, `${path}.args[2]`, "RECORD_SET field type mismatch.");
  }
  return record;
};

/** Filter a bounded LIST of RECORDs by equality on a declared scalar field. */
const filterListEq: OperatorTyping = (args, path, context) => {
  assertArity(args, path, context, { min: 3, max: 3 });
  const source = args[0];
  if (source === undefined) return typingError(context, path, "Missing LIST operand.");
  const list = inferValueSource(source, `${path}.args[0]`, context);
  if (list.type !== "LIST" || list.constraints.item.type !== "RECORD") {
    return typingError(context, `${path}.args[0]`, "LIST_FILTER_EQ requires LIST of RECORD.");
  }
  const key = args[1];
  if (key?.kind !== "LITERAL" || typeof key.value !== "string") {
    return typingError(context, `${path}.args[1]`, "LIST_FILTER_EQ requires a static field.");
  }
  const field = list.constraints.item.constraints.fields[key.value];
  if (field === undefined || !["STRING", "NUMBER", "BOOLEAN", "ENUM"].includes(field.type)) {
    return typingError(context, `${path}.args[1]`, "LIST_FILTER_EQ requires a declared scalar field.");
  }
  const needle = args[2];
  if (needle === undefined) return typingError(context, path, "Missing comparison.");
  const typed = inferValueSource(needle, `${path}.args[2]`, context, field);
  if (!isAssignable(typed, field)) {
    return typingError(context, `${path}.args[2]`, "LIST_FILTER_EQ comparison type mismatch.");
  }
  return list;
};

/** Verified dynamic total for expense lists, without arbitrary field access or executable code. */
const listSumBy: OperatorTyping = (args, path, context) => {
  assertArity(args, path, context, { min: 2, max: 2 });
  const source = args[0];
  if (source === undefined) return typingError(context, path, "Missing expense LIST.");
  const list = inferValueSource(source, `${path}.args[0]`, context);
  if (list.type !== "LIST" || list.constraints.item.type !== "RECORD") {
    return typingError(context, `${path}.args[0]`, "LIST_SUM_BY requires LIST of RECORD.");
  }
  const key = args[1];
  if (key?.kind !== "LITERAL" || typeof key.value !== "string") {
    return typingError(context, `${path}.args[1]`, "LIST_SUM_BY requires a static numeric field.");
  }
  const field = list.constraints.item.constraints.fields[key.value];
  if (field?.type !== "NUMBER") {
    return typingError(context, `${path}.args[1]`, "LIST_SUM_BY field must be declared NUMBER.");
  }
  return UNBOUNDED_NUMBER;
};

const OPERATORS: Readonly<Record<string, OperatorTyping>> = {
  ADD: numeric(2),
  SUB: numeric(2, 2),
  MUL: numeric(2),
  DIV: numeric(2, 2),
  MOD: numeric(2, 2),
  ABS: numeric(1, 1),
  ROUND: numeric(1, 1),
  FLOOR: numeric(1, 1),
  CEIL: numeric(1, 1),
  MIN: numeric(1),
  MAX: numeric(1),
  EQ: equality,
  NEQ: equality,
  GT: ordering,
  GTE: ordering,
  LT: ordering,
  LTE: ordering,
  AND: boolean(2),
  OR: boolean(2),
  NOT: boolean(1, 1),
  IF: conditional,
  COALESCE: coalesce,
  LENGTH: listAggregate(false, true),
  COUNT: listAggregate(false, false),
  SUM: listAggregate(true, false),
  AVG: listAggregate(true, false),
  LIST_MIN: listAggregate(true, false),
  LIST_MAX: listAggregate(true, false),
  CONCAT: concat,
  LOWER: stringTransform,
  UPPER: stringTransform,
  TRIM: stringTransform,
  LIST_APPEND: listEdit("APPEND"),
  LIST_REMOVE_AT: listEdit("REMOVE_AT"),
  LIST_REPLACE_AT: listEdit("REPLACE_AT"),
  RECORD_SET: recordSet,
  LIST_FILTER_EQ: filterListEq,
  LIST_SUM_BY: listSumBy,
  /** F03 trusted device-local date, captured once per transaction. */
  LOCAL_DAY: (args, path, context) => {
    assertArity(args, path, context, { min: 0, max: 0 });
    return { type: "STRING", constraints: { max_length: 10 } };
  }
};

function inferLiteral(
  value: unknown,
  path: string,
  context: TypingContext,
  expected: TypeDescriptor | undefined
): TypeDescriptor {
  if (expected !== undefined) {
    if (!valueConforms(value, expected)) {
      typingError(context, `${path}.value`, "LITERAL does not conform to the expected TypeDescriptor.");
    }
    if (expected.type === "ENUM") {
      return { type: "ENUM", constraints: { allowed: [value as EnumMember] } };
    }
    return scalarSingletonDescriptor(value) ?? expected;
  }
  const singleton = scalarSingletonDescriptor(value);
  if (singleton === undefined) {
    return typingError(context, `${path}.value`, "Composite LITERAL requires an explicit expected TypeDescriptor.");
  }
  return singleton;
}

function resolveRoot(
  root: TypeDescriptor | undefined,
  valuePath: string,
  path: string,
  context: TypingContext
): TypeDescriptor {
  const resolved = root === undefined ? undefined : resolveDescriptorPath(root, valuePath);
  if (resolved === undefined) {
    return typingError(context, `${path}.path`, "Path does not resolve to a declared field.");
  }
  return resolved;
}

export function inferValueSource(
  source: ValueSource,
  path: string,
  context: TypingContext,
  expected?: TypeDescriptor
): TypeDescriptor {
  switch (source.kind) {
    case "LITERAL":
      return inferLiteral(source.value, path, context, expected);
    case "STATE": {
      const state = context.lookupState(source.key);
      return state?.descriptor ?? typingError(context, `${path}.key`, "STATE reference does not exist.");
    }
    case "RULE":
      return context.lookupRule(source.rule_id) ?? typingError(context, `${path}.rule_id`, "RULE reference does not exist.");
    case "EVENT":
      if (context.event === undefined) {
        return typingError(context, path, "EVENT is only allowed in an admitted Action dispatch context.");
      }
      return resolveRoot(context.event, source.path, path, context);
    case "SCOPE":
      if (context.scope === undefined) {
        return typingError(context, path, "SCOPE is not allowed in this context.");
      }
      return resolveRoot(context.scope.get(source.name), source.path, path, context);
    case "OP": {
      const typing = Object.hasOwn(OPERATORS, source.op) ? OPERATORS[source.op] : undefined;
      if (typing === undefined) {
        return typingError(context, `${path}.op`, "Operator is not allowlisted.");
      }
      return typing(source.args, path, context, expected);
    }
  }
}

export function containsSourceKind(source: ValueSource, kinds: ReadonlySet<ValueSource["kind"]>): boolean {
  const pending: ValueSource[] = [source];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    if (kinds.has(current.kind)) {
      return true;
    }
    if (current.kind === "OP") {
      for (const arg of current.args) {
        pending.push(arg);
      }
    }
  }
  return false;
}

export function collectReferences(source: ValueSource): { readonly states: string[]; readonly rules: string[] } {
  const states: string[] = [];
  const rules: string[] = [];
  const pending: ValueSource[] = [source];
  for (let current = pending.pop(); current !== undefined; current = pending.pop()) {
    if (current.kind === "STATE") {
      states.push(current.key);
    } else if (current.kind === "RULE") {
      rules.push(current.rule_id);
    } else if (current.kind === "OP") {
      for (const arg of current.args) {
        pending.push(arg);
      }
    }
  }
  return { states, rules };
}
