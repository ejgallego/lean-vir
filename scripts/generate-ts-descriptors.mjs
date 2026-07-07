#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile, writeFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function usage() {
  console.error(`usage: node scripts/generate-ts-descriptors.mjs [options] <file.ts|file.d.ts>...

Generate Lean VIR TypeScript descriptor JSON from TypeScript declarations.

Options:
  --anchors FILE  Merge explicit Lean-to-TS anchors from JSON.
  --namespace NS  Treat a declared namespace as an exported descriptor root.
  --symbol ID     Keep only this TypeScript symbol id. Repeatable.
  --symbols FILE  Keep TypeScript symbol ids listed in FILE.
  --provenance FILE
                  Merge descriptor provenance metadata from JSON.
  --out FILE      Write descriptor JSON to FILE. Defaults to stdout.
  --check         Compare generated output with --out instead of writing it.
  -h, --help      Show this help.
`);
}

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const files = [];
  let anchors = null;
  let provenance = null;
  let out = null;
  let check = false;
  const namespaces = new Set();
  const symbols = new Set();
  const symbolFiles = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case "-h":
      case "--help":
        usage();
        process.exit(0);
      case "--anchors":
        anchors = argv[index + 1];
        if (!anchors || anchors.startsWith("--")) fail("--anchors requires a file");
        index += 1;
        break;
      case "--namespace":
        namespaces.add(requiredValue(argv, ++index, "--namespace"));
        break;
      case "--symbol":
        symbols.add(requiredValue(argv, ++index, "--symbol"));
        break;
      case "--symbols":
        symbolFiles.push(resolve(root, requiredValue(argv, ++index, "--symbols")));
        break;
      case "--provenance":
        provenance = requiredValue(argv, ++index, "--provenance");
        break;
      case "--out":
        out = argv[index + 1];
        if (!out || out.startsWith("--")) fail("--out requires a file");
        index += 1;
        break;
      case "--check":
        check = true;
        break;
      default:
        if (arg.startsWith("--")) fail(`unknown option ${arg}`);
        files.push(arg);
        break;
    }
  }
  if (files.length === 0) fail("at least one TypeScript declaration file is required");
  if (check && out === null) fail("--check requires --out");
  return {
    files: files.map((file) => resolve(root, file)),
    anchors: anchors === null ? null : resolve(root, anchors),
    provenance: provenance === null ? null : resolve(root, provenance),
    out: out === null ? null : resolve(root, out),
    check,
    namespaces,
    symbols,
    symbolFiles,
  };
}

function requiredValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) fail(`${option} requires a value`);
  return value;
}

const cli = parseArgs(process.argv.slice(2));
const descriptor = await generateDescriptorFile(cli);
const text = `${JSON.stringify(descriptor, null, 2)}\n`;

if (cli.out === null) {
  process.stdout.write(text);
} else if (cli.check) {
  const existing = await readFile(cli.out, "utf8");
  if (existing.replace(/\r\n/g, "\n") !== text) {
    fail(`${relative(root, cli.out)} is stale; run npm run generate:type-descriptors`);
  }
  console.log(`validated ${relative(root, cli.out)}`);
} else {
  await writeFile(cli.out, text);
  console.log(`wrote ${relative(root, cli.out)} (${descriptor.symbols.length} symbols)`);
}

async function generateDescriptorFile({ files, anchors, provenance, namespaces, symbols: requestedSymbols, symbolFiles }) {
  const symbolFilter = new Set(requestedSymbols);
  for (const file of symbolFiles) {
    for (const id of await readSymbolIds(file)) symbolFilter.add(id);
  }
  const fileSet = new Set(files.map((file) => resolve(file)));
  const program = ts.createProgram(files, {
    allowJs: false,
    declaration: true,
    emitDeclarationOnly: true,
    noEmit: true,
    skipLibCheck: true,
    strict: false,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
  });
  const sourceFiles = program.getSourceFiles()
    .filter((sourceFile) => fileSet.has(resolve(sourceFile.fileName)));
  const symbols = [];
  const symbolIds = new Set();
  const allowDuplicateIds = namespaces.size !== 0 || symbolFilter.size !== 0;
  for (const sourceFile of sourceFiles) {
    collectStatements(sourceFile.statements, sourceFile, [], symbols, symbolIds, namespaces, allowDuplicateIds);
  }
  let selectedSymbols = symbols;
  if (symbolFilter.size !== 0) {
    selectedSymbols = symbols.filter((symbol) => symbolFilter.has(symbol.id));
    const found = new Set(selectedSymbols.map((symbol) => symbol.id));
    for (const id of symbolFilter) {
      if (!found.has(id)) throw new Error(`requested TypeScript symbol was not found: ${id}`);
    }
  }
  selectedSymbols.sort((left, right) => left.id.localeCompare(right.id));
  const selectedSymbolIds = new Set(selectedSymbols.map((symbol) => symbol.id));
  const anchorData = anchors === null ? { version: 1, anchors: [] } : JSON.parse(await readFile(anchors, "utf8"));
  validateAnchors(anchorData, selectedSymbolIds);
  const provenanceData = provenance === null ? null : JSON.parse(await readFile(provenance, "utf8"));
  const descriptor = {
    version: 1,
    generator: "scripts/generate-ts-descriptors.mjs",
    sources: sourceFiles.map((sourceFile) => relative(root, sourceFile.fileName)).sort(),
    symbols: selectedSymbols,
    anchors: anchorData.anchors ?? [],
  };
  if (provenanceData !== null) descriptor.provenance = provenanceData;
  return descriptor;
}

