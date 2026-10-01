import { digestCandidateBytes } from "./candidate-digest.js";
import { canonicalBlueprintIdentity } from "./content-identity.js";
import { validateBlueprintSchema } from "./blueprint-schema.js";
import {
  BlueprintHashIntegrityFailure,
  type BlueprintAdmissionWriter
} from "./blueprint-repository.js";
import { validateNodeGraph } from "./graph-validation.js";
import { decodeCandidateUtf8, parseStrictJson, StrictJsonError } from "./strict-json.js";
import { isJsonObject } from "./json-shape.js";
import {
  validateActionsAndEvents,
  validateBindingsAndRules,
  validateCapabilityExistence,
  validateDerivedDependencies,
  validateVersions
} from "./reference-validation.js";
import {
  IssueCollector,
  type BlueprintValidationContext,
  type BlueprintValidationOutcome,
  type ValidationIssue,
  type ValidationReport,
  type ValidationResourceUsage,
  type ValidationStatus
} from "./validation-types.js";

const CANDIDATE_SOURCES = new Set(["COMPOSER", "RESTORE", "IMPORT"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

export interface BlueprintValidationDependencies {
  readonly repository: BlueprintAdmissionWriter;
  readonly now: () => string;
  readonly randomUUID: () => string;
}

export async function validateBlueprintCandidate(
  candidatePayloadBytes: Uint8Array,
  context: BlueprintValidationContext,
  dependencies: BlueprintValidationDependencies
): Promise<BlueprintValidationOutcome> {
  assertContext(context);
  const candidateDigest = digestCandidateBytes(candidatePayloadBytes);
  const intake = readCandidate(candidatePayloadBytes);
  if (!intake.ok) {
    return reject({
      candidateDigest,
      context,
      status: "REJECTED",
      issues: [intake.issue],
      schemaVersion: null,
      registryVersion: null,
      resourceUsage: emptyUsage()
    });
  }
  const schema = validateBlueprintSchema(intake.document);
  if (schema.model === null) {
    return reject({
      candidateDigest,
      context,
      status: "REJECTED",
      issues: schema.issues,
      schemaVersion: schema.schemaVersion,
      registryVersion: schema.registryVersion,
      resourceUsage: emptyUsage()
    });
  }
  const failed = firstFailure(schema.model);
  if (failed !== null) {
    return reject({
      candidateDigest,
      context,
      status: failed.status,
      issues: failed.issues,
      schemaVersion: schema.model.schemaVersion,
      registryVersion: schema.model.registryVersion,
      resourceUsage: usage(schema.model, null)
    });
  }
  return admit(candidateDigest, context, dependencies, schema.model);
}

function firstFailure(
  model: NonNullable<ReturnType<typeof validateBlueprintSchema>["model"]>
): { status: "REJECTED" | "INCOMPATIBLE"; issues: readonly ValidationIssue[] } | null {
  const versionIssues = new IssueCollector();
  const versionStatus = validateVersions(model, versionIssues);
  if (versionStatus !== null) {
    return { status: versionStatus, issues: versionIssues.list };
  }
  const checks: Array<(issues: IssueCollector) => void> = [
    (issues) => validateCapabilityExistence(model, issues),
    (issues) => validateDerivedDependencies(model, issues),
    (issues) => validateNodeGraph(model, issues),
    (issues) => validateBindingsAndRules(model, issues),
    (issues) => validateActionsAndEvents(model, issues)
  ];
  for (const check of checks) {
    const issues = new IssueCollector();
    check(issues);
    if (issues.failed) {
      return { status: "REJECTED", issues: issues.list };
    }
  }
  return null;
}

async function admit(
  candidateDigest: string,
  context: BlueprintValidationContext,
  dependencies: BlueprintValidationDependencies,
  model: NonNullable<ReturnType<typeof validateBlueprintSchema>["model"]>
): Promise<BlueprintValidationOutcome> {
  const createdAt = dependencies.now();
  if (!TIMESTAMP_PATTERN.test(createdAt)) {
    throw new TypeError("Blueprint admission clock must return a UTC timestamp.");
  }
  const validationRunId = dependencies.randomUUID();
  if (!UUID_V4_PATTERN.test(validationRunId)) {
    throw new TypeError("validation_run_id source must return a UUID v4.");
  }
  const identity = canonicalBlueprintIdentity(model.document);
  const report = buildReport({
    validationRunId,
    candidateDigest,
    status: "PASSED",
    schemaVersion: model.schemaVersion,
    registryVersion: model.registryVersion,
    contentHash: identity.contentHash,
    issues: [],
    traceId: context.trace_id,
    usage: usage(model, identity.bytes.byteLength)
  });
  try {
    await dependencies.repository.admit({
      run: {
        validation_run_id: validationRunId,
        compiler_run_id: context.compiler_run_id,
        candidate_digest: candidateDigest,
        blueprint_hash: identity.contentHash,
        schema_version: model.schemaVersion,
        registry_version: model.registryVersion,
        status: "PASSED",
        error_codes: [],
        report,
        created_at: createdAt,
        trace_id: context.trace_id
      },
      content: {
        content_hash: identity.contentHash,
        canonical_blueprint: model.document,
        canonical_bytes: identity.bytes,
        schema_version: model.schemaVersion,
        registry_version: model.registryVersion,
        trust_status: "VALIDATED",
        created_at: createdAt,
        admitted_by_validation_run_id: validationRunId,
        byte_size: identity.bytes.byteLength
      }
    });
  } catch (error) {
    if (error instanceof BlueprintHashIntegrityFailure) {
      return reject({
        candidateDigest,
        context,
        status: "REJECTED",
        issues: [hashIssue()],
        schemaVersion: model.schemaVersion,
        registryVersion: model.registryVersion,
        resourceUsage: usage(model, null)
      });
    }
    throw error;
  }
  return {
    status: "PASSED",
    validation_report: report,
    content_hash: identity.contentHash,
    canonical_blueprint: model.document
  };
}

function readCandidate(
  bytes: Uint8Array
): { ok: true; document: import("./strict-json.js").JsonObject } | { ok: false; issue: ValidationIssue } {
  try {
    const text = decodeCandidateUtf8(bytes);
    const value = parseStrictJson(text);
    if (!isJsonObject(value)) {
      return { ok: false, issue: intakeIssue("non_object_root") };
    }
    return { ok: true, document: value };
  } catch (error) {
    if (error instanceof StrictJsonError) {
      const messageKey = error.code === "DUPLICATE_KEY"
        ? "duplicate_key"
        : error.code === "INVALID_UTF8"
          ? "invalid_utf8"
          : "invalid_json";
      return { ok: false, issue: intakeIssue(messageKey) };
    }
    throw error;
  }
}

function intakeIssue(messageKey: string): ValidationIssue {
  return {
    error_code: "F02-ERR-001",
    severity: "ERROR",
    stage: "V01",
    json_path: "$",
    capability_ref: null,
    message_key: messageKey,
    retryable: false,
    recovery_hint: messageKey
  };
}

function hashIssue(): ValidationIssue {
  return {
    error_code: "F02-ERR-015",
    severity: "ERROR",
    stage: "V12",
    json_path: null,
    capability_ref: null,
    message_key: "hash_integrity_failure",
    retryable: false,
    recovery_hint: "hash_integrity_failure"
  };
}

function reject(input: {
  readonly candidateDigest: string;
  readonly context: BlueprintValidationContext;
  readonly status: Exclude<ValidationStatus, "PASSED">;
  readonly issues: readonly ValidationIssue[];
  readonly schemaVersion: string | null;
  readonly registryVersion: string | null;
  readonly resourceUsage: ValidationResourceUsage;
}): BlueprintValidationOutcome {
  return {
    status: input.status,
    validation_report: buildReport({
      validationRunId: null,
      candidateDigest: input.candidateDigest,
      status: input.status,
      schemaVersion: input.schemaVersion,
      registryVersion: input.registryVersion,
      contentHash: null,
      issues: input.issues,
      traceId: input.context.trace_id,
      usage: input.resourceUsage
    })
  };
}

function buildReport(input: {
  readonly validationRunId: string | null;
  readonly candidateDigest: string;
  readonly status: ValidationStatus;
  readonly schemaVersion: string | null;
  readonly registryVersion: string | null;
  readonly contentHash: string | null;
  readonly issues: readonly ValidationIssue[];
  readonly traceId: string;
  readonly usage: ValidationResourceUsage;
}): ValidationReport {
  return {
    validation_run_id: input.validationRunId,
    candidate_digest: input.candidateDigest,
    status: input.status,
    schema_version: input.schemaVersion,
    registry_version: input.registryVersion,
    content_hash: input.contentHash,
    issues: input.issues,
    warnings: [],
    resource_usage: input.usage,
    trace_id: input.traceId
  };
}

function usage(
  model: NonNullable<ReturnType<typeof validateBlueprintSchema>["model"]>,
  blueprintBytes: number | null
): ValidationResourceUsage {
  return {
    blueprint_bytes: blueprintBytes,
    node_count: model.nodes.size,
    state_count: model.states.size,
    rule_count: model.rules.size,
    action_count: model.actions.size,
    event_binding_count: model.eventBindingCount,
    timer_count: model.timerCount
  };
}

function emptyUsage(): ValidationResourceUsage {
  return {
    blueprint_bytes: null,
    node_count: 0,
    state_count: 0,
    rule_count: 0,
    action_count: 0,
    event_binding_count: 0,
    timer_count: 0
  };
}

function assertContext(context: BlueprintValidationContext): void {
  if (!CANDIDATE_SOURCES.has(context.candidate_source)) {
    throw new TypeError("candidate_source is not a legal F02 intake source.");
  }
  if (typeof context.trace_id !== "string" || context.trace_id.length === 0 || context.trace_id.length > 256) {
    throw new TypeError("trace_id is required.");
  }
  if (context.compiler_run_id !== null && !UUID_PATTERN.test(context.compiler_run_id)) {
    throw new TypeError("compiler_run_id must be a UUID or null.");
  }
}
