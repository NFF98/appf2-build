import { createHash } from "node:crypto";

import { canonicalBlueprintBytes } from "./canonical-json.js";

export type BlueprintContentHash = `sha256:${string}`;

export function hashCanonicalBlueprintBytes(canonicalBytes: Uint8Array): BlueprintContentHash {
  const digest = createHash("sha256").update(canonicalBytes).digest("hex");
  return `sha256:${digest}`;
}

export function hashBlueprint(blueprint: unknown): BlueprintContentHash {
  return hashCanonicalBlueprintBytes(canonicalBlueprintBytes(blueprint));
}
