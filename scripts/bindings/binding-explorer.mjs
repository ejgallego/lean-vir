#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile, readdir } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateDescriptorFile } from "./typescript-descriptors.mjs";
import { emitGeneratedFile, fail, requiredValue } from "./tool-utils.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const explorerAssetsDir = resolve(repositoryRoot, "web/tools/binding-explorer");
const semanticStatuses = ["exact", "compatible", "weak", "missing"];

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
    if (option === "--coverage") options.coverage = resolve(repositoryRoot, requiredValue(argv, ++index, option));
    else if (option === "--config-dir") options.configDir = resolve(repositoryRoot, requiredValue(argv, ++index, option));
    else if (option === "--out") options.out = resolve(repositoryRoot, requiredValue(argv, ++index, option));
    else if (option === "--html") options.html = resolve(repositoryRoot, requiredValue(argv, ++index, option));
    else if (option === "--check") options.check = true;
    else fail(`unknown option ${option}`);
  }
  if (options.coverage === null || options.out === null || options.html === null) {
    fail("usage: generate-binding-explorer.mjs --coverage FILE --out FILE --html FILE [--config-dir DIR] [--check]");
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

async function discoverConfigs(directory) {
  const paths = [];
  async function visit(path) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) await visit(child);
      else if (entry.isFile() && entry.name.endsWith(".bindings.json")) paths.push(child);
    }
  }
  await visit(directory);
  return paths.sort();
}

function nonemptyString(value) {
  return typeof value === "string" && value.length !== 0;
}

function validateConfig(value, path) {
  const label = relative(repositoryRoot, path);
  if (value?.version !== 1 || !nonemptyString(value.id) || !nonemptyString(value.title) ||
      !nonemptyString(value.description) || !Array.isArray(value.lean?.modules) ||
      value.lean.modules.length === 0 || !Array.isArray(value.roots) || value.roots.length === 0) {
    throw new Error(`${label} is not a binding-library v1 configuration`);
  }
  const rootIds = new Set();
  for (const [index, bindingRoot] of value.roots.entries()) {
    if (!nonemptyString(bindingRoot?.id) || !nonemptyString(bindingRoot?.title) ||
        !Array.isArray(bindingRoot.targets) || bindingRoot.targets.length === 0 ||
        !["typescript", "local", "internal"].includes(bindingRoot.upstream?.kind)) {
      throw new Error(`${label} roots[${index}] is invalid`);
    }
    if (rootIds.has(bindingRoot.id)) throw new Error(`${label} repeats root id ${bindingRoot.id}`);
    rootIds.add(bindingRoot.id);
    for (const pattern of bindingRoot.targets) validateTargetPattern(pattern, `${label} root ${bindingRoot.id}`);
    if (bindingRoot.upstream.kind === "typescript" &&
        (!Array.isArray(bindingRoot.upstream.declarations) || !Array.isArray(bindingRoot.upstream.roots))) {
      throw new Error(`${label} root ${bindingRoot.id} must identify TypeScript declarations and roots`);
    }
    if (bindingRoot.anchors !== undefined && !Array.isArray(bindingRoot.anchors)) {
      throw new Error(`${label} root ${bindingRoot.id} anchors must be an array`);
    }
    if (bindingRoot.mappings !== undefined && !Array.isArray(bindingRoot.mappings)) {
      throw new Error(`${label} root ${bindingRoot.id} mappings must be an array`);
    }
    for (const [mappingIndex, mapping] of (bindingRoot.mappings ?? []).entries()) {
      const direct = Array.isArray(mapping?.targets) && mapping.targets.length !== 0 &&
        mapping.targets.every(nonemptyString) && mapping.accessors === undefined;
      const accessorNames = mapping?.accessors && typeof mapping.accessors === "object" &&
        !Array.isArray(mapping.accessors) ? Object.keys(mapping.accessors) : [];
      const property = mapping?.targets === undefined && accessorNames.length !== 0 &&
        accessorNames.every((accessor) => ["get", "set"].includes(accessor)) &&
        accessorNames.every((accessor) => {
          const operation = mapping.accessors[accessor];
          return (nonemptyString(operation?.target) && nonemptyString(operation?.lean) &&
            nonemptyString(operation?.anchor) && operation.missing === undefined) ||
            (operation?.missing === true && nonemptyString(operation.note) &&
              operation.target === undefined && operation.lean === undefined &&
              operation.anchor === undefined);
        });
      if (!nonemptyString(mapping?.typescript) || (!direct && !property)) {
        throw new Error(`${label} root ${bindingRoot.id} mappings[${mappingIndex}] is invalid`);
      }
    }
  }
  return { ...value, path: label };
}

