import { STAGE_LABELS, type StageView } from "./creation-session.js";

const SHORT_LABELS = ["理解", "整理", "檢查", "準備"] as const;

function stageState(view: StageView, index: number): "done" | "current" | "future" {
  if (index < view.completed) return "done";
  return index === view.current ? "current" : "future";
}

const STATE_TEXT = { done: "已完成", current: "進行中", future: "尚未開始" } as const;

/**
 * S02 Creation Progress, stage-only presentation: no reliable work-completion checkpoints are projected here,
 * so no percentage is shown and the bounded activity indicator appears only while a request is in flight.
 * State is carried by icon + text + aria-current, never by color or motion alone.
 */
export function StageProgress({ view }: { readonly view: StageView }) {
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
      <div className={`activity-rail${view.active ? " is-active" : ""}`} aria-hidden="true">
        <span className="activity-fill" style={{ width: `${(view.completed / STAGE_LABELS.length) * 100}%` }} />
        {view.active ? <span className="activity-pulse" /> : null}
      </div>
    </section>
  );
}
