import { describe, expect, it } from "vitest";
import { alignExplicitWalkingHabit } from "../../src/platform/compiler/typed-requirement-aliases.js";
import type { ResolvedIntent } from "../../src/platform/intent/resolved-intent.js";
import type { JsonValue } from "../../src/platform/intent/json-value.js";

const module={kind:"HABIT",key:"habit",requirement_ids:["req_1"],heading:"Healthy Habits",
  habit_label:"Exercise",complete_label:"Mark habit complete",completed_label:"Habits completed"};
const plan={plan_version:"1.0.0",title:"LifePilot",modules:[module]};
function intent(goal:unknown,needs:string[]=[]):ResolvedIntent {
  return {goal,capability_requirements:needs.map(s=>({semantic_need:s}))} as unknown as ResolvedIntent;
}
describe("Sprint 3.5 named habit fidelity",()=>{
  it("retains the explicitly requested Walking label and leaves all F01 requirement IDs unchanged",()=>{
    const original=structuredClone(plan);
    const x=alignExplicitWalkingHabit(plan as JsonValue,intent("LifePilot with Walking habit")) as typeof plan;
    expect(x.modules[0]?.habit_label).toBe("Walking");
    expect(x.modules[0]?.requirement_ids).toEqual(["req_1"]);
    expect(plan).toEqual(original);
  });
  it("recognizes an explicit Walking capability but never alters unrequested activity names",()=>{
    const byRequirement=alignExplicitWalkingHabit(plan as JsonValue,
      intent("Personal organizer",["Mark Walking complete"])) as typeof plan;
    expect(byRequirement.modules[0]?.habit_label).toBe("Walking");
    expect(alignExplicitWalkingHabit(plan as JsonValue,intent("Track reading habit"))).toEqual(plan);
  });
  it("preserves explicit original user phrasing even if model semantic summary omits Walking",()=>{
    const changed=alignExplicitWalkingHabit(plan as JsonValue,intent("Generic wellness app"), 
      "LifePilot Healthy Habits: Walking habit; let me complete it every day") as typeof plan;
    expect(changed.modules[0]?.habit_label).toBe("Walking");
  });
  it("never converts multiple distinct habits into Walking",()=>{
    const multiple={...plan,modules:[module,{...module,key:"another",habit_label:"Yoga"}]};
    expect(alignExplicitWalkingHabit(multiple as JsonValue,intent("Walking and Yoga habits")))
      .toEqual(multiple);
  });
});
