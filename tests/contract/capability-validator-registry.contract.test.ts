import { describe, expect, test } from "vitest";

import { VALIDATOR_REGISTRY } from "../../generated/capabilities/validator-registry.js";
import { generateRegistryArtifacts, RegistryGenerationError } from "../../src/platform/capabilities/generate-registry.js";
import { CAPABILITY_REGISTRY_SOURCE } from "../../src/platform/capabilities/registry.js";
import type { CapabilityDefinition, RegistrySource } from "../../src/platform/capabilities/schema/capability-definition.js";
import type { ValidatorContract } from "../../src/platform/capabilities/schema/validator-contract.js";

function withValidator(id: string, change: (validator: ValidatorContract) => ValidatorContract): RegistrySource {
  expect(CAPABILITY_REGISTRY_SOURCE.capabilities.some((definition) => definition.id === id), id).toBe(true);
  return {
    ...CAPABILITY_REGISTRY_SOURCE,
    capabilities: CAPABILITY_REGISTRY_SOURCE.capabilities.map((definition): CapabilityDefinition =>
      definition.id === id
        ? { ...definition, contract: { ...definition.contract, validator: change(definition.contract.validator) } }
        : definition
    )
  };
}

function validatorOf(id: string, version: string): ValidatorContract {
  const entry = VALIDATOR_REGISTRY.capabilities[id]?.[version];
  if (entry === undefined) {
    throw new Error(`Missing validator ${id}@${version}.`);
  }
  return entry.validator;
}

function generationErrorCode(source: RegistrySource): string | undefined {
  try {
    generateRegistryArtifacts(source);
  } catch (error) {
    return error instanceof RegistryGenerationError ? error.code : "UNEXPECTED";
  }
  return undefined;
}

describe("F04 generated validator machine contract", () => {
  test("publishes Registry 4.0.0 with exactly one validator entry per capability ref", () => {
    const generated = generateRegistryArtifacts(CAPABILITY_REGISTRY_SOURCE);
    expect(VALIDATOR_REGISTRY.registry_version).toBe("4.0.0");
    expect(VALIDATOR_REGISTRY.registry_digest).toBe(generated.identity.registryDigest);
    const refs = Object.entries(VALIDATOR_REGISTRY.capabilities).flatMap(([id, versions]) =>
      Object.keys(versions).map((version) => `${id}@${version}`)
    );
    expect(refs).toHaveLength(15);
    expect(refs).toContain("input.select@2.0.0");
    expect(refs).not.toContain("input.select@1.0.0");
  });

  test("encodes composition, select domain and event payload resolvers exactly", () => {
    const list = validatorOf("content.list", "1.0.0");
    expect(list.bindings).toEqual({});
    expect(list.composition).toEqual({ children: true, repeat: true, repeat_required: true });

    const select = validatorOf("input.select", "2.0.0");
    expect(select.bindings.bind).toMatchObject({ matcher: { kind: "ANY_ENUM" }, mutable_state_required: true });
    expect(select.events.change).toMatchObject({ payload: { kind: "BOUND_STATE_DESCRIPTOR", binding_key: "bind" } });
    expect(select.invariant_ids).toEqual(["SELECT_ENUM_DOMAIN"]);

    expect(validatorOf("input.text", "1.0.0").events.change).toMatchObject({
      payload: { kind: "BOUND_STRING_NARROWED_BY_PROP", binding_key: "bind", prop_key: "max_length" }
    });

    expect(validatorOf("logic.random", "1.0.0").capability_state).toMatchObject({
      type: "RECORD",
      constraints: { optional_fields: ["last_index", "last_item", "last_number"] }
    });
  });

  test("fails generation closed when a validator contract is malformed", () => {
    const childrenBinding = withValidator("layout.container", (validator) => ({
      ...validator,
      bindings: {
        ...validator.bindings,
        children: {
          required: false,
          matcher: { kind: "LIST_OF", item: { kind: "EXACT", descriptor: { type: "STRING", constraints: { max_length: 64 } } } },
          source_kinds: ["LITERAL"],
          invariant_ids: [],
          mutable_state_required: false,
          reference: "NODE_ID"
        }
      }
    }));
    expect(generationErrorCode(childrenBinding)).toBe("REGISTRY_GENERATION_INVALID");

    const appStateOptional = withValidator("data.stat", (validator) => ({
      ...validator,
      props: {
        ...validator.props,
        label: {
          ...(validator.props.label as ValidatorContract["props"][string]),
          matcher: {
            kind: "EXACT",
            descriptor: { type: "RECORD", constraints: { fields: { a: { type: "BOOLEAN" } }, optional_fields: ["a"] } }
          }
        }
      }
    }));
    expect(generationErrorCode(appStateOptional)).toBe("REGISTRY_GENERATION_INVALID");

    const repeatRequiredWithoutRepeat = withValidator("content.card", (validator) => ({
      ...validator,
      composition: { children: true, repeat: false, repeat_required: true }
    }));
    expect(generationErrorCode(repeatRequiredWithoutRepeat)).toBe("REGISTRY_GENERATION_INVALID");
  });
});
