import type { F02ErrorCode } from "../blueprint/validation-types.js";

export type F01RejectionClass =
  | "SCHEMA_FIXABLE"
  | "CAPABILITY_FIXABLE"
  | "SEMANTIC_CONTRADICTION"
  | "SECURITY_TERMINAL"
  | "RESOURCE_TERMINAL";

/** F01-RQ-008A: the only canonical F02 error → F01 class mapping; F02's own Retry column never authorises recompose. */
export const F02_REJECTION_CLASS: Readonly<Record<F02ErrorCode, F01RejectionClass>> = Object.freeze({
  "F02-ERR-001": "SCHEMA_FIXABLE",
  "F02-ERR-002": "SCHEMA_FIXABLE",
  "F02-ERR-003": "SCHEMA_FIXABLE",
  "F02-ERR-004": "CAPABILITY_FIXABLE",
  "F02-ERR-005": "CAPABILITY_FIXABLE",
  "F02-ERR-006": "SCHEMA_FIXABLE",
  "F02-ERR-007": "SCHEMA_FIXABLE",
  "F02-ERR-008": "SCHEMA_FIXABLE",
  "F02-ERR-009": "SCHEMA_FIXABLE",
  "F02-ERR-010": "SCHEMA_FIXABLE",
  "F02-ERR-011": "RESOURCE_TERMINAL",
  "F02-ERR-012": "SECURITY_TERMINAL",
  "F02-ERR-013": "SECURITY_TERMINAL",
  "F02-ERR-014": "CAPABILITY_FIXABLE",
  "F02-ERR-015": "SECURITY_TERMINAL",
  "F02-ERR-016": "SECURITY_TERMINAL",
  "F02-ERR-017": "CAPABILITY_FIXABLE"
});

export function isF02ErrorCode(value: unknown): value is F02ErrorCode {
  return typeof value === "string" && Object.hasOwn(F02_REJECTION_CLASS, value);
}

export function isFixableClass(rejectionClass: F01RejectionClass): boolean {
  return rejectionClass === "SCHEMA_FIXABLE" || rejectionClass === "CAPABILITY_FIXABLE";
}

/**
 * Most restrictive class wins when a report carries several issues: a security / resource / integrity
 * terminal issue can never be downgraded to an ordinary fixable retry by a co-occurring schema issue.
 */
const CLASS_SEVERITY: Readonly<Record<F01RejectionClass, number>> = Object.freeze({
  SCHEMA_FIXABLE: 0,
  CAPABILITY_FIXABLE: 1,
  SEMANTIC_CONTRADICTION: 2,
  RESOURCE_TERMINAL: 3,
  SECURITY_TERMINAL: 4
});

export type ClassifiedRejection = {
  readonly error_code: F02ErrorCode;
  readonly rejection_class: F01RejectionClass;
};

/** Unknown / missing codes fail closed as an integrity fault (F02-ERR-015 semantics), never as fixable. */
export function classifyRejection(errorCodes: readonly unknown[]): ClassifiedRejection {
  let chosen: ClassifiedRejection | null = null;
  for (const code of errorCodes) {
    const candidate: ClassifiedRejection = isF02ErrorCode(code)
      ? { error_code: code, rejection_class: F02_REJECTION_CLASS[code] }
      : { error_code: "F02-ERR-015", rejection_class: "SECURITY_TERMINAL" };
    if (chosen === null || CLASS_SEVERITY[candidate.rejection_class] > CLASS_SEVERITY[chosen.rejection_class]) chosen = candidate;
  }
  return chosen ?? { error_code: "F02-ERR-015", rejection_class: "SECURITY_TERMINAL" };
}
