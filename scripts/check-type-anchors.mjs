#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { readIrPackageFile } from "./irpkg-format.mjs";
import { validateInterfaceManifest } from "../web/src/runtime/interface-manifest.js";
import { INTERFACE_TAG as WIRE } from "../web/src/runtime/interface-tags.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const statusRank = {
  exact: 0,
  compatible: 1,
  weak: 2,
  missing: 3,
};

function usage() {
  console.error(`usage: node scripts/check-type-anchors.mjs --descriptors FILE (--irpkg FILE | --manifest FILE) [options]

Compare TypeScript descriptor JSON with Lean VIR interface descriptors.

Options:
  --descriptors FILE  TypeScript descriptor JSON from generate-ts-descriptors.
  --irpkg FILE        Read Lean descriptors from a manifest-bearing .irpkg.
  --manifest FILE     Read Lean descriptors from a manifest JSON fixture.
  --out FILE          Write machine-readable comparison report JSON.
  --check             Compare generated report with --out instead of writing it.
  --json              Print report JSON to stdout when --out is not used.
  --strict            Exit nonzero on weak or missing anchors.
  --fail-on-errors    Exit nonzero on error-severity review diagnostics.
  -h, --help          Show this help.
`);
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  let descriptors = null;
  let irpkg = null;
  let manifest = null;
  let out = null;
  let check = false;
  let json = false;
  let strict = false;
  let failOnErrors = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "-h":
      case "--help":
        usage();
        process.exit(0);
      case "--descriptors":
        descriptors = requiredValue(argv, ++index, "--descriptors");
        break;
      case "--irpkg":
        irpkg = requiredValue(argv, ++index, "--irpkg");
        break;
      case "--manifest":
        manifest = requiredValue(argv, ++index, "--manifest");
        break;
      case "--out":
        out = requiredValue(argv, ++index, "--out");
        break;
      case "--check":
        check = true;
        break;
      case "--json":
        json = true;
        break;
      case "--strict":
        strict = true;
        break;
      case "--fail-on-errors":
        failOnErrors = true;
        break;
      default:
        fail(`unknown option ${arg}`);
    }
  }
  if (descriptors === null) fail("--descriptors is required");
  if ((irpkg === null) === (manifest === null)) fail("pass exactly one of --irpkg or --manifest");
  if (check && out === null) fail("--check requires --out");
  return {
    descriptors: resolve(root, descriptors),
    irpkg: irpkg === null ? null : resolve(root, irpkg),
    manifest: manifest === null ? null : resolve(root, manifest),
    out: out === null ? null : resolve(root, out),
    check,
    json,
    strict,
    failOnErrors,
  };
}

function requiredValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) fail(`${option} requires a value`);
  return value;
}

const cli = parseArgs(process.argv.slice(2));
const report = await buildReport(cli);
const text = `${JSON.stringify(report, null, 2)}\n`;

if (cli.out !== null) {
  if (cli.check) {
    const existing = await readFile(cli.out, "utf8");
    if (existing.replace(/\r\n/g, "\n") !== text) {
      fail(`${relative(root, cli.out)} is stale; run npm run compare:type-anchors`);
    }
    console.log(`validated ${relative(root, cli.out)}`);
  } else {
    await writeFile(cli.out, text);
    console.log(`wrote ${relative(root, cli.out)} (${report.results.length} anchors)`);
  }
} else if (cli.json) {
  process.stdout.write(text);
} else {
  printSummary(report);
}

if (cli.strict && (report.summary.weak !== 0 || report.summary.missing !== 0)) {
  process.exit(1);
}
if (cli.failOnErrors && report.diagnosticSummary.error !== 0) {
  process.exit(1);
}

