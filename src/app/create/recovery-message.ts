import type { RecoveryReason } from "./creation-session.js";

const DEFAULT_DETAIL: Readonly<Record<RecoveryReason, string>> = {
  RETRYABLE: "連線或服務暫時沒有回應，可以再試一次。",
  STALE_VERSION: "這個需求剛在其他地方更新過，請重新整理後再確認。",
  MALFORMED: "這次收到的結果不完整，我們沒有顯示或自動接受任何設定。",
  NOT_FOUND: "找不到這個需求的進度，可以用同樣的內容重新整理。",
  REJECTED: "這個內容目前無法處理，請修改後再試。"
};

/** Describe only trustworthy F01 server error codes; never expose model output or secrets. */
export function recoveryDetail(reason: RecoveryReason, failureCode?: string): string {
  if (failureCode === "F01-ERR-002") {
    return "AI 已回覆，但需求分析不符合 APPf2 的格式驗證，因此沒有建立 App。你的原始需求還在；建議按「修改需求」先指定最重要的 1–2 項功能，再逐步增加。";
  }
  if (failureCode === "F01-ERR-009") {
    return "AI 處理這次需求時逾時，App 沒有完成。你的原始內容還在；若需求較多，建議按「修改需求」先做最重要的 1–2 項功能，再逐步增加。";
  }
  if (failureCode === "F01-ERR-011") {
    return "AI 產生的 App 藍圖沒有通過 APPf2 驗證。你的需求還在，可以修改需求後重新建立，不會把失敗的藍圖當成成功。";
  }
  if (failureCode === "F01-ERR-008") {
    return "部分要求的功能目前尚無對應元件。可以按「修改需求」先使用較簡單、已支援的功能。";
  }
  return DEFAULT_DETAIL[reason];
}
