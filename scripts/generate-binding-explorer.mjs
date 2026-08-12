#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateDescriptorFile } from "./generate-ts-descriptors.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const semanticStatuses = ["exact", "compatible", "weak", "missing"];

function fail(message) {
  console.error(`error: ${message}`);
  process.exit(1);
}

function requiredValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) fail(`${option} requires a value`);
  return value;
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
  if (report?.version !== 1 || report.generatedBy !== "scripts/check-type-anchors.mjs" ||
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

async function buildReport(coverage, configs, typeScriptSurfaces) {
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
    generatedBy: "scripts/generate-binding-explorer.mjs",
    inputs: {
      coverage: "docs/bindings/shipped-v1.coverage.json",
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

function renderHtml(report) {
  const data = JSON.stringify(report).replaceAll("<", "\\u003c");
  const analysis = report.summary.analysis;
  const completeGroups = `${analysis.complete} external API group${analysis.complete === 1 ? "" : "s"} ${analysis.complete === 1 ? "has" : "have"} a complete upstream-surface analysis`;
  const automaticGroups = `${analysis.automatic} ${analysis.automatic === 1 ? "has" : "have"} automatic mapping suggestions awaiting review`;
  const curatedGroups = `${analysis.curated} ${analysis.curated === 1 ? "has" : "have"} a curated comparison only`;
  const inputGroups = `${analysis.needsInput} local API group${analysis.needsInput === 1 ? "" : "s"} need upstream contract input`;
  const internalGroups = `${analysis.notApplicable} internal API group${analysis.notApplicable === 1 ? "" : "s"} ${analysis.notApplicable === 1 ? "has" : "have"} no upstream parity contract`;
  return `<!doctype html>
<!-- Generated by scripts/generate-binding-explorer.mjs; regenerate instead of editing. -->
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Lean VIR binding explorer</title>
  <style>
    :root { --bg:#071018; --panel:#0d1924; --panel2:#111f2c; --text:#ecf5f7; --muted:#8ea8b5; --line:#243744; --mint:#65e0b1; --blue:#75baff; --amber:#ffc768; --red:#ff7c88; --purple:#bd9cff; --shadow:0 24px 80px #0008; }
    :root[data-theme="light"] { --bg:#eef5f4; --panel:#fff; --panel2:#f5faf9; --text:#15252c; --muted:#5e7680; --line:#ccdcda; --shadow:0 24px 70px #31546422; }
    * { box-sizing:border-box; } html { scroll-behavior:smooth; } body { margin:0; min-height:100vh; color:var(--text); background:radial-gradient(circle at 12% -10%,#1b696855,transparent 34rem),radial-gradient(circle at 90% 10%,#315b9b44,transparent 30rem),var(--bg); font:15px/1.5 Inter,ui-sans-serif,system-ui,sans-serif; }
    button,input,select { font:inherit; } button { color:inherit; } a { color:var(--mint); } main { width:min(1580px,calc(100% - 32px)); margin:auto; padding:38px 0 64px; }
    header { display:flex; justify-content:space-between; gap:24px; align-items:flex-start; } .eyebrow { color:var(--mint); text-transform:uppercase; letter-spacing:.16em; font-weight:800; font-size:12px; }
    h1 { margin:7px 0 9px; font-size:clamp(36px,5vw,68px); line-height:1; letter-spacing:-.05em; } .lede { max-width:900px; color:var(--muted); font-size:17px; margin:0; } .theme { border:1px solid var(--line); background:var(--panel); border-radius:999px; padding:9px 14px; cursor:pointer; white-space:nowrap; }
    .metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:25px 0 16px; } .metric { background:linear-gradient(145deg,var(--panel),var(--panel2)); border:1px solid var(--line); border-radius:18px; padding:18px; box-shadow:var(--shadow); }
    .metric strong { display:block; font-size:32px; line-height:1.1; } .metric span { color:var(--muted); } .good strong { color:var(--mint); } .warn strong { color:var(--amber); } .bad strong { color:var(--red); }
    .scope { border:1px solid var(--line); border-radius:16px; padding:14px 18px; color:var(--muted); background:#0002; margin-bottom:16px; } .scope b { color:var(--text); }
    .workspace { display:grid; grid-template-columns:minmax(400px,.82fr) minmax(560px,1.35fr); min-height:760px; border:1px solid var(--line); border-radius:22px; overflow:hidden; background:var(--panel); box-shadow:var(--shadow); }
    .left { border-right:1px solid var(--line); min-width:0; } .view-tabs { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; padding:14px 14px 0; background:var(--panel2); } .view-tab { border:1px solid var(--line); border-radius:11px; padding:9px; background:var(--bg); cursor:pointer; } .view-tab.active { color:var(--mint); border-color:#65e0b166; background:#65e0b10d; } .toolbar { padding:10px 14px 14px; display:grid; grid-template-columns:1fr 190px; gap:9px; border-bottom:1px solid var(--line); background:var(--panel2); }
    input,select { width:100%; color:var(--text); background:var(--bg); border:1px solid var(--line); border-radius:11px; padding:10px 12px; outline:none; } input:focus,select:focus { border-color:var(--mint); box-shadow:0 0 0 3px #65e0b122; }
    .filters { display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:0 14px 14px; background:var(--panel2); border-bottom:1px solid var(--line); } .result-head { padding:10px 15px; color:var(--muted); border-bottom:1px solid var(--line); }
    #results { max-height:670px; overflow:auto; } .row { width:100%; display:grid; grid-template-columns:1fr auto; gap:8px; text-align:left; padding:13px 15px; border:0; border-bottom:1px solid var(--line); background:transparent; cursor:pointer; }
    .row:hover,.row.active { background:#65e0b10d; } .row.active { box-shadow:inset 3px 0 var(--mint); } .name { font:650 13px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace; overflow-wrap:anywhere; } .sub { display:block; color:var(--muted); font-size:12px; margin-top:4px; }
    .pill,.badge { display:inline-flex; align-items:center; width:max-content; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:11px; font-weight:750; } .complete,.provided,.exact,.compatible,.public-api { color:var(--mint); border-color:#65e0b166; } .automatic,.suggested,.not-run,.in-progress,.needs-input,.weak,.warning { color:var(--amber); border-color:#ffc76866; } .ambiguous,.unmatched,.gap { color:var(--purple); border-color:#bd9cff66; } .error,.missing-provider,.runtime-only { color:var(--red); border-color:#ff7c8866; } .curated,.not-applicable { color:var(--blue); border-color:#75baff66; }
    .detail { padding:26px; min-width:0; overflow:auto; max-height:760px; } .detail h2 { font-size:clamp(28px,4vw,46px); line-height:1.05; margin:8px 0; letter-spacing:-.035em; overflow-wrap:anywhere; } .detail h3 { margin:0 0 12px; font-size:13px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted); }
    .badges { display:flex; flex-wrap:wrap; gap:7px; margin:12px 0 18px; } .badge { color:var(--blue); } .section { border-top:1px solid var(--line); padding-top:20px; margin-top:20px; }
    .issue,.anchor,.binding { border:1px solid var(--line); border-radius:15px; padding:14px; margin:10px 0; background:var(--panel2); } .issue { border-left-width:4px; } .issue.error { border-left-color:var(--red); } .issue.warning,.issue.review { border-left-color:var(--amber); } .issue.gap { border-left-color:var(--purple); }
    .card-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; } .card-title { font:700 13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; overflow-wrap:anywhere; } .note { color:var(--muted); margin:8px 0 0; } .inline-button { border:0; padding:0; background:none; color:var(--mint); cursor:pointer; text-decoration:underline; }
    details summary { cursor:pointer; } pre { margin:10px 0 0; padding:12px; border-radius:11px; background:var(--bg); color:#c9e6ff; white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; } :root[data-theme="light"] pre { color:#19517e; }
    .panes { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px; } .pane { min-width:0; } .pane-title { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.1em; } .source { font-size:12px; white-space:nowrap; } .empty { color:var(--muted); padding:30px; text-align:center; } .path { font-size:11px; }
    @media (max-width:1050px) { .workspace { grid-template-columns:1fr; } .left { border-right:0; border-bottom:1px solid var(--line); } #results { max-height:420px; } .detail { max-height:none; } }
    @media (max-width:680px) { main { width:min(100% - 18px,1580px); padding-top:24px; } header { display:block; } .theme { margin-top:16px; } .metrics { grid-template-columns:1fr 1fr; } .toolbar,.filters,.panes { grid-template-columns:1fr; } }
  </style>
</head>
<body><main>
  <header><div><div class="eyebrow">Lean VIR · runtime coverage and API fidelity</div><h1>Binding explorer</h1><p class="lede">Every configured TypeScript API group is fully indexed before display. Automatic correspondence candidates are review leads; only reviewed mappings receive type-fidelity verdicts.</p></div><button class="theme" id="theme" type="button">Toggle theme</button></header>
  <section class="metrics">
    <article class="metric good"><strong id="provided-metric">${report.summary.provided}/${report.summary.targets}</strong><span>runtime targets provided</span></article>
    <article class="metric"><strong>${report.summary.analysis.complete + report.summary.analysis.automatic}/${report.summary.analysis.externalGroups}</strong><span>TypeScript surfaces fully indexed</span></article>
    <article class="metric ${report.summary.semantic.weak + report.summary.semantic.missing + report.summary.coverage.missing === 0 ? "good" : "warn"}"><strong>${report.summary.semantic.weak + report.summary.semantic.missing + report.summary.coverage.missing}</strong><span>member/type findings</span></article>
    <article class="metric ${report.summary.analysis.automatic === 0 ? "good" : "warn"}"><strong>${report.summary.analysis.automatic}</strong><span>automatic analyses need review</span></article>
  </section>
  <div class="scope"><b>Measured surface:</b> ${report.summary.libraries} libraries · ${report.summary.apiGroups} API groups · ${report.summary.publicSurface.entries} public Lean APIs · ${report.summary.targets} compiler/runtime targets · ${report.summary.publicSurface.targetEdges} compiler-proven API/target paths. ${completeGroups}; ${automaticGroups}; ${curatedGroups}; ${inputGroups}; ${internalGroups}.</div>
  <section class="workspace">
    <div class="left">
      <div class="view-tabs"><button class="view-tab" id="groups-view" type="button">Upstream libraries</button><button class="view-tab" id="public-view" type="button">Public Lean API</button><button class="view-tab" id="targets-view" type="button">Host targets</button></div>
      <div class="toolbar"><input id="search" type="search" placeholder="Search library, API group, target, type…" aria-label="Search bindings"><select id="analysis"><option value="all">All analysis states</option><option value="complete">Complete surface analysis</option><option value="automatic">Automatic analysis · review needed</option><option value="in-progress">Analysis in progress</option><option value="curated">Curated comparison only</option><option value="needs-input">Upstream contract needs input</option><option value="not-run">Upstream analysis not run</option><option value="not-applicable">No upstream contract</option></select></div>
      <div class="filters"><select id="library"><option value="all">All libraries</option>${report.libraries.map((entry) => `<option value="${entry.id}">${entry.title}</option>`).join("")}</select><select id="issue"><option value="all">All findings</option><option value="error">Errors</option><option value="warning">Type warnings</option><option value="gap">Coverage gaps</option><option value="none">No findings</option></select></div>
      <div class="result-head" id="count"></div><div id="results"></div>
    </div>
    <article class="detail" id="detail"></article>
  </section>
</main>
<script id="report-data" type="application/json">${data}</script>
<script>
  const report = JSON.parse(document.querySelector("#report-data").textContent);
  const groups = report.libraries.flatMap((library) => library.apiGroups.map((group) => ({ ...group, library })));
  const groupById = new Map(groups.map((group) => [group.library.id + "/" + group.id, group]));
  const publicEntries = report.publicEntries;
  const publicById = new Map(publicEntries.map((entry) => [entry.declaration, entry]));
  const publicByTarget = new Map();
  for (const entry of publicEntries) for (const reach of entry.targets) {
    const callers = publicByTarget.get(reach.target) || [];
    callers.push({ entry, reach });
    publicByTarget.set(reach.target, callers);
  }
  const targets = groups.flatMap((group) => group.bindings.map((binding) => ({
    ...binding,
    group,
    mapping: group.coverage?.targetMappings?.find((entry) => entry.target === binding.target) || null,
    comparison: group.comparison?.results?.find((entry) => entry.target === binding.target) || null,
    publicEntries: publicByTarget.get(binding.target) || [],
  })));
  const targetById = new Map(targets.map((target) => [target.target, target]));
  const elements = Object.fromEntries(["search","analysis","library","issue","count","results","detail","theme","groups-view","public-view","targets-view"].map((id) => [id, document.querySelector("#" + id)]));
  const hashTarget = location.hash.match(/^#target=(.*)$/);
  const hashPublic = location.hash.match(/^#lean=(.*)$/);
  let view = hashPublic ? "public" : hashTarget ? "targets" : "groups";
  let selected = decodeURIComponent(hashPublic?.[1] ?? hashTarget?.[1] ?? location.hash.replace(/^#(?:group|root)=/, ""));
  if (view === "public" && !publicById.has(selected)) selected = publicEntries[0]?.declaration ?? "";
  if (view === "targets" && !targetById.has(selected)) selected = targets[0]?.target ?? "";
  if (view === "groups" && !groupById.has(selected)) { const finding=groups.find((group)=>group.findingStatus!=="none"); selected=finding ? finding.library.id+"/"+finding.id : (groups[0] ? groups[0].library.id+"/"+groups[0].id : ""); }
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[character]));
  const analysisLabel = (value) => ({ complete:"complete surface analysis", automatic:"automatic analysis · review needed", "in-progress":"analysis in progress", curated:"curated comparison only", "needs-input":"upstream contract needs input", "not-run":"upstream analysis not run", "not-applicable":"no upstream contract" }[value] || value);
  function groupText(group) { return [group.library.title,group.title,group.description,...(group.lean.public || []),...(group.upstream.roots || []),...(group.typescript?.symbols || []).flatMap((symbol) => [symbol.id,symbol.display,symbol.hover]),...group.bindings.flatMap((binding) => [binding.target,...binding.declarations.flatMap((decl) => [decl.declaration,decl.type])]),...(group.comparison?.results || []).flatMap((item) => [item.lean,item.ts,item.note,...(item.notes || [])])].join(" ").toLowerCase(); }
  function groupFiltersMatch(group) { const issue=elements.issue.value; return (elements.analysis.value === "all" || group.analysis.status === elements.analysis.value) && (elements.library.value === "all" || group.library.id === elements.library.value) && (issue === "all" || (issue === "none" ? group.issues.length === 0 : group.issues.some((entry) => entry.severity === issue))); }
  function groupMatches(group) { const query=elements.search.value.trim().toLowerCase(); return groupFiltersMatch(group) && (!query || groupText(group).includes(query)); }
  function targetMatches(target) { const query=elements.search.value.trim().toLowerCase(); const text=[target.target,...target.providers,...target.declarations.flatMap((decl)=>[decl.declaration,decl.type]),...target.publicEntries.flatMap((item)=>[item.entry.declaration,item.entry.type,...item.reach.path]),...(target.mapping?.candidates || []).map((candidate)=>candidate.typescript),target.mapping?.typescript].join(" ").toLowerCase(); return groupFiltersMatch(target.group) && (!query || text.includes(query)); }
  function entryGroups(entry) { return [...new Set(entry.targets.map((reach)=>targetById.get(reach.target)?.group).filter(Boolean))]; }
  function publicMatches(entry) { const query=elements.search.value.trim().toLowerCase(); const associated=entryGroups(entry); const text=[entry.declaration,entry.module,entry.type,...entry.targets.flatMap((reach)=>[reach.target,...reach.path])].join(" ").toLowerCase(); return associated.some(groupFiltersMatch) && (!query || text.includes(query)); }
  function render() { for(const name of ["groups","public","targets"]) elements[name+"-view"].classList.toggle("active",view===name); if(view==="groups") renderGroups(); else if(view==="public") renderPublicEntries(); else renderTargets(); }
  function renderGroups() { const visible=groups.filter(groupMatches); elements.count.textContent=visible.length + (visible.length === 1 ? " API group" : " API groups"); elements.results.innerHTML=visible.length === 0 ? '<div class="empty">No API groups match these filters.</div>' : visible.map((group) => { const id=group.library.id+"/"+group.id; const findings=group.summary.issues===0?'':(' · '+group.summary.issues+(group.summary.issues===1?' finding':' findings')); return '<button type="button" class="row '+(id===selected?'active':'')+'" data-id="'+escapeHtml(id)+'"><span><span class="name">'+escapeHtml(group.library.title+" · "+group.title)+'</span><span class="sub">runtime '+group.summary.provided+'/'+group.summary.bindings+' provided'+findings+'</span></span><span class="pill '+escapeHtml(group.analysis.status)+'">'+escapeHtml(analysisLabel(group.analysis.status))+'</span></button>'; }).join(""); elements.results.querySelectorAll("[data-id]").forEach((button) => button.addEventListener("click", () => selectGroup(button.dataset.id))); renderGroupDetail(groupById.get(selected)); }
  function renderPublicEntries() { const visible=publicEntries.filter(publicMatches); elements.count.textContent=visible.length + (visible.length === 1 ? " public Lean API" : " public Lean APIs"); elements.results.innerHTML=visible.length === 0 ? '<div class="empty">No public Lean APIs match these filters.</div>' : visible.map((entry) => '<button type="button" class="row '+(entry.declaration===selected?'active':'')+'" data-lean="'+escapeHtml(entry.declaration)+'"><span><span class="name">'+escapeHtml(entry.declaration)+'</span><span class="sub">'+escapeHtml(entry.module)+' · '+entry.targets.length+(entry.targets.length===1?' host target':' host targets')+'</span></span><span class="pill public-api">public API</span></button>').join(""); elements.results.querySelectorAll("[data-lean]").forEach((button)=>button.addEventListener("click",()=>selectPublic(button.dataset.lean))); renderPublicDetail(publicById.get(selected)); }
  function renderTargets() { const visible=targets.filter(targetMatches); elements.count.textContent=visible.length + (visible.length === 1 ? " host target" : " host targets"); elements.results.innerHTML=visible.length === 0 ? '<div class="empty">No host targets match these filters.</div>' : visible.map((target) => { const mapping=targetMappingState(target); return '<button type="button" class="row '+(target.target===selected?'active':'')+'" data-target="'+escapeHtml(target.target)+'"><span><span class="name">'+escapeHtml(target.target)+'</span><span class="sub">'+escapeHtml(target.group.library.title+" · "+target.group.title)+" · "+escapeHtml(target.providers.join(", "))+'</span></span><span class="pill '+escapeHtml(mapping.status)+'">'+escapeHtml(mapping.label)+'</span></button>'; }).join(""); elements.results.querySelectorAll("[data-target]").forEach((button) => button.addEventListener("click", () => selectTarget(button.dataset.target))); renderTargetDetail(targetById.get(selected)); }
  function selectGroup(id) { view="groups"; selected=id; history.replaceState(null,"","#group="+encodeURIComponent(id)); render(); }
  function selectPublic(id) { view="public"; selected=id; history.replaceState(null,"","#lean="+encodeURIComponent(id)); render(); }
  function selectTarget(id) { view="targets"; selected=id; history.replaceState(null,"","#target="+encodeURIComponent(id)); render(); }
  function primaryReach(entry) { const size=Math.min(...entry.targets.map((reach)=>reach.path.length)); return entry.targets.find((reach)=>reach.path.length===size); }
  function currentTarget() { if(view==="targets") return targetById.get(selected); if(view==="public") return targetById.get(primaryReach(publicById.get(selected))?.target); return targetById.get(groupById.get(selected)?.bindings[0]?.target); }
  function showGroups() { const target=currentTarget(); selectGroup(target ? target.group.library.id+"/"+target.group.id : groups[0]?.library.id+"/"+groups[0]?.id); }
  function showPublic() { const target=currentTarget(); const entry=target ? preferredPublicEntries(target)[0]?.entry : null; selectPublic(entry?.declaration ?? publicEntries[0]?.declaration ?? ""); }
  function showTargets() { const target=currentTarget(); selectTarget(target?.target ?? targets[0]?.target ?? ""); }
  function badges(values) { return values.map((value) => '<span class="badge">'+escapeHtml(value)+'</span>').join(""); }
  function targetMappingState(target) { if(target.comparison) return {status:target.comparison.status,label:target.comparison.status}; if(target.mapping) return {status:target.mapping.status,label:target.mapping.status}; if(target.group.analysis.status==="not-applicable") return {status:"not-applicable",label:"no upstream contract"}; if(target.group.analysis.status==="needs-input") return {status:"needs-input",label:"contract input needed"}; return {status:"unmatched",label:"no correspondence"}; }
  function sourceLink(source,moduleName) { return source?.path?'<a class="source" href="../../'+escapeHtml(source.path)+'#L'+source.startLine+'">'+escapeHtml(moduleName+":"+source.startLine)+'</a>':''; }
  function symbolSource(symbol) { return symbol?.source?.url?'<a class="source" href="'+escapeHtml(symbol.source.url)+'#L'+symbol.source.startLine+'" target="_blank" rel="noreferrer">source</a>':symbol?.source?.path?'<a class="source" href="../../'+escapeHtml(symbol.source.path)+'#L'+symbol.source.startLine+'">source</a>':''; }
  function accessorDisplay(symbol,accessor) { if(!symbol?.display||!accessor)return symbol?.display; const colon=symbol.display.indexOf(":"); if(colon===-1)return symbol.display; const name=symbol.id.split(".").at(-1); const type=symbol.display.slice(colon+1).trim().replace(/;$/u,""); return accessor==="get"?"get "+name+"(): "+type+";":"set "+name+"(value: "+type+");"; }
  function expectedCandidates(target) { if(target.comparison) { const accessor=target.comparison.portIntent?.accessor; return [{typescript:target.comparison.ts,status:target.comparison.status,accessor,display:accessorDisplay(target.comparison.tsSymbol,accessor)||JSON.stringify(target.comparison.tsSymbol?.shape||{},null,2),symbol:target.comparison.tsSymbol,note:"Reviewed type-fidelity comparison."}]; } if(target.mapping?.source==="reviewed") { const symbol=target.group.typescript?.symbols.find((entry)=>entry.id===target.mapping.typescript); return [{typescript:target.mapping.typescript,status:target.mapping.status,accessor:target.mapping.accessor,display:accessorDisplay(symbol,target.mapping.accessor),symbol,note:"Reviewed upstream correspondence."}]; } return (target.mapping?.candidates||[]).map((candidate)=>{const symbol=target.group.typescript?.symbols.find((entry)=>entry.id===candidate.typescript); return {...candidate,status:target.mapping.status,display:accessorDisplay(symbol,candidate.accessor),symbol,note:"Automatic name candidate: "+candidate.reason+" (score "+candidate.score+"). No type-fidelity verdict yet."};}); }
  function renderExpected(target) { const expected=expectedCandidates(target); if(expected.length===0) { if(target.group.analysis.status==="not-applicable") return '<div class="empty">No upstream parity contract applies.</div>'; if(target.group.analysis.status==="needs-input") return '<div class="empty">The local upstream contract must be identified first.</div>'; return '<div class="empty">No upstream correspondence has been identified.</div>'; } return expected.map((item)=>'<article class="anchor"><div class="card-head"><span class="card-title">'+escapeHtml(item.typescript+(item.accessor?" · "+item.accessor+"ter":""))+'</span><span class="pill '+escapeHtml(item.status)+'">'+escapeHtml(item.status)+'</span></div><p class="note">'+escapeHtml(item.note)+'</p><div class="card-head"><pre>'+escapeHtml(item.display||"Declaration unavailable")+'</pre>'+symbolSource(item.symbol)+'</div></article>').join(""); }
  function selectorMatches(declaration,selector) { return declaration===selector||declaration.startsWith(selector+"."); }
  function preferredPublicEntries(target) { const reviewedNames=[...(target.mapping?.source==="reviewed"?(target.mapping.lean||[]):[]),target.comparison?.lean].filter(Boolean); const reviewed=target.publicEntries.filter((item)=>reviewedNames.includes(item.entry.declaration)); if(reviewed.length)return reviewed; const selectors=target.group.lean.public||[]; const scoped=target.publicEntries.filter((item)=>selectors.some((selector)=>selectorMatches(item.entry.declaration,selector))); const pool=scoped.length?scoped:target.publicEntries; if(pool.length===0)return []; const minimum=Math.min(...pool.map((item)=>item.reach.path.length)); return pool.filter((item)=>item.reach.path.length===minimum).sort((left,right)=>left.entry.declaration.localeCompare(right.entry.declaration)); }
  function renderPublicCard(item,showPath=true) { return '<article class="binding"><div class="card-head"><span class="card-title">'+escapeHtml(item.entry.declaration)+'</span>'+sourceLink(item.entry.source,item.entry.module)+'</div><pre>'+escapeHtml(item.entry.type)+'</pre>'+(showPath?'<details><summary class="note path">Compiler path · '+(item.reach.path.length-1)+' call edge'+(item.reach.path.length===2?'':'s')+'</summary><pre>'+escapeHtml(item.reach.path.join("\\n→ "))+'</pre></details>':'')+'</article>'; }
  function renderActual(target,includeAll=true) { const preferred=preferredPublicEntries(target); if(preferred.length===0)return '<div class="empty">No public Lean declaration reaches this target.</div>'; const selectedNames=new Set(preferred.map((item)=>item.entry.declaration)); const remaining=target.publicEntries.filter((item)=>!selectedNames.has(item.entry.declaration)); return preferred.map((item)=>renderPublicCard(item)).join("")+(includeAll&&remaining.length?'<details><summary class="note">'+remaining.length+' additional public APIs transitively reach this target</summary>'+remaining.map((item)=>renderPublicCard(item)).join("")+'</details>':''); }
  function renderExpectedActual(target) { return '<div class="panes"><div class="pane"><div class="pane-title">Expected upstream TypeScript</div>'+renderExpected(target)+'</div><div class="pane"><div class="pane-title">Actual public Lean API</div>'+renderActual(target)+'</div></div>'; }
  function renderIssues(group) { if (group.issues.length === 0) return '<div class="empty">No runtime, coverage, or type-fidelity findings for this API group.</div>'; return group.issues.map((entry) => '<div class="issue '+escapeHtml(entry.severity)+'"><div class="card-head"><span class="card-title">'+escapeHtml(entry.kind)+'</span><span class="pill '+escapeHtml(entry.severity)+'">'+escapeHtml(entry.severity)+'</span></div><p class="note">'+escapeHtml(entry.message)+'</p>'+(entry.target?'<a href="#target-'+escapeHtml(entry.target)+'">'+escapeHtml(entry.target)+'</a>':'')+'</div>').join(""); }
  function renderAnchors(group) { const results=group.comparison?.results || []; if (results.length === 0) return '<div class="empty">Type fidelity has not been evaluated for this API group.</div>'; return results.map((item) => { const ts=item.tsSymbol?.display || JSON.stringify(item.tsSymbol?.shape || {},null,2); const lean=JSON.stringify(item.leanDescriptor?.shape || {},null,2); const diagnostics=(item.diagnostics || []).map((entry) => '<span class="badge '+escapeHtml(entry.severity)+'" title="'+escapeHtml(entry.message)+'">'+escapeHtml(entry.code)+'</span>').join(""); return '<article class="anchor"><div class="card-head"><span class="card-title">'+escapeHtml(item.ts)+' ↔ '+escapeHtml(item.lean)+'</span><span class="pill '+escapeHtml(item.status)+'">'+escapeHtml(item.status)+'</span></div>'+(item.note?'<p class="note">'+escapeHtml(item.note)+'</p>':'')+'<div class="badges">'+diagnostics+'</div><div class="panes"><div class="pane"><div class="pane-title">Expected TypeScript</div><pre>'+escapeHtml(ts)+'</pre></div><div class="pane"><div class="pane-title">Compared Lean descriptor</div><pre>'+escapeHtml(lean)+'</pre></div></div></article>'; }).join(""); }
  function mappingsForSymbol(group,id) { return (group.coverage?.targetMappings||[]).filter((mapping)=>mapping.typescript===id||(mapping.candidates||[]).some((candidate)=>candidate.typescript===id)); }
  function renderSymbolActual(group,id) { const mappings=mappingsForSymbol(group,id); const member=(group.coverage?.members||[]).find((entry)=>entry.id===id); const symbol=group.typescript?.symbols.find((entry)=>entry.id===id); const missing=(member?.mapping?.operations||[]).filter((operation)=>operation.missing).map((operation)=>'<article class="anchor"><div class="card-head"><span class="card-title">'+escapeHtml(id+' · '+operation.accessor+'ter')+'</span><span class="pill missing">missing</span></div><pre>'+escapeHtml(accessorDisplay(symbol,operation.accessor)||symbol?.display||id)+'</pre><p class="note">'+escapeHtml(operation.note)+'</p></article>'); const mapped=mappings.flatMap((mapping)=>{const target=targetById.get(mapping.target); return target?['<article class="anchor"><div class="card-head"><button class="inline-button card-title" type="button" data-open-target="'+escapeHtml(target.target)+'">'+escapeHtml(target.target+(mapping.accessor?' · '+mapping.accessor+'ter':''))+'</button><span class="pill '+escapeHtml(mapping.status)+'">'+escapeHtml(mapping.status)+'</span></div>'+renderActual(target,false)+'</article>']:[];}); const cards=[...mapped,...missing]; return cards.length?cards.join(""):'<div class="empty">No VIR target is mapped to this upstream entry.</div>'; }
  function renderTypeScript(group) { const symbols=group.typescript?.symbols || []; if (symbols.length === 0) return '<div class="empty">This API group has no external TypeScript declaration surface.</div>'; const coverage=new Map((group.coverage?.members || []).map((member)=>[member.id,member])); return symbols.map((symbol) => { const member=coverage.get(symbol.id); const status=member?'<span class="pill '+escapeHtml(member.status)+'">'+escapeHtml(member.status)+'</span>':''; const inherited=symbol.inheritedFrom?'<span class="badge">from '+escapeHtml(symbol.inheritedFrom)+'</span>':''; const comparison=member?'<div class="panes"><div class="pane"><div class="pane-title">Expected upstream TypeScript</div><pre>'+escapeHtml(symbol.display)+'</pre></div><div class="pane"><div class="pane-title">Actual public Lean API</div>'+renderSymbolActual(group,symbol.id)+'</div></div>':'<pre>'+escapeHtml(symbol.display)+'</pre>'; return '<details class="binding"><summary><span class="card-title">'+escapeHtml(symbol.id)+'</span> <span class="badge">'+escapeHtml(symbol.kind)+'</span> '+inherited+' '+status+'</summary><div class="card-head"><p class="note">'+escapeHtml(symbol.hover || 'No declaration documentation.')+'</p>'+symbolSource(symbol)+'</div>'+comparison+'</details>'; }).join(""); }
  function renderDeclarations(binding) { return binding.declarations.map((decl) => { const source=decl.source?.path?'<a class="source" href="../../'+escapeHtml(decl.source.path)+'#L'+decl.source.startLine+'">'+escapeHtml(decl.module+":"+decl.source.startLine)+'</a>':''; return '<div class="binding"><div class="card-head"><span class="card-title">'+escapeHtml(decl.declaration)+'</span>'+source+'</div><div class="badges">'+badges([decl.marker,decl.boundary,decl.private?'private boundary':'public boundary'])+'</div><pre>'+escapeHtml(decl.type)+'</pre></div>'; }).join(""); }
  function renderBindings(group) { return group.bindings.map((binding) => '<details id="target-'+escapeHtml(binding.target)+'"><summary><span class="card-title">'+escapeHtml(binding.target)+'</span> <span class="pill '+escapeHtml(binding.status)+'">'+escapeHtml(binding.status)+'</span></summary><div class="badges">'+badges(binding.providers)+'</div>'+renderDeclarations(binding)+'</details>').join(""); }
  function attachTargetLinks() { elements.detail.querySelectorAll('[data-open-target]').forEach((button)=>button.addEventListener('click',()=>selectTarget(button.dataset.openTarget))); }
  function renderGroupDetail(group) { if (!group) { elements.detail.innerHTML='<div class="empty">Select an API group.</div>'; return; } const upstream=[...new Set([group.upstream.kind,group.upstream.package,group.upstream.version].filter(Boolean))]; const publicLean=group.lean.public || []; const docs=group.upstream.docs?'<a href="'+escapeHtml(group.upstream.docs)+'" target="_blank" rel="noreferrer">Upstream documentation</a>':''; const runtime='<span class="pill '+(group.summary.provided===group.summary.bindings?'provided':'error')+'">runtime '+group.summary.provided+'/'+group.summary.bindings+' provided</span>'; const finding=group.findingStatus==='none'?'':'<span class="pill '+escapeHtml(group.findingStatus)+'">'+escapeHtml(group.findingStatus==='gap'?'coverage gaps':group.findingStatus)+'</span>'; elements.detail.innerHTML='<div class="badges"><span class="pill '+escapeHtml(group.analysis.status)+'">'+escapeHtml(analysisLabel(group.analysis.status))+'</span>'+runtime+finding+'</div><h2>'+escapeHtml(group.title)+'</h2><p class="note">'+escapeHtml(group.description || group.library.description)+'</p><div class="badges">'+badges([group.library.title,...upstream])+'</div>'+docs+'<section class="section"><h3>API group definition</h3><p class="note">Upstream entry points and public Lean API:</p><div class="badges">'+badges([...(group.upstream.roots || []),...publicLean])+'</div></section><section class="section"><h3>Findings</h3>'+renderIssues(group)+'</section><section class="section"><h3>Upstream TypeScript surface</h3>'+renderTypeScript(group)+'</section><section class="section"><h3>Reviewed type fidelity</h3>'+renderAnchors(group)+'</section><section class="section"><h3>Shipped host targets</h3>'+renderBindings(group)+'</section>'; attachTargetLinks(); }
  function renderPublicDetail(entry) { if(!entry){elements.detail.innerHTML='<div class="empty">Select a public Lean API.</div>';return;} const primarySize=Math.min(...entry.targets.map((reach)=>reach.path.length)); const primary=entry.targets.filter((reach)=>reach.path.length===primarySize).map((reach)=>targetById.get(reach.target)).filter(Boolean); elements.detail.innerHTML='<div class="badges"><span class="pill public-api">public Lean API</span>'+badges([entry.module])+'</div><h2>'+escapeHtml(entry.declaration)+'</h2><div class="card-head"><p class="note">Compiler-discovered public declaration that reaches '+entry.targets.length+(entry.targets.length===1?' shipped host target.':' shipped host targets.')+'</p>'+sourceLink(entry.source,entry.module)+'</div><section class="section"><h3>Actual Lean type</h3><pre>'+escapeHtml(entry.type)+'</pre></section><section class="section"><h3>Likely upstream expectation</h3><p class="note">Shown from the nearest host target'+(primary.length===1?'':'s')+' in the compiled call graph.</p>'+primary.map((target)=>'<article class="binding"><button type="button" class="inline-button card-title" data-open-target="'+escapeHtml(target.target)+'">'+escapeHtml(target.target)+'</button>'+renderExpected(target)+'</article>').join('')+'</section><section class="section"><h3>Compiler-reached host targets</h3>'+entry.targets.map((reach)=>{const target=targetById.get(reach.target);return '<details class="binding"><summary><button type="button" class="inline-button card-title" data-open-target="'+escapeHtml(reach.target)+'">'+escapeHtml(reach.target)+'</button> <span class="pill '+escapeHtml(targetMappingState(target).status)+'">'+escapeHtml(targetMappingState(target).label)+'</span></summary><pre>'+escapeHtml(reach.path.join("\\n→ "))+'</pre></details>';}).join('')+'</section>'; attachTargetLinks(); }
  function renderTargetDetail(target) { if(!target) { elements.detail.innerHTML='<div class="empty">Select a host target.</div>'; return; } const mapping=targetMappingState(target); const groupId=target.group.library.id+'/'+target.group.id; elements.detail.innerHTML='<div class="badges"><span class="pill '+escapeHtml(target.status)+'">'+escapeHtml(target.status)+'</span><span class="pill '+escapeHtml(mapping.status)+'">'+escapeHtml(mapping.label)+'</span>'+badges(target.providers)+'</div><h2>'+escapeHtml(target.target)+'</h2><p class="note">Shipped host-dispatch target in <button type="button" class="inline-button" id="open-group">'+escapeHtml(target.group.library.title+' · '+target.group.title)+'</button>.</p><section class="section"><h3>Expected versus actual type</h3><p class="note">The left side is upstream. The right side is the nearest public Lean API proven by compiled call reachability. Automatic name matches remain unreviewed.</p>'+renderExpectedActual(target)+'</section><section class="section"><h3>Implementation boundary</h3>'+renderDeclarations(target)+'</section>'; elements.detail.querySelector('#open-group')?.addEventListener('click',()=>selectGroup(groupId)); }
  [elements.search,elements.analysis,elements.library,elements.issue].forEach((element) => element.addEventListener(element===elements.search?"input":"change",render));
  elements["groups-view"].addEventListener("click",showGroups); elements["public-view"].addEventListener("click",showPublic); elements["targets-view"].addEventListener("click",showTargets);
  elements.theme.addEventListener("click",()=>{document.documentElement.dataset.theme=document.documentElement.dataset.theme==="light"?"dark":"light";}); document.addEventListener("keydown",(event)=>{if(event.key==="/"&&document.activeElement!==elements.search){event.preventDefault();elements.search.focus();}}); render();
</script></body></html>
`;
}

async function emit(path, contents, check) {
  if (check) {
    if ((await readFile(path, "utf8").catch(() => null)) !== contents) {
      fail(`${relative(repositoryRoot, path)} is stale; rerun npm run generate:binding-explorer`);
    }
  } else {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, contents);
  }
}

const options = parseArgs(process.argv.slice(2));
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
  const report = await buildReport(coverage, configs, typeScriptSurfaces);
  await emit(options.out, `${JSON.stringify(report, null, 2)}\n`, options.check);
  await emit(options.html, renderHtml(report), options.check);
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
