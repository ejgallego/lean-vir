/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { spawnSync } from "node:child_process";

const [requestedExample, requestedVariant, extra] = process.argv.slice(2);
if (extra || requestedExample === "--help" || requestedExample === "-h") {
  console.log(`Usage: node tests/browser/benchmark-pages.mjs EXAMPLE VARIANT

Test the benchmark subtree installed below web/dist. EXAMPLE and VARIANT may
instead be set with PAGES_BENCHMARK_EXAMPLE and PAGES_BENCHMARK_VARIANT.`);
  process.exit(extra ? 1 : 0);
}

const example = requestedExample ?? process.env.PAGES_BENCHMARK_EXAMPLE;
const variant = requestedVariant ?? process.env.PAGES_BENCHMARK_VARIANT;
if (!example || !variant) {
  throw new Error(
    "benchmark Pages test requires an explicit example and variant",
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
  "--deploy",
  `${example}=${variant}`,
]);
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
