import { createExecutionAdmissionService, type ExecutionAdmission } from "../../../src/platform/blueprint/execution-admission.js";
import { CURRENT_BUNDLED_RELEASE, createBundledReleaseSource } from "../../../src/platform/capabilities/bundled-release.js";
import { BLUEPRINT_SCHEMA_RANGE, RUNTIME_VERSION } from "../../../src/platform/capabilities/registry.js";
import { CORE_CAPABILITY_HANDLERS } from "../../../src/platform/runtime/core-handlers.js";
import { validBlueprint } from "../../contract/blueprint-validation-fixtures.js";
import { storedContent } from "../../contract/execution-safety-fixtures.js";

/** ORIGINAL = the creator's own App; SHARED_SOURCE = the same App opened with Share-like source metadata. */
export type S03Variant = "ORIGINAL" | "SHARED_SOURCE";

/**
 * A fresh, real EXECUTION-ADMISSION decision (production service, bundled release, production handler catalog) for
 * the F02 fixture Blueprint, so the browser hydration gate re-verifies hash, freshness and pinned release itself.
 */
export async function freshAdmittedBlueprint(variant: S03Variant): Promise<{ readonly admission: ExecutionAdmission; readonly body: string }> {
  const blueprint = validBlueprint();
  if (variant === "SHARED_SOURCE") blueprint.meta = { title: "朋友分享的聚餐分帳", description: "從分享連結開啟的版本" };
  const stored = storedContent(blueprint, CURRENT_BUNDLED_RELEASE);
  const service = createExecutionAdmissionService({
    content: { readContent: async (hash) => (hash === stored.content_hash ? stored : undefined) },
    releases: createBundledReleaseSource({ bundledHandlers: CORE_CAPABILITY_HANDLERS }),
    runtimeVersion: RUNTIME_VERSION,
    supportedBlueprintSchemaRange: BLUEPRINT_SCHEMA_RANGE
  });
  const decision = await service.admit(stored.content_hash);
  if (!decision.executable) throw new Error(`fixture Blueprint was not admitted (${decision.step})`);
  return { admission: decision.admission, body: String(stored.canonical_blueprint) };
}
