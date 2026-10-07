import { afterEach, describe, expect, test, vi } from "vitest";

import type { JsonValue, ValueSource } from "../../src/platform/blueprint/validation-types.js";
import { evaluateValueSource, type EvaluationEnv } from "../../src/platform/runtime/expression-vm.js";
import {
  idleTimer,
  observeTimer,
  pauseTimer,
  resetTimer,
  resumeTimer,
  startTimer
} from "../../src/platform/runtime/monotonic-timer.js";
import { singletonKey } from "../../src/platform/runtime/node-instance-key.js";
import { Pcg32Cursor, seedPcg32 } from "../../src/platform/runtime/prng.js";
import { RuntimeFailure } from "../../src/platform/runtime/runtime-errors.js";
import type { RuntimeValue } from "../../src/platform/runtime/runtime-value.js";
import { blueprintWith, buttonNode, capabilityState, hydratedHarness, lit, node, press, state } from "../runtime/runtime-fixtures.js";

const L = (value: JsonValue): ValueSource => ({ kind: "LITERAL", value });
const S = (key: string): ValueSource => ({ kind: "STATE", key });
const O = (name: string, ...args: ValueSource[]): ValueSource => ({ kind: "OP", op: name, args });

const STATE: Readonly<Record<string, RuntimeValue>> = { n: 4, s: "Ab", empty: [], nums: [3, 1, 2] };
const ENV: EvaluationEnv = Object.freeze({
  readState: (key: string) => STATE[key] ?? 0,
  readRule: () => true
});

const GOLDEN: readonly (readonly [string, ValueSource, RuntimeValue])[] = [
  ["ADD", O("ADD", L(1), L(2), S("n")), 7],
  ["SUB", O("SUB", L(5), L(8)), -3],
  ["MUL", O("MUL", L(2), L(3), L(4)), 24],
  ["DIV", O("DIV", L(7), L(2)), 3.5],
  ["MOD(7,3)", O("MOD", L(7), L(3)), 1],
  ["MOD(-7,3) remainder follows dividend", O("MOD", L(-7), L(3)), -1],
  ["MOD(7,-3) remainder follows dividend", O("MOD", L(7), L(-3)), 1],
  ["MOD(-7,-3)", O("MOD", L(-7), L(-3)), -1],
  ["MOD(-6,3) exact multiple", O("MOD", L(-6), L(3)), 0],
  ["MOD(6,-3) exact multiple", O("MOD", L(6), L(-3)), 0],
  ["ABS", O("ABS", L(-2.5)), 2.5],
  ["ROUND .5 tie toward +inf", O("ROUND", L(2.5)), 3],
  ["ROUND negative .5 tie toward +inf", O("ROUND", L(-2.5)), -2],
  ["ROUND nearest", O("ROUND", L(-2.6)), -3],
  ["FLOOR", O("FLOOR", L(-1.5)), -2],
  ["CEIL", O("CEIL", L(1.2)), 2],
  ["MIN", O("MIN", L(3), L(1), L(2)), 1],
  ["MAX", O("MAX", L(3), L(1), L(2)), 3],
  ["EQ STRING", O("EQ", L("a"), L("a")), true],
  ["EQ BOOLEAN", O("EQ", L(true), L(false)), false],
  ["NEQ", O("NEQ", L(1), L(2)), true],
  ["GT code point", O("GT", L("b"), L("B")), true],
  ["LT code point beyond BMP", O("LT", L("\uFFFF"), L("\u{1F600}")), true],
  ["GTE", O("GTE", L(2), L(2)), true],
  ["LTE", O("LTE", L(3), L(2)), false],
  ["AND", O("AND", L(true), L(false)), false],
  ["OR", O("OR", L(false), L(true)), true],
  ["NOT", O("NOT", L(false)), true],
  ["IF", O("IF", L(true), L("x"), L("y")), "x"],
  ["COALESCE", O("COALESCE", S("s"), L("z")), "Ab"],
  ["LENGTH code points", O("LENGTH", L("\u{1F600}a")), 2],
  ["LENGTH LIST", O("LENGTH", S("nums")), 3],
  ["COUNT", O("COUNT", S("nums")), 3],
  ["SUM empty = 0", O("SUM", S("empty")), 0],
  ["SUM", O("SUM", S("nums")), 6],
  ["AVG", O("AVG", L([1, 2])), 1.5],
  ["LIST_MIN", O("LIST_MIN", S("nums")), 1],
  ["LIST_MAX", O("LIST_MAX", S("nums")), 3],
  ["CONCAT", O("CONCAT", S("s"), L("c")), "Abc"],
  ["LOWER", O("LOWER", L("ABC")), "abc"],
  ["UPPER", O("UPPER", L("abc")), "ABC"],
  ["TRIM", O("TRIM", L("  x ")), "x"],
  ["AND short-circuit", O("AND", L(false), O("DIV", L(1), L(0))), false],
  ["OR short-circuit", O("OR", L(true), O("DIV", L(1), L(0))), true],
  ["IF selected branch only", O("IF", L(false), O("DIV", L(1), L(0)), L(1)), 1]
];

