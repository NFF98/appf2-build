/**
 * Sprint 3.5 shared AI source contract. The model may produce MULTIPLE
 * internal Vite modules. The Worker never executes these bytes. Independent
 * isolated Docker/Chromium must prove the frozen original acceptance.
 *
 * Legacy two-field paid answers remain valid for at-most-once response replay.
 * This is deliberately NOT arbitrary server/npm execution: generated backend
 * persistence uses only the already owner/viewer-scoped appf2Records bridge.
 */
export const aiProjectSchema={
 type:"object",additionalProperties:false,required:["files"],
 properties:{files:{type:"array",items:{type:"object",
  additionalProperties:false,required:["path","content"],
  properties:{path:{type:"string"},content:{type:"string"}}}}}
} as const;
export type AiSourceFile={readonly path:string;readonly content:string};
const MAIN="src/main.ts",STYLE="src/style.css";
const FILE=/^src\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:ts|css|json)$/u;
const FORBIDDEN=/https?:\/\/|import\s*\(['"]https?:|<\/script|\u0000/u;
function validOne(value:unknown):value is AiSourceFile{
 if(typeof value!=="object"||value===null||Array.isArray(value))return false;
 const file=value as Record<string,unknown>;
 return Object.keys(file).sort().join(",")==="content,path"&&
  typeof file.path==="string"&&FILE.test(file.path)&&
  typeof file.content==="string"&&file.content.length>0&&
  file.content.length<=65000&&!FORBIDDEN.test(file.content);
}
/** A full source snapshot (2..12 files), no arbitrary package/HTTP/SQL files.
 * Return null before any source CAS if a model response is unsafe/incomplete.
 * Do not auto-fill missing entrypoints or fake an App out of partial output.
 */
export function parseAiProjectFiles(raw:unknown):readonly AiSourceFile[]|null{
 if(typeof raw!=="object"||raw===null||Array.isArray(raw))return null;
 const value=raw as Record<string,unknown>,keys=Object.keys(value).sort().join(",");
 const legacy=keys==="main_ts,style_css";
 if(!legacy&&keys!=="files")return null;
 const files:unknown=legacy?[
  {path:MAIN,content:value.main_ts},
  {path:STYLE,content:value.style_css}
 ]:value.files;
 if(!Array.isArray(files)||files.length<2||files.length>12)return null;
 const seen=new Set<string>();
 let size=0,main=false,style=false;
 const validated:AiSourceFile[]=[];
 for(const file of files){
  if(!validOne(file))return null;
  const normalized=file.path.toLowerCase();
  if(seen.has(normalized))return null;
  seen.add(normalized);
  size+=file.content.length;
  if(size>85000)return null;
  if(file.path===MAIN){main=file.content.length>=20;}
  if(file.path===STYLE){style=file.content.length>=20;}
  validated.push({path:file.path,content:file.content});
 }
 if(!main||!style)return null;
 return validated;
}
