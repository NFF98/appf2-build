import type {
  BlueprintAdmission,
  BlueprintAdmissionResult,
  BlueprintContentRecord,
  ValidationRunRecord
} from "./validation-types.js";

export class BlueprintHashIntegrityFailure extends Error {
  readonly error_code = "F02-ERR-015" as const;
  readonly stage = "V12" as const;

  constructor() {
    super("Blueprint content hash resolved to different canonical content.");
    this.name = "BlueprintHashIntegrityFailure";
  }
}

export interface BlueprintAdmissionWriter {
  admit(input: BlueprintAdmission): Promise<BlueprintAdmissionResult>;
}

export interface BlueprintAdmissionRepository extends BlueprintAdmissionWriter {
  readContent(contentHash: string): Promise<BlueprintContentRecord | null>;
  readRun(validationRunId: string): Promise<ValidationRunRecord | null>;
}

export interface MemoryBlueprintSeed {
  readonly contents?: readonly BlueprintContentRecord[];
  readonly runs?: readonly ValidationRunRecord[];
}

export function sameCanonicalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) {
    return false;
  }
  let mismatch = 0;
  for (let index = 0; index < left.byteLength; index += 1) {
    mismatch |= (left[index] ?? 0) ^ (right[index] ?? 0);
  }
  return mismatch === 0;
}

export class MemoryBlueprintAdmissionRepository implements BlueprintAdmissionRepository {
  private readonly runs = new Map<string, ValidationRunRecord>();
  private readonly contents = new Map<string, BlueprintContentRecord>();

  constructor(seed: MemoryBlueprintSeed = {}) {
    for (const run of seed.runs ?? []) {
      this.runs.set(run.validation_run_id, cloneRun(run));
    }
    for (const content of seed.contents ?? []) {
      this.contents.set(content.content_hash, cloneContent(content));
    }
  }

  async admit(input: BlueprintAdmission): Promise<BlueprintAdmissionResult> {
    const existing = this.contents.get(input.content.content_hash);
    if (existing !== undefined && !contentMatches(existing, input.content)) {
      throw new BlueprintHashIntegrityFailure();
    }
    if (this.runs.has(input.run.validation_run_id)) {
      throw new Error("validation_run_id already exists.");
    }
    const run = cloneRun(input.run);
    const content = existing ?? cloneContent(input.content);
    this.runs.set(run.validation_run_id, run);
    if (existing === undefined) {
      this.contents.set(content.content_hash, content);
      return { reused: false };
    }
    return { reused: true };
  }

  async readContent(contentHash: string): Promise<BlueprintContentRecord | null> {
    const content = this.contents.get(contentHash);
    return content === undefined ? null : cloneContent(content);
  }

  async readRun(validationRunId: string): Promise<ValidationRunRecord | null> {
    const run = this.runs.get(validationRunId);
    return run === undefined ? null : cloneRun(run);
  }
}

function contentMatches(
  existing: BlueprintContentRecord,
  incoming: BlueprintContentRecord
): boolean {
  return existing.byte_size === incoming.byte_size
    && existing.schema_version === incoming.schema_version
    && existing.registry_version === incoming.registry_version
    && sameCanonicalBytes(existing.canonical_bytes, incoming.canonical_bytes);
}

function cloneRun(run: ValidationRunRecord): ValidationRunRecord {
  return structuredClone(run);
}

function cloneContent(content: BlueprintContentRecord): BlueprintContentRecord {
  return {
    ...structuredClone({
      content_hash: content.content_hash,
      canonical_blueprint: content.canonical_blueprint,
      schema_version: content.schema_version,
      registry_version: content.registry_version,
      trust_status: content.trust_status,
      created_at: content.created_at,
      admitted_by_validation_run_id: content.admitted_by_validation_run_id,
      byte_size: content.byte_size
    }),
    canonical_bytes: new Uint8Array(content.canonical_bytes)
  };
}
