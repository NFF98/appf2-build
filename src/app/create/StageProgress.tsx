import { ProgressMeter } from "../progress/ProgressMeter.js";
import { STAGE_LABELS, type CreateProgressView } from "./create-progress.js";

const SHORT_LABELS = ["理解", "整理", "檢查", "準備"] as const;

function stageState(view: CreateProgressView, index: number): "done" | "current" | "future" {
  if (index < view.completedStages) return "done";
  return index === view.currentStage ? "current" : "future";
}

const STATE_TEXT = { done: "已完成", current: "進行中", future: "尚未開始" } as const;

/**
 * S02 Creation Progress. With a reliable composite checkpoint snapshot it is O05 DETERMINATE (Stage + % + rail);
 * without one it stays INDETERMINATE (Stage + bounded activity indicator only while a request is in flight).
 * State is carried by icon + text + aria-current, never by color or motion alone.
 */
export function StageProgress({ view }: { readonly view: CreateProgressView }) {
  return (
    <section className="stage-progress" aria-label="建立進度">
      <ol className="stage-list">
        {STAGE_LABELS.map((label, index) => {
          const state = stageState(view, index);
          return (
            <li key={label} className={`stage stage-${state}`} aria-current={state === "current" ? "step" : undefined}>
              <span className="stage-marker" aria-hidden="true">
                {state === "done" ? "✓" : null}
              </span>
              <span className="stage-label stage-label-full">{label}</span>
              <span className="stage-label stage-label-short" aria-hidden="true">
                {SHORT_LABELS[index]}
              </span>
              <span className="sr-only">（{STATE_TEXT[state]}）</span>
            </li>
          );
        })}
      </ol>
      {view.percent === null ? (
        <div className={`activity-rail${view.active ? " is-active" : ""}`} aria-hidden="true">
          <span className="activity-fill" style={{ width: `${(view.completedStages / STAGE_LABELS.length) * 100}%` }} />
          {view.active ? <span className="activity-pulse" /> : null}
        </div>
      ) : (
        <ProgressMeter percent={view.percent} label="建立進度" stage={view.currentStage === null ? null : STAGE_LABELS[view.currentStage]} />
      )}
    </section>
  );
}
