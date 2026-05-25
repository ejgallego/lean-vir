/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { formatInterfaceType, manifestDiagnostics } from "../web/src/interface-manifest.js";
import { readIrPackageFile } from "./irpkg-format.mjs";

function usage() {
  console.error(`usage: npm run inspect:irpkg -- [--json] <package.irpkg>

Inspect one manifest-bearing Lean IR package without loading the browser.`);
}

const args = process.argv.slice(2);
let json = false;
const paths = [];
for (const arg of args) {
  if (arg === "--help" || arg === "-h") {
    usage();
    process.exit(0);
  } else if (arg === "--json") {
    json = true;
  } else {
    paths.push(arg);
  }
}

if (paths.length !== 1) {
  usage();
  process.exit(2);
}

try {
  const info = await readIrPackageFile(paths[0]);
  if (json) {
    console.log(JSON.stringify(info, null, 2));
  } else {
    printText(info);
  }
} catch (error) {
  console.error(`error: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
}

function printText(info) {
  const metadata = info.manifest.metadata;
  const diagnostics = manifestDiagnostics(info.manifest);
  const targets = Array.isArray(metadata.targets) ? metadata.targets : [];

  console.log(`package: ${info.path}`);
  console.log(`bytes: ${info.byteLength}`);
  console.log(`format: ${info.package.version}`);
  console.log(`declarations: ${info.package.declarationCount}`);
  console.log(`manifest: ${info.manifest.version}`);
  console.log(`generator: ${metadata.generator ?? "unknown"}`);
  console.log(`toolchain: ${metadata.leanToolchain ?? metadata.leanVersion ?? "unknown"}`);
  console.log(`generated: ${metadata.generatedAt ?? "unknown"}`);
  console.log(`targets: ${targets.length}`);
  for (const target of targets) {
    const roots = Array.isArray(target.resolvedRoots) && target.resolvedRoots.length > 0
      ? target.resolvedRoots.join(", ")
      : "(none)";
    console.log(`  - ${target.source ?? "unknown"} [${target.mode ?? "?"}] roots: ${roots}`);
  }
  console.log(`exports: ${info.manifest.exports.length}`);
  for (const entry of info.manifest.exports) {
    const args = (entry.args ?? [])
      .map((arg) => `${arg.name ?? "arg"}: ${formatInterfaceType(arg.type)}`)
      .join(", ");
    const effect = entry.effect === "io" ? " IO" : "";
    console.log(`  - ${entry.jsName ?? entry.entry}(${args}) ->${effect} ${formatInterfaceType(entry.result)} [${entry.entry}]`);
  }
  const hostImports = Array.isArray(info.manifest.hostImports) ? info.manifest.hostImports : [];
  console.log(`host imports: ${hostImports.length}`);
  for (const entry of hostImports) {
    const args = (entry.args ?? [])
      .map((arg) => `${arg.name ?? "arg"}: ${formatInterfaceType(arg.type)}`)
      .join(", ");
    const effect = entry.effect === "io" ? " IO" : "";
    console.log(`  - #${entry.slot} ${entry.name}(${args}) ->${effect} ${formatInterfaceType(entry.result)} [${entry.target}]`);
  }
  console.log(`diagnostics: ${diagnostics.length}`);
  for (const diagnostic of diagnostics) {
    console.log(`  - ${diagnostic.name ?? "unknown"}: ${diagnostic.reason ?? "unsupported interface"}`);
  }
}
