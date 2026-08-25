/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { basename, relative, resolve } from "node:path";

import { repositoryRoot } from "../repository-paths.mjs";
import { loadBindingConfig } from "./binding-config.mjs";
import {
  buildGeneratedOperations,
  generatedOperationDocument,
  validateGenerationProfile,
} from "./binding-modalities.mjs";
import { validateLeanIdentifier } from "./lean-syntax.mjs";
import { generateDescriptorFile } from "./typescript-descriptors.mjs";
import { emitGeneratedFile, requiredValue } from "./tool-utils.mjs";

export { leanType } from "./binding-modalities.mjs";

function usage() {
  console.log(`usage: node scripts/bindings/generate-lean-bindings.mjs --config FILE [--check]

Generate faithful Lean host declarations and canonical operation IR from TypeScript declarations.

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
      return null;
    } else if (option === "--config") {
      config = resolve(repositoryRoot, requiredValue(argv, ++index, option));
    } else if (option === "--check") {
      check = true;
    } else {
      throw new Error(`unknown option ${option}`);
    }
  }
  if (config === null) throw new Error("--config is required");
  return { config, check };
}

function nonemptyString(value) {
  return typeof value === "string" && value.length !== 0;
}

function validateGenerationConfig(config, configPath) {
  const label = relative(repositoryRoot, configPath);
  const generation = config?.generation;
  if (generation === undefined) {
    throw new Error(`${label} does not define a valid Lean generation block`);
  }
  validateGenerationProfile(generation, `${label} generation`);
  if (new Set(generation.members).size !== generation.members.length) {
    throw new Error(`${label} repeats a generated TypeScript member`);
  }
  if (!Object.values(generation.resources).every(nonemptyString)) {
    throw new Error(`${label} generation resources must map to Lean names`);
  }
  for (const name of generation.namespace.split(".")) {
    validateLeanIdentifier(name, `${label} generation namespace`);
  }
  for (const imported of generation.imports) {
    for (const name of imported.split(".")) {
      validateLeanIdentifier(name, `${label} generated import`);
    }
  }
  return generation;
}

function renderSignature(name, args, effect, result, prefix) {
  const effectResult = result === "Unit" ? result : `(${result})`;
  if (args.length === 0) return `${prefix}${name} : ${effect} ${effectResult}`;
  return `${prefix}${name}\n${args.map((arg) =>
    `    (${arg.name} : ${arg.modalities.passing === "borrowed" ? "@& " : ""}${arg.type})`).join("\n")} :\n    ${effect} ${effectResult}`;
}

function sourceReference(source) {
  if (!source?.url) return source?.path ?? "the configured TypeScript declarations";
  return `${source.url}#L${source.startLine}`;
}

function modalityLabel(argument) {
  const modalities = argument.modalities;
  return `${argument.name} ${modalities.representation}/${modalities.passing}/${modalities.retention}`;
}

function operationModalities(operation, profile) {
  const receiver = operation.receiver.kind === "global"
    ? `receiver global (${operation.receiver.typescriptType})`
    : modalityLabel(operation.receiver.argument);
  const arguments_ = operation.arguments.map(modalityLabel);
  const result = `result ${operation.result.modalities.representation}/${operation.result.modalities.ownership}`;
  return `ABI profile \`${profile.id}\`: ${[receiver, ...arguments_, result].join("; ")}.`;
}

function leanDocText(value) {
  return String(value ?? "").replaceAll("-/", "- /").trim();
}

function renderOperation(operation, profile) {
  const args = [
    ...(operation.receiver.kind === "argument" ? [operation.receiver.argument] : []),
    ...operation.arguments,
  ];
  const rawName = `${operation.lean.name}Js`;
  const call = [rawName, ...args.map((arg) => arg.name)].join(" ");
  const source = sourceReference(operation.typescript.source);
  const operationLabel = operation.typescript.kind === "method"
    ? "method"
    : operation.typescript.accessor === "get" ? "getter" : "setter";
  const upstreamDocumentation = leanDocText(operation.typescript.documentation);
  const publicDocumentation = leanDocText([
    `Faithful generated ${operationLabel} binding for TypeScript \`${operation.typescript.member}\`.`,
    upstreamDocumentation,
    `Upstream declaration: ${source}`,
  ].filter(Boolean).join("\n\n"));
  return {
    namespace: operation.lean.namespace,
    text: `/--\nGenerated faithful JavaScript boundary for the TypeScript \`${operation.typescript.member}\` ${operationLabel}.\nSource: ${source}\n${operationModalities(operation, profile)}\n\nThis declaration is generated; edit the TypeScript source or binding configuration.\n-/\n@[vir_js "${operation.host.target}"]\n${renderSignature(rawName, args, operation.effect.lean, operation.result.lean, "private opaque ")}\n\n/--\n${publicDocumentation}\n-/\n${renderSignature(operation.lean.name, args, operation.effect.lean, operation.result.lean, "def ")} :=\n  ${call}`,
  };
}

export function renderLeanOperations(generation, operations) {
  const declarations = operations.map((operation) =>
    renderOperation(operation, generation.abiProfile));
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

export function renderLeanBindings(config, generation, descriptorsByRoot) {
  return renderLeanOperations(
    generation,
    buildGeneratedOperations(config, generation, descriptorsByRoot),
  );
}

function generatedPath(path, extension, label) {
  const output = resolve(repositoryRoot, path);
  const relativeOutput = relative(repositoryRoot, output);
  if (relativeOutput.startsWith("../") || relativeOutput === ".." ||
      !relativeOutput.endsWith(extension)) {
    throw new Error(`${label} must be a ${extension} file inside the repository: ${path}`);
  }
  return output;
}

export async function generateLeanBindings(configPath) {
  const config = await loadBindingConfig(configPath);
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
      bindingContext: null,
      symbols: new Set(upstream.roots),
      symbolFiles: [],
      sourceUrl: upstream.sourceUrl ?? null,
      dependencyDepth: upstream.dependencyDepth ?? 0,
      dependencyPolicy: null,
      dependencyPolicyData: upstream.dependencyPolicy ?? null,
    }));
  }
  const operations = buildGeneratedOperations(config, generation, descriptorsByRoot);
  const document = generatedOperationDocument(config, generation, operations);
  return {
    output: generatedPath(generation.output, ".lean", "generated output"),
    text: renderLeanOperations(generation, operations),
    irOutput: generatedPath(generation.irOutput, ".json", "operation IR output"),
    irText: `${JSON.stringify(document, null, 2)}\n`,
    members: generation.members.length,
    operations: operations.length,
  };
}

export async function runTypeScriptToLeanCli(argv) {
  const options = parseArgs(argv);
  if (options === null) return 0;
  const generated = await generateLeanBindings(options.config);
  const sourceAction = await emitGeneratedFile(generated.output, generated.text, {
    check: options.check,
    root: repositoryRoot,
    staleHint: `run npm run generate:lean-bindings`,
  });
  const irAction = await emitGeneratedFile(generated.irOutput, generated.irText, {
    root: repositoryRoot,
  });
  console.log(`${sourceAction} ${relative(repositoryRoot, generated.output)} from ${generated.members} TypeScript members (${basename(options.config)})`);
  console.log(`${irAction} ${relative(repositoryRoot, generated.irOutput)} (${generated.operations} operations with modality provenance)`);
  return 0;
}
