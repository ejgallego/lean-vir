/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { readIrPackageFile } from "../packages/irpkg-format.mjs";
import { repositoryRoot as root } from "../repository-paths.mjs";
import { emitGeneratedFile, requiredValue } from "./tool-utils.mjs";
import {
  validateInterfaceManifest,
  validateInterfaceType,
} from "../../web/src/runtime/interface-manifest.js";
import { typeScriptAnchorId, validateTypeScriptAnchors } from "./type-anchor-format.mjs";

const statusRank = {
  exact: 0,
  compatible: 1,
  weak: 2,
  missing: 3,
};

function usage() {
  console.log(`usage: node scripts/bindings/check-type-anchors.mjs --descriptors FILE [Lean inputs] [options]

Compare TypeScript descriptor JSON with Lean VIR interface descriptors.

Options:
  --descriptors FILE  TypeScript descriptor JSON from generate-ts-descriptors.
  --irpkg FILE        Read Lean descriptors from a manifest-bearing .irpkg.
  --manifest FILE     Read Lean descriptors from a manifest JSON fixture.
  --inventory FILE    Read compiler-classified shipped public Lean declarations.
  --out FILE          Write machine-readable comparison report JSON.
  --check             Compare generated report with --out instead of writing it.
  --json              Print report JSON to stdout when --out is not used.
  --strict            Exit nonzero on weak or missing anchors.
  --fail-on-errors    Exit nonzero on error-severity review diagnostics.
  -h, --help          Show this help.
`);
}

function parseArgs(argv) {
  let descriptors = null;
  let irpkg = null;
  let manifest = null;
  let inventory = null;
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
        return null;
      case "--descriptors":
        descriptors = requiredValue(argv, ++index, "--descriptors");
        break;
      case "--irpkg":
        irpkg = requiredValue(argv, ++index, "--irpkg");
        break;
      case "--manifest":
        manifest = requiredValue(argv, ++index, "--manifest");
        break;
      case "--inventory":
        inventory = requiredValue(argv, ++index, "--inventory");
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
        throw new Error(`unknown option ${arg}`);
    }
  }
  if (descriptors === null) throw new Error("--descriptors is required");
  if (irpkg !== null && manifest !== null) {
    throw new Error("pass at most one of --irpkg or --manifest");
  }
  if (irpkg === null && manifest === null && inventory === null) {
    throw new Error("pass at least one Lean input: --irpkg, --manifest, or --inventory");
  }
  if (check && out === null) throw new Error("--check requires --out");
  return {
    descriptors: resolve(root, descriptors),
    irpkg: irpkg === null ? null : resolve(root, irpkg),
    manifest: manifest === null ? null : resolve(root, manifest),
    inventory: inventory === null ? null : resolve(root, inventory),
    out: out === null ? null : resolve(root, out),
    check,
    json,
    strict,
    failOnErrors,
  };
}

export async function runTypeAnchorReportCli(argv) {
  const cli = parseArgs(argv);
  if (cli === null) return 0;
  const report = await buildTypeAnchorReport(cli);
  const text = `${JSON.stringify(report, null, 2)}\n`;

  if (cli.out !== null) {
    const action = await emitGeneratedFile(cli.out, text, {
      check: cli.check,
      root,
      staleHint: "rerun the corresponding comparison step without --check",
    });
    console.log(`${action} ${relative(root, cli.out)} (${report.results.length} anchors)`);
  } else if (cli.json) {
    process.stdout.write(text);
  } else {
    printSummary(report);
  }

  const strictFailure = cli.strict &&
    (report.summary.weak !== 0 || report.summary.missing !== 0);
  const diagnosticFailure = cli.failOnErrors &&
    report.diagnosticSummary.error !== 0;
  return strictFailure || diagnosticFailure ? 1 : 0;
}

