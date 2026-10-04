import { randomUUID } from "node:crypto";

import {
  parseSemVer,
  parseVersionRange,
  versionInRange,
  type VersionRange
} from "../capabilities/compatibility-grammar.js";
import {
  createEligibilityEvaluator,
  lookupVersioned,
  type EligibilityFailure
} from "../capabilities/execution-eligibility.js";
import {
  parseRegistryReleaseLedger,
  parseTrustedRuntimeHandlerCatalog,
  REGISTRY_MACHINE_CONTRACT_MAJOR,
  registryMachineMajor,
  sameReleaseIdentity,
  verifyReleaseBundle
} from "../capabilities/registry-release.js";
import type { CapabilityRef } from "../capabilities/schema/capability-definition.js";
import type {
  RegistryReleaseBundle,
  RegistryReleaseLedger,
  RegistryReleaseSource
} from "../capabilities/schema/registry-release.js";
import { canonicalBlueprintBytes } from "./canonical-json.js";
import { hashCanonicalBlueprintBytes } from "./content-identity.js";
import { emitF02Evidence, newTraceId, type F02EvidenceEvent, type F02EvidenceOptions } from "./validation-evidence.js";
import type { F02ErrorCode } from "./validation-types.js";

export const EXECUTION_ADMISSION_VERSION = "1.0.0";
export const EXECUTION_ADMISSION_TTL_MS = 30_000;

/** Durable `blueprint_content` row plus the admitting validation_run report registry_digest. */
export interface StoredBlueprintContent {
  readonly content_hash: string;
  readonly canonical_blueprint: unknown;
  readonly schema_version: string;
  readonly registry_version: string;
  readonly trust_status: string;
  readonly admitted_registry_digest: string;
}

export interface ExecutionContentSource {
  readContent(contentHash: string): Promise<StoredBlueprintContent | undefined>;
}

export interface ExecutionAdmission {
  readonly admission_version: typeof EXECUTION_ADMISSION_VERSION;
  readonly admission_id: string;
  readonly content_hash: string;
  readonly executable: true;
  readonly trust_status: "VALIDATED";
  readonly schema_version: string;
  readonly registry_version: string;
  readonly registry_digest: string;
  readonly validator_registry_digest: string;
  readonly runtime_registry_digest: string;
  readonly runtime_version: string;
  readonly issued_at: string;
  readonly expires_at: string;
}

export type AdmissionStep = "E01" | "E02" | "E03" | "E04-A" | "E04-B" | "E05" | "E06" | "E07" | "E08";

export interface ExecutionAdmissionDenial {
  readonly executable: false;
  readonly step: AdmissionStep;
  readonly http_status?: 404 | 503;
  readonly error_code?: F02ErrorCode;
  readonly retryable: boolean;
  readonly reason: string;
  readonly eligibility?: EligibilityFailure;
}

export type ExecutionAdmissionDecision =
  | { readonly executable: true; readonly admission: ExecutionAdmission }
  | ExecutionAdmissionDenial;

/** Server/deployment-owned configuration; public callers can only supply `content_hash`. */
export interface ExecutionAdmissionConfig {
  readonly content: ExecutionContentSource;
  readonly releases: RegistryReleaseSource;
  readonly runtimeVersion: string;
  readonly supportedBlueprintSchemaRange: string;
  readonly now?: () => Date;
  readonly newAdmissionId?: () => string;
  /** Server-side F02-EVT-010..013 evidence; omitted means no evidence emission. */
  readonly evidence?: F02EvidenceOptions;
  readonly newTraceId?: () => string;
}

export interface ExecutionAdmissionService {
  admit(contentHash: string): Promise<ExecutionAdmissionDecision>;
}

class AdmissionStop extends Error {
  public constructor(public readonly denial: ExecutionAdmissionDenial) {
    super(denial.reason);
    this.name = "AdmissionStop";
  }
}

function deny(step: AdmissionStep, reason: string, extra: Partial<ExecutionAdmissionDenial> = {}): never {
  throw new AdmissionStop({ executable: false, step, retryable: false, reason, ...extra });
}

function incompatible(step: "E03" | "E05" | "E06" | "E07", reason: string, eligibility?: EligibilityFailure): never {
  return deny(step, reason, eligibility === undefined ? { error_code: "F02-ERR-017" } : { error_code: "F02-ERR-017", eligibility });
}

