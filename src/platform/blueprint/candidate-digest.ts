import { sha256Prefixed } from "./content-identity.js";
import type { BlueprintContentHash } from "./content-identity.js";

const CANDIDATE_DIGEST_PATTERN = /^sha256:[0-9a-f]{64}$/;

export function digestCandidateBytes(bytes: Uint8Array): BlueprintContentHash {
  const digest = sha256Prefixed(bytes);
  if (!CANDIDATE_DIGEST_PATTERN.test(digest)) {
    throw new Error("Candidate digest was not a canonical SHA-256 identity.");
  }
  return digest;
}
