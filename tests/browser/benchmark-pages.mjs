/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  readBuildDatabase,
} from "../../benchmarks/browser/scripts/artifact-build-lib.mjs";
import {
  discoverExampleCatalog,
} from "../../benchmarks/browser/scripts/example-catalog-lib.mjs";
import {
  activePagesDeployments,
  parsePagesDeployment,
} from "../../benchmarks/browser/scripts/pages-deployment-lib.mjs";

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const benchmarkRoot = join(root, "benchmarks/browser");
const requested = process.argv.slice(2);
if (requested.some((argument) => ["--help", "-h"].includes(argument))) {
  console.log(`Usage: node tests/browser/benchmark-pages.mjs [EXAMPLE=VARIANT ...]

Test the benchmark subtree installed below web/dist. With no selections, test
every active canonical Pages deployment from the source catalog.`);
  process.exit(requested.length === 1 ? 0 : 1);
}

const deployments = requested.length
  ? requested.map(parsePagesDeployment)
  : await activePagesDeployments({
      appRoot: benchmarkRoot,
      catalog: await discoverExampleCatalog(benchmarkRoot),
      database: await readBuildDatabase(
        join(benchmarkRoot, "artifact-builds.json"),
      ),
    });

function run(script, args) {
  const result = spawnSync(
    "npm",
    ["--prefix", "benchmarks/browser", "run", script, "--", ...args],
    { stdio: "inherit" },
  );
  if ((result.status ?? 1) !== 0) {
    throw new Error(
      `benchmark Pages ${script} failed with status ${result.status ?? 1}`,
    );
  }
}

run("test:pages", [
  "--directory",
  "../../web/dist/benchmarks",
  ...deployments.flatMap(({ example, variant }) => [
    "--deploy",
    `${example}=${variant}`,
  ]),
]);
for (const { example, variant } of deployments) {
  run("test:pages:browser", [
    "--directory",
    "../../web/dist",
    "--base-path",
    "/benchmarks/",
    "--example",
    example,
    "--variant",
    variant,
  ]);
}
