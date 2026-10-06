import { collectEphemeralRequirementViolations } from "../intent/envelope-validation.js";
import { internalInvariant, type EphemeralInputRequirement, type KnownInput } from "../intent/intent-contract.js";
import { canonicalJson, isPlainRecord, type JsonValue } from "../intent/json-value.js";
import type { EphemeralResolvedContext } from "../intent/resolved-intent.js";
import { valueMatchesType } from "../intent/value-shape.js";
import { IntentApiError } from "./f01-errors.js";

type EphemeralInputReason = "EPHEMERAL_INPUT_REQUIRED" | "EPHEMERAL_INPUT_INVALID";

export type SubmittedEphemeralInput = {
  readonly id: string;
  readonly value: JsonValue;
};

export type EphemeralBinding = {
  /** Validated `ephemeral_inputs[]` sorted by marker id (the canonical digest form); `undefined` when omitted. */
  readonly submitted: readonly SubmittedEphemeralInput[] | undefined;
  readonly context: EphemeralResolvedContext;
};

/** BF-050 stable F01-ERR-001: details carry only sorted marker IDs, never a submitted value or unknown Client ID. */
function bindingError(reason: EphemeralInputReason, markerIds: readonly string[]): IntentApiError {
  return new IntentApiError("F01-ERR-001", { details: { reason, input_ids: [...new Set(markerIds)].sort() } });
}

/** Marker list of a server-persisted `structured_intent`; a malformed persisted list is an internal invariant fault. */
export function durableEphemeralRequirements(structuredIntent: JsonValue | null): readonly EphemeralInputRequirement[] {
  if (!isPlainRecord(structuredIntent) || structuredIntent.ephemeral_input_requirements === undefined) return [];
  const markers = structuredIntent.ephemeral_input_requirements;
  if (collectEphemeralRequirementViolations(markers).length > 0) {
    internalInvariant("PERSISTED_EPHEMERAL_REQUIREMENTS_INVALID", "$.structured_intent.ephemeral_input_requirements");
  }
  return markers as unknown as readonly EphemeralInputRequirement[];
}

function isBindingEntry(entry: unknown): entry is { readonly id: string; readonly value: JsonValue } {
  return isPlainRecord(entry) && typeof entry.id === "string" && Object.hasOwn(entry, "value") && Object.keys(entry).length === 2;
}

/** Each entry must be exactly `{id, value}`, name a marker once and fit its canonical value_type. */
function collectValues(requirements: readonly EphemeralInputRequirement[], raw: readonly unknown[]): Map<string, JsonValue> {
  const markers = new Map(requirements.map((requirement) => [requirement.id, requirement]));
  const values = new Map<string, JsonValue>();
  const invalidMarkerIds: string[] = [];
  let invalid = false;
  for (const entry of raw) {
    const marker = isPlainRecord(entry) && typeof entry.id === "string" ? markers.get(entry.id) : undefined;
    if (marker === undefined || !isBindingEntry(entry) || values.has(marker.id) || !valueMatchesType(entry.value, marker.value_type)) {
      invalid = true;
      if (marker !== undefined) invalidMarkerIds.push(marker.id);
      continue;
    }
    values.set(marker.id, entry.value);
  }
  if (invalid) throw bindingError("EPHEMERAL_INPUT_INVALID", invalidMarkerIds);
  return values;
}

/**
 * BF-050 compile binding, run before COMPOSING and before any ModelGateway call: every durable marker gets
 * exactly one submitted value of its canonical type, and the join of marker metadata + value becomes the
 * request-scoped EphemeralResolvedContext. Nothing here is written anywhere; `requirements` must be id-sorted.
 */
export function bindEphemeralInputs(requirements: readonly EphemeralInputRequirement[], raw: unknown): EphemeralBinding {
  if (raw === undefined) {
    if (requirements.length > 0) throw bindingError("EPHEMERAL_INPUT_REQUIRED", requirements.map((requirement) => requirement.id));
    return { submitted: undefined, context: { inputs: [] } };
  }
  if (!Array.isArray(raw)) throw bindingError("EPHEMERAL_INPUT_INVALID", []);
  const values = collectValues(requirements, raw);
  const missing = requirements.filter((requirement) => !values.has(requirement.id)).map((requirement) => requirement.id);
  if (missing.length > 0) throw bindingError("EPHEMERAL_INPUT_REQUIRED", missing);
  const bound = requirements.map((requirement) => ({ requirement, value: values.get(requirement.id) as JsonValue }));
  return {
    submitted: bound.map(({ requirement, value }) => ({ id: requirement.id, value })),
    context: {
      inputs: bound.map(({ requirement, value }): KnownInput => ({ ...requirement, value, sensitivity: "DO_NOT_PERSIST" }))
    }
  };
}

type JsonScalar = Exclude<JsonValue, object>;

/** Stack-safe visit of every scalar leaf of `root`; object keys are reported only when `onKey` is given. */
function visitScalars(root: JsonValue, onScalar: (value: JsonScalar) => void, onKey?: (key: string) => void): void {
  const pending: JsonValue[] = [root];
  while (pending.length > 0) {
    const value = pending.pop() as JsonValue;
    if (Array.isArray(value)) {
      for (const entry of value as readonly JsonValue[]) pending.push(entry);
    } else if (isPlainRecord(value)) {
      for (const [key, entry] of Object.entries(value as Readonly<Record<string, JsonValue>>)) {
        onKey?.(key);
        pending.push(entry);
      }
    } else {
      onScalar(value as JsonScalar);
    }
  }
}

/**
 * BF-050 non-persistence guard over untrusted Prompt B output: true when any scalar leaf of a request-scoped
 * DO_NOT_PERSIST value appears anywhere in `candidate`, as an equal scalar / object key (type-exact canonical
 * JSON) or as non-empty text inside any string. Fail-closed by design (a coincidental match also blocks); the
 * verdict carries no value. Needles are prepared once per compile; each check is one candidate traversal.
 */
export function ephemeralValueDetector(context: EphemeralResolvedContext): (candidate: JsonValue) => boolean {
  if (context.inputs.length === 0) return () => false;
  const needleScalars = new Set<string>();
  const needleTexts = new Set<string>();
  for (const input of context.inputs) {
    visitScalars(input.value, (value) => {
      const canonical = canonicalJson(value);
      needleScalars.add(canonical);
      const text = typeof value === "string" ? value : canonical;
      if (text.length > 0) needleTexts.add(text);
    });
  }
  const fragments = [...needleTexts];
  return (candidate) => {
    const strings = new Set<string>();
    const scalars = new Set<string>();
    const collect = (value: JsonScalar): void => {
      if (typeof value === "string") strings.add(value);
      scalars.add(canonicalJson(value));
    };
    visitScalars(candidate, collect, collect);
    for (const scalar of needleScalars) if (scalars.has(scalar)) return true;
    for (const text of strings) if (fragments.some((fragment) => text.includes(fragment))) return true;
    return false;
  };
}
