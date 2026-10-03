import { createHash } from "node:crypto";

import { fail, MAX_CANDIDATE_PAYLOAD_BYTES, type JsonValue } from "./validation-types.js";

export function computeCandidateDigest(candidatePayloadBytes: Uint8Array): string {
  return `sha256:${createHash("sha256").update(candidatePayloadBytes).digest("hex")}`;
}

class InvalidJson extends Error {
  public constructor(
    public readonly offset: number,
    message: string
  ) {
    super(message);
    this.name = "InvalidJson";
  }
}

type MutableJsonObject = Record<string, JsonValue>;

type Frame =
  | { readonly kind: "ARRAY"; readonly value: JsonValue[] }
  | { readonly kind: "OBJECT"; readonly value: MutableJsonObject; key: string };

const NUMBER_PATTERN = /-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const SIMPLE_ESCAPES: Readonly<Record<string, string>> = {
  '"': '"',
  "\\": "\\",
  "/": "/",
  b: "\b",
  f: "\f",
  n: "\n",
  r: "\r",
  t: "\t"
};

class StrictJsonParser {
  private index = 0;

  public constructor(private readonly text: string) {}

  public parse(): JsonValue {
    const stack: Frame[] = [];
    for (;;) {
      let value = this.readValueOrOpen(stack);
      while (value !== undefined) {
        const frame = stack.at(-1);
        if (frame === undefined) {
          this.skipWhitespace();
          if (this.index !== this.text.length) {
            throw new InvalidJson(this.index, "Unexpected trailing content.");
          }
          return value;
        }
        value = this.appendToFrame(frame, value, stack);
      }
    }
  }

  private appendToFrame(frame: Frame, value: JsonValue, stack: Frame[]): JsonValue | undefined {
    if (frame.kind === "ARRAY") {
      frame.value.push(value);
    } else {
      frame.value[frame.key] = value;
    }
    this.skipWhitespace();
    const next = this.text[this.index];
    const closer = frame.kind === "ARRAY" ? "]" : "}";
    if (next === ",") {
      this.index += 1;
      if (frame.kind === "OBJECT") {
        frame.key = this.readObjectKey(frame.value);
      }
      return undefined;
    }
    if (next === closer) {
      this.index += 1;
      stack.pop();
      return frame.value;
    }
    throw new InvalidJson(this.index, "Expected a separator or container end.");
  }

  private readValueOrOpen(stack: Frame[]): JsonValue | undefined {
    this.skipWhitespace();
    const character = this.text[this.index];
    if (character === "{") {
      this.index += 1;
      const value = Object.create(null) as MutableJsonObject;
      this.skipWhitespace();
      if (this.text[this.index] === "}") {
        this.index += 1;
        return value;
      }
      stack.push({ kind: "OBJECT", value, key: this.readObjectKey(value) });
      return undefined;
    }
    if (character === "[") {
      this.index += 1;
      this.skipWhitespace();
      if (this.text[this.index] === "]") {
        this.index += 1;
        return [];
      }
      stack.push({ kind: "ARRAY", value: [] });
      return undefined;
    }
    return this.readPrimitive(character);
  }

  private readObjectKey(target: MutableJsonObject): string {
    this.skipWhitespace();
    if (this.text[this.index] !== '"') {
      throw new InvalidJson(this.index, "Expected an object key.");
    }
    const key = this.readString();
    if (Object.hasOwn(target, key)) {
      throw new InvalidJson(this.index, "Duplicate object key.");
    }
    this.skipWhitespace();
    if (this.text[this.index] !== ":") {
      throw new InvalidJson(this.index, "Expected ':' after object key.");
    }
    this.index += 1;
    return key;
  }

  private readPrimitive(character: string | undefined): JsonValue {
    if (character === '"') {
      return this.readString();
    }
    for (const [literal, value] of [["true", true], ["false", false], ["null", null]] as const) {
      if (this.text.startsWith(literal, this.index)) {
        this.index += literal.length;
        return value;
      }
    }
    NUMBER_PATTERN.lastIndex = this.index;
    const match = NUMBER_PATTERN.exec(this.text);
    if (match === null) {
      throw new InvalidJson(this.index, "Unexpected token.");
    }
    const value = Number(match[0]);
    if (!Number.isFinite(value)) {
      throw new InvalidJson(this.index, "JSON number is not finite.");
    }
    this.index += match[0].length;
    return value;
  }

  private readString(): string {
    this.index += 1;
    const parts: string[] = [];
    let chunkStart = this.index;
    for (;;) {
      const code = this.text.charCodeAt(this.index);
      if (Number.isNaN(code)) {
        throw new InvalidJson(this.index, "Unterminated string.");
      }
      if (code === 0x22) {
        parts.push(this.text.slice(chunkStart, this.index));
        this.index += 1;
        return parts.join("");
      }
      if (code < 0x20) {
        throw new InvalidJson(this.index, "Unescaped control character in string.");
      }
      if (code === 0x5c) {
        parts.push(this.text.slice(chunkStart, this.index));
        parts.push(this.readEscape());
        chunkStart = this.index;
        continue;
      }
      this.index += 1;
    }
  }

  private readEscape(): string {
    const marker = this.text[this.index + 1];
    if (marker === "u") {
      const hex = this.text.slice(this.index + 2, this.index + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
        throw new InvalidJson(this.index, "Invalid unicode escape.");
      }
      this.index += 6;
      return String.fromCharCode(Number.parseInt(hex, 16));
    }
    const replacement = marker === undefined ? undefined : SIMPLE_ESCAPES[marker];
    if (replacement === undefined) {
      throw new InvalidJson(this.index, "Invalid escape sequence.");
    }
    this.index += 2;
    return replacement;
  }

  private skipWhitespace(): void {
    for (;;) {
      const code = this.text.charCodeAt(this.index);
      if (code !== 0x20 && code !== 0x09 && code !== 0x0a && code !== 0x0d) {
        return;
      }
      this.index += 1;
    }
  }
}

const UTF8_DECODER = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

export function parseCandidatePayload(candidatePayloadBytes: Uint8Array): Readonly<Record<string, JsonValue>> {
  if (candidatePayloadBytes.byteLength > MAX_CANDIDATE_PAYLOAD_BYTES) {
    fail("F02-ERR-001", "V01", "$", "Candidate payload exceeds 524,288 bytes.");
  }
  let text: string;
  try {
    text = UTF8_DECODER.decode(candidatePayloadBytes);
  } catch {
    return fail("F02-ERR-001", "V01", "$", "Candidate payload is not valid UTF-8.");
  }
  let root: JsonValue;
  try {
    root = new StrictJsonParser(text).parse();
  } catch (error: unknown) {
    if (error instanceof InvalidJson) {
      return fail("F02-ERR-001", "V01", "$", `Invalid JSON at offset ${error.offset}: ${error.message}`);
    }
    throw error;
  }
  if (typeof root !== "object" || root === null || Array.isArray(root)) {
    return fail("F02-ERR-001", "V01", "$", "Candidate root must be a JSON object.");
  }
  return root as Readonly<Record<string, JsonValue>>;
}
