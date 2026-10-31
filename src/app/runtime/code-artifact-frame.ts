import { sha256CodeBytes, verifyPrototypeCodeArtifact } from "../../platform/blueprint/code-artifact-v2.js";

const CODE_FRAME_CSP=[
  "default-src 'none'",
  // A single verified inline bundle (the precise hash), never unsafe-inline or arbitrary CDN script.
  "script-src '__SCRIPT_HASH__'",
  "script-src-attr 'none'",
  "style-src 'unsafe-inline'",
  "img-src data:",
  "connect-src 'none'",
  "font-src 'none'",
  "media-src 'none'",
  "object-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "form-action 'none'",
  "base-uri 'none'",
  "navigate-to 'none'"
].join("; ");

export interface PrototypeCodeFrame {
  readonly blueprintHash:string;
  readonly iframe:HTMLIFrameElement;
  readonly destroy:()=>void;
}
function htmlEscape(value:string):string{
  return value.replaceAll("&","&amp;").replaceAll("<","&lt;")
    .replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&#39;");
}
function encodeHexBase64(hex:string):string{
  const bytes=hex.match(/.{2}/gu);
  if(bytes===null)throw Error("INVALID_SCRIPT_HASH");
  return btoa(String.fromCharCode(...bytes.map(part=>parseInt(part,16))));
}
/**
 * H3 prototype ONLY. No standalone raw source or client-provided URL may be
 * executed: exact source/manifest/envelope hashes are rechecked on every call.
 * 
 * Frame is opaque-origin, sandbox ONLY allow-scripts (no same-origin, forms,
 * top-navigation, popups). CSP denies all network, worker and form effects.
 * No postMessage bridge, storage, privileges or platform bindings.
 */
export async function createPrototypeCodeFrame(
  input:unknown,doc:Document
):Promise<PrototypeCodeFrame>{
  const checked=await verifyPrototypeCodeArtifact(input);
  if(!checked.ok)throw Error("CODE_ARTIFACT_NOT_ADMITTED:"+checked.reason);
  const {javascript,envelope}=checked.artifact;
  const scriptHash=(await sha256CodeBytes(new TextEncoder().encode(javascript))).slice(7);
  const csp=CODE_FRAME_CSP.replace("__SCRIPT_HASH__",
    "sha256-"+encodeHexBase64(scriptHash));
  const iframe=doc.createElement("iframe");
  iframe.setAttribute("title",envelope.meta.title);
  iframe.setAttribute("sandbox","allow-scripts");
  iframe.setAttribute("referrerpolicy","no-referrer");
  iframe.setAttribute("allow","");
  iframe.style.display="block";
  iframe.style.width="100%";
  iframe.style.height="100%";
  iframe.style.border="0";
  // Strict CSP is the FIRST head content; all generated JS stays inside an
  // opaque-origin document where it cannot access parent cookies/DOM.
  iframe.srcdoc=`<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${htmlEscape(csp)}"><meta name="referrer" content="no-referrer"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${htmlEscape(envelope.meta.title)}</title><style>html,body{margin:0;min-height:100%;}html{overflow-y:auto;}body{box-sizing:border-box;}#app{width:100%;min-height:100vh;box-sizing:border-box;}</style></head><body><main id="app"></main><script>${javascript}</script></body></html>`;
  return {blueprintHash:checked.blueprint_hash,iframe,destroy:()=>iframe.remove()};
}
