/** F03 §40 Error Taxonomy Seed. F12 owns humanized message / next action. */
export type F03ErrorCode =
  | "F03-ERR-001"
  | "F03-ERR-002"
  | "F03-ERR-003"
  | "F03-ERR-004"
  | "F03-ERR-005"
  | "F03-ERR-006"
  | "F03-ERR-007"
  | "F03-ERR-008"
  | "F03-ERR-009"
  | "F03-ERR-010"
  | "F03-ERR-011"
  | "F03-ERR-012"
  | "F03-ERR-013"
  | "F03-ERR-014"
  | "F03-ERR-015"
  | "F03-ERR-016"
  | "F03-ERR-017"
  | "F03-ERR-018"
  | "F03-ERR-019"
  | "F03-ERR-020"
  | "F03-ERR-021";

export class RuntimeFailure extends Error {
  public constructor(
    public readonly code: F03ErrorCode,
    message: string,
    public readonly capabilityId?: string
  ) {
    super(message);
    this.name = "RuntimeFailure";
  }
}

export function runtimeFail(code: F03ErrorCode, message: string, capabilityId?: string): never {
  throw new RuntimeFailure(code, message, capabilityId);
}

/** Admission-guaranteed structure observed broken at runtime (F03 §14 BF-036, §19 BF-037). */
export function invariantBroken(message: string): never {
  return runtimeFail("F03-ERR-018", message);
}
