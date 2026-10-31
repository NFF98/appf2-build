/** Stage a content-verified immutable project for FREE sandbox Docker.
 * The host DOES NOT execute the source or package scripts, and never holds
 * provider secrets. This is only the local runner input adapter, not a
 * callable user-facing GitHub Actions dispatch API.
 */
import fs from "node:fs/promises";
import path from "node:path";
import {verifyProjectSnapshot}
 from "../../dist/src/platform/agent/project-workspace.js";

const DENIED=/(?:^|\/)(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|vite\.config\.[^/]+|rollup\.config\.[^/]+|postcss\.config\.[^/]+|tailwind\.config\.[^/]+|tsconfig(?:\.[^/]*)?\.json)(?:$)/iu;
// The Worker initial Job includes a fixed package metadata file. Verify the
// entire hash first, then omit only this pinned scaffold manifest: user scripts
// are NEVER installed or executed in the free Docker runner.
const FIXED_SCAFFOLD_MANIFEST=JSON.stringify({name:"appf2-candidate",private:true,
 type:"module",scripts:{build:"vite build"},
 devDependencies:{vite:"^6.0.0",typescript:"^5.0.0"}});
const ignoredManifest=item=>item.path==="package.json"&&
 item.content===FIXED_SCAFFOLD_MANIFEST;
const OK=/^(?:index\.html|[A-Za-z0-9_@.-]+(?:\/[A-Za-z0-9_@.-]+)*\.(?:html|js|jsx|ts|tsx|css|json|svg|txt|webp|png))$/iu;
export async function stageVerifiedFreeCiProject(snapshot,destination){
 if(!await verifyProjectSnapshot(snapshot)||
  snapshot.profile!=="VITE_WEB"||snapshot.entrypoint!=="index.html")
  throw Error("FREE_CI_SNAPSHOT_INVALID");
 if(snapshot.files.length>64||snapshot.files.reduce((n,f)=>n+f.bytes,0)>1024*1024)
  throw Error("FREE_CI_RESOURCE_LIMIT");
 for(const item of snapshot.files){
  if(ignoredManifest(item))continue;
  if(DENIED.test(item.path)||!OK.test(item.path)||
     item.path.split("/").some(s=>s.startsWith(".")))
   throw Error("FREE_CI_SOURCE_CONFIG_DENIED");
 }
 // Destination is created by the trusted runner, not read from user input.
 for(const item of snapshot.files){
  if(ignoredManifest(item))continue;
  const target=path.join(destination,item.path);
  await fs.mkdir(path.dirname(target),{recursive:true});
  await fs.writeFile(target,item.content,{flag:"wx",mode:0o600});
 }
 return {project_hash:snapshot.project_hash,profile:snapshot.profile,
  files:snapshot.files.length};
}
