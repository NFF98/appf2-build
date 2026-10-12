import type { ResultOutput } from "../blueprint/validation-types.js";
import { RuntimeFailure, type F03ErrorCode } from "./runtime-errors.js";
import type { RuntimeInstance } from "./runtime-instance.js";
import type { RuntimeValue } from "./runtime-value.js";

export type ResultSensitivity = ResultOutput["sensitivity"];

interface EvaluatedOutputBase {
  readonly id: string;
  readonly label: string;
  readonly sensitivity: ResultSensitivity;
}

/** F03 §28 output: AVAILABLE carries the resolved typed value; ERROR carries no value at all (no fake default). */
export type EvaluatedResultOutput =
  | (EvaluatedOutputBase & { readonly status: "AVAILABLE"; readonly value: RuntimeValue })
  | (EvaluatedOutputBase & { readonly status: "ERROR"; readonly error_code: F03ErrorCode });

export interface ResultEvaluation {
  readonly action_sequence: number;
  readonly outputs: readonly EvaluatedResultOutput[];
}

/**
 * F03 §28 evaluateResult(): every admitted `result.outputs` entry is evaluated against committed Runtime state only.
 * Returns undefined while the Instance is not READY, so a partial / hydrating / fatal Instance never yields a Result.
 */
export function evaluateResult(runtime: RuntimeInstance): ResultEvaluation | undefined {
  const blueprint = runtime.blueprint;
  if (blueprint === undefined || runtime.status !== "READY") {
    return undefined;
  }
  const outputs = blueprint.result.outputs.map((output): EvaluatedResultOutput => {
    const base = { id: output.id, label: output.label, sensitivity: output.sensitivity };
    try {
      return { ...base, status: "AVAILABLE", value: runtime.evaluateValue(output.value) };
    } catch (error: unknown) {
      if (!(error instanceof RuntimeFailure)) {
        throw error;
      }
      return { ...base, status: "ERROR", error_code: error.code };
    }
  });
  return { action_sequence: runtime.actionSequence, outputs };
}

/** F03 §29 persistence eligibility that F16 policy consumes; F03 itself never persists a Result. */
export type ResultDurability = "DURABLE_ELIGIBLE" | "NOT_DURABLE_UNLESS_EXPLICIT_POLICY" | "NEVER_DURABLE";

const DURABILITY: Readonly<Record<ResultSensitivity, ResultDurability>> = {
  NORMAL: "DURABLE_ELIGIBLE",
  SENSITIVE: "NOT_DURABLE_UNLESS_EXPLICIT_POLICY",
  DO_NOT_PERSIST: "NEVER_DURABLE"
};

export function resultDurability(sensitivity: ResultSensitivity): ResultDurability {
  return DURABILITY[sensitivity];
}
