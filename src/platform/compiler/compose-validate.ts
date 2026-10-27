import { admitBlueprint } from "../blueprint/blueprint-admission.js";
import { validateBlueprintCandidate } from "../blueprint/validate-blueprint.js";
import { BLUEPRINT_SCHEMA_VERSION, MAX_CANDIDATE_PAYLOAD_BYTES } from "../blueprint/validation-types.js";
import type { CoverageResult } from "../capabilities/coverage.js";
import { CAPABILITY_REGISTRY_SOURCE } from "../capabilities/registry.js";
import { isPlainRecord, type JsonRecord, type JsonValue } from "../intent/json-value.js";
import type { EphemeralResolvedContext, ResolvedIntent } from "../intent/resolved-intent.js";
import type { F01EvidenceBuffer } from "./compiler-evidence.js";
import type { AttemptGuard, IntentLifecycleStatus } from "./compiler-records.js";
import type { CreateProgressOperation } from "./create-progress.js";
import { ephemeralValueDetector } from "./ephemeral-binding.js";
import { IntentApiError, isF01ErrorCode } from "./f01-errors.js";
import { guardNow, requireTransition, type ResolvedServiceDependencies } from "./intent-operation.js";
import { COMPLEX_BLUEPRINT_ATTEMPT_TIMEOUTS_MS, type RequestDeadline } from "./model-gateway.js";
import { composeResponseSchema, EVALUATION_FIXTURE_VERSION, PROMPT_B_VERSION, PROMPT_B_PLAN_VERSION } from "./prompts.js";
import COMPOSITION_PLAN_SCHEMA from "./composition-plan-v1.schema.json";
import { lowerCompositionPlan, parseCompositionPlan, CompositionPlanError } from "./typed-composition.js";
import { BlueprintAttemptBudget, StaleAttemptError, callProviderWithBoundedRetry } from "./provider-attempts.js";
import { classifyRejection, isFixableClass, type ClassifiedRejection } from "./rejection-classification.js";

export const RAW_INTENT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

export type ComposeScope = {
  readonly dependencies: ResolvedServiceDependencies;
  readonly guard: AttemptGuard;
  readonly intentId: string;
  readonly traceId: string;
  readonly evidence: F01EvidenceBuffer;
  readonly deadline: RequestDeadline;
  readonly progress: CreateProgressOperation | null;
  readonly resolved: ResolvedIntent;
  readonly ephemeral: EphemeralResolvedContext;
  /** False when this logical compile operation already spent its single validation-driven recompose. */
  readonly recomposeAvailable: boolean;
  /** SSOT: a logical compile is allowed at most one validation-driven recompose. */
  readonly maxValidationRecomposes?: number;
  readonly refreshCoverage: () => CoverageResult;
};

export type ComposeOutcome = {
  readonly validationRunId: string;
  readonly contentHash: string;
  readonly coverage: CoverageResult;
  readonly intentVersion: number;
};

type ValidationIssueFeedback = {
  readonly error_code: string;
  readonly stage: string;
  readonly json_path: string;
  /** Static system guidance only; never verbatim provider, secret or user data. */
  readonly repair_hint?: string;
};

export function canonicalRepairHint(code: string, stage: string, path: string): string | undefined {
  if (code === "F02-ERR-002" && stage === "V02" && /^\$\.nodes\[\d+\]\.events\.[a-z_]+$/.test(path)) {
    return "Event binding must be a STRING that exactly matches a declared actions[].id using action_ plus lowercase snake_case, e.g. events.change:'action_update_input'. Never use an inline action object, ValueSource, camelCase ID or unprefixed name. Omit the event key if there is no declared handler.";
  }
  if (code === "F02-ERR-007" && stage === "V06" && path === "$.root_node_id") {
    return "root_node_id MUST equal the id of an actual node in nodes[]. Select the ONE existing root-capable structural node; never emit an invented or renamed ID. Every other node must have one reachable parent.";
  }
  if (code === "F02-ERR-007" && stage === "V06" && /^\$\.nodes\[\d+\]\.repeat$/.test(path)) {
    return "Check the exact node capability composition.repeat. Only content.list can be repeated in the task catalog (and it requires repeat); leaf input.text/input.toggle/action.button/content.text/data.stat must OMIT repeat. Within an allowed repeat, item_alias/index_alias must differ and cannot shadow ancestor aliases.";
  }
  if (code === "F02-ERR-007" && stage === "V06" && /^\$\.nodes\[\d+\]$/.test(path)) {
    return "Orphan node: connect this node to exactly one reachable parent.children from root_node_id. Every node must belong to ONE rooted tree.";
  }
  return undefined;
}

