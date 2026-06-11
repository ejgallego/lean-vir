/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { existsSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { delimiter, join } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

import { formatMs, parseBenchmarkSamples, requireBenchmarkSample } from "./bench-utils.mjs";
import { runSync } from "./process-utils.mjs";

const root = new URL("..", import.meta.url);
const benchWasm = "build/upstream-probe/vir-engine-bench.wasm";
const sortInput = "7,3,9,1,4,1,5,2,8,6,0,10,12,11,13,14";
const engineTimeoutMs = Number(process.env.VIR_ENGINE_TIMEOUT_MS ?? "20000");
const wasmedgeTimeoutMs = Number(process.env.VIR_WASMEDGE_TIMEOUT_MS ?? "5000");
const engineHome = fileURLToPath(new URL("../.tools/engine-home", import.meta.url));
mkdirSync(join(engineHome, "cache"), { recursive: true });
mkdirSync(join(engineHome, "config"), { recursive: true });
mkdirSync(join(engineHome, "wasmer"), { recursive: true });

function commandExists(cmd) {
  const result = spawnSync(cmd, ["--version"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: engineEnv(),
  });
  return result.status === 0;
}

function findCommand(names) {
  for (const name of names) {
    if (name.includes("/") && existsSync(new URL(name, root))) {
      return name;
    }
    if (!name.includes("/") && commandExists(name)) {
      return name;
    }
  }
  return null;
}

function parseHostIr(label, stdout) {
  return requireBenchmarkSample(stdout, "host-ir", label, "host IR");
}

function engineVersion(cmd, args = ["--version"]) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: engineEnv(),
  });
  return (result.stdout || result.stderr).trim().split("\n")[0] || "unknown version";
}

function engineEnv() {
  return {
    ...process.env,
    HOME: engineHome,
    XDG_CACHE_HOME: join(engineHome, "cache"),
    XDG_CONFIG_HOME: join(engineHome, "config"),
    WASMER_DIR: join(engineHome, "wasmer"),
    PATH: [
      new URL(".tools/wasmtime", root).pathname,
      new URL(".tools/wasmer/bin", root).pathname,
      new URL(".tools/wasmedge/bin", root).pathname,
      process.env.PATH ?? "",
    ].join(delimiter),
  };
}

function runEngine(engine) {
  const start = performance.now();
  const result = spawnSync(engine.cmd, engine.args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: engineEnv(),
    timeout: engine.timeoutMs ?? engineTimeoutMs,
  });
  const elapsedMs = performance.now() - start;
  if (result.error?.code === "ETIMEDOUT") {
    return {
      name: engine.name,
      status: "failed",
      detail: `timed out after ${engine.timeoutMs ?? engineTimeoutMs}ms`,
    };
  }
  if (result.status !== 0) {
    return {
      name: engine.name,
      status: "failed",
      detail: (result.stderr || result.stdout).trim(),
    };
  }
  return {
    name: engine.name,
    version: engine.version(),
    status: "ok",
    elapsedMs,
    samples: parseBenchmarkSamples(result.stdout, "engine-bench"),
  };
}

function printBenchmark(label, title, host, engines) {
  console.log(title);
  console.log(`  host Lean IR: ${formatMs(host.medianMs)} total, ${formatMs(host.medianMs / host.iterations)} / call`);
  for (const engine of engines) {
    if (engine.status !== "ok") continue;
    const sample = engine.samples.get(label);
    if (!sample) {
      console.log(`  ${engine.name}: missing ${label} samples`);
      continue;
    }
    const perCall = sample.medianMs / sample.iterations;
    const hostPerCall = host.medianMs / host.iterations;
    console.log(`  ${engine.name}: ${formatMs(sample.medianMs)} total, ${formatMs(perCall)} / call, ${(perCall / hostPerCall).toFixed(1)}x host IR`);
  }
}

runSync("bash", ["scripts/build-engine-bench.sh"], { cwd: root, trimStdout: false });

const engines = [
  {
    name: "node-wasi-v8",
    cmd: process.execPath,
    args: ["--no-warnings", "scripts/run-node-wasi-bench.mjs", benchWasm],
    version: () => `node ${process.version}, V8 ${process.versions.v8}`,
  },
];

const wasmtime = findCommand([".tools/wasmtime/wasmtime", "wasmtime"]);
if (wasmtime) {
  engines.push({
    name: "wasmtime",
    cmd: wasmtime,
    args: ["run", benchWasm],
    version: () => engineVersion(wasmtime),
  });
}

const wasmer = findCommand([".tools/wasmer/bin/wasmer", ".tools/wasmer/wasmer", "wasmer"]);
if (wasmer) {
  engines.push({
    name: "wasmer",
    cmd: wasmer,
    args: ["run", benchWasm],
    version: () => engineVersion(wasmer),
  });
}

const wasmedge = findCommand([".tools/wasmedge/bin/wasmedge", "wasmedge"]);
if (wasmedge) {
  engines.push({
    name: "wasmedge",
    cmd: wasmedge,
    args: [benchWasm],
    timeoutMs: wasmedgeTimeoutMs,
    version: () => engineVersion(wasmedge),
  });
}

const results = engines.map(runEngine);
const okEngines = results.filter((result) => result.status === "ok");
if (okEngines.length === 0) {
  const details = results
    .map((result) => `${result.name}: ${result.detail?.split("\n")[0] ?? result.status}`)
    .join("; ");
  throw new Error(`no WASM engines completed the benchmark${details ? ` (${details})` : ""}`);
}

const hostFibStdout = runSync("lean", ["--run", "tools/HostInterpreterBench.lean", "fib", "80", "17"], {
  cwd: root,
  capture: true,
  trimStdout: false,
});
const hostSortStdout = runSync("lean", ["--run", "tools/HostInterpreterBench.lean", "sort", "2000", sortInput], {
  cwd: root,
  capture: true,
  trimStdout: false,
});
const hostFib = parseHostIr("fib", hostFibStdout);
const hostSort = parseHostIr("sort", hostSortStdout);

console.log("# Lean VIR engine benchmark");
console.log("All engine timings are measured inside the same WASI command module.");
console.log("Host baseline is `lean --run` with `interpreter.prefer_native=false`.");
console.log();
console.log("Engines:");
for (const result of results) {
  if (result.status === "ok") {
    console.log(`  ${result.name}: ${result.version}`);
  } else {
    console.log(`  ${result.name}: failed`);
  }
}
console.log();
printBenchmark("fib", "fib(17) x 80", hostFib, okEngines);
console.log();
printBenchmark("sort", "sort/checksum 16 items x 2000", hostSort, okEngines);

const failed = results.filter((result) => result.status === "failed");
if (failed.length !== 0) {
  console.log();
  console.log("Failed engines:");
  for (const result of failed) {
    console.log(`  ${result.name}: ${result.detail.split("\n")[0]}`);
  }
}
