import { useSyncExternalStore } from "react";

import { ProgressMeter } from "../progress/ProgressMeter.js";
import type { RuntimeProcessingPresenter } from "./runtime-processing.js";

const STAGE_COPY = "正在確認互動可以執行…";
const LONG_WAIT_COPY = "還在處理這一步，你的內容都還在。";

/**
 * O05 S03 in-place compact processing layer for the current admitted Runtime operation. It renders only while
 * F03 reports the operation open and disappears in the same update that delivers COMMITTED; the App stays visible.
 */
export function RuntimeProcessingLayer({ presenter }: { readonly presenter: RuntimeProcessingPresenter }) {
  const { processing } = useSyncExternalStore(presenter.subscribe, presenter.getSnapshot, presenter.getSnapshot);
  if (processing === null) return null;
  return (
    <div className="runtime-processing" role="status" aria-live="polite">
      <p className="runtime-processing-stage">{STAGE_COPY}</p>
      {processing.percent === null ? (
        <span className="runtime-activity" aria-hidden="true" />
      ) : (
        <ProgressMeter percent={processing.percent} label="操作進度" stage={STAGE_COPY} />
      )}
      {processing.longWait ? <p className="runtime-processing-wait">{LONG_WAIT_COPY}</p> : null}
    </div>
  );
}
