import { describe, expect, test } from "vitest";

import { VALIDATOR_REGISTRY } from "../../generated/capabilities/validator-registry.js";
import type { JsonRecord } from "../contract/blueprint-validation-fixtures.js";
import { actionIndex, nodeIndex, validBlueprint, withValue } from "../contract/blueprint-validation-fixtures.js";
import {
  expectIssue,
  expectPassed,
  lit,
  minimalBlueprint,
  op,
  registryWithEntry,
  textNode,
  validate
} from "../contract/execution-safety-fixtures.js";

const TEXT = { id: "content.text", version: "1.0.0" };
const TITLE = nodeIndex("node_title");
const CODE_LIKE = "eval(fetch('https://x.test')); import('evil.js'); new Function('return 1')(); <script>alert(1)</script>";

function withNode(index: number, change: (node: JsonRecord) => JsonRecord): JsonRecord {
  const candidate = validBlueprint();
  const nodes = candidate.nodes as JsonRecord[];
  nodes[index] = change(nodes[index]!);
  return candidate;
}

const STRUCTURAL_CARRIERS: readonly { readonly label: string; readonly candidate: JsonRecord; readonly code: string; readonly stage: string; readonly path: string }[] = [
  { label: "root script", candidate: withValue(["script"], "alert(1)"), code: "F02-ERR-002", stage: "V02", path: "$.script" },
  { label: "root module", candidate: withValue(["module"], { url: "https://x.test/m.js" }), code: "F02-ERR-002", stage: "V02", path: "$.module" },
  ...["code", "handler", "module", "import_url", "registration_key", "function_body"].map((key) => ({
    label: `node ${key}`,
    candidate: withNode(TITLE, (node) => ({ ...node, [key]: "alert(1)" })),
    code: "F02-ERR-002",
    stage: "V02",
    path: `$.nodes[${TITLE}].${key}`
  })),
  {
    label: "CapabilityRef handler identity",
    candidate: withNode(TITLE, (node) => ({ ...node, capability: { ...TEXT, registrationKey: "content/text" } })),
    code: "F02-ERR-002",
    stage: "V02",
    path: `$.nodes[${TITLE}].capability.registrationKey`
  },
  {
    label: "executable Value Source kind",
    candidate: withNode(TITLE, (node) => ({ ...node, bindings: { text: { kind: "SCRIPT", source: "alert(1)" } } })),
    code: "F02-ERR-002",
    stage: "V02",
    path: `$.nodes[${TITLE}].bindings.text.kind`
  },
  {
    label: "executable action step",
    candidate: withValue(["actions", actionIndex("action_reset"), "steps", 0], { type: "EVAL", code: "alert(1)" }),
    code: "F02-ERR-002",
    stage: "V02",
    path: `$.actions[${actionIndex("action_reset")}].steps[0].type`
  },
  {
    label: "undeclared capability prop carrier",
    candidate: withNode(TITLE, (node) => ({ ...node, props: { ...(node.props as JsonRecord), script: lit("alert(1)") } })),
    code: "F02-ERR-005",
    stage: "V04",
    path: `$.nodes[${TITLE}].props.script`
  },
  {
    label: "undeclared capability event carrier",
    candidate: withNode(TITLE, (node) => ({ ...node, events: { onload: "action_reset" } })),
    code: "F02-ERR-005",
    stage: "V04",
    path: `$.nodes[${TITLE}].events.onload`
  },
  {
    label: "non-allowlisted operator",
    candidate: withNode(TITLE, (node) => ({ ...node, bindings: { text: op("EVAL", lit("alert(1)")) } })),
    code: "F02-ERR-008",
    stage: "V07",
    path: `$.nodes[${TITLE}].bindings.text.op`
  }
];

function policyRegistry(change: Parameters<typeof registryWithEntry>[2]) {
  return registryWithEntry(VALIDATOR_REGISTRY, TEXT, change);
}

const POLICY_VIOLATIONS = [
  { label: "networkAccessAllowed=true", registry: policyRegistry((entry) => ({ ...entry, resource_budget: { ...entry.resource_budget, networkAccessAllowed: true } })) },
  { label: "mediaAutoplayAllowed=true", registry: policyRegistry((entry) => ({ ...entry, resource_budget: { ...entry.resource_budget, mediaAutoplayAllowed: true } })) },
  { label: "permission_class BROWSER_PERMISSION", registry: policyRegistry((entry) => ({ ...entry, permission_class: "BROWSER_PERMISSION" })) },
  { label: "permission_class EXTERNAL_ENTITLEMENT", registry: policyRegistry((entry) => ({ ...entry, permission_class: "EXTERNAL_ENTITLEMENT" })) }
] as const;

describe("F02 structural no-code execution safety", () => {
  test("TEST-F02-009 rejects every executable carrier structurally, keeps code-like strings inert and enforces V10 policy", () => {
    for (const carrier of STRUCTURAL_CARRIERS) {
      expectIssue(validate(carrier.candidate), carrier, carrier.label);
    }

    const inert = validate(
      withNode(TITLE, (node) => ({ ...node, bindings: { text: lit(CODE_LIKE) } }))
    );
    expectPassed(inert, "code-like text binding stays inert data");
    expect(inert.admissible?.canonicalJson).toContain(JSON.stringify(CODE_LIKE).slice(1, -1));
    expectPassed(validate(withValue(["meta", "description"], "function () { return eval('import(\"x\")'); }")), "code-like meta text");
    expectPassed(validate(minimalBlueprint([textNode("node_code", "import('a'); eval('b'); require('c')")])), "code-like minimal text");

    for (const violation of POLICY_VIOLATIONS) {
      expectIssue(
        validate(minimalBlueprint([textNode("node_text")]), violation.registry),
        { code: "F02-ERR-012", stage: "V10", path: "$.nodes[1].capability", ref: TEXT },
        `node ${violation.label}`
      );
      const degradationOnly = minimalBlueprint([], {
        nodes: [{ ...(minimalBlueprint().nodes as JsonRecord[])[0]! }],
        support: {
          coverage_status: "PARTIALLY_SUPPORTED",
          degradations: [{ requirement_id: "req_text", description: "d", capability_refs: [TEXT], preserves_semantic_core: true }]
        }
      });
      expectIssue(
        validate(degradationOnly, violation.registry),
        { code: "F02-ERR-012", stage: "V10", path: "$.support.degradations[0].capability_refs[0]", ref: TEXT },
        `degradation ${violation.label}`
      );
    }
    expectPassed(
      validate(minimalBlueprint([textNode("node_text")]), policyRegistry((entry) => ({ ...entry, permission_class: "USER_GESTURE" }))),
      "USER_GESTURE remains allowed"
    );
  });
});
