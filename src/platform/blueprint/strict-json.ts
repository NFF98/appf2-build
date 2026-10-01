export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | JsonObject;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type StrictJsonErrorCode = "INVALID_JSON" | "DUPLICATE_KEY" | "INVALID_UTF8";

export class StrictJsonError extends Error {
  readonly code: StrictJsonErrorCode;

  constructor(code: StrictJsonErrorCode, message: string) {
    super(message);
    this.name = "StrictJsonError";
    this.code = code;
  }
}

const MAX_JSON_DEPTH = 256;
const NUMBER_PATTERN = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;

export function decodeCandidateUtf8(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new StrictJsonError("INVALID_UTF8", "Candidate payload is not valid UTF-8.");
    }
    throw error;
  }
}

export function parseStrictJson(source: string): JsonValue {
  const parser = new StrictJsonParser(source);
  return parser.parseDocument();
}

class StrictJsonParser {
  private index = 0;

  constructor(private readonly source: string) {}

  parseDocument(): JsonValue {
    const value = this.parseValue(0);
    this.skipWhitespace();
    if (this.index !== this.source.length) {
      throw new StrictJsonError("INVALID_JSON", "Candidate JSON has trailing content.");
    }
    return value;
  }

  private parseValue(depth: number): JsonValue {
    if (depth > MAX_JSON_DEPTH) {
      throw new StrictJsonError("INVALID_JSON", "Candidate JSON nesting is not admissible.");
    }
    this.skipWhitespace();
    const character = this.peek();
    if (character === "{") {
      return this.parseObject(depth);
    }
    if (character === "[") {
      return this.parseArray(depth);
    }
    if (character === "\"") {
      return this.parseString();
    }
    if (character === "t") {
      return this.consumeLiteral("true", true);
    }
    if (character === "f") {
      return this.consumeLiteral("false", false);
    }
    if (character === "n") {
      return this.consumeLiteral("null", null);
    }
    if (character === "-" || this.isDigit(character)) {
      return this.parseNumber();
    }
    throw new StrictJsonError("INVALID_JSON", "Candidate JSON contains an unexpected token.");
  }

  private parseObject(depth: number): JsonObject {
    this.expect("{");
    this.skipWhitespace();
    const record = Object.create(null) as Record<string, JsonValue>;
    const keys = new Set<string>();
    if (this.peek() === "}") {
      this.index += 1;
      return record;
    }
    this.parseObjectEntry(record, keys, depth);
    while (this.peek() === ",") {
      this.index += 1;
      this.skipWhitespace();
      this.parseObjectEntry(record, keys, depth);
    }
    this.expect("}");
    return record;
  }

  private parseObjectEntry(
    record: Record<string, JsonValue>,
    keys: Set<string>,
    depth: number
  ): void {
    if (this.peek() !== "\"") {
      throw new StrictJsonError("INVALID_JSON", "Candidate JSON object key must be a string.");
    }
    const key = this.parseString();
    if (keys.has(key)) {
      throw new StrictJsonError("DUPLICATE_KEY", "Candidate JSON object has a duplicate key.");
    }
    keys.add(key);
    this.skipWhitespace();
    this.expect(":");
    record[key] = this.parseValue(depth + 1);
    this.skipWhitespace();
  }

  private parseArray(depth: number): JsonValue[] {
    this.expect("[");
    this.skipWhitespace();
    const items: JsonValue[] = [];
    if (this.peek() === "]") {
      this.index += 1;
      return items;
    }
    items.push(this.parseValue(depth + 1));
    this.skipWhitespace();
    while (this.peek() === ",") {
      this.index += 1;
      items.push(this.parseValue(depth + 1));
      this.skipWhitespace();
    }
    this.expect("]");
    return items;
  }

  private parseString(): string {
    this.expect("\"");
    const parts: string[] = [];
    while (this.index < this.source.length) {
      const character = this.source[this.index]!;
      if (character === "\"") {
        this.index += 1;
        return parts.join("");
      }
      if (character === "\\") {
        parts.push(this.parseEscape());
        continue;
      }
      if (character.charCodeAt(0) <= 0x1f) {
        throw new StrictJsonError("INVALID_JSON", "Candidate JSON string contains a raw control character.");
      }
      parts.push(character);
      this.index += 1;
    }
    throw new StrictJsonError("INVALID_JSON", "Candidate JSON string is unterminated.");
  }

  private parseEscape(): string {
    this.index += 1;
    const character = this.peek();
    this.index += 1;
    switch (character) {
      case "\"":
      case "\\":
      case "/":
        return character;
      case "b":
        return "\b";
      case "f":
        return "\f";
      case "n":
        return "\n";
      case "r":
        return "\r";
      case "t":
        return "\t";
      case "u":
        return this.parseUnicodeEscape();
      default:
        throw new StrictJsonError("INVALID_JSON", "Candidate JSON string has an invalid escape.");
    }
  }

  private parseUnicodeEscape(): string {
    const hex = this.source.slice(this.index, this.index + 4);
    if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
      throw new StrictJsonError("INVALID_JSON", "Candidate JSON unicode escape is invalid.");
    }
    this.index += 4;
    return String.fromCharCode(Number.parseInt(hex, 16));
  }

  private parseNumber(): number {
    NUMBER_PATTERN.lastIndex = this.index;
    const match = NUMBER_PATTERN.exec(this.source);
    if (match === null || match.index !== this.index) {
      throw new StrictJsonError("INVALID_JSON", "Candidate JSON number is invalid.");
    }
    const token = match[0];
    this.index += token.length;
    const next = this.source[this.index];
    if (next !== undefined && this.isDigit(next)) {
      throw new StrictJsonError("INVALID_JSON", "Candidate JSON number is invalid.");
    }
    const value = Number(token);
    if (!Number.isFinite(value)) {
      throw new StrictJsonError("INVALID_JSON", "Candidate JSON number is not finite.");
    }
    return value;
  }

  private consumeLiteral<T>(literal: string, value: T): T {
    if (!this.source.startsWith(literal, this.index)) {
      throw new StrictJsonError("INVALID_JSON", "Candidate JSON literal is invalid.");
    }
    this.index += literal.length;
    return value;
  }

  private expect(token: string): void {
    if (!this.source.startsWith(token, this.index)) {
      throw new StrictJsonError("INVALID_JSON", "Candidate JSON contains an unexpected token.");
    }
    this.index += token.length;
  }

  private skipWhitespace(): void {
    while (this.index < this.source.length) {
      const character = this.source[this.index];
      if (character !== " " && character !== "\n" && character !== "\r" && character !== "\t") {
        return;
      }
      this.index += 1;
    }
  }

  private peek(): string {
    const character = this.source[this.index];
    if (character === undefined) {
      throw new StrictJsonError("INVALID_JSON", "Candidate JSON ended unexpectedly.");
    }
    return character;
  }

  private isDigit(character: string): boolean {
    return character >= "0" && character <= "9";
  }
}
