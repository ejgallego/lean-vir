#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import ts from "typescript";
import { emitGeneratedFile, fail, requiredValue } from "./tool-utils.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

function usage() {
  console.error(`usage: node scripts/bindings/generate-ts-descriptors.mjs [options] <file.ts|file.d.ts>...

Generate Lean VIR TypeScript descriptor JSON from TypeScript declarations.

Options:
  --api-group FILE#ID
                  Load entry points, policy, and anchors from a configured API group.
  --anchors FILE  Merge explicit Lean-to-TS anchors from JSON.
  --symbol ID     Keep only this TypeScript symbol id. Repeatable.
  --symbols FILE  Keep TypeScript symbol ids listed in FILE.
  --dependency-depth N
                  Include referenced descriptors up to N edges away.
  --dependency-policy FILE
                  Supply reviewed descriptors for external dependencies.
  --source-url URL
                  Link symbols to this single declaration file URL.
  --out FILE      Write descriptor JSON to FILE. Defaults to stdout.
  --check         Compare generated output with --out instead of writing it.
  -h, --help      Show this help.
`);
}

function parseArgs(argv) {
  const files = [];
  let bindingRoot = null;
  let anchors = null;
  let out = null;
  let check = false;
  let sourceUrl = null;
  let dependencyDepth = 0;
  let dependencyPolicy = null;
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
      case "--api-group":
      case "--binding-root":
        bindingRoot = requiredValue(argv, ++index, arg);
        break;
      case "--symbol":
        symbols.add(requiredValue(argv, ++index, "--symbol"));
        break;
      case "--symbols":
        symbolFiles.push(resolve(root, requiredValue(argv, ++index, "--symbols")));
        break;
      case "--dependency-depth":
        dependencyDepth = Number(requiredValue(argv, ++index, "--dependency-depth"));
        if (!Number.isInteger(dependencyDepth) || dependencyDepth < 0) {
          fail("--dependency-depth must be a non-negative integer");
        }
        break;
      case "--dependency-policy":
        dependencyPolicy = resolve(root, requiredValue(argv, ++index, "--dependency-policy"));
        break;
      case "--source-url":
        sourceUrl = requiredValue(argv, ++index, "--source-url");
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
  if (files.length === 0 && bindingRoot === null) {
    fail("at least one TypeScript declaration file or --api-group is required");
  }
  if (bindingRoot !== null &&
      (files.length !== 0 || anchors !== null || symbols.size !== 0 || symbolFiles.length !== 0 ||
       sourceUrl !== null || dependencyDepth !== 0 || dependencyPolicy !== null)) {
    fail("--api-group supplies declarations, entry points, policy, and anchors; do not pass those options separately");
  }
  if (check && out === null) fail("--check requires --out");
  if (sourceUrl !== null && files.length !== 1) fail("--source-url requires exactly one declaration file");
  return {
    files: files.map((file) => resolve(root, file)),
    bindingRoot,
    anchors: anchors === null ? null : resolve(root, anchors),
    anchorsData: null,
    out: out === null ? null : resolve(root, out),
    check,
    symbols,
    symbolFiles,
    sourceUrl,
    dependencyDepth,
    dependencyPolicy,
    dependencyPolicyData: null,
  };
}

export async function runTypeScriptDescriptorsCli(argv) {
  const cli = await resolveBindingRoot(parseArgs(argv));
  const descriptor = await generateDescriptorFile(cli);
  const text = `${JSON.stringify(descriptor, null, 2)}\n`;

  if (cli.out === null) {
    process.stdout.write(text);
  } else {
    const action = await emitGeneratedFile(cli.out, text, {
      check: cli.check,
      root,
      staleHint: "rerun the corresponding generation step without --check",
    });
    console.log(`${action} ${relative(root, cli.out)} (${descriptor.symbols.length} symbols)`);
  }
}

