import {describe,it,expect} from "vitest";
import {webcrypto} from "node:crypto";
import {PopKeyring,AGENT_OWNER_PROOF_LIFETIME_MS,
 type StoredPopMaterial,type PopKeyPersistence}
 from "../../src/app/create/pop-keyring.js";
import {keyThumbprint} from "../../src/edge/create-proof.js";
const subtle=webcrypto.subtle as unknown as SubtleCrypto;
const job="6dc1f3f2-3f48-4cb9-bf85-8a9e7d1e597a";
function ring(persistence:PopKeyPersistence){
 return new PopKeyring({subtle,now:Date.now,persistence,
  keyLifetimeMs:AGENT_OWNER_PROOF_LIFETIME_MS});
}
describe("C2: verified owner PoP key must survive a closed tab",()=>{
 it("does not authorize Agent continuation before persistent key commit and readback",async()=>{
  const rows=new Map<string,StoredPopMaterial>();
  let release:()=>void=()=>undefined;
  const pending=new Promise<void>(resolve=>{release=resolve;});
  const persistence:PopKeyPersistence={
   save:async(id,key)=>{await pending;rows.set(id,key);},
   load:async id=>rows.get(id)
  };
  const first=ring(persistence),key=await first.keyForCreate("first");
  let settled=false;
  const binding=first.bindDurableIntent("first",job,key)
   .then(()=>{settled=true;});
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(first.keyForIntent(job)).toBeUndefined();
  release();
  await binding;
  expect(settled).toBe(true);
  const restored=await ring(persistence).recoverForIntent(job);
  expect(restored?.thumbprint).toBe(key.thumbprint);
  const payload=new TextEncoder().encode("same-original-creator");
  const headers=await restored?.proofHeaders(()=>payload);
  expect(typeof headers?.["X-Appf2-PoP-Signature"]).toBe("string");
 });
 it("denies paid continuation when IndexedDB is disabled or fails",async()=>{
  const failing:PopKeyPersistence={
   save:async()=>{throw Error("INDEXEDDB_DISK_FAILURE");},
   load:async()=>undefined
  };
  const owner=ring(failing),key=await owner.keyForCreate("second");
  await expect(owner.bindDurableIntent("second",job,key))
   .rejects.toThrow("INDEXEDDB_DISK_FAILURE");
  expect(owner.keyForIntent(job)).toBeUndefined();
  const noStorage=new PopKeyring({subtle,now:Date.now});
  const orphan=await noStorage.keyForCreate("third");
  await expect(noStorage.bindDurableIntent("third",job,orphan))
   .rejects.toThrow("PERSISTENCE_REQUIRED_NO_AI_CHARGE");
  expect(noStorage.keyForIntent(job)).toBeUndefined();
 });
 it("rejects a mismatched saved public identity without ever exporting private key",async()=>{
  const rows=new Map<string,StoredPopMaterial>();
  const persistence:PopKeyPersistence={
   save:async(id,material)=>{rows.set(id,{...material,
    thumbprint:"wrong-thumbprint"});},
   load:async id=>rows.get(id)
  };
  const owner=ring(persistence),key=await owner.keyForCreate("fourth");
  await expect(owner.bindDurableIntent("fourth",job,key))
   .rejects.toThrow("DURABILITY_NOT_VERIFIED_NO_AI_CHARGE");
  expect(owner.keyForIntent(job)).toBeUndefined();
 });
 it("can identify stored public key without exporting the stored private key",async()=>{
  const rows=new Map<string,StoredPopMaterial>();
  const persistence:PopKeyPersistence={
   save:async(id,material)=>{rows.set(id,material);},
   load:async id=>rows.get(id)
  };
  const owner=ring(persistence),key=await owner.keyForCreate("fifth");
  await owner.bindDurableIntent("fifth",job,key);
  const stored=rows.get(job);
  expect(stored?.privateKey.extractable).toBe(false);
  expect(await keyThumbprint(stored!.spki)).toBe(key.thumbprint);
 });
});
