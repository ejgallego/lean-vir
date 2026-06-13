/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { availableParallelism } from "node:os";
import { delimiter } from "node:path";

import { createVirRuntime } from "../web/src/vir-runtime.js";
import { runAsync } from "./process-utils.mjs";

const root = new URL("..", import.meta.url);
const manifestPath = new URL("../fixtures/manifest.json", import.meta.url);
const buildDir = new URL("../build/fixtures/", import.meta.url);
const wasmPath = new URL("../web/public/vir-upstream.wasm", import.meta.url);
const irpkgGeneratorPath = new URL("../.lake/build/bin/vir_irpkg", import.meta.url);
const summaryPath = new URL("summary.json", buildDir);
const sourceCache = new Map();
let cachedWasmBytes = null;
let irpkgGeneratorEnv = null;
const args = process.argv.slice(2);

function usage() {
  console.log(`Usage: node scripts/run-fixtures.mjs [--no-build]

Run Lean fixture host-oracle checks against the WASI upstream interpreter.

Options:
  --no-build       Reuse web/public/vir-upstream.wasm and generated browser packages.
  -h, --help       Show this help.

Environment:
  VIR_FIXTURE_FILTER      Case-insensitive substring matched against fixture id,
                          source path, entry name, and roots.
  VIR_FIXTURE_JOBS        Positive integer worker limit.
  VIR_FIXTURE_SKIP_BUILD  Set to 1 for the same behavior as --no-build.
`);
}

if (args.includes("-h") || args.includes("--help")) {
  usage();
  process.exit(0);
}

for (const arg of args) {
  if (arg !== "--no-build") {
    throw new Error(`unknown argument: ${arg}; run node scripts/run-fixtures.mjs --help`);
  }
}

function requireOk(result, command) {
  if (!result.ok) {
    throw new Error(`${command} failed with status ${result.status}\n${result.stderr}`);
  }
  return result;
}

async function commandOutput(cmd, args, command) {
  const result = requireOk(await runAsync(cmd, args, { cwd: root, capture: true }), command);
  return result.stdout.trim();
}

function leanPathWithGenerator(leanPrefix) {
  return [
    "build/lean-lib",
    ".lake/build/lib/lean",
    `${leanPrefix}/lib/lean`,
    process.env.LEAN_PATH,
  ].filter(Boolean).join(delimiter);
}

async function prepareIrpkgGenerator() {
  requireOk(
    await runAsync("bash", ["scripts/build-lean-lib.sh"], { cwd: root }),
    "bash scripts/build-lean-lib.sh",
  );
  requireOk(
    await runAsync("lake", ["build", "vir_irpkg"], { cwd: root }),
    "lake build vir_irpkg",
  );
  const leanPrefix = await commandOutput("lean", ["--print-prefix"], "lean --print-prefix");
  irpkgGeneratorEnv = {
    ...process.env,
    LEAN_PATH: leanPathWithGenerator(leanPrefix),
  };
}

function sanitizeId(id) {
  return id.replace(/[^A-Za-z0-9_.-]/g, "_");
}

function rootsFor(fixture) {
  return fixture.roots?.length ? fixture.roots : [fixture.entry];
}

function sectionLines(report, header) {
  const lines = report.split("\n");
  const start = lines.findIndex((line) => line.trim() === `## ${header}`);
  if (start === -1) return [];
  const out = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith("## ")) break;
    const trimmed = line.trim();
    if (trimmed.startsWith("- `")) out.push(trimmed);
  }
  return out.filter((line) => line !== "- `None.`" && line !== "- None.");
}

function parseLoadedDecl(line) {
  const match = line.match(/^- `([^`]+)` from `([^`]+)`$/);
  if (!match) return null;
  return { name: match[1], source: match[2], imported: match[2].startsWith("imported by ") };
}

function parseNativeExtern(line) {
  const match = line.match(/^- `([^`]+)` -> `([^`]+)`$/);
  if (!match) return null;
  return { name: match[1], symbol: match[2] };
}

function parseInitGlobal(line) {
  const match = line.match(/^- `([^`]+)` <- `([^`]+)`$/);
  if (!match) return null;
  return { name: match[1], initName: match[2] };
}

