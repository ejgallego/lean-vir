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
      if (!nonemptyString(mapping?.typescript) || !Array.isArray(mapping.targets) ||
          mapping.targets.length === 0 || mapping.targets.some((target) => !nonemptyString(target))) {
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
      const includeMembers = Array.isArray(bindingRoot.mappings);
      const symbols = descriptor.symbols.filter((symbol) => rootIds.has(symbol.id) ||
        (includeMembers && symbol.surfaceRoot !== undefined && rootIds.has(symbol.surfaceRoot)) ||
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

function rootStatus(bindingRoot, bindings, comparison, issues) {
  if (bindings.some((binding) => binding.status !== "provided")) return "error";
  if (issues.some((entry) => entry.severity === "error")) return "error";
  if (issues.some((entry) => entry.severity === "gap")) return "missing";
  if (comparison !== null && comparison.summary.missing !== 0) return "missing";
  if (issues.some((entry) => entry.severity === "warning")) return "weak";
  if (comparison !== null && comparison.summary.weak !== 0) return "weak";
  if (comparison !== null) return "reviewed";
  if (bindingRoot.upstream.kind === "internal") return "internal";
  return "pending";
}

function buildSurfaceCoverage(config, bindingRoot, typeScript, bindings, comparison) {
  if (!Array.isArray(bindingRoot.mappings)) return null;
  const symbolsById = new Map(typeScript.symbols.map((symbol) => [symbol.id, symbol]));
  const bindingsByTarget = new Map(bindings.map((binding) => [binding.target, binding]));
  const resultsByTypeScript = new Map();
  for (const result of comparison?.results ?? []) {
    const results = resultsByTypeScript.get(result.ts) ?? [];
    results.push(result);
    resultsByTypeScript.set(result.ts, results);
  }
  const mappings = new Map();
  const mappedTargets = new Set();
  for (const mapping of bindingRoot.mappings) {
    if (!symbolsById.has(mapping.typescript)) {
      throw new Error(`${config.id}/${bindingRoot.id} mapping references missing TypeScript member ${mapping.typescript}`);
    }
    if (mappings.has(mapping.typescript)) {
      throw new Error(`${config.id}/${bindingRoot.id} repeats TypeScript mapping ${mapping.typescript}`);
    }
    for (const target of mapping.targets) {
      if (!bindingsByTarget.has(target)) {
        throw new Error(`${config.id}/${bindingRoot.id} mapping references target outside its root: ${target}`);
      }
      if (mappedTargets.has(target)) throw new Error(`${config.id}/${bindingRoot.id} maps target twice: ${target}`);
      mappedTargets.add(target);
    }
    const results = resultsByTypeScript.get(mapping.typescript) ?? [];
    const status = results.length === 0
      ? "unreviewed"
      : results.reduce((candidate, result) =>
        semanticStatuses.indexOf(result.status) > semanticStatuses.indexOf(candidate)
          ? result.status
          : candidate, "exact");
    mappings.set(mapping.typescript, { ...mapping, status, anchors: results.map((result) => result.id) });
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
  return { summary: { ...summary, mappedTargets: mappedTargets.size }, members };
}

async function buildReport(coverage, configs, typeScriptSurfaces) {
  if (coverage?.format !== "lean-vir-shipped-bindings-coverage" || coverage.version !== 1 ||
      !Array.isArray(coverage.bindings)) {
    throw new Error("coverage input is not a shipped-bindings v1 report");
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
      const coverage = typescript === null
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
      if (comparison === null && bindingRoot.upstream.kind !== "internal") {
        issues.push(issue(
          "audit-pending",
          "review",
          `${bindingRoot.title} has an identified ${bindingRoot.upstream.kind} surface but no semantic comparison yet`,
        ));
      }
      if (coverage !== null && coverage.summary.missing !== 0) {
        issues.push(issue(
          "upstream-members-missing",
          "gap",
          `${coverage.summary.missing} of ${coverage.members.length} upstream members have no shipped VIR binding`,
        ));
      }
      issues.push(...semanticIssues(comparison));
      if (comparison !== null) {
        for (const status of semanticStatuses) semanticSummary[status] += comparison.summary[status];
        for (const result of comparison.results) {
          if (result.target !== undefined && !bindings.some((binding) => binding.target === result.target)) {
            throw new Error(`${config.id}/${bindingRoot.id} anchor ${result.id} references target outside its root: ${result.target}`);
          }
        }
      }
      const decoratedIssues = issues.map((entry) => ({ library: config.id, root: bindingRoot.id, ...entry }));
      libraryIssues.push(...decoratedIssues);
      allIssues.push(...decoratedIssues);
      roots.push({
        id: bindingRoot.id,
        title: bindingRoot.title,
        ...(bindingRoot.description ? { description: bindingRoot.description } : {}),
        lean: bindingRoot.lean ?? { public: [] },
        upstream: bindingRoot.upstream,
        ...(typescript === null ? {} : { typescript }),
        ...(coverage === null ? {} : { coverage }),
        status: rootStatus(bindingRoot, bindings, comparison, issues),
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
        roots: roots.length,
        bindings: roots.reduce((sum, entry) => sum + entry.summary.bindings, 0),
        issues: libraryIssues.length,
      },
      roots,
      issues: libraryIssues,
    });
  }
  libraries.sort((left, right) => left.title.localeCompare(right.title));
  const roots = libraries.flatMap((library) => library.roots);
  const coveredRoots = roots.filter((entry) => entry.coverage !== undefined);
  const issueCounts = { error: 0, warning: 0, gap: 0, review: 0 };
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
      roots: roots.length,
      targets: coverage.summary.totalTargets,
      provided: coverage.summary.provided,
      missingProvider: coverage.summary.missingProvider,
      runtimeOnly: coverage.summary.runtimeOnly,
      auditedRoots: roots.filter((entry) => entry.comparison !== undefined).length,
      pendingRoots: roots.filter((entry) => entry.status === "pending").length,
      internalRoots: roots.filter((entry) => entry.status === "internal").length,
      semantic: semanticSummary,
      upstreamSymbols: roots.reduce((sum, entry) => sum + (entry.typescript?.symbols.length ?? 0), 0),
      coverage: {
        roots: coveredRoots.length,
        members: coveredRoots.reduce((sum, entry) => sum + entry.coverage.members.length, 0),
        mapped: coveredRoots.reduce((sum, entry) =>
          sum + entry.coverage.members.filter((member) => member.status !== "missing").length, 0),
        missing: coveredRoots.reduce((sum, entry) => sum + entry.coverage.summary.missing, 0),
      },
      issues: issueCounts,
    },
    libraries,
    issues: allIssues,
  };
}

