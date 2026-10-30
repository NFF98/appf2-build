/** Opaque-origin view of actual prebuilt Vite output, not public release.
 * Zero code runs in the parent document. No imports, packages or services
 * are fetched by generated code: CSP plus iframe sandbox deny all network.
 */
export type PrivatePreviewAsset={readonly path:string;readonly text:string;
 readonly project_hash:string;readonly content_type:string};
export type PreviewSource={readonly project_hash:string;
 readonly index_html:string;readonly javascript:string;readonly css:string};
const SCRIPT=/^assets\/[A-Za-z0-9_-]{1,96}\.js$/u;
const CSS=/^assets\/[A-Za-z0-9_-]{1,96}\.css$/u;
function escaped(value:string):string{
 return value.replaceAll("&","&amp;").replaceAll("<","&lt;")
  .replaceAll(">","&gt;").replaceAll('"',"&quot;");
}
export function previewAssetPaths(html:string):{script:string;styles:readonly string[]}{
 if(typeof html!=="string"||html.length>300000)
  throw Error("AGENT_PREVIEW_INDEX_INVALID");
 const parsed=new DOMParser().parseFromString(html,"text/html");
 const scripts=Array.from(parsed.querySelectorAll("script[src][type=module]"));
 const styles=Array.from(parsed.querySelectorAll("link[href][rel=stylesheet]"));
 if(scripts.length!==1||styles.length>3||
  parsed.querySelectorAll("script:not([src]),script:not([type=module])").length>0)
  throw Error("AGENT_PREVIEW_SCRIPT_LAYOUT_UNSUPPORTED");
 const src=scripts[0]?.getAttribute("src")?.replace(/^\//u,"")??"";
 if(!SCRIPT.test(src))throw Error("AGENT_PREVIEW_JS_NOT_ISOLATED");
 const css=styles.map(x=>(x.getAttribute("href")??"").replace(/^\//u,""));
 if(css.some(x=>!CSS.test(x))||new Set(css).size!==css.length)
  throw Error("AGENT_PREVIEW_CSS_NOT_ISOLATED");
 return {script:src,styles:css};
}
function base64Sha256(hex:string):string{
 const pieces=hex.match(/.{2}/gu);
 if(!pieces||pieces.length!==32)throw Error("AGENT_PREVIEW_SCRIPT_HASH_INVALID");
 return btoa(String.fromCharCode(...pieces.map(x=>parseInt(x,16))));
}
export async function createPrivatePreviewFrame(source:PreviewSource,
 doc:Document):Promise<HTMLIFrameElement>{
 const paths=previewAssetPaths(source.index_html);
 if(!/^sha256:[0-9a-f]{64}$/u.test(source.project_hash)||
  source.javascript.length<1||source.javascript.length>2*1024*1024||
  source.css.length>6*1024*1024||paths.styles.length>3)
  throw Error("AGENT_PREVIEW_BUNDLE_INVALID");
 const parsed=new DOMParser().parseFromString(source.index_html,"text/html");
 // Never execute unknown index scripts, inline handlers, frames, URLs or
 // redirects. A Vite script is inserted separately from verified broker bytes.
 parsed.querySelectorAll("script,link,base,meta[http-equiv],iframe,object,embed,form")
  .forEach(x=>x.remove());
 const body=parsed.body.innerHTML;
 const safeJs=source.javascript.replace(/<\/script/giu,"<\\/script");
 const safeCss=source.css.replace(/<\/style/giu,"<\\/style");
 const bytes=new TextEncoder().encode(safeJs);
 const hex=new Uint8Array(await crypto.subtle.digest("SHA-256",bytes));
 const hash=base64Sha256(Array.from(hex,x=>x.toString(16).padStart(2,"0")).join(""));
 const csp=[
  "default-src 'none'",
  "script-src 'sha256-"+hash+"'",
  "script-src-attr 'none'",
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "connect-src 'none'","font-src 'none'","media-src 'none'",
  "frame-src 'none'","worker-src 'none'","form-action 'none'",
  "navigate-to 'none'","base-uri 'none'","object-src 'none'"
 ].join("; ");
 const frame=doc.createElement("iframe");
 frame.title="私人候選 App 互動預覽（尚未通過發布驗收）";
 frame.setAttribute("sandbox","allow-scripts");
 frame.setAttribute("referrerpolicy","no-referrer");
 frame.setAttribute("allow","");
 frame.style.width="100%";frame.style.height="560px";frame.style.border="0";
 frame.srcdoc='<!doctype html><html><head><meta charset="utf-8">'+
  '<meta http-equiv="Content-Security-Policy" content="'+escaped(csp)+'">'+
  '<meta name="viewport" content="width=device-width, initial-scale=1">'+
  '<style>'+safeCss+'</style></head><body>'+body+
  '<script type="module">'+safeJs+'</script></body></html>';
 return frame;
}
