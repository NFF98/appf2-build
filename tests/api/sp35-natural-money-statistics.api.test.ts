import {describe,expect,it} from "vitest";
import {correctMoneyStatisticHint,normalizeAnalysisDescriptorFlags} from "../../src/platform/compiler/normalize-analysis-shape.js";
import type {JsonValue} from "../../src/platform/intent/json-value.js";

const original="我下個月搬家，預算自己設定，每花一筆費用就記下來，顯示花費多少和剩餘多少。";
const hint={hint_id:"money_summary",semantic_need:"Display spent and remaining budget totals",
  interaction_class:"statistic",input_types:[],output_types:["RECORD"],required:true,
  impact_level:"HIGH",source_item_ids:["budget"],constraint_item_ids:[]};
describe("Sprint 3.5 exact natural Chinese budget statistic",()=>{
  it("corrects only the composite RECORD type to an independently checkable NUMBER stat",()=>{
    const source=structuredClone(hint);
    expect(correctMoneyStatisticHint(source as JsonValue,original)).toEqual({
      ...source,output_types:["NUMBER"]
    });
    expect(source).toEqual(hint);
    const normalized=normalizeAnalysisDescriptorFlags({
      requested_outputs:[],capability_hints:[source]
    } as JsonValue,original) as {capability_hints:Array<typeof hint>};
    expect(normalized.capability_hints[0]).toEqual({...hint,output_types:["NUMBER"]});
    expect(normalized.capability_hints[0]?.required).toBe(true);
    expect(normalized.capability_hints[0]?.source_item_ids).toEqual(["budget"]);
  });
  it("never changes unsupported arbitrary RECORD, unrelated, optional or user-ungrounded hints",()=>{
    const variants=[
      {...hint,semantic_need:"Customer profile object"},
      {...hint,interaction_class:"form"},
      {...hint,required:false},
      {...hint,input_types:["RECORD"]},
      {...hint,output_types:["LIST"]}
    ];
    for(const entry of variants)
      expect(correctMoneyStatisticHint(entry as JsonValue,original)).toEqual(entry);
    expect(correctMoneyStatisticHint(hint as JsonValue,"我要搬家，請做清單")).toEqual(hint);
    expect(correctMoneyStatisticHint(hint as JsonValue,undefined)).toEqual(hint);
  });
});
