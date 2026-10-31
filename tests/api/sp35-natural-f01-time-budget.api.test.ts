import { describe, expect, it } from "vitest";
import {
  analysisTimeoutLimit, COMPLEX_ANALYSIS_TIMEOUT_MS,
  COMPLEX_ANALYSIS_TEXT_THRESHOLD, MODEL_OPERATION_TIMEOUT_MS,
  RequestDeadline
} from "../../src/platform/compiler/model-gateway.js";

describe("Sprint 3.5 natural-language F01 model latency budget", () => {
  it("keeps short task requests at the original cap", () => {
    expect(analysisTimeoutLimit({raw_user_intent:"Make a list"}))
      .toBe(MODEL_OPERATION_TIMEOUT_MS.INTENT_ANALYSIS);
    expect(analysisTimeoutLimit({raw_user_intent:"中".repeat(COMPLEX_ANALYSIS_TEXT_THRESHOLD-1)}))
      .toBe(MODEL_OPERATION_TIMEOUT_MS.INTENT_ANALYSIS);
  });
  it("gives the unchanged Chinese moving request one bounded attempt", () => {
    const original = ["我下個月要搬家，事情好多，常常忘記自己做了什麼、還有什麼沒做。你可以幫我做一個簡單好用的搬家管理 App 嗎？",
      "我想隨時記下要做的事情，可以修改、刪除、打勾完成，還能分成高、中、低優先順序，方便先處理重要的事。最好也能看到今天完成了幾件事。",
      "另外我需要一張採購清單，像紙箱、膠帶、清潔用品這些東西，可以填數量、改數量，買到了就勾起來。",
      "搬家費用也想順便管理。我希望能設定自己的預算，每花一筆錢就記下來，隨時知道花了多少、還剩多少。",
      "畫面不要太複雜，手機和電腦看起來都要清楚。重新整理網頁後，我記下的東西也不要消失。"].join("\n\n");
    expect(analysisTimeoutLimit({raw_user_intent:original})).toBe(COMPLEX_ANALYSIS_TIMEOUT_MS);
    const deadline=new RequestDeadline(80_000,()=>0);
    expect(deadline.attemptTimeoutMs("INTENT_ANALYSIS",
      analysisTimeoutLimit({raw_user_intent:original}))).toBe(66_000);
  });
  it("never overrides the remaining server deadline or retries expired requests", () => {
    let now=20_000;
    const d=new RequestDeadline(80_000,()=>now);
    now=91_000;
    expect(d.attemptTimeoutMs("INTENT_ANALYSIS",COMPLEX_ANALYSIS_TIMEOUT_MS)).toBe(9_000);
    now=101_000;
    expect(d.attemptTimeoutMs("INTENT_ANALYSIS",COMPLEX_ANALYSIS_TIMEOUT_MS)).toBe(0);
  });
});
