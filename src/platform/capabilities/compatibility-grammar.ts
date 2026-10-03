import { SEMVER_PATTERN } from "./schema/validator-contract.js";

export type SemVer = readonly [number, number, number];

export interface VersionInterval {
  readonly min: SemVer;
  readonly maxExclusive: SemVer;
}

export type VersionRange =
  | { readonly kind: "EXACT"; readonly version: SemVer }
  | ({ readonly kind: "INTERVAL" } & VersionInterval);

const BOUNDED_RANGE_PATTERN = /^>=(\S+) <(\S+)$/;

export function parseSemVer(version: string): SemVer | undefined {
  const match = SEMVER_PATTERN.exec(version);
  if (match === null) {
    return undefined;
  }
  const parts = [Number(match[1]), Number(match[2]), Number(match[3])] as const;
  return parts.every(Number.isSafeInteger) ? parts : undefined;
}

export function compareSemVer(left: SemVer, right: SemVer): number {
  for (let index = 0; index < 3; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

export function compareVersionStrings(left: string, right: string): number {
  const leftVersion = parseSemVer(left);
  const rightVersion = parseSemVer(right);
  if (leftVersion === undefined || rightVersion === undefined) {
    throw new TypeError(`Cannot compare non-SemVer versions ${left} and ${right}.`);
  }
  return compareSemVer(leftVersion, rightVersion);
}

function caretUpperBound(version: SemVer): SemVer {
  if (version[0] > 0) {
    return [version[0] + 1, 0, 0];
  }
  return version[1] > 0 ? [0, version[1] + 1, 0] : [0, 0, version[2] + 1];
}

function interval(min: SemVer, maxExclusive: SemVer): VersionRange | undefined {
  return compareSemVer(min, maxExclusive) < 0 ? { kind: "INTERVAL", min, maxExclusive } : undefined;
}

/** Accepts only `SemVer`, `^SemVer` or `>=SemVer <SemVer`; empty intervals are invalid. */
export function parseVersionRange(range: string): VersionRange | undefined {
  const exact = parseSemVer(range);
  if (exact !== undefined) {
    return { kind: "EXACT", version: exact };
  }
  if (range.startsWith("^")) {
    const minimum = parseSemVer(range.slice(1));
    return minimum === undefined ? undefined : interval(minimum, caretUpperBound(minimum));
  }
  const bounded = BOUNDED_RANGE_PATTERN.exec(range);
  if (bounded === null) {
    return undefined;
  }
  const minimum = parseSemVer(bounded[1]!);
  const maximum = parseSemVer(bounded[2]!);
  return minimum === undefined || maximum === undefined ? undefined : interval(minimum, maximum);
}

export function versionInRange(version: SemVer, range: VersionRange): boolean {
  if (range.kind === "EXACT") {
    return compareSemVer(version, range.version) === 0;
  }
  return compareSemVer(version, range.min) >= 0 && compareSemVer(version, range.maxExclusive) < 0;
}

/** minRuntimeVersion is an inclusive bare SemVer; maxRuntimeVersion must be the exclusive token `<SemVer`. */
export function parseRuntimeBounds(minRuntimeVersion: string, maxRuntimeVersion: string): VersionInterval | undefined {
  const min = parseSemVer(minRuntimeVersion);
  const max = maxRuntimeVersion.startsWith("<") ? parseSemVer(maxRuntimeVersion.slice(1)) : undefined;
  if (min === undefined || max === undefined || compareSemVer(min, max) >= 0) {
    return undefined;
  }
  return { min, maxExclusive: max };
}

export function versionInInterval(version: SemVer, bounds: VersionInterval): boolean {
  return compareSemVer(version, bounds.min) >= 0 && compareSemVer(version, bounds.maxExclusive) < 0;
}