/** Keep distinct F02 diagnostics across all bounded attempts: a repair must
 * not re-introduce an earlier V02 error while fixing a later V05 error. */
export function accumulateValidationIssues(
  previous: readonly ValidationIssueFeedback[],
  latest: readonly ValidationIssueFeedback[]
): readonly ValidationIssueFeedback[] {
  const combined = new Map<string, ValidationIssueFeedback>();
  for (const issue of [...previous, ...latest]) {
    const id = issue.error_code + "|" + issue.stage + "|" + issue.json_path;
    if (!combined.has(id)) combined.set(id, issue);
  }
  return [...combined.values()].slice(-16);
}


type Verdict =
  | { readonly admitted: true; readonly validationRunId: string; readonly contentHash: string }
  | { readonly admitted: false; readonly classified: ClassifiedRejection; readonly incompatible: boolean; readonly issues: readonly ValidationIssueFeedback[] };

type TerminalDisposition = { readonly lifecycle: IntentLifecycleStatus; readonly error: IntentApiError; readonly terminal: boolean };

export function isCoverageAllowed(coverage: CoverageResult): boolean {
  return coverage.status === "FULLY_SUPPORTED" || coverage.status === "PARTIALLY_SUPPORTED";
}

export function coverageSupport(coverage: CoverageResult): JsonRecord {
  const degradations = coverage.requirements.flatMap((requirement) => requirement.degradation === undefined ? [] : [{
    requirement_id: requirement.requirementId,
    source_capability: { ...requirement.degradation.sourceCapabilityRef },
    alternative_capability: { ...requirement.degradation.alternativeCapabilityRef }
  }]);
  return { coverage_status: coverage.status, degradations };
}

/** Selected registered Capabilities only (F01-RQ-006 rule 3); runtime registration keys never reach Prompt B. */
function compilerCatalog(coverage: CoverageResult): JsonValue {
  const selected = new Set(coverage.selected.map((ref) => `${ref.id}@${ref.version}`));
  const entries = CAPABILITY_REGISTRY_SOURCE.capabilities
    .filter((definition) => selected.has(`${definition.id}@${definition.version}`))
    .map((definition) => ({
      id: definition.id,
      version: definition.version,
      family: definition.family,
      meaning: definition.semantic.meaning,
      contract: definition.contract
    }));
  return JSON.parse(JSON.stringify(entries)) as JsonValue;
}


/** Only a complete, exact F04-selected role set can use the typed composer.
 * All other existing compositions continue along their original trusted F02 path. */
export function isCertifiedPlanEligible(coverage: CoverageResult): boolean {
  if (!isCoverageAllowed(coverage) || (coverage.certifiedProfile !== "RECORD_LIST" && coverage.certifiedProfile !== "RECORD_LIST_TODAY")) return false;
  const selected = new Set(coverage.selected.map(ref => ref.id + "@" + ref.version));
  const required = ["layout.container", "content.text", "content.list", "input.text", "action.button", "data.stat"];
  return required.every(id => CAPABILITY_REGISTRY_SOURCE.capabilities.some(def =>
    def.id === id && def.lifecycle.availability === "ENABLED" &&
    def.lifecycle.executionStatus === "ACTIVE" && selected.has(def.id + "@" + def.version)));
}

