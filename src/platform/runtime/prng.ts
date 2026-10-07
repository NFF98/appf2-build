import { runtimeFail } from "./runtime-errors.js";

/** F03-RQ-009 appf2 PRNG v1: PCG32 (XSH RR 64/32) stream; output fixed by golden-vector tests. */
export const PRNG_ALGORITHM = "appf2-PCG32-v1";
export const PRNG_SEED_BYTES = 16;

const MASK_64 = (1n << 64n) - 1n;
const MULTIPLIER = 6364136223846793005n;

export interface RngMetadata {
  readonly algorithm: typeof PRNG_ALGORITHM;
  /** 128-bit instance seed as 32 lowercase hex digits. */
  readonly seed: string;
  /** Number of 32-bit outputs consumed since seeding. */
  readonly counter: number;
}

/** Runtime RNG service exposed to trusted SEEDED capabilities; never Math.random. */
export interface RngService {
  nextUint32(): number;
}

export interface Pcg32State {
  readonly seed: string;
  readonly state: bigint;
  readonly increment: bigint;
  readonly counter: number;
}

function step(state: bigint, increment: bigint): bigint {
  return (state * MULTIPLIER + increment) & MASK_64;
}

function output(previous: bigint): number {
  const xorShifted = Number((((previous >> 18n) ^ previous) >> 27n) & 0xffffffffn);
  const rotation = Number(previous >> 59n);
  return ((xorShifted >>> rotation) | (xorShifted << ((32 - rotation) & 31))) >>> 0;
}

function readUint64(bytes: Uint8Array, offset: number): bigint {
  let value = 0n;
  for (let index = offset; index < offset + 8; index += 1) {
    value = (value << 8n) | BigInt(bytes[index] as number);
  }
  return value;
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * 128-bit seed → PCG32 `srandom(initstate, initseq)` with initstate = bytes[0..8) and initseq = bytes[8..16),
 * both big-endian. This mapping is part of appf2-PCG32-v1 and is pinned by golden vectors.
 */
export function seedPcg32(seed: Uint8Array): Pcg32State {
  if (seed.byteLength !== PRNG_SEED_BYTES) {
    return runtimeFail("F03-ERR-017", "appf2-PCG32-v1 requires a 128-bit instance seed.");
  }
  const increment = ((readUint64(seed, 8) << 1n) | 1n) & MASK_64;
  const primed = step(0n, increment);
  const state = step((primed + readUint64(seed, 0)) & MASK_64, increment);
  return { seed: toHex(seed), state, increment, counter: 0 };
}

/** Mutable cursor over an immutable committed RNG state; committed only with its Action transaction. */
export class Pcg32Cursor implements RngService {
  private state: bigint;
  private counter: number;

  public constructor(private readonly origin: Pcg32State) {
    this.state = origin.state;
    this.counter = origin.counter;
  }

  public nextUint32(): number {
    const previous = this.state;
    this.state = step(previous, this.origin.increment);
    this.counter += 1;
    return output(previous);
  }

  public snapshot(): Pcg32State {
    return { seed: this.origin.seed, state: this.state, increment: this.origin.increment, counter: this.counter };
  }
}

export function rngMetadata(state: Pcg32State): RngMetadata {
  return { algorithm: PRNG_ALGORITHM, seed: state.seed, counter: state.counter };
}
