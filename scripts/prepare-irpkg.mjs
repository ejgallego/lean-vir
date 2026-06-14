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
const configPath = process.argv[2];
const scriptStart = timerStart();

if (!configPath) {
  console.error("usage: npm run prepare:irpkg -- <config.json>");
  process.exit(2);
}

const config = JSON.parse(await readFile(configPath, "utf8"));
const source = requiredString(config.source, "source");
const packagePath = config.package ?? defaultPackagePath(source);
const reportPath = config.report ?? reportPathFor(packagePath);
const roots = Array.isArray(config.roots) ? config.roots : [];
const includeAll = config.includeAll === true || roots.length === 0;

const targetArgs = includeAll ? ["--target-all", source] : ["--target", source, ...roots];
const generator = prepareVirIrpkgSync(root);
if (!generator.ok) {
  console.error(`error: ${irpkgGeneratorFailureMessage(generator)}`);
  process.exit(generator.status);
}

const packageStart = timerStart();
try {
  runSync(generator.path, [packagePath, reportPath, ...targetArgs], {
    cwd: root,
    env: generator.env,
  });
} catch (error) {
  console.error(`error: package generation failed for ${source}`);
  console.error(`report: ${reportPath}`);
  process.exit(error.status ?? 1);
}
const packageSeconds = elapsedSeconds(packageStart);

console.log(`package: ${packagePath}`);
console.log(`report:  ${reportPath}`);
console.log("interface: embedded in package");
if (includeAll) {
  console.log(`mode:    public source definitions from ${source}`);
} else {
  console.log(`roots:   ${roots.join(", ")}`);
}
console.log(
  `irpkg timing: lean-lib=${formatSeconds(generator.libSeconds)}s `
  + `generator=${formatSeconds(generator.generatorSeconds)}s package=${formatSeconds(packageSeconds)}s `
  + `total=${formatSeconds(elapsedSeconds(scriptStart))}s`,
);

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
