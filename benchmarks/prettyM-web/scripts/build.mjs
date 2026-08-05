import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const output = join(appRoot, "dist");
const artifacts = join(appRoot, "artifacts");

try {
  if (!(await stat(join(artifacts, "prettyM-vir.irpkg"))).isFile())
    throw new Error();
} catch {
  throw new Error("missing staged artifacts; run npm run stage first");
}

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const path of ["index.html", "LICENSE", "NOTICE", "README.md"]) {
  await cp(join(appRoot, path), join(output, path));
}
for (const path of ["src", "styles", "artifacts"]) {
  await cp(join(appRoot, path), join(output, path), { recursive: true });
}
for (const path of ["_headers", ".htaccess"]) {
  await cp(join(appRoot, "static", path), join(output, path));
}
console.log(`Built standalone prettyM benchmark at ${output}`);
