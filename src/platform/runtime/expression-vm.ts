import { codePointLength, compareCodePoints, STRING_MAX_LENGTH_CEILING } from "../blueprint/type-descriptor.js";
import type { ValueSource } from "../blueprint/validation-types.js";
import { invariantBroken, runtimeFail } from "./runtime-errors.js";
import { ABSENT, admittedRuntimeValue, isRuntimeRecord, type EvaluatedValue, type RuntimeValue } from "./runtime-value.js";

/**
 * Read-only inputs of one pure evaluation. No clock, RNG, storage, network or DOM is reachable (F03-RQ-005).
 * `event` / `scope` exist only inside an admitted dispatch-site envelope (F03 §14 BF-036).
 */
export interface EvaluationEnv {
  readonly readState: (key: string) => RuntimeValue;
  readonly readRule: (ruleId: string) => RuntimeValue;
  readonly event?: RuntimeValue;
  readonly scope?: ReadonlyMap<string, RuntimeValue>;
}

type Evaluate = (source: ValueSource) => EvaluatedValue;
type Operator = (args: readonly ValueSource[], evaluate: Evaluate) => EvaluatedValue;

function operandFailure(message: string): never {
  return runtimeFail("F03-ERR-005", message);
}

function present(value: EvaluatedValue): RuntimeValue {
  return value === ABSENT ? operandFailure("ABSENT reached a typed operand without COALESCE.") : value;
}

function arity(args: readonly ValueSource[], min: number, max = Number.POSITIVE_INFINITY): void {
  if (args.length < min || args.length > max) {
    operandFailure("Operator arity does not match its F03 signature.");
  }
}

function asNumber(value: EvaluatedValue): number {
  const resolved = present(value);
  return typeof resolved === "number" ? resolved : operandFailure("Operator operand must be NUMBER.");
}

function asBoolean(value: EvaluatedValue): boolean {
  const resolved = present(value);
  return typeof resolved === "boolean" ? resolved : operandFailure("Operator operand must be BOOLEAN.");
}

function asString(value: EvaluatedValue): string {
  const resolved = present(value);
  return typeof resolved === "string" ? resolved : operandFailure("Operator operand must be STRING.");
}

function asList(value: EvaluatedValue): readonly RuntimeValue[] {
  const resolved = present(value);
  return Array.isArray(resolved) ? resolved : operandFailure("Operator operand must be LIST.");
}

function finite(result: number): number {
  return Number.isFinite(result) ? result : runtimeFail("F03-ERR-009", "Expression produced a non-finite NUMBER.");
}

function boundedString(result: string): string {
  return codePointLength(result) <= STRING_MAX_LENGTH_CEILING
    ? result
    : operandFailure("STRING result exceeds the platform length bound.");
}

function numbers(args: readonly ValueSource[], evaluate: Evaluate, min: number, max?: number): number[] {
  arity(args, min, max);
  return args.map((arg) => asNumber(evaluate(arg)));
}

function nonZeroDenominator(denominator: number): number {
  return denominator === 0 ? runtimeFail("F03-ERR-008", "DIV / MOD denominator is 0.") : denominator;
}

/**
 * The locked contract fixes MOD only as NUMBER×NUMBER→NUMBER with a zero-denominator error; it does not choose
 * truncated vs floored remainder sign. Both conventions agree whenever the remainder is 0 or the operands share
 * a sign, so only that domain is evaluated; the undecided domain fails closed instead of guessing a value.
 */
function remainder(dividend: number, divisor: number): number {
  const truncated = dividend % nonZeroDenominator(divisor);
  if (truncated !== 0 && Math.sign(dividend) !== Math.sign(divisor)) {
    return operandFailure("MOD remainder sign for mixed-sign operands is not locked by the F03 contract.");
  }
  return truncated;
}

function primitiveOperand(value: EvaluatedValue): string | number | boolean {
  const resolved = present(value);
  if (typeof resolved === "string" || typeof resolved === "number" || typeof resolved === "boolean") {
    return resolved;
  }
  return operandFailure("EQ/NEQ operands must be NUMBER, STRING, BOOLEAN or ENUM.");
}

