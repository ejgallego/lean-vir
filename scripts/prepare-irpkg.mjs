/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url).pathname;
const configPath = process.argv[2];

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
const libResult = spawnSync("bash", ["scripts/build-lean-lib.sh"], {
  cwd: root,
  stdio: "inherit",
});

if ((libResult.status ?? 1) !== 0) {
  console.error("error: Lean.Vir library build failed");
  process.exit(libResult.status ?? 1);
}

const result = spawnSync("lean", ["--run", "tools/GeneratePackage.lean", packagePath, reportPath, ...targetArgs], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    LEAN_PATH: leanPathWithVirLib(process.env.LEAN_PATH),
  },
});

if ((result.status ?? 1) !== 0) {
  console.error(`error: package generation failed for ${source}`);
  console.error(`report: ${reportPath}`);
  process.exit(result.status ?? 1);
}

console.log(`package: ${packagePath}`);
console.log(`report:  ${reportPath}`);
console.log("interface: embedded in package");
if (includeAll) {
  console.log(`mode:    public source definitions from ${source}`);
} else {
  console.log(`roots:   ${roots.join(", ")}`);
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

function leanPathWithVirLib(existing) {
  return existing ? `build/lean-lib:${existing}` : "build/lean-lib";
}
