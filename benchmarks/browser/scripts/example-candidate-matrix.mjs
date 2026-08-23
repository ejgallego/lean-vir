import {
  catalogVariantBuilds,
  readBuildDatabase,
} from "./artifact-build-lib.mjs";
import { discoverExampleCatalog } from "./example-catalog-lib.mjs";
import { appRoot } from "./package-root.mjs";

const catalog = await discoverExampleCatalog(appRoot);
const database = await readBuildDatabase(`${appRoot}/artifact-builds.json`);
const include = (await catalogVariantBuilds({ appRoot, catalog, database }))
  .filter(({ build }) => build !== null)
  .map(({ example, variant }) => ({
    example: example.id,
    variant: variant.id,
    build: variant.build,
  }));

process.stdout.write(`${JSON.stringify({ include })}\n`);
