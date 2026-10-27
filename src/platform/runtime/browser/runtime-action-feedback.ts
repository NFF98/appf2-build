import type { DispatchRejection } from "../runtime-instance.js";
import type { OperationStatus } from "../runtime-operation.js";

/** Operation notifications reflect F03's actual terminal result, not a guessed success. */
export function feedbackForOperation(status: OperationStatus): string | null | undefined {
  switch (status) {
    case "COMMITTED": return null;
    case "FAILED": return "操作失敗，變更未保存。請檢查輸入後重試。";
    case "TIMED_OUT": return "操作逾時，變更未保存。請再試一次。";
    case "CANCELLED": return "操作已取消，變更未保存。";
    default: return undefined; // STARTED / PROCESSING: never claim success or failure yet.
  }
}

/** A rejected dispatch creates no operation and cannot be seen via operation events. */
export function feedbackForRejection(reason: DispatchRejection): string {
  switch (reason) {
    case "PAYLOAD_SCHEMA_MISMATCH": return "輸入格式不正確，變更未套用。";
    case "EVENT_QUEUE_LIMIT": return "操作過於頻繁，請稍後重試；變更未套用。";
    case "INSTANCE_NOT_READY": return "App 尚未準備好，變更未套用。";
    case "INSTANCE_DISPOSED": return "App 已關閉，變更未套用。";
    default: return "操作未接受，變更未套用。請重新操作。";
  }
}