export async function generateDescriptorFile({
  files,
  anchors,
  anchorsData,
  symbols: requestedSymbols,
  symbolFiles,
  sourceUrl,
  dependencyDepth,
  dependencyPolicy,
  dependencyPolicyData,
}) {
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
  const symbolsById = new Map();
  for (const sourceFile of sourceFiles) {
    collectStatements(sourceFile.statements, sourceFile, [], symbols, symbolsById);
  }
  const availableSymbols = sourceUrl === null
    ? symbols
    : symbols.map((symbol) => ({
      ...symbol,
      source: { ...symbol.source, url: sourceUrl },
    }));
  const requestedRoots = symbolFilter.size === 0
    ? availableSymbols
    : availableSymbols.filter((symbol) => symbolFilter.has(symbol.id));
  const found = new Set(requestedRoots.map((symbol) => symbol.id));
  for (const id of symbolFilter) {
    if (!found.has(id)) throw new Error(`requested TypeScript symbol was not found: ${id}`);
  }
  const rootSymbols = symbolFilter.size === 0
    ? availableSymbols
    : expandInterfaceSurfaces(requestedRoots, availableSymbols);
  const policy = dependencyPolicyData !== null
    ? validateDependencyPolicy({ version: 1, symbols: dependencyPolicyData }, "API group dependency policy")
    : dependencyPolicy === null ? new Map() : await readDependencyPolicy(dependencyPolicy);
  const closure = dependencyClosure(rootSymbols, availableSymbols, policy, dependencyDepth);
  const selectedSymbols = closure.symbols;
  selectedSymbols.sort((left, right) => left.id.localeCompare(right.id));
  const selectedSymbolIds = new Set(selectedSymbols.map((symbol) => symbol.id));
  const anchorData = anchorsData ??
    (anchors === null ? { version: 1, anchors: [] } : JSON.parse(await readFile(anchors, "utf8")));
  validateAnchors(anchorData, selectedSymbolIds);
  const descriptor = {
    version: 1,
    generator: "scripts/bindings/generate-ts-descriptors.mjs",
    sources: sourceFiles.map((sourceFile) => relative(root, sourceFile.fileName)).sort(),
    symbols: selectedSymbols,
    anchors: anchorData.anchors ?? [],
  };
  if (dependencyDepth !== 0 || dependencyPolicy !== null) {
    descriptor.dependencies = {
      depth: dependencyDepth,
      roots: (symbolFilter.size === 0 ? rootSymbols.map((symbol) => symbol.id) : [...symbolFilter]).sort(),
      included: closure.included.sort((left, right) => left.id.localeCompare(right.id)),
      unresolved: [...closure.unresolved].sort(),
    };
  }
  return descriptor;
}

async function resolveBindingRoot(options) {
  if (options.bindingRoot === null) return options;
  const separator = options.bindingRoot.lastIndexOf("#");
  if (separator <= 0 || separator === options.bindingRoot.length - 1) {
    fail("--api-group must use FILE#ID syntax");
  }
  const configPath = resolve(root, options.bindingRoot.slice(0, separator));
  const rootId = options.bindingRoot.slice(separator + 1);
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (config?.version !== 1 || !Array.isArray(config.roots)) {
    fail(`${relative(root, configPath)} is not a binding-library v1 configuration`);
  }
  const binding = config.roots.find((entry) => entry?.id === rootId);
  if (binding === undefined) fail(`${relative(root, configPath)} has no API group ${rootId}`);
  const upstream = binding.upstream;
  if (upstream?.kind !== "typescript" || !Array.isArray(upstream.declarations) ||
      !Array.isArray(upstream.roots)) {
    fail(`API group ${config.id}/${rootId} does not define a TypeScript declaration surface`);
  }
  if (upstream.sourceUrl !== undefined && upstream.declarations.length !== 1) {
    fail(`API group ${config.id}/${rootId} sourceUrl requires exactly one declaration file`);
  }
  return {
    ...options,
    files: upstream.declarations.map((file) => resolve(root, file)),
    anchorsData: { version: 1, anchors: binding.anchors ?? [] },
    symbols: new Set(upstream.roots),
    sourceUrl: upstream.sourceUrl ?? null,
    dependencyDepth: upstream.dependencyDepth ?? 0,
    dependencyPolicyData: upstream.dependencyPolicy ?? null,
  };
}