async function buildReport({ descriptors, irpkg, manifest }) {
  const tsDescriptors = validateTsDescriptors(JSON.parse(await readFile(descriptors, "utf8")));
  const leanManifest = irpkg !== null
    ? (await readIrPackageFile(irpkg)).manifest
    : validateInterfaceManifest(JSON.parse(await readFile(manifest, "utf8")));
  const lean = collectLeanDescriptors(leanManifest);
  const tsSymbols = new Map(tsDescriptors.symbols.map((symbol) => [symbol.id, symbol]));
  const results = tsDescriptors.anchors.map((anchor) => compareAnchor(anchor, lean, tsSymbols));
  const summary = { exact: 0, compatible: 0, weak: 0, missing: 0 };
  for (const result of results) summary[result.status] += 1;
  const diagnosticSummary = { error: 0, warning: 0, info: 0 };
  for (const result of results) {
    for (const diagnostic of result.diagnostics) diagnosticSummary[diagnostic.severity] += 1;
  }
  return {
    version: 1,
    generatedBy: "scripts/check-type-anchors.mjs",
    inputs: {
      descriptors: relative(root, descriptors),
      lean: irpkg === null ? relative(root, manifest) : relative(root, irpkg),
    },
    summary,
    diagnosticSummary,
    results,
  };
}

function validateTsDescriptors(value) {
  if (value?.version !== 1 || !Array.isArray(value.symbols) || !Array.isArray(value.anchors)) {
    throw new Error("descriptor JSON must be { version: 1, symbols: [...], anchors: [...] }");
  }
  return value;
}

function collectLeanDescriptors(manifest) {
  const descriptors = new Map();
  const exportsByEntry = new Map();
  for (const entry of manifest.exports) {
    const descriptor = {
      kind: "export",
      lean: entry.entry,
      label: entry.jsName ?? entry.entry,
      source: entry.source,
      shape: {
        kind: "function",
        effect: entry.effect,
        args: (entry.args ?? []).map((arg) => ({ name: arg.name, type: leanShape(arg.type) })),
        result: leanShape(entry.result),
      },
    };
    addLeanDescriptor(descriptors, entry.entry, descriptor);
    addLeanDescriptor(descriptors, entry.id, descriptor);
    addLeanDescriptor(descriptors, entry.jsName, descriptor);
    exportsByEntry.set(entry.entry, { entry, descriptor });
    collectLeanTypes(descriptors, entry.result);
    for (const arg of entry.args ?? []) collectLeanTypes(descriptors, arg.type);
  }
  for (const entry of manifest.hostImports ?? []) {
    const descriptor = {
      kind: "hostImport",
      lean: entry.name,
      label: entry.target,
      source: entry.source,
      shape: {
        kind: "function",
        effect: entry.effect,
        args: (entry.args ?? []).map((arg) => ({ name: arg.name, type: leanShape(arg.type) })),
        result: leanShape(entry.result),
      },
    };
    addLeanDescriptor(descriptors, entry.name, descriptor);
    addLeanDescriptor(descriptors, entry.target, descriptor);
    collectLeanTypes(descriptors, entry.result);
    for (const arg of entry.args ?? []) collectLeanTypes(descriptors, arg.type);
  }
  collectLeanTypeAnchorAliases(descriptors, manifest, exportsByEntry);
  return descriptors;
}

function collectLeanTypeAnchorAliases(descriptors, manifest, exportsByEntry) {
  const aliases = manifest.metadata?.typeAnchorAliases;
  if (!Array.isArray(aliases)) return;
  for (const alias of aliases) {
    if (typeof alias?.lean !== "string" || typeof alias.via !== "string") continue;
    const via = exportsByEntry.get(alias.via);
    const descriptor = {
      kind: "type",
      lean: alias.lean,
      label: alias.type ?? alias.lean,
      source: alias.source ?? via?.descriptor.source,
      shape: leanAliasShape(alias, via?.entry, via?.descriptor),
    };
    addLeanDescriptor(descriptors, alias.lean, descriptor);
    addLeanDescriptor(descriptors, alias.type, descriptor);
  }
}

function leanAliasShape(alias, entry, viaDescriptor) {
  if (alias.descriptor === "resource") {
    return { kind: "resource", name: alias.lean, resource: alias.type };
  }
  if (alias.shapeFrom?.startsWith("arg:") && entry !== undefined) {
    const argName = alias.shapeFrom.slice("arg:".length);
    const arg = (entry.args ?? []).find((candidate) => candidate.name === argName);
    if (arg !== undefined) return leanShape(arg.type);
  }
  if (alias.descriptor === "function" && viaDescriptor !== undefined) {
    return viaDescriptor.shape;
  }
  return { kind: "opaque", name: alias.type ?? alias.lean };
}

