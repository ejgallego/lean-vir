/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile, mkdir, open } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { sha256, summarizePairedSamples } from "./bench-utils.mjs";
import { nativeCodecCases } from "./native-codec-values.mjs";
import { createTestModuleProject } from "../../tests/support/module-project.mjs";

const fixture = new URL("../../fixtures/runtime/NativeCodecBench.lean", import.meta.url);
const directions = ["roundtrip", "input", "output"];
const exportName = (prefix, suffix) => `NativeCodecBench.${prefix}${suffix}`;

// Assertions run after the clock closes. A faster incorrect result is rejected.
export function timedNativeCalls(invoke, expected, calls, now = () => performance.now()) {
  let result;
  const start = now();
  for (let i = 0; i < calls; i++) result = invoke();
  const elapsedMs = now() - start;
  assert.deepEqual(result, expected);
  return elapsedMs;
}

function healthy(runtime, carriers) {
  assert.equal(runtime.failure, null);
  assert.equal(runtime.exports.vir_resource_roots_active(), 0);
  assert.equal(runtime.hostState.leanObjectHandleCells.size, carriers);
}

function bindCase(runtime, testCase) {
  const expected = testCase.expected;
  const start = performance.now();
  const retained = runtime.call(exportName("retain", testCase.suffix), testCase.value);
  const retainedPreparationMs = performance.now() - start;
  const invokes = {
    roundtrip: () => runtime.call(exportName("identity", testCase.suffix), testCase.value),
    input: () => runtime.call(exportName("consume", testCase.suffix), testCase.value),
    output: () => runtime.call(exportName("restore", testCase.suffix), retained),
  };
  return {
    invokes, retainedPreparationMs,
    expected: { roundtrip: expected, input: testCase.consumed, output: expected },
    verifyInput: () => assert.deepEqual(testCase.value, expected),
  };
}

async function freshRuntime(version, wasm) {
  const factoryStart = performance.now();
  const factory = version.createFactory({ wasmBytes: wasm });
  const factoryMs = performance.now() - factoryStart;
  const runtimeStart = performance.now();
  const runtime = await factory.createRuntime({ irPackageSet: [version.packageBytes] });
  const runtimeMs = performance.now() - runtimeStart;
  return { runtime, factoryMs, runtimeMs };
}

async function loadVersion(version, wasm, wasmFile) {
  const sdk = pathToFileURL(`${version.sdk}/`);
  const artifact = JSON.parse(await readFile(new URL("lean-vir-artifact.json", sdk)));
  assert.equal(artifact.gitDirty, false, `${version.label}: SDK source must be frozen`);
  for (const file of artifact.files) {
    assert.equal(sha256(await readFile(new URL(file.path, sdk))), file.sha256,
      `${version.label}: changed SDK payload ${file.path}`);
  }
  assert.equal(artifact.files.find(file => file.path === `wasm/${wasmFile}`)?.sha256,
    sha256(wasm), `${version.label}: selected Wasm must match the SDK`);
  const start = performance.now();
  const { createVirRuntimeFactory } = await import(new URL("js/vir-runtime-node.js", sdk));
  const importMs = performance.now() - start;
  const { readIrPackageInfo, IR_PACKAGE_SECTION } = await import(
    new URL("js/runtime/ir-package.js", sdk));
  const packageBytes = await readFile(version.package);
  const info = readIrPackageInfo(packageBytes);
  const nativeSections = info.package.sections
    .filter(section => section.kind !== IR_PACKAGE_SECTION.INTERFACE_MANIFEST)
    .map(section => ({ kind: section.kind, sha256: sha256(packageBytes.subarray(
      section.offset, section.offset + section.byteLength)) }));
  return {
    ...version, createFactory: createVirRuntimeFactory, packageBytes,
    identity: { label: version.label, artifact, packageSha256: sha256(packageBytes),
      nativeSections, importMs, manifestBytes: info.package.sections.find(
        section => section.kind === IR_PACKAGE_SECTION.INTERFACE_MANIFEST).byteLength },
  };
}

