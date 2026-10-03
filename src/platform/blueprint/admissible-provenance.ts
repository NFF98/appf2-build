import type { AdmissibleBlueprint, BlueprintValidationResult, ValidationReport } from "./validation-types.js";

export type PassedValidationResult = Extract<BlueprintValidationResult, { readonly admissible: AdmissibleBlueprint }>;

const issuedReports = new WeakMap<AdmissibleBlueprint, ValidationReport>();

/** Only results sealed by the F02 pipeline may cross into durable blueprint_content admission. */
export function sealPassedResult(result: PassedValidationResult): PassedValidationResult {
  const report = Object.freeze({ ...result.report });
  const admissible = Object.freeze({ ...result.admissible });
  issuedReports.set(admissible, report);
  return Object.freeze({ report, admissible });
}

export function isSealedPassedResult(report: ValidationReport, admissible: AdmissibleBlueprint): boolean {
  return issuedReports.get(admissible) === report;
}