function collectStatements(statements, sourceFile, prefix, symbols, symbolIds, namespaces, allowDuplicateIds) {
  for (const statement of statements) {
    if (ts.isModuleDeclaration(statement) &&
        (hasExportModifier(statement) ||
         namespaceIsRequested(statement, prefix, namespaces) ||
         isInsideRequestedNamespace(prefix, namespaces))) {
      const name = moduleDeclarationName(statement);
      if (name !== null && statement.body && ts.isModuleBlock(statement.body)) {
        collectStatements(statement.body.statements, sourceFile, [...prefix, name], symbols, symbolIds, namespaces, allowDuplicateIds);
      }
      continue;
    }
    if (!hasExportModifier(statement) && !isInsideRequestedNamespace(prefix, namespaces)) continue;
    const symbol = symbolForStatement(statement, sourceFile, prefix);
    if (symbol === null) continue;
    if (symbolIds.has(symbol.id)) {
      if (allowDuplicateIds) continue;
      throw new Error(`duplicate TypeScript descriptor id ${symbol.id}`);
    }
    symbolIds.add(symbol.id);
    symbols.push(symbol);
  }
}

async function readSymbolIds(file) {
  return (await readFile(file, "utf8"))
    .split(/\r?\n/g)
    .map((line) => line.replace(/#.*/u, "").trim())
    .filter((line) => line.length !== 0);
}

function symbolForStatement(statement, sourceFile, prefix) {
  if (ts.isInterfaceDeclaration(statement)) {
    return declarationSymbol(statement, sourceFile, prefix, statement.name.text, "interface",
      interfaceShape(statement, sourceFile, prefix));
  }
  if (ts.isTypeAliasDeclaration(statement)) {
    return declarationSymbol(statement, sourceFile, prefix, statement.name.text, "type",
      normalizeTypeNode(statement.type, sourceFile, prefix));
  }
  if (ts.isFunctionDeclaration(statement) && statement.name) {
    return declarationSymbol(statement, sourceFile, prefix, statement.name.text, "function",
      functionShape(statement.parameters, statement.type, sourceFile, prefix));
  }
  if (ts.isEnumDeclaration(statement)) {
    return declarationSymbol(statement, sourceFile, prefix, statement.name.text, "enum",
      enumShape(statement));
  }
  return null;
}

function declarationSymbol(node, sourceFile, prefix, name, kind, shape) {
  const id = [...prefix, name].join(".");
  const source = sourceRange(node, sourceFile);
  return {
    id,
    kind,
    source,
    display: compactDisplay(node.getText(sourceFile)),
    hover: jsDocText(node),
    shape,
  };
}

function interfaceShape(node, sourceFile, prefix) {
  const fields = {};
  for (const member of node.members) {
    if (!ts.isPropertySignature(member) || member.type === undefined) continue;
    const name = propertyNameText(member.name);
    if (name === null) continue;
    fields[name] = normalizeTypeNode(member.type, sourceFile, prefix);
  }
  if (Object.keys(fields).length === 1 &&
      fields.__resource?.kind === "literal" &&
      typeof fields.__resource.value === "string") {
    return { kind: "resource", name: [...prefix, node.name.text].join(".") };
  }
  return { kind: "record", fields };
}

function enumShape(node) {
  return {
    kind: "enum",
    cases: node.members.map((member) => propertyNameText(member.name)).filter((name) => name !== null),
  };
}

function functionShape(parameters, returnType, sourceFile, prefix) {
  const effectResult = effectResultShape(returnType, sourceFile, prefix);
  return {
    kind: "function",
    effect: effectResult.effect,
    args: parameters.map((parameter, index) => ({
      name: parameterName(parameter.name, index + 1),
      type: parameter.type === undefined
        ? { kind: "opaque", name: "unknown" }
        : normalizeTypeNode(parameter.type, sourceFile, prefix),
    })),
    result: effectResult.result,
  };
}

function normalizeTypeNode(node, sourceFile, prefix) {
  if (node === undefined) return { kind: "primitive", name: "void" };
  switch (node.kind) {
    case ts.SyntaxKind.StringKeyword:
      return { kind: "primitive", name: "string" };
    case ts.SyntaxKind.NumberKeyword:
      return { kind: "primitive", name: "number" };
    case ts.SyntaxKind.BigIntKeyword:
      return { kind: "primitive", name: "bigint" };
    case ts.SyntaxKind.BooleanKeyword:
      return { kind: "primitive", name: "boolean" };
    case ts.SyntaxKind.VoidKeyword:
      return { kind: "primitive", name: "void" };
    case ts.SyntaxKind.UndefinedKeyword:
      return { kind: "primitive", name: "undefined" };
    case ts.SyntaxKind.NullKeyword:
      return { kind: "primitive", name: "null" };
    case ts.SyntaxKind.AnyKeyword:
    case ts.SyntaxKind.UnknownKeyword:
      return { kind: "opaque", name: node.getText(sourceFile) };
    default:
      break;
  }
  if (ts.isArrayTypeNode(node)) {
    return { kind: "array", element: normalizeTypeNode(node.elementType, sourceFile, prefix) };
  }
  if (ts.isTupleTypeNode(node)) {
    return { kind: "tuple", elements: node.elements.map((element) => normalizeTypeNode(element, sourceFile, prefix)) };
  }
  if (ts.isTypeLiteralNode(node)) {
    return typeLiteralShape(node, sourceFile, prefix);
  }
  if (ts.isFunctionTypeNode(node)) {
    return functionShape(node.parameters, node.type, sourceFile, prefix);
  }
  if (ts.isParenthesizedTypeNode(node)) {
    return normalizeTypeNode(node.type, sourceFile, prefix);
  }
  if (ts.isTypeOperatorNode(node)) {
    return normalizeTypeNode(node.type, sourceFile, prefix);
  }
  if (ts.isLiteralTypeNode(node)) {
    if (node.literal.kind === ts.SyntaxKind.NullKeyword) return { kind: "primitive", name: "null" };
    if (ts.isStringLiteral(node.literal)) return { kind: "literal", value: node.literal.text };
    if (ts.isNumericLiteral(node.literal)) return { kind: "literal", value: Number(node.literal.text) };
    if (node.literal.kind === ts.SyntaxKind.TrueKeyword) return { kind: "literal", value: true };
    if (node.literal.kind === ts.SyntaxKind.FalseKeyword) return { kind: "literal", value: false };
  }
  if (ts.isUnionTypeNode(node)) {
    return unionShape(node, sourceFile, prefix);
  }
  if (ts.isTypeReferenceNode(node)) {
    return typeReferenceShape(node, sourceFile, prefix);
  }
  return { kind: "opaque", name: node.getText(sourceFile) };
}

function typeLiteralShape(node, sourceFile, prefix) {
  const fields = {};
  for (const member of node.members) {
    if (!ts.isPropertySignature(member) || member.type === undefined) continue;
    const name = propertyNameText(member.name);
    if (name === null) continue;
    fields[name] = normalizeTypeNode(member.type, sourceFile, prefix);
  }
  return { kind: "record", fields };
}

function unionShape(node, sourceFile, prefix) {
  const types = node.types.map((type) => normalizeTypeNode(type, sourceFile, prefix));
  const nonNull = types.filter((type) => !(type.kind === "primitive" && (type.name === "null" || type.name === "undefined")));
  if (nonNull.length === 1 && nonNull.length !== types.length) {
    return { kind: "option", element: nonNull[0] };
  }
  if (types.every((type) => type.kind === "literal")) {
    return { kind: "enum", cases: types.map((type) => String(type.value)) };
  }
  const variant = variantUnionShape(types);
  if (variant !== null) return variant;
  return { kind: "union", options: types };
}

function variantUnionShape(types) {
  const constructors = {};
  for (const type of types) {
    if (type.kind !== "record") return null;
    const kind = type.fields.kind;
    if (kind?.kind !== "literal" || typeof kind.value !== "string") return null;
    const fields = { ...type.fields };
    delete fields.kind;
    constructors[kind.value] = { fields };
  }
  return { kind: "variant", constructors };
}

function typeReferenceShape(node, sourceFile, prefix) {
  const name = node.typeName.getText(sourceFile);
  const args = node.typeArguments?.map((arg) => normalizeTypeNode(arg, sourceFile, prefix)) ?? [];
  if ((name === "Array" || name === "ReadonlyArray") && args.length === 1) {
    return { kind: "array", element: args[0] };
  }
  if ((name === "LeanVir.Js" || name === "Js" || name.endsWith(".Js")) && args.length === 1) {
    return { kind: "resource", name: descriptorName(args[0]), value: args[0] };
  }
  const effect = effectName(name);
  if (effect !== null && args.length === 1) {
    return { kind: "effect", effect, result: args[0] };
  }
  return {
    kind: "ref",
    id: resolveReferenceId(name, prefix),
    ...(args.length === 0 ? {} : { args }),
  };
}

function effectResultShape(node, sourceFile, prefix) {
  const result = normalizeTypeNode(node, sourceFile, prefix);
  if (result.kind === "effect") {
    return { effect: result.effect, result: result.result };
  }
  return { effect: "pure", result };
}

function effectName(name) {
  if (name === "LeanVir.RuntimeEffect" || name === "RuntimeEffect" || name.endsWith(".RuntimeEffect")) return "runtime";
  if (name === "LeanVir.IOEffect" || name === "IOEffect" || name.endsWith(".IOEffect")) return "io";
  if (name === "LeanVir.DomEffect" || name === "DomEffect" || name.endsWith(".DomEffect")) return "dom";
  if (name === "LeanVir.ReactEffect" || name === "ReactEffect" || name.endsWith(".ReactEffect")) return "react";
  return null;
}

function resolveReferenceId(name, prefix) {
  if (name.includes(".")) return name;
  for (let size = prefix.length; size >= 0; size -= 1) {
    const candidate = [...prefix.slice(0, size), name].join(".");
    if (candidate !== "") return candidate;
  }
  return name;
}

function descriptorName(shape) {
  if (shape.kind === "ref") return shape.id;
  if (shape.kind === "primitive") return shape.name;
  if (shape.kind === "literal") return String(shape.value);
  return shape.kind;
}

function sourceRange(node, sourceFile) {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile, false));
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd());
  const path = relative(root, sourceFile.fileName);
  return {
    path,
    startLine: start.line + 1,
    startColumn: start.character + 1,
    endLine: end.line + 1,
    endColumn: end.character + 1,
  };
}

