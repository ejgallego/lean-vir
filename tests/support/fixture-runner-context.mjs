/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile, writeFile } from "node:fs/promises";

import { fixtureExpectation, fixtureRoots } from "../../fixtures/fixture-manifest.mjs";
import { requireSuccessfulProcess, runAsync } from "../../scripts/process-utils.mjs";
import { elapsedSeconds, timerStart } from "../../scripts/timing-utils.mjs";
import { createVirRuntime } from "../../web/src/vir-runtime.js";
import { classifyPackageFailure, packageDiagnostics } from "./fixture-diagnostics.mjs";
import { evaluateFixtureRun } from "./fixture-result.mjs";

export function createFixtureRunnerContext({ root, buildDir, wasmPath, irpkgGenerator }) {
  const sourceCache = new Map();
  let wasmBytesPromise = null;

  async function fixtureSource(source) {
    if (!sourceCache.has(source)) {
      sourceCache.set(source, readFile(new URL(source, root), "utf8"));
    }
    return sourceCache.get(source);
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
    const hostPath = new URL(`${fixture.id}.host.lean`, buildDir);
    await writeFile(hostPath, hostSource);
    const result = await runAsync("lean", ["--run", hostPath.pathname], { cwd: root, capture: true });
    requireSuccessfulProcess(result, `host oracle ${fixture.id}`);
    const lines = result.stdout.trim().split("\n").filter(Boolean);
    const value = lines.at(-1);
    if (!/^\d+$/.test(value ?? "")) {
      throw new Error(`${fixture.id}: host oracle did not print a Nat: ${result.stdout}`);
    }
    return value;
  }

  async function upstreamWasmBytes() {
    wasmBytesPromise ??= readFile(wasmPath);
    return wasmBytesPromise;
  }

  async function instantiateWasm(packagePath) {
    const wasm = await upstreamWasmBytes();
    const irPackage = await readFile(packagePath);
    return createVirRuntime({ wasmBytes: wasm, irPackageSetBytes: [irPackage] });
  }

  async function generatePackage(fixture) {
    const packagePath = new URL(`${fixture.id}.irpkg`, buildDir);
    const reportPath = new URL(`${fixture.id}.report.md`, buildDir);
    const args = [
      packagePath.pathname,
      reportPath.pathname,
      "--target",
      fixture.source,
      ...fixtureRoots(fixture),
    ];
    const result = await runAsync(irpkgGenerator.path, args, {
      cwd: root,
      capture: true,
      env: irpkgGenerator.env,
    });
    const report = await readFile(reportPath, "utf8").catch(() => "");
    const diagnostics = packageDiagnostics(report);
    if (!result.ok) {
      return {
        ok: false,
        packagePath,
        reportPath,
        diagnostics,
        failure: classifyPackageFailure(diagnostics, result.stderr),
        stderr: result.stderr,
      };
    }
    return { ok: true, packagePath, reportPath, diagnostics };
  }

  async function run(fixture) {
    const start = timerStart();
    const expectation = fixtureExpectation(fixture);
    const hostStart = timerStart();
    const host = await hostOracle(fixture);
    const hostSeconds = elapsedSeconds(hostStart);
    const hostResult = evaluateFixtureRun({
      phase: "host",
      fixture,
      expectation,
      host,
      timing: { total: elapsedSeconds(start), host: hostSeconds, package: 0, wasm: 0 },
    });
    if (hostResult !== null) return hostResult;

    const packageStart = timerStart();
    const generated = await generatePackage(fixture);
    const packageSeconds = elapsedSeconds(packageStart);
    const packageResult = evaluateFixtureRun({
      phase: "package",
      fixture,
      expectation,
      host,
      generated,
      timing: { total: elapsedSeconds(start), host: hostSeconds, package: packageSeconds, wasm: 0 },
    });
    if (packageResult !== null) return packageResult;

    const wasmStart = timerStart();
    const runtime = await instantiateWasm(generated.packagePath);
    let wasm;
    try {
      wasm = runtime.call(fixture.entry);
    } finally {
      runtime.dispose();
    }
    const wasmSeconds = elapsedSeconds(wasmStart);
    return evaluateFixtureRun({
      phase: "wasm",
      fixture,
      expectation,
      host,
      generated,
      wasm,
      timing: {
        total: elapsedSeconds(start),
        host: hostSeconds,
        package: packageSeconds,
        wasm: wasmSeconds,
      },
    });
  }

  return Object.freeze({ run });
}
