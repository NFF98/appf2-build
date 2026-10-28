import { afterEach, describe, expect, it, vi } from "vitest";
import { keyThumbprint, POP_SIGNATURE_HEADER } from "../../src/edge/create-proof.js";
import type { StoredPopMaterial } from "../../src/app/create/pop-keyring.js";
import { PopKeyring } from "../../src/app/create/pop-keyring.js";
import { createBrowserPopKeyPersistence } from "../../src/app/shell/tab-app-recovery.js";

const ID="0199f5d0-53e8-7505-adf6-bc4c744fe0c7";
type Handler=(()=>void)|null;
class FakeRequest<T>{
  public result!:T;
  public onsuccess:Handler=null;
  public onerror:Handler=null;
}
class FakeOpenRequest<T> extends FakeRequest<T>{
  public onupgradeneeded:Handler=null;
  public onblocked:Handler=null;
}
function memoryStorage(){
  const values=new Map<string,string>();
  return {
    getItem:(key:string)=>values.get(key)??null,
    setItem:(key:string,value:string)=>{values.set(key,value);},
    removeItem:(key:string)=>{values.delete(key);}
  };
}
/** Models asynchronous IDB events and structured-cloned nonextractable CryptoKeys. */
function fakeIndexedDb(){
  const keys=new Map<string,StoredPopMaterial>();
  let storeExists=false;
  const db={
    objectStoreNames:{contains:()=>storeExists},
    createObjectStore:()=>{storeExists=true;},
    close:()=>undefined,
    transaction:()=>{
      const tx:{
        oncomplete:Handler;
        onerror:Handler;
        objectStore:()=>{
          put:(value:StoredPopMaterial,key:string)=>void;
          get:(key:string)=>FakeRequest<StoredPopMaterial|undefined>;
        };
      }={
        oncomplete:null,onerror:null,
        objectStore:()=>({
          put:(value,key)=>{queueMicrotask(()=>{
            keys.set(key,structuredClone(value));
            tx.oncomplete?.();
          });},
          get:(key)=>{
            const req=new FakeRequest<StoredPopMaterial|undefined>();
            queueMicrotask(()=>{
              const material=keys.get(key);
              req.result=material===undefined?undefined:structuredClone(material);
              req.onsuccess?.();
              tx.oncomplete?.();
            });
            return req;
          }
        })
      };
      return tx;
    }
  };
  return {
    open:()=>{
      const req=new FakeOpenRequest<typeof db>();
      queueMicrotask(()=>{
        req.result=db;
        if(!storeExists)req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    }
  };
}
afterEach(()=>vi.unstubAllGlobals());

describe("Sprint 3.5 real nonextractable owner proof across browser tabs",()=>{
  it("recovers the SAME signed owner key after sessionStorage changes; no new key or AI call",async()=>{
    const browserStorage=memoryStorage();
    vi.stubGlobal("localStorage",browserStorage);
    vi.stubGlobal("sessionStorage",memoryStorage());
    vi.stubGlobal("indexedDB",fakeIndexedDb());
    const first=createBrowserPopKeyPersistence();
    expect(first).toBeDefined();
    const pair=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"]);
    const spki=new Uint8Array(await crypto.subtle.exportKey("spki",pair.publicKey));
    const material:StoredPopMaterial={
      privateKey:pair.privateKey,
      spki,
      thumbprint:await keyThumbprint(spki),
      expiresAt:Date.now()+60_000
    };
    expect(material.privateKey.extractable).toBe(false);
    await first!.save(ID,material);
    // A new tab has no access to original sessionStorage; it shares localStorage and IndexedDB.
    vi.stubGlobal("sessionStorage",memoryStorage());
    const second=createBrowserPopKeyPersistence();
    expect(second).toBeDefined();
    const holder=new PopKeyring({subtle:crypto.subtle,now:()=>Date.now(),persistence:second});
    const recovered=await holder.recoverForIntent(ID);
    expect(recovered?.thumbprint).toBe(material.thumbprint);
    const message=new TextEncoder().encode("fresh original-holder read proof");
    const headers=await recovered!.proofHeaders(()=>message);
    const verify=await crypto.subtle.importKey("spki",spki,{name:"ECDSA",namedCurve:"P-256"},false,["verify"]);
    const signature=Uint8Array.from(Buffer.from(headers[POP_SIGNATURE_HEADER]!,"base64url"));
    expect(await crypto.subtle.verify({name:"ECDSA",hash:"SHA-256"},verify,signature,message)).toBe(true);
    expect(await holder.recoverForIntent("0199f5d0-53e8-7505-adf6-bc4c744fe0c8")).toBeUndefined();
    expect(browserStorage.getItem("appf2.browser.pop.nonce.v1")).toBeTruthy();
  });
  it("cannot access the same App key from another browser storage profile",async()=>{
    vi.stubGlobal("localStorage",memoryStorage());
    vi.stubGlobal("sessionStorage",memoryStorage());
    vi.stubGlobal("indexedDB",fakeIndexedDb());
    const original=createBrowserPopKeyPersistence()!;
    const pair=await crypto.subtle.generateKey({name:"ECDSA",namedCurve:"P-256"},false,["sign","verify"]);
    const spki=new Uint8Array(await crypto.subtle.exportKey("spki",pair.publicKey));
    await original.save(ID,{
      privateKey:pair.privateKey,spki,thumbprint:await keyThumbprint(spki),expiresAt:Date.now()+60000
    });
    vi.stubGlobal("localStorage",memoryStorage());
    vi.stubGlobal("sessionStorage",memoryStorage());
    expect(await createBrowserPopKeyPersistence()!.load(ID)).toBeUndefined();
  });
});
