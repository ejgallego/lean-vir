/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";

import {
  irpkgGeneratorFailureMessage,
  prepareVirIrpkgSync,
} from "./irpkg-generator.mjs";
import { repositoryRoot } from "../repository-paths.mjs";
import { runSync } from "../process-utils.mjs";
import { elapsedSeconds, formatSeconds, timerStart } from "../timing-utils.mjs";
import {
  assertDistinctModulePackageOutputs,
  normalizeModulePackageConfig,
} from "./module-package-config.mjs";

const configPaths = process.argv.slice(2);
const scriptStart = timerStart();

function usage() {
  return `usage: npm run prepare:irpkg -- <config.json> [config.json ...]

Generate browser-ready .irpkg files from one or more package configurations.`;
}

if (configPaths.some((arg) => arg === "--help" || arg === "-h")) {
  console.log(usage());
  process.exit(0);
}

if (configPaths.length === 0) {
  console.error(usage());
  process.exit(2);
}

const packages = [];
for (const configPath of configPaths) {
  try {
    packages.push(
      normalizeModulePackageConfig(
        JSON.parse(await readFile(configPath, "utf8")),
      ),
    );
  } catch (error) {
    console.error(`error: ${configPath}: ${error.message}`);
    process.exit(2);
  }
}

try {
  assertDistinctModulePackageOutputs(packages, repositoryRoot);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(2);
}

const generator = prepareVirIrpkgSync(repositoryRoot, {
  lakeTargets: [...new Set(packages.map((config) => `+${config.module}`))],
});
if (!generator.ok) {
  console.error(`error: ${irpkgGeneratorFailureMessage(generator)}`);
  process.exit(generator.status);
}

const packageTimings = [];
for (const packageConfig of packages) {
  const packageStart = timerStart();
  try {
    runSync(
      generator.path,
      [
        packageConfig.packagePath,
        packageConfig.reportPath,
        ...packageConfig.targetArgs,
      ],
      { cwd: repositoryRoot, env: generator.env },
    );
  } catch (error) {
    console.error(
      `error: package generation failed for ${packageConfig.module}`,
    );
    console.error(`report: ${packageConfig.reportPath}`);
    process.exit(error.status ?? 1);
  }
  const packageSeconds = elapsedSeconds(packageStart);
  packageTimings.push({
    path: packageConfig.packagePath,
    seconds: packageSeconds,
  });
  printPackage(packageConfig);
}

const packagesSeconds = packageTimings.reduce(
  (sum, timing) => sum + timing.seconds,
  0,
);
console.log(
  `irpkg timing: lean-lib=${formatSeconds(generator.libSeconds)}s ` +
    `generator=${formatSeconds(generator.generatorSeconds)}s ` +
    `${packages.length === 1 ? "package" : "packages"}=${formatSeconds(packagesSeconds)}s ` +
    `total=${formatSeconds(elapsedSeconds(scriptStart))}s`,
);
if (packages.length > 1) {
  const packageSummary = packageTimings
    .map((timing) => `${timing.path}=${formatSeconds(timing.seconds)}s`)
    .join(", ");
  console.log(`irpkg package files: ${packageSummary}`);
}

function printPackage(packageConfig) {
  console.log(`package: ${packageConfig.packagePath}`);
  console.log(`report:  ${packageConfig.reportPath}`);
  console.log("interface: embedded in package");
  if (packageConfig.includeAll) {
    console.log(
      `mode:    public module definitions from ${packageConfig.module}`,
    );
  } else {
    console.log(`roots:   ${packageConfig.roots.join(", ")}`);
  }
}
