import { afterEach, describe, expect, it, vi } from "vitest";
import { POP_KEY_HEADER, POP_SIGNATURE_HEADER } from "../../src/edge/create-proof.js";
import { PopKeyring, type StoredPopMaterial } from "../../src/app/create/pop-keyring.js";
import { clearTabAppTarget, readTabAppTarget, saveTabAppTarget } from "../../src/app/shell/tab-app-recovery.js";

const intentId = "0199f5d0-53e8-7505-adf6-bc4c744fe0c7";
const hash = "sha256:"+"b".repeat(64);
afterEach(()=>vi.unstubAllGlobals());

describe("Sprint3.5 original-holder tab reload without exported private keys",()=>{
  it("recovers identical nonextractable signing identity and produces independently verified ECDSA proof",async()=>{
    const saved = new Map<string,StoredPopMaterial>();
    const persistence = {
      save:async (id:string,material:StoredPopMaterial)=>{saved.set(id,material);},
      load:async (id:string)=>saved.get(id)
    };
    const dependencies={subtle:globalThis.crypto.subtle,now:()=>Date.now(),persistence};
    const first=new PopKeyring(dependencies);
    const original=await first.keyForCreate("operation1");
    first.bindIntent("operation1",intentId,original);
    const row=saved.get(intentId);
    expect(row?.privateKey.extractable).toBe(false);
    expect(row?.privateKey.usages).toContain("sign");
    const reloaded=new PopKeyring(dependencies);
    expect(reloaded.keyForIntent(intentId)).toBeUndefined();
    const recovered=await reloaded.recoverForIntent(intentId);
    expect(recovered?.thumbprint).toBe(original.thumbprint);
    const bytes=new TextEncoder().encode("fresh GET original-holder proof");
    const headers=await recovered!.proofHeaders(()=>bytes);
    expect(headers[POP_KEY_HEADER]).toBeDefined();
    expect(headers[POP_SIGNATURE_HEADER]).toBeDefined();
    const verifier=await globalThis.crypto.subtle.importKey("spki",row!.spki,
      {name:"ECDSA",namedCurve:"P-256"},false,["verify"]);
    const signature=Uint8Array.from(Buffer.from(headers[POP_SIGNATURE_HEADER]!,"base64url"));
    expect(await globalThis.crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},verifier,
      signature,bytes)).toBe(true);
  });
  it("never generates a substitute key for missing, expired or forged original holder",async()=>{
    const stale=new Map<string,StoredPopMaterial>();
    const persistence={
      save:async(id:string,material:StoredPopMaterial)=>{stale.set(id,material);},
      load:async(id:string)=>stale.get(id)
    };
    const first=new PopKeyring({subtle:crypto.subtle,now:()=>1000,persistence});
    const key=await first.keyForCreate("op");
    first.bindIntent("op",intentId,key);
    expect(await new PopKeyring({subtle:crypto.subtle,
      now:()=>1000+24*60*60*1000+1,persistence}).recoverForIntent(intentId)).toBeUndefined();
    expect(await new PopKeyring({subtle:crypto.subtle,
      now:()=>1000,persistence}).recoverForIntent("different-intent")).toBeUndefined();
  });
});

describe("Sprint3.5 app target scoped to the same tab, content hash and TTL",()=>{
  it("holds only content hash + opaque intent ID, and clears on Home",()=>{
    const values=new Map<string,string>();
    vi.stubGlobal("sessionStorage",{
      getItem:(key:string)=>values.get(key)??null,
      setItem:(key:string,value:string)=>{values.set(key,value);},
      removeItem:(key:string)=>{values.delete(key);}
    });
    saveTabAppTarget({intentId,contentHash:hash});
    expect(readTabAppTarget()).toEqual({intentId,contentHash:hash});
    expect([...values.values()][0]).not.toContain("signature");
    clearTabAppTarget();
    expect(readTabAppTarget()).toBeNull();
  });
  it("fails closed on malformed storage data",()=>{
    vi.stubGlobal("sessionStorage",{
      getItem:()=>'{ "intentId": "evil", "contentHash": "bad", "savedAt": 0 }',
      setItem:()=>{},removeItem:()=>{}
    });
    expect(readTabAppTarget()).toBeNull();
  });
});
