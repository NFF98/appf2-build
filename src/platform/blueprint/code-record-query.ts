/** A bounded exact-match index over a viewer's own JSONB records.
 * No model-authored SQL or backend script may use this protocol.
 */
export type CodeRecordFilters=Readonly<Record<string,string|number|boolean>>;
const KEY=/^[A-Za-z][A-Za-z0-9_]{0,31}$/u;
export function validRecordQueryFilters(input:unknown):input is CodeRecordFilters{
 if(typeof input!=="object"||input===null||Array.isArray(input))return false;
 const entries=Object.entries(input);
 if(entries.length<1||entries.length>4)return false;
 return entries.every(([key,value])=>KEY.test(key)&&(
  typeof value==="string"&&value.length<=128&&!/[\u0000-\u001f]/u.test(value)||
  typeof value==="boolean"||
  typeof value==="number"&&Number.isSafeInteger(value)&&Math.abs(value)<=1000000000
 ));
}
export function validRecordQueryLimit(limit:unknown):limit is number{
 return typeof limit==="number"&&Number.isInteger(limit)&&limit>=1&&limit<=100;
}
