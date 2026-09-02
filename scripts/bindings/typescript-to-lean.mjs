/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { basename, relative, resolve } from "node:path";

import { repositoryRoot } from "../repository-paths.mjs";
import { discoverBindingConfigPaths, loadBindingConfig } from "./binding-config.mjs";
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
  console.log(`usage: node scripts/bindings/generate-lean-bindings.mjs (--config FILE ... | --config-dir DIR) [--check]

Generate faithful Lean host declarations and canonical operation IR from TypeScript declarations.

Options:
  --config FILE  Binding-library configuration containing a generation block; repeatable.
  --config-dir DIR  Recursively generate every *.bindings.json manifest under DIR.
  --check        Reject a missing or stale generated Lean file.
  -h, --help     Show this help.
`);
}

function parseArgs(argv) {
  const configs = [];
  const configDirs = [];
  let check = false;
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "-h" || option === "--help") {
      usage();
      return null;
    } else if (option === "--config") {
      configs.push(resolve(repositoryRoot, requiredValue(argv, ++index, option)));
    } else if (option === "--config-dir") {
      configDirs.push(resolve(repositoryRoot, requiredValue(argv, ++index, option)));
    } else if (option === "--check") {
      check = true;
    } else {
      throw new Error(`unknown option ${option}`);
    }
  }
  if (configs.length === 0 && configDirs.length === 0) {
    throw new Error("--config or --config-dir is required");
  }
  if (new Set(configs).size !== configs.length) throw new Error("--config repeats a file");
  return { configs, configDirs, check };
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

function renderSignature(name, typeParameters, args, effect, result, prefix) {
  const effectResult = result === "Unit" ? result : `(${result})`;
  const binders = [
    ...typeParameters.map((parameter) => `    {${parameter} : Type}`),
    ...args.map((arg) =>
      `    (${arg.name} : ${arg.modalities.passing === "borrowed" ? "@& " : ""}${arg.type})`),
  ];
  if (binders.length === 0) return `${prefix}${name} : ${effect} ${effectResult}`;
  return `${prefix}${name}\n${binders.join("\n")} :\n    ${effect} ${effectResult}`;
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
  const receiver = operation.receiver.kind === "none"
    ? "receiver none"
    : operation.receiver.kind === "global"
      ? `receiver global (${operation.receiver.typescriptType})`
      : modalityLabel(operation.receiver.argument);
  const arguments_ = operation.arguments.map(modalityLabel);
  const result = `result ${operation.result.modalities.representation}/${operation.result.modalities.ownership}`;
  return `ABI profile \`${profile.id}\`: ${[receiver, ...arguments_, result].join("; ")}.`;
}

function leanDocText(value) {
  return String(value ?? "").replaceAll("-/", "- /").trim();
}

function semanticSubject(operation) {
  const upstream = operation.protocol?.upstreamRelation.member;
  if (upstream !== undefined) return `TypeScript \`${upstream}\``;
  if (operation.typescript.kind !== "protocol") {
    return `TypeScript \`${operation.typescript.member}\``;
  }
  return `unclassified VIR protocol \`${operation.typescript.member}\``;
}

function semanticDocumentation(operation, operationLabel) {
  const relation = operation.semantics.relation;
  const subject = semanticSubject(operation);
  if (relation === "changing") {
    return {
      headline: `Generated explicit ${operationLabel} semantic adapter for ${subject}.`,
      note: `Adapter policy: ${leanDocText(operation.semantics.detail)}`,
    };
  }
  if (relation === "unreviewed") {
    return {
      headline: `Generated ${operationLabel} boundary for ${subject}, awaiting semantic review.`,
      note: `Semantic review required: ${leanDocText(operation.semantics.detail)}`,
    };
  }
  if (operation.semantics.evidence === "reviewed-method-policy") {
    return { note: `Call policy: ${leanDocText(operation.semantics.detail)}` };
  }
  if (operation.exception !== undefined) {
    return { note: `Specialization policy: ${leanDocText(operation.semantics.detail)}` };
  }
  return null;
}

