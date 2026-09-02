/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";

import { scriptSafeJson } from "../json-utils.mjs";
import { repositoryRoot } from "../repository-paths.mjs";
import { discoverBindingConfigPaths, loadBindingConfig } from "./binding-config.mjs";
import { buildGeneratedOperations } from "./binding-modalities.mjs";
import { generateDescriptorFile } from "./typescript-descriptors.mjs";
import { emitGeneratedFile, requiredValue } from "./tool-utils.mjs";

const explorerAssetsDir = resolve(repositoryRoot, "web/tools/binding-explorer");
const semanticStatuses = ["exact", "compatible", "weak", "missing"];
const coverageStatuses = [
  "exact",
  "compatible",
  "derived",
  "protocol-linked",
  "contract-linked",
  "weak",
  "unreviewed",
  "suggested",
  "ambiguous",
  "missing",
];
const generationDispositions = [
  "generated",
  "adapted",
  "needs-annotation",
  "unsupported",
  "not-selected",
];
const usageLine = "usage: node scripts/bindings/generate-binding-explorer.mjs --coverage FILE --out FILE --html FILE [options]";

function usage() {
  console.log(`${usageLine}

Generate the consolidated Lean VIR upstream reference, shipped inventory, and author actions.

Options:
  --coverage FILE   Shipped-binding coverage report.
  --config-dir DIR  Binding manifests directory. Defaults to Vir/.
  --out FILE        Write the explorer report JSON to FILE.
  --html FILE       Write the explorer HTML shell to FILE.
  --check           Compare generated files with existing outputs.
  -h, --help        Show this help.
`);
}