function collectLeanTypes(descriptors, type) {
  if (!type || typeof type !== "object") return;
  const named = leanNamedDescriptor(type);
  if (named !== null) {
    addLeanDescriptor(descriptors, named.lean, named);
    if (type.type) addLeanDescriptor(descriptors, type.type, named);
  }
  for (const child of leanChildren(type)) collectLeanTypes(descriptors, child);
}

function leanNamedDescriptor(type) {
  switch (leanInterfaceTag(type)) {
    case WIRE.SIMPLE_ENUM:
    case WIRE.STRUCTURE:
    case WIRE.CUSTOM_INDUCTIVE:
    case WIRE.RESOURCE:
      return {
        kind: "type",
        lean: type.name ?? type.type,
        label: type.type ?? type.name,
        shape: leanShape(type),
      };
    default:
      return null;
  }
}

function leanChildren(type) {
  switch (leanInterfaceTag(type)) {
    case WIRE.ARRAY:
    case WIRE.LIST:
    case WIRE.OPTION:
      return [type.element];
    case WIRE.PROD:
      return [type.fst, type.snd];
    case WIRE.STRUCTURE:
      return (type.fields ?? []).map((field) => field.type);
    case WIRE.TAGGED_UNION:
      return (type.constructors ?? []).map((ctor) => ctor.type);
    case WIRE.CUSTOM_INDUCTIVE:
      return (type.constructors ?? []).flatMap((ctor) => (ctor.fields ?? []).map((field) => field.type));
    case WIRE.FUNCTION:
      return [...(type.args ?? []).map((arg) => arg.type), type.result];
    default:
      return [];
  }
}

function addLeanDescriptor(descriptors, key, descriptor) {
  if (typeof key !== "string" || key.length === 0) return;
  if (!descriptors.has(key)) descriptors.set(key, descriptor);
}

function leanShape(type) {
  switch (leanInterfaceTag(type)) {
    case WIRE.UNIT:
      return { kind: "primitive", name: "Unit" };
    case WIRE.NAT:
      return { kind: "primitive", name: "Nat" };
    case WIRE.INT:
      return { kind: "primitive", name: "Int" };
    case WIRE.BOOL:
      return { kind: "primitive", name: "Bool" };
    case WIRE.STRING:
      return { kind: "primitive", name: "String" };
    case WIRE.FLOAT:
      return { kind: "primitive", name: "Float" };
    case WIRE.FLOAT32:
      return { kind: "primitive", name: "Float32" };
    case WIRE.UINT8:
      return { kind: "primitive", name: "UInt8" };
    case WIRE.UINT16:
      return { kind: "primitive", name: "UInt16" };
    case WIRE.UINT32:
      return { kind: "primitive", name: "UInt32" };
    case WIRE.UINT64:
      return { kind: "primitive", name: "UInt64" };
    case WIRE.USIZE:
      return { kind: "primitive", name: "USize" };
    case WIRE.BYTE_ARRAY:
      return { kind: "primitive", name: "ByteArray" };
    case WIRE.EXPR:
      return { kind: "opaque", name: "Lean.Expr" };
    case WIRE.ARRAY:
    case WIRE.LIST:
      return { kind: "array", element: leanShape(type.element) };
    case WIRE.OPTION:
      return { kind: "option", element: leanShape(type.element) };
    case WIRE.PROD:
      return { kind: "tuple", elements: [leanShape(type.fst), leanShape(type.snd)] };
    case WIRE.SIMPLE_ENUM:
      return {
        kind: "enum",
        cases: (type.constructors ?? []).map((ctor) => ctor.jsName ?? ctor.name),
      };
    case WIRE.STRUCTURE:
      return {
        kind: "record",
        name: type.name ?? type.type,
        fields: Object.fromEntries((type.fields ?? []).map((field) => [field.name, leanShape(field.type)])),
      };
    case WIRE.TAGGED_UNION:
      return {
        kind: "variant",
        name: type.name ?? type.type,
        constructors: Object.fromEntries((type.constructors ?? []).map((ctor) => [
          ctor.jsName ?? ctor.name,
          { fields: { value: leanShape(ctor.type) } },
        ])),
      };
    case WIRE.CUSTOM_INDUCTIVE:
      return {
        kind: "variant",
        name: type.name ?? type.type,
        constructors: Object.fromEntries((type.constructors ?? []).map((ctor) => [
          ctor.jsName ?? ctor.name,
          { fields: Object.fromEntries((ctor.fields ?? []).map((field) => [field.name, leanShape(field.type)])) },
        ])),
      };
    case WIRE.RECURSIVE_SELF:
      return { kind: "ref", id: type.name ?? type.type };
    case WIRE.RESOURCE:
      return { kind: "resource", name: type.name ?? type.type };
    case WIRE.FUNCTION:
      return {
        kind: "function",
        effect: type.effect,
        args: (type.args ?? []).map((arg) => ({ name: arg.name, type: leanShape(arg.type) })),
        result: leanShape(type.result),
      };
    default:
      return { kind: "opaque", name: type?.type ?? `interfaceTag ${leanInterfaceTag(type) ?? "?"}` };
  }
}