function parseBulletName(line) {
  const match = line.match(/^- `([^`]+)`$/);
  return match?.[1] ?? line;
}

function packageDiagnostics(report) {
  const loadedDecls = sectionLines(report, "Loaded IR Declarations").map(parseLoadedDecl).filter(Boolean);
  const nativeExterns = sectionLines(report, "Native Extern Declarations").map(parseNativeExtern).filter(Boolean);
  const initGlobals = sectionLines(report, "Initializer Globals").map(parseInitGlobal).filter(Boolean);
  const missingDecls = sectionLines(report, "Missing IR Declarations");
  const missingNativeExterns = sectionLines(report, "Missing Native Extern Registrations");
  const unsupportedInitGlobals = sectionLines(report, "Unsupported Init Globals").map(parseBulletName);
  return {
    loadedDecls,
    importedDecls: loadedDecls.filter((decl) => decl.imported),
    nativeExterns,
    initGlobals,
    missingDecls,
    missingNativeExterns,
    unsupportedInitGlobals,
  };
}

function classifyPackageFailure(report, stderr) {
  const missingExterns = sectionLines(report, "Missing Native Extern Registrations");
  if (missingExterns.length !== 0) {
    return { kind: "missing-native-extern", detail: missingExterns.join(", ") };
  }
  const missingDecls = sectionLines(report, "Missing IR Declarations");
  if (missingDecls.length !== 0) {
    return { kind: "missing-ir-decl", detail: missingDecls.join(", ") };
  }
  const unsupportedInitGlobals = sectionLines(report, "Unsupported Init Globals").map(parseBulletName);
  if (unsupportedInitGlobals.length !== 0) {
    return { kind: "unsupported-init-global", detail: unsupportedInitGlobals.join(", ") };
  }
  if (stderr.includes("unsupported")) {
    return { kind: "unsupported-ir-package", detail: stderr.trim().split("\n")[0] };
  }
  return { kind: "package-generation-failed", detail: stderr.trim().split("\n")[0] || "unknown failure" };
}

async function hostOracle(fixture) {
  if (fixture.result?.type !== "Nat") {
    throw new Error(`${fixture.id}: unsupported host result type ${fixture.result?.type}`);
  }
  const source = await fixtureSource(fixture.source);
  const mainDecl = fixture.unsafe ? "unsafe def main : IO UInt32 := do" : "def main : IO UInt32 := do";
  const hostSource = [
    source,
    "",
    "set_option interpreter.prefer_native false",
    mainDecl,
    `  IO.println (toString ${fixture.entry})`,
    "  return 0",
    "",
  ].join("\n");
  const hostPath = new URL(`${sanitizeId(fixture.id)}.host.lean`, buildDir);
  await writeFile(hostPath, hostSource);
  const result = await runAsync("lean", ["--run", hostPath.pathname], { cwd: root, capture: true });
  requireOk(result, `host oracle ${fixture.id}`);
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  const value = lines.at(-1);
  if (!/^\d+$/.test(value ?? "")) {
    throw new Error(`${fixture.id}: host oracle did not print a Nat: ${result.stdout}`);
  }
  return value;
}

async function fixtureSource(source) {
  if (!sourceCache.has(source)) {
    sourceCache.set(source, readFile(new URL(`../${source}`, import.meta.url), "utf8"));
  }
  return sourceCache.get(source);
}

async function upstreamWasmBytes() {
  cachedWasmBytes ??= readFile(wasmPath);
  return cachedWasmBytes;
}

async function instantiateWasm(packagePath) {
  const wasm = await upstreamWasmBytes();
  const irPackage = await readFile(packagePath);
  return createVirRuntime({ wasmBytes: wasm, irPackageBytes: irPackage });
}

async function generatePackage(fixture) {
  if (irpkgGeneratorEnv === null) {
    throw new Error("IR package generator was not prepared");
  }
  const id = sanitizeId(fixture.id);
  const packagePath = new URL(`${id}.irpkg`, buildDir);
  const reportPath = new URL(`${id}.report.md`, buildDir);
  const args = [
    packagePath.pathname,
    reportPath.pathname,
    "--target",
    fixture.source,
    ...rootsFor(fixture),
  ];
  const result = await runAsync(irpkgGeneratorPath.pathname, args, {
    cwd: root,
    capture: true,
    env: irpkgGeneratorEnv,
  });
  const report = await readFile(reportPath, "utf8").catch(() => "");
  const diagnostics = packageDiagnostics(report);
  if (!result.ok) {
    return {
      ok: false,
      packagePath,
      reportPath,
      diagnostics,
      failure: classifyPackageFailure(report, result.stderr),
      stderr: result.stderr,
    };
  }
  return { ok: true, packagePath, reportPath, diagnostics };
}

async function runFixture(fixture) {
  const expectedStatus = fixture.expect?.status ?? "pass";
  const host = await hostOracle(fixture);
  const generated = await generatePackage(fixture);

  if (!generated.ok) {
    if (expectedStatus === "unsupported") {
      return {
        status: "expected-unsupported",
        fixture,
        host,
        diagnostics: generated.diagnostics,
        detail: `${generated.failure.kind}: ${generated.failure.detail}`,
      };
    }
    return {
      status: "failed",
      fixture,
      host,
      diagnostics: generated.diagnostics,
      detail: `${generated.failure.kind}: ${generated.failure.detail}`,
    };
  }

  const runtime = await instantiateWasm(generated.packagePath);
  const wasm = runtime.call(fixture.entry);
  if (expectedStatus === "unsupported") {
    return {
      status: "failed",
      fixture,
      host,
      wasm,
      diagnostics: generated.diagnostics,
      detail: "expected unsupported fixture passed",
    };
  }
  if (wasm !== host) {
    return {
      status: "failed",
      fixture,
      host,
      wasm,
      diagnostics: generated.diagnostics,
      detail: `host=${host} wasm=${wasm}`,
    };
  }
  return { status: "passed", fixture, host, wasm, diagnostics: generated.diagnostics };
}

const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const fixtureFilter = process.env.VIR_FIXTURE_FILTER?.trim() ?? "";
const skipBuild =
  process.env.VIR_FIXTURE_SKIP_BUILD === "1" ||
  args.includes("--no-build");
function fixtureMatchesFilter(fixture, filter) {
  if (filter === "") return true;
  const needle = filter.toLowerCase();
  const haystack = [
    fixture.id,
    fixture.source,
    fixture.entry,
    ...(fixture.roots ?? []),
  ].join("\n").toLowerCase();
  return haystack.includes(needle);
}
const fixtures = (manifest.fixtures ?? []).filter((fixture) => fixtureMatchesFilter(fixture, fixtureFilter));
if (fixtures.length === 0) {
  throw new Error(`no fixtures matched VIR_FIXTURE_FILTER=${JSON.stringify(fixtureFilter)}`);
}
await mkdir(buildDir, { recursive: true });
if (skipBuild) {
  try {
    await readFile(wasmPath);
  } catch {
    throw new Error("VIR fixture no-build mode requires web/public/vir-upstream.wasm; run npm run build:demo first");
  }
  console.log("fixture build: skipped (--no-build)");
} else {
  requireOk(await runAsync("npm", ["run", "--silent", "build:demo"], { cwd: root }), "npm run build:demo");
}
await prepareIrpkgGenerator();

function fixtureJobCount(total) {
  const configured = Number.parseInt(process.env.VIR_FIXTURE_JOBS ?? "", 10);
  if (Number.isInteger(configured) && configured > 0) {
    return Math.min(configured, total);
  }
  return Math.min(Math.max(1, Math.floor(availableParallelism() / 2)), total);
}

async function mapWithLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const index = next;
      next += 1;
      results[index] = await fn(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: limit }, () => worker()));
  return results;
}

const jobs = fixtureJobCount(fixtures.length);
if (fixtureFilter !== "") {
  console.log(`fixture filter: ${fixtureFilter} (${fixtures.length}/${manifest.fixtures?.length ?? 0})`);
}
console.log(`fixture jobs: ${jobs}`);
const results = await mapWithLimit(fixtures, jobs, runFixture);

let passed = 0;
let unsupported = 0;
let failed = 0;

for (const result of results) {
  if (result.status === "passed") {
    passed++;
    console.log(`PASS ${result.fixture.id}: ${result.wasm}`);
  } else if (result.status === "expected-unsupported") {
    unsupported++;
    console.log(`UNSUPPORTED ${result.fixture.id}: ${result.detail}`);
  } else {
    failed++;
    console.log(`FAIL ${result.fixture.id}: ${result.detail}`);
  }
}

const summary = {
  version: 1,
  totals: {
    passed,
    expectedUnsupported: unsupported,
    failed,
  },
  fixtures: results.map((result) => ({
    id: result.fixture.id,
    entry: result.fixture.entry,
    status: result.status,
    expectedStatus: result.fixture.expect?.status ?? "pass",
    host: result.host,
    wasm: result.wasm,
    detail: result.detail,
    diagnostics: result.diagnostics && {
      loadedDeclCount: result.diagnostics.loadedDecls.length,
      importedDecls: result.diagnostics.importedDecls,
      nativeExterns: result.diagnostics.nativeExterns,
      missingDecls: result.diagnostics.missingDecls,
      missingNativeExterns: result.diagnostics.missingNativeExterns,
      unsupportedInitGlobals: result.diagnostics.unsupportedInitGlobals,
    },
  })),
};
await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);

console.log();
console.log(`fixture summary: ${passed} passed, ${unsupported} expected unsupported, ${failed} failed`);
const importedSummaries = results
  .filter((result) => result.diagnostics?.importedDecls?.length)
  .map((result) => `${result.fixture.id}:${result.diagnostics.importedDecls.length}`);
if (importedSummaries.length !== 0) {
  console.log(`imported IR deps: ${importedSummaries.join(", ")}`);
}
console.log(`wrote ${summaryPath.pathname}`);

if (failed !== 0) {
  process.exit(1);
}
