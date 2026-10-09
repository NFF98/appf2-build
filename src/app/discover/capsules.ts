export const CAPSULE_CATEGORIES = ["全部", "生產力", "生活", "學習", "工具"] as const;
export type CapsuleCategory = Exclude<(typeof CAPSULE_CATEGORIES)[number], "全部">;
export type CategoryFilter = (typeof CAPSULE_CATEGORIES)[number];

export type CapsulePreviewKind = "ITINERARY" | "BUDGET" | "HABIT" | "VOTE" | "STUDY" | "SPLIT";

/**
 * F00-UX-006 Inspiration Capsule: title, one-line outcome, app-like preview and an editable prompt prefill.
 * A Capsule carries no preset facts; `Try` only prefills the Composer and the User's text is what F01 receives.
 */
export type Capsule = {
  readonly id: string;
  readonly title: string;
  readonly outcome: string;
  readonly category: CapsuleCategory;
  readonly preview: CapsulePreviewKind;
  readonly prompt: string;
};

export const CAPSULES: readonly Capsule[] = Object.freeze([
  {
    id: "travel-itinerary",
    title: "旅遊行程規劃",
    outcome: "輸入目的地與天數，自動生成專屬行程",
    category: "生活",
    preview: "ITINERARY",
    prompt: "幫我做一個旅遊行程規劃 App：輸入目的地、天數和想去的景點類型，排出每天的行程。"
  },
  {
    id: "monthly-budget",
    title: "預算試算",
    outcome: "輸入收入與支出，清楚掌握財務狀況",
    category: "工具",
    preview: "BUDGET",
    prompt: "幫我做一個每月預算試算 App：輸入收入和各類支出，算出剩餘金額和各類別占比。"
  },
  {
    id: "habit-tracker",
    title: "習慣追蹤",
    outcome: "從小改變開始，打造更好的自己",
    category: "生活",
    preview: "HABIT",
    prompt: "幫我做一個習慣追蹤 App：可以新增想養成的習慣，每天打勾，並顯示連續達成天數。"
  },
  {
    id: "meeting-vote",
    title: "會議決策",
    outcome: "列出選項讓大家投票，快速做出決定",
    category: "生產力",
    preview: "VOTE",
    prompt: "幫我做一個會議決策投票 App：輸入幾個選項讓參與的人投票，並顯示票數最高的選項。"
  },
  {
    id: "study-plan",
    title: "學習計畫",
    outcome: "設定目標與時間，安排每週學習進度",
    category: "學習",
    preview: "STUDY",
    prompt: "幫我做一個學習計畫 App：輸入學習目標、每週可用時間和截止日期，安排每週要完成的進度。"
  },
  {
    id: "dinner-split",
    title: "聚餐分帳",
    outcome: "輸入總金額與人數，立即算出每人應付",
    category: "工具",
    preview: "SPLIT",
    prompt: "幫我做一個聚餐分帳 App：輸入總金額、人數和服務費比例，算出每個人應付多少。"
  }
]);

/** Composer suggestion chips: supporting prefill shortcuts into the same Capsule catalog. */
export const SUGGESTION_CAPSULE_IDS: readonly string[] = Object.freeze(["travel-itinerary", "monthly-budget", "habit-tracker", "meeting-vote", "study-plan"]);

/** First screen shows a small curated set; 「探索更多」 continues in place (S01 Step 1). */
export const FIRST_SCREEN_CAPSULES = 3;

export function capsulesFor(filter: CategoryFilter): readonly Capsule[] {
  return filter === "全部" ? CAPSULES : CAPSULES.filter((capsule) => capsule.category === filter);
}

export function findCapsule(id: string): Capsule | undefined {
  return CAPSULES.find((capsule) => capsule.id === id);
}