function leanInterfaceTag(type) {
  return type?.interfaceTag;
}

function compareAnchor(anchor, lean, tsSymbols) {
  const leanDescriptor = lean.get(anchor.lean);
  const tsSymbol = tsSymbols.get(anchor.ts);
  if (leanDescriptor === undefined || tsSymbol === undefined) {
    const diagnostics = [];
    if (leanDescriptor === undefined) {
      diagnostics.push(diagnostic("lean_descriptor_missing", `missing Lean descriptor ${anchor.lean}`));
    }
    if (tsSymbol === undefined) {
      diagnostics.push(diagnostic("typescript_symbol_missing", `missing TypeScript symbol ${anchor.ts}`));
    }
    return anchorResult(anchor, "missing", diagnostics, leanDescriptor, tsSymbol);
  }
  const normalized = applyPortIntent(leanDescriptor.shape, tsSymbol, anchor.portIntent);
  const shapeComparison = compareShapes(normalized.lean, normalized.ts, tsSymbols, new Set());
  let status = shapeComparison.status;
  if (normalized.mismatch && statusRank[status] < statusRank.weak) status = "weak";
  if (!normalized.mismatch && status === "exact" && normalized.diagnostics.length !== 0) status = "compatible";
  return anchorResult(
    anchor,
    status,
    [...normalized.diagnostics, ...shapeComparison.diagnostics],
    leanDescriptor,
    tsSymbol,
  );
}

function applyPortIntent(leanShape, tsSymbol, portIntent) {
  let lean = leanShape;
  let ts = tsSymbol.shape;
  const diagnostics = [];
  let mismatch = false;
  if (portIntent === undefined) return { lean, ts, diagnostics, mismatch };

  if (portIntent.representation === "hostResource") {
    if (lean.kind === "resource") {
      ts = { kind: "resource", name: lean.name };
      diagnostics.push(diagnostic(
        "reviewed_resource_representation",
        "reviewed port intent represents the TypeScript object as a host resource",
        "info",
      ));
    } else {
      mismatch = true;
      diagnostics.push(diagnostic(
        "port_intent_representation_mismatch",
        `reviewed hostResource intent found Lean ${lean.kind}`,
      ));
    }
  }

  if (tsSymbol.kind === "method" && typeof portIntent.receiver === "string") {
    if (lean.kind === "function" && (lean.args ?? []).length !== 0) {
      lean = { ...lean, args: lean.args.slice(1) };
      diagnostics.push(diagnostic(
        "reviewed_explicit_method_receiver",
        `Lean exposes the TypeScript method receiver as an explicit ${portIntent.receiver} argument`,
        "info",
      ));
    } else {
      mismatch = true;
      diagnostics.push(diagnostic(
        "port_intent_receiver_mismatch",
        "reviewed method receiver intent has no corresponding Lean function argument",
      ));
    }
  }

  if (typeof portIntent.effect === "string") {
    if (lean.kind === "function" && ts.kind === "function" && lean.effect === portIntent.effect) {
      ts = { ...ts, effect: portIntent.effect };
      diagnostics.push(diagnostic(
        "reviewed_effect",
        `reviewed port intent supplies the ${portIntent.effect} effect absent from TypeScript declarations`,
        "info",
      ));
    } else {
      mismatch = true;
      diagnostics.push(diagnostic(
        "port_intent_effect_mismatch",
        `reviewed ${portIntent.effect} effect does not match the Lean descriptor`,
      ));
    }
  }

  if (Array.isArray(portIntent.omittedOptionalParameters) && ts.kind === "function") {
    const omitted = new Set(portIntent.omittedOptionalParameters);
    const removable = (ts.args ?? []).filter((arg) => omitted.has(arg.name) && arg.optional === true);
    if (removable.length === omitted.size) {
      ts = { ...ts, args: ts.args.filter((arg) => !omitted.has(arg.name)) };
      diagnostics.push(diagnostic(
        "reviewed_optional_parameters_omitted",
        `reviewed port intent omits optional TypeScript parameters: ${[...omitted].join(", ")}`,
        "info",
      ));
    } else {
      mismatch = true;
      diagnostics.push(diagnostic(
        "port_intent_optional_parameter_mismatch",
        "reviewed omitted parameters are not optional TypeScript parameters",
      ));
    }
  }

  if (portIntent.resultRepresentation === "hostResource" && lean.kind === "function" && ts.kind === "function") {
    if (lean.result?.kind === "resource") {
      ts = { ...ts, result: { kind: "resource", name: lean.result.name } };
      diagnostics.push(diagnostic(
        "reviewed_resource_result",
        "reviewed port intent represents the TypeScript result as a host resource",
        "info",
      ));
    } else {
      mismatch = true;
      diagnostics.push(diagnostic(
        "port_intent_result_mismatch",
        `reviewed hostResource result intent found Lean ${lean.result?.kind ?? "?"}`,
      ));
    }
  }

  return { lean, ts, diagnostics, mismatch };
}

