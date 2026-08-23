import { join } from "node:path";

import { readBuildDatabase } from "./artifact-build-lib.mjs";
import { discoverExampleCatalog } from "./example-catalog-lib.mjs";
import { appRoot } from "./package-root.mjs";
import { activePagesDeployments } from "./pages-deployment-lib.mjs";

if (process.argv.length > 2) {
  console.log(`Usage: node scripts/pages-deployment-plan.mjs

List active canonical Pages deployments as tab-separated example, variant,
and build records.`);
  process.exit(
    process.argv.length === 3 && ["--help", "-h"].includes(process.argv[2])
      ? 0
      : 1,
  );
}

const catalog = await discoverExampleCatalog(appRoot);
const database = await readBuildDatabase(join(appRoot, "artifact-builds.json"));
const deployments = await activePagesDeployments({
  appRoot,
  catalog,
  database,
});
for (const deployment of deployments) {
  console.log(
    `${deployment.example}\t${deployment.variant}\t${deployment.build}`,
  );
}