const FAILURES: readonly (readonly [string, ValueSource, string])[] = [
  ["DIV by zero", O("DIV", L(1), L(0)), "F03-ERR-008"],
  ["MOD by zero", O("MOD", L(1), L(0)), "F03-ERR-008"],
  ["MOD negative dividend by zero", O("MOD", L(-7), L(0)), "F03-ERR-008"],
  ["non-finite", O("MUL", L(1e308), L(10)), "F03-ERR-009"],
  ["operand type", O("ADD", L("a"), L(1)), "F03-ERR-005"],
  ["AVG empty", O("AVG", S("empty")), "F03-ERR-005"],
  ["LIST_MIN empty", O("LIST_MIN", S("empty")), "F03-ERR-005"],
  ["LIST_MAX empty", O("LIST_MAX", S("empty")), "F03-ERR-005"],
  ["EQ mixed base types", O("EQ", L(1), L("1")), "F03-ERR-005"],
  ["ordering BOOLEAN", O("GT", L(true), L(false)), "F03-ERR-005"],
  ["COALESCE evaluates every branch", O("COALESCE", L(1), O("DIV", L(1), L(0))), "F03-ERR-008"],
  ["non-allowlisted operator", O("EVAL", L("1+1")), "F03-ERR-018"]
];

function failureCode(source: ValueSource): string {
  try {
    evaluateValueSource(source, ENV);
  } catch (error: unknown) {
    return error instanceof RuntimeFailure ? error.code : "UNTYPED";
  }
  return "NO_FAILURE";
}

/** appf2 MOD v1: exact multiples expose canonical +0 and a non-zero remainder keeps the dividend's sign. */
function expectModV1Invariants(): void {
  const mod = (dividend: number, divisor: number) => evaluateValueSource(O("MOD", L(dividend), L(divisor)), ENV) as number;
  for (const [dividend, divisor] of [[-6, 3], [6, -3], [-6, -3], [-0, 3], [-0.5, 0.25]] as const) {
    expect(Object.is(mod(dividend, divisor), 0), `MOD(${dividend},${divisor}) is +0`).toBe(true);
  }
  for (const [dividend, divisor] of [[11331355571746826, -4.791938066482544], [-457553625106811500000, -3.537925481796265e-11], [7.5, -2], [-7.5, 2]] as const) {
    const result = mod(dividend, divisor);
    expect(result === 0 || Math.sign(result) === Math.sign(dividend), `MOD(${dividend},${divisor}) sign follows dividend`).toBe(true);
    expect(Math.abs(result), `MOD(${dividend},${divisor}) magnitude below |divisor|`).toBeLessThan(Math.abs(divisor));
  }
}