export async function buildTypeAnchorReport({
  descriptors,
  irpkg = null,
  manifest = null,
  inventory = null,
}) {
  const tsDescriptors = validateTsDescriptors(JSON.parse(await readFile(descriptors, "utf8")));
  let lean = new Map();
  if (irpkg !== null || manifest !== null) {
    const leanManifest = irpkg !== null
      ? (await readIrPackageFile(irpkg)).manifest
      : validateInterfaceManifest(JSON.parse(await readFile(manifest, "utf8")));
    lean = collectLeanDescriptors(leanManifest);
  }
  if (inventory !== null) {
    const shipped = validateShippedInventory(JSON.parse(await readFile(inventory, "utf8")));
    collectShippedLeanDescriptors(lean, shipped);
  }
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
    generatedBy: "scripts/bindings/check-type-anchors.mjs",
    inputs: {
      descriptors: relative(root, descriptors),
      ...(irpkg === null && manifest === null
        ? {}
        : { lean: irpkg === null ? relative(root, manifest) : relative(root, irpkg) }),
      ...(inventory === null ? {} : { shippedInventory: relative(root, inventory) }),
    },
    ...(tsDescriptors.dependencies ? { typeScriptDependencies: tsDescriptors.dependencies } : {}),
    summary,
    diagnosticSummary,
    results,
  };
}

function validateTsDescriptors(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      value.version !== 1 || !Array.isArray(value.symbols) || !Array.isArray(value.anchors)) {
    throw new Error("descriptor JSON must be { version: 1, symbols: [...], anchors: [...] }");
  }
  const symbolIds = new Set();
  for (const [index, symbol] of value.symbols.entries()) {
    if (symbol === null || typeof symbol !== "object" || Array.isArray(symbol) ||
        typeof symbol.id !== "string" || symbol.id.length === 0) {
      throw new Error(`symbols[${index}].id must be a non-empty string`);
    }
    if (symbolIds.has(symbol.id)) throw new Error(`duplicate TypeScript symbol id ${symbol.id}`);
    symbolIds.add(symbol.id);
  }
  validateTypeScriptAnchors(value.anchors, symbolIds);
  return value;
}

function validateShippedInventory(value) {
  if (value?.format !== "lean-vir-js-inventory" || value.version !== 1 ||
      !Array.isArray(value.publicEntries) ||
      value.summary?.publicEntries !== value.publicEntries.length) {
    throw new Error("shipped inventory must be a compiler-derived lean-vir-js-inventory v1 artifact");
  }
  for (const entry of value.publicEntries) {
    const descriptor = entry.interface;
    if (typeof entry.declaration !== "string" ||
        (descriptor !== null &&
          (descriptor?.kind !== "function" || typeof descriptor.effect !== "string" ||
            !Array.isArray(descriptor.args) ||
            descriptor.args.some((arg) =>
              typeof arg?.name !== "string" || arg?.type === null || typeof arg?.type !== "object") ||
            descriptor.result === null || typeof descriptor.result !== "object"))) {
      throw new Error(`invalid shipped public interface descriptor for ${entry.declaration ?? "?"}`);
    }
    if (descriptor !== null) {
      for (const arg of descriptor.args) {
        validateInterfaceType(arg.type, `shipped ${entry.declaration} argument ${arg.name}`);
      }
      validateInterfaceType(descriptor.result, `shipped ${entry.declaration} result`);
    }
  }
  return value;
}

function collectShippedLeanDescriptors(descriptors, inventory) {
  for (const entry of inventory.publicEntries) {
    if (entry.interface === null) continue;
    const descriptor = {
      kind: "public",
      lean: entry.declaration,
      label: entry.declaration,
      source: entry.source,
      shape: {
        kind: "function",
        effect: entry.interface.effect,
        args: entry.interface.args.map((arg) => ({ name: arg.name, type: leanShape(arg.type) })),
        result: leanShape(entry.interface.result),
      },
    };
    addLeanDescriptor(descriptors, entry.declaration, descriptor);
    collectLeanTypes(descriptors, entry.interface.result);
    for (const arg of entry.interface.args) collectLeanTypes(descriptors, arg.type);
  }
}