function renderOperation(operation, profile) {
  const args = [
    ...(operation.receiver.kind === "argument" ? [operation.receiver.argument] : []),
    ...operation.arguments,
  ];
  const source = sourceReference(operation.typescript.source);
  const specialized = operation.exception !== undefined;
  const operationLabel = operation.typescript.kind === "method"
    ? "method"
    : operation.typescript.kind === "function"
      ? "function"
      : operation.typescript.kind === "protocol"
        ? "protocol operation"
      : operation.typescript.accessor === "get" ? "getter" : "setter";
  const semanticDoc = semanticDocumentation(operation, operationLabel);
  const upstreamDocumentation = leanDocText(operation.typescript.documentation);
  const distinctUpstreamDocumentation = upstreamDocumentation ===
      leanDocText(operation.semantics.detail) && semanticDoc?.note !== undefined
    ? ""
    : upstreamDocumentation;
  const publicDocumentation = leanDocText([
    semanticDoc?.headline ?? (operation.typescript.kind === "protocol"
      ? `Generated binding for reviewed VIR protocol \`${operation.typescript.member}\`.`
      : operation.semantics.evidence === "reviewed-method-policy"
        ? `Generated reviewed ${operationLabel} call policy for TypeScript \`${operation.typescript.member}\`.`
      : specialized
        ? `Generated reviewed ${operationLabel} specialization of TypeScript \`${operation.typescript.member}\`.`
        : `Faithful generated ${operationLabel} binding for TypeScript \`${operation.typescript.member}\`.`),
    distinctUpstreamDocumentation,
    semanticDoc?.note,
    operation.typescript.kind === "protocol"
      ? "Binding contract: `generation.protocolOperations`."
      : `Upstream declaration: ${source}`,
  ].filter(Boolean).join("\n\n"));
  const marker = operation.host.marker ?? "vir_js";
  const typeParameters = operation.typeParameters ?? [];
  return {
    namespace: operation.lean.namespace,
    text: `/--\n${publicDocumentation}\n\n${operationModalities(operation, profile)}\n\nThis declaration is generated; edit ${operation.typescript.kind === "protocol" ? "the binding configuration" : "the TypeScript source or binding configuration"}.\n-/\n@[${marker} "${operation.host.target}"]\n${renderSignature(operation.lean.name, typeParameters, args, operation.effect.lean, operation.result.lean, "opaque ")}`,
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
    const hasSelectedMember = (root.mappings ?? []).some((mapping) =>
      requested.has(mapping.typescript));
    const hasUpstreamAdapter = (generation.protocolOperations ?? []).some((operation) =>
      operation.group === root.id && operation.upstreamRelation.kind === "upstream-adapter");
    const hasLocalContract = (generation.protocolOperations ?? []).some((operation) =>
      operation.group === root.id && operation.upstreamRelation.kind === "local-contract");
    if (!hasSelectedMember && !hasUpstreamAdapter && !hasLocalContract) continue;
    const upstream = root.upstream;
    if (!["typescript", "local"].includes(upstream?.kind)) {
      throw new Error(`${config.id}/${root.id} does not define a declaration surface`);
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
  const discovered = (await Promise.all(
    options.configDirs.map(discoverBindingConfigPaths),
  )).flat();
  const configs = [...new Set([...options.configs, ...discovered])].sort();
  for (const config of configs) {
    const generated = await generateLeanBindings(config);
    const sourceAction = await emitGeneratedFile(generated.output, generated.text, {
      check: options.check,
      root: repositoryRoot,
      staleHint: `run npm run generate:lean-bindings`,
    });
    const irAction = await emitGeneratedFile(generated.irOutput, generated.irText, {
      root: repositoryRoot,
    });
    console.log(`${sourceAction} ${relative(repositoryRoot, generated.output)} from ${generated.members} TypeScript members (${basename(config)})`);
    console.log(`${irAction} ${relative(repositoryRoot, generated.irOutput)} (${generated.operations} operations with modality provenance)`);
  }
  return 0;
}
