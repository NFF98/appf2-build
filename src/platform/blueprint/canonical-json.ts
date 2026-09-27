export type CanonicalJsonErrorCode =
  | "ACCESSOR_PROPERTY"
  | "CYCLIC_VALUE"
  | "INVALID_ARRAY_PROPERTY"
  | "NON_FINITE_NUMBER"
  | "UNSUPPORTED_OBJECT"
  | "UNSUPPORTED_TYPE";

export class CanonicalJsonError extends TypeError {
  readonly code: CanonicalJsonErrorCode;
  readonly path: string;

  constructor(code: CanonicalJsonErrorCode, path: string, message: string) {
    super(`${message} at ${path}.`);
    this.name = "CanonicalJsonError";
    this.code = code;
    this.path = path;
  }
}

function compareUnicodeCodePoints(left: string, right: string): number {
  const leftPoints = Array.from(left, (character) => character.codePointAt(0)!);
  const rightPoints = Array.from(right, (character) => character.codePointAt(0)!);
  const sharedLength = Math.min(leftPoints.length, rightPoints.length);

  for (let index = 0; index < sharedLength; index += 1) {
    const difference = leftPoints[index]! - rightPoints[index]!;
    if (difference !== 0) {
      return difference;
    }
  }

  return leftPoints.length - rightPoints.length;
}

function childPath(parent: string, key: string): string {
  return `${parent}[${JSON.stringify(key)}]`;
}

function assertNoSymbolKeys(value: object, path: string): void {
  if (Object.getOwnPropertySymbols(value).length > 0) {
    throw new CanonicalJsonError(
      "UNSUPPORTED_TYPE",
      path,
      "Canonical JSON objects cannot contain symbol keys"
    );
  }
}

function assertDataProperties(value: object, keys: readonly string[], path: string): void {
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (descriptor === undefined || !("value" in descriptor)) {
      throw new CanonicalJsonError(
        "ACCESSOR_PROPERTY",
        childPath(path, key),
        "Canonical JSON cannot execute accessor properties"
      );
    }
  }
}

function serializeArray(
  value: readonly unknown[],
  path: string,
  ancestors: Set<object>
): string {
  assertNoSymbolKeys(value, path);
  const keys = Object.keys(value);
  assertDataProperties(value, keys, path);
  if (
    keys.length !== value.length ||
    keys.some((key, index) => key !== String(index))
  ) {
    throw new CanonicalJsonError(
      "INVALID_ARRAY_PROPERTY",
      path,
      "Canonical JSON arrays must be dense and cannot contain extra enumerable properties"
    );
  }

  return `[${value
    .map((item, index) => serialize(item, `${path}[${index}]`, ancestors))
    .join(",")}]`;
}

function serializeObject(
  value: object,
  path: string,
  ancestors: Set<object>
): string {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new CanonicalJsonError(
      "UNSUPPORTED_OBJECT",
      path,
      "Canonical JSON accepts only plain objects"
    );
  }

  assertNoSymbolKeys(value, path);
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).sort(compareUnicodeCodePoints);
  assertDataProperties(value, keys, path);
  const fields = keys.map((key) => {
    const encodedKey = JSON.stringify(key);
    return `${encodedKey}:${serialize(record[key], childPath(path, key), ancestors)}`;
  });
  return `{${fields.join(",")}}`;
}

function serialize(value: unknown, path: string, ancestors: Set<object>): string {
  if (value === null) {
    return "null";
  }

  switch (typeof value) {
    case "boolean":
    case "string":
      return JSON.stringify(value);
    case "number":
      if (!Number.isFinite(value)) {
        throw new CanonicalJsonError(
          "NON_FINITE_NUMBER",
          path,
          "Canonical JSON numbers must be finite"
        );
      }
      return JSON.stringify(Object.is(value, -0) ? 0 : value);
    case "object": {
      if (ancestors.has(value)) {
        throw new CanonicalJsonError("CYCLIC_VALUE", path, "Canonical JSON cannot be cyclic");
      }
      ancestors.add(value);
      try {
        return Array.isArray(value)
          ? serializeArray(value, path, ancestors)
          : serializeObject(value, path, ancestors);
      } finally {
        ancestors.delete(value);
      }
    }
    default:
      throw new CanonicalJsonError(
        "UNSUPPORTED_TYPE",
        path,
        `Canonical JSON cannot represent ${typeof value}`
      );
  }
}

export function canonicalizeJson(value: unknown): string {
  return serialize(value, "$", new Set<object>());
}

export function canonicalBlueprintBytes(blueprint: unknown): Uint8Array {
  return new TextEncoder().encode(canonicalizeJson(blueprint));
}