async function prepare(config) {
  const source = await readFile(fixture, "utf8");
  for (const version of [config.control, config.candidate]) {
    assert.ok(version.sourceRoot, "prepare requires each variant's sourceRoot");
    const { prepareVirIrpkgSync } = await import(pathToFileURL(
      resolve(version.sourceRoot, "scripts/packages/irpkg-generator.mjs")));
    const generator = prepareVirIrpkgSync({ noBuild: true });
    assert.equal(generator.ok, true, `${version.label}: matching compiled inputs required`);
    await mkdir(dirname(version.package), { recursive: true });
    const project = await createTestModuleProject({
      directory: `${version.package}.modules`, dependencyRoot: version.sourceRoot,
      modules: { NativeCodecBench: source },
    });
    const built = project.build();
    assert.equal(built.status, 0, `${built.stdout}\n${built.stderr}`);
    const packed = spawnSync(generator.path, [version.package, `${version.package}.report.md`,
      "--target-marked-module", "NativeCodecBench"], {
        cwd: project.directory, env: project.env(), encoding: "utf8", timeout: 30_000,
      });
    assert.equal(packed.status, 0, `${packed.stdout}\n${packed.stderr}`);
  }
  console.log("native codec benchmark packages prepared");
}

export async function runNativeCodecComparison(config) {
  const wasmFile = config.profile === "debug" ? "vir-upstream.dev.wasm" : "vir-upstream.wasm";
  const wasm = await readFile(config.wasm);
  const versions = {};
  // Module import observations are separate from paired fresh-runtime samples.
  for (const id of ["control", "candidate"])
    versions[id] = await loadVersion(config[id], wasm, wasmFile);
  assert.deepEqual(versions.control.identity.nativeSections,
    versions.candidate.identity.nativeSections, "native program sections differ");
  assert.equal(versions.control.identity.artifact.leanToolchain,
    versions.candidate.identity.artifact.leanToolchain);
  const report = {
    schema: "lean-vir.native-codec-bench.v1", status: "running",
    identity: {
      node: process.version, v8: process.versions.v8,
      platform: process.platform, arch: process.arch, cpu: os.cpus()[0]?.model,
      fixture: sha256(await readFile(fixture)),
      harness: await Promise.all([import.meta.url, new URL("native-codec-values.mjs", import.meta.url),
        new URL("bench-utils.mjs", import.meta.url),
      ].map(async path => ({
          path: String(path), sha256: sha256(await readFile(new URL(path))),
        }))),
      wasm: sha256(wasm), versions: Object.fromEntries(Object.entries(versions)
        .map(([id, version]) => [id, version.identity])),
      config, timing: "synchronous public runtime.call; validation outside timing",
    },
    cold: [], rows: [], summaries: [],
  };
  await mkdir(dirname(config.output), { recursive: true });
  const destination = await open(config.output, "wx");
  try {
    for (const corpus of ["small", "large"]) for (const size of config.sizes) {
      const cases = nativeCodecCases(size, corpus).filter(testCase =>
        config.cases === undefined || config.cases.includes(testCase.name))
        .map(testCase => ({ ...testCase, expected: structuredClone(testCase.value) }));
      assert.ok(cases.length, "case selection is empty");
      for (let round = 0; round < config.coldRounds; round++) {
        const order = round % 2 === 0 ? ["control", "candidate"] : ["candidate", "control"];
        for (const [sequence, id] of order.entries()) {
          const { runtime, factoryMs, runtimeMs } = await freshRuntime(versions[id], wasm);
          const host = runtime.hostState;
          const trial = { id, corpus, size, round, sequence, factoryMs, runtimeMs, cases: [] };
          report.cold.push(trial);
          try {
            for (const [index, testCase] of cases.entries()) {
              const bound = bindCase(runtime, testCase);
              const observation = { case: testCase.name,
                retainedPreparationMs: bound.retainedPreparationMs, firstCalls: {} };
              trial.cases.push(observation);
              for (const direction of directions) {
                observation.firstCalls[direction] = timedNativeCalls(bound.invokes[direction],
                  bound.expected[direction], 1);
              }
              bound.verifyInput();
              healthy(runtime, index + 1);
            }
          } finally {
            runtime.dispose();
            assert.equal(host.leanObjectHandleCells.size, 0);
          }
        }
      }
      const runtimes = {};
      try {
        const bound = {};
        for (const id of ["control", "candidate"]) {
          runtimes[id] = (await freshRuntime(versions[id], wasm)).runtime;
          bound[id] = cases.map(testCase => bindCase(runtimes[id], testCase));
        }
        for (const [index, testCase] of cases.entries()) for (const direction of directions) {
          for (let warmup = 0; warmup < config.warmups; warmup++)
            for (const id of ["control", "candidate"])
              assert.deepEqual(bound[id][index].invokes[direction](),
                bound[id][index].expected[direction]);
          const samples = { control: [], candidate: [] }, orders = [];
          for (let round = 0; round < config.rounds; round++) {
            const order = round % 2 === 0 ? ["control", "candidate"] : ["candidate", "control"];
            orders.push(order);
            for (const [sequence, id] of order.entries()) {
              const elapsedMs = timedNativeCalls(bound[id][index].invokes[direction],
                bound[id][index].expected[direction], config.calls);
              samples[id].push(elapsedMs);
              report.rows.push({ id, corpus, size, case: testCase.name, direction,
                round, sequence, calls: config.calls, elapsedMs });
              bound[id][index].verifyInput();
              healthy(runtimes[id], cases.length);
            }
          }
          report.summaries.push({ corpus, size, case: testCase.name, direction,
            ...summarizePairedSamples(samples.control, samples.candidate, config.calls, orders) });
        }
      } finally {
        for (const runtime of Object.values(runtimes)) {
          const host = runtime.hostState;
          runtime.dispose();
          assert.equal(host.leanObjectHandleCells.size, 0);
        }
      }
    }
    report.status = "passed";
  } catch (error) {
    report.status = "failed";
    report.error = { name: error.name, message: error.message };
    throw error;
  } finally {
    await destination.writeFile(JSON.stringify(report, null, 2));
    await destination.close();
  }
  return report;
}

