/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { formatInterfaceEffectSuffix } from "../../web/src/runtime/interface-effects.js";
import {
  formatInterfaceType,
  manifestDiagnostics,
} from "../../web/src/runtime/interface-manifest.js";
import { formatPackageTarget } from "../../web/src/runtime/package-targets.js";
import { readIrPackageFile } from "./irpkg-format.mjs";

function usage() {
  return `usage: npm run inspect:irpkg -- [--json] <package.irpkg>

Inspect one manifest-bearing Lean IR package without loading the browser.`;
}

const args = process.argv.slice(2);
let json = false;
const paths = [];
for (const arg of args) {
  if (arg === "--help" || arg === "-h") {
    console.log(usage());
    process.exit(0);
  } else if (arg === "--json") {
    json = true;
  } else {
    paths.push(arg);
  }
}

if (paths.length !== 1) {
  console.error(usage());
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
  console.error(
    `error: ${error instanceof Error ? error.message : String(error)}`,
  );
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
  console.log(`sections: ${info.package.sections.length}`);
  for (const section of info.package.sections) {
    console.log(
      `  - ${section.name} kind=${section.kind} offset=${section.offset} bytes=${section.byteLength}`,
    );
  }
  console.log(`manifest: ${info.manifest.version}`);
  console.log(`generator: ${metadata.generator ?? "unknown"}`);
  console.log(
    `toolchain: ${metadata.leanToolchain ?? metadata.leanVersion ?? "unknown"}`,
  );
  console.log(`targets: ${targets.length}`);
  for (const target of targets) {
    console.log(`  - ${formatPackageTarget(target)}`);
  }
  console.log(`exports: ${info.manifest.exports.length}`);
  for (const entry of info.manifest.exports) {
    const args = (entry.args ?? [])
      .map((arg) => `${arg.name ?? "arg"}: ${formatInterfaceType(arg.type)}`)
      .join(", ");
    const effect = formatInterfaceEffectSuffix(entry.effect);
    console.log(
      `  - ${entry.entry}(${args}) ->${effect} ${formatInterfaceType(entry.result)} [${entry.entry}]`,
    );
    printDescriptorDetails(entry.args ?? [], entry.result);
  }
  const hostImports = Array.isArray(info.manifest.hostImports)
    ? info.manifest.hostImports
    : [];
  console.log(`host imports: ${hostImports.length}`);
  for (const entry of hostImports) {
    const args = (entry.args ?? [])
      .map((arg) => `${arg.name ?? "arg"}: ${formatInterfaceType(arg.type)}`)
      .join(", ");
    const effect = formatInterfaceEffectSuffix(entry.effect);
    const erased = entry.erasedPrefixArgs
      ? ` erasedPrefixArgs=${entry.erasedPrefixArgs}`
      : "";
    const boundary = entry.boundary;
    console.log(
      `  - #${entry.slot} ${entry.name} boundary=${boundary} arity=${entry.arity ?? "?"}${erased} (${args}) ->${effect} ${formatInterfaceType(entry.result)} [${entry.target}]`,
    );
    printDescriptorDetails(entry.args ?? [], entry.result);
  }
  console.log(`diagnostics: ${diagnostics.length}`);
  for (const diagnostic of diagnostics) {
    console.log(
      `  - ${diagnostic.name ?? "unknown"}: ${diagnostic.reason ?? "unsupported interface"}`,
    );
  }
}

function printDescriptorDetails(args, result) {
  for (const arg of args) {
    const summary = descriptorSummary(arg.type);
    if (summary !== null) {
      console.log(`    arg ${arg.name ?? "arg"} descriptor: ${summary}`);
    }
  }
  const resultSummary = descriptorSummary(result);
  if (resultSummary !== null) {
    console.log(`    result descriptor: ${resultSummary}`);
  }
}

function descriptorSummary(pair) {
  const native = pair?.native;
  const value = pair?.value;
  if (native?.ref !== undefined) return descriptorLabel(native);
  if (native?.metadata?.constructors !== undefined &&
      (value?.tag === "variant" || containsRecursiveReference(native))) {
    const name = native.metadata.declaration ?? "LeanObject";
    return `leanObject ${name} { ${nativeConstructors(native).join(", ")} } / value ${value?.tag ?? "?"}`;
  }
  if (containsRecursiveReference(native)) {
    return `${descriptorLabel(native)} / value ${value?.tag ?? "?"}`;
  }
  return null;
}

function nativeConstructors(native) {
  return (native.metadata?.constructors ?? []).map((ctor) => {
    const fields = ctor.fields ?? [];
    if (fields.length === 0) return `${ctor.name}()`;
    return `${ctor.name}(${fields
      .map((field) => `${field.name}: ${descriptorLabel(field.type)}`)
      .join(", ")})`;
  });
}

function descriptorLabel(descriptor) {
  if (descriptor?.ref !== undefined) return `recursiveRef depth ${descriptor.ref}`;
  const type = descriptor?.type;
  const metadata = descriptor?.metadata;
  switch (type?.tag) {
    case "unsigned": return `unsigned${type.width}`;
    case "float": return `float${type.width}`;
    case "leanObject": return metadata?.declaration ?? "LeanObject";
    case "resource": return `resource ${metadata?.declaration ?? "?"}`;
    default: return type?.tag ?? "?";
  }
}

function containsRecursiveReference(descriptor, seen = new Set()) {
  if (descriptor?.ref !== undefined) return true;
  if (descriptor === null || typeof descriptor !== "object" || seen.has(descriptor)) return false;
  seen.add(descriptor);
  const metadata = descriptor.metadata;
  if (metadata === undefined) return false;
  if ((metadata.constructors ?? []).some((ctor) =>
    (ctor.fields ?? []).some((field) => containsRecursiveReference(field.type, seen)))) return true;
  if (metadata.arrayElement !== undefined && containsRecursiveReference(metadata.arrayElement, seen)) return true;
  const signature = metadata.signature;
  return signature !== undefined &&
    ([...signature.args, signature.result].some((child) => containsRecursiveReference(child, seen)));
}
