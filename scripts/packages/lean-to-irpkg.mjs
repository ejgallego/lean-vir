#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { spawnSync } from "node:child_process";

import {
  irpkgGeneratorFailureMessage,
  prepareVirIrpkgSync,
} from "./irpkg-generator.mjs";
import { repositoryRoot } from "../repository-paths.mjs";
import {
  assertDistinctModulePackageOutputs,
  normalizeModulePackageConfig,
} from "./module-package-config.mjs";

const root = repositoryRoot;
const argv = process.argv.slice(2);

function usage() {
  return [
    "usage: npm run generate:irpkg -- <Module.Name> [package.irpkg] [root ...]",
    "",
    "Generate one manifest-bearing .irpkg from one Lake-built Lean module.",
    "When roots are omitted, public module definitions are auto-discovered and",
    "become JavaScript-callable exports if their types are supported.",
    "",
    "examples:",
    "  npm run generate:irpkg -- Fib build/generated/fib.irpkg",
    "  npm run generate:irpkg -- MergeSort build/generated/sort.irpkg SortDemo.demo",
  ].join("\n");
}

if (argv[0] === "--help" || argv[0] === "-h") {
  console.log(usage());
  process.exit(0);
}
if (argv.length === 0) {
  console.error(usage());
  process.exit(2);
}

const [module, packageArg, ...roots] = argv;
let config;
try {
  config = normalizeModulePackageConfig({
    version: 2,
    module,
    ...(packageArg === undefined ? {} : { package: packageArg }),
    roots,
  });
  assertDistinctModulePackageOutputs([config], root);
} catch (error) {
  console.error(`error: ${error.message}`);
  process.exit(2);
}
const { packagePath, reportPath, targetArgs } = config;
const mode =
  roots.length === 0
    ? "auto-discover public definitions"
    : `explicit roots: ${roots.join(" ")}`;

console.log("generating Lean IR package");
console.log(`module:  ${module}`);
console.log(`package: ${packagePath}`);
console.log(`report:  ${reportPath}`);
console.log(`mode:    ${mode}`);

const generator = prepareVirIrpkgSync({
  modules: [module],
});
if (!generator.ok) {
  console.error(`error: ${irpkgGeneratorFailureMessage(generator)}`);
  process.exit(generator.status);
}

const generated = spawnSync(
  generator.path,
  [packagePath, reportPath, ...generator.inputArgs, ...targetArgs],
  { cwd: root, env: generator.env, stdio: "inherit" },
);
const status = generated.status ?? 1;
if (status !== 0) {
  console.error("error: package generation failed");
  console.error(`module:  ${module}`);
  console.error(`package: ${packagePath}`);
  console.error(`report:  ${reportPath}`);
  console.error(
    "the report contains the exact missing declarations or package diagnostics",
  );
  process.exit(status);
}

console.log("local package ready");
console.log(`package:   ${packagePath}`);
console.log(`report:    ${reportPath}`);
console.log("interface: embedded in package");
if (packagePath.startsWith("web/public/")) {
  console.log("runner:    npm run dev -- --port 5173");
  console.log(
    `url:       /dev.html?package=${packagePath.slice("web/public/".length)}`,
  );
} else {
  console.log(
    "runner:    npm run dev -- --port 5173, then upload this .irpkg in /dev.html",
  );
}
