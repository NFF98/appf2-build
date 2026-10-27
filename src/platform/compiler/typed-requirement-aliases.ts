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

/** Preserve a single explicitly named Walking habit from trusted resolved
 * semantics when a planner emits a generic activity label. Does not add a
 * module, invent a required feature, touch IDs or alter multi-habit requests. */
export function alignExplicitWalkingHabit(raw:JsonValue,resolved:ResolvedIntent,
  originalUserIntent?:string):JsonValue {
  if(!isPlainRecord(raw) || !Array.isArray(raw.modules)) return raw;
  const modules=raw.modules.filter(m=>isPlainRecord(m) && m.kind==="HABIT");
  if(modules.length!==1) return raw;
  const explicit=[originalUserIntent??"",JSON.stringify(resolved.goal),
    ...resolved.capability_requirements.map(r=>r.semantic_need)]
    .some(text=>/\bwalking\b/i.test(text));
  if(!explicit) return raw;
  return {...raw,modules:raw.modules.map(m=>
    isPlainRecord(m) && m.kind==="HABIT" ? {...m,habit_label:"Walking"} : m
  )};
}

/** Model-facing module keys are untrusted. A single prior task list is an
 * unambiguous source for a requested TODAY_SUMMARY; today's completion must
 * be tracked by that task list, not fabricated from all-time counts.
 * Only repair when the ORIGINAL user explicitly requested daily completion. */
export function alignExplicitTodaySummary(raw:JsonValue,originalUserIntent?:string):JsonValue {
  if(!isPlainRecord(raw) || !Array.isArray(raw.modules) ||
    typeof originalUserIntent!=="string" ||
    !/(?:今天|今日|本日).{0,20}(?:完成|做完)|today.{0,20}(?:complet|finish|done)/i.test(originalUserIntent))
    return raw;
  const modules=raw.modules;
  const today=modules.map((m,i)=>({m,i})).filter(x=>isPlainRecord(x.m) && x.m.kind==="TODAY_SUMMARY");
  const lists=modules.map((m,i)=>({m,i})).filter(x=>isPlainRecord(x.m) && x.m.kind==="RECORD_LIST");
  if(today.length!==1 || lists.length!==1 || lists[0]!.i>=today[0]!.i ||
    !isPlainRecord(lists[0]!.m) || typeof lists[0]!.m.key!=="string" ||
    !/^[a-z][a-z0-9_]{0,63}$/.test(lists[0]!.m.key)) return raw;
  const list=lists[0]!;
  return {...raw,modules:modules.map((m,i)=>{
    if(i===list.i && isPlainRecord(m)) return {...m,track_day:true};
    if(i===today[0]!.i && isPlainRecord(m)) return {...m,source_key:list.m.key};
    return m;
  })};
}
