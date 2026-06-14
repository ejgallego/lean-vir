/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";

import { irpkgGeneratorFailureMessage, prepareVirIrpkgSync } from "./irpkg-generator.mjs";
import { runSync } from "./process-utils.mjs";
import { elapsedSeconds, formatSeconds, timerStart } from "./timing-utils.mjs";

const root = new URL("..", import.meta.url).pathname;
const configPaths = process.argv.slice(2);
const scriptStart = timerStart();

if (configPaths.length === 0) {
  console.error("usage: npm run prepare:irpkg -- <config.json> [config.json ...]");
  process.exit(2);
}

const packages = [];
for (const configPath of configPaths) {
  packages.push(await readPackageConfig(configPath));
}

const generator = prepareVirIrpkgSync(root);
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
      [packageConfig.packagePath, packageConfig.reportPath, ...packageConfig.targetArgs],
      { cwd: root, env: generator.env },
    );
  } catch (error) {
    console.error(`error: package generation failed for ${packageConfig.source}`);
    console.error(`report: ${packageConfig.reportPath}`);
    process.exit(error.status ?? 1);
  }
  const packageSeconds = elapsedSeconds(packageStart);
  packageTimings.push({ path: packageConfig.packagePath, seconds: packageSeconds });
  printPackage(packageConfig);
}

const packagesSeconds = packageTimings.reduce((sum, timing) => sum + timing.seconds, 0);
console.log(
  `irpkg timing: lean-lib=${formatSeconds(generator.libSeconds)}s `
  + `generator=${formatSeconds(generator.generatorSeconds)}s `
  + `${packages.length === 1 ? "package" : "packages"}=${formatSeconds(packagesSeconds)}s `
  + `total=${formatSeconds(elapsedSeconds(scriptStart))}s`,
);
if (packages.length > 1) {
  const packageSummary = packageTimings
    .map((timing) => `${timing.path}=${formatSeconds(timing.seconds)}s`)
    .join(", ");
  console.log(`irpkg package files: ${packageSummary}`);
}

async function readPackageConfig(configPath) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const source = requiredString(config.source, "source");
  const packagePath = config.package ?? defaultPackagePath(source);
  const reportPath = config.report ?? reportPathFor(packagePath);
  const roots = Array.isArray(config.roots) ? config.roots : [];
  const includeAll = config.includeAll === true || roots.length === 0;
  const targetArgs = includeAll ? ["--target-all", source] : ["--target", source, ...roots];
  return { source, packagePath, reportPath, roots, includeAll, targetArgs };
}

function printPackage(packageConfig) {
  console.log(`package: ${packageConfig.packagePath}`);
  console.log(`report:  ${packageConfig.reportPath}`);
  console.log("interface: embedded in package");
  if (packageConfig.includeAll) {
    console.log(`mode:    public source definitions from ${packageConfig.source}`);
  } else {
    console.log(`roots:   ${packageConfig.roots.join(", ")}`);
  }
}

function requiredString(value, field) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`config field \`${field}\` must be a non-empty string`);
  }
  return value;
}

function defaultPackagePath(sourcePath) {
  const stem = sourcePath.split("/").at(-1)?.replace(/\.lean$/, "") ?? "local";
  return `build/generated/${stem}.irpkg`;
}

function reportPathFor(packagePath) {
  return packagePath.endsWith(".irpkg")
    ? `${packagePath.slice(0, -".irpkg".length)}.report.md`
    : `${packagePath}.report.md`;
}