function unavailable(reason: string): never {
  return deny("E08", reason, { http_status: 503, retryable: true });
}

function integrityFailure(reason: string): never {
  return deny("E04-B", reason, { error_code: "F02-ERR-015" });
}

async function loadOrUnavailable<T>(load: () => Promise<T>, reason: string): Promise<T> {
  try {
    return await load();
  } catch {
    return unavailable(reason);
  }
}

interface VerifiedBody {
  readonly schemaVersion: string;
  readonly registryVersion: string;
  readonly nodeRefs: readonly CapabilityRef[];
  readonly executionRefs: readonly CapabilityRef[];
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRef(value: unknown): CapabilityRef {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.version !== "string") {
    return integrityFailure("Persisted Blueprint carries a malformed CapabilityRef.");
  }
  return { id: value.id, version: value.version };
}

function readArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : integrityFailure("Persisted Blueprint execution reference container is malformed.");
}

function uniqueRefs(refs: readonly CapabilityRef[]): readonly CapabilityRef[] {
  const seen = new Map<string, CapabilityRef>();
  for (const ref of refs) {
    seen.set(`${ref.id}@${ref.version}`, ref);
  }
  return [...seen.values()];
}

function extractRefs(body: Readonly<Record<string, unknown>>): Pick<VerifiedBody, "nodeRefs" | "executionRefs"> {
  const nodeRefs = uniqueRefs(readArray(body.nodes).map((node) => readRef(isRecord(node) ? node.capability : undefined)));
  const support = isRecord(body.support) ? body.support : integrityFailure("Persisted Blueprint support is malformed.");
  const degradationRefs = readArray(support.degradations).flatMap((degradation) =>
    readArray(isRecord(degradation) ? degradation.capability_refs : undefined).map(readRef)
  );
  return { nodeRefs, executionRefs: uniqueRefs([...nodeRefs, ...degradationRefs]) };
}

/** E04-B: durable body integrity — re-hash, schema/registry metadata equality, execution refs extractable. */
function verifyPersistedBody(stored: StoredBlueprintContent, contentHash: string): VerifiedBody {
  let body: unknown;
  try {
    const raw: unknown = stored.canonical_blueprint;
    body = typeof raw === "string" ? JSON.parse(raw) : raw;
    const rehash = hashCanonicalBlueprintBytes(canonicalBlueprintBytes(body));
    if (rehash !== contentHash || stored.content_hash !== contentHash) {
      integrityFailure("Persisted canonical body re-hash does not equal content_hash.");
    }
  } catch (error: unknown) {
    if (error instanceof AdmissionStop) {
      throw error;
    }
    integrityFailure("Persisted canonical body cannot be parsed or canonicalized.");
  }
  if (!isRecord(body) || body.schema_version !== stored.schema_version) {
    integrityFailure("Persisted schema_version does not equal body.schema_version.");
  }
  if (body.registry_version !== stored.registry_version) {
    integrityFailure("Persisted registry_version does not equal body.registry_version.");
  }
  return {
    schemaVersion: stored.schema_version,
    registryVersion: stored.registry_version,
    ...extractRefs(body)
  };
}

function hasValidatorRef(bundle: RegistryReleaseBundle, ref: CapabilityRef): boolean {
  return lookupVersioned(bundle.validator_registry.capabilities, ref) !== undefined;
}

async function loadLedger(releases: RegistryReleaseSource): Promise<RegistryReleaseLedger> {
  const raw = await loadOrUnavailable(() => releases.loadReleaseLedger(), "Trusted release ledger cannot be loaded.");
  try {
    return parseRegistryReleaseLedger(raw);
  } catch {
    return unavailable("Trusted release ledger cannot be verified.");
  }
}

