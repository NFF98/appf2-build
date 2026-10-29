/**
 * Fixed argv for a pre-provisioned, egress-disabled Cloudflare Container only.
 * The model never chooses a command, npm script, install target or executable.
 * Vite and React dependencies MUST be pinned in the image at /opt/appf2.
 */
import type {ProjectSnapshot} from "./project-workspace.js";
export const PINNED_VITE_BIN="/opt/appf2/node_modules/vite/bin/vite.js";
export const PINNED_WEB_SMOKE="/opt/appf2/web-smoke.mjs";
export const PINNED_MODULES="/opt/appf2/node_modules";
export function sandboxCommand(project:ProjectSnapshot,
 tool:"run_build"|"run_test"):readonly string[]{
 if(project.profile==="VITE_WEB"){
  return tool==="run_build"?
   ["node",PINNED_VITE_BIN,"build",".","--outDir","dist","--emptyOutDir"]:
   ["node",PINNED_WEB_SMOKE];
 }
 if(project.profile==="NODE"){
  if(!project.entrypoint.endsWith(".mjs"))throw Error("SANDBOX_NODE_ENTRYPOINT_INVALID");
  return tool==="run_build"?["node","--check",project.entrypoint]:
   ["node","--test"];
 }
 throw Error("SANDBOX_PROFILE_NOT_READY");
}
export function sandboxNeedsPinnedDeps(project:ProjectSnapshot):boolean{
 return project.profile==="VITE_WEB";
}
