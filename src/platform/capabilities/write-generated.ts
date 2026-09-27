import { resolve } from "node:path";

import { writeRegistryArtifacts } from "./generate-registry.js";

const identity = await writeRegistryArtifacts(resolve(process.cwd(), "generated/capabilities"));
process.stdout.write(`${identity.registryVersion} ${identity.registryDigest}\n`);