function validateTargetPattern(pattern, context) {
  if (!nonemptyString(pattern) || (pattern.includes("*") && !pattern.endsWith("*")) ||
      pattern.slice(0, -1).includes("*")) {
    throw new Error(`${context} has invalid target pattern ${JSON.stringify(pattern)}`);
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
      if (bindingRoot.upstream.kind !== "typescript") continue;
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

function explorerTypeScriptSymbol({ shape: _shape, ...symbol }) {
  if (symbol.kind !== "interface") return symbol;
  const header = symbol.display.slice(0, symbol.display.indexOf("{")).trim();
  return { ...symbol, display: `${header} { … }` };
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
    } else if (result.status === "missing") {
      issues.push(issue(
        result.relation === "coverageGap" ? "coverage-gap" : "missing-descriptor",
        result.relation === "coverageGap" ? "gap" : "error",
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

function analysisState(bindingRoot, coverage, comparison) {
  if (bindingRoot.upstream.kind === "internal") {
    return { status: "not-applicable", scope: "no-upstream-contract" };
  }
  if (coverage?.mode === "reviewed") {
    return comparison !== null && coverage.summary.unreviewed === 0
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
  if (issues.some((entry) => entry.severity === "gap")) return "gap";
  return "none";
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

function buildSurfaceCoverage(config, bindingRoot, typeScript, bindings, comparison) {
  if (!Array.isArray(bindingRoot.mappings)) {
    return buildSuggestedSurfaceCoverage(bindingRoot, typeScript, bindings);
  }
  const symbolsById = new Map(typeScript.symbols.map((symbol) => [symbol.id, symbol]));
  const bindingsByTarget = new Map(bindings.map((binding) => [binding.target, binding]));
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
    if (mapping.accessors !== undefined) {
      const readonly = /^readonly\s/u.test(symbol.display);
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
      : mappedOperations.map((operation) => resultsById.get(operation.anchor));
    mappings.set(mapping.typescript, {
      ...mapping,
      operations,
      targets: mappedOperations.map((operation) => operation.target),
      lean: mappedOperations.flatMap((operation) => operation.lean),
      status: operations.some((operation) => operation.missing === true)
        ? "missing"
        : worstSemanticStatus(results),
      anchors: results.map((result) => result.id),
    });
  }
  if (mappedTargets.size !== bindings.length) {
    const missing = bindings.filter((binding) => !mappedTargets.has(binding.target)).map((binding) => binding.target);
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
  const summary = { exact: 0, compatible: 0, weak: 0, missing: 0, unreviewed: 0 };
  for (const member of members) summary[member.status] += 1;
  const targetMappings = [...mappings.values()].flatMap((mapping) =>
    mapping.operations.filter((operation) => operation.missing !== true).map((operation) => {
      const operationResults = operation.anchor === undefined
        ? (resultsByTypeScript.get(mapping.typescript) ?? []).filter((result) =>
            result.target === operation.target)
        : [resultsById.get(operation.anchor)];
      return {
        target: operation.target,
        status: worstSemanticStatus(operationResults),
        source: "reviewed",
        typescript: mapping.typescript,
        lean: operation.lean,
        anchors: operationResults.map((result) => result.id),
        ...(operation.accessor === undefined ? {} : { accessor: operation.accessor }),
      };
    }));
  return {
    mode: "reviewed",
    summary: { ...summary, mappedTargets: mappedTargets.size },
    members,
    targetMappings,
  };
}

function buildSuggestedSurfaceCoverage(bindingRoot, typeScript, bindings) {
  const roots = new Set(bindingRoot.upstream.roots);
  const members = typeScript.symbols.filter((symbol) =>
    symbol.surfaceRoot !== undefined || (roots.has(symbol.id) && symbol.kind !== "interface"));
  const targetMappings = bindings.map((binding) => suggestTargetMapping(binding.target, members));
  const mappedMembers = new Map();
  for (const mapping of targetMappings) {
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
  const summary = {
    exact: 0,
    compatible: 0,
    weak: 0,
    missing: coveredMembers.filter((member) => member.status === "missing").length,
    unreviewed: coveredMembers.filter((member) => member.status !== "missing").length,
    suggested: coveredMembers.filter((member) => member.status === "suggested").length,
    ambiguous: coveredMembers.filter((member) => member.status === "ambiguous").length,
    mappedTargets: targetMappings.filter((mapping) => mapping.status === "suggested").length,
    ambiguousTargets: targetMappings.filter((mapping) => mapping.status === "ambiguous").length,
    unmatchedTargets: targetMappings.filter((mapping) => mapping.status === "unmatched").length,
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

function accessorPublicIssues(bindingRoot, surfaceCoverage, publicByTarget) {
  if (surfaceCoverage?.mode !== "reviewed") return [];
  const selectors = bindingRoot.lean?.public ?? [];
  const issues = [];
  for (const mapping of surfaceCoverage.targetMappings.filter((entry) =>
    entry.accessor !== undefined)) {
    const callers = publicByTarget.get(mapping.target) ?? [];
    for (const declaration of mapping.lean) {
      if (!callers.some((caller) => caller.entry.declaration === declaration)) {
        issues.push(issue(
          "mapped-public-api-unreachable",
          "error",
          `${declaration} is the reviewed ${mapping.accessor} accessor for ${mapping.typescript}, but compiled IR does not reach ${mapping.target}`,
          { target: mapping.target, declaration, typescript: mapping.typescript,
            accessor: mapping.accessor },
        ));
      }
    }
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
  const libraries = [];
  const semanticSummary = Object.fromEntries(semanticStatuses.map((status) => [status, 0]));
  for (const config of configs) {
    const libraryIssues = [];
    const roots = [];
    for (const bindingRoot of config.roots) {
      const bindings = assigned.get(config.id).get(bindingRoot.id).sort((left, right) => left.target.localeCompare(right.target));
      const comparison = await loadComparison(bindingRoot);
      const typescript = typeScriptSurfaces.get(`${config.id}/${bindingRoot.id}`) ?? null;
      const surfaceCoverage = typescript === null
        ? null
        : buildSurfaceCoverage(config, bindingRoot, typescript, bindings, comparison);
      const issues = [];
      for (const binding of bindings) {
        if (binding.status === "missing-provider") {
          issues.push(issue("missing-provider", "error", `${binding.target} has no shipped runtime provider`, { target: binding.target }));
        } else if (binding.status === "runtime-only") {
          issues.push(issue("runtime-only", "error", `${binding.target} has no compiler declaration`, { target: binding.target }));
        }
      }
      if (surfaceCoverage !== null && surfaceCoverage.summary.missing !== 0 &&
          !(comparison !== null && surfaceCoverage.mode === "automatic")) {
        issues.push(issue(
          surfaceCoverage.mode === "reviewed" ? "upstream-members-missing" : "upstream-members-unmapped",
          "gap",
          surfaceCoverage.mode === "reviewed"
            ? `${surfaceCoverage.summary.missing} of ${surfaceCoverage.members.length} upstream members have no shipped VIR binding`
            : `${surfaceCoverage.summary.missing} of ${surfaceCoverage.members.length} upstream entries have no automatic VIR mapping candidate`,
        ));
      }
      issues.push(...accessorPublicIssues(bindingRoot, surfaceCoverage, publicByTarget));
      issues.push(...semanticIssues(comparison));
      if (comparison !== null) {
        for (const status of semanticStatuses) semanticSummary[status] += comparison.summary[status];
        for (const result of comparison.results) {
          if (result.target !== undefined && !bindings.some((binding) => binding.target === result.target)) {
            throw new Error(`${config.id}/${bindingRoot.id} anchor ${result.id} references target outside its root: ${result.target}`);
          }
        }
      }
      const decoratedIssues = issues.map((entry) => ({ library: config.id, group: bindingRoot.id, ...entry }));
      libraryIssues.push(...decoratedIssues);
      allIssues.push(...decoratedIssues);
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
        },
        bindings,
        ...(comparison === null ? {} : { comparison }),
        issues: decoratedIssues,
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
      },
      apiGroups: roots,
      issues: libraryIssues,
    });
  }
  libraries.sort((left, right) => left.title.localeCompare(right.title));
  const apiGroups = libraries.flatMap((library) => library.apiGroups);
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
  const issueCounts = { error: 0, warning: 0, gap: 0 };
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
        reviewed: coveredGroups.reduce((sum, entry) =>
          sum + entry.coverage.members.filter((member) =>
            ["exact", "compatible", "weak"].includes(member.status)).length, 0),
        suggested: coveredGroups.reduce((sum, entry) =>
          sum + entry.coverage.members.filter((member) => member.status === "suggested").length, 0),
        ambiguous: coveredGroups.reduce((sum, entry) =>
          sum + entry.coverage.members.filter((member) => member.status === "ambiguous").length, 0),
        missing: coveredGroups.reduce((sum, entry) => sum + entry.coverage.summary.missing, 0),
      },
      issues: issueCounts,
    },
    publicEntries: coverage.publicEntries,
    libraries,
    issues: allIssues,
  };
}

export function renderBindingExplorerHtml(template, report) {
  const marker = "__VIR_BINDING_REPORT__";
  if (template.split(marker).length !== 2) {
    throw new Error("binding explorer template must contain exactly one report marker");
  }
  const data = JSON.stringify(report).replaceAll("<", "\\u003c");
  return template.replace(marker, data);
}

export async function runBindingExplorerCli(argv) {
  const options = parseArgs(argv);
  try {
  const coverage = await readJson(options.coverage);
  const configPaths = await discoverConfigs(options.configDir);
  if (configPaths.length === 0) throw new Error(`no *.bindings.json files found under ${relative(repositoryRoot, options.configDir)}`);
  const configs = [];
  const ids = new Set();
  for (const path of configPaths) {
    const config = validateConfig(await readJson(path), path);
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
  console.log("\nLean VIR binding explorer");
  console.log(`  libraries: ${report.summary.libraries}`);
  console.log(`  API groups: ${report.summary.apiGroups}`);
  console.log(`  shipped targets: ${report.summary.provided}/${report.summary.targets} provided`);
  console.log(`  upstream analysis: ${report.summary.analysis.complete} reviewed, ${report.summary.analysis.automatic} automatic, ${report.summary.analysis.curated} curated, ${report.summary.analysis.notRun} not run`);
  console.log(`  upstream symbols: ${report.summary.upstreamSymbols}`);
  console.log(`  member coverage: ${report.summary.coverage.reviewed} reviewed, ${report.summary.coverage.suggested} suggested, ${report.summary.coverage.ambiguous} ambiguous, ${report.summary.coverage.missing} unmapped`);
  console.log(`  findings: ${report.summary.semantic.weak} weak, ${report.summary.semantic.missing} missing`);
  console.log(`  issues: ${report.summary.issues.error} errors, ${report.summary.issues.warning} warnings, ${report.summary.issues.gap} gaps`);
  console.log(`  artifacts: ${options.check ? "validated" : "wrote"} ${relative(repositoryRoot, options.out)}`);
  console.log(`             ${options.check ? "validated" : "wrote"} ${relative(repositoryRoot, options.html)}`);
  if (report.summary.issues.error !== 0) {
    fail(`binding explorer found ${report.summary.issues.error} binding-surface errors`);
  }
  } catch (error) {
    fail(error.message);
  }
}
