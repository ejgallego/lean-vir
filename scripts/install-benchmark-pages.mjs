import { cp, mkdir, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const source = resolve(root, "benchmarks/browser/dist");
const destination = resolve(root, "web/dist/benchmarks");
if (!(await stat(source).catch(() => null))?.isDirectory()) {
  throw new Error("benchmark Pages build is missing; run its build first");
}
await mkdir(resolve(root, "web/dist"), { recursive: true });
await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
console.log(`Installed benchmark Pages subtree at ${destination}`);
