import { cp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalJson } from "./artifact-set-lib.mjs";
import { discoverExampleCatalog } from "./example-catalog-lib.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(appRoot, "dist");
const artifacts = join(appRoot, "artifacts");

try {
  if (!(await stat(artifacts)).isDirectory()) throw new Error();
} catch {
  throw new Error("missing staged artifacts; run npm run stage first");
}

const catalog = await discoverExampleCatalog(appRoot);

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const path of ["index.html", "LICENSE", "NOTICE", "README.md"]) {
  await cp(join(appRoot, path), join(output, path));
}
for (const path of ["src", "styles", "artifacts", "examples"]) {
  await cp(join(appRoot, path), join(output, path), { recursive: true });
}
await writeFile(
  join(output, "examples/catalog.json"),
  canonicalJson(catalog),
);
for (const path of ["_headers", ".htaccess"]) {
  await cp(join(appRoot, "static", path), join(output, path));
}
console.log(`Built standalone Lean benchmark app at ${output}`);
