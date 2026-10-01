import { evidenceFieldFault, type EvidenceFieldSchema } from "../evidence/evidence-field-schema.js";
import {
  lockedEvidenceRegistry,
  type EvidenceRegistry,
  type EvidenceRegistryEntry
} from "../evidence/evidence-registry.js";
import type { EvidenceEventInput } from "../evidence/evidence-types.js";
import type { CapabilityAdmissionError } from "./admission.js";
import type {
  CapabilityRejection,
  CoverageGap,
  CoverageResolutionOutcome,
  CoverageResult,
  RequirementCoverageResult
} from "./coverage.js";
import type { CapabilityRef } from "./schema/capability-definition.js";

export const REGISTRY_EVIDENCE_EVENT_TYPES = Object.freeze({
  selected: "F04-EVT-001",
  rejected: "F04-EVT-002",
  gap: "F04-EVT-006",
  mismatch: "F04-EVT-007"
});

export const F04_ADMISSION_ERROR_IDS: Readonly<
  Partial<Record<CapabilityAdmissionError["code"], string>>
> = Object.freeze({
  UNKNOWN_CAPABILITY: "F04-ERR-001",
  UNKNOWN_CAPABILITY_VERSION: "F04-ERR-002",
  CAPABILITY_DISABLED: "F04-ERR-003",
  CAPABILITY_DEPENDENCY_UNAVAILABLE: "F04-ERR-004",
  REGISTRY_SNAPSHOT_MISMATCH: "F04-ERR-005",
  RUNTIME_HANDLER_MISSING: "F04-ERR-006"
});

const SEMANTIC_CORE_ERROR_ID = "F04-ERR-008";
const DIGEST_PREFIX = "sha256:";
const BARE_DIGEST_PATTERN = /^[0-9a-f]{64}$/;
const CONTEXT_FIELDS = [
  "anonymous_id",
  "session_id",
  "intent_id",
  "blueprint_hash",
  "trace_id"
] as const;

type RegistryEvidenceKind = keyof typeof REGISTRY_EVIDENCE_EVENT_TYPES;
type ContextField = (typeof CONTEXT_FIELDS)[number];

export type RegistryEvidenceContext = Readonly<Partial<Record<ContextField, string | null>>>;

export interface RegistryEvidenceDependencies {
  readonly createEventId: () => string;
  readonly now: () => Date;
  readonly registry?: EvidenceRegistry;
}

export class RegistryEvidenceError extends Error {
  public constructor(
    public readonly code: "REGISTRY_DIGEST_INVALID" | "EVIDENCE_EVENT_UNREGISTERED",
    message: string
  ) {
    super(message);
    this.name = "RegistryEvidenceError";
  }
}

interface EvidenceSpec {
  readonly kind: RegistryEvidenceKind;
  readonly capability?: CapabilityRef;
  readonly errorCode?: string;
}

interface EvidenceFrame {
  readonly registry: EvidenceRegistry;
  readonly createEventId: () => string;
  readonly occurredAt: string;
  readonly context: RegistryEvidenceContext;
  readonly snapshot: Readonly<Record<string, string>>;
}

export function evidenceRegistryDigest(digest: string): string {
  const bare = digest.startsWith(DIGEST_PREFIX) ? digest.slice(DIGEST_PREFIX.length) : digest;
  if (!BARE_DIGEST_PATTERN.test(bare)) {
    throw new RegistryEvidenceError(
      "REGISTRY_DIGEST_INVALID",
      "Registry digest must be 64 lowercase hex characters."
    );
  }
  return `${DIGEST_PREFIX}${bare}`;
}

function registeredEntry(registry: EvidenceRegistry, kind: RegistryEvidenceKind): EvidenceRegistryEntry {
  const eventType = REGISTRY_EVIDENCE_EVENT_TYPES[kind];
  const entry = registry.find(eventType);
  if (entry === undefined) {
    throw new RegistryEvidenceError(
      "EVIDENCE_EVENT_UNREGISTERED",
      `Evidence event is not registered: ${eventType}`
    );
  }
  return entry;
}

