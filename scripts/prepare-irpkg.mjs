/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { delimiter } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const irpkgGenerator = ".lake/build/bin/vir_irpkg";
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

const generatorResult = spawnSync("lake", ["build", "vir_irpkg"], {
  cwd: root,
  stdio: "inherit",
});

if ((generatorResult.status ?? 1) !== 0) {
  console.error("error: vir_irpkg generator build failed");
  process.exit(generatorResult.status ?? 1);
}

const leanPrefix = spawnSync("lean", ["--print-prefix"], {
  cwd: root,
  encoding: "utf8",
  stdio: ["ignore", "pipe", "inherit"],
});

if ((leanPrefix.status ?? 1) !== 0) {
  console.error("error: could not find Lean prefix");
  process.exit(leanPrefix.status ?? 1);
}

const result = spawnSync(irpkgGenerator, [packagePath, reportPath, ...targetArgs], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    LEAN_PATH: leanPathWithGenerator(leanPrefix.stdout.trim(), process.env.LEAN_PATH),
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

function leanPathWithGenerator(leanPrefix, existing) {
  return [
    "build/lean-lib",
    ".lake/build/lib/lean",
    `${leanPrefix}/lib/lean`,
    existing,
  ].filter(Boolean).join(delimiter);
}
