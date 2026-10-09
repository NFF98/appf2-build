type ProgressMeterProps = {
  /** Floored checkpoint-derived percentage supplied by the owner Function's truth; never time-derived. */
  readonly percent: number;
  readonly label: string;
  /** Stage text that gives the number its meaning for assistive technology. */
  readonly stage: string | null;
};

/**
 * O05 DETERMINATE mode: number (Ink, tabular) + Teal → Aqua rail with a real `progressbar` value. The fill moves
 * only when the value changes; there is no pulse, crawl, ETA or Yellow below 100%.
 */
export function ProgressMeter({ percent, label, stage }: ProgressMeterProps) {
  return (
    <div className="progress-meter">
      <span className="progress-value" aria-hidden="true">
        {percent}%
      </span>
      <div
        className="progress-rail"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        aria-valuetext={stage === null ? `${percent}%` : `${percent}%，${stage}`}
      >
        <span className="progress-fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}
