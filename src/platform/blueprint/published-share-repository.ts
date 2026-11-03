import { canonicalBlueprintBytes } from "./canonical-json.js";
import { hashCanonicalBlueprintBytes } from "./content-identity.js";
import type { ExecutionContentSource, StoredBlueprintContent } from "./execution-admission.js";
import type { PostgresExecutor } from "./postgres-blueprint-repository.js";
import type { CanonicalBlueprintBodyRead } from "./original-intent-lineage.js";

export const READ_PUBLIC_SHARE_SQL=`SELECT content_hash,canonical_blueprint,schema_version,registry_version,
  trust_status,admitted_registry_digest
  FROM appf2_internal.share_content($1::uuid,$2::text)`;
type ShareRecord=StoredBlueprintContent;
/** The SQL function rechecks ACTIVE status, exact share/hash, original admitted run on EACH read.
 * This repository never runs with the creator's private cookie/PoP; a foreign or revoked
 * share has no row. F03 must still verify independent F02 fresh ExecutionAdmission. */
export class PostgresPublishedShareRepository implements ExecutionContentSource {
  public constructor(private readonly db:PostgresExecutor, private readonly shareId:string){}
  public async readContent(hash:string):Promise<StoredBlueprintContent|undefined>{
    return (await this.db.query<ShareRecord>(READ_PUBLIC_SHARE_SQL,[this.shareId,hash])).rows[0];
  }
  public async readCanonicalBody(hash:string):Promise<CanonicalBlueprintBodyRead>{
    const row=await this.readContent(hash);
    if(row===undefined||row.content_hash!==hash||row.trust_status!=="VALIDATED")
      return {kind:"NOT_ADMITTED"};
    const data=canonicalBlueprintBytes(typeof row.canonical_blueprint==="string"
      ?JSON.parse(row.canonical_blueprint):row.canonical_blueprint);
    if(hashCanonicalBlueprintBytes(data)!==hash)return {kind:"NOT_ADMITTED"};
    return {kind:"FOUND",bytes:data};
  }
}