function composeInput(scope: ComposeScope, coverage: CoverageResult, feedback: readonly ValidationIssueFeedback[]): JsonRecord {
  return {
    resolved_intent: scope.resolved as unknown as JsonValue,
    ephemeral_resolved_context: scope.ephemeral as unknown as JsonValue,
    accepted_visible_assumptions: scope.resolved.accepted_assumptions as unknown as JsonValue,
    capability_coverage_result: { ...coverageSupport(coverage), selected: coverage.selected.map((ref) => ({ ...ref })),
      ...(coverage.certifiedProfile === undefined ? {} : { certified_profile: coverage.certifiedProfile }) },
    compiler_catalog: compilerCatalog(coverage),
    f02_blueprint_contract: { schema_version: BLUEPRINT_SCHEMA_VERSION, max_candidate_payload_bytes: MAX_CANDIDATE_PAYLOAD_BYTES },
    security_resource_policy: { executable_code: "FORBIDDEN", provider_runtime_config: "FORBIDDEN" },
    existing_blueprint: null,
    prompt_version: (coverage.certifiedProfile === "RECORD_LIST" || coverage.certifiedProfile === "RECORD_LIST_TODAY") ? PROMPT_B_PLAN_VERSION : PROMPT_B_VERSION,
    schema_version: BLUEPRINT_SCHEMA_VERSION,
    registry_version: coverage.registryVersion,
    model_adapter: scope.dependencies.gateway.modelAdapter,
    evaluation_fixture_version: EVALUATION_FIXTURE_VERSION,
    previous_validation_issues: feedback.map((issue) => ({ ...issue }))
  };
}

/**
 * Any JSON object Prompt B returns is a candidate for F02. Non-object output, or output carrying a request-scoped
 * DO_NOT_PERSIST value (F01-DATA-005 rule 3 / BF-050), is invalid model output (F01-ERR-007): it never reaches
 * F02 validation / admission, so no validation_run, Blueprint content or replay truth can hold the value.
 */
function candidateAcceptor(ephemeral: EphemeralResolvedContext): (output: JsonValue) => JsonValue | null {
  const carriesEphemeralValue = ephemeralValueDetector(ephemeral);
  return (output) => (isPlainRecord(output) && !carriesEphemeralValue(output) ? output : null);
}

async function validateAndAdmit(scope: ComposeScope, candidate: JsonValue, compilerRunId: string): Promise<Verdict> {
  const { dependencies } = scope;
  const result = validateBlueprintCandidate(new TextEncoder().encode(JSON.stringify(candidate)), {
    traceId: scope.traceId,
    validationRunId: dependencies.newId(),
    ...(dependencies.validatorRegistry === undefined ? {} : { registry: dependencies.validatorRegistry })
  });
  const admission = await admitBlueprint(result, dependencies.admission, { compilerRunId, now: dependencies.clock, ...(dependencies.evidence === undefined ? {} : { evidence: dependencies.evidence }) });
  if (admission.status === "ADMITTED") {
    if (admission.trustStatus === "VALIDATED") return { admitted: true, validationRunId: admission.validationRunId, contentHash: admission.contentHash };
    const code = admission.trustStatus === "REVOKED" ? "F02-ERR-016" : "F02-ERR-017";
    return { admitted: false, classified: classifyRejection([code]), incompatible: admission.trustStatus === "INCOMPATIBLE", issues: [{ error_code: code, stage: "V12", json_path: "$" }] };
  }
  const issues = admission.report.issues.slice(0, 16).map((issue) => ({
    error_code: issue.error_code, stage: issue.stage, json_path: issue.json_path,
    ...(canonicalRepairHint(issue.error_code, issue.stage, issue.json_path) === undefined ? {} :
      { repair_hint: canonicalRepairHint(issue.error_code, issue.stage, issue.json_path) })
  }));
  return { admitted: false, classified: classifyRejection(admission.report.issues.map((issue) => issue.error_code)), incompatible: admission.report.status === "INCOMPATIBLE", issues };
}

/** F01-RQ-008A rules 3–6: terminal classes never downgrade; exhausted fixable → F01-ERR-011 / INCOMPATIBLE. */
function terminalDisposition(verdict: Extract<Verdict, { admitted: false }>): TerminalDisposition {
  const { rejection_class: rejectionClass, error_code: errorCode } = verdict.classified;
  if (rejectionClass === "SECURITY_TERMINAL") {
    const error = errorCode === "F02-ERR-015" ? new IntentApiError("F01-ERR-014") : new IntentApiError("F01-ERR-012");
    return { lifecycle: "VALIDATION_REJECTED", error, terminal: true };
  }
  const details = { rejection_class: rejectionClass };
  if (rejectionClass === "RESOURCE_TERMINAL") return { lifecycle: "VALIDATION_REJECTED", error: new IntentApiError("F01-ERR-011", { details, retryable: false }), terminal: true };
  if (verdict.incompatible) return { lifecycle: "INCOMPATIBLE", error: new IntentApiError("F01-ERR-011", { details, retryable: false }), terminal: true };
  return { lifecycle: "VALIDATION_REJECTED", error: new IntentApiError("F01-ERR-011", { details, retryable: true }), terminal: false };
}

