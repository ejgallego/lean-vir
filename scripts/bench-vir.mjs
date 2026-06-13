/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

import { ensureCachedBenchArtifacts } from "./bench-artifact-cache.mjs";
import { formatMs, median, requireBenchmarkSample } from "./bench-utils.mjs";
import { createVirRuntime as createBrowserVirRuntime } from "../web/src/vir-runtime.js";
import {
  createVirRuntime as createNodeVirRuntime,
  createVirtualDocumentState,
  ensureVirtualElementState,
} from "../web/src/vir-runtime-node.js";
import { runSync } from "./process-utils.mjs";

const root = new URL("..", import.meta.url);

const fibInput = 17;
const fibIterations = 80;
const sortInput = [7, 3, 9, 1, 4, 1, 5, 2, 8, 6, 0, 10, 12, 11, 13, 14];
const sortIterations = 2000;
const hostScalarIterations = 5000;
const callbackIterations = 5000;
const domResourceIterations = 1000;
const reactRootIterations = 500;
const benchArtifactPaths = [
  "web/public/vir-upstream.wasm",
  "web/public/fixtures-basic.irpkg",
  "web/public/demo-host.irpkg",
];
const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const parsed = {
    artifactCacheEnabled: true,
    artifactCachePath: null,
    jsonPath: null,
    refreshArtifactCache: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      parsed.jsonPath = requireOptionValue(argv, ++index, "--json");
    } else if (arg.startsWith("--json=")) {
      parsed.jsonPath = arg.slice("--json=".length);
    } else if (arg === "--artifact-cache") {
      parsed.artifactCachePath = requireOptionValue(argv, ++index, "--artifact-cache");
    } else if (arg.startsWith("--artifact-cache=")) {
      parsed.artifactCachePath = arg.slice("--artifact-cache=".length);
    } else if (arg === "--no-artifact-cache") {
      parsed.artifactCacheEnabled = false;
    } else if (arg === "--refresh-artifact-cache") {
      parsed.refreshArtifactCache = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      throw new Error(`unknown benchmark argument: ${arg}`);
    }
  }
  if (parsed.jsonPath === "") {
    throw new Error("--json requires a path");
  }
  if (parsed.artifactCachePath === "") {
    throw new Error("--artifact-cache requires a path");
  }
  return parsed;
}

function requireOptionValue(argv, index, option) {
  const value = argv[index];
  if (value === undefined || value === "") {
    throw new Error(`${option} requires a path`);
  }
  return value;
}

function printUsage() {
  console.log([
    "usage: npm run bench -- [options]",
    "",
    "options:",
    "  --json PATH                    write a machine-readable benchmark report",
    "  --artifact-cache DIR           cache built benchmark inputs in DIR",
    "  --no-artifact-cache            rebuild inputs without cache restore/store",
    "  --refresh-artifact-cache       rebuild and replace the current cache entry",
  ].join("\n"));
}

async function instantiateRuntimes() {
  const wasm = await readFile(new URL("../web/public/vir-upstream.wasm", import.meta.url));
  const irPackage = await readFile(new URL("../web/public/fixtures-basic.irpkg", import.meta.url));
  const hostPackage = await readFile(new URL("../web/public/demo-host.irpkg", import.meta.url));
  const virtualDocumentState = createVirtualDocumentState();
  ensureVirtualElementState(virtualDocumentState, "#bench-dom");
  ensureVirtualElementState(virtualDocumentState, "#bench-react");
  const runtime = await createBrowserVirRuntime({ wasmBytes: wasm, irPackageBytes: irPackage });
  const hostRuntime = await createNodeVirRuntime({
    wasmBytes: wasm,
    irPackageBytes: hostPackage,
    virtualDocumentState,
    hostBindings: createBenchmarkHostBindings(),
  });
  return { runtime, hostRuntime };
}

function createBenchmarkHostBindings() {
  return {
    "test.callNatCallback": (input, callback) => {
      try {
        return callback(input);
      } finally {
        callback.release();
      }
    },
    "test.recordNat": () => undefined,
  };
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
  const stdout = runSync("lean", ["--run", "tools/HostInterpreterBench.lean", ...args], {
    cwd: root,
    capture: true,
  });
  const sample = requireBenchmarkSample(stdout, "host-ir", label, "host IR");
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

function printWasmRow(name, sample) {
  const perCall = sample.medianMs / sample.iterations;
  console.log(`${name}`);
  console.log(`  wasm IR:   ${formatMs(sample.medianMs)} total, ${formatMs(perCall)} / call`);
  console.log(`  checksum:  ${sample.checksum}`);
}

function benchmarkReportRow(name, title, wasm, host = null) {
  return {
    name,
    title,
    wasm: benchmarkSampleReport(wasm),
    ...(host === null ? {} : {
      host: benchmarkSampleReport(host),
      ratioWasmToHost: (wasm.medianMs / wasm.iterations) / (host.medianMs / host.iterations),
    }),
  };
}

function benchmarkSampleReport(sample) {
  return {
    label: sample.label,
    iterations: sample.iterations,
    checksum: sample.checksum,
    medianMs: sample.medianMs,
    perCallMs: sample.medianMs / sample.iterations,
  };
}

function gitMetadata() {
  return {
    commit: runSync("git", ["rev-parse", "HEAD"], { cwd: root, capture: true }),
    ref: runSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, capture: true }),
    dirty: runSync("git", ["status", "--short"], { cwd: root, capture: true }).length !== 0,
  };
}

