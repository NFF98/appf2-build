import { isRuntimeRecord, type RuntimeValue } from "../runtime-value.js";

/**
 * Consumer text for a resolved Runtime value. The locked F04 contract fixes no scale or unit for PERCENT /
 * CURRENCY_DISPLAY, so numbers are shown exactly as resolved; no JSON or type names reach the User.
 */
export function displayValue(value: RuntimeValue | undefined): string {
  if (value === undefined) return "";
  if (typeof value === "number") return value.toLocaleString("zh-TW", { maximumFractionDigits: 20 });
  if (typeof value === "boolean") return value ? "是" : "否";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item: RuntimeValue) => displayValue(item)).join("、");
  return isRuntimeRecord(value)
    ? Object.entries(value)
        .map(([key, item]) => `${key}：${displayValue(item)}`)
        .join("，")
    : "";
}
