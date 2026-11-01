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

export interface StoredPopMaterial {
  /** Nonextractable CryptoKey. Structured-cloned by the browser, never exported to text. */
  readonly privateKey: CryptoKey;
  readonly spki: Uint8Array<ArrayBuffer>;
  readonly thumbprint: string;
  readonly expiresAt: number;
}
export interface PopKeyPersistence {
  save(intentId: string, material: StoredPopMaterial): Promise<void>;
  load(intentId: string): Promise<StoredPopMaterial | undefined>;
}
export interface PopKeyringDependencies {
  readonly subtle: SubtleCrypto;
  readonly now: () => number;
  readonly persistence?: PopKeyPersistence;
  /** Only Agent Jobs opt in to long recovery; F01 stays at 24h. */
  readonly keyLifetimeMs?:number;
}

export const AGENT_OWNER_PROOF_LIFETIME_MS=30*24*60*60*1000;
const DEFAULT_PROOF_LIFETIME_MS=24*60*60*1000;

const P256 = { name: "ECDSA", namedCurve: "P-256" } as const;
const ECDSA_SHA256 = { name: "ECDSA", hash: "SHA-256" } as const;

/** No private key bytes ever leave WebCrypto or appear in web storage text. */
function wrapPopKey(material: StoredPopMaterial, {subtle,now}:PopKeyringDependencies):PopKey {
  const encodedKey=encodeBase64Url(material.spki);
  return {
    thumbprint:material.thumbprint,
    proofHeaders:async (transcript)=>{
      const timestampMs=Math.trunc(now());
      const signature=new Uint8Array(await subtle.sign(ECDSA_SHA256,material.privateKey,await transcript(timestampMs)));
      return {
        [POP_KEY_HEADER]:encodedKey,
        [POP_SIGNATURE_HEADER]:encodeBase64Url(signature),
        [POP_TIMESTAMP_HEADER]:String(timestampMs)
      };
    }
  };
}

async function generatePopKey(dependencies:PopKeyringDependencies):
  Promise<{key:PopKey;material:StoredPopMaterial}> {
  const pair=await dependencies.subtle.generateKey(P256,false,["sign","verify"]);
  const spki=new Uint8Array(await dependencies.subtle.exportKey("spki",pair.publicKey));
  const material:StoredPopMaterial={
    privateKey:pair.privateKey,spki,thumbprint:await keyThumbprint(spki),
    expiresAt:dependencies.now()+(dependencies.keyLifetimeMs??DEFAULT_PROOF_LIFETIME_MS)
  };
  return {key:wrapPopKey(material,dependencies),material};
}
/**
 * F01 original-holder continuity: one nonextractable key per logical CREATE,
 * bound to its exact Intent. Browser-only, time-limited persistence can recover
 * the same key after same-tab reload; the server still requires a fresh signed
 * proof and fresh admission. No grant, bearer or exported private key is stored.
 */
export class PopKeyring {
  private readonly creates = new Map<string, Promise<PopKey>>();
  private readonly intents = new Map<string, PopKey>();
  private readonly keyMaterial = new WeakMap<PopKey, StoredPopMaterial>();

  public constructor(private readonly dependencies: PopKeyringDependencies) {}

  public keyForCreate(logicalOperationKey: string): Promise<PopKey> {
    const existing = this.creates.get(logicalOperationKey);
    if (existing !== undefined) return existing;
    const created = generatePopKey(this.dependencies).then(({key,material})=>{
      this.keyMaterial.set(key,material);
      return key;
    });
    this.creates.set(logicalOperationKey, created);
    void created.catch(() => this.creates.delete(logicalOperationKey));
    return created;
  }

  public bindIntent(logicalOperationKey: string, intentId: string, key: PopKey): void {
    this.intents.set(intentId, key);
    this.creates.delete(logicalOperationKey);
    const material=this.keyMaterial.get(key);
    if(material!==undefined && this.dependencies.persistence!==undefined)
      void this.dependencies.persistence.save(intentId,material).catch(()=>{});

  }

  /** Durable Agent admission: no paid work until the ORIGINAL owner key has
   * been committed to persistent browser storage and independently read back.
   * Legacy F01 bindIntent remains non-blocking; Agent must call this method.
   * Never mint a replacement key or export private bytes.
   */
  public async bindDurableIntent(logicalOperationKey:string,intentId:string,
    key:PopKey):Promise<void> {
    const material=this.keyMaterial.get(key);
    const persistence=this.dependencies.persistence;
    if(!material||!persistence)
      throw Error("AGENT_OWNER_KEY_PERSISTENCE_REQUIRED_NO_AI_CHARGE");
    // Do not register or discard the logical key until storage is durable.
    await persistence.save(intentId,material);
    const saved=await persistence.load(intentId);
    if(!saved||saved.thumbprint!==material.thumbprint||
      saved.expiresAt!==material.expiresAt||
      saved.privateKey.extractable!==false||
      !saved.privateKey.usages.includes("sign")||
      saved.thumbprint!==await keyThumbprint(saved.spki))
      throw Error("AGENT_OWNER_KEY_DURABILITY_NOT_VERIFIED_NO_AI_CHARGE");
    // Verify that the persisted private key signs for the expected public key:
    // browser storage may be stale or tampered with.
    const challenge=new TextEncoder().encode(
      "APPF2_AGENT_OWNER_RESTORE_PROOF_V1:"+intentId);
    const signature=await this.dependencies.subtle.sign(
      ECDSA_SHA256,saved.privateKey,challenge);
    const publicKey=await this.dependencies.subtle.importKey("spki",
      saved.spki,P256,false,["verify"]);
    if(!await this.dependencies.subtle.verify(
      ECDSA_SHA256,publicKey,signature,challenge))
      throw Error("AGENT_OWNER_KEY_PAIR_MISMATCH_NO_AI_CHARGE");
    this.intents.set(intentId,wrapPopKey(saved,this.dependencies));
    this.creates.delete(logicalOperationKey);
  }

  public keyForIntent(intentId: string): PopKey | undefined {
    return this.intents.get(intentId);
  }

  /** Never mint a replacement key for an existing Intent. A mismatched holder
   * must fail closed at F01; only recover the original signed proof identity. */
  public async recoverForIntent(intentId:string):Promise<PopKey | undefined> {
    const held=this.intents.get(intentId);
    if(held!==undefined) return held;
    let material:StoredPopMaterial | undefined;
    try { material=await this.dependencies.persistence?.load(intentId); }
    catch { return undefined; }
    if(material===undefined || !Number.isFinite(material.expiresAt) ||
      material.expiresAt<=this.dependencies.now() || material.privateKey.extractable ||
      !material.privateKey.usages.includes("sign")) return undefined;
    try {
      if(material.thumbprint!==await keyThumbprint(material.spki)) return undefined;
      const restored=wrapPopKey(material,this.dependencies);
      this.intents.set(intentId,restored);
      return restored;
    } catch { return undefined; }
  }
}