async function main() {
  const [command, path] = process.argv.slice(2);
  assert.ok(["prepare", "run"].includes(command) && path,
    "usage: node benchmarks/harness/bench-native-codecs.mjs prepare|run CONFIG.json");
  const configPath = resolve(path), base = dirname(configPath);
  const config = { sizes: [0, 16, 128, 1024], warmups: 10, rounds: 12,
    calls: 10, coldRounds: 2, ...JSON.parse(await readFile(configPath, "utf8")) };
  for (const name of ["warmups", "rounds", "calls", "coldRounds"])
    assert.ok(Number.isSafeInteger(config[name]) && config[name] > 0, `invalid ${name}`);
  assert.equal(config.rounds % 2, 0, "rounds must balance AB/BA order");
  assert.equal(config.coldRounds % 2, 0, "coldRounds must balance AB/BA order");
  assert.ok(config.sizes.length && config.sizes.every(size =>
    Number.isSafeInteger(size) && size >= 0 && size <= 1024), "sizes must be in 0..1024");
  assert.ok(["release", "debug"].includes(config.profile), "profile must be release or debug");
  for (const id of ["control", "candidate"]) {
    assert.ok(config[id] && typeof config[id].label === "string" && config[id].label,
      "each variant requires a label");
    for (const key of ["sdk", "package"])
      assert.ok(typeof config[id][key] === "string" && config[id][key], `missing ${id}.${key}`);
    for (const key of ["sdk", "package", "sourceRoot"])
      if (config[id][key] !== undefined) config[id][key] = resolve(base, config[id][key]);
  }
  for (const key of ["wasm", "output"]) {
    assert.ok(typeof config[key] === "string" && config[key], `missing ${key}`);
    config[key] = resolve(base, config[key]);
  }
  if (command === "prepare") await prepare(config);
  else {
    const report = await runNativeCodecComparison(config);
    console.log(`native codec comparison PASS: ${report.rows.length} rows; ${config.output}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href)
  await main();