function parseArgs(argv) {
  const options = {
    coverage: null,
    configDir: resolve(repositoryRoot, "Vir"),
    out: null,
    html: null,
    check: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "-h" || option === "--help") {
      usage();
      return null;
    } else if (option === "--coverage") options.coverage = resolve(repositoryRoot, requiredValue(argv, ++index, option));
    else if (option === "--config-dir") options.configDir = resolve(repositoryRoot, requiredValue(argv, ++index, option));
    else if (option === "--out") options.out = resolve(repositoryRoot, requiredValue(argv, ++index, option));
    else if (option === "--html") options.html = resolve(repositoryRoot, requiredValue(argv, ++index, option));
    else if (option === "--check") options.check = true;
    else throw new Error(`unknown option ${option}`);
  }
  if (options.coverage === null || options.out === null || options.html === null) {
    throw new Error(usageLine);
  }
  return options;
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${relative(repositoryRoot, path)}: ${error.message}`);
  }
}

function matchesPattern(target, pattern) {
  return pattern.endsWith("*") ? target.startsWith(pattern.slice(0, -1)) : target === pattern;
}

function rootMatches(bindingRoot, target) {
  return bindingRoot.targets.some((pattern) => matchesPattern(target, pattern));
}

async function generateTypeScriptSurfaces(configs) {
  const groups = new Map();
  for (const config of configs) {
    for (const bindingRoot of config.roots) {
      if (!["typescript", "local"].includes(bindingRoot.upstream.kind)) continue;
      const upstream = bindingRoot.upstream;
      const key = JSON.stringify({
        declarations: upstream.declarations,
        sourceUrl: upstream.sourceUrl ?? null,
        dependencyDepth: upstream.dependencyDepth ?? 0,
        dependencyPolicy: upstream.dependencyPolicy ?? null,
      });
      const group = groups.get(key) ?? { upstream, requests: [] };
      group.requests.push({ config, bindingRoot });
      groups.set(key, group);
    }
  }

  const surfaces = new Map();
  for (const { upstream, requests } of groups.values()) {
    const requestedSymbols = new Set(requests.flatMap(({ bindingRoot }) => bindingRoot.upstream.roots));
    const anchors = requests.flatMap(({ bindingRoot }) => bindingRoot.anchors ?? []);
    const descriptor = await generateDescriptorFile({
      files: upstream.declarations.map((file) => resolve(repositoryRoot, file)),
      anchors: null,
      anchorsData: { version: 1, anchors },
      symbols: requestedSymbols,
      symbolFiles: [],
      sourceUrl: upstream.sourceUrl ?? null,
      dependencyDepth: upstream.dependencyDepth ?? 0,
      dependencyPolicy: null,
      dependencyPolicyData: upstream.dependencyPolicy ?? null,
    });
    const symbolsById = new Map(descriptor.symbols.map((symbol) => [symbol.id, symbol]));
    for (const { config, bindingRoot } of requests) {
      const rootIds = new Set(bindingRoot.upstream.roots);
      const includeDependencies = requests.length === 1 && descriptor.dependencies !== undefined;
      const symbols = descriptor.symbols.filter((symbol) => rootIds.has(symbol.id) ||
        (symbol.surfaceRoot !== undefined && rootIds.has(symbol.surfaceRoot)) ||
        (includeDependencies && symbol.dependency !== undefined)).map(explorerTypeScriptSymbol);
      for (const id of rootIds) {
        if (!symbolsById.has(id)) throw new Error(`${config.id}/${bindingRoot.id} cannot find TypeScript root ${id}`);
      }
      surfaces.set(`${config.id}/${bindingRoot.id}`, {
        sources: descriptor.sources,
        roots: [...rootIds].sort(),
        symbols,
        ...(includeDependencies && descriptor.dependencies !== undefined
          ? { dependencies: descriptor.dependencies }
          : {}),
      });
    }
  }
  return surfaces;
}

function explorerTypeScriptSymbol(symbol) {
  if (symbol.kind !== "interface") return symbol;
  const { shape: _shape, ...presentation } = symbol;
  const header = symbol.display.slice(0, symbol.display.indexOf("{")).trim();
  return { ...presentation, display: `${header} { … }` };
}

async function loadComparison(bindingRoot) {
  if (bindingRoot.comparison === undefined) return null;
  const path = resolve(repositoryRoot, bindingRoot.comparison.report);
  const report = await readJson(path);
  if (report?.version !== 1 || report.generatedBy !== "scripts/bindings/check-type-anchors.mjs" ||
      !Array.isArray(report.results) || !semanticStatuses.every((status) =>
        Number.isInteger(report.summary?.[status]))) {
    throw new Error(`${relative(repositoryRoot, path)} is not a type-anchor comparison report`);
  }
  return { path: relative(repositoryRoot, path), ...report };
}

function issue(kind, severity, message, extra = {}) {
  return { kind, severity, message, ...extra };
}

function semanticIssues(comparison) {
  if (comparison === null) return [];
  const issues = [];
  for (const result of comparison.results) {
    if (result.status === "weak") {
      issues.push(issue("type-fidelity", "warning", `${result.lean} weakly matches ${result.ts}`, {
        anchor: result.id,
        ...(result.target ? { target: result.target } : {}),
      }));
    } else if (result.status === "missing" && result.relation !== "coverageGap") {
      issues.push(issue(
        "missing-descriptor",
        "error",
        result.note ?? `${result.lean} or ${result.ts} is missing`,
        { anchor: result.id, ...(result.target ? { target: result.target } : {}) },
      ));
    }
    for (const diagnostic of result.diagnostics ?? []) {
      if (diagnostic.severity === "error") {
        issues.push(issue("comparison-error", "error", diagnostic.message, {
          anchor: result.id,
          code: diagnostic.code,
          ...(result.target ? { target: result.target } : {}),
        }));
      }
    }
  }
  return issues;
}

function semanticRoadmap(comparison) {
  if (comparison === null) return [];
  return comparison.results.filter((result) =>
    result.status === "missing" && result.relation === "coverageGap").map((result) => ({
    kind: "unsupported-upstream-entry",
    message: result.note ?? `${result.ts} is not provided by VIR`,
    anchor: result.id,
    typescript: result.ts,
    ...(result.target ? { target: result.target } : {}),
  }));
}

function analysisState(bindingRoot, coverage, comparison) {
  if (bindingRoot.upstream.kind === "internal") {
    return { status: "not-applicable", scope: "no-upstream-contract" };
  }
  if (coverage?.mode === "reviewed") {
    return (bindingRoot.upstream.kind === "local" || comparison !== null) &&
        coverage.summary.unreviewed === 0
      ? { status: "complete", scope: "complete-upstream-surface" }
      : { status: "in-progress", scope: "complete-upstream-surface" };
  }
  if (comparison !== null) {
    return { status: "curated", scope: "selected-symbol-comparison" };
  }
  if (coverage?.mode === "automatic") {
    return { status: "automatic", scope: "complete-upstream-surface" };
  }
  if (bindingRoot.upstream.kind === "local") {
    return { status: "needs-input", scope: "local-upstream-contract-missing" };
  }
  return { status: "not-run", scope: "upstream-surface-unavailable" };
}

function findingStatus(bindings, issues) {
  if (bindings.some((binding) => binding.status !== "provided") ||
      issues.some((entry) => entry.severity === "error")) return "error";
  if (issues.some((entry) => entry.severity === "warning")) return "warning";
  return "none";
}

function emptyCoverageSummary() {
  return Object.fromEntries(coverageStatuses.map((status) => [status, 0]));
}

function reviewedMappingOperations(mapping) {
  if (mapping.accessors !== undefined) {
    return Object.entries(mapping.accessors).map(([accessor, operation]) =>
      operation.missing === true
        ? { accessor, missing: true, note: operation.note }
        : {
            accessor,
            target: operation.target,
            lean: [operation.lean],
            anchor: operation.anchor,
          });
  }
  return mapping.targets.map((target) => ({
    target,
    lean: mapping.lean ?? [],
  }));
}

function worstSemanticStatus(results) {
  if (results.length === 0) return "unreviewed";
  return results.reduce((candidate, result) =>
    semanticStatuses.indexOf(result.status) > semanticStatuses.indexOf(candidate)
      ? result.status
      : candidate, "exact");
}

function comparisonResultsForSymbol(symbol, comparison) {
  if (comparison === null) return [];
  return comparison.results.filter((result) =>
    result.ts === symbol.id ||
    (result.portIntent?.disposition === "unsupported" &&
      result.ts === symbol.surfaceRoot));
}

function generationRecord(generatedMembers, symbol, member, targetMappings, comparison) {
  const comparisonResults = comparisonResultsForSymbol(symbol, comparison);
  const auditedTargets = comparisonResults.filter((result) =>
    result.relation === "audit" && result.target !== undefined).map((result) => result.target);
  const mappedTargets = member.mapping?.targets ?? [];
  const confirmedTargets = [...new Set([...mappedTargets, ...auditedTargets])].sort();
  const candidateTargets = [...new Set(targetMappings.filter((mapping) =>
    mapping.source === "automatic").map((mapping) => mapping.target))].sort();
  const adaptedTargets = [...new Set(targetMappings.filter((mapping) =>
    mapping.source === "protocol-relation" &&
    ["upstream-adapter", "local-contract"].includes(mapping.relation.kind) &&
    mapping.typescript === symbol.id).map((mapping) => mapping.target))].sort();
  const unsupported = comparisonResults.find((result) =>
    result.portIntent?.disposition === "unsupported");
  const diagnostics = [];
  let disposition;
  let provenance;

  if (generatedMembers.has(symbol.id)) {
    disposition = "generated";
    provenance = "generator";
    if (confirmedTargets.length === 0) {
      diagnostics.push({
        code: "generated-binding-unreachable",
        severity: "error",
        message: "The member is selected for generation but has no confirmed shipped target.",
        action: "Regenerate the Lean source and reconcile its compiled target.",
      });
    }
  } else if (adaptedTargets.length !== 0) {
    disposition = "adapted";
    provenance = "reviewed-protocol";
  } else if (unsupported !== undefined) {
    disposition = "unsupported";
    provenance = "annotation";
  } else if (confirmedTargets.length !== 0) {
    disposition = "needs-annotation";
    provenance = "reviewed-protocol";
    diagnostics.push({
      code: "direct-typescript-lowering-required",
      severity: "action",
      message: "VIR ships a generated reviewed protocol for this upstream operation, but does not yet lower it directly from TypeScript.",
      action: "Express the correspondence in the TypeScript lowering policy, or keep it explicitly protocol-specific.",
    });
  } else if (candidateTargets.length !== 0) {
    disposition = "needs-annotation";
    provenance = "candidate";
    diagnostics.push({
      code: targetMappings.some((mapping) => mapping.status === "ambiguous")
        ? "ambiguous-upstream-correspondence"
        : "upstream-correspondence-unconfirmed",
      severity: "action",
      message: targetMappings.some((mapping) => mapping.status === "ambiguous")
        ? "More than one upstream operation may correspond to a shipped target."
        : "A name-based candidate connects this upstream operation to a shipped target, but the identity is not authored.",
      action: "Confirm the operation identity in the binding configuration before generation.",
    });
  } else {
    disposition = "not-selected";
    provenance = "none";
  }

  for (const operation of member.mapping?.operations ?? []) {
    if (operation.missing !== true) continue;
    diagnostics.push({
      code: "upstream-accessor-missing",
      severity: "action",
      accessor: operation.accessor,
      message: operation.note,
      action: `Add the ${operation.accessor} binding or keep this coverage gap explicitly reviewed.`,
    });
  }

  for (const result of comparisonResults) {
    if (result.relation !== "audit" || !["weak", "missing"].includes(result.status)) continue;
    diagnostics.push({
      code: result.status === "weak" ? "type-translation-limited" : "type-translation-missing",
      severity: result.status === "weak" ? "warning" : "error",
      message: result.note ?? `${result.lean} does not faithfully represent ${result.ts}.`,
      action: "Repair the translation policy or record the unsupported TypeScript construct.",
      anchor: result.id,
    });
  }

  return {
    disposition,
    provenance,
    availability: confirmedTargets.length !== 0 || adaptedTargets.length !== 0
      ? "available"
      : candidateTargets.length !== 0 ? "candidate" : "not-provided",
    targets: [...new Set([...confirmedTargets, ...adaptedTargets])].sort(),
    ...(candidateTargets.length === 0 ? {} : { candidateTargets }),
    diagnostics,
  };
}

function decorateGenerationCoverage(config, bindingRoot, typeScript, surfaceCoverage, comparison) {
  const symbolsById = new Map(typeScript.symbols.map((symbol) => [symbol.id, symbol]));
  const generatedMembers = new Set(config.generation?.members ?? []);
  const targetMappingsBySymbol = new Map();
  for (const mapping of surfaceCoverage.targetMappings) {
    const ids = [mapping.typescript, ...(mapping.candidates ?? []).map((candidate) =>
      candidate.typescript)].filter(Boolean);
    for (const id of ids) {
      const mappings = targetMappingsBySymbol.get(id) ?? [];
      mappings.push(mapping);
      targetMappingsBySymbol.set(id, mappings);
    }
  }
  const members = surfaceCoverage.members.map((member) => {
    const symbol = symbolsById.get(member.id);
    if (symbol === undefined) {
      throw new Error(`${config.id}/${bindingRoot.id} cannot decorate missing member ${member.id}`);
    }
    return {
      ...member,
      generation: generationRecord(
        generatedMembers,
        symbol,
        member,
        targetMappingsBySymbol.get(member.id) ?? [],
        comparison,
      ),
    };
  });
  const disposition = Object.fromEntries(generationDispositions.map((status) => [status, 0]));
  const availability = { available: 0, candidate: 0, "not-provided": 0 };
  for (const member of members) {
    disposition[member.generation.disposition] += 1;
    availability[member.generation.availability] += 1;
  }
  return {
    ...surfaceCoverage,
    members,
    generation: {
      disposition,
      availability,
      actions: members.reduce((sum, member) => sum + member.generation.diagnostics.length, 0),
    },
  };
}

function groupWorkItems(config, bindingRoot, surfaceCoverage, issues, generatedOperations) {
  const items = [];
  for (const member of surfaceCoverage?.members ?? []) {
    member.generation.diagnostics.forEach((diagnostic, index) => items.push({
      id: `${config.id}/${bindingRoot.id}/member/${member.id}/${diagnostic.code}/${index}`,
      library: config.id,
      group: bindingRoot.id,
      subject: "upstream-member",
      member: member.id,
      disposition: member.generation.disposition,
      provenance: member.generation.provenance,
      availability: member.generation.availability,
      targets: member.generation.targets,
      ...(member.generation.candidateTargets === undefined
        ? {} : { candidateTargets: member.generation.candidateTargets }),
      ...diagnostic,
    }));
  }
  for (const mapping of surfaceCoverage?.targetMappings ?? []) {
    if (mapping.status !== "unmatched") continue;
    items.push({
      id: `${config.id}/${bindingRoot.id}/target/${mapping.target}/upstream-identity-missing`,
      library: config.id,
      group: bindingRoot.id,
      subject: "host-target",
      target: mapping.target,
      disposition: "needs-annotation",
      provenance: "generated-protocol",
      severity: "action",
      code: "upstream-identity-missing",
      message: "This shipped target has no upstream correspondence candidate.",
      action: "Identify its upstream operation or classify it as an explicit no-parity operation.",
    });
  }
  for (const operation of generatedOperations) {
    if (operation.protocol?.upstreamRelation.kind !== "unclassified") continue;
    const represented = items.some((item) =>
      item.target === operation.host.target ||
      item.targets?.includes(operation.host.target) ||
      item.candidateTargets?.includes(operation.host.target));
    if (represented) continue;
    items.push({
      id: `${config.id}/${bindingRoot.id}/target/${operation.host.target}/protocol-classification-required`,
      library: config.id,
      group: bindingRoot.id,
      subject: "host-target",
      target: operation.host.target,
      disposition: "needs-annotation",
      provenance: "generated-protocol",
      severity: "action",
      code: "protocol-classification-required",
      message: "This generated protocol has not been classified against its upstream API.",
      action: "Name the adapted upstream member or classify the operation as VIR-owned.",
    });
  }
  for (const operation of generatedOperations) {
    if (operation.semantics?.relation !== "unreviewed" ||
        operation.protocol?.upstreamRelation.kind === "unclassified") continue;
    items.push({
      id: `${config.id}/${bindingRoot.id}/target/${operation.host.target}/semantic-fidelity-review-required`,
      library: config.id,
      group: bindingRoot.id,
      subject: "host-target",
      target: operation.host.target,
      disposition: "needs-annotation",
      provenance: operation.semantics.evidence,
      severity: "action",
      code: "semantic-fidelity-review-required",
      message: "This generated boundary has a reviewed shape or protocol relation, but no claim about whether it preserves upstream-observable semantics.",
      action: "Review identity, mutation, lifetime, reuse, callback retention, failure behavior, and terminal behavior; classify the exception or upstream adapter as semantics-preserving or semantics-changing.",
    });
  }
  if (bindingRoot.upstream.kind === "local" && surfaceCoverage === null) {
    items.push({
      id: `${config.id}/${bindingRoot.id}/contract/local-contract-required`,
      library: config.id,
      group: bindingRoot.id,
      subject: "upstream-contract",
      disposition: "needs-annotation",
      provenance: "none",
      severity: "action",
      code: "local-upstream-contract-required",
      message: "The local API group has no machine-readable upstream contract.",
      action: "Provide a declaration contract before generating or auditing its bindings.",
    });
  }
  const representedAnchors = new Set(items.flatMap((item) =>
    item.anchor === undefined ? [] : [item.anchor]));
  issues.filter((entry) =>
    ["type-fidelity", "missing-descriptor"].includes(entry.kind) &&
    entry.anchor !== undefined && !representedAnchors.has(entry.anchor))
    .forEach((entry) => {
      items.push({
        id: `${config.id}/${bindingRoot.id}/comparison/${entry.anchor}/${entry.kind}`,
        library: config.id,
        group: bindingRoot.id,
        subject: "comparison-anchor",
        anchor: entry.anchor,
        disposition: "needs-annotation",
        provenance: "comparison",
        severity: entry.severity,
        code: entry.kind === "type-fidelity"
          ? "type-translation-limited"
          : "type-translation-missing",
        message: entry.message,
        action: entry.kind === "type-fidelity"
          ? "Review the generated specialization and improve the type translation policy."
          : "Provide the missing TypeScript or Lean descriptor before generation.",
        ...(entry.target === undefined ? {} : { target: entry.target }),
      });
      representedAnchors.add(entry.anchor);
    });
  const structuralIssueKinds = new Set([
    "missing-provider",
    "runtime-only",
    "mapped-public-api-unreachable",
    "extra-public-accessor-api",
    "comparison-error",
  ]);
  issues.filter((entry) => structuralIssueKinds.has(entry.kind)).forEach((entry, index) =>
    items.push({
      id: `${config.id}/${bindingRoot.id}/finding/${entry.kind}/${index}`,
      library: config.id,
      group: bindingRoot.id,
      subject: entry.target === undefined ? "binding-group" : "host-target",
      disposition: "needs-annotation",
      provenance: "compiled-evidence",
      severity: entry.severity,
      code: entry.kind,
      message: entry.message,
      action: "Repair the binding configuration, generated declaration, or runtime provider map.",
      ...(entry.target === undefined ? {} : { target: entry.target }),
    }));
  return items;
}

function buildSurfaceCoverage(config, bindingRoot, typeScript, bindings, comparison, generatedOperations = []) {
  if (bindingRoot.upstream.kind === "local") {
    return buildLocalContractCoverage(config, bindingRoot, typeScript, bindings, generatedOperations);
  }
  if (!Array.isArray(bindingRoot.mappings)) {
    return buildSuggestedSurfaceCoverage(bindingRoot, typeScript, bindings, generatedOperations);
  }
  const symbolsById = new Map(typeScript.symbols.map((symbol) => [symbol.id, symbol]));
  const bindingsByTarget = new Map(bindings.map((binding) => [binding.target, binding]));
  const generatedMembers = new Set(config.generation?.members ?? []);
  const resultsByTypeScript = new Map();
  const resultsById = new Map();
  for (const result of comparison?.results ?? []) {
    if (resultsById.has(result.id)) {
      throw new Error(`${config.id}/${bindingRoot.id} comparison repeats anchor ${result.id}`);
    }
    resultsById.set(result.id, result);
    const results = resultsByTypeScript.get(result.ts) ?? [];
    results.push(result);
    resultsByTypeScript.set(result.ts, results);
  }
  const mappings = new Map();
  const mappedTargets = new Set();
  const protocolTargets = new Set(generatedOperations
    .filter((operation) => operation.typescript.kind === "protocol")
    .map((operation) => operation.host.target));
  for (const mapping of bindingRoot.mappings) {
    const symbol = symbolsById.get(mapping.typescript);
    if (symbol === undefined) {
      throw new Error(`${config.id}/${bindingRoot.id} mapping references missing TypeScript member ${mapping.typescript}`);
    }
    if (mappings.has(mapping.typescript)) {
      throw new Error(`${config.id}/${bindingRoot.id} repeats TypeScript mapping ${mapping.typescript}`);
    }
    const operations = reviewedMappingOperations(mapping);
    if (mapping.accessors !== undefined && symbol.kind !== "property") {
      throw new Error(`${config.id}/${bindingRoot.id} maps accessors for non-property ${mapping.typescript}`);
    }
    if (mapping.accessors === undefined && symbol.kind === "property") {
      throw new Error(`${config.id}/${bindingRoot.id} property ${mapping.typescript} must use accessor mappings`);
    }
    if (mapping.accessors !== undefined) {
      const readonly = symbol.access === "get" || /^readonly\s/u.test(symbol.display);
      if (mapping.accessors.get === undefined) {
        throw new Error(`${config.id}/${bindingRoot.id} property ${mapping.typescript} must classify its getter`);
      }
      if (readonly && mapping.accessors.set !== undefined) {
        throw new Error(`${config.id}/${bindingRoot.id} maps a setter for readonly property ${mapping.typescript}`);
      }
      if (!readonly && mapping.accessors.set === undefined) {
        throw new Error(`${config.id}/${bindingRoot.id} writable property ${mapping.typescript} must classify its setter`);
      }
    }
    for (const operation of operations) {
      if (operation.missing === true) continue;
      if (!bindingsByTarget.has(operation.target)) {
        throw new Error(`${config.id}/${bindingRoot.id} mapping references target outside its root: ${operation.target}`);
      }
      if (mappedTargets.has(operation.target)) {
        throw new Error(`${config.id}/${bindingRoot.id} maps target twice: ${operation.target}`);
      }
      mappedTargets.add(operation.target);
      if (operation.accessor !== undefined) {
        if (operation.anchor === undefined && generatedMembers.has(mapping.typescript)) continue;
        const result = resultsById.get(operation.anchor);
        if (result === undefined || result.ts !== mapping.typescript ||
            result.target !== operation.target ||
            result.portIntent?.accessor !== operation.accessor) {
          throw new Error(`${config.id}/${bindingRoot.id} ${mapping.typescript} ${operation.accessor} accessor does not match reviewed anchor ${operation.anchor}`);
        }
      }
    }
    const mappedOperations = operations.filter((operation) => operation.missing !== true);
    const results = mapping.accessors === undefined
      ? resultsByTypeScript.get(mapping.typescript) ?? []
      : mappedOperations.flatMap((operation) => {
          const result = operation.anchor === undefined ? undefined : resultsById.get(operation.anchor);
          return result === undefined ? [] : [result];
        });
    const generatedCompatibility = generatedMembers.has(mapping.typescript) &&
      results.length === 0 && mappedOperations.length !== 0;
    mappings.set(mapping.typescript, {
      ...mapping,
      operations,
      targets: mappedOperations.map((operation) => operation.target),
      lean: mappedOperations.flatMap((operation) => operation.lean),
      status: operations.some((operation) => operation.missing === true)
        ? "missing"
        : generatedCompatibility ? "derived" : worstSemanticStatus(results),
      anchors: results.map((result) => result.id),
    });
  }
  const classifiedTargets = new Set([...mappedTargets, ...protocolTargets]);
  if (classifiedTargets.size !== bindings.length) {
    const missing = bindings.filter((binding) => !classifiedTargets.has(binding.target)).map((binding) => binding.target);
    throw new Error(`${config.id}/${bindingRoot.id} mappings do not classify targets: ${missing.join(", ")}`);
  }
  const members = typeScript.symbols.filter((symbol) => symbol.surfaceRoot !== undefined).map((symbol) => {
    const mapping = mappings.get(symbol.id);
    return {
      id: symbol.id,
      kind: symbol.kind,
      ...(symbol.inheritedFrom ? { inheritedFrom: symbol.inheritedFrom } : {}),
      status: mapping?.status ?? "missing",
      ...(mapping === undefined ? {} : { mapping }),
    };
  });
  const summary = emptyCoverageSummary();
  for (const member of members) summary[member.status] += 1;
  const targetMappings = [...mappings.values()].flatMap((mapping) =>
    mapping.operations.filter((operation) => operation.missing !== true).map((operation) => {
      const operationResults = operation.anchor === undefined
        ? (resultsByTypeScript.get(mapping.typescript) ?? []).filter((result) =>
            result.target === operation.target)
        : [resultsById.get(operation.anchor)];
      return {
        target: operation.target,
        status: generatedMembers.has(mapping.typescript) && operationResults.length === 0
          ? "derived"
          : worstSemanticStatus(operationResults),
        source: "reviewed",
        typescript: mapping.typescript,
        lean: operation.lean,
        anchors: operationResults.map((result) => result.id),
        ...(operation.accessor === undefined ? {} : { accessor: operation.accessor }),
      };
    }));
  return {
    mode: "reviewed",
    summary: { ...summary, mappedTargets: classifiedTargets.size },
    members,
    targetMappings,
  };
}

function buildLocalContractCoverage(config, bindingRoot, typeScript, bindings, generatedOperations) {
  const roots = new Set(bindingRoot.upstream.roots);
  const members = typeScript.symbols.filter((symbol) =>
    symbol.surfaceRoot !== undefined || (roots.has(symbol.id) && symbol.kind !== "interface"));
  const symbolsById = new Map(members.map((member) => [member.id, member]));
  const bindingsByTarget = new Map(bindings.map((binding) => [binding.target, binding]));
  const operationsByMember = new Map();
  const targetMappings = [];

  for (const operation of generatedOperations) {
    const relation = operation.protocol?.upstreamRelation;
    if (relation?.kind !== "local-contract") {
      throw new Error(`${config.id}/${bindingRoot.id} local operation ${operation.id} lacks a local-contract relation`);
    }
    if (!symbolsById.has(relation.member)) {
      throw new Error(`${config.id}/${bindingRoot.id} local operation ${operation.id} references missing contract member ${relation.member}`);
    }
    if (!bindingsByTarget.has(operation.host.target)) {
      throw new Error(`${config.id}/${bindingRoot.id} local operation ${operation.id} references target outside its group: ${operation.host.target}`);
    }
    const memberOperations = operationsByMember.get(relation.member) ?? [];
    memberOperations.push(operation);
    operationsByMember.set(relation.member, memberOperations);
    targetMappings.push({
      target: operation.host.target,
      status: "contract-linked",
      source: "protocol-relation",
      typescript: relation.member,
      lean: [operation.lean.declaration],
      relation,
      candidates: [],
    });
  }

  const classifiedTargets = new Set(targetMappings.map((mapping) => mapping.target));
  if (classifiedTargets.size !== bindings.length) {
    const missing = bindings.filter((binding) => !classifiedTargets.has(binding.target))
      .map((binding) => binding.target);
    throw new Error(`${config.id}/${bindingRoot.id} local contract does not classify targets: ${missing.join(", ")}`);
  }

  const coveredMembers = members.map((member) => {
    const operations = operationsByMember.get(member.id) ?? [];
    const mapping = operations.length === 0 ? undefined : {
      typescript: member.id,
      operations: operations.map((operation) => ({
        target: operation.host.target,
        lean: [operation.lean.declaration],
      })),
      targets: operations.map((operation) => operation.host.target),
      lean: operations.map((operation) => operation.lean.declaration),
      status: "contract-linked",
      anchors: [],
    };
    return {
      id: member.id,
      kind: member.kind,
      ...(member.inheritedFrom ? { inheritedFrom: member.inheritedFrom } : {}),
      status: mapping === undefined ? "missing" : "contract-linked",
      ...(mapping === undefined ? {} : { mapping }),
    };
  });
  const summary = emptyCoverageSummary();
  for (const member of coveredMembers) summary[member.status] += 1;
  return {
    mode: "reviewed",
    summary: {
      ...summary,
      mappedTargets: classifiedTargets.size,
    },
    members: coveredMembers,
    targetMappings,
  };
}

function buildSuggestedSurfaceCoverage(bindingRoot, typeScript, bindings, generatedOperations) {
  const roots = new Set(bindingRoot.upstream.roots);
  const members = typeScript.symbols.filter((symbol) =>
    symbol.surfaceRoot !== undefined || (roots.has(symbol.id) && symbol.kind !== "interface"));
  const relationsByTarget = new Map(generatedOperations
    .filter((operation) => operation.typescript.kind === "protocol")
    .map((operation) => [operation.host.target, operation.protocol.upstreamRelation]));
  const targetMappings = bindings.map((binding) => {
    const relation = relationsByTarget.get(binding.target);
    if (relation?.kind === "upstream-adapter") {
      return {
        target: binding.target,
        status: "protocol-linked",
        source: "protocol-relation",
        typescript: relation.member,
        relation,
        candidates: [],
      };
    }
    if (relation?.kind === "vir-owned") {
      return {
        target: binding.target,
        status: "no-parity",
        source: "protocol-relation",
        relation,
        candidates: [],
      };
    }
    return suggestTargetMapping(binding.target, members);
  });
  const mappedMembers = new Map();
  for (const mapping of targetMappings) {
    if (mapping.source === "protocol-relation" && mapping.typescript !== undefined) {
      mappedMembers.set(mapping.typescript, "protocol-linked");
      continue;
    }
    for (const candidate of mapping.candidates) {
      const previous = mappedMembers.get(candidate.typescript);
      const status = mapping.status === "suggested" ? "suggested" : "ambiguous";
      if (previous !== "suggested") mappedMembers.set(candidate.typescript, status);
    }
  }
  const coveredMembers = members.map((member) => ({
    id: member.id,
    kind: member.kind,
    ...(member.inheritedFrom ? { inheritedFrom: member.inheritedFrom } : {}),
    status: mappedMembers.get(member.id) ?? "missing",
  }));
  const evidence = emptyCoverageSummary();
  for (const member of coveredMembers) evidence[member.status] += 1;
  const summary = {
    ...evidence,
    mappedTargets: targetMappings.filter((mapping) =>
      ["protocol-linked", "suggested"].includes(mapping.status)).length,
    ambiguousTargets: targetMappings.filter((mapping) => mapping.status === "ambiguous").length,
    unmatchedTargets: targetMappings.filter((mapping) => mapping.status === "unmatched").length,
    noParityTargets: targetMappings.filter((mapping) => mapping.status === "no-parity").length,
  };
  return { mode: "automatic", summary, members: coveredMembers, targetMappings };
}

function suggestTargetMapping(target, members) {
  const scored = members.map((member) => ({
    typescript: member.id,
    ...mappingScore(target, member),
  })).filter((candidate) => candidate.score !== 0)
    .sort((left, right) => right.score - left.score || left.typescript.localeCompare(right.typescript));
  if (scored.length === 0) {
    return { target, status: "unmatched", source: "automatic", candidates: [] };
  }
  const bestScore = scored[0].score;
  const candidates = scored.filter((candidate) => candidate.score === bestScore);
  return {
    target,
    status: candidates.length === 1 ? "suggested" : "ambiguous",
    source: "automatic",
    candidates,
  };
}

function mappingScore(targetValue, memberSymbol) {
  const memberId = memberSymbol.id;
  const targetParts = targetValue.split(".");
  const memberParts = memberId.split(".");
  const target = normalizedName(targetParts.at(-1));
  const member = normalizedName(memberParts.at(-1));
  const ownerMatches = normalizedName(targetParts.at(-2) ?? "") ===
    normalizedName(memberParts.at(-2) ?? "");
  if (target === member) {
    return {
      score: 100 + (ownerMatches ? 10 : 0),
      reason: ownerMatches ? "same member and owner name" : "same member name",
    };
  }
  for (const prefix of ["get", "set"]) {
    if (target.startsWith(prefix) && target.slice(prefix.length) === member) {
      return {
        score: 95 + (ownerMatches ? 10 : 0),
        reason: `${prefix} accessor naming${ownerMatches ? " on matching owner" : ""}`,
        ...(memberSymbol.kind === "property" ? { accessor: prefix } : {}),
      };
    }
  }
  if (target.length >= 4 && member.length >= 4 &&
      (target.startsWith(member) || member.startsWith(target))) {
    return {
      score: 70 + (ownerMatches ? 10 : 0),
      reason: `shared member-name prefix${ownerMatches ? " on matching owner" : ""}`,
    };
  }
  return { score: 0, reason: "" };
}

function normalizedName(value) {
  return value.replaceAll(/[^A-Za-z0-9]/gu, "").toLowerCase();
}

function declarationMatchesSelector(declaration, selector) {
  return declaration === selector || declaration.startsWith(`${selector}.`);
}

function reviewedPublicIssues(bindingRoot, surfaceCoverage, publicByTarget, generatedOperations) {
  if (surfaceCoverage?.mode !== "reviewed") return [];
  const selectors = bindingRoot.lean?.public ?? [];
  const issues = [];
  for (const mapping of surfaceCoverage.targetMappings) {
    const callers = publicByTarget.get(mapping.target) ?? [];
    for (const declaration of mapping.lean) {
      if (!callers.some((caller) => caller.entry.declaration === declaration)) {
        issues.push(issue(
          "mapped-public-api-unreachable",
          "error",
          `${declaration} is the reviewed${mapping.accessor === undefined
            ? "" : ` ${mapping.accessor} accessor`} binding for ${mapping.typescript}, but compiled IR does not reach ${mapping.target}`,
          { target: mapping.target, declaration, typescript: mapping.typescript,
            ...(mapping.accessor === undefined ? {} : { accessor: mapping.accessor }) },
        ));
      }
    }
    if (mapping.accessor === undefined) continue;
    const generated = generatedOperations.some((operation) =>
      operation.host.target === mapping.target && mapping.lean.includes(operation.lean.declaration));
    if (generated) continue;
    const reviewed = new Set(mapping.lean);
    for (const caller of callers) {
      if (reviewed.has(caller.entry.declaration) ||
          !selectors.some((selector) =>
            declarationMatchesSelector(caller.entry.declaration, selector))) continue;
      issues.push(issue(
        "extra-public-accessor-api",
        "error",
        `${caller.entry.declaration} reaches the ${mapping.typescript} ${mapping.accessor} target but has no distinct upstream property operation`,
        { target: mapping.target, declaration: caller.entry.declaration,
          typescript: mapping.typescript, accessor: mapping.accessor },
      ));
    }
  }
  return issues;
}

export async function buildBindingExplorerReport(coverage, configs, typeScriptSurfaces, coveragePath) {
  if (coverage?.format !== "lean-vir-shipped-bindings-coverage" || coverage.version !== 1 ||
      !Array.isArray(coverage.bindings) || !Array.isArray(coverage.publicEntries)) {
    throw new Error("coverage input is not a shipped-bindings v1 report");
  }
  const shippedTargets = new Set(coverage.bindings.map((binding) => binding.target));
  const publicByTarget = new Map();
  for (const entry of coverage.publicEntries) {
    for (const reached of entry.targets) {
      if (!shippedTargets.has(reached.target)) {
        throw new Error(`${entry.declaration} reaches unknown target ${reached.target}`);
      }
      const callers = publicByTarget.get(reached.target) ?? [];
      callers.push({ entry, reached });
      publicByTarget.set(reached.target, callers);
    }
  }
  const moduleOwners = new Map();
  for (const config of configs) {
    for (const moduleName of config.lean.modules) {
      if (moduleOwners.has(moduleName)) {
        throw new Error(`Lean module ${moduleName} is owned by both ${moduleOwners.get(moduleName).id} and ${config.id}`);
      }
      moduleOwners.set(moduleName, config);
    }
  }

  const assigned = new Map(configs.map((config) => [config.id,
    new Map(config.roots.map((bindingRoot) => [bindingRoot.id, []]))]));
  const patternHits = new Map();
  for (const config of configs) {
    for (const bindingRoot of config.roots) {
      for (const pattern of bindingRoot.targets) patternHits.set(`${config.id}/${bindingRoot.id}/${pattern}`, 0);
    }
  }

  for (const binding of coverage.bindings) {
    const declarationModules = [...new Set(binding.declarations.map((entry) => entry.module))];
    const owners = [...new Set(declarationModules.map((moduleName) => moduleOwners.get(moduleName)).filter(Boolean))];
    let config;
    if (owners.length === 1 && declarationModules.every((moduleName) => moduleOwners.has(moduleName))) {
      [config] = owners;
    } else if (owners.length === 0 && declarationModules.length === 0) {
      const candidates = configs.filter((candidate) => candidate.roots.some((entry) => rootMatches(entry, binding.target)));
      if (candidates.length !== 1) throw new Error(`runtime-only target ${binding.target} has ${candidates.length} configuration owners`);
      [config] = candidates;
    } else {
      const unowned = declarationModules.filter((moduleName) => !moduleOwners.has(moduleName));
      throw new Error(`target ${binding.target} has invalid module ownership${unowned.length ? `; unowned: ${unowned.join(", ")}` : ""}`);
    }
    const roots = config.roots.filter((entry) => rootMatches(entry, binding.target));
    if (roots.length !== 1) {
      throw new Error(`target ${binding.target} must match exactly one root in ${config.path}; found ${roots.length}`);
    }
    const [bindingRoot] = roots;
    assigned.get(config.id).get(bindingRoot.id).push(binding);
    for (const pattern of bindingRoot.targets) {
      if (matchesPattern(binding.target, pattern)) {
        const key = `${config.id}/${bindingRoot.id}/${pattern}`;
        patternHits.set(key, patternHits.get(key) + 1);
      }
    }
  }
  for (const [key, count] of patternHits) {
    if (count === 0) throw new Error(`configured target pattern ${key} matches no shipped binding`);
  }

  const allIssues = [];
  const allRoadmap = [];
  const libraries = [];
  const semanticSummary = Object.fromEntries(semanticStatuses.map((status) => [status, 0]));
  for (const config of configs) {
    const generatedByGroup = new Map();
    if (config.generation !== undefined) {
      const descriptorsByRoot = new Map(config.roots.flatMap((bindingRoot) => {
        const descriptor = typeScriptSurfaces.get(`${config.id}/${bindingRoot.id}`);
        return descriptor === undefined ? [] : [[bindingRoot.id, descriptor]];
      }));
      for (const operation of buildGeneratedOperations(
        config,
        config.generation,
        descriptorsByRoot,
      )) {
        const operations = generatedByGroup.get(operation.group) ?? [];
        operations.push(operation);
        generatedByGroup.set(operation.group, operations);
      }
    }
    const libraryIssues = [];
    const roots = [];
    for (const bindingRoot of config.roots) {
      const bindings = assigned.get(config.id).get(bindingRoot.id).sort((left, right) => left.target.localeCompare(right.target));
      const comparison = await loadComparison(bindingRoot);
      const typescript = typeScriptSurfaces.get(`${config.id}/${bindingRoot.id}`) ?? null;
      const rawSurfaceCoverage = typescript === null
        ? null
        : buildSurfaceCoverage(
          config,
          bindingRoot,
          typescript,
          bindings,
          comparison,
          generatedByGroup.get(bindingRoot.id) ?? [],
        );
      const surfaceCoverage = rawSurfaceCoverage === null
        ? null
        : decorateGenerationCoverage(
          config,
          bindingRoot,
          typescript,
          rawSurfaceCoverage,
          comparison,
        );
      const issues = [];
      for (const binding of bindings) {
        if (binding.status === "missing-provider") {
          issues.push(issue("missing-provider", "error", `${binding.target} has no shipped runtime provider key`, { target: binding.target }));
        } else if (binding.status === "runtime-only") {
          issues.push(issue("runtime-only", "error", `${binding.target} has no compiler declaration`, { target: binding.target }));
        }
      }
      issues.push(...reviewedPublicIssues(
        bindingRoot,
        surfaceCoverage,
        publicByTarget,
        generatedByGroup.get(bindingRoot.id) ?? [],
      ));
      issues.push(...semanticIssues(comparison));
      const roadmap = semanticRoadmap(comparison).map((entry) => ({
        library: config.id,
        group: bindingRoot.id,
        ...entry,
      }));
      if (comparison !== null) {
        for (const status of semanticStatuses) semanticSummary[status] += comparison.summary[status];
        for (const result of comparison.results) {
          if (result.target !== undefined && !bindings.some((binding) => binding.target === result.target)) {
            throw new Error(`${config.id}/${bindingRoot.id} anchor ${result.id} references target outside its root: ${result.target}`);
          }
        }
      }
      const decoratedIssues = issues.map((entry) => ({ library: config.id, group: bindingRoot.id, ...entry }));
      const workItems = groupWorkItems(
        config,
        bindingRoot,
        surfaceCoverage,
        issues,
        generatedByGroup.get(bindingRoot.id) ?? [],
      );
      libraryIssues.push(...decoratedIssues);
      allIssues.push(...decoratedIssues);
      allRoadmap.push(...roadmap);
      roots.push({
        id: bindingRoot.id,
        title: bindingRoot.title,
        ...(bindingRoot.description ? { description: bindingRoot.description } : {}),
        lean: bindingRoot.lean ?? { public: [] },
        upstream: bindingRoot.upstream,
        ...(typescript === null ? {} : { typescript }),
        ...(surfaceCoverage === null ? {} : { coverage: surfaceCoverage }),
        analysis: analysisState(bindingRoot, surfaceCoverage, comparison),
        findingStatus: findingStatus(bindings, issues),
        summary: {
          bindings: bindings.length,
          provided: bindings.filter((entry) => entry.status === "provided").length,
          issues: issues.length,
          roadmap: roadmap.length,
        },
        bindings,
        ...(comparison === null ? {} : { comparison }),
        ...(generatedByGroup.has(bindingRoot.id)
          ? { generatedOperations: generatedByGroup.get(bindingRoot.id) }
          : {}),
        workItems,
        issues: decoratedIssues,
        roadmap,
      });
    }
    libraries.push({
      id: config.id,
      title: config.title,
      description: config.description,
      config: config.path,
      lean: config.lean,
      summary: {
        apiGroups: roots.length,
        bindings: roots.reduce((sum, entry) => sum + entry.summary.bindings, 0),
        issues: libraryIssues.length,
        roadmap: roots.reduce((sum, entry) => sum + entry.summary.roadmap, 0),
      },
      apiGroups: roots,
      issues: libraryIssues,
    });
  }
  libraries.sort((left, right) => left.title.localeCompare(right.title));
  const apiGroups = libraries.flatMap((library) => library.apiGroups);
  const generationGroups = apiGroups.filter((entry) => entry.coverage !== undefined);
  const workItems = apiGroups.flatMap((entry) => entry.workItems);
  const generatedOperations = apiGroups.flatMap((entry) => entry.generatedOperations ?? []);
  const generatedTargets = new Set(generatedOperations.map((operation) => operation.host.target));
  const typescriptDerivedOperations = generatedOperations.filter((operation) =>
    operation.typescript.kind !== "protocol");
  const reviewedProtocolOperations = generatedOperations.filter((operation) =>
    operation.typescript.kind === "protocol");
  const protocolRelations = {
    upstreamAdapters: reviewedProtocolOperations.filter((operation) =>
      operation.protocol.upstreamRelation.kind === "upstream-adapter").length,
    virOwned: reviewedProtocolOperations.filter((operation) =>
      operation.protocol.upstreamRelation.kind === "vir-owned").length,
    localContracts: reviewedProtocolOperations.filter((operation) =>
      operation.protocol.upstreamRelation.kind === "local-contract").length,
    unclassified: reviewedProtocolOperations.filter((operation) =>
      operation.protocol.upstreamRelation.kind === "unclassified").length,
  };
  const semanticRelations = Object.fromEntries([
    "preserving",
    "changing",
    "unreviewed",
    "vir-owned",
    "local-contract",
  ].map((relation) => [
    relation,
    generatedOperations.filter((operation) =>
      operation.semantics?.relation === relation).length,
  ]));
  const hostPolicies = {
    exactValueTransport: generatedOperations.filter((operation) =>
      operation.hostPolicy.valueTransport === "direct").length,
    namedSemanticAdapters: generatedOperations.filter((operation) =>
      operation.hostPolicy.semanticAdapter === "named").length,
    declaredSemanticAdapters: generatedOperations.filter((operation) =>
      operation.hostPolicy.semanticAdapter === "declared").length,
    activeEffects: Object.fromEntries(["register", "use", "release"].map((role) => [
      role,
      generatedOperations.filter((operation) =>
        operation.hostPolicy.activeEffect === role).length,
    ])),
  };
  const generatedSources = new Set(configs.flatMap((config) =>
    config.generation === undefined ? [] : [config.generation.output]));
  const handwrittenDeclarations = coverage.bindings.flatMap((binding) => binding.declarations)
    .filter((declaration) => !generatedSources.has(declaration.source?.path));
  const generationSummary = {
    boundaries: {
      operations: generatedOperations.length,
      targets: generatedTargets.size,
      typescriptDerived: typescriptDerivedOperations.length,
      reviewedProtocols: reviewedProtocolOperations.length,
      handwrittenDeclarations: handwrittenDeclarations.length,
    },
    protocolRelations,
    semanticRelations,
    hostPolicies,
    disposition: Object.fromEntries(generationDispositions.map((status) => [
      status,
      generationGroups.reduce((sum, entry) =>
        sum + entry.coverage.generation.disposition[status], 0),
    ])),
    availability: Object.fromEntries(["available", "candidate", "not-provided"].map((status) => [
      status,
      generationGroups.reduce((sum, entry) =>
        sum + entry.coverage.generation.availability[status], 0),
    ])),
    workItems: workItems.length,
  };
  const coveredGroups = apiGroups.filter((entry) =>
    ["complete", "in-progress", "automatic"].includes(entry.analysis.status));
  const analysisCounts = {
    complete: apiGroups.filter((entry) => entry.analysis.status === "complete").length,
    inProgress: apiGroups.filter((entry) => entry.analysis.status === "in-progress").length,
    automatic: apiGroups.filter((entry) => entry.analysis.status === "automatic").length,
    curated: apiGroups.filter((entry) => entry.analysis.status === "curated").length,
    needsInput: apiGroups.filter((entry) => entry.analysis.status === "needs-input").length,
    notRun: apiGroups.filter((entry) => entry.analysis.status === "not-run").length,
    notApplicable: apiGroups.filter((entry) => entry.analysis.status === "not-applicable").length,
  };
  const issueCounts = { error: 0, warning: 0 };
  for (const entry of allIssues) issueCounts[entry.severity] += 1;
  return {
    format: "lean-vir-binding-explorer",
    version: 1,
    generatedBy: "scripts/bindings/generate-binding-explorer.mjs",
    inputs: {
      coverage: relative(repositoryRoot, coveragePath),
      configs: configs.map((config) => config.path).sort(),
    },
    lean: coverage.lean,
    providers: coverage.providers,
    boundaryAnalysis: coverage.analysis,
    summary: {
      libraries: libraries.length,
      apiGroups: apiGroups.length,
      targets: coverage.summary.totalTargets,
      provided: coverage.summary.provided,
      missingProvider: coverage.summary.missingProvider,
      runtimeOnly: coverage.summary.runtimeOnly,
      publicSurface: {
        entries: coverage.summary.publicEntries,
        targetEdges: coverage.summary.publicTargetEdges,
        reachedTargets: coverage.summary.targetsReachedByPublicEntries,
      },
      analysis: {
        externalGroups: apiGroups.length - analysisCounts.notApplicable,
        ...analysisCounts,
      },
      semantic: semanticSummary,
      upstreamSymbols: apiGroups.reduce((sum, entry) => sum + (entry.typescript?.symbols.length ?? 0), 0),
      coverage: {
        groups: coveredGroups.length,
        members: coveredGroups.reduce((sum, entry) => sum + entry.coverage.members.length, 0),
        evidence: Object.fromEntries(coverageStatuses.map((status) => [
          status,
          coveredGroups.reduce((sum, entry) => sum + entry.coverage.summary[status], 0),
        ])),
      },
      generation: generationSummary,
      issues: issueCounts,
      roadmap: { unsupportedEntries: allRoadmap.length },
    },
    publicEntries: coverage.publicEntries,
    libraries,
    workItems,
    issues: allIssues,
    roadmap: allRoadmap,
  };
}

export function renderBindingExplorerHtml(template, report) {
  const marker = "__VIR_BINDING_REPORT__";
  if (template.split(marker).length !== 2) {
    throw new Error("binding explorer template must contain exactly one report marker");
  }
  const data = scriptSafeJson(report);
  return template.replace(marker, data);
}

export async function runBindingExplorerCli(argv) {
  const options = parseArgs(argv);
  if (options === null) return 0;
  const coverage = await readJson(options.coverage);
  const configPaths = await discoverBindingConfigPaths(options.configDir);
  if (configPaths.length === 0) throw new Error(`no *.bindings.json files found under ${relative(repositoryRoot, options.configDir)}`);
  const configs = [];
  const ids = new Set();
  for (const path of configPaths) {
    const config = await loadBindingConfig(path);
    if (ids.has(config.id)) throw new Error(`duplicate binding-library id ${config.id}`);
    ids.add(config.id);
    configs.push(config);
  }
  const typeScriptSurfaces = await generateTypeScriptSurfaces(configs);
  const report = await buildBindingExplorerReport(coverage, configs, typeScriptSurfaces, options.coverage);
  const outputOptions = {
    check: options.check,
    root: repositoryRoot,
    staleHint: "rerun npm run generate:binding-explorer",
  };
  await Promise.all([
    emitGeneratedFile(options.out, `${JSON.stringify(report, null, 2)}\n`, outputOptions),
    emitGeneratedFile(
      options.html,
      renderBindingExplorerHtml(
        await readFile(join(explorerAssetsDir, "index.html"), "utf8"),
        report,
      ),
      outputOptions,
    ),
    ...["app.js", "style.css"].map(async (asset) =>
      emitGeneratedFile(
        join(dirname(options.html), "assets", asset),
        await readFile(join(explorerAssetsDir, asset), "utf8"),
        outputOptions,
      )),
  ]);
  console.log("\nLean VIR upstream reference, shipped inventory, and author actions");
  console.log(`  libraries: ${report.summary.libraries}`);
  console.log(`  API groups: ${report.summary.apiGroups}`);
  console.log(`  shipped targets: ${report.summary.provided}/${report.summary.targets} with provider keys present`);
  console.log(`  upstream analysis: ${report.summary.analysis.complete} complete, ${report.summary.analysis.inProgress} in progress, ${report.summary.analysis.automatic} automatic, ${report.summary.analysis.curated} curated, ${report.summary.analysis.needsInput} need input, ${report.summary.analysis.notRun} not run`);
  console.log(`  upstream symbols: ${report.summary.upstreamSymbols}`);
  console.log(`  member evidence: ${report.summary.coverage.evidence.derived} TypeScript-derived, ${report.summary.coverage.evidence.exact + report.summary.coverage.evidence.compatible} comparator-checked, ${report.summary.coverage.evidence["protocol-linked"]} protocol-linked, ${report.summary.coverage.evidence["contract-linked"]} contract-linked, ${report.summary.coverage.evidence.weak} weak, ${report.summary.coverage.evidence.unreviewed} awaiting review, ${report.summary.coverage.evidence.suggested} suggested, ${report.summary.coverage.evidence.ambiguous} ambiguous, ${report.summary.coverage.evidence.missing} not provided`);
  console.log(`  boundary generation: ${report.summary.generation.boundaries.targets}/${report.summary.targets} targets generated, ${report.summary.generation.boundaries.typescriptDerived} TypeScript-derived, ${report.summary.generation.boundaries.reviewedProtocols} reviewed protocols (${report.summary.generation.protocolRelations.upstreamAdapters} upstream adapters, ${report.summary.generation.protocolRelations.virOwned} VIR-owned, ${report.summary.generation.protocolRelations.localContracts} local-contract, ${report.summary.generation.protocolRelations.unclassified} unclassified), ${report.summary.generation.boundaries.handwrittenDeclarations} handwritten declarations`);
  console.log(`  semantic relation: ${report.summary.generation.semanticRelations.preserving} preserving, ${report.summary.generation.semanticRelations.changing} explicit adapters, ${report.summary.generation.semanticRelations.unreviewed} require review, ${report.summary.generation.semanticRelations["vir-owned"]} VIR-owned, ${report.summary.generation.semanticRelations["local-contract"]} local-contract`);
  console.log(`  host policy: ${report.summary.generation.hostPolicies.exactValueTransport} exact-value transports, ${report.summary.generation.hostPolicies.namedSemanticAdapters} named semantic adapters, ${Object.values(report.summary.generation.hostPolicies.activeEffects).reduce((sum, count) => sum + count, 0)} private active-effect operations`);
  console.log(`  upstream member review: ${report.summary.generation.disposition.generated} generated, ${report.summary.generation.disposition.adapted} reviewed protocols, ${report.summary.generation.disposition["needs-annotation"]} need annotation, ${report.summary.generation.disposition.unsupported} unsupported, ${report.summary.generation.disposition["not-selected"]} not selected`);
  console.log(`  author actions: ${report.summary.generation.workItems}`);
  const unresolvedSemanticMissing = Math.max(
    0,
    report.summary.semantic.missing - report.summary.roadmap.unsupportedEntries,
  );
  console.log(`  semantic comparison: ${report.summary.semantic.weak} weak, ${unresolvedSemanticMissing} unresolved missing, ${report.summary.roadmap.unsupportedEntries} reviewed unsupported`);
  console.log(`  issues: ${report.summary.issues.error} errors, ${report.summary.issues.warning} warnings`);
  console.log(`  roadmap: ${report.summary.roadmap.unsupportedEntries} explicitly unsupported upstream entries; unselected entries remain coverage only`);
  console.log(`  artifacts: ${options.check ? "validated" : "wrote"} ${relative(repositoryRoot, options.out)}`);
  console.log(`             ${options.check ? "validated" : "wrote"} ${relative(repositoryRoot, options.html)}`);
  if (report.summary.issues.error !== 0) {
    throw new Error(`binding explorer found ${report.summary.issues.error} binding-surface errors`);
  }
  return 0;
}