function conforming(value: string | undefined, schema: EvidenceFieldSchema | undefined): string | undefined {
  return value !== undefined && schema !== undefined && evidenceFieldFault(value, schema) === null
    ? value
    : undefined;
}

function sanitizedContext(
  context: RegistryEvidenceContext,
  registry: EvidenceRegistry
): RegistryEvidenceContext {
  const sanitized: Partial<Record<ContextField, string>> = {};
  for (const field of CONTEXT_FIELDS) {
    const value = context[field];
    const schema = registry.clientEnvelopeSchemas.get(field);
    if (typeof value === "string" && schema !== undefined && evidenceFieldFault(value, schema) === null) {
      sanitized[field] = value;
    }
  }
  return sanitized;
}

function evidenceEvent(spec: EvidenceSpec, frame: EvidenceFrame): EvidenceEventInput {
  const entry = registeredEntry(frame.registry, spec.kind);
  const capabilityId = conforming(
    spec.capability?.id,
    frame.registry.clientEnvelopeSchemas.get("capability_id")
  );
  const capabilityVersion = conforming(
    spec.capability?.version,
    entry.propertySchemas.get("capability_version")
  );
  return {
    event_id: frame.createEventId(),
    event_type: entry.eventType,
    schema_version: entry.schemaVersion,
    occurred_at: frame.occurredAt,
    function_id: entry.functionId,
    ...frame.context,
    ...(capabilityId === undefined ? {} : { capability_id: capabilityId }),
    ...(spec.errorCode === undefined ? {} : { error_code: spec.errorCode }),
    properties: {
      ...(capabilityVersion === undefined ? {} : { capability_version: capabilityVersion }),
      ...frame.snapshot
    }
  };
}

function rejectionSpec(rejection: CapabilityRejection): EvidenceSpec {
  return {
    kind: rejection.code === "REGISTRY_SNAPSHOT_MISMATCH" ? "mismatch" : "rejected",
    capability: rejection.capabilityRef,
    errorCode: F04_ADMISSION_ERROR_IDS[rejection.code]
  };
}

function gapSpec(
  gap: CoverageGap,
  requirementsById: ReadonlyMap<string, RequirementCoverageResult>
): EvidenceSpec {
  return {
    kind: "gap",
    capability: requirementsById.get(gap.requirementId)?.degradation?.sourceCapabilityRef,
    errorCode: gap.evidenceCode === SEMANTIC_CORE_ERROR_ID ? SEMANTIC_CORE_ERROR_ID : undefined
  };
}

function evidenceSpecs(outcome: CoverageResolutionOutcome): readonly EvidenceSpec[] {
  const requirementsById = new Map(
    outcome.result.requirements.map((requirement) => [requirement.requirementId, requirement])
  );
  return [
    ...outcome.result.selected.map((capability): EvidenceSpec => ({ kind: "selected", capability })),
    ...outcome.rejections.map(rejectionSpec),
    ...outcome.result.gaps.map((gap) => gapSpec(gap, requirementsById))
  ];
}

function snapshotProperties(result: CoverageResult): Readonly<Record<string, string>> {
  return {
    coverage_status: result.status,
    registry_version: result.registryVersion,
    registry_digest: evidenceRegistryDigest(result.registryDigest)
  };
}

export function buildRegistryEvidence(
  outcome: CoverageResolutionOutcome,
  dependencies: RegistryEvidenceDependencies,
  context: RegistryEvidenceContext = {}
): readonly EvidenceEventInput[] {
  const registry = dependencies.registry ?? lockedEvidenceRegistry;
  const frame: EvidenceFrame = {
    registry,
    createEventId: dependencies.createEventId,
    occurredAt: dependencies.now().toISOString(),
    context: sanitizedContext(context, registry),
    snapshot: snapshotProperties(outcome.result)
  };
  return evidenceSpecs(outcome).map((spec) => evidenceEvent(spec, frame));
}