/** E06: exact pinned v7 release for body.registry_version + admitted registry_digest, verified against the ledger. */
async function loadPinnedRelease(
  releases: RegistryReleaseSource,
  body: VerifiedBody,
  stored: StoredBlueprintContent
): Promise<{ readonly ledger: RegistryReleaseLedger; readonly pinned: RegistryReleaseBundle }> {
  if (registryMachineMajor(body.registryVersion) !== REGISTRY_MACHINE_CONTRACT_MAJOR) {
    incompatible("E06", "Pinned Registry machine major is unsupported; no adapter exists.");
  }
  const ledger = await loadLedger(releases);
  const entry = ledger.releases.find(
    (release) =>
      release.registry_version === body.registryVersion && release.registry_digest === stored.admitted_registry_digest
  );
  if (entry === undefined) {
    return incompatible("E06", "Trusted release ledger has no pinned release for the admitted Registry identity.");
  }
  const pinned = await loadOrUnavailable(() => releases.loadPinnedRelease(entry), "Pinned release cannot be loaded.");
  if (pinned === undefined || !sameReleaseIdentity(pinned.identity, entry) || verifyReleaseBundle(pinned, ledger) !== undefined) {
    return incompatible("E06", "Pinned release identity/artifact digest does not match the immutable ledger entry.");
  }
  if (!body.executionRefs.every((ref) => hasValidatorRef(pinned, ref))) {
    return incompatible("E06", "Pinned release does not contain every Blueprint execution reference.");
  }
  return { ledger, pinned };
}

async function loadCurrentRelease(releases: RegistryReleaseSource, ledger: RegistryReleaseLedger): Promise<RegistryReleaseBundle> {
  const current = await loadOrUnavailable(() => releases.loadCurrentRelease(), "Current release cannot be loaded.");
  if (
    registryMachineMajor(current.identity.registry_version) !== REGISTRY_MACHINE_CONTRACT_MAJOR ||
    verifyReleaseBundle(current, ledger) !== undefined
  ) {
    return unavailable("Current release integrity verification failed.");
  }
  return current;
}

/** E07: every BlueprintExecutionRef re-checked against current release with pinned same-ref identity defense. */
function checkCurrentEligibility(
  body: VerifiedBody,
  pinned: RegistryReleaseBundle,
  current: RegistryReleaseBundle,
  runtimeVersion: string
): void {
  const evaluate = createEligibilityEvaluator({
    registry: current.validator_registry,
    blueprintSchemaVersion: body.schemaVersion,
    runtimeVersion,
    drift: {
      runtimeRegistry: current.runtime_registry,
      pinned: { validator_registry: pinned.validator_registry, runtime_registry: pinned.runtime_registry }
    }
  });
  for (const ref of body.executionRefs) {
    const failure = evaluate(ref);
    if (failure !== undefined) {
      incompatible("E07", `Current execution eligibility failed: ${failure.reason}.`, failure);
    }
  }
}

/** Pinned RuntimeRegistry is the handler-binding truth; every direct Node key must be an actual bundled handler. */
async function verifyPinnedHandlers(
  releases: RegistryReleaseSource,
  body: VerifiedBody,
  pinned: RegistryReleaseBundle
): Promise<void> {
  const raw = await loadOrUnavailable(() => releases.loadRuntimeHandlerCatalog(), "Runtime handler catalog cannot be loaded.");
  const catalog = parseTrustedRuntimeHandlerCatalog(raw) ?? unavailable("Runtime handler catalog cannot be verified.");
  for (const ref of body.nodeRefs) {
    const binding = lookupVersioned(pinned.runtime_registry.capabilities, ref);
    if (binding === undefined || !catalog.has(binding.registration_key)) {
      unavailable("RUNTIME_HANDLER_MISSING: pinned direct Node handler binding cannot be proven.");
    }
  }
}

function checkDurableTrust(stored: StoredBlueprintContent): void {
  if (stored.trust_status === "REVOKED") {
    deny("E02", "Blueprint content trust_status is REVOKED.", { error_code: "F02-ERR-016" });
  }
  if (stored.trust_status === "INCOMPATIBLE") {
    incompatible("E03", "Blueprint content trust_status is INCOMPATIBLE.");
  }
  if (stored.trust_status !== "VALIDATED") {
    deny("E04-A", "Blueprint content trust_status is not VALIDATED.");
  }
}

