import type { ReactNode } from "react";

import type { CapsulePreviewKind } from "./capsules.js";

const Row = ({ label, value }: { readonly label: string; readonly value: string }) => (
  <div className="pv-row">
    <span>{label}</span>
    <strong>{value}</strong>
  </div>
);

const ItineraryPreview = () => (
  <>
    <div className="pv-title">東京 3 天行程</div>
    <div className="pv-tabs">
      <span className="is-on">Day 1</span>
      <span>Day 2</span>
      <span>Day 3</span>
    </div>
    <Row label="09:00" value="淺草寺" />
    <Row label="12:00" value="築地市場" />
    <Row label="15:00" value="晴空塔" />
  </>
);

const BudgetPreview = () => (
  <>
    <div className="pv-title">本月預算</div>
    <div className="pv-split">
      <div className="pv-donut" />
      <div className="pv-stack">
        <Row label="收入" value="$50,000" />
        <Row label="支出" value="$32,500" />
        <Row label="剩餘" value="$17,500" />
      </div>
    </div>
  </>
);

const HabitPreview = () => (
  <>
    <div className="pv-title">我的習慣</div>
    {["喝水 2000ml", "閱讀 20 分鐘", "早睡"].map((habit, row) => (
      <div className="pv-habit" key={habit}>
        <span>{habit}</span>
        <span className="pv-dots">
          {[0, 1, 2, 3, 4].map((day) => (
            <i key={day} className={day <= row + 2 ? "is-done" : undefined} />
          ))}
        </span>
      </div>
    ))}
  </>
);

const VotePreview = () => (
  <>
    <div className="pv-title">下季活動投票</div>
    {[
      ["戶外野餐", 70],
      ["密室逃脫", 45],
      ["桌遊之夜", 25]
    ].map(([option, share]) => (
      <div className="pv-bar" key={option}>
        <span>{option}</span>
        <span className="pv-track">
          <i style={{ width: `${share}%` }} />
        </span>
      </div>
    ))}
  </>
);

const StudyPreview = () => (
  <>
    <div className="pv-title">英文檢定計畫</div>
    <Row label="第 1 週" value="單字 200 個" />
    <Row label="第 2 週" value="聽力練習" />
    <Row label="第 3 週" value="模擬考" />
  </>
);

const SplitPreview = () => (
  <>
    <div className="pv-title">聚餐分帳</div>
    <Row label="總金額" value="$3,600" />
    <Row label="人數" value="6 人" />
    <div className="pv-highlight">每人 $600</div>
  </>
);

const PREVIEWS: Readonly<Record<CapsulePreviewKind, () => ReactNode>> = {
  ITINERARY: ItineraryPreview,
  BUDGET: BudgetPreview,
  HABIT: HabitPreview,
  VOTE: VotePreview,
  STUDY: StudyPreview,
  SPLIT: SplitPreview
};

/** App-like preview area of an Inspiration Capsule card: a phone-frame mock exposed as one labelled image. */
export function CapsulePreview({ kind, label }: { readonly kind: CapsulePreviewKind; readonly label: string }) {
  const Preview = PREVIEWS[kind];
  return (
    <div className="capsule-preview" role="img" aria-label={label}>
      <div className="pv-phone">
        <Preview />
      </div>
    </div>
  );
}
