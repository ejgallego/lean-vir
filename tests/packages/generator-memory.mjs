/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, openSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { validateFixtureManifest } from "../../fixtures/fixture-manifest.mjs";
import {
  packageSpecs,
  validateFixturePackageCoverage,
} from "../../scripts/packages/browser-package-config.mjs";
import { planBrowserPackage } from "../../scripts/packages/browser-package-plan.mjs";
import {
  irpkgGeneratorFailureMessage,
  prepareVirIrpkgSync,
  virIrpkgPath,
} from "../../scripts/packages/irpkg-generator.mjs";
import { readIrPackageInfo } from "../../scripts/packages/irpkg-format.mjs";
import { repositoryRoot } from "../../scripts/repository-paths.mjs";
import { validateInterfaceManifest } from "../../web/src/runtime/interface-manifest.js";

const usage =
  "usage: node tests/packages/generator-memory.mjs [--no-build]\n" +
  "Requires Linux and GNU /usr/bin/time. Retains outputs under build/generator-memory-* .";
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(usage);
  process.exit(0);
}
assert.ok(
  args.length === 0 || (args.length === 1 && args[0] === "--no-build"),
  usage,
);
assert.equal(process.platform, "linux", usage);
const timeVersion = spawnSync("/usr/bin/time", ["--version"], {
  encoding: "utf8",
});
assert.ifError(timeVersion.error);
assert.equal(timeVersion.status, 0, usage);
assert.match(timeVersion.stdout + timeVersion.stderr, /GNU [Tt]ime/, usage);

const fixtures = validateFixturePackageCoverage(
  validateFixtureManifest(
    JSON.parse(await readFile(join(repositoryRoot, "fixtures/manifest.json"))),
  ),
);
const spec = packageSpecs.find(({ id }) => id === "demo-host");
assert.ok(spec, "the full demo-host workload must remain in the catalog");
const plan = planBrowserPackage(spec, fixtures);
assert.ok(plan.modules.length > 1, "memory regression needs multiple modules");
const lakeTargets = [
  ...new Set([
    ...(spec.lakeTargets ?? []),
    ...plan.modules.map((module) => `+${module}`),
  ]),
];

let generator;
if (args.includes("--no-build")) {
  // Resolve the same Lake search path without rebuilding prepared artifacts.
  const leanPath = spawnSync(
    "lake",
    [
      "env",
      process.execPath,
      "-e",
      "process.stdout.write(process.env.LEAN_PATH ?? '')",
    ],
    { cwd: repositoryRoot, encoding: "utf8" },
  );
  assert.ifError(leanPath.error);
  assert.equal(leanPath.status, 0, leanPath.stderr);
  generator = {
    path: virIrpkgPath,
    env: { ...process.env, LEAN_PATH: leanPath.stdout },
  };
} else {
  generator = prepareVirIrpkgSync({ lakeTargets });
  assert.ok(generator.ok, irpkgGeneratorFailureMessage(generator));
}

await mkdir(join(repositoryRoot, "build"), { recursive: true });
const output = await mkdtemp(join(repositoryRoot, "build/generator-memory-"));
console.log(`generator memory evidence: ${output}`);
const packagePath = join(output, spec.file);
const reportPath = join(output, "demo-host.report.md");
const rssPath = join(output, "peak-rss-kib.txt");
const log = openSync(join(output, "generator.log"), "w");
let result;
try {
  // Time only the compiled generator, not Lake/build processes. GNU time's
  // Linux %M is peak resident memory in KiB, not virtual memory or PSS.
  result = spawnSync(
    "/usr/bin/time",
    [
      "--format=%M",
      "--output",
      rssPath,
      "--",
      generator.path,
      packagePath,
      reportPath,
      ...plan.targetArgs,
    ],
    {
      cwd: repositoryRoot,
      env: generator.env,
      stdio: ["ignore", log, log],
    },
  );
} finally {
  closeSync(log);
}
assert.ifError(result.error);
assert.equal(result.status, 0, `generator failed; see ${output}/generator.log`);
const peakRssText = (await readFile(rssPath, "utf8")).trim();
assert.match(peakRssText, /^\d+$/, "GNU time must report peak RSS in KiB");
const peakRssKiB = Number(peakRssText);
assert.ok(peakRssKiB > 0, "peak RSS measurement must be nonzero");

const bytes = await readFile(packagePath);
const info = readIrPackageInfo(bytes);
const manifest = validateInterfaceManifest(info.manifest);
const expectedExports = new Set();
let exported = false;
for (let index = 0; index < plan.targetArgs.length; index += 1) {
  const arg = plan.targetArgs[index];
  if (arg === "--target-module" || arg === "--package-module") {
    exported = arg === "--target-module";
    index += 1; // The next argument is the owning module, not a root.
  } else if (exported) {
    expectedExports.add(arg);
  }
}
assert.deepEqual(
  manifest.exports.map(({ entry }) => entry).sort(),
  [...expectedExports].sort(),
  "the resource workload must retain every catalog export",
);
assert.deepEqual(
  [...new Set(manifest.metadata.targets.map(({ module }) => module))].sort(),
  [...plan.modules].sort(),
  "all planned module inputs must retain their provenance",
);
assert.ok(info.package.declarationCount > manifest.exports.length);
assert.ok(manifest.hostImports.length > 0);

// Keep ample headroom below the 16 GiB CI runner budget. The original
// nine-module workload peaked around 18.7 GiB; do not merely move that cliff.
const maxRssKiB = 8 * 1024 * 1024;
const summary = {
  packageSha256: createHash("sha256").update(bytes).digest("hex"),
  byteLength: bytes.byteLength,
  modules: plan.modules,
  lakeTargets,
  targetArgs: plan.targetArgs,
  declarationCount: info.package.declarationCount,
  exports: manifest.exports,
  hostImports: manifest.hostImports,
  peakRssKiB,
  maxRssKiB,
};
await writeFile(
  join(output, "result.json"),
  JSON.stringify(summary, null, 2) + "\n",
);
assert.ok(
  peakRssKiB <= maxRssKiB,
  `generator peak RSS ${peakRssKiB} KiB exceeds ${maxRssKiB} KiB; see ${output}`,
);
console.log(
  `generator memory PASS: ${peakRssKiB} KiB RSS, ` +
    `${info.package.declarationCount} declarations, ` +
    `${manifest.exports.length} exports, ${manifest.hostImports.length} host imports`,
);