function collectLeanDescriptors(manifest) {
  const descriptors = new Map();
  const exportsByEntry = new Map();
  for (const entry of manifest.exports) {
    const descriptor = {
      kind: "export",
      lean: entry.entry,
      label: entry.entry,
      source: entry.source,
      shape: {
        kind: "function",
        effect: entry.effect,
        args: (entry.args ?? []).map((arg) => ({ name: arg.name, type: leanShape(arg.type) })),
        result: leanShape(entry.result),
      },
    };
    addLeanDescriptor(descriptors, entry.entry, descriptor);
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
  for (const [index, alias] of aliases.entries()) {
    if (typeof alias?.lean !== "string" || typeof alias.via !== "string") {
      throw new Error(
        `manifest metadata typeAnchorAliases[${index}] must name lean and via declarations`,
      );
    }
    const via = exportsByEntry.get(alias.via);
    if (via === undefined) {
      throw new Error(
        `type anchor alias ${alias.lean} references missing compiler export ${alias.via}`,
      );
    }
    const descriptor = {
      kind: "type",
      lean: alias.lean,
      label: alias.type ?? alias.lean,
      source: alias.source ?? via.descriptor.source,
      shape: leanAliasShape(alias, via.entry, via.descriptor),
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

function collectLeanTypes(descriptors, pair, bindings = [], ancestors = new Set()) {
  if (!pair || typeof pair !== "object") return;
  if (pair.native?.ref !== undefined || pair.value?.tag === "recursive") {
    const target = resolvePairReference(pair, bindings);
    if (target !== null) collectLeanTypes(descriptors, target, bindings.slice(1), ancestors);
    return;
  }
  const native = pair.native;
  if (!native || typeof native !== "object" || ancestors.has(native)) return;
  const named = leanNamedDescriptor(pair, bindings);
  if (named !== null) addLeanDescriptor(descriptors, named.lean, named);
  const nested = new Set(ancestors);
  nested.add(native);
  for (const child of leanChildren(pair, [pair, ...bindings])) {
    collectLeanTypes(descriptors, child.pair, child.bindings, nested);
  }
}

function leanNamedDescriptor(pair, bindings) {
  const native = pair.native;
  const declaration = native?.metadata?.declaration;
  const view = pair.value;
  if (typeof declaration !== "string" || declaration.length === 0) return null;
  if (!["enum", "record", "variant", "expr"].includes(view?.tag) &&
      native?.type?.tag !== "resource") return null;
  return {
    kind: "type",
    lean: declaration,
    label: declaration,
    shape: leanShape(pair, bindings),
  };
}

function leanChildren(pair, bindings) {
  const view = pair.value;
  const native = pair.native;
  if (view?.tag === "record") {
    return (view.fields ?? []).map((field) => pairAtPath(
      native,
      field.path,
      0,
      field.value,
      bindings,
    ));
  }
  if (view?.tag === "variant") {
    return view.cases.flatMap((caseView, index) => {
      if (caseView.payload === "value") {
        return [pairAtPath(native, [0], index, caseView.value, bindings)];
      }
      if (caseView.payload === "fields") {
        return caseView.fields.map((field) => pairAtPath(
          native,
          field.path,
          index,
          field.value,
          bindings,
        ));
      }
      return [];
    });
  }
  if (view?.tag === "sequence") {
    const child = view.chain === undefined
      ? { native: native.metadata?.arrayElement, bindings }
      : nativeFieldAtPath(native, [view.chain.head], view.chain.cons, bindings);
    return child?.native === undefined || child?.native === null
      ? []
      : [{ pair: { native: child.native, value: view.element }, bindings: child.bindings }];
  }
  if (view?.tag === "function") {
    const signature = native.metadata?.signature;
    if (signature === undefined) return [];
    const args = view.args.map((value, index) => ({
      pair: { native: signature.args[index], value },
      bindings,
    }));
    return [...args, { pair: { native: signature.result, value: view.result }, bindings }];
  }
  return [];
}

function addLeanDescriptor(descriptors, key, descriptor) {
  if (typeof key === "string" && key.length > 0 && !descriptors.has(key)) {
    descriptors.set(key, descriptor);
  }
}

function leanShape(pair, bindings = []) {
  if (pair?.native?.ref !== undefined || pair?.value?.tag === "recursive") {
    const target = resolvePairReference(pair, bindings);
    const declaration = target?.native?.metadata?.declaration;
    const owner = bindings[0]?.native?.metadata?.declaration;
    return { kind: "ref", id: declaration ?? owner ?? `recursive${pair.native?.ref ?? 0}` };
  }
  const native = pair?.native;
  const view = pair?.value;
  const nativeType = native?.type;
  const declaration = native?.metadata?.declaration;
  switch (view?.tag) {
    case "bigint":
    case "number":
    case "safeInteger":
      return { kind: "primitive", name: nativePrimitiveName(nativeType) };
    case "string":
      return { kind: "primitive", name: "String" };
    case "bytes":
      return { kind: "primitive", name: "ByteArray" };
    case "unit":
      return { kind: "primitive", name: "Unit" };
    case "boolean":
      return { kind: "primitive", name: "Bool" };
    case "enum":
      return { kind: "enum", cases: view.cases };
    case "record":
      return {
        kind: "record",
        name: declaration,
        fields: Object.fromEntries(view.fields.map((field) => [
          field.key,
          (() => {
            const child = pairAtPath(native, field.path, 0, field.value, [pair, ...bindings]);
            return leanShape(child.pair, child.bindings);
          })(),
        ])),
      };
    case "variant":
      return {
        kind: "variant",
        name: declaration,
        constructors: Object.fromEntries(view.cases.map((caseView, index) => [
          caseView.kind,
          { fields: variantFields(pair, caseView, index, bindings) },
        ])),
      };
    case "sequence": {
      const child = view.chain === undefined
        ? { native: native?.metadata?.arrayElement, bindings: [pair, ...bindings] }
        : nativeFieldAtPath(native, [view.chain.head], view.chain.cons, [pair, ...bindings]);
      return {
        kind: "array",
        element: child?.native === undefined || child?.native === null
          ? { kind: "opaque", name: "sequence element" }
          : leanShape({ native: child.native, value: view.element }, child.bindings),
      };
    }
    case "function": {
      const signature = native?.metadata?.signature;
      if (signature === undefined) return { kind: "opaque", name: declaration ?? "function" };
      return {
        kind: "function",
        effect: signature.effect,
        args: view.args.map((value, index) => ({
          name: `arg${index + 1}`,
          type: leanShape({ native: signature.args[index], value }, [pair, ...bindings]),
        })),
        result: leanShape({ native: signature.result, value: view.result }, [pair, ...bindings]),
      };
    }
    case "expr":
      return { kind: "opaque", name: declaration ?? "Lean.Expr" };
    case "jsReference":
      return { kind: "resource", name: declaration ?? "JavaScript resource" };
    case "leanReference":
      return { kind: "opaque", name: declaration ?? "LeanObject" };
    default:
      return { kind: "opaque", name: declaration ?? nativeType?.tag ?? "unknown" };
  }
}

function variantFields(pair, caseView, caseIndex, bindings) {
  const nested = [pair, ...bindings];
  if (caseView.payload === "none") return {};
  if (caseView.payload === "value") {
    const child = pairAtPath(pair.native, [0], caseIndex, caseView.value, nested);
    return {
      value: leanShape(child.pair, child.bindings),
    };
  }
  return Object.fromEntries(caseView.fields.map((field) => [
    field.key,
    (() => {
      const child = pairAtPath(pair.native, field.path, caseIndex, field.value, nested);
      return leanShape(child.pair, child.bindings);
    })(),
  ]));
}

function resolvePairReference(pair, bindings) {
  const ref = pair?.native?.ref;
  if (ref !== undefined) return bindings[ref] ?? null;
  return bindings[0] ?? null;
}

function nativeFieldAtPath(native, path, firstConstructor, bindings) {
  let current = resolveNative(native, bindings);
  let owners = bindings;
  for (const [position, fieldIndex] of path.entries()) {
    const constructorIndex = position === 0 ? firstConstructor : 0;
    const field = current?.metadata?.constructors?.[constructorIndex]?.fields?.[fieldIndex];
    if (field === undefined) return null;
    if (position === path.length - 1) return { native: field.type, bindings: owners };
    current = resolveNative(field.type, owners);
    if (current === null) return null;
    owners = [current, ...owners];
  }
  return path.length === 0 ? { native: current, bindings: owners } : null;
}

function pairAtPath(native, path, constructorIndex, value, bindings) {
  const field = nativeFieldAtPath(native, path, constructorIndex, bindings);
  return {
    pair: { native: field?.native ?? null, value },
    bindings: field?.bindings ?? bindings,
  };
}

function resolveNative(native, bindings) {
  return native?.ref === undefined ? native : bindings[native.ref]?.native ?? null;
}

function nativePrimitiveName(type) {
  switch (type?.tag) {
    case "nat": return "Nat";
    case "int": return "Int";
    case "string": return "String";
    case "byteArray": return "ByteArray";
    case "unsigned":
      return ({ 8: "UInt8", 16: "UInt16", 32: "UInt32", 64: "UInt64", usize: "USize" })[type.width] ?? "UInt";
    case "float": return type.width === 32 ? "Float32" : "Float";
    default: return type?.tag ?? "unknown";
  }
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
  const shapeComparison = compareShapes(
    leanDescriptor.shape,
    tsSymbol.shape,
    tsSymbols,
    new Set(),
  );
  if (tsSymbol.optional === true) {
    return anchorResult(
      anchor,
      "weak",
      [
        diagnostic(
          "typescript_optional_property_not_represented",
          "The structural comparison does not represent TypeScript optional-property undefined semantics",
        ),
        ...shapeComparison.diagnostics,
      ],
      leanDescriptor,
      tsSymbol,
    );
  }
  return anchorResult(
    anchor,
    shapeComparison.status,
    shapeComparison.diagnostics,
    leanDescriptor,
    tsSymbol,
  );
}

function anchorResult(anchor, status, diagnostics, leanDescriptor, tsSymbol) {
  const relation = anchor.relation ?? "audit";
  const reviewedDiagnostics = diagnostics.map((item) => ({
    ...item,
    severity: item.severity ?? diagnosticSeverity(status, relation),
  }));
  return {
    id: typeScriptAnchorId(anchor),
    lean: anchor.lean,
    ts: anchor.ts,
    status,
    relation,
    notes: reviewedDiagnostics.map((item) => item.message),
    diagnostics: reviewedDiagnostics,
    ...(anchor.note ? { note: anchor.note } : {}),
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

function compareShapes(lean, tsShape, tsSymbols, seen) {
  const ts = resolveTsRef(tsShape, tsSymbols, seen);
  if (lean?.kind === "primitive" && ts?.kind === "union") {
    return comparePrimitiveUnion(lean, ts, tsSymbols, seen);
  }
  if (ts?.kind === "union") {
    return compareTypeScriptUnion(lean, ts, tsSymbols, seen);
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
  if (ts?.kind === "opaque" && ts.abstract === true) {
    return comparison("weak", [
      diagnostic(
        "typescript_dependency_abstract",
        `TypeScript dependency ${ts.name} is intentionally abstract: ${ts.reason ?? "reviewed policy"}`,
      ),
    ]);
  }
  if (lean?.kind === "primitive" && ts?.kind === "primitive") {
    return comparePrimitives(lean.name, ts.name);
  }
  if (lean?.kind === "resource" && ts?.kind === "resource") {
    return suffixEqual(lean.name, ts.name)
      ? comparison("exact")
      : comparison("weak", [
        diagnostic("resource_name_mismatch", `resource names differ: ${lean.name} vs ${ts.name}`),
      ]);
  }
  if (lean?.kind !== ts?.kind) {
    return comparison("weak", [
      diagnostic("descriptor_kind_mismatch", `kind differs: Lean ${lean?.kind ?? "?"} vs TypeScript ${ts?.kind ?? "?"}`),
    ]);
  }
  switch (lean.kind) {
    case "array":
      return compareShapes(lean.element, ts.element, tsSymbols, seen);
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

function compareTypeScriptUnion(lean, ts, tsSymbols, seen) {
  const results = ts.options.map((option) => compareShapes(lean, option, tsSymbols, new Set(seen)));
  const compatible = results.filter((result) =>
    result.status === "exact" || result.status === "compatible");
  const best = results.reduce((candidate, result) =>
    statusRank[result.status] < statusRank[candidate.status] ? result : candidate);
  if (compatible.length === results.length) {
    return comparison("compatible", [
      diagnostic(
        "typescript_union_compatible",
        "Lean descriptor covers all TypeScript union arms compatibly",
        "info",
      ),
      ...best.diagnostics,
    ]);
  }
  if (compatible.length !== 0) {
    return comparison("weak", [
      diagnostic(
        "typescript_union_partially_covered",
        `Lean descriptor covers ${compatible.length} of ${results.length} TypeScript union arms`,
      ),
    ]);
  }
  return comparison("weak", [
    diagnostic("typescript_union_mismatch", "Lean descriptor does not match any TypeScript union arm"),
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
