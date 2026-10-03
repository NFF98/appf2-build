import { resolve } from "node:path";

import { writeRegistryArtifacts } from "./generate-registry.js";

const release = await writeRegistryArtifacts(resolve(process.cwd(), "generated/capabilities"));
process.stdout.write(
  `${release.registry_version} ${release.registry_digest} ${release.validator_registry_digest} ${release.runtime_registry_digest}\n`
);
