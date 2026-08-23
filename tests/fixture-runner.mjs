/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";

import { validateFixtureManifest } from "../fixtures/fixture-manifest.mjs";
import {
  irpkgGeneratorFailureMessage,
  prepareVirIrpkgSync,
} from "../scripts/packages/irpkg-generator.mjs";
import {
  mapWithLimit,
  requireSuccessfulProcess,
  runAsync,
} from "../scripts/process-utils.mjs";
import { elapsedSeconds, formatSeconds, timerStart } from "../scripts/timing-utils.mjs";
import {
  fixtureJobCount,
  fixtureMatchesFilter,
  parseFixtureRunnerConfig,
} from "./support/fixture-runner-config.mjs";
import { createFixtureRunnerContext } from "./support/fixture-runner-context.mjs";
import { fixtureSummary } from "./support/fixture-summary.mjs";

const root = new URL("..", import.meta.url);
const manifestPath = new URL("../fixtures/manifest.json", import.meta.url);
const buildDir = new URL("../build/fixtures/", import.meta.url);
const wasmPath = new URL("../web/public/vir-upstream.wasm", import.meta.url);
const summaryPath = new URL("summary.json", buildDir);
const scriptStart = timerStart();
const config = parseFixtureRunnerConfig({
  argv: process.argv.slice(2),
  env: process.env,
  parallelism: availableParallelism(),
});

function usage() {
  console.log(`Usage: node tests/fixture-runner.mjs [--no-build]

Run Lean fixture host-oracle checks against the WASI upstream interpreter.

Options:
  --no-build       Reuse web/public/vir-upstream.wasm and generated browser packages.
  -h, --help       Show this help.

Environment:
  VIR_FIXTURE_FILTER      Case-insensitive substring matched against fixture id,
                          source path, entry name, and roots.
  VIR_FIXTURE_JOBS        Positive integer worker limit.
  VIR_FIXTURE_SKIP_BUILD  Set to 1 for the same behavior as --no-build.
`);
}

if (config.showHelp) {
  usage();
  process.exit(0);
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const manifestFixtures = validateFixtureManifest(manifest);
const { fixtureFilter, skipBuild } = config;
const fixtures = manifestFixtures.filter((fixture) => fixtureMatchesFilter(fixture, fixtureFilter));
if (fixtures.length === 0) {
  throw new Error(`no fixtures matched VIR_FIXTURE_FILTER=${JSON.stringify(fixtureFilter)}`);
}
await mkdir(buildDir, { recursive: true });
let buildSeconds = 0;
if (skipBuild) {
  try {
    await readFile(wasmPath);
  } catch {
    throw new Error("VIR fixture no-build mode requires web/public/vir-upstream.wasm; run npm run build:demo first");
  }
  console.log("fixture build: skipped (--no-build)");
} else {
  const buildStart = timerStart();
  requireSuccessfulProcess(
    await runAsync("npm", ["run", "--silent", "build:demo"], { cwd: root }),
    "npm run build:demo",
  );
  buildSeconds = elapsedSeconds(buildStart);
}
const generatorStart = timerStart();
const irpkgGenerator = prepareVirIrpkgSync(root);
const generatorSeconds = elapsedSeconds(generatorStart);
if (!irpkgGenerator.ok) {
  console.error(`error: ${irpkgGeneratorFailureMessage(irpkgGenerator)}`);
  process.exit(irpkgGenerator.status);
}
const fixtureRunner = createFixtureRunnerContext({ root, buildDir, wasmPath, irpkgGenerator });

const jobs = fixtureJobCount(fixtures.length, config);
if (fixtureFilter !== "") {
  console.log(`fixture filter: ${fixtureFilter} (${fixtures.length}/${manifestFixtures.length})`);
}
console.log(`fixture jobs: ${jobs}`);
const fixtureRunStart = timerStart();
const results = await mapWithLimit(fixtures, jobs, fixtureRunner.run);
const fixtureRunSeconds = elapsedSeconds(fixtureRunStart);

for (const result of results) {
  if (result.status === "passed") {
    const value = result.expectation.wasm === null
      ? result.wasm
      : `host=${result.host} wasm=${result.wasm}`;
    console.log(`PASS ${result.fixture.id}: ${value}`);
  } else {
    console.log(`FAIL ${result.fixture.id}: ${result.detail}`);
  }
}

const summary = fixtureSummary(results);
const { passed, failed } = summary.totals;
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log();
console.log(`fixture summary: ${passed} passed, ${failed} failed`);
const buildTiming = skipBuild ? "skipped" : `${formatSeconds(buildSeconds)}s`;
const slowestFixtures = [...results]
  .sort((left, right) => (right.timing?.total ?? 0) - (left.timing?.total ?? 0))
  .slice(0, 5)
  .map((result) => {
    const timing = result.timing;
    return `${result.fixture.id}=${formatSeconds(timing.total)}s`
      + `(host=${formatSeconds(timing.host)}s,pkg=${formatSeconds(timing.package)}s,wasm=${formatSeconds(timing.wasm)}s)`;
  });
console.log(
  `fixture timing: build=${buildTiming} generator=${formatSeconds(generatorSeconds)}s `
  + `run=${formatSeconds(fixtureRunSeconds)}s total=${formatSeconds(elapsedSeconds(scriptStart))}s`,
);
console.log(`fixture slowest: ${slowestFixtures.join(", ")}`);
const importedSummaries = results
  .filter((result) => result.diagnostics?.importedDecls?.length)
  .map((result) => `${result.fixture.id}:${result.diagnostics.importedDecls.length}`);
if (importedSummaries.length !== 0) {
  console.log(`imported IR deps: ${importedSummaries.join(", ")}`);
}
console.log(`wrote ${summaryPath.pathname}`);

if (failed !== 0) {
  process.exit(1);
}
