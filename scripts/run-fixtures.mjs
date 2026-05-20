/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";

const root = new URL("..", import.meta.url);
const manifestPath = new URL("../fixtures/manifest.json", import.meta.url);
const buildDir = new URL("../build/fixtures/", import.meta.url);
const wasmPath = new URL("../web/public/vir-upstream.wasm", import.meta.url);
const summaryPath = new URL("summary.json", buildDir);

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function requireOk(result, command) {
  if (!result.ok) {
    throw new Error(`${command} failed with status ${result.status}\n${result.stderr}`);
  }
  return result;
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

function packageDiagnostics(report) {
  const loadedDecls = sectionLines(report, "Loaded IR Declarations").map(parseLoadedDecl).filter(Boolean);
  const nativeExterns = sectionLines(report, "Native Extern Declarations").map(parseNativeExtern).filter(Boolean);
  const missingDecls = sectionLines(report, "Missing IR Declarations");
  const missingNativeExterns = sectionLines(report, "Missing Native Extern Registrations");
  return {
    loadedDecls,
    importedDecls: loadedDecls.filter((decl) => decl.imported),
    nativeExterns,
    missingDecls,
    missingNativeExterns,
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
  if (stderr.includes("unsupported")) {
    return { kind: "unsupported-ir-package", detail: stderr.trim().split("\n")[0] };
  }
  return { kind: "package-generation-failed", detail: stderr.trim().split("\n")[0] || "unknown failure" };
}

async function hostOracle(fixture) {
  if (fixture.result?.type !== "Nat") {
    throw new Error(`${fixture.id}: unsupported host result type ${fixture.result?.type}`);
  }
  const source = await readFile(new URL(`../${fixture.source}`, import.meta.url), "utf8");
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
  const result = run("lean", ["--run", hostPath.pathname], { capture: true });
  requireOk(result, `host oracle ${fixture.id}`);
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  const value = lines.at(-1);
  if (!/^\d+$/.test(value ?? "")) {
    throw new Error(`${fixture.id}: host oracle did not print a Nat: ${result.stdout}`);
  }
  return value;
}

async function instantiateWasm(packagePath) {
  const wasm = await readFile(wasmPath);
  const irPackage = await readFile(packagePath);
  const mod = new WebAssembly.Module(wasm);
  const imports = {};

  for (const spec of WebAssembly.Module.imports(mod)) {
    imports[spec.module] ??= {};
    if (spec.kind === "function") {
      imports[spec.module][spec.name] = (...args) => {
        if (spec.module === "wasi_snapshot_preview1" && spec.name === "proc_exit") {
          throw new Error(`WASI proc_exit(${args[0]})`);
        }
        return 0;
      };
    }
  }

  const { exports } = await WebAssembly.instantiate(mod, imports);
  exports.__wasm_call_ctors?.();

  const ptr = exports.vir_alloc_bytes(irPackage.byteLength);
  try {
    new Uint8Array(exports.memory.buffer, ptr, irPackage.byteLength).set(irPackage);
    const loaded = exports.vir_load_ir_package(ptr, irPackage.byteLength);
    if (loaded === 0) {
      throw new Error(`IR package load failed: ${lastPackageError(exports)}`);
    }
  } finally {
    exports.vir_free_bytes?.(ptr);
  }

  return exports;
}

function readWasmString(exports, ptr, len) {
  return new TextDecoder().decode(new Uint8Array(exports.memory.buffer, ptr, len));
}

function lastPackageError(exports) {
  const len = exports.vir_last_package_error_size?.() ?? 0;
  if (len === 0) return "";
  return readWasmString(exports, exports.vir_last_package_error(), len);
}

function evalConstNat(exports, name) {
  const bytes = new TextEncoder().encode(name);
  const ptr = exports.vir_alloc_bytes(bytes.byteLength);
  try {
    new Uint8Array(exports.memory.buffer, ptr, bytes.byteLength).set(bytes);
    if (
      typeof exports.vir_eval_const_nat_string === "function" &&
      typeof exports.vir_eval_const_nat_string_size === "function"
    ) {
      const resultPtr = exports.vir_eval_const_nat_string(ptr, bytes.byteLength);
      const resultLen = exports.vir_eval_const_nat_string_size();
      return readWasmString(exports, resultPtr, resultLen);
    }
    return String(exports.vir_eval_const_nat(ptr, bytes.byteLength));
  } finally {
    exports.vir_free_bytes?.(ptr);
  }
}

async function generatePackage(fixture) {
  const id = sanitizeId(fixture.id);
  const packagePath = new URL(`${id}.irpkg`, buildDir);
  const reportPath = new URL(`${id}.report.md`, buildDir);
  const args = [
    "--run",
    "tools/GeneratePackage.lean",
    packagePath.pathname,
    reportPath.pathname,
    "--target",
    fixture.source,
    ...rootsFor(fixture),
  ];
  const result = run("lean", args, { capture: true });
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

  const exports = await instantiateWasm(generated.packagePath);
  const wasm = evalConstNat(exports, fixture.entry);
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
await mkdir(buildDir, { recursive: true });
requireOk(run("npm", ["run", "--silent", "build:demo"]), "npm run build:demo");

const results = [];
for (const fixture of manifest.fixtures) {
  results.push(await runFixture(fixture));
}

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
