/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { spawnSync } from "node:child_process";

const requested = process.argv.slice(2);
if (requested[0] === "--help" || requested[0] === "-h") {
  console.log(`Usage: node scripts/test-benchmark-pages.mjs EXAMPLE VARIANT [EXAMPLE VARIANT ...]

Test every selected benchmark variant in the subtree installed below web/dist.
One EXAMPLE and VARIANT may instead be set with PAGES_BENCHMARK_EXAMPLE and
PAGES_BENCHMARK_VARIANT.`);
  process.exit(0);
}

if (requested.length % 2 !== 0) {
  throw new Error("benchmark Pages test requires EXAMPLE VARIANT pairs");
}
const selections = [];
for (let index = 0; index < requested.length; index += 2) {
  selections.push({ example: requested[index], variant: requested[index + 1] });
}
if (selections.length === 0) {
  const example = process.env.PAGES_BENCHMARK_EXAMPLE;
  const variant = process.env.PAGES_BENCHMARK_VARIANT;
  if (example && variant) selections.push({ example, variant });
}
if (selections.length === 0) {
  throw new Error(
    "benchmark Pages test requires at least one explicit example and variant",
  );
}

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
  ...selections.flatMap(({ example, variant }) => [
    "--deploy",
    `${example}=${variant}`,
  ]),
]);
for (const { example, variant } of selections) {
  run("test:pages:browser", [
    "--directory",
    "../../web/dist",
    "--base-path",
    "/benchmarks/",
    example,
    variant,
  ]);
}
