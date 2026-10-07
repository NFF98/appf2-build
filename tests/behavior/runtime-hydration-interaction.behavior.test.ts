import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, test, vi } from "vitest";

import { nodeInstanceKeyId, singletonKey } from "../../src/platform/runtime/node-instance-key.js";
import { validBlueprint } from "../contract/blueprint-validation-fixtures.js";
import {
  ADMITTED_AT_MS,
  blueprintWith,
  buttonNode,
  capabilityState,
  change,
  fixtureHandlers,
  hydratedHarness,
  lit,
  node,
  press,
  runtimeHarness,
  snapshot,
  state,
  type HarnessOptions
} from "../runtime/runtime-fixtures.js";

const STATE_KEYS = ["people", "total", "note", "size", "tip_enabled", "selected_name", "items", "per_person"];
const CAPABILITY_NODES = ["node_score", "node_random", "node_timer", "node_roll"];
const RUNTIME_ENTRY = fileURLToPath(new URL("../../src/platform/runtime/runtime-instance.ts", import.meta.url));
const VALUE_IMPORT = /^(?:import|export)\s+(?!type\b)[^;]*?\bfrom\s+"([^"]+)"/gms;
const LLM_OR_SERVER_MODULE = /[\\/]src[\\/]platform[\\/](?:compiler|intent|evidence)[\\/]|llm|gateway|openai|anthropic/i;
const NETWORK_API = /\bfetch\s*[(]|XMLHttpRequest|WebSocket|EventSource|sendBeacon|node:http|node:net/;

/** Transitive value-import closure of the Runtime entry; type-only imports are erased at build time. */
function runtimeModuleClosure(): { readonly files: ReadonlyMap<string, string>; readonly external: readonly string[] } {
  const files = new Map<string, string>();
  const external = new Set<string>();
  const pending = [RUNTIME_ENTRY];
  for (let file = pending.pop(); file !== undefined; file = pending.pop()) {
    if (files.has(file)) {
      continue;
    }
    const text = readFileSync(file, "utf8");
    files.set(file, text);
    for (const match of text.matchAll(VALUE_IMPORT)) {
      const specifier = match[1] as string;
      if (specifier.startsWith(".")) {
        pending.push(resolve(dirname(file), specifier.replace(/\.js$/, ".ts")));
      } else {
        external.add(specifier);
      }
    }
  }
  return { files, external: [...external] };
}

interface NetworkProbe {
  readonly calls: string[];
}

function stubNetwork(): NetworkProbe {
  const calls: string[] = [];
  const blocked = (name: string) =>
    function blockedNetwork(): never {
      calls.push(name);
      throw new Error(`${name} must not be used by local Runtime interaction`);
    };
  vi.stubGlobal("fetch", vi.fn(blocked("fetch")));
  vi.stubGlobal("XMLHttpRequest", vi.fn(blocked("XMLHttpRequest")));
  vi.stubGlobal("WebSocket", vi.fn(blocked("WebSocket")));
  vi.stubGlobal("EventSource", vi.fn(blocked("EventSource")));
  return { calls };
}

/** A full normal session over the shared F02 fixture: inputs, toggle, repeat-clone press, capabilities, reset. */
async function normalSession(): Promise<Awaited<ReturnType<typeof hydratedHarness>>> {
  const harness = await hydratedHarness(validBlueprint());
  const pick = { node_id: "node_item_pick", repeat_coordinates: [{ repeat_node_id: "node_list", item_index: 0 }] };
  expect(change(harness, "node_people", 6)).toMatchObject({ accepted: true });
  expect(change(harness, "node_note", "外帶")).toMatchObject({ accepted: true });
  expect(change(harness, "node_size", "LARGE")).toMatchObject({ accepted: true });
  expect(change(harness, "node_tip", true)).toMatchObject({ accepted: true });
  expect(press(harness, "node_item_pick", pick)).toMatchObject({ accepted: true });
  expect(press(harness, "node_roll")).toMatchObject({ accepted: true });
  return harness;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("F03 Runtime hydration gate", () => {
  test("TEST-F03-001 hydrates a valid admitted Blueprint deterministically to READY", async () => {
    const first = await hydratedHarness(validBlueprint());
    const second = await hydratedHarness(validBlueprint());

    expect(first.runtime.status).toBe("READY");
    expect(snapshot(first, STATE_KEYS, CAPABILITY_NODES)).toEqual(snapshot(second, STATE_KEYS, CAPABILITY_NODES));
    expect(first.runtime.readState("per_person")).toBe(30);
    expect(first.runtime.readState("items")).toEqual([{ name: "A", price: 10 }]);
    expect(first.runtime.readRule("rule_can_split")).toEqual({ ok: true, value: true });
    expect(capabilityState(first, "node_score")).toEqual({ value: 0 });
    expect(capabilityState(first, "node_timer")).toEqual({ status: "IDLE", duration_ms: 60000, remaining_ms: 60000 });
    expect(capabilityState(first, "node_random")).toEqual({});
    expect(capabilityState(first, "node_roll")).toBeUndefined();
    expect(first.runtime.rngMetadata()).toEqual({ algorithm: "appf2-PCG32-v1", seed: "000102030405060708090a0b0c0d0e0f", counter: 0 });

    const instanceIds = first.runtime.nodeInstances().map((instance) => nodeInstanceKeyId(instance.key));
    expect(instanceIds).toEqual(second.runtime.nodeInstances().map((instance) => nodeInstanceKeyId(instance.key)));
    expect(instanceIds.slice(0, 2)).toEqual(["node_root", "node_title"]);
    expect(instanceIds).toEqual(expect.arrayContaining(["node_list", "node_item_row/node_list#0", "node_item_pick/node_list#0"]));
    expect(first.runtime.readCapabilityState({ node_id: "node_item_pick", repeat_coordinates: [{ repeat_node_id: "node_list", item_index: 0 }] })).toBeUndefined();
    expect(first.evidence.map((record) => record.event_type)).toEqual(["F03-EVT-001", "F03-EVT-002"]);
    expect(first.evidence[1]?.blueprint_hash).toBe(first.admitted.admission.content_hash);
    expect(first.runtime.runtimeErrors()).toEqual([]);
  });

  test("only a fresh, matching, compatible ExecutionAdmission with pinned handlers may hydrate", async () => {
    const blueprint = validBlueprint();
    const otherBody = (await runtimeHarness(blueprintWith({}))).admitted.body;
    const withoutScore = fixtureHandlers();
    withoutScore.delete("logic/score");
    const cases: readonly { readonly label: string; readonly options: HarnessOptions; readonly code: string }[] = [
      { label: "non-executable admission", options: { admission: { executable: false } }, code: "F03-ERR-001" },
      { label: "non-VALIDATED trust", options: { admission: { trust_status: "REVOKED" } }, code: "F03-ERR-001" },
      { label: "expired admission", options: { trust: { trustedNow: () => ADMITTED_AT_MS + 30_000 } }, code: "F03-ERR-001" },
      { label: "unparseable expiry", options: { admission: { expires_at: "not-a-time" } }, code: "F03-ERR-001" },
      { label: "content hash mismatch", options: { body: otherBody }, code: "F03-ERR-001" },
      { label: "non-JSON body", options: { body: "{not json" }, code: "F03-ERR-001" },
      { label: "runtime version mismatch", options: { trust: { runtime_version: "2.0.0" } }, code: "F03-ERR-002" },
      { label: "schema outside supported range", options: { trust: { supported_blueprint_schema_range: "^2.0.0" } }, code: "F03-ERR-002" },
      { label: "registry tuple mismatch", options: { admission: { runtime_registry_digest: `sha256:${"0".repeat(64)}` } }, code: "F03-ERR-003" },
      { label: "missing pinned handler", options: { trust: { handlers: withoutScore } }, code: "F03-ERR-003" },
      { label: "invalid RNG seed", options: { seed: new Uint8Array(8) }, code: "F03-ERR-017" },
      {
        label: "seed source failure",
        options: {
          seedSource: () => {
            throw new Error("crypto unavailable");
          }
        },
        code: "F03-ERR-017"
      }
    ];
    for (const { label, options, code } of cases) {
      const harness = await runtimeHarness(blueprint, options);
      const result = await harness.runtime.hydrate();
      expect(result, label).toMatchObject({ status: "FATAL_ERROR", error: { code } });
      expect(harness.runtime.status, label).toBe("FATAL_ERROR");
      expect(harness.runtime.readState("people"), label).toBeUndefined();
      expect(harness.runtime.blueprint, label).toBeUndefined();
      expect(harness.evidence.map((record) => [record.event_type, record.error_code ?? null]), label).toEqual([
        ["F03-EVT-001", null],
        ["F03-EVT-003", code]
      ]);
      expect(press(harness, "node_roll"), label).toEqual({ accepted: false, reason: "INSTANCE_NOT_READY" });
      expect(await harness.runtime.hydrate(), label).toEqual(result);
    }
  });
});

describe("F03 local interaction", () => {
  test("TEST-F03-AC-002 normal interaction makes zero LLM calls", async () => {
    const closure = runtimeModuleClosure();
    expect([...closure.files.keys()].filter((file) => LLM_OR_SERVER_MODULE.test(file))).toEqual([]);
    expect(closure.external).toEqual([]);

    const network = stubNetwork();
    const harness = await normalSession();
    expect(harness.runtime.readState("people")).toBe(6);
    expect(harness.runtime.readState("selected_name")).toBe("A");
    expect(capabilityState(harness, "node_score")).toEqual({ value: 5 });
    expect(network.calls).toEqual([]);
  });

  test("TEST-F03-AC-003 normal local interaction completes synchronously without a server round trip", async () => {
    const { files } = runtimeModuleClosure();
    for (const [file, text] of files) {
      expect(text, file).not.toMatch(NETWORK_API);
    }

    const network = stubNetwork();
    const harness = await hydratedHarness(validBlueprint());
    const before = harness.notices.length;
    const receipt = change(harness, "node_people", 8);
    expect(receipt).toMatchObject({ accepted: true });
    expect(harness.notices.length - before).toBe(1);
    expect(harness.runtime.readState("people")).toBe(8);
    expect(harness.runtime.readState("per_person")).toBe(15);
    expect(press(harness, "node_roll")).toMatchObject({ accepted: true });
    expect(capabilityState(harness, "node_random")).toMatchObject({ last_index: expect.any(Number), last_item: expect.any(String) });
    expect(network.calls).toEqual([]);
  });

  test("TEST-F03-AC-016 a failed Action rolls back its whole transaction including RNG, capability state and staged effects", async () => {
    const blueprint = blueprintWith({
      state: {
        count: { mode: "MUTABLE", type: "NUMBER", initial: 1 },
        zero: { mode: "MUTABLE", type: "NUMBER", initial: 0 },
        label: { mode: "MUTABLE", type: "STRING", initial: "", constraints: { max_length: 3 } },
        doubled: { mode: "DERIVED", type: "NUMBER", expr: { kind: "OP", op: "MUL", args: [state("count"), lit(2)] } }
      },
      actions: [
        {
          id: "action_fail_late",
          steps: [
            { type: "SET_STATE", target: "count", value: lit(5) },
            { type: "INVOKE_CAPABILITY", target_node_id: "node_random", capability_action: "sample_number", args: { min: lit(1), max: lit(6) } },
            { type: "INVOKE_CAPABILITY", target_node_id: "node_timer", capability_action: "start", args: {} },
            { type: "INVOKE_CAPABILITY", target_node_id: "node_score", capability_action: "increment", args: { delta: lit(1) } },
            { type: "SET_STATE", target: "count", value: { kind: "OP", op: "DIV", args: [lit(1), state("zero")] } }
          ]
        },
        { id: "action_ok", steps: [{ type: "SET_STATE", target: "count", value: lit(2) }] },
        { id: "action_on_score", steps: [{ type: "SET_STATE", target: "label", value: lit("s") }] }
      ],
      nodes: [
        buttonNode("node_fail", "action_fail_late"),
        buttonNode("node_ok", "action_ok"),
        node("node_random", "logic.random", "1.0.0"),
        node("node_timer", "logic.timer", "1.0.0", { props: { duration_ms: lit(1000) } }),
        node("node_score", "logic.score", "1.0.0", { props: { initial: lit(0), min: lit(0), max: lit(10) }, events: { change: "action_on_score" } })
      ]
    });
    const harness = await hydratedHarness(blueprint);
    const keys = ["count", "zero", "label", "doubled"];
    const capabilityNodes = ["node_random", "node_timer", "node_score"];
    const before = snapshot(harness, keys, capabilityNodes);

    expect(press(harness, "node_fail")).toMatchObject({ accepted: true });

    expect(snapshot(harness, keys, capabilityNodes)).toEqual(before);
    expect(harness.notices).toEqual([]);
    expect(harness.scheduler.activeWakes).toBe(0);
    expect(harness.runtime.status).toBe("READY");
    expect(harness.runtime.runtimeErrors()).toEqual([expect.objectContaining({ code: "F03-ERR-008", action_id: "action_fail_late" })]);

    expect(press(harness, "node_ok")).toMatchObject({ accepted: true });
    expect(harness.runtime.readState("count")).toBe(2);
    expect(harness.runtime.readState("doubled")).toBe(4);
    expect(harness.notices).toEqual(["action_ok"]);
    expect(harness.runtime.readCapabilityState(singletonKey("node_score"))).toEqual({ value: 0 });
  });
});
