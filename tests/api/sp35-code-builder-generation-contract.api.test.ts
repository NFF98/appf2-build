import {describe,it,expect} from "vitest";
import {
 CODE_BUILDER_COMPLETION_BUDGET,CODE_BUILDER_SOURCE_TARGET_BYTES,
 CODE_BUILDER_GENERATION_TIMEOUT_MS,codeBuilderModelRequest,readCodeBuilderCompletion
} from "../../src/edge/code-builder-generation-contract.js";

describe("Code Builder general generation contract (no AI charges)",()=>{
 it("preserves arbitrary novel user intent without substituting an 18la template",()=>{
  const idea="做一個自創星球的物種觀察工具，有收集、篩選、統計和切換頁面";
  const request=codeBuilderModelRequest("gpt-4.1",idea);
  expect(request.messages[1].content).toBe(idea);
  expect(request.messages[0].content).toContain("EVERY explicit required feature");
  expect(request.messages[0].content).toContain("real navigation");
  expect(request.messages[0].content).not.toContain("十八啦");
  expect(request.max_completion_tokens).toBeGreaterThan(3800);
  expect(CODE_BUILDER_COMPLETION_BUDGET).toBe(8000);
  expect(CODE_BUILDER_SOURCE_TARGET_BYTES).toBeGreaterThan(14*1024);
  expect(CODE_BUILDER_GENERATION_TIMEOUT_MS).toBe(65000);
 });
 it("rejects truncated or incomplete chat completions rather than publishing false PASS",()=>{
  const make=(finish_reason:string,content:string)=>({choices:[{finish_reason,message:{content}}]});
  const good=JSON.stringify({title:"我的工具",javascript:"document.getElementById('app').textContent='ok';"});
  expect(readCodeBuilderCompletion(make("stop",good))?.title).toBe("我的工具");
  expect(readCodeBuilderCompletion(make("length",good))).toBe(null);
  expect(readCodeBuilderCompletion(make("content_filter",good))).toBe(null);
  expect(readCodeBuilderCompletion(make("stop",'{"title":"app","javascript":'))).toBe(null);
  expect(readCodeBuilderCompletion(make("stop",JSON.stringify({title:"x",javascript:"ok",passed:true})))).toBe(null);
 });
});