function timerBlueprint(durationMs: number) {
  return blueprintWith({
    state: { completions: { mode: "MUTABLE", type: "NUMBER", initial: 0 } },
    actions: [
      { id: "action_start", steps: [{ type: "INVOKE_CAPABILITY", target_node_id: "node_timer", capability_action: "start", args: {} }] },
      { id: "action_done", steps: [{ type: "SET_STATE", target: "completions", value: { kind: "OP", op: "ADD", args: [state("completions"), lit(1)] } }] }
    ],
    nodes: [
      buttonNode("node_start", "action_start"),
      node("node_timer", "logic.timer", "1.0.0", { props: { duration_ms: lit(durationMs) }, events: { complete: "action_done" } })
    ]
  });
}

const TIMER = singletonKey("node_timer");

afterEach(() => {
  vi.restoreAllMocks();
});

describe("F03 deterministic evaluation, randomness and time", () => {
  test("TEST-F03-010 operator golden cases return the same typed output for the same inputs", () => {
    for (const [label, source, expected] of GOLDEN) {
      const first = evaluateValueSource(source, ENV);
      const second = evaluateValueSource(source, ENV);
      expect(first, label).toEqual(expected);
      expect(second, label).toEqual(first);
      expect(typeof first, label).toBe(typeof expected);
    }
    for (const [label, source, code] of FAILURES) {
      expect(failureCode(source), label).toBe(code);
      expect(failureCode(source), label).toBe(code);
    }
    expectModV1Invariants();
  });

  test("TEST-F03-011 PRNG golden vectors: same seed and consumption order yield the same sequence", async () => {
    const reference = new Uint8Array(16);
    reference[7] = 42;
    reference[15] = 54;
    const cursor = new Pcg32Cursor(seedPcg32(reference));
    expect(Array.from({ length: 6 }, () => cursor.nextUint32())).toEqual([0xa15c02b7, 0x7b47f409, 0xba1d3330, 0x83d2f293, 0xbfa4784b, 0xcbed606e]);

    const seed = Uint8Array.from({ length: 16 }, (_, index) => 255 - index);
    const uninterrupted = new Pcg32Cursor(seedPcg32(seed));
    const expected = Array.from({ length: 8 }, () => uninterrupted.nextUint32());
    const resumed = new Pcg32Cursor(seedPcg32(seed));
    const head = Array.from({ length: 3 }, () => resumed.nextUint32());
    const continued = new Pcg32Cursor(resumed.snapshot());
    expect([...head, ...Array.from({ length: 5 }, () => continued.nextUint32())]).toEqual(expected);
    expect(continued.snapshot().counter).toBe(8);
    const other = new Pcg32Cursor(seedPcg32(Uint8Array.from({ length: 16 }, (_, index) => index)));
    expect(Array.from({ length: 8 }, () => other.nextUint32())).not.toEqual(expected);

    const blueprint = blueprintWith({
      actions: [
        {
          id: "action_roll",
          steps: [
            { type: "INVOKE_CAPABILITY", target_node_id: "node_random", capability_action: "sample_number", args: { min: lit(1), max: lit(1000) } },
            { type: "INVOKE_CAPABILITY", target_node_id: "node_random", capability_action: "choose_item", args: { items: lit(["A", "B", "C", "D"]) } }
          ]
        }
      ],
      nodes: [buttonNode("node_roll", "action_roll"), node("node_random", "logic.random", "1.0.0")]
    });
    const runs = await Promise.all([hydratedHarness(blueprint, { seed }), hydratedHarness(blueprint, { seed })]);
    const trails = runs.map((harness) =>
      Array.from({ length: 5 }, () => {
        press(harness, "node_roll");
        return capabilityState(harness, "node_random");
      })
    );
    expect(trails[0]).toEqual(trails[1]);
    expect(runs[0]?.runtime.rngMetadata()).toEqual({ algorithm: "appf2-PCG32-v1", seed: "fffefdfcfbfaf9f8f7f6f5f4f3f2f1f0", counter: 10 });
    const replay = new Pcg32Cursor(seedPcg32(seed));
    const firstNumber = replay.nextUint32();
    const firstIndex = replay.nextUint32();
    expect(trails[0]?.[0]).toEqual({ last_number: 1 + (firstNumber % 1000), last_index: firstIndex % 4, last_item: ["A", "B", "C", "D"][firstIndex % 4] });
  });

  test("TEST-F03-012 timer elapsed truth is the monotonic clock, independent of wall-clock changes", async () => {
    let timer = startTimer(idleTimer(1000), 100);
    expect(observeTimer(timer, 400)).toMatchObject({ elapsed_ms: 300, remaining_ms: 700, completed: false });
    timer = pauseTimer(timer, 400);
    expect(observeTimer(timer, 9_400)).toMatchObject({ elapsed_ms: 300, remaining_ms: 700, completed: false });
    timer = resumeTimer(timer, 9_400);
    expect(observeTimer(timer, 9_500)).toMatchObject({ elapsed_ms: 400, remaining_ms: 600, completed: false });
    const done = observeTimer(timer, 10_100);
    expect(done).toMatchObject({ elapsed_ms: 1000, remaining_ms: 0, completed: true, timer: { status: "COMPLETE" } });
    expect(observeTimer(done.timer, 99_999)).toMatchObject({ completed: false, remaining_ms: 0 });
    expect(resetTimer(done.timer)).toEqual(idleTimer(1000));
    expect(pauseTimer(idleTimer(5), 1)).toEqual(idleTimer(5));

    const harness = await hydratedHarness(timerBlueprint(1000));
    harness.clock.ms = 5_000;
    press(harness, "node_start");
    expect(capabilityState(harness, "node_timer")).toMatchObject({ status: "RUNNING" });
    const wallClock = vi.spyOn(Date, "now");
    wallClock.mockReturnValue(0);
    harness.scheduler.advance(400);
    expect(harness.runtime.timerObservation(TIMER)).toMatchObject({ elapsed_ms: 400, remaining_ms: 600, completed: false });
    wallClock.mockReturnValue(Number.MAX_SAFE_INTEGER);
    harness.scheduler.advance(599);
    expect(harness.runtime.readState("completions")).toBe(0);
    harness.scheduler.advance(1);
    expect(harness.runtime.readState("completions")).toBe(1);
    expect(harness.notices).toEqual(["action_start", "action_done"]);
    harness.scheduler.advance(10_000);
    expect(harness.runtime.readState("completions")).toBe(1);
    expect(wallClock).not.toHaveBeenCalled();
  });

  test("TEST-F03-AC-013 background-tab wake delay causes no tick-count drift", async () => {
    const throttled = await hydratedHarness(timerBlueprint(10_000));
    throttled.scheduler.minimumDelayMs = 60_000;
    press(throttled, "node_start");
    throttled.scheduler.advance(5_000);
    expect(throttled.scheduler.wakeCount).toBe(0);
    expect(throttled.runtime.timerObservation(TIMER)).toMatchObject({ elapsed_ms: 5_000, remaining_ms: 5_000 });
    throttled.scheduler.advance(55_000);
    expect(throttled.scheduler.wakeCount).toBe(1);
    expect(throttled.runtime.readState("completions")).toBe(1);

    const suspended = await hydratedHarness(timerBlueprint(10_000));
    press(suspended, "node_start");
    suspended.scheduler.suspendThenResume(25_000);
    expect(suspended.runtime.readState("completions")).toBe(1);
    expect(suspended.runtime.timerObservation(TIMER)).toBeUndefined();

    const early = await hydratedHarness(timerBlueprint(10_000));
    press(early, "node_start");
    early.scheduler.advance(3_000);
    early.scheduler.fireEarly();
    early.scheduler.fireEarly();
    expect(early.runtime.readState("completions")).toBe(0);
    expect(early.runtime.timerObservation(TIMER)).toMatchObject({ elapsed_ms: 3_000, remaining_ms: 7_000 });
    early.scheduler.advance(7_000);
    expect(early.runtime.readState("completions")).toBe(1);
    expect(early.scheduler.wakeCount).toBe(3);
    expect(early.scheduler.activeWakes).toBe(0);
  });
});
