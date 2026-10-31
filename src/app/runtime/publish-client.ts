import { readProofTranscript } from "../../edge/create-proof.js";
import type { FetchLike } from "../create/f01-client.js";
import type { PopKeyring } from "../create/pop-keyring.js";

export interface PublishedAppPublisher {
  publish(intentId:string,contentHash:string,title:string):Promise<string|null>;
}
/** Explicit creator confirmation is owned by the S03 overlay; this method
 * makes ONLY an authenticated original-holder GET grant and F05 POST.
 * Neither request can enter the F01 create/analyze/compile/model route. */
export function createPublishedAppPublisher(fetchImpl:FetchLike,keyring:PopKeyring):PublishedAppPublisher{
  return {
    // eslint-disable-next-line complexity -- All parsing / origin / original-holder conditions must fail closed.
    publish:async(intentId,contentHash,title)=>{
    try{
      const key=keyring.keyForIntent(intentId)??await keyring.recoverForIntent(intentId);
      if(key===undefined)return null;
      const path=`/api/v1/intents/${encodeURIComponent(intentId)}/blueprint-access-grant`;
      const proof=await key.proofHeaders(ts=>readProofTranscript(path,contentHash,ts));
      const grantResponse=await fetchImpl(`${path}?content_hash=${encodeURIComponent(contentHash)}`,{
        method:"GET",headers:proof,credentials:"same-origin",cache:"no-store"
      });
      if(!grantResponse.ok)return null;
      const envelope:unknown=await grantResponse.json();
      const data=typeof envelope==="object"&&envelope!==null&&"data" in envelope
        ?(envelope as {data:unknown}).data:null;
      const token=typeof data==="object"&&data!==null&&"intent_blueprint_access_grant" in data
        ?(data as {intent_blueprint_access_grant:unknown}).intent_blueprint_access_grant:null;
      if(typeof token!=="string"||token.length>1024)return null;
      const response=await fetchImpl("/api/v1/shares",{
        method:"POST",headers:{"Content-Type":"application/json","Authorization":`Bearer ${token}`,
          "Idempotency-Key":crypto.randomUUID()},
        credentials:"same-origin",body:JSON.stringify({source_intent_id:intentId,blueprint_hash:contentHash,title})
      });
      if(!response.ok)return null;
      const body:unknown=await response.json();
      const share=typeof body==="object"&&body!==null&&"data" in body?(body as {data:unknown}).data:null;
      const url=typeof share==="object"&&share!==null&&"share_url" in share?(share as {share_url:unknown}).share_url:null;
      if(typeof url!=="string"||!/^\/share\/[0-9a-f-]{36}$/iu.test(url))return null;
      return new URL(url,globalThis.location.origin).toString();
    }catch{return null;}
  }};
}
