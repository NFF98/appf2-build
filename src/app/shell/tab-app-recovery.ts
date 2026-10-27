import type { PopKeyPersistence, StoredPopMaterial } from "../create/pop-keyring.js";

/** Same-tab only: just a content-addressed target, never prompts, auth headers,
 * PoP signatures, credentials, model responses or raw Blueprint bodies. */
const TARGET_SLOT="appf2.tab.app.v1";
const NONCE_SLOT="appf2.tab.pop.nonce.v1";
const DB_NAME="appf2.tab.pop.v1";
const DB_STORE="keys";
const MAX_AGE=24*60*60*1000;
export interface TabAppTarget { readonly intentId:string; readonly contentHash:string }

function storage():Storage|undefined {
  try {return globalThis.sessionStorage;} catch {return undefined;}
}
// eslint-disable-next-line complexity -- Restore/auth state and strict tab-target guards must all fail closed.
export function readTabAppTarget():TabAppTarget|null {
  try {
    const raw=storage()?.getItem(TARGET_SLOT);
    if(raw===undefined || raw===null || raw.length>500) return null;
    const target:unknown=JSON.parse(raw);
    if(typeof target!=="object" || target===null || Array.isArray(target))return null;
    const x=target as Record<string,unknown>;
    if(typeof x.intentId!=="string" || !/^[a-zA-Z0-9_-]{8,128}$/.test(x.intentId) ||
      typeof x.contentHash!=="string" || !/^sha256:[0-9a-f]{64}$/.test(x.contentHash) ||
      typeof x.savedAt!=="number" || !Number.isFinite(x.savedAt) ||
      x.savedAt>Date.now()+60000 || Date.now()-x.savedAt>MAX_AGE) return null;
    return {intentId:x.intentId,contentHash:x.contentHash};
  } catch {return null;}
}
export function saveTabAppTarget(target:TabAppTarget):void {
  try {
    storage()?.setItem(TARGET_SLOT,JSON.stringify({...target,savedAt:Date.now()}));
  } catch { /* Private browsing degrades to memory-only recovery. */ }
}
export function clearTabAppTarget():void {
  try {storage()?.removeItem(TARGET_SLOT);} catch { /* Storage unavailable. */ }
}

function openDb(factory:IDBFactory):Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    const request=factory.open(DB_NAME,1);
    request.onupgradeneeded=()=>{
      const db=request.result;
      if(!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
    };
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(new Error("Browser key store unavailable"));
    request.onblocked=()=>reject(new Error("Browser key store is blocked"));
  });
}
async function saveKey(factory:IDBFactory,key:string,material:StoredPopMaterial):Promise<void> {
  const db=await openDb(factory);
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(DB_STORE,"readwrite");
    transaction.oncomplete=()=>{db.close();resolve();};
    transaction.onerror=()=>{db.close();reject(new Error("Browser key save failed"));};
    transaction.objectStore(DB_STORE).put(material,key);
  });
}
async function loadKey(factory:IDBFactory,key:string):Promise<StoredPopMaterial|undefined> {
  const db=await openDb(factory);
  return new Promise((resolve,reject)=>{
    const transaction=db.transaction(DB_STORE,"readonly");
    const request=transaction.objectStore(DB_STORE).get(key);
    request.onsuccess=()=>resolve(request.result as StoredPopMaterial|undefined);
    request.onerror=()=>reject(new Error("Browser key read failed"));
    transaction.oncomplete=()=>db.close();
    transaction.onerror=()=>{db.close();reject(new Error("Browser key store read failed"));};
  });
}
/** IndexedDB structured clones nonextractable browser CryptoKeys; the same
 * random sessionStorage nonce gates this tab's access after reload. The
 * backend still verifies fresh signatures and grants on every launch. */
export function createBrowserPopKeyPersistence():PopKeyPersistence|undefined {
  try {
    const tab=storage(), db=globalThis.indexedDB;
    if(tab===undefined || db===undefined) return undefined;
    let nonce=tab.getItem(NONCE_SLOT);
    if(nonce===null){
      nonce=globalThis.crypto.randomUUID();
      tab.setItem(NONCE_SLOT,nonce);
    }
    const keyPrefix=nonce+":";
    return {
      save:(intentId,material)=>saveKey(db,keyPrefix+intentId,material),
      load:async intentId=>{
        const material=await loadKey(db,keyPrefix+intentId);
        if(material===undefined || !Number.isFinite(material.expiresAt) ||
          material.expiresAt<Date.now() || material.expiresAt>Date.now()+MAX_AGE+60000)
          return undefined;
        return material;
      }
    };
  }catch{return undefined;}
}
