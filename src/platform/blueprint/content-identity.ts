import { createHash } from "node:crypto";

import { canonicalBlueprintBytes } from "./canonical-json.js";

export type BlueprintContentHash = `sha256:${string}`;

export function sha256Prefixed(bytes: Uint8Array): BlueprintContentHash {
  const digest = createHash("sha256").update(bytes).digest("hex");
  return `sha256:${digest}`;
}

export interface CanonicalBlueprintIdentity {
  readonly bytes: Uint8Array;
  readonly contentHash: BlueprintContentHash;
}

export function canonicalBlueprintIdentity(blueprint: unknown): CanonicalBlueprintIdentity {
  const bytes = canonicalBlueprintBytes(blueprint);
  return {
    bytes,
    contentHash: sha256Prefixed(bytes)
  };
}

export function hashBlueprint(blueprint: unknown): BlueprintContentHash {
  return canonicalBlueprintIdentity(blueprint).contentHash;
}
