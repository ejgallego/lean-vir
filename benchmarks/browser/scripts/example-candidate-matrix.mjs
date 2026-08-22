import { readBuildDatabase } from "./artifact-build-lib.mjs";
import {
  discoverExampleCatalog,
  readExampleTestPackage,
} from "./example-catalog-lib.mjs";
import { appRoot } from "./package-root.mjs";

const catalog = await discoverExampleCatalog(appRoot);
const database = await readBuildDatabase(`${appRoot}/artifact-builds.json`);
const include = [];

for (const example of catalog.examples) {
  const testPackage = await readExampleTestPackage(appRoot, example);
  for (const variant of testPackage.variants) {
    if (variant.build === null) continue;
    const build = database.builds[variant.build];
    if (
      !build ||
      build.example.id !== example.id ||
      build.example.variant !== variant.id
    ) {
      throw new Error(
        `${example.id}/${variant.id} references invalid build ${variant.build}`,
      );
    }
    include.push({
      example: example.id,
      variant: variant.id,
      build: variant.build,
    });
  }
}

process.stdout.write(`${JSON.stringify({ include })}\n`);
