/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";

import { repositoryRoot } from "../repository-paths.mjs";
import { generateDescriptorFile } from "./typescript-descriptors.mjs";
import { emitGeneratedFile, fail, requiredValue } from "./tool-utils.mjs";

function usage() {
  console.error(`usage: node scripts/bindings/generate-lean-bindings.mjs --config FILE [--check]

Generate the configured faithful Lean host declarations from TypeScript declarations.

Options:
  --config FILE  Binding-library configuration containing a generation block.
  --check        Reject a missing or stale generated Lean file.
  -h, --help     Show this help.
`);
}

function parseArgs(argv) {
  let config = null;
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "-h" || option === "--help") {
      usage();
      process.exit(0);
    } else if (option === "--config") {
      config = resolve(repositoryRoot, requiredValue(argv, ++index, option));
    } else if (option === "--check") {
      check = true;
    } else {
      fail(`unknown option ${option}`);
    }
  }
  if (config === null) fail("--config is required");
  return { config, check };
}

function nonemptyString(value) {
  return typeof value === "string" && value.length !== 0;
}

function leanIdentifier(value, context) {
  if (!/^[A-Za-z_][A-Za-z0-9_']*$/u.test(value)) {
    throw new Error(`${context} is not a supported Lean identifier: ${JSON.stringify(value)}`);
  }
  return value;
}

function validateGenerationConfig(config, configPath) {
  const label = relative(repositoryRoot, configPath);
  const generation = config?.generation;
  if (config?.version !== 1 || !Array.isArray(config.roots) || generation === null ||
      typeof generation !== "object" || Array.isArray(generation) ||
      !nonemptyString(generation.output) || !nonemptyString(generation.namespace) ||
      !Array.isArray(generation.imports) || !generation.imports.every(nonemptyString) ||
      !Array.isArray(generation.members) || generation.members.length === 0 ||
      !generation.members.every(nonemptyString) ||
      generation.effects === null || typeof generation.effects !== "object" ||
      Array.isArray(generation.effects) ||
      generation.resources === null || typeof generation.resources !== "object" ||
      Array.isArray(generation.resources)) {
    throw new Error(`${label} does not define a valid Lean generation block`);
  }
  if (new Set(generation.members).size !== generation.members.length) {
    throw new Error(`${label} repeats a generated TypeScript member`);
  }
  if (!Object.values(generation.effects).every(nonemptyString) ||
      !Object.values(generation.resources).every(nonemptyString)) {
    throw new Error(`${label} generation effects and resources must map to Lean names`);
  }
  for (const name of generation.namespace.split(".")) leanIdentifier(name, `${label} generation namespace`);
  for (const imported of generation.imports) {
    for (const name of imported.split(".")) leanIdentifier(name, `${label} generated import`);
  }
  return generation;
}

function anchorFor(root, operation, member, accessor) {
  const anchor = (root.anchors ?? []).find((entry) => entry.id === operation.anchor);
  if (anchor === undefined) {
    throw new Error(`${member} ${accessor} references missing anchor ${operation.anchor}`);
  }
  const intent = anchor.portIntent;
  if (anchor.ts !== member || anchor.target !== operation.target ||
      anchor.relation !== "audit" || intent?.disposition !== "bind" ||
      intent.accessor !== accessor) {
    throw new Error(`${operation.anchor} is not a matching audited ${member} ${accessor}`);
  }
  return anchor;
}

function nullableResource(shape, generation, context) {
  const element = leanType(shape.element, generation, context);
  if (!element.resource || !element.lean.startsWith("Lean.Vir.Js ")) {
    throw new Error(`${context} nullable values require a JavaScript resource element`);
  }
  return {
    lean: `Lean.Vir.Js.Nullable ${element.lean.slice("Lean.Vir.Js ".length)}`,
    resource: true,
  };
}

export function leanType(shape, generation, context = "TypeScript shape") {
  if (shape?.kind === "primitive" && shape.name === "string") {
    return { lean: "Lean.Vir.Js String", resource: true };
  }
  if (shape?.kind === "primitive" && shape.name === "void") {
    return { lean: "Unit", resource: false };
  }
  if (shape?.kind === "option") return nullableResource(shape, generation, context);
  if (shape?.kind === "ref" && nonemptyString(generation.resources[shape.id])) {
    return { lean: `Lean.Vir.Js ${generation.resources[shape.id]}`, resource: true };
  }
  throw new Error(`${context} has unsupported faithful translation ${JSON.stringify(shape)}`);
}

function receiverArgument(member, anchor, generation) {
  const receiver = anchor.portIntent?.receiver;
  if (receiver === undefined) return [];
  if (receiver !== "borrowed") {
    throw new Error(`${anchor.id} has unsupported receiver policy ${JSON.stringify(receiver)}`);
  }
  const owner = member.slice(0, member.lastIndexOf("."));
  const resource = generation.resources[owner];
  if (!nonemptyString(resource)) {
    throw new Error(`${anchor.id} has no Lean resource mapping for receiver ${owner}`);
  }
  const ownerName = owner.slice(owner.lastIndexOf(".") + 1);
  const name = leanIdentifier(ownerName[0].toLowerCase() + ownerName.slice(1), `${anchor.id} receiver name`);
  return [{ name, type: `Lean.Vir.Js ${resource}`, borrowed: true }];
}

function operationName(operation, namespace) {
  const prefix = `${namespace}.`;
  if (!operation.lean.startsWith(prefix)) {
    throw new Error(`${operation.lean} is outside generated namespace ${namespace}`);
  }
  const relativeName = operation.lean.slice(prefix.length);
  const separator = relativeName.lastIndexOf(".");
  if (separator <= 0 || separator === relativeName.length - 1) {
    throw new Error(`${operation.lean} must name a declaration in a nested namespace`);
  }
  const nestedNamespace = relativeName.slice(0, separator);
  for (const part of nestedNamespace.split(".")) leanIdentifier(part, `${operation.lean} namespace`);
  return {
    namespace: nestedNamespace,
    name: leanIdentifier(relativeName.slice(separator + 1), `${operation.lean} declaration`),
  };
}

function renderSignature(name, args, effect, result, prefix) {
  const effectResult = result === "Unit" ? result : `(${result})`;
  if (args.length === 0) return `${prefix}${name} : ${effect} ${effectResult}`;
  return `${prefix}${name}\n${args.map((arg) =>
    `    (${arg.name} : ${arg.borrowed ? "@& " : ""}${arg.type})`).join("\n")} :\n    ${effect} ${effectResult}`;
}

function sourceReference(symbol) {
  const source = symbol.source;
  if (!source?.url) return source?.path ?? "the configured TypeScript declarations";
  return `${source.url}#L${source.startLine}`;
}

function renderOperation(member, symbol, accessor, operation, anchor, generation) {
  const shape = symbol.accessors?.[accessor];
  if (shape === undefined) {
    throw new Error(`${member} does not define a ${accessor} accessor type`);
  }
  const effect = generation.effects[anchor.portIntent.effect];
  if (!nonemptyString(effect)) {
    throw new Error(`${anchor.id} has no Lean effect mapping for ${anchor.portIntent.effect}`);
  }
  const receiver = receiverArgument(member, anchor, generation);
  const propertyName = leanIdentifier(
    member.slice(member.lastIndexOf(".") + 1),
    `${member} setter argument`,
  );
  let args = receiver;
  let result;
  if (accessor === "get") {
    result = leanType(shape, generation, `${member} getter`);
    if (result.resource && anchor.portIntent.resultRepresentation !== "hostResource") {
      throw new Error(`${anchor.id} must classify its resource result as hostResource`);
    }
  } else if (accessor === "set") {
    const value = leanType(shape, generation, `${member} setter`);
    const resourceArguments = anchor.portIntent.resourceArguments ?? [];
    if (value.resource && !resourceArguments.includes(0)) {
      throw new Error(`${anchor.id} must classify setter argument 0 as a resource`);
    }
    args = [...receiver, { name: propertyName, type: value.lean, borrowed: value.resource }];
    result = { lean: "Unit", resource: false };
  } else {
    throw new Error(`${member} has unsupported accessor ${accessor}`);
  }
  const leanName = operationName(operation, generation.namespace);
  const rawName = `${leanName.name}Js`;
  const call = [rawName, ...args.map((arg) => arg.name)].join(" ");
  const source = sourceReference(symbol);
  const accessorLabel = accessor === "get" ? "getter" : "setter";
  return {
    namespace: leanName.namespace,
    name: leanName.name,
    text: `/--\nGenerated faithful JavaScript boundary for the TypeScript \`${member}\` ${accessorLabel}.\nSource: ${source}\n\nThis declaration is generated; edit the TypeScript source or binding configuration.\n-/\n@[vir_js "${operation.target}"]\n${renderSignature(rawName, args, effect, result.lean, "private opaque ")}\n\n/-- Faithful generated ${accessorLabel} binding for TypeScript \`${member}\`. -/\n${renderSignature(leanName.name, args, effect, result.lean, "def ")} :=\n  ${call}`,
  };
}

export function renderLeanBindings(config, generation, descriptorsByRoot) {
  const mappings = new Map();
  for (const root of config.roots) {
    for (const mapping of root.mappings ?? []) {
      if (!generation.members.includes(mapping.typescript)) continue;
      if (mappings.has(mapping.typescript)) {
        throw new Error(`generated member ${mapping.typescript} is mapped by more than one API group`);
      }
      mappings.set(mapping.typescript, { root, mapping });
    }
  }
  const declarations = [];
  for (const member of [...generation.members].sort()) {
    const entry = mappings.get(member);
    if (entry === undefined) throw new Error(`generated member ${member} has no reviewed mapping`);
    if (entry.mapping.accessors === undefined) {
      throw new Error(`${member} is not a property accessor mapping; method generation is not supported yet`);
    }
    const descriptor = descriptorsByRoot.get(entry.root.id);
    const symbol = descriptor?.symbols.find((candidate) => candidate.id === member);
    if (symbol?.kind !== "property") throw new Error(`${member} is not a TypeScript property`);
    if (symbol.optional === true) {
      throw new Error(`${member} is optional; optional property generation is not supported yet`);
    }
    for (const accessor of ["get", "set"]) {
      const operation = entry.mapping.accessors[accessor];
      const accessorType = symbol.accessors?.[accessor];
      if (accessorType !== undefined && (operation === undefined || operation.missing === true)) {
        throw new Error(`${member} ${accessor} is part of the TypeScript surface but has no generated binding`);
      }
      if (accessorType === undefined && operation !== undefined && operation.missing !== true) {
        throw new Error(`${member} maps a ${accessor} operation absent from the TypeScript surface`);
      }
      if (operation === undefined || operation.missing === true) continue;
      const anchor = anchorFor(entry.root, operation, member, accessor);
      declarations.push(renderOperation(member, symbol, accessor, operation, anchor, generation));
    }
  }
  const byNamespace = new Map();
  for (const declaration of declarations) {
    const entries = byNamespace.get(declaration.namespace) ?? [];
    entries.push(declaration.text);
    byNamespace.set(declaration.namespace, entries);
  }
  const imports = [...generation.imports].sort().map((name) => `import ${name}`).join("\n");
  const bodies = [...byNamespace.entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([namespace, entries]) =>
      `namespace ${namespace}\n\n${entries.join("\n\n")}\n\nend ${namespace}`)
    .join("\n\n");
  return `/-\nCopyright (c) 2026 Lean FRO LLC. All rights reserved.\nReleased under Apache 2.0 license as described in the file LICENSE.\nAuthor: Emilio J. Gallego Arias\n-/\n\n-- Generated by scripts/bindings/generate-lean-bindings.mjs. Do not edit.\n\n${imports}\n\nnamespace ${generation.namespace}\n\n${bodies}\n\nend ${generation.namespace}\n`;
}

export async function generateLeanBindings(configPath) {
  const config = JSON.parse(await readFile(configPath, "utf8"));
  const generation = validateGenerationConfig(config, configPath);
  const requested = new Set(generation.members);
  const descriptorsByRoot = new Map();
  for (const root of config.roots) {
    if (!(root.mappings ?? []).some((mapping) => requested.has(mapping.typescript))) continue;
    const upstream = root.upstream;
    if (upstream?.kind !== "typescript") {
      throw new Error(`${config.id}/${root.id} does not define a TypeScript declaration surface`);
    }
    descriptorsByRoot.set(root.id, await generateDescriptorFile({
      files: upstream.declarations.map((file) => resolve(repositoryRoot, file)),
      anchors: null,
      anchorsData: { version: 1, anchors: root.anchors ?? [] },
      symbols: new Set(upstream.roots),
      symbolFiles: [],
      sourceUrl: upstream.sourceUrl ?? null,
      dependencyDepth: upstream.dependencyDepth ?? 0,
      dependencyPolicy: null,
      dependencyPolicyData: upstream.dependencyPolicy ?? null,
    }));
  }
  const output = resolve(repositoryRoot, generation.output);
  const relativeOutput = relative(repositoryRoot, output);
  if (relativeOutput.startsWith("../") || relativeOutput === ".." || !relativeOutput.endsWith(".lean")) {
    throw new Error(`generated output must be a .lean file inside the repository: ${generation.output}`);
  }
  return {
    output,
    text: renderLeanBindings(config, generation, descriptorsByRoot),
    members: generation.members.length,
  };
}

export async function runTypeScriptToLeanCli(argv) {
  const options = parseArgs(argv);
  const generated = await generateLeanBindings(options.config);
  const action = await emitGeneratedFile(generated.output, generated.text, {
    check: options.check,
    root: repositoryRoot,
    staleHint: `run npm run generate:lean-bindings`,
  });
  console.log(`${action} ${relative(repositoryRoot, generated.output)} from ${generated.members} TypeScript members (${basename(options.config)})`);
}