async function writeJsonReport(path, benchmarks) {
  const report = {
    schema: "lean-vir.bench.v1",
    generatedAt: new Date().toISOString(),
    command: "npm run bench",
    git: gitMetadata(),
    environment: {
      node: process.version,
      v8: process.versions.v8,
      platform: process.platform,
      arch: process.arch,
    },
    artifactCache,
    benchmarks,
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log();
  console.log(`wrote benchmark report: ${path}`);
}

const artifactCache = await ensureCachedBenchArtifacts({
  root,
  artifactPaths: benchArtifactPaths,
  options: args,
  build: () => runSync("npm", ["run", "--silent", "build:demo"], { cwd: root }),
});
const { runtime, hostRuntime } = await instantiateRuntimes();

const wasmFib = benchWasmRepeated("fib", fibIterations, () => {
  let acc = 0;
  for (let i = 0; i < fibIterations; i++) {
    acc += Number(runtime.call("fib", fibInput));
  }
  return acc;
});
const hostFib = benchHostIr("fib", fibIterations, ["fib", String(fibIterations), String(fibInput)]);

const wasmSort = benchWasmRepeated("sort", sortIterations, () => {
  let acc = 0;
  for (let i = 0; i < sortIterations; i++) {
    acc += Number(runtime.call("SortDemo.demoFromArray", sortInput));
  }
  return acc;
});
const hostSort = benchHostIr("sort", sortIterations, ["sort", String(sortIterations), sortInput.join(",")]);

const wasmHostScalar = benchWasmRepeated("host-title", hostScalarIterations, () => {
  return Number(hostRuntime.call("HostInterop.titleHandshakeLoop", hostScalarIterations));
});

const wasmCallback = benchWasmRepeated("callback-roundtrip", callbackIterations, () => {
  return Number(hostRuntime.call("HostInterop.callbackRoundTripLoop", callbackIterations));
});

const wasmDomResource = benchWasmRepeated("dom-listener-resource", domResourceIterations, () => {
  return Number(hostRuntime.call("HostInterop.mountAndRemoveCallbackEventLoop", "#bench-dom", domResourceIterations));
});

const wasmReactRoot = benchWasmRepeated("react-root-lifecycle", reactRootIterations, () => {
  return Number(hostRuntime.call("ReactCounter.mountAndUnmountLoop", "#bench-react", reactRootIterations));
});

console.log("# Lean VIR benchmark");
console.log("Host baseline is `lean --run` with `interpreter.prefer_native=false`.");
console.log("WASM timings use the manifest-driven JavaScript runtime API.");
console.log("Host timings exclude Lean frontend startup.");
console.log();
console.log("Pure runtime controls");
console.log();
printRow(`fib(${fibInput}) x ${fibIterations}`, wasmFib, hostFib);
console.log();
printRow(`sort/checksum ${sortInput.length} items x ${sortIterations}`, wasmSort, hostSort);
console.log();
console.log("Host/resource paths");
console.log();
printWasmRow(`host scalar title handshake x ${hostScalarIterations}`, wasmHostScalar);
console.log();
printWasmRow(`callback root round trip x ${callbackIterations}`, wasmCallback);
console.log();
printWasmRow(`DOM listener resource create/remove x ${domResourceIterations}`, wasmDomResource);
console.log();
printWasmRow(`React root mount/render/unmount x ${reactRootIterations}`, wasmReactRoot);

if (args.jsonPath !== null) {
  await writeJsonReport(args.jsonPath, [
    benchmarkReportRow("fib", `fib(${fibInput}) x ${fibIterations}`, wasmFib, hostFib),
    benchmarkReportRow("sort", `sort/checksum ${sortInput.length} items x ${sortIterations}`, wasmSort, hostSort),
    benchmarkReportRow(
      "host-title",
      `host scalar title handshake x ${hostScalarIterations}`,
      wasmHostScalar,
    ),
    benchmarkReportRow(
      "callback-roundtrip",
      `callback root round trip x ${callbackIterations}`,
      wasmCallback,
    ),
    benchmarkReportRow(
      "dom-listener-resource",
      `DOM listener resource create/remove x ${domResourceIterations}`,
      wasmDomResource,
    ),
    benchmarkReportRow(
      "react-root-lifecycle",
      `React root mount/render/unmount x ${reactRootIterations}`,
      wasmReactRoot,
    ),
  ]);
}

runtime.dispose();
hostRuntime.dispose();
