import {describe,expect,it} from "vitest";
import {alignExplicitTodaySummary} from "../../src/platform/compiler/typed-requirement-aliases.js";
import type {JsonValue} from "../../src/platform/intent/json-value.js";

const tasks={kind:"RECORD_LIST",key:"moving_task_list",requirement_ids:["req_1"],
  heading:"待辦事項",track_day:false};
const today={kind:"TODAY_SUMMARY",key:"progress",source_key:"tasks",
  heading:"今日進度",requirement_ids:["req_2"]};
const raw={plan_version:"1.0.0",title:"搬家",modules:[tasks,today]};
const user="我搬家需要待辦清單，最好也能看到今天完成了幾件事。";
describe("Sprint3.5 natural language TODAY_SUMMARY source continuity",()=>{
  it("uses the sole earlier task list's exact server-visible key and tracks today's events",()=>{
    const a=alignExplicitTodaySummary(raw as JsonValue,user) as typeof raw;
    expect(a.modules[0]).toMatchObject({key:"moving_task_list",track_day:true});
    expect(a.modules[1]).toMatchObject({source_key:"moving_task_list"});
    expect(a.modules[0]?.requirement_ids).toEqual(["req_1"]);
    expect(a.modules[1]?.requirement_ids).toEqual(["req_2"]);
    expect((raw.modules[0] as typeof tasks).track_day).toBe(false);
  });
  it("fails closed instead of guessing if no original daily request or multiple task lists",()=>{
    expect(alignExplicitTodaySummary(raw as JsonValue,"搬家待辦清單")).toEqual(raw);
    const two={...raw,modules:[tasks,{...tasks,key:"other"},today]};
    expect(alignExplicitTodaySummary(two as JsonValue,user)).toEqual(two);
    const reversed={...raw,modules:[today,tasks]};
    expect(alignExplicitTodaySummary(reversed as JsonValue,user)).toEqual(reversed);
    const malformed={...raw,modules:[{...tasks,key:"bad-key"},today]};
    expect(alignExplicitTodaySummary(malformed as JsonValue,user)).toEqual(malformed);
  });
});
