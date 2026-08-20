import { cp, mkdir, rm, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const benchmarkRoot = fileURLToPath(new URL("..", import.meta.url));
const repositoryRoot = fileURLToPath(new URL("../../..", import.meta.url));
const source = resolve(benchmarkRoot, "dist");
const destination = resolve(repositoryRoot, "web/dist/benchmarks");
if (!(await stat(source).catch(() => null))?.isDirectory()) {
  throw new Error("benchmark Pages build is missing; run its build first");
}
await mkdir(resolve(repositoryRoot, "web/dist"), { recursive: true });
await rm(destination, { recursive: true, force: true });
await cp(source, destination, { recursive: true });
console.log(`Installed benchmark Pages subtree at ${destination}`);
