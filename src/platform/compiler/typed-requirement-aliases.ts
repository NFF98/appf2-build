import { isPlainRecord, type JsonRecord, type JsonValue } from "../intent/json-value.js";
import type { ResolvedIntent } from "../intent/resolved-intent.js";

/** Short model-facing handles reduce errors when a complex intent carries
 * dozens of immutable SHA256 references. Only trusted server order defines
 * the mapping. Nothing is written to the F01 durable ResolvedIntent. */
export function aliasResolvedRequirements(resolved: ResolvedIntent): JsonRecord {
  return {
    ...resolved,
    capability_requirements: resolved.capability_requirements.map((requirement, index) => ({
      ...requirement, requirement_id: "req_" + (index + 1)
    }))
  } as unknown as JsonRecord;
}

/** Restore reference identity BEFORE strict CompositionPlan validation. Unknown
 * aliases and arbitrary model IDs remain unchanged and are rejected by the
 * original allowlist. Never infer missing features or synthesize IDs. */
export function restorePlanRequirementIds(
  raw: JsonValue, original: ResolvedIntent["capability_requirements"]
): JsonValue {
  if (!isPlainRecord(raw) || !Array.isArray(raw.modules)) return raw;
  return {...raw, modules:raw.modules.map(module => {
    if (!isPlainRecord(module) || !Array.isArray(module.requirement_ids)) return module;
    return {...module, requirement_ids:module.requirement_ids.map(id => {
      if (typeof id !== "string") return id;
      const match = /^req_([1-9][0-9]{0,2})$/.exec(id);
      if (match === null) return id;
      return original[Number(match[1]) - 1]?.requirement_id ?? id;
    })};
  })};
}
