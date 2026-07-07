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
import { WIRE } from "../web/src/runtime/wire-tags.js";

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
  const coverage = buildCoverage(results);
  return {
    version: 1,
    generatedBy: "scripts/check-type-anchors.mjs",
    inputs: {
      descriptors: relative(root, descriptors),
      lean: irpkg === null ? relative(root, manifest) : relative(root, irpkg),
    },
    ...(tsDescriptors.provenance ? { typeScriptProvenance: tsDescriptors.provenance } : {}),
    summary,
    coverage,
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
  return descriptors;
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
  switch (type.wireTag) {
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
  switch (type?.wireTag) {
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
  switch (type?.wireTag) {
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
      return { kind: "opaque", name: type?.type ?? `wireTag ${type?.wireTag ?? "?"}` };
  }
}

function compareAnchor(anchor, lean, tsSymbols) {
  const leanDescriptor = lean.get(anchor.lean);
  const tsSymbol = tsSymbols.get(anchor.ts);
  if (leanDescriptor === undefined || tsSymbol === undefined) {
    const notes = [];
    if (leanDescriptor === undefined) notes.push(`missing Lean descriptor ${anchor.lean}`);
    if (tsSymbol === undefined) notes.push(`missing TypeScript symbol ${anchor.ts}`);
    return anchorResult(anchor, "missing", notes, leanDescriptor, tsSymbol);
  }
  const comparison = compareShapes(leanDescriptor.shape, tsSymbol.shape, tsSymbols, new Set());
  return anchorResult(anchor, comparison.status, comparison.notes, leanDescriptor, tsSymbol);
}

function anchorResult(anchor, status, notes, leanDescriptor, tsSymbol) {
  return {
    id: anchor.id ?? anchorId(anchor),
    lean: anchor.lean,
    ts: anchor.ts,
    status,
    notes,
    relation: anchor.relation ?? inferredAnchorRelation(anchor),
    ...(anchor.category ? { category: anchor.category } : {}),
    ...(anchor.note ? { note: anchor.note } : {}),
    ...(leanDescriptor ? { leanDescriptor } : {}),
    ...(tsSymbol ? { tsSymbol } : {}),
  };
}

function anchorId(anchor) {
  return anchor.lean.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function inferredAnchorRelation(anchor) {
  return typeof anchor.note === "string" && anchor.note.startsWith("Coverage gap:")
    ? "coverageGap"
    : "audit";
}

function buildCoverage(results) {
  const categories = new Map();
  for (const result of results) {
    const category = result.category ?? "Type anchors";
    if (!categories.has(category)) categories.set(category, coverageCategory(category));
    const row = categories.get(category);
    row.anchors += 1;
    row.status[result.status] += 1;
    if (result.relation === "coverageGap") row.relations.coverageGap += 1;
    else row.relations.audit += 1;
    row.typeScriptSymbols.add(result.ts);
    row.leanTargets.add(result.lean);
    if (result.leanDescriptor !== undefined) row.leanDescriptors.add(result.lean);
    else row.missingLeanTargets.add(result.lean);
  }
  return {
    categories: [...categories.values()].map((row) => ({
      category: row.category,
      anchors: row.anchors,
      relations: row.relations,
      status: row.status,
      typeScriptSymbols: [...row.typeScriptSymbols],
      leanTargets: [...row.leanTargets],
      leanDescriptors: [...row.leanDescriptors],
      missingLeanTargets: [...row.missingLeanTargets],
      interpretation: coverageInterpretation(row),
    })),
  };
}

function coverageCategory(category) {
  return {
    category,
    anchors: 0,
    relations: { audit: 0, coverageGap: 0 },
    status: { exact: 0, compatible: 0, weak: 0, missing: 0 },
    typeScriptSymbols: new Set(),
    leanTargets: new Set(),
    leanDescriptors: new Set(),
    missingLeanTargets: new Set(),
  };
}

function coverageInterpretation(row) {
  if (row.relations.coverageGap !== 0 && row.status.missing === row.anchors) {
    return "Coverage gap: these React surfaces have no Lean VIR descriptor yet.";
  }
  if (row.status.missing !== 0) {
    return "Mixed coverage: some anchors point to existing Lean descriptors, and some are gaps.";
  }
  if (row.status.weak !== 0) {
    return "Audit coverage: VIR has a related descriptor, but the React type surface is richer or structurally different.";
  }
  if (row.status.compatible !== 0) {
    return "Compatible coverage under known representation conventions.";
  }
  return "Exact coverage in this descriptor model.";
}

function compareShapes(lean, tsShape, tsSymbols, seen) {
  const ts = resolveTsRef(tsShape, tsSymbols, seen);
  if (lean?.kind === "primitive" && ts?.kind === "union") {
    return comparePrimitiveUnion(lean, ts, tsSymbols, seen);
  }
  if (ts?.kind === "ref") {
    return { status: "weak", notes: [`unresolved TypeScript reference ${ts.id}`] };
  }
  if (lean?.kind === "ref") {
    return { status: "weak", notes: [`recursive Lean reference ${lean.id}`] };
  }
  if (lean?.kind === "primitive" && ts?.kind === "primitive") {
    return comparePrimitives(lean.name, ts.name);
  }
  if (lean?.kind === "resource" && ts?.kind === "resource") {
    return suffixEqual(lean.name, ts.name)
      ? { status: "exact", notes: [] }
      : { status: "compatible", notes: [`resource names differ: ${lean.name} vs ${ts.name}`] };
  }
  if (lean?.kind !== ts?.kind) {
    return { status: "weak", notes: [`kind differs: Lean ${lean?.kind ?? "?"} vs TypeScript ${ts?.kind ?? "?"}`] };
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
      return { status: "weak", notes: [`opaque descriptor ${lean.name ?? ts.name ?? ""}`.trim()] };
    default:
      return { status: "weak", notes: [`unsupported descriptor kind ${lean.kind}`] };
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
    return {
      status: "compatible",
      notes: [`Lean ${lean.name} accepts one TypeScript union arm compatibly`],
    };
  }
  return { status: "weak", notes: [`Lean ${lean.name} does not match TypeScript union`] };
}

function comparePrimitives(leanName, tsName) {
  if (primitiveExact(leanName, tsName)) return { status: "exact", notes: [] };
  if (primitiveCompatible(leanName, tsName)) {
    return { status: "compatible", notes: [`Lean ${leanName} uses TypeScript ${tsName} representation`] };
  }
  return { status: "weak", notes: [`primitive differs: Lean ${leanName} vs TypeScript ${tsName}`] };
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
  const notes = nameDiffNotes(leanFields, tsFields, "field");
  const shared = leanFields.filter((name) => tsFields.includes(name));
  const childResults = shared.map((name) => compareShapes(lean.fields[name], ts.fields[name], tsSymbols, new Set(seen)));
  return combineChildResults(childResults, notes);
}

function compareVariant(lean, ts, tsSymbols, seen) {
  const leanNames = Object.keys(lean.constructors ?? {}).sort();
  const tsNames = Object.keys(ts.constructors ?? {}).sort();
  const notes = nameDiffNotes(leanNames, tsNames, "constructor");
  const childResults = [];
  for (const name of leanNames.filter((candidate) => tsNames.includes(candidate))) {
    childResults.push(compareRecord(lean.constructors[name], ts.constructors[name], tsSymbols, new Set(seen)));
  }
  return combineChildResults(childResults, notes);
}

function compareFunction(lean, ts, tsSymbols, seen) {
  const notes = [];
  if ((lean.effect ?? "pure") !== (ts.effect ?? "pure")) {
    notes.push(`effect differs: Lean ${lean.effect ?? "pure"} vs TypeScript ${ts.effect ?? "pure"}`);
  }
  const leanArgs = lean.args ?? [];
  const tsArgs = ts.args ?? [];
  if (leanArgs.length !== tsArgs.length) {
    notes.push(`arity differs: Lean ${leanArgs.length} vs TypeScript ${tsArgs.length}`);
  }
  const childResults = [];
  for (let index = 0; index < Math.min(leanArgs.length, tsArgs.length); index += 1) {
    childResults.push(compareShapes(leanArgs[index].type, tsArgs[index].type, tsSymbols, new Set(seen)));
  }
  childResults.push(compareShapes(lean.result, ts.result, tsSymbols, new Set(seen)));
  return combineChildResults(childResults, notes);
}

function compareSequence(left, right, tsSymbols, seen, label) {
  const notes = [];
  if ((left ?? []).length !== (right ?? []).length) {
    notes.push(`${label} count differs: Lean ${(left ?? []).length} vs TypeScript ${(right ?? []).length}`);
  }
  const childResults = [];
  for (let index = 0; index < Math.min((left ?? []).length, (right ?? []).length); index += 1) {
    childResults.push(compareShapes(left[index], right[index], tsSymbols, new Set(seen)));
  }
  return combineChildResults(childResults, notes);
}

function compareNames(left, right, label) {
  const notes = nameDiffNotes(left ?? [], right ?? [], label);
  return { status: notes.length === 0 ? "exact" : "weak", notes };
}

function childComparison(result) {
  return result.status === "exact" ? result : { status: result.status, notes: result.notes };
}

function combineChildResults(results, notes) {
  let rank = notes.length === 0 ? statusRank.exact : statusRank.weak;
  const allNotes = [...notes];
  for (const result of results) {
    rank = Math.max(rank, statusRank[result.status]);
    allNotes.push(...result.notes);
  }
  if (rank === statusRank.exact && results.some((result) => result.status === "compatible")) {
    rank = statusRank.compatible;
  }
  return {
    status: Object.keys(statusRank).find((status) => statusRank[status] === rank),
    notes: [...new Set(allNotes)],
  };
}

function nameDiffNotes(left, right, label) {
  const notes = [];
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const missing = left.filter((name) => !rightSet.has(name));
  const extra = right.filter((name) => !leftSet.has(name));
  if (missing.length !== 0) notes.push(`missing TypeScript ${label}s: ${missing.join(", ")}`);
  if (extra.length !== 0) notes.push(`extra TypeScript ${label}s: ${extra.join(", ")}`);
  return notes;
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
  for (const result of report.results) {
    const note = result.notes.length === 0 ? "" : ` (${result.notes.join("; ")})`;
    console.log(`  - ${result.status}: ${result.lean} -> ${result.ts}${note}`);
  }
}
