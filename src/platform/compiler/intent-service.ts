import { compileIntent } from "./compile-intent.js";
import { createIntent, type CreateIntentCommand } from "./create-intent.js";
import { IntentApiError, toIntentApiFailure } from "./f01-errors.js";
import {
  resolveDependencies,
  type IntentServiceDependencies,
  type IntentServiceResult,
  type ResolvedServiceDependencies
} from "./intent-operation.js";
import type { ScopedIntentCommand } from "./scoped-intent.js";
import { submitAnswers } from "./submit-answers.js";

export type { CreateIntentCommand } from "./create-intent.js";
export type { IntentServiceDependencies, IntentServiceResult } from "./intent-operation.js";
export type { ScopedIntentCommand } from "./scoped-intent.js";

/**
 * F01 server boundary (IntentAnalyzer → ClarificationPolicyEngine → IntentResolver → CapabilityRequirementExtractor
 * → CapabilityCoverageClient → BlueprintComposer → BlueprintValidatorClient). Provider SDKs / secrets stay behind
 * the injected ModelGateway; no domain error ever escapes as an exception.
 */
export class IntentCompilerService {
  private readonly dependencies: ResolvedServiceDependencies;

  public constructor(dependencies: IntentServiceDependencies) {
    this.dependencies = resolveDependencies(dependencies);
  }

  public createIntent(command: CreateIntentCommand): Promise<IntentServiceResult> {
    return this.boundary(() => createIntent(this.dependencies, command));
  }

  public submitAnswers(command: ScopedIntentCommand): Promise<IntentServiceResult> {
    return this.boundary(() => submitAnswers(this.dependencies, command));
  }

  public compileIntent(command: ScopedIntentCommand): Promise<IntentServiceResult> {
    return this.boundary(() => compileIntent(this.dependencies, command));
  }

  private async boundary(run: () => Promise<IntentServiceResult>): Promise<IntentServiceResult> {
    try {
      return await run();
    } catch (error: unknown) {
      const failure = toIntentApiFailure(error);
      if (failure !== null) return { ok: false, failure };
      try {
        this.dependencies.evidence?.diagnostics.reportNonBlockingFailure(error);
      } catch {
        // Diagnostics must never change the API outcome.
      }
      return { ok: false, failure: new IntentApiError("F01-ERR-014").failure };
    }
  }
}