async function readSymbolIds(file) {
  return (await readFile(file, "utf8"))
    .split(/\r?\n/gu)
    .map((line) => line.replace(/#.*/u, "").trim())
    .filter((line) => line.length !== 0);
}

async function readDependencyPolicy(file) {
  const value = JSON.parse(await readFile(file, "utf8"));
  return validateDependencyPolicy(value, "dependency policy");
}

function validateDependencyPolicy(value, label) {
  if (value?.version !== 1 || !Array.isArray(value.symbols)) {
    throw new Error(`${label} must be { version: 1, symbols: [...] }`);
  }
  const symbols = new Map();
  for (const [index, entry] of value.symbols.entries()) {
    if (typeof entry?.id !== "string" || entry.id.length === 0) {
      throw new Error(`dependency policy symbols[${index}].id must be a non-empty string`);
    }
    if (entry.shape === null || typeof entry.shape !== "object" || Array.isArray(entry.shape)) {
      throw new Error(`dependency policy symbols[${index}].shape must be an object`);
    }
    if (symbols.has(entry.id)) throw new Error(`duplicate dependency policy symbol ${entry.id}`);
    symbols.set(entry.id, entry);
  }
  return symbols;
}

function dependencyClosure(rootSymbols, availableSymbols, policy, depth) {
  const available = new Map(availableSymbols.map((symbol) => [symbol.id, symbol]));
  const selected = new Map(rootSymbols.map((symbol) => [symbol.id, symbol]));
  const included = [];
  const unresolved = new Set();
  let frontier = rootSymbols;
  for (let level = 1; level <= depth && frontier.length !== 0; level += 1) {
    const references = new Set(frontier.flatMap((symbol) => shapeReferences(symbol.shape)));
    const next = [];
    for (const id of references) {
      if (selected.has(id)) continue;
      const declaration = available.get(id);
      if (declaration !== undefined) {
        const symbol = {
          ...declaration,
          dependency: { kind: "declaration", depth: level },
        };
        selected.set(id, symbol);
        included.push({ id, kind: "declaration", depth: level });
        next.push(symbol);
        continue;
      }
      const reviewed = policy.get(id);
      if (reviewed !== undefined) {
        const symbol = policySymbol(reviewed, level);
        selected.set(id, symbol);
        included.push({ id, kind: "policy", depth: level, ...(reviewed.reason ? { reason: reviewed.reason } : {}) });
        next.push(symbol);
        continue;
      }
      unresolved.add(id);
    }
    frontier = next;
  }
  return { symbols: [...selected.values()], included, unresolved };
}

function policySymbol(entry, depth) {
  return {
    id: entry.id,
    kind: "policy",
    ...(entry.source ? { source: entry.source } : {}),
    display: entry.display ?? `reviewed dependency policy: ${entry.id}`,
    hover: entry.reason ?? "",
    shape: entry.shape,
    dependency: {
      kind: "policy",
      depth,
      ...(entry.reason ? { reason: entry.reason } : {}),
    },
  };
}

function shapeReferences(shape) {
  if (shape === null || typeof shape !== "object") return [];
  switch (shape.kind) {
    case "ref":
      return [shape.id, ...(shape.args ?? []).flatMap(shapeReferences)];
    case "array":
    case "option":
    case "effect":
      return shapeReferences(shape.element ?? shape.result);
    case "tuple":
      return (shape.elements ?? []).flatMap(shapeReferences);
    case "union":
      return (shape.options ?? []).flatMap(shapeReferences);
    case "record":
      return Object.values(shape.fields ?? {}).flatMap(shapeReferences);
    case "variant":
      return Object.values(shape.constructors ?? {}).flatMap((ctor) =>
        Object.values(ctor.fields ?? {}).flatMap(shapeReferences));
    case "function":
      return [
        ...(shape.args ?? []).flatMap((arg) => shapeReferences(arg.type)),
        ...shapeReferences(shape.result),
      ];
    default:
      return [];
  }
}

function expandInterfaceSurfaces(requestedRoots, availableSymbols) {
  const available = new Map(availableSymbols.map((symbol) => [symbol.id, symbol]));
  const membersByOwner = new Map();
  for (const symbol of availableSymbols) {
    if (symbol.owner === undefined) continue;
    const members = membersByOwner.get(symbol.owner) ?? [];
    members.push(symbol);
    membersByOwner.set(symbol.owner, members);
  }
  const selected = new Map(requestedRoots.map((symbol) => [symbol.id, symbol]));
  for (const surface of requestedRoots.filter((symbol) => symbol.kind === "interface")) {
    const owners = interfaceHierarchy(surface.id, available, new Set());
    for (const owner of owners) {
      for (const member of membersByOwner.get(owner) ?? []) {
        const memberName = member.id.slice(owner.length + 1);
        const id = `${surface.id}.${memberName}`;
        if (selected.has(id)) continue;
        selected.set(id, {
          ...member,
          id,
          surfaceRoot: surface.id,
          ...(owner === surface.id ? {} : { inheritedFrom: owner, originalId: member.id }),
        });
      }
    }
  }
  return [...selected.values()];
}

function interfaceHierarchy(id, available, seen) {
  if (seen.has(id)) return [];
  seen.add(id);
  const symbol = available.get(id);
  if (symbol?.kind !== "interface") return [];
  return [id, ...(symbol.extends ?? []).flatMap((base) => interfaceHierarchy(base, available, seen))];
}

function collectStatements(statements, sourceFile, prefix, symbols, symbolsById) {
  for (const statement of statements) {
    const visible = hasExportModifier(statement) || sourceFile.isDeclarationFile;
    if (ts.isModuleDeclaration(statement) && visible) {
      const name = moduleDeclarationName(statement);
      if (name !== null && statement.body && ts.isModuleBlock(statement.body)) {
        collectStatements(statement.body.statements, sourceFile, [...prefix, name], symbols, symbolsById);
      }
      continue;
    }
    if (!visible) continue;
    for (const symbol of symbolsForStatement(statement, sourceFile, prefix)) {
      const existingIndex = symbolsById.get(symbol.id);
      if (existingIndex === undefined) {
        symbolsById.set(symbol.id, symbols.length);
        symbols.push(symbol);
      } else {
        symbols[existingIndex] = mergeDeclarationSymbols(symbols[existingIndex], symbol);
      }
    }
  }
}

function mergeDeclarationSymbols(left, right) {
  if (left.kind === "interface" && right.kind === "interface" &&
      left.shape.kind === "record" && right.shape.kind === "record") {
    return {
      ...left,
      display: `${left.display}\n${right.display}`,
      hover: left.hover || right.hover,
      shape: { ...left.shape, fields: { ...left.shape.fields, ...right.shape.fields } },
    };
  }
  if (["function", "method"].includes(left.kind) && left.kind === right.kind) {
    const options = left.shape.kind === "union" ? [...left.shape.options] : [left.shape];
    options.push(...(right.shape.kind === "union" ? right.shape.options : [right.shape]));
    return {
      ...left,
      display: `${left.display}\n${right.display}`,
      hover: left.hover || right.hover,
      shape: { kind: "union", options },
    };
  }
  if (left.kind === "property" && right.kind === "property") {
    const sameShape = JSON.stringify(left.shape) === JSON.stringify(right.shape);
    return {
      ...left,
      display: `${left.display}\n${right.display}`,
      hover: left.hover || right.hover,
      shape: sameShape ? left.shape : { kind: "union", options: [left.shape, right.shape] },
      access: left.access === right.access ? left.access : "get-set",
    };
  }
  throw new Error(`duplicate TypeScript descriptor id ${left.id}`);
}

function symbolsForStatement(statement, sourceFile, prefix) {
  const symbol = symbolForStatement(statement, sourceFile, prefix);
  if (symbol === null) return [];
  return ts.isInterfaceDeclaration(statement)
    ? [symbol, ...interfaceMemberSymbols(statement, sourceFile, prefix)]
    : [symbol];
}

function symbolForStatement(statement, sourceFile, prefix) {
  if (ts.isInterfaceDeclaration(statement)) {
    return {
      ...declarationSymbol(statement, sourceFile, prefix, statement.name.text, "interface",
        interfaceShape(statement, sourceFile, prefix)),
      extends: interfaceHeritage(statement, sourceFile, prefix),
    };
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

function interfaceMemberSymbols(node, sourceFile, prefix) {
  const owner = [...prefix, node.name.text].join(".");
  const symbols = [];
  for (const member of node.members) {
    if (member.name === undefined) continue;
    const name = propertyNameText(member.name);
    if (name === null) continue;
    if (ts.isMethodSignature(member)) {
      symbols.push(memberSymbol(
        owner,
        name,
        "method",
        member,
        sourceFile,
        functionShape(member.parameters, member.type, sourceFile, prefix),
      ));
    } else if (ts.isPropertySignature(member) && member.type !== undefined) {
      symbols.push(memberSymbol(
        owner,
        name,
        "property",
        member,
        sourceFile,
        normalizeTypeNode(member.type, sourceFile, prefix),
        member.questionToken !== undefined ? { optional: true } : {},
      ));
    } else if (ts.isGetAccessorDeclaration(member) && member.type !== undefined) {
      symbols.push(memberSymbol(
        owner,
        name,
        "property",
        member,
        sourceFile,
        normalizeTypeNode(member.type, sourceFile, prefix),
        { access: "get" },
      ));
    } else if (ts.isSetAccessorDeclaration(member) && member.parameters[0]?.type !== undefined) {
      symbols.push(memberSymbol(
        owner,
        name,
        "property",
        member,
        sourceFile,
        normalizeTypeNode(member.parameters[0].type, sourceFile, prefix),
        { access: "set" },
      ));
    }
  }
  return symbols;
}

function memberSymbol(owner, name, kind, node, sourceFile, shape, extra = {}) {
  return {
    id: `${owner}.${name}`,
    owner,
    kind,
    source: sourceRange(node, sourceFile),
    display: compactDisplay(node.getText(sourceFile)),
    hover: jsDocText(node),
    shape,
    ...extra,
  };
}

function interfaceHeritage(node, sourceFile, prefix) {
  return (node.heritageClauses ?? [])
    .filter((clause) => clause.token === ts.SyntaxKind.ExtendsKeyword)
    .flatMap((clause) => clause.types.map((type) =>
      resolveReferenceId(type.expression.getText(sourceFile), prefix)));
}

function interfaceShape(node, sourceFile, prefix) {
  const fields = {};
  for (const member of node.members) {
    if (ts.isPropertySignature(member) && member.type !== undefined) {
      const name = propertyNameText(member.name);
      if (name === null) continue;
      fields[name] = normalizeTypeNode(member.type, sourceFile, prefix);
    } else if (ts.isMethodSignature(member)) {
      const name = propertyNameText(member.name);
      if (name === null) continue;
      fields[name] = functionShape(member.parameters, member.type, sourceFile, prefix);
    } else if (ts.isGetAccessorDeclaration(member) && member.type !== undefined) {
      const name = propertyNameText(member.name);
      if (name === null) continue;
      fields[name] = normalizeTypeNode(member.type, sourceFile, prefix);
    } else if (ts.isSetAccessorDeclaration(member) && member.parameters[0]?.type !== undefined) {
      const name = propertyNameText(member.name);
      if (name === null) continue;
      fields[name] = normalizeTypeNode(member.parameters[0].type, sourceFile, prefix);
    }
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
      ...(parameter.questionToken !== undefined || parameter.initializer !== undefined
        ? { optional: true }
        : {}),
      ...(parameter.dotDotDotToken !== undefined ? { rest: true } : {}),
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
    if (ts.isPropertySignature(member) && member.type !== undefined) {
      const name = propertyNameText(member.name);
      if (name === null) continue;
      fields[name] = normalizeTypeNode(member.type, sourceFile, prefix);
    } else if (ts.isMethodSignature(member)) {
      const name = propertyNameText(member.name);
      if (name === null) continue;
      fields[name] = functionShape(member.parameters, member.type, sourceFile, prefix);
    }
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
    if (anchor.relation !== undefined && !["audit", "coverageGap"].includes(anchor.relation)) {
      throw new Error(`anchors[${index}].relation must be audit or coverageGap`);
    }
    if (anchor.portIntent !== undefined &&
        (anchor.portIntent === null || typeof anchor.portIntent !== "object" || Array.isArray(anchor.portIntent))) {
      throw new Error(`anchors[${index}].portIntent must be an object`);
    }
    const id = anchor.id ?? `${anchor.lean} -> ${anchor.ts}`;
    if (ids.has(id)) throw new Error(`duplicate anchor id ${id}`);
    ids.add(id);
  }
}