function equal(args: readonly ValueSource[], evaluate: Evaluate): boolean {
  arity(args, 2, 2);
  const [left, right] = args.map((arg) => primitiveOperand(evaluate(arg))) as [string | number | boolean, string | number | boolean];
  if (typeof left !== typeof right) {
    return operandFailure("EQ/NEQ operands must share one base type.");
  }
  return left === right;
}

function order(args: readonly ValueSource[], evaluate: Evaluate): number {
  arity(args, 2, 2);
  const [left, right] = args.map((arg) => present(evaluate(arg))) as [RuntimeValue, RuntimeValue];
  if (typeof left === "number" && typeof right === "number") {
    return left - right;
  }
  if (typeof left === "string" && typeof right === "string") {
    return compareCodePoints(left, right);
  }
  return operandFailure("Ordering operands must both be NUMBER or both be STRING.");
}

function shortCircuit(stopOn: boolean): Operator {
  return (args, evaluate) => {
    arity(args, 2);
    for (const arg of args) {
      if (asBoolean(evaluate(arg)) === stopOn) {
        return stopOn;
      }
    }
    return !stopOn;
  };
}

function numberList(args: readonly ValueSource[], evaluate: Evaluate): number[] {
  arity(args, 1, 1);
  return asList(evaluate(args[0] as ValueSource)).map((item) => asNumber(item));
}

function nonEmpty(items: readonly number[], operator: string): readonly number[] {
  return items.length === 0 ? operandFailure(`${operator} of an empty LIST is an evaluation error.`) : items;
}

function stringTransform(transform: (value: string) => string): Operator {
  return (args, evaluate) => {
    arity(args, 1, 1);
    return boundedString(transform(asString(evaluate(args[0] as ValueSource))));
  };
}

const OPERATORS: Readonly<Record<string, Operator>> = {
  ADD: (args, evaluate) => finite(numbers(args, evaluate, 2).reduce((sum, value) => sum + value, 0)),
  SUB: (args, evaluate) => {
    const [left, right] = numbers(args, evaluate, 2, 2) as [number, number];
    return finite(left - right);
  },
  MUL: (args, evaluate) => finite(numbers(args, evaluate, 2).reduce((product, value) => product * value, 1)),
  DIV: (args, evaluate) => {
    const [left, right] = numbers(args, evaluate, 2, 2) as [number, number];
    return finite(left / nonZeroDenominator(right));
  },
  MOD: (args, evaluate) => {
    const [left, right] = numbers(args, evaluate, 2, 2) as [number, number];
    return finite(remainder(left, right));
  },
  ABS: (args, evaluate) => finite(Math.abs(numbers(args, evaluate, 1, 1)[0] as number)),
  /** appf2 ROUND v1: nearest integer, exact .5 tie toward +infinity (ECMAScript Math.round semantics). */
  ROUND: (args, evaluate) => finite(Math.round(numbers(args, evaluate, 1, 1)[0] as number)),
  FLOOR: (args, evaluate) => finite(Math.floor(numbers(args, evaluate, 1, 1)[0] as number)),
  CEIL: (args, evaluate) => finite(Math.ceil(numbers(args, evaluate, 1, 1)[0] as number)),
  MIN: (args, evaluate) => finite(Math.min(...numbers(args, evaluate, 1))),
  MAX: (args, evaluate) => finite(Math.max(...numbers(args, evaluate, 1))),
  EQ: (args, evaluate) => equal(args, evaluate),
  NEQ: (args, evaluate) => !equal(args, evaluate),
  GT: (args, evaluate) => order(args, evaluate) > 0,
  GTE: (args, evaluate) => order(args, evaluate) >= 0,
  LT: (args, evaluate) => order(args, evaluate) < 0,
  LTE: (args, evaluate) => order(args, evaluate) <= 0,
  AND: shortCircuit(false),
  OR: shortCircuit(true),
  NOT: (args, evaluate) => {
    arity(args, 1, 1);
    return !asBoolean(evaluate(args[0] as ValueSource));
  },
  IF: (args, evaluate) => {
    arity(args, 3, 3);
    return evaluate((asBoolean(evaluate(args[0] as ValueSource)) ? args[1] : args[2]) as ValueSource);
  },
  /** COALESCE is not in the F03 short-circuit list, so every branch is evaluated and its failure propagates. */
  COALESCE: (args, evaluate) => {
    arity(args, 2);
    const values = args.map((arg) => evaluate(arg));
    const first = values.find((value) => value !== ABSENT);
    return first === undefined ? operandFailure("COALESCE received only ABSENT operands.") : first;
  },
  LENGTH: (args, evaluate) => {
    arity(args, 1, 1);
    const operand = present(evaluate(args[0] as ValueSource));
    if (typeof operand === "string") {
      return codePointLength(operand);
    }
    return Array.isArray(operand) ? operand.length : operandFailure("LENGTH operand must be STRING or LIST.");
  },
  COUNT: (args, evaluate) => {
    arity(args, 1, 1);
    return asList(evaluate(args[0] as ValueSource)).length;
  },
  SUM: (args, evaluate) => finite(numberList(args, evaluate).reduce((sum, value) => sum + value, 0)),
  AVG: (args, evaluate) => {
    const items = nonEmpty(numberList(args, evaluate), "AVG");
    return finite(items.reduce((sum, value) => sum + value, 0) / items.length);
  },
  LIST_MIN: (args, evaluate) => finite(Math.min(...nonEmpty(numberList(args, evaluate), "LIST_MIN"))),
  LIST_MAX: (args, evaluate) => finite(Math.max(...nonEmpty(numberList(args, evaluate), "LIST_MAX"))),
  CONCAT: (args, evaluate) => {
    arity(args, 2);
    return boundedString(args.map((arg) => asString(evaluate(arg))).join(""));
  },
  LOWER: stringTransform((value) => value.toLowerCase()),
  UPPER: stringTransform((value) => value.toUpperCase()),
  TRIM: stringTransform((value) => value.trim())
};

