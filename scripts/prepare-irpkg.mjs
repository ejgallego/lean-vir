/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
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
const result = spawnSync("lean", ["--run", "tools/GeneratePackage.lean", packagePath, reportPath, ...targetArgs], {
  cwd: root,
  stdio: "inherit",
});

if ((result.status ?? 1) !== 0) {
  process.exit(result.status ?? 1);
}

if (config.inputSpec) {
  const inputSpec = normalizeInputSpec(config.inputSpec);
  const inputSpecPath = config.inputSpec.path ?? inputSpecPathFor(packagePath);
  await writeJson(inputSpecPath, inputSpec);
  console.log(`wrote ${inputSpecPath}`);
}

console.log(`package: ${packagePath}`);
console.log(`report:  ${reportPath}`);
if (includeAll) {
  console.log(`mode:    all declarations from ${source}`);
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

function inputSpecPathFor(packagePath) {
  return packagePath.endsWith(".irpkg")
    ? `${packagePath.slice(0, -".irpkg".length)}.input.json`
    : `${packagePath}.input.json`;
}

function normalizeInputSpec(spec) {
  const entries = spec.entries;
  if (!Array.isArray(entries)) {
    throw new Error("inputSpec.entries must be an array");
  }
  return {
    version: 1,
    entries: entries.map((entry, index) => {
      const id = entry.id ?? entry.entry;
      const name = requiredString(entry.entry, `inputSpec.entries[${index}].entry`);
      return {
        id,
        entry: name,
        result: entry.result ?? { type: "Nat" },
        inputs: entry.inputs ?? [],
      };
    }),
  };
}

async function writeJson(path, value) {
  await mkdir(dirname(join(root, path)), { recursive: true });
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(join(root, path), content);
}
