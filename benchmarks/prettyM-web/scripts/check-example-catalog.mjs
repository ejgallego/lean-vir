import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { discoverExampleCatalog } from "./example-catalog-lib.mjs";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: node scripts/check-example-catalog.mjs [--json]

Validate and list the repository's browser benchmark example manifests.`);
  process.exit(0);
}
const unknown = process.argv.slice(2).filter((argument) => argument !== "--json");
if (unknown.length > 0) throw new Error(`unknown argument: ${unknown[0]}`);

const catalog = await discoverExampleCatalog(appRoot);
if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(catalog, null, 2)}\n`);
} else {
  for (const example of catalog.examples) {
    console.log(`${example.id}\t${example.lifecycle}\t${example.title}`);
  }
}
