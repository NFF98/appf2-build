import {
  encodeBase64Url,
  keyThumbprint,
  POP_KEY_HEADER,
  POP_SIGNATURE_HEADER,
  POP_TIMESTAMP_HEADER
} from "../../edge/create-proof.js";

/** One nonextractable P-256 signing key; only its SPKI and thumbprint ever leave the browser key store. */
export interface PopKey {
  readonly thumbprint: string;
  proofHeaders(transcript: (timestampMs: number) => Promise<Uint8Array<ArrayBuffer>> | Uint8Array<ArrayBuffer>): Promise<Record<string, string>>;
}

export interface PopKeyringDependencies {
  readonly subtle: SubtleCrypto;
  readonly now: () => number;
}

const P256 = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDSA_SHA256 = { name: "ECDSA", hash: "SHA-256" } as const;

async function generatePopKey({ subtle, now }: PopKeyringDependencies): Promise<PopKey> {
  const pair = await subtle.generateKey(P256, false, ["sign", "verify"]);
  const spki = new Uint8Array(await subtle.exportKey("spki", pair.publicKey));
  const encodedKey = encodeBase64Url(spki);
  const thumbprint = await keyThumbprint(spki);
  return {
    thumbprint,
    proofHeaders: async (transcript) => {
      const timestampMs = Math.trunc(now());
      const signature = new Uint8Array(await subtle.sign(ECDSA_SHA256, pair.privateKey, await transcript(timestampMs)));
      return {
        [POP_KEY_HEADER]: encodedKey,
        [POP_SIGNATURE_HEADER]: encodeBase64Url(signature),
        [POP_TIMESTAMP_HEADER]: String(timestampMs)
      };
    }
  };
}

/**
 * F01-API-ID-001A memory-only key store: one key per logical CREATE (a retry reuses it, so the reserved CREATE key
 * stays stable), then bound to the created intent for its answers / compile / Blueprint access proofs. A reload
 * loses every key, which the server treats as lost original-holder authority.
 */
export class PopKeyring {
  private readonly creates = new Map<string, Promise<PopKey>>();
  private readonly intents = new Map<string, PopKey>();

  public constructor(private readonly dependencies: PopKeyringDependencies) {}

  public keyForCreate(logicalOperationKey: string): Promise<PopKey> {
    const existing = this.creates.get(logicalOperationKey);
    if (existing !== undefined) return existing;
    const created = generatePopKey(this.dependencies);
    this.creates.set(logicalOperationKey, created);
    void created.catch(() => this.creates.delete(logicalOperationKey));
    return created;
  }

  public bindIntent(logicalOperationKey: string, intentId: string, key: PopKey): void {
    this.intents.set(intentId, key);
    this.creates.delete(logicalOperationKey);
  }

  public keyForIntent(intentId: string): PopKey | undefined {
    return this.intents.get(intentId);
  }
}
