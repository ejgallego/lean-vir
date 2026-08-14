#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { spawnSync } from "node:child_process";
import { statSync } from "node:fs";
import { basename } from "node:path";

import {
  irpkgGeneratorFailureMessage,
  prepareVirIrpkgSync,
} from "./irpkg-generator.mjs";

const root = new URL("..", import.meta.url);
const argv = process.argv.slice(2);

function usage() {
  return [
    "usage: scripts/lean-to-irpkg.sh <source.lean> [package.irpkg] [root ...]",
    "",
    "Generate one manifest-bearing .irpkg from one Lean source file.",
    "When roots are omitted, public source definitions are auto-discovered and",
    "become JavaScript-callable exports if their types are supported.",
    "",
    "examples:",
    "  npm run generate:irpkg -- examples/Fib.lean build/generated/fib.irpkg",
    "  npm run generate:irpkg -- examples/MergeSort.lean build/generated/sort.irpkg SortDemo.demo",
  ].join("\n");
}

if (argv[0] === "--help" || argv[0] === "-h") {
  console.error(usage());
  process.exit(0);
}
if (argv.length === 0) {
  console.error(usage());
  process.exit(2);
}

const [source, packageArg, ...roots] = argv;
if (!isFile(source)) {
  console.error(`error: source file not found: ${source}`);
  process.exit(2);
}

const stem = basename(source).replace(/\.lean$/, "");
const packagePath = packageArg ?? `build/generated/${stem}.irpkg`;
const reportPath = packagePath.endsWith(".irpkg")
  ? `${packagePath.slice(0, -".irpkg".length)}.report.md`
  : `${packagePath}.report.md`;
const targetArgs = roots.length === 0
  ? ["--target-all", source]
  : ["--target", source, ...roots];
const mode = roots.length === 0
  ? "auto-discover public definitions"
  : `explicit roots: ${roots.join(" ")}`;

console.log("generating Lean IR package");
console.log(`source:  ${source}`);
console.log(`package: ${packagePath}`);
console.log(`report:  ${reportPath}`);
console.log(`mode:    ${mode}`);

const generator = prepareVirIrpkgSync(root, {
  skipBuild: process.env.VIR_SKIP_IRPKG_BUILD === "1",
});
if (!generator.ok) {
  console.error(`error: ${irpkgGeneratorFailureMessage(generator)}`);
  process.exit(generator.status);
}

const generated = spawnSync(
  generator.path,
  [packagePath, reportPath, ...targetArgs],
  { cwd: root, env: generator.env, stdio: "inherit" },
);
const status = generated.status ?? 1;
if (status !== 0) {
  console.error("error: package generation failed");
  console.error(`source:  ${source}`);
  console.error(`package: ${packagePath}`);
  console.error(`report:  ${reportPath}`);
  console.error("the report contains the exact missing declarations or package diagnostics");
  process.exit(status);
}

console.log("local package ready");
console.log(`package:   ${packagePath}`);
console.log(`report:    ${reportPath}`);
console.log("interface: embedded in package");
if (packagePath.startsWith("web/public/")) {
  console.log("runner:    npm run dev -- --port 5173");
  console.log(`url:       /dev.html?package=${packagePath.slice("web/public/".length)}`);
} else {
  console.log("runner:    npm run dev -- --port 5173, then upload this .irpkg in /dev.html");
}

function isFile(path) {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}