function compactDisplay(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

function jsDocText(node) {
  const docs = node.jsDoc ?? [];
  return docs
    .map((doc) => typeof doc.comment === "string" ? doc.comment.trim() : "")
    .filter(Boolean)
    .join("\n\n");
}

function hasExportModifier(node) {
  return node.modifiers?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false;
}

function moduleDeclarationName(node) {
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name)) return node.name.text;
  return null;
}

function namespaceIsRequested(node, prefix, namespaces) {
  const name = moduleDeclarationName(node);
  if (name === null) return false;
  return namespaces.has([...prefix, name].join("."));
}

function isInsideRequestedNamespace(prefix, namespaces) {
  const current = prefix.join(".");
  for (const namespace of namespaces) {
    if (current === namespace || current.startsWith(`${namespace}.`)) return true;
  }
  return false;
}

function propertyNameText(name) {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function parameterName(name, fallback) {
  if (ts.isIdentifier(name)) return name.text;
  return `arg${fallback}`;
}

function validateAnchors(anchorData, symbolIds) {
  if (anchorData.version !== 1 || !Array.isArray(anchorData.anchors)) {
    throw new Error("anchor file must be { version: 1, anchors: [...] }");
  }
  const ids = new Set();
  for (const [index, anchor] of anchorData.anchors.entries()) {
    if (typeof anchor.lean !== "string" || anchor.lean.length === 0) {
      throw new Error(`anchors[${index}].lean must be a non-empty string`);
    }
    if (typeof anchor.ts !== "string" || anchor.ts.length === 0) {
      throw new Error(`anchors[${index}].ts must be a non-empty string`);
    }
    if (!symbolIds.has(anchor.ts)) {
      throw new Error(`anchors[${index}].ts references missing TypeScript symbol ${anchor.ts}`);
    }
    const id = anchor.id ?? `${anchor.lean} -> ${anchor.ts}`;
    if (ids.has(id)) throw new Error(`duplicate anchor id ${id}`);
    ids.add(id);
  }
}
