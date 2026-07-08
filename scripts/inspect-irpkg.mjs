/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { formatInterfaceEffectSuffix } from "../web/src/runtime/interface-effects.js";
import { formatInterfaceType, manifestDiagnostics } from "../web/src/runtime/interface-manifest.js";
import { INTERFACE_TAG } from "../web/src/runtime/interface-tags.js";
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
  console.log(`sections: ${info.package.sections.length}`);
  for (const section of info.package.sections) {
    console.log(`  - ${section.name} kind=${section.kind} offset=${section.offset} bytes=${section.byteLength}`);
  }
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
    const effect = formatInterfaceEffectSuffix(entry.effect);
    console.log(`  - ${entry.jsName ?? entry.entry}(${args}) ->${effect} ${formatInterfaceType(entry.result)} [${entry.entry}]`);
    printDescriptorDetails(entry.args ?? [], entry.result);
  }
  const hostImports = Array.isArray(info.manifest.hostImports) ? info.manifest.hostImports : [];
  console.log(`host imports: ${hostImports.length}`);
  for (const entry of hostImports) {
    const args = (entry.args ?? [])
      .map((arg) => `${arg.name ?? "arg"}: ${formatInterfaceType(arg.type)}`)
      .join(", ");
    const effect = formatInterfaceEffectSuffix(entry.effect);
    const erased = entry.erasedPrefixArgs ? ` erasedPrefixArgs=${entry.erasedPrefixArgs}` : "";
    const boundary = entry.boundary;
    console.log(`  - #${entry.slot} ${entry.name} boundary=${boundary} arity=${entry.arity ?? "?"}${erased} (${args}) ->${effect} ${formatInterfaceType(entry.result)} [${entry.target}]`);
    printDescriptorDetails(entry.args ?? [], entry.result);
  }
  console.log(`diagnostics: ${diagnostics.length}`);
  for (const diagnostic of diagnostics) {
    console.log(`  - ${diagnostic.name ?? "unknown"}: ${diagnostic.reason ?? "unsupported interface"}`);
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

function descriptorSummary(type) {
  switch (type?.interfaceTag) {
    case INTERFACE_TAG.CUSTOM_INDUCTIVE:
      return `customInductive ${type.name ?? type.type ?? "?"} { ${customInductiveConstructors(type).join(", ")} }`;
    case INTERFACE_TAG.STRUCTURE:
      if (!containsRecursiveSelf(type)) return null;
      return `structure ${type.name ?? type.type ?? "?"} { ${(type.fields ?? []).map((field) =>
        `${field.name}: ${descriptorLabel(field.type)}`).join(", ")} }`;
    default:
      return containsRecursiveSelf(type) ? descriptorLabel(type) : null;
  }
}

function customInductiveConstructors(type) {
  return (type.constructors ?? []).map((ctor) => {
    const fields = ctor.fields ?? [];
    if (fields.length === 0) return `${ctor.jsName ?? ctor.name}()`;
    return `${ctor.jsName ?? ctor.name}(${fields.map((field) =>
      `${field.name}: ${descriptorLabel(field.type)}`).join(", ")})`;
  });
}

function descriptorLabel(type) {
  switch (type?.interfaceTag) {
    case INTERFACE_TAG.RECURSIVE_SELF:
      return `recursiveSelf ${type.name ?? type.type ?? "?"}`;
    case INTERFACE_TAG.ARRAY:
      return `Array<${descriptorLabel(type.element)}>`;
    case INTERFACE_TAG.LIST:
      return `List<${descriptorLabel(type.element)}>`;
    case INTERFACE_TAG.OPTION:
      return `Option<${descriptorLabel(type.element)}>`;
    case INTERFACE_TAG.PROD:
      return `Prod<${descriptorLabel(type.fst)}, ${descriptorLabel(type.snd)}>`;
    case INTERFACE_TAG.CUSTOM_INDUCTIVE:
      return `customInductive ${type.name ?? type.type ?? "?"}`;
    case INTERFACE_TAG.STRUCTURE:
      return `structure ${type.name ?? type.type ?? "?"}`;
    case INTERFACE_TAG.LEAN_OBJECT:
      return type.type ?? "LeanObject";
    default:
      return formatInterfaceType(type);
  }
}

function containsRecursiveSelf(type) {
  switch (type?.interfaceTag) {
    case INTERFACE_TAG.RECURSIVE_SELF:
      return true;
    case INTERFACE_TAG.ARRAY:
    case INTERFACE_TAG.LIST:
    case INTERFACE_TAG.OPTION:
      return containsRecursiveSelf(type.element);
    case INTERFACE_TAG.PROD:
      return containsRecursiveSelf(type.fst) || containsRecursiveSelf(type.snd);
    case INTERFACE_TAG.STRUCTURE:
      return (type.fields ?? []).some((field) => containsRecursiveSelf(field.type));
    case INTERFACE_TAG.TAGGED_UNION:
      return (type.constructors ?? []).some((ctor) => containsRecursiveSelf(ctor.type));
    case INTERFACE_TAG.CUSTOM_INDUCTIVE:
      return (type.constructors ?? []).some((ctor) =>
        (ctor.fields ?? []).some((field) => containsRecursiveSelf(field.type)));
    case INTERFACE_TAG.FUNCTION:
      return (type.args ?? []).some((arg) => containsRecursiveSelf(arg.type)) ||
        containsRecursiveSelf(type.result);
    default:
      return false;
  }
}
