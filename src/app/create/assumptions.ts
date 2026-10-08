import type { JsonValue } from "../../platform/intent/json-value.js";
import type { AssumptionClassification } from "../../platform/intent/visible-assumptions.js";
import type { AssumptionDecisionRequest, VisibleAssumptionView } from "./f01-wire.js";

/** F00-UX-010 user-facing source labels; the raw provenance enum is never shown. */
export const SOURCE_LABELS: Readonly<Record<AssumptionClassification, string>> = Object.freeze({
  FACT: "已提供",
  DEFAULT: "預設",
  PROPOSAL: "建議",
  UNKNOWN: "尚未決定"
});

/** Only DEFAULT / PROPOSAL are pending decisions F01 accepts Accept / Edit / Reject for (F01-DATA-004). */
export function isDecidable(assumption: VisibleAssumptionView): boolean {
  return assumption.classification === "DEFAULT" || assumption.classification === "PROPOSAL";
}

/** The value F01 currently presents: FACT → resolved_value, DEFAULT / PROPOSAL → proposed_default. */
export function presentedValue(assumption: VisibleAssumptionView): JsonValue | undefined {
  return assumption.classification === "FACT" ? assumption.resolved_value : assumption.proposed_default;
}

export type EditorKind = "TEXT" | "NUMBER" | "BOOLEAN";

/**
 * The F01-DATA-004 projection carries no expected_value_type, so a scalar editor follows the presented
 * value's JSON type and F01 re-validates the edit. Composite proposals have no faithful inline editor.
 */
export function editorKindOf(assumption: VisibleAssumptionView): EditorKind | null {
  const value = presentedValue(assumption);
  if (typeof value === "number") return "NUMBER";
  if (typeof value === "boolean") return "BOOLEAN";
  if (typeof value === "string") return "TEXT";
  return null;
}

/** Local, unsent User choice. It never changes the F01 source label; only the F01 response can. */
export type AssumptionDraft =
  | { readonly decision: "ACCEPT" }
  | { readonly decision: "REJECT" }
  | { readonly decision: "EDIT"; readonly text: string; readonly flag: boolean | null };

export type EditValue = { readonly ok: true; readonly value: JsonValue } | { readonly ok: false };

export function editValue(kind: EditorKind, draft: Extract<AssumptionDraft, { decision: "EDIT" }>): EditValue {
  if (kind === "BOOLEAN") return draft.flag === null ? { ok: false } : { ok: true, value: draft.flag };
  const trimmed = draft.text.trim();
  if (trimmed.length === 0) return { ok: false };
  if (kind === "TEXT") return { ok: true, value: draft.text };
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false };
}

export function startEdit(assumption: VisibleAssumptionView): AssumptionDraft {
  const value = presentedValue(assumption);
  return { decision: "EDIT", text: typeof value === "string" || typeof value === "number" ? String(value) : "", flag: typeof value === "boolean" ? value : null };
}

export type DecisionPlan =
  | { readonly ok: true; readonly decisions: readonly AssumptionDecisionRequest[] }
  | { readonly ok: false; readonly invalidIds: readonly string[] };

/**
 * Builds F01-API-002 `assumption_decisions[]` from explicit User choices. When the User confirms with
 * 「用這些設定繼續」 every still-undecided visible DEFAULT / PROPOSAL is sent as ACCEPT, so F01 — not the
 * Shell — performs the USER_ACCEPTED_PROPOSAL transition.
 */
export function planDecisions(
  assumptions: readonly VisibleAssumptionView[],
  drafts: Readonly<Record<string, AssumptionDraft>>,
  acceptUndecided: boolean
): DecisionPlan {
  const decisions: AssumptionDecisionRequest[] = [];
  const invalidIds: string[] = [];
  for (const assumption of assumptions.filter(isDecidable)) {
    const draft = drafts[assumption.assumption_id];
    const id = assumption.assumption_id;
    if (draft === undefined) {
      if (acceptUndecided) decisions.push({ assumption_id: id, decision: "ACCEPT" });
    } else if (draft.decision !== "EDIT") {
      decisions.push({ assumption_id: id, decision: draft.decision });
    } else {
      const kind = editorKindOf(assumption);
      const edited = kind === null ? { ok: false as const } : editValue(kind, draft);
      if (edited.ok) decisions.push({ assumption_id: id, decision: "EDIT", edited_value: edited.value });
      else invalidIds.push(id);
    }
  }
  return invalidIds.length > 0 ? { ok: false, invalidIds } : { ok: true, decisions };
}