function renderHtml(report) {
  const data = JSON.stringify(report).replaceAll("<", "\\u003c");
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
    .left { border-right:1px solid var(--line); min-width:0; } .toolbar { padding:14px; display:grid; grid-template-columns:1fr 170px; gap:9px; border-bottom:1px solid var(--line); background:var(--panel2); }
    input,select { width:100%; color:var(--text); background:var(--bg); border:1px solid var(--line); border-radius:11px; padding:10px 12px; outline:none; } input:focus,select:focus { border-color:var(--mint); box-shadow:0 0 0 3px #65e0b122; }
    .filters { display:grid; grid-template-columns:1fr 1fr; gap:8px; padding:0 14px 14px; background:var(--panel2); border-bottom:1px solid var(--line); } .result-head { padding:10px 15px; color:var(--muted); border-bottom:1px solid var(--line); }
    #results { max-height:670px; overflow:auto; } .row { width:100%; display:grid; grid-template-columns:1fr auto; gap:8px; text-align:left; padding:13px 15px; border:0; border-bottom:1px solid var(--line); background:transparent; cursor:pointer; }
    .row:hover,.row.active { background:#65e0b10d; } .row.active { box-shadow:inset 3px 0 var(--mint); } .name { font:650 13px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace; overflow-wrap:anywhere; } .sub { display:block; color:var(--muted); font-size:12px; margin-top:4px; }
    .pill,.badge { display:inline-flex; align-items:center; width:max-content; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:11px; font-weight:750; } .reviewed,.provided,.exact,.compatible { color:var(--mint); border-color:#65e0b166; } .pending,.review,.weak,.warning { color:var(--amber); border-color:#ffc76866; } .missing,.gap { color:var(--purple); border-color:#bd9cff66; } .error,.missing-provider,.runtime-only { color:var(--red); border-color:#ff7c8866; } .internal { color:var(--blue); border-color:#75baff66; }
    .detail { padding:26px; min-width:0; overflow:auto; max-height:760px; } .detail h2 { font-size:clamp(28px,4vw,46px); line-height:1.05; margin:8px 0; letter-spacing:-.035em; } .detail h3 { margin:0 0 12px; font-size:13px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted); }
    .badges { display:flex; flex-wrap:wrap; gap:7px; margin:12px 0 18px; } .badge { color:var(--blue); } .section { border-top:1px solid var(--line); padding-top:20px; margin-top:20px; }
    .issue,.anchor,.binding { border:1px solid var(--line); border-radius:15px; padding:14px; margin:10px 0; background:var(--panel2); } .issue { border-left-width:4px; } .issue.error { border-left-color:var(--red); } .issue.warning,.issue.review { border-left-color:var(--amber); } .issue.gap { border-left-color:var(--purple); }
    .card-head { display:flex; justify-content:space-between; gap:12px; align-items:flex-start; } .card-title { font:700 13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; overflow-wrap:anywhere; } .note { color:var(--muted); margin:8px 0 0; }
    details summary { cursor:pointer; } pre { margin:10px 0 0; padding:12px; border-radius:11px; background:var(--bg); color:#c9e6ff; white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; } :root[data-theme="light"] pre { color:#19517e; }
    .panes { display:grid; grid-template-columns:1fr 1fr; gap:10px; margin-top:10px; } .pane-title { color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.1em; } .source { font-size:12px; white-space:nowrap; } .empty { color:var(--muted); padding:30px; text-align:center; }
    @media (max-width:1050px) { .workspace { grid-template-columns:1fr; } .left { border-right:0; border-bottom:1px solid var(--line); } #results { max-height:420px; } .detail { max-height:none; } }
    @media (max-width:680px) { main { width:min(100% - 18px,1580px); padding-top:24px; } header { display:block; } .theme { margin-top:16px; } .metrics { grid-template-columns:1fr 1fr; } .toolbar,.filters,.panes { grid-template-columns:1fr; } }
  </style>
</head>
<body><main>
  <header><div><div class="eyebrow">Lean VIR · binding fidelity</div><h1>Library explorer</h1><p class="lede">One view from upstream library roots through public Lean APIs and compiler-validated JavaScript boundaries to shipped runtime providers. Pending audits and concrete fidelity gaps stay visible.</p></div><button class="theme" id="theme" type="button">Toggle theme</button></header>
  <section class="metrics">
    <article class="metric good"><strong id="provided-metric">${report.summary.provided}/${report.summary.targets}</strong><span>runtime targets provided</span></article>
    <article class="metric"><strong>${report.summary.auditedRoots}/${report.summary.roots}</strong><span>roots semantically audited</span></article>
    <article class="metric ${report.summary.semantic.weak + report.summary.semantic.missing + report.summary.coverage.missing === 0 ? "good" : "warn"}"><strong>${report.summary.semantic.weak + report.summary.semantic.missing + report.summary.coverage.missing}</strong><span>member/type findings</span></article>
    <article class="metric ${report.summary.pendingRoots === 0 ? "good" : "warn"}"><strong>${report.summary.pendingRoots}</strong><span>root audits pending</span></article>
  </section>
  <div class="scope"><b>Measured surface:</b> ${report.summary.libraries} libraries · ${report.summary.roots} configured roots · ${report.summary.targets} compiler/runtime targets. An internal root has no external parity contract; a pending root has an identified upstream surface that has not yet been compared.</div>
  <section class="workspace">
    <div class="left">
      <div class="toolbar"><input id="search" type="search" placeholder="Search library, root, target, type…" aria-label="Search binding roots"><select id="status"><option value="all">All root statuses</option><option value="error">Errors</option><option value="missing">Missing</option><option value="weak">Weak</option><option value="pending">Audit pending</option><option value="reviewed">Reviewed</option><option value="internal">Internal</option></select></div>
      <div class="filters"><select id="library"><option value="all">All libraries</option>${report.libraries.map((entry) => `<option value="${entry.id}">${entry.title}</option>`).join("")}</select><select id="issue"><option value="all">All findings</option><option value="error">Errors</option><option value="warning">Warnings</option><option value="gap">Coverage gaps</option><option value="review">Review pending</option><option value="none">No findings</option></select></div>
      <div class="result-head" id="count"></div><div id="results"></div>
    </div>
    <article class="detail" id="detail"></article>
  </section>
</main>
<script id="report-data" type="application/json">${data}</script>
<script>
  const report = JSON.parse(document.querySelector("#report-data").textContent);
  const roots = report.libraries.flatMap((library) => library.roots.map((root) => ({ ...root, library })));
  const byId = new Map(roots.map((root) => [root.library.id + "/" + root.id, root]));
  const elements = Object.fromEntries(["search","status","library","issue","count","results","detail","theme"].map((id) => [id, document.querySelector("#" + id)]));
  let selected = decodeURIComponent(location.hash.replace(/^#root=/, ""));
  if (!byId.has(selected)) selected = roots.find((root) => ["error","missing","weak"].includes(root.status)) ? (roots.find((root) => ["error","missing","weak"].includes(root.status)).library.id + "/" + roots.find((root) => ["error","missing","weak"].includes(root.status)).id) : (roots[0] ? roots[0].library.id + "/" + roots[0].id : "");
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[character]));
  const statusLabel = (value) => ({ reviewed:"reviewed", pending:"audit pending", internal:"internal contract", weak:"weak types", missing:"coverage gaps", error:"error" }[value] || value);
  function rootText(root) { return [root.library.title,root.title,root.description,...(root.lean.public || []),...(root.upstream.roots || []),...(root.typescript?.symbols || []).flatMap((symbol) => [symbol.id,symbol.display,symbol.hover]),...root.bindings.flatMap((binding) => [binding.target,...binding.declarations.flatMap((decl) => [decl.declaration,decl.type])]),...(root.comparison?.results || []).flatMap((item) => [item.lean,item.ts,item.note,...item.notes])].join(" ").toLowerCase(); }
  function matches(root) { const query=elements.search.value.trim().toLowerCase(); const issue=elements.issue.value; return (!query || rootText(root).includes(query)) && (elements.status.value === "all" || root.status === elements.status.value) && (elements.library.value === "all" || root.library.id === elements.library.value) && (issue === "all" || (issue === "none" ? root.issues.length === 0 : root.issues.some((entry) => entry.severity === issue))); }
  function render() { const visible=roots.filter(matches); elements.count.textContent=visible.length + (visible.length === 1 ? " binding root" : " binding roots"); elements.results.innerHTML=visible.length === 0 ? '<div class="empty">No roots match these filters.</div>' : visible.map((root) => { const id=root.library.id+"/"+root.id; return '<button type="button" class="row '+(id===selected?'active':'')+'" data-id="'+escapeHtml(id)+'"><span><span class="name">'+escapeHtml(root.library.title+" · "+root.title)+'</span><span class="sub">'+root.summary.bindings+' targets · '+root.summary.issues+' findings</span></span><span class="pill '+escapeHtml(root.status)+'">'+escapeHtml(statusLabel(root.status))+'</span></button>'; }).join(""); elements.results.querySelectorAll("[data-id]").forEach((button) => button.addEventListener("click", () => select(button.dataset.id))); renderDetail(byId.get(selected)); }
  function select(id) { selected=id; history.replaceState(null,"","#root="+encodeURIComponent(id)); render(); }
  function badges(values) { return values.map((value) => '<span class="badge">'+escapeHtml(value)+'</span>').join(""); }
  function renderIssues(root) { if (root.issues.length === 0) return '<div class="empty">No findings for this root.</div>'; return root.issues.map((entry) => '<div class="issue '+escapeHtml(entry.severity)+'"><div class="card-head"><span class="card-title">'+escapeHtml(entry.kind)+'</span><span class="pill '+escapeHtml(entry.severity)+'">'+escapeHtml(entry.severity)+'</span></div><p class="note">'+escapeHtml(entry.message)+'</p>'+(entry.target?'<a href="#target-'+escapeHtml(entry.target)+'">'+escapeHtml(entry.target)+'</a>':'')+'</div>').join(""); }
  function renderAnchors(root) { const results=root.comparison?.results || []; if (results.length === 0) return '<div class="empty">No semantic comparison generated yet.</div>'; return results.map((item) => { const ts=item.tsSymbol?.display || JSON.stringify(item.tsSymbol?.shape || {},null,2); const lean=JSON.stringify(item.leanDescriptor?.shape || {},null,2); const diagnostics=(item.diagnostics || []).map((entry) => '<span class="badge '+escapeHtml(entry.severity)+'" title="'+escapeHtml(entry.message)+'">'+escapeHtml(entry.code)+'</span>').join(""); return '<article class="anchor"><div class="card-head"><span class="card-title">'+escapeHtml(item.lean)+' ↔ '+escapeHtml(item.ts)+'</span><span class="pill '+escapeHtml(item.status)+'">'+escapeHtml(item.status)+'</span></div>'+(item.note?'<p class="note">'+escapeHtml(item.note)+'</p>':'')+'<div class="badges">'+diagnostics+'</div><div class="panes"><div><div class="pane-title">Lean VIR descriptor</div><pre>'+escapeHtml(lean)+'</pre></div><div><div class="pane-title">TypeScript declaration</div><pre>'+escapeHtml(ts)+'</pre></div></div></article>'; }).join(""); }
  function renderTypeScript(root) { const symbols=root.typescript?.symbols || []; if (symbols.length === 0) return '<div class="empty">This root has no external TypeScript declaration surface.</div>'; const coverage=new Map((root.coverage?.members || []).map((member)=>[member.id,member])); return symbols.map((symbol) => { const source=symbol.source?.url?'<a class="source" href="'+escapeHtml(symbol.source.url)+'#L'+symbol.source.startLine+'" target="_blank" rel="noreferrer">source</a>':symbol.source?.path?'<a class="source" href="../../'+escapeHtml(symbol.source.path)+'#L'+symbol.source.startLine+'">source</a>':''; const member=coverage.get(symbol.id); const status=member?'<span class="pill '+escapeHtml(member.status)+'">'+escapeHtml(member.status)+'</span>':''; const inherited=symbol.inheritedFrom?'<span class="badge">from '+escapeHtml(symbol.inheritedFrom)+'</span>':''; return '<details class="binding"><summary><span class="card-title">'+escapeHtml(symbol.id)+'</span> <span class="badge">'+escapeHtml(symbol.kind)+'</span> '+inherited+' '+status+'</summary><div class="card-head"><p class="note">'+escapeHtml(symbol.hover || 'No declaration documentation.')+'</p>'+source+'</div><pre>'+escapeHtml(symbol.display)+'</pre></details>'; }).join(""); }
  function renderBindings(root) { return root.bindings.map((binding) => { const declarations=binding.declarations.map((decl) => { const source=decl.source?.path?'<a class="source" href="../../'+escapeHtml(decl.source.path)+'#L'+decl.source.startLine+'">'+escapeHtml(decl.module+":"+decl.source.startLine)+'</a>':''; return '<div class="binding"><div class="card-head"><span class="card-title">'+escapeHtml(decl.declaration)+'</span>'+source+'</div><div class="badges">'+badges([decl.marker,decl.boundary,decl.private?'private boundary':'public boundary'])+'</div><pre>'+escapeHtml(decl.type)+'</pre></div>'; }).join(""); return '<details id="target-'+escapeHtml(binding.target)+'"><summary><span class="card-title">'+escapeHtml(binding.target)+'</span> <span class="pill '+escapeHtml(binding.status)+'">'+escapeHtml(binding.status)+'</span></summary><div class="badges">'+badges(binding.providers)+'</div>'+declarations+'</details>'; }).join(""); }
  function renderDetail(root) { if (!root) { elements.detail.innerHTML='<div class="empty">Select a binding root.</div>'; return; } const upstream=[root.upstream.kind,root.upstream.package,root.upstream.version].filter(Boolean); const publicLean=root.lean.public || []; const docs=root.upstream.docs?'<a href="'+escapeHtml(root.upstream.docs)+'" target="_blank" rel="noreferrer">Upstream documentation</a>':''; elements.detail.innerHTML='<span class="pill '+escapeHtml(root.status)+'">'+escapeHtml(statusLabel(root.status))+'</span><h2>'+escapeHtml(root.title)+'</h2><p class="note">'+escapeHtml(root.description || root.library.description)+'</p><div class="badges">'+badges([root.library.title,...upstream])+'</div>'+docs+'<section class="section"><h3>Configured roots</h3><div class="badges">'+badges([...(root.upstream.roots || []),...publicLean])+'</div></section><section class="section"><h3>Findings</h3>'+renderIssues(root)+'</section><section class="section"><h3>Upstream TypeScript surface</h3>'+renderTypeScript(root)+'</section><section class="section"><h3>Semantic comparison</h3>'+renderAnchors(root)+'</section><section class="section"><h3>Shipped targets</h3>'+renderBindings(root)+'</section>'; }
  [elements.search,elements.status,elements.library,elements.issue].forEach((element) => element.addEventListener(element===elements.search?"input":"change",render));
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
  console.log(`  configured roots: ${report.summary.roots}`);
  console.log(`  shipped targets: ${report.summary.provided}/${report.summary.targets} provided`);
  console.log(`  semantic roots: ${report.summary.auditedRoots} audited, ${report.summary.pendingRoots} pending`);
  console.log(`  upstream symbols: ${report.summary.upstreamSymbols}`);
  console.log(`  member coverage: ${report.summary.coverage.mapped}/${report.summary.coverage.members} mapped`);
  console.log(`  findings: ${report.summary.semantic.weak} weak, ${report.summary.semantic.missing} missing`);
  console.log(`  artifacts: ${options.check ? "validated" : "wrote"} ${relative(repositoryRoot, options.out)}`);
  console.log(`             ${options.check ? "validated" : "wrote"} ${relative(repositoryRoot, options.html)}`);
} catch (error) {
  fail(error.message);
}