function anchorResult(anchor, status, diagnostics, leanDescriptor, tsSymbol) {
  const relation = anchor.relation ?? "audit";
  const reviewedDiagnostics = diagnostics.map((item) => ({
    ...item,
    severity: item.severity ?? diagnosticSeverity(status, relation),
  }));
  return {
    id: anchor.id ?? anchorId(anchor),
    lean: anchor.lean,
    ts: anchor.ts,
    status,
    relation,
    notes: reviewedDiagnostics.map((item) => item.message),
    diagnostics: reviewedDiagnostics,
    ...(anchor.category ? { category: anchor.category } : {}),
    ...(anchor.note ? { note: anchor.note } : {}),
    ...(anchor.portIntent ? { portIntent: anchor.portIntent } : {}),
    ...(leanDescriptor ? { leanDescriptor } : {}),
    ...(tsSymbol ? { tsSymbol } : {}),
  };
}

function diagnosticSeverity(status, relation) {
  if (status === "missing") return relation === "coverageGap" ? "info" : "error";
  if (status === "weak") return "warning";
  return "info";
}

function diagnostic(code, message, severity) {
  return { code, message, ...(severity === undefined ? {} : { severity }) };
}

function comparison(status, diagnostics = []) {
  return {
    status,
    diagnostics,
    notes: diagnostics.map((item) => item.message),
  };
}

