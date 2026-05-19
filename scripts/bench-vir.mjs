/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { performance } from "node:perf_hooks";

const root = new URL("..", import.meta.url);

const fibInput = 17;
const fibIterations = 80;
const sortInput = [7, 3, 9, 1, 4, 1, 5, 2, 8, 6, 0, 10, 12, 11, 13, 14];
const sortIterations = 2000;

function run(cmd, args, options = {}) {
  const result = spawnSync(cmd, args, {
    cwd: root,
    encoding: "utf8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed with status ${result.status}\n${result.stderr ?? ""}`);
  }
  return result.stdout?.trim() ?? "";
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function formatMs(ms) {
  return ms < 1 ? `${(ms * 1000).toFixed(1)} us` : `${ms.toFixed(2)} ms`;
}

function parseHostIrSamples(stdout, label) {
  const samples = [];
  let checksum = 0;
  let iterations = 0;

  for (const line of stdout.split("\n")) {
    const match = /^host-ir (\S+) (\d+) (\d+) (\d+)$/.exec(line.trim());
    if (!match) continue;
    if (match[1] !== label) continue;
    iterations = Number(match[2]);
    checksum = Number(match[3]);
    samples.push(Number(match[4]) / 1_000_000);
  }

  if (samples.length === 0) {
    throw new Error(`no host IR benchmark samples found for ${label}`);
  }

  return { label, iterations, checksum, medianMs: median(samples) };
}

async function instantiateWasm() {
  const wasm = await readFile(new URL("../web/public/vir-upstream.wasm", import.meta.url));
  const irPackage = await readFile(new URL("../web/public/vir-demo.irpkg", import.meta.url));
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

  const packagePtr = exports.vir_alloc_bytes(irPackage.byteLength);
  try {
    new Uint8Array(exports.memory.buffer, packagePtr, irPackage.byteLength).set(irPackage);
    const loadedDecls = exports.vir_load_ir_package(packagePtr, irPackage.byteLength);
    if (loadedDecls === 0) {
      throw new Error("IR package load failed");
    }
  } finally {
    exports.vir_free_bytes?.(packagePtr);
  }

  return exports;
}

function writeU32Array(exports, values) {
  const ptr = exports.vir_alloc_bytes(values.length * 4);
  const view = new DataView(exports.memory.buffer, ptr, values.length * 4);
  values.forEach((value, index) => view.setUint32(index * 4, value, true));
  return ptr;
}

function benchWasmRepeated(label, iterations, fn) {
  const samples = [];
  let checksum = 0;
  for (let sample = 0; sample < 7; sample++) {
    const start = performance.now();
    const acc = fn();
    samples.push(performance.now() - start);
    checksum = acc;
  }
  return { label, iterations, checksum, medianMs: median(samples) };
}

function benchHostIr(label, iterations, args) {
  const stdout = run("lean", ["--run", "tools/HostInterpreterBench.lean", ...args], { capture: true });
  const sample = parseHostIrSamples(stdout, label);
  if (sample.iterations !== iterations) {
    throw new Error(`host IR ${label}: expected ${iterations} iterations, got ${sample.iterations}`);
  }
  return sample;
}

function printRow(name, wasm, host) {
  const wasmPerCall = wasm.medianMs / wasm.iterations;
  const hostPerCall = host.medianMs / host.iterations;
  const ratio = wasmPerCall / hostPerCall;
  console.log(`${name}`);
  console.log(`  wasm IR:     ${formatMs(wasm.medianMs)} total, ${formatMs(wasmPerCall)} / call`);
  console.log(`  host Lean IR: ${formatMs(host.medianMs)} total, ${formatMs(hostPerCall)} / call`);
  console.log(`  ratio:       ${ratio.toFixed(1)}x slower than host Lean IR`);
  console.log(`  checksums:   wasm=${wasm.checksum} host=${host.checksum}`);
}

run("npm", ["run", "--silent", "build:demo"]);

const exports = await instantiateWasm();

const wasmFib = benchWasmRepeated("fib", fibIterations, () =>
  exports.vir_upstream_fib_repeated(fibIterations, fibInput)
);
const hostFib = benchHostIr("fib", fibIterations, ["fib", String(fibIterations), String(fibInput)]);

const sortPtr = writeU32Array(exports, sortInput);
let wasmSort;
try {
  wasmSort = benchWasmRepeated("sort", sortIterations, () =>
    exports.vir_sort_checksum_repeated(sortPtr, sortInput.length, sortIterations)
  );
} finally {
  exports.vir_free_bytes?.(sortPtr);
}
const hostSort = benchHostIr("sort", sortIterations, ["sort", String(sortIterations), sortInput.join(",")]);

console.log("# Lean VIR benchmark");
console.log("Host baseline is `lean --run` with `interpreter.prefer_native=false`.");
console.log("WASM timings use batched exports: one JS -> WASM measured call per sample.");
console.log("Host timings exclude Lean frontend startup.");
console.log();
printRow(`fib(${fibInput}) x ${fibIterations}`, wasmFib, hostFib);
console.log();
printRow(`sort/checksum ${sortInput.length} items x ${sortIterations}`, wasmSort, hostSort);
