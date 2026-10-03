import type { AdmissibleBlueprint, BlueprintValidationResult, ValidationReport } from "./validation-types.js";

export type PassedValidationResult = Extract<BlueprintValidationResult, { readonly admissible: AdmissibleBlueprint }>;

const issuedReports = new WeakMap<AdmissibleBlueprint, ValidationReport>();

function deepFreeze<T extends object>(root: T): T {
  const visited = new WeakSet<object>();
  const pending: unknown[] = [root];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current !== "object" || current === null || visited.has(current)) {
      continue;
    }
    visited.add(current);
    Object.freeze(current);
    for (const child of Object.values(current)) {
      pending.push(child);
    }
  }
  return root;
}

/**
 * Only results sealed by the F02 pipeline may cross into durable blueprint_content admission.
 * The whole issued snapshot is deep-frozen so no durable admission input can drift from what was validated.
 */
export function sealPassedResult(result: PassedValidationResult): PassedValidationResult {
  const report = deepFreeze({ ...result.report });
  const admissible = deepFreeze({ ...result.admissible });
  issuedReports.set(admissible, report);
  return Object.freeze({ report, admissible });
}

export function isSealedPassedResult(report: ValidationReport, admissible: AdmissibleBlueprint): boolean {
  return issuedReports.get(admissible) === report;
}