class ComposeLoop {
  private version: number;
  private coverage: CoverageResult;
  private recomposesRemaining: number;
  private readonly blueprintBudget: BlueprintAttemptBudget;
  private readonly acceptCandidate: (output: JsonValue) => JsonValue | null;

  public constructor(private readonly scope: ComposeScope, startVersion: number, coverage: CoverageResult) {
    this.version = startVersion;
    this.coverage = coverage;
    // A large, genuine resolved intent needs a longer uninterrupted first model
    // generation. Still three calls maximum and <=110s total, with no F02 bypass.
    this.blueprintBudget = new BlueprintAttemptBudget(
      scope.resolved.capability_requirements.length >= 8 && !isCertifiedPlanEligible(coverage)
        ? COMPLEX_BLUEPRINT_ATTEMPT_TIMEOUTS_MS : undefined
    );
    this.recomposesRemaining = scope.recomposeAvailable ? (scope.maxValidationRecomposes ?? 1) : 0;
    this.acceptCandidate = candidateAcceptor(scope.ephemeral);
  }

  private retentionDeadline(): string {
    return new Date(this.scope.dependencies.clock().getTime() + RAW_INTENT_RETENTION_MS).toISOString();
  }

  public async transition(lifecycle: IntentLifecycleStatus, terminal = false): Promise<void> {
    const { dependencies, guard, intentId } = this.scope;
    this.version = requireTransition(await dependencies.intents.transitionIntent(guardNow(guard, dependencies), {
      intent_id: intentId,
      expected_version: this.version,
      lifecycle_status: lifecycle,
      ...(terminal ? { expires_at: this.retentionDeadline() } : {})
    }));
  }

  private async fail(lifecycle: IntentLifecycleStatus, error: IntentApiError, terminal: boolean): Promise<never> {
    await this.transition(lifecycle, terminal);
    throw error;
  }

  private async compose(feedback: readonly ValidationIssueFeedback[]): Promise<{ candidate: JsonValue; compilerRunId: string }> {
    const { dependencies, guard, deadline, intentId, traceId, evidence } = this.scope;
    const planMode = isCertifiedPlanEligible(this.coverage);
    const version = planMode ? PROMPT_B_PLAN_VERSION : PROMPT_B_VERSION;
    const versions = { prompt_version: version, model_adapter: dependencies.gateway.modelAdapter, blueprint_schema_version: BLUEPRINT_SCHEMA_VERSION, registry_version: this.coverage.registryVersion };
    evidence.add("F01-EVT-009", versions);
    console.warn("APPF2_F02_COVERAGE_SELECTED_COUNT=" + this.coverage.selected.length +
      " STATUS=" + this.coverage.status +
      " PROFILE=" + (this.coverage.certifiedProfile ?? "NONE"));
    try {
      const composed = await callProviderWithBoundedRetry(
        { gateway: dependencies.gateway, runs: dependencies.runs, guard, deadline, intentId, traceId, registryVersion: this.coverage.registryVersion, now: dependencies.clock, newId: dependencies.newId, evidence, blueprintBudget: this.blueprintBudget },
        { operation: "BLUEPRINT_COMPOSE", promptVersion: version, schemaVersion: BLUEPRINT_SCHEMA_VERSION,
          responseSchema: planMode ? COMPOSITION_PLAN_SCHEMA as unknown as JsonRecord : composeResponseSchema(this.coverage.selected),
          inputPayload: composeInput(this.scope, this.coverage, feedback),
          accept: (value: JsonValue): JsonValue | null => {
            if (!planMode) return this.acceptCandidate(value);
            const output = this.acceptCandidate(value);
            if (output === null) return null;
            try {
              parseCompositionPlan(output, new Set(this.scope.resolved.capability_requirements.map(r => r.requirement_id)),
                new Set(this.scope.resolved.capability_requirements.filter(r => r.required).map(r => r.requirement_id)));
              return output;
            } catch (error) {
              if (error instanceof CompositionPlanError) return null;
              throw error;
            }
          }, rejectedOutputCode: "F01-ERR-007" }
      );
      evidence.add("F01-EVT-010", { ...versions, attempt_no: composed.attemptNo, latency_ms: composed.latencyMs });
      this.scope.progress?.complete("F01-CREATE-CP-05");
      if (planMode) {
        try {
          const plan = parseCompositionPlan(composed.value,
            new Set(this.scope.resolved.capability_requirements.map(r => r.requirement_id)),
            new Set(this.scope.resolved.capability_requirements.filter(r => r.required).map(r => r.requirement_id)));
          if (plan.modules.some(module => module.kind !== "RECORD_LIST")) {
            return this.fail("INCOMPATIBLE", new IntentApiError("F01-ERR-008"), true);
          }
          const candidate = lowerCompositionPlan(plan, {
            coverage: this.coverage,
            validRequirementIds: new Set(this.scope.resolved.capability_requirements.map(r => r.requirement_id))
          });
          return { candidate: candidate as unknown as JsonValue, compilerRunId: composed.compilerRunId };
        } catch (error) {
          if (!(error instanceof CompositionPlanError)) throw error;
          if (error.code === "COMPOSITION_UNSUPPORTED") return this.fail("INCOMPATIBLE", new IntentApiError("F01-ERR-008"), true);
          return this.fail("COMPOSITION_FAILED", new IntentApiError(error.code === "LOWERING_GRAPH_INVALID" ? "F01-ERR-014" : "F01-ERR-007"), false);
        }
      }
      return { candidate: composed.value, compilerRunId: composed.compilerRunId };
    } catch (error: unknown) {
      if (!(error instanceof IntentApiError) || error instanceof StaleAttemptError) throw error;
      evidence.add("F01-EVT-011", versions, isF01ErrorCode(error.failure.code) ? error.failure.code : undefined);
      return this.fail("COMPOSITION_FAILED", error, false);
    }
  }