/** EXECUTION-ADMISSION §10: requested + exactly one terminal allowed / denied (E01–E07) / failed (E08) event. */
function admissionEvents(
  contentHash: string,
  decision: ExecutionAdmissionDecision,
  runtimeVersion: string,
  traceId: string
): readonly F02EvidenceEvent[] {
  const requested: F02EvidenceEvent = {
    event_type: "F02-EVT-010",
    trace_id: traceId,
    blueprint_hash: contentHash,
    properties: { content_hash: contentHash, runtime_version: runtimeVersion }
  };
  if (decision.executable) {
    const { admission } = decision;
    return [
      requested,
      {
        event_type: "F02-EVT-011",
        trace_id: traceId,
        blueprint_hash: contentHash,
        properties: {
          content_hash: contentHash,
          blueprint_schema_version: admission.schema_version,
          registry_version: admission.registry_version,
          registry_digest: admission.registry_digest,
          runtime_version: admission.runtime_version
        }
      }
    ];
  }
  return [
    requested,
    {
      event_type: decision.step === "E08" ? "F02-EVT-013" : "F02-EVT-012",
      trace_id: traceId,
      blueprint_hash: contentHash,
      ...(decision.error_code === undefined ? {} : { error_code: decision.error_code }),
      properties: { content_hash: contentHash, runtime_version: runtimeVersion }
    }
  ];
}

function checkSchema(body: VerifiedBody, supportedRange: VersionRange): void {
  const schemaVersion = parseSemVer(body.schemaVersion);
  if (schemaVersion === undefined || !versionInRange(schemaVersion, supportedRange)) {
    incompatible("E05", "Blueprint schema_version is outside the server supported range.");
  }
}

/**
 * Fresh ExecutionAdmission (EXECUTION-ADMISSION §9). Deterministic E01–E08 precedence: the first denial ends
 * the request; temporary inability is E08 and never falls back to an allow.
 */
export function createExecutionAdmissionService(config: ExecutionAdmissionConfig): ExecutionAdmissionService {
  const supportedRange = parseVersionRange(config.supportedBlueprintSchemaRange);
  if (supportedRange === undefined || parseSemVer(config.runtimeVersion) === undefined) {
    throw new TypeError("Execution admission requires a trusted SemVer runtime_version and Blueprint schema range.");
  }
  const now = config.now ?? (() => new Date());
  const newAdmissionId = config.newAdmissionId ?? randomUUID;

  const decide = async (contentHash: string): Promise<ExecutionAdmission> => {
    const stored = await loadOrUnavailable(() => config.content.readContent(contentHash), "Blueprint repository read failed.");
    if (stored === undefined) {
      return deny("E01", "content_hash is unknown.", { http_status: 404 });
    }
    checkDurableTrust(stored);
    const body = verifyPersistedBody(stored, contentHash);
    checkSchema(body, supportedRange);
    const { ledger, pinned } = await loadPinnedRelease(config.releases, body, stored);
    const current = await loadCurrentRelease(config.releases, ledger);
    checkCurrentEligibility(body, pinned, current, config.runtimeVersion);
    await verifyPinnedHandlers(config.releases, body, pinned);
    const issuedAt = now();
    return {
      admission_version: EXECUTION_ADMISSION_VERSION,
      admission_id: newAdmissionId(),
      content_hash: contentHash,
      executable: true,
      trust_status: "VALIDATED",
      schema_version: body.schemaVersion,
      registry_version: pinned.identity.registry_version,
      registry_digest: pinned.identity.registry_digest,
      validator_registry_digest: pinned.identity.validator_registry_digest,
      runtime_registry_digest: pinned.identity.runtime_registry_digest,
      runtime_version: config.runtimeVersion,
      issued_at: issuedAt.toISOString(),
      expires_at: new Date(issuedAt.getTime() + EXECUTION_ADMISSION_TTL_MS).toISOString()
    };
  };

  const decideOrDeny = async (contentHash: string): Promise<ExecutionAdmissionDecision> => {
    try {
      return { executable: true, admission: await decide(contentHash) };
    } catch (error: unknown) {
      if (error instanceof AdmissionStop) {
        return error.denial;
      }
      throw error;
    }
  };

  return {
    admit: async (contentHash) => {
      const decision = await decideOrDeny(contentHash);
      if (config.evidence !== undefined) {
        const traceId = (config.newTraceId ?? newTraceId)();
        await emitF02Evidence(config.evidence, admissionEvents(contentHash, decision, config.runtimeVersion, traceId));
      }
      return decision;
    }
  };
}
