import type { PopKeyPersistence, StoredPopMaterial } from "../create/pop-keyring.js";

/** Same-tab only: just a content-addressed target, never prompts, auth headers,
 * PoP signatures, credentials, model responses or raw Blueprint bodies. */
const TARGET_SLOT="appf2.tab.app.v1";
const NONCE_SLOT="appf2.tab.pop.nonce.v1";
const BROWSER_NONCE_SLOT="appf2.browser.pop.nonce.v1";
const DB_NAME="appf2.tab.pop.v1";
const DB_STORE="keys";
const MAX_AGE=24*60*60*1000;
export interface TabAppTarget { readonly intentId:string; readonly contentHash:string }

function storage():Storage|undefined {
  try {return globalThis.sessionStorage;} catch {return undefined;}
}
/** Origin-scoped user-profile storage for My Apps, never a substitute for PoP or server authorization. */
function browserStorage():Storage|undefined {
  try {return globalThis.localStorage;} catch {return undefined;}
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

/** Reusable Apps stay in this browser tab; never persist a prompt, Blueprint, token or key. 
 * A card is not an access grant: every open must still pass fresh PoP + admission + F03. */
const LIBRARY_SLOT="appf2.tab.saved-apps.v1";
const MAX_SAVED_APPS=8;
export interface SavedTabApp extends TabAppTarget { readonly title:string; readonly savedAt:number }

function validSavedApp(value:unknown, now:number):value is SavedTabApp {
  if(typeof value!=="object" || value===null || Array.isArray(value))return false;
  const item=value as Record<string,unknown>;
  return typeof item.intentId==="string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.intentId) &&
    typeof item.contentHash==="string" && /^sha256:[0-9a-f]{64}$/.test(item.contentHash) &&
    typeof item.title==="string" && item.title.length>0 && item.title.length<=80 &&
    typeof item.savedAt==="number" && Number.isFinite(item.savedAt) &&
    item.savedAt<=now+60000 && now-item.savedAt>=0 && now-item.savedAt<=MAX_AGE;
}

// eslint-disable-next-line complexity -- Storage migration, corrupt data and authorization boundaries fail closed independently.
export function readSavedTabApps():readonly SavedTabApp[] {
  try {
    const persistent=browserStorage();
    // Migrate previous same-tab catalog once, without losing old already-open apps.
    const legacy=storage()?.getItem(LIBRARY_SLOT);
    let raw=persistent?.getItem(LIBRARY_SLOT)??legacy;
    if(persistent!==undefined && persistent.getItem(LIBRARY_SLOT)===null && legacy!==null && legacy!==undefined){
      persistent.setItem(LIBRARY_SLOT,legacy);
      storage()?.removeItem(LIBRARY_SLOT);
      raw=legacy;
    }
    if(raw===null || raw===undefined || raw.length>12000)return [];
    const parsed:unknown=JSON.parse(raw);
    if(!Array.isArray(parsed))return [];
    const now=Date.now(), seen=new Set<string>(), result:SavedTabApp[]=[];
    for(const item of parsed) {
      if(!validSavedApp(item,now))continue;
      const id=item.intentId+":"+item.contentHash;
      if(seen.has(id))continue;
      seen.add(id);
      result.push({intentId:item.intentId,contentHash:item.contentHash,title:item.title,savedAt:item.savedAt});
      if(result.length===MAX_SAVED_APPS)break;
    }
    return result;
  }catch{return [];}
}

/** Register only after actual authenticated F03 READY; no model calls on saved-App open. */
export function rememberSavedTabApp(target:TabAppTarget,title:string):readonly SavedTabApp[] {
  const cleanTitle=title.trim().slice(0,80) || "已建立的 App";
  const existing=readSavedTabApps();
  const previouslySaved=existing.find(saved=>saved.intentId===target.intentId && saved.contentHash===target.contentHash);
  const item={...target,title:cleanTitle,savedAt:previouslySaved?.savedAt??Date.now()};
  if(!validSavedApp(item,Date.now()))return existing;
  const next=[item,...existing.filter(saved=>
    saved.intentId!==item.intentId || saved.contentHash!==item.contentHash)].slice(0,MAX_SAVED_APPS);
  try {(browserStorage()??storage())?.setItem(LIBRARY_SLOT,JSON.stringify(next));}catch{/* Unavailable storage does not block running Apps. */}
  return next;
}

export function forgetSavedTabApp(target:TabAppTarget):readonly SavedTabApp[] {
  const next=readSavedTabApps().filter(saved=>
    saved.intentId!==target.intentId || saved.contentHash!==target.contentHash);
  try {(browserStorage()??storage())?.setItem(LIBRARY_SLOT,JSON.stringify(next)); storage()?.removeItem(LIBRARY_SLOT);}catch{/* Safe memory-only fallback. */}
  return next;
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
/** IndexedDB retains the original nonextractable CryptoKey in this browser profile.
 * No public key/hash/nonce is ever authorization; server PoP, scoped cookie and fresh
 * F02 execution admission still verify each open. Old tab keys remain readable. */
// eslint-disable-next-line complexity -- Nonextractable key migration and browser storage fallbacks cannot share unsafe paths.
export function createBrowserPopKeyPersistence():PopKeyPersistence|undefined {
  try {
    const tab=storage(), persistent=browserStorage(), db=globalThis.indexedDB;
    if(db===undefined || (tab===undefined && persistent===undefined)) return undefined;
    let nonce=persistent?.getItem(BROWSER_NONCE_SLOT)??null;
    if(persistent!==undefined && nonce===null){
      nonce=globalThis.crypto.randomUUID();
      persistent.setItem(BROWSER_NONCE_SLOT,nonce);
    }
    // No localStorage: retain safe legacy same-tab behavior only.
    if(nonce===null){
      nonce=tab?.getItem(NONCE_SLOT)??null;
      if(nonce===null){ nonce=globalThis.crypto.randomUUID(); tab?.setItem(NONCE_SLOT,nonce); }
    }
    const keyPrefix=nonce+":";
    const previousNonce=tab?.getItem(NONCE_SLOT);
    const previousPrefix=previousNonce===null || previousNonce===undefined ? null : previousNonce+":";
    return {
      save:(intentId,material)=>saveKey(db,keyPrefix+intentId,material),
      load:async intentId=>{
        let material=await loadKey(db,keyPrefix+intentId);
        if(material===undefined && previousPrefix!==null){
          material=await loadKey(db,previousPrefix+intentId);
          if(material!==undefined) await saveKey(db,keyPrefix+intentId,material);
        }
        if(material===undefined || !Number.isFinite(material.expiresAt) ||
          material.expiresAt<Date.now() || material.expiresAt>Date.now()+MAX_AGE+60000)
          return undefined;
        return material;
      }
    };
  }catch{return undefined;}
}