  /** CAPABILITY_FIXABLE: refresh F04 once before the single recompose; UNSUPPORTED / EXTERNAL becomes F01-ERR-008. */
  private async prepareRecompose(verdict: Extract<Verdict, { admitted: false }>): Promise<void> {
    this.recomposesRemaining -= 1;
    this.scope.evidence.add("F01-EVT-012", { blueprint_schema_version: BLUEPRINT_SCHEMA_VERSION, registry_version: this.coverage.registryVersion });
    if (verdict.classified.rejection_class === "CAPABILITY_FIXABLE") {
      this.coverage = this.scope.refreshCoverage();
      this.scope.evidence.add("F01-EVT-008", { coverage_status: this.coverage.status, registry_version: this.coverage.registryVersion });
      if (!isCoverageAllowed(this.coverage)) await this.fail("INCOMPATIBLE", new IntentApiError("F01-ERR-008", { details: { coverage_status: this.coverage.status } }), true);
    }
    await this.transition("COMPOSING");
  }

  public async run(): Promise<ComposeOutcome> {
    let feedback: readonly ValidationIssueFeedback[] = [];
    for (;;) {
      const { candidate, compilerRunId } = await this.compose(feedback);
      await this.transition("VALIDATING");
      const verdict = await validateAndAdmit(this.scope, candidate, compilerRunId);
      if (verdict.admitted) {
        await this.transition("VALIDATED", true);
        this.scope.progress?.complete("F01-CREATE-CP-06");
        this.scope.evidence.add("F01-EVT-013", { blueprint_schema_version: BLUEPRINT_SCHEMA_VERSION, registry_version: this.coverage.registryVersion, coverage_status: this.coverage.status });
        return { validationRunId: verdict.validationRunId, contentHash: verdict.contentHash, coverage: this.coverage, intentVersion: this.version };
      }
      if (!isFixableClass(verdict.classified.rejection_class) || this.recomposesRemaining <= 0 || this.blueprintBudget.remaining <= 0) {
        const disposition = terminalDisposition(verdict);
        await this.fail(disposition.lifecycle, disposition.error, disposition.terminal);
      }
      await this.prepareRecompose(verdict);
      feedback = accumulateValidationIssues(feedback, verdict.issues);
    }
  }
}

/**
 * F01-RQ-006/008: every Prompt B candidate goes through F02 validate + admit (never bypassed or locally
 * mutated); VALIDATED only after F02 PASS; at most one validation-driven recompose per logical compile.
 */
export async function composeAndValidate(scope: ComposeScope, composingVersion: number, coverage: CoverageResult): Promise<ComposeOutcome> {
  return new ComposeLoop(scope, composingVersion, coverage).run();
}
