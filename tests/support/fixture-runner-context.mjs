/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { fixtureExpectation, fixtureRoots } from "../../fixtures/fixture-manifest.mjs";
import { requireSuccessfulProcess, runAsync } from "../../scripts/process-utils.mjs";
import { elapsedSeconds, timerStart } from "../../scripts/timing-utils.mjs";
import { createVirRuntime } from "../../web/src/vir-runtime.js";
import { classifyPackageFailure, packageDiagnostics } from "./fixture-diagnostics.mjs";
import { evaluateFixtureRun } from "./fixture-result.mjs";

export function createFixtureRunnerContext({ root, buildDir, wasmPath, irpkgGenerator,
  moduleBySource, hostProject, hostModuleById, hostEnv }) {
  let wasmBytesPromise = null;

  async function hostOracle(fixture) {
    const hostPath = hostProject.sourcePath(hostModuleById.get(fixture.id));
    const result = await runAsync("lean", ["--run", hostPath], {
      cwd: hostProject.directory, env: hostEnv, capture: true,
    });
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
    return createVirRuntime({ wasmBytes: wasm, irPackageSet: [irPackage] });
  }

  async function generatePackage(fixture) {
    const packagePath = new URL(`${fixture.id}.irpkg`, buildDir);
    const reportPath = new URL(`${fixture.id}.report.md`, buildDir);
    const args = [
      fileURLToPath(packagePath),
      fileURLToPath(reportPath),
      "--target-module",
      moduleBySource.get(fixture.source),
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
