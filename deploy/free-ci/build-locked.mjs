/** Trusted build entry, never loads any vite.config or user-supplied plugin.
 * Executes inside an already restricted Docker container (--network none).
 * Keep this outside the mounted untrusted source project.
 */
import {build} from "vite";
await build({root:process.cwd(),configFile:false,logLevel:"error",
 build:{outDir:"dist",emptyOutDir:true}});