function resolvePath(root: RuntimeValue, path: string): RuntimeValue | undefined {
  if (path === "") {
    return root;
  }
  let current: RuntimeValue | undefined = root;
  for (const segment of path.split(".")) {
    current = isRuntimeRecord(current) && Object.hasOwn(current, segment) ? current[segment] : undefined;
  }
  return current;
}

function evaluateEvent(path: string, env: EvaluationEnv): RuntimeValue {
  if (env.event === undefined) {
    return invariantBroken("EVENT evaluated outside an admitted dispatch-site envelope.");
  }
  return resolvePath(env.event, path) ?? operandFailure("EVENT path does not resolve in the event payload.");
}

function evaluateScope(name: string, path: string, env: EvaluationEnv): RuntimeValue {
  const root = env.scope?.get(name);
  const resolved = root === undefined ? undefined : resolvePath(root, path);
  return resolved ?? invariantBroken("SCOPE alias or path is missing from the admitted lexical scope bindings.");
}

/** Pure typed evaluation of one admitted Value Source; failures are typed RuntimeFailure, never fallback values. */
export function evaluateValueSource(source: ValueSource, env: EvaluationEnv): EvaluatedValue {
  const evaluate: Evaluate = (child) => evaluateValueSource(child, env);
  switch (source.kind) {
    case "LITERAL":
      return admittedRuntimeValue(source.value);
    case "STATE":
      return env.readState(source.key);
    case "RULE":
      return env.readRule(source.rule_id);
    case "EVENT":
      return evaluateEvent(source.path, env);
    case "SCOPE":
      return evaluateScope(source.name, source.path, env);
    case "OP": {
      const operator = Object.hasOwn(OPERATORS, source.op) ? OPERATORS[source.op] : undefined;
      return operator === undefined ? invariantBroken(`Operator ${source.op} is not allowlisted.`) : operator(source.args, evaluate);
    }
  }
}

/** Evaluation whose result flows into a typed target; ABSENT is a RuntimeError there (F03 §10). */
export function evaluateTyped(source: ValueSource, env: EvaluationEnv): RuntimeValue {
  return present(evaluateValueSource(source, env));
}