function anchorId(anchor) {
  return anchor.lean.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function compareShapes(lean, tsShape, tsSymbols, seen) {
  const ts = resolveTsRef(tsShape, tsSymbols, seen);
  if (lean?.kind === "primitive" && ts?.kind === "union") {
    return comparePrimitiveUnion(lean, ts, tsSymbols, seen);
  }
  if (ts?.kind === "ref") {
    return comparison("weak", [
      diagnostic("typescript_reference_unresolved", `unresolved TypeScript reference ${ts.id}`),
    ]);
  }
  if (lean?.kind === "ref") {
    return comparison("weak", [
      diagnostic("lean_recursive_reference", `recursive Lean reference ${lean.id}`),
    ]);
  }
  if (lean?.kind === "primitive" && ts?.kind === "primitive") {
    return comparePrimitives(lean.name, ts.name);
  }
  if (lean?.kind === "resource" && ts?.kind === "resource") {
    return suffixEqual(lean.name, ts.name)
      ? comparison("exact")
      : comparison("compatible", [
        diagnostic("resource_name_mismatch", `resource names differ: ${lean.name} vs ${ts.name}`, "info"),
      ]);
  }
  if (lean?.kind !== ts?.kind) {
    return comparison("weak", [
      diagnostic("descriptor_kind_mismatch", `kind differs: Lean ${lean?.kind ?? "?"} vs TypeScript ${ts?.kind ?? "?"}`),
    ]);
  }
  switch (lean.kind) {
    case "array":
    case "option":
      return childComparison(compareShapes(lean.element, ts.element, tsSymbols, seen));
    case "tuple":
      return compareSequence(lean.elements, ts.elements, tsSymbols, seen, "tuple element");
    case "record":
      return compareRecord(lean, ts, tsSymbols, seen);
    case "enum":
      return compareNames(lean.cases, ts.cases, "enum case");
    case "variant":
      return compareVariant(lean, ts, tsSymbols, seen);
    case "function":
      return compareFunction(lean, ts, tsSymbols, seen);
    case "opaque":
      return comparison("weak", [
        diagnostic("descriptor_opaque", `opaque descriptor ${lean.name ?? ts.name ?? ""}`.trim()),
      ]);
    default:
      return comparison("weak", [
        diagnostic("descriptor_kind_unsupported", `unsupported descriptor kind ${lean.kind}`),
      ]);
  }
}

function resolveTsRef(shape, tsSymbols, seen) {
  if (shape?.kind !== "ref") return shape;
  if (seen.has(shape.id)) return shape;
  const symbol = tsSymbols.get(shape.id);
  if (symbol === undefined) return shape;
  seen.add(shape.id);
  return resolveTsRef(symbol.shape, tsSymbols, seen);
}

function comparePrimitiveUnion(lean, ts, tsSymbols, seen) {
  const results = ts.options.map((option) => compareShapes(lean, option, tsSymbols, seen));
  if (results.some((result) => result.status === "exact" || result.status === "compatible")) {
    return comparison("compatible", [
      diagnostic("primitive_union_compatible", `Lean ${lean.name} accepts one TypeScript union arm compatibly`, "info"),
    ]);
  }
  return comparison("weak", [
    diagnostic("primitive_union_mismatch", `Lean ${lean.name} does not match TypeScript union`),
  ]);
}

function comparePrimitives(leanName, tsName) {
  if (primitiveExact(leanName, tsName)) return comparison("exact");
  if (primitiveCompatible(leanName, tsName)) {
    return comparison("compatible", [
      diagnostic("primitive_representation_compatible", `Lean ${leanName} uses TypeScript ${tsName} representation`, "info"),
    ]);
  }
  return comparison("weak", [
    diagnostic("primitive_mismatch", `primitive differs: Lean ${leanName} vs TypeScript ${tsName}`),
  ]);
}

function primitiveExact(leanName, tsName) {
  return (
    (leanName === "String" && tsName === "string") ||
    (leanName === "Bool" && tsName === "boolean") ||
    ((leanName === "Float" || leanName === "Float32") && tsName === "number")
  );
}

function primitiveCompatible(leanName, tsName) {
  if (leanName === "Unit" && ["void", "undefined", "null"].includes(tsName)) return true;
  if (["Nat", "Int", "UInt8", "UInt16", "UInt32", "UInt64", "USize"].includes(leanName) &&
      ["number", "string", "bigint"].includes(tsName)) return true;
  if (leanName === "ByteArray" && tsName === "Uint8Array") return true;
  return false;
}

function compareRecord(lean, ts, tsSymbols, seen) {
  const leanFields = Object.keys(lean.fields ?? {}).sort();
  const tsFields = Object.keys(ts.fields ?? {}).sort();
  const diagnostics = nameDiffDiagnostics(leanFields, tsFields, "field");
  const shared = leanFields.filter((name) => tsFields.includes(name));
  const childResults = shared.map((name) => compareShapes(lean.fields[name], ts.fields[name], tsSymbols, new Set(seen)));
  return combineChildResults(childResults, diagnostics);
}

function compareVariant(lean, ts, tsSymbols, seen) {
  const leanNames = Object.keys(lean.constructors ?? {}).sort();
  const tsNames = Object.keys(ts.constructors ?? {}).sort();
  const diagnostics = nameDiffDiagnostics(leanNames, tsNames, "constructor");
  const childResults = [];
  for (const name of leanNames.filter((candidate) => tsNames.includes(candidate))) {
    childResults.push(compareRecord(lean.constructors[name], ts.constructors[name], tsSymbols, new Set(seen)));
  }
  return combineChildResults(childResults, diagnostics);
}

function compareFunction(lean, ts, tsSymbols, seen) {
  const diagnostics = [];
  if ((lean.effect ?? "pure") !== (ts.effect ?? "pure")) {
    diagnostics.push(diagnostic(
      "effect_mismatch",
      `effect differs: Lean ${lean.effect ?? "pure"} vs TypeScript ${ts.effect ?? "pure"}`,
    ));
  }
  const leanArgs = lean.args ?? [];
  const tsArgs = ts.args ?? [];
  if (leanArgs.length !== tsArgs.length) {
    diagnostics.push(diagnostic("arity_mismatch", `arity differs: Lean ${leanArgs.length} vs TypeScript ${tsArgs.length}`));
  }
  const childResults = [];
  for (let index = 0; index < Math.min(leanArgs.length, tsArgs.length); index += 1) {
    childResults.push(compareShapes(leanArgs[index].type, tsArgs[index].type, tsSymbols, new Set(seen)));
  }
  childResults.push(compareShapes(lean.result, ts.result, tsSymbols, new Set(seen)));
  return combineChildResults(childResults, diagnostics);
}

function compareSequence(left, right, tsSymbols, seen, label) {
  const diagnostics = [];
  if ((left ?? []).length !== (right ?? []).length) {
    diagnostics.push(diagnostic(
      "sequence_length_mismatch",
      `${label} count differs: Lean ${(left ?? []).length} vs TypeScript ${(right ?? []).length}`,
    ));
  }
  const childResults = [];
  for (let index = 0; index < Math.min((left ?? []).length, (right ?? []).length); index += 1) {
    childResults.push(compareShapes(left[index], right[index], tsSymbols, new Set(seen)));
  }
  return combineChildResults(childResults, diagnostics);
}

function compareNames(left, right, label) {
  const diagnostics = nameDiffDiagnostics(left ?? [], right ?? [], label);
  return comparison(diagnostics.length === 0 ? "exact" : "weak", diagnostics);
}

function childComparison(result) {
  return result;
}

function combineChildResults(results, diagnostics) {
  let rank = diagnostics.length === 0 ? statusRank.exact : statusRank.weak;
  const allDiagnostics = [...diagnostics];
  for (const result of results) {
    rank = Math.max(rank, statusRank[result.status]);
    allDiagnostics.push(...result.diagnostics);
  }
  if (rank === statusRank.exact && results.some((result) => result.status === "compatible")) {
    rank = statusRank.compatible;
  }
  const uniqueDiagnostics = [...new Map(allDiagnostics.map((item) => [`${item.code}\0${item.message}`, item])).values()];
  return comparison(Object.keys(statusRank).find((status) => statusRank[status] === rank), uniqueDiagnostics);
}

function nameDiffDiagnostics(left, right, label) {
  const diagnostics = [];
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const missing = left.filter((name) => !rightSet.has(name));
  const extra = right.filter((name) => !leftSet.has(name));
  if (missing.length !== 0) {
    diagnostics.push(diagnostic(`typescript_${label}_missing`, `missing TypeScript ${label}s: ${missing.join(", ")}`));
  }
  if (extra.length !== 0) {
    diagnostics.push(diagnostic(`typescript_${label}_extra`, `extra TypeScript ${label}s: ${extra.join(", ")}`));
  }
  return diagnostics;
}

function suffixEqual(left, right) {
  if (left === right) return true;
  const leftParts = String(left).split(".");
  const rightParts = String(right).split(".");
  return leftParts[leftParts.length - 1] === rightParts[rightParts.length - 1];
}

function printSummary(report) {
  console.log(`type anchors: ${report.results.length}`);
  console.log(`  exact: ${report.summary.exact}`);
  console.log(`  compatible: ${report.summary.compatible}`);
  console.log(`  weak: ${report.summary.weak}`);
  console.log(`  missing: ${report.summary.missing}`);
  console.log(`  diagnostics: ${report.diagnosticSummary.error} errors, ${report.diagnosticSummary.warning} warnings, ${report.diagnosticSummary.info} info`);
  for (const result of report.results) {
    const note = result.notes.length === 0 ? "" : ` (${result.notes.join("; ")})`;
    console.log(`  - ${result.status}: ${result.lean} -> ${result.ts}${note}`);
  }
}
