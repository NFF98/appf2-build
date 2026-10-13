import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";

/**
 * Closed catalog of `details.violations[].reason` IDs the F01 / Worker API can emit. A new, renamed or removed reason must
 * be reviewed here (PR #365 merge item: API error reason enumeration).
 */
const API_REASON_SOURCES = ["src/edge", "src/platform/compiler", "src/platform/intent"];

const PINNED_REASONS = [
  "ANONYMOUS_CONTINUITY_MISMATCH",
  "ANONYMOUS_IDENTITY_UNAVAILABLE",
  "CLARIFICATION_REQUIRED",
  "CROSS_SITE_WRITE",
  "EDITED_VALUE_ONLY_FOR_EDIT",
  "EMPTY_STRING",
  "INTENT_NOT_ANSWERABLE",
  "INTENT_NOT_COMPILABLE",
  "INVALID_ARRAY",
  "INVALID_CONTENT_HASH",
  "INVALID_ENUM",
  "INVALID_JSON_OBJECT",
  "INVALID_POSITIVE_INTEGER",
  "INVALID_STRING",
  "INVALID_UUID",
  "MATERIAL_ASSUMPTIONS_PENDING",
  "MISSING_FIELD",
  "NO_ANSWER_OR_DECISION",
  "PROOF_INVALID",
  "SERVER_OWNED_FIELD",
  "TRUSTED_IDENTITY_REQUIRED",
  "UNKNOWN_FIELD"
];

function sourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });
}

function emittedReasons(): string[] {
  const reasons = new Set<string>();
  for (const file of API_REASON_SOURCES.flatMap(sourceFiles)) {
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const start = line.search(/\breason\b|untrustedContextResponse\(request,/u);
      if (start < 0) continue;
      for (const match of line.slice(start).matchAll(/(?<!===\s)"([A-Z][A-Z0-9_]{2,})"/gu)) reasons.add(match[1] as string);
    }
  }
  return [...reasons].sort();
}

describe("F01 / Worker API violation reason catalog", () => {
  test("every reason literal emitted by the API sources is in the pinned catalog, and nothing stale remains", () => {
    expect(emittedReasons()).toEqual(PINNED_REASONS);
  });
});
