import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { readBuildDatabase } from "./artifact-build-lib.mjs";
import { canonicalJson } from "./artifact-set-lib.mjs";
import { discoverExampleCatalog } from "./example-catalog-lib.mjs";
import {
  parsePagesDeployment,
  selectPagesCatalog,
} from "./pages-deployment-lib.mjs";
import { appRoot } from "./package-root.mjs";

const output = join(appRoot, "dist");
const artifacts = join(appRoot, "artifacts");
const deployments = [];
for (let index = 2; index < process.argv.length; index += 1) {
  const argument = process.argv[index];
  if (argument === "--deploy") {
    const value = process.argv[++index];
    if (!value) throw new Error("--deploy requires EXAMPLE=VARIANT");
    deployments.push(parsePagesDeployment(value));
  } else if (argument === "--help" || argument === "-h") {
    console.log(`Usage: node scripts/build.mjs [--deploy EXAMPLE=VARIANT]...

Build the standalone application. Pages deployments admit only explicitly
selected canonical variants whose staged artifacts match the catalog.`);
    process.exit(0);
  } else throw new Error(`unknown argument: ${argument}`);
}

try {
  if (!(await stat(artifacts)).isDirectory()) throw new Error();
} catch {
  throw new Error(
    "missing staged artifacts; run npm run artifacts:fetch or npm run stage -- SET first",
  );
}

const sourceCatalog = await discoverExampleCatalog(appRoot);
const catalog = deployments.length
  ? await selectPagesCatalog({
      appRoot,
      artifactsRoot: artifacts,
      catalog: sourceCatalog,
      database: await readBuildDatabase(join(appRoot, "artifact-builds.json")),
      deployments,
    })
  : sourceCatalog;

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const rootFiles = ["index.html", "LICENSE", "NOTICE"];
if (deployments.length === 0) rootFiles.push("README.md");
for (const path of rootFiles) {
  await cp(join(appRoot, path), join(output, path));
}
for (const path of ["src", "styles"]) {
  await cp(join(appRoot, path), join(output, path), { recursive: true });
}
if (deployments.length === 0) {
  for (const path of ["artifacts", "examples"]) {
    await cp(join(appRoot, path), join(output, path), { recursive: true });
  }
} else {
  await mkdir(join(output, "artifacts"));
  await mkdir(join(output, "examples"));
  await cp(
    join(appRoot, "examples/controller-contract.mjs"),
    join(output, "examples/controller-contract.mjs"),
  );
  for (const example of catalog.examples) {
    await cp(
      resolve(appRoot, "examples", example.id),
      resolve(output, "examples", example.id),
      { recursive: true },
    );
    await cp(
      resolve(artifacts, example.id),
      resolve(output, "artifacts", example.id),
      { recursive: true },
    );
  }
}
await writeFile(join(output, "examples/catalog.json"), canonicalJson(catalog));
for (const path of ["_headers", ".htaccess", "coi-serviceworker.js"]) {
  await cp(join(appRoot, "static", path), join(output, path));
}
console.log(
  `Built standalone Lean benchmark app at ${output}: ${catalog.examples
    .map(({ id }) => id)
    .join(", ")}`,
);
