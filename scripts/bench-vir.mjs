/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

import { ensureCachedBenchArtifacts } from "./bench-artifact-cache.mjs";
import {
  benchmarkArtifactPaths,
  defaultPackageFile,
  hostPackageFile,
  publicArtifactPath,
  wasmPublicFile,
} from "./browser-package-config.mjs";
import {
  benchmarkCacheOptionDefaults,
  formatMs,
  median,
  parseBenchmarkCacheOption,
  requireBenchmarkSample,
  requireOptionValue,
  validateBenchmarkCacheOptions,
} from "./bench-utils.mjs";
import { createVirRuntime as createBrowserVirRuntime } from "../web/src/vir-runtime.js";
import {
  decodeCallResult,
  decodeResolvedCallResult,
  encodeCallPayload,
  encodeResolvedCallPayload,
} from "../web/src/runtime/vir-value-codec.js";
import {
  createVirRuntime as createNodeVirRuntime,
  createVirtualDocumentState,
  ensureVirtualElementState,
} from "../web/src/vir-runtime-node.js";
import { runSync } from "./process-utils.mjs";

const root = new URL("..", import.meta.url);

const fibInput = 17;
const fibIterations = 80;
const dispatchIterations = 20000;
const sortInput = [7, 3, 9, 1, 4, 1, 5, 2, 8, 6, 0, 10, 12, 11, 13, 14];
const sortIterations = 2000;
const hostScalarIterations = 250;
const callbackIterations = 1000;
const domResourceIterations = 300;
const reactRootIterations = 300;
const scalarRecordIterations = 5000;
const nestedRecordIterations = 3000;
const recursiveValueIterations = 2000;
const stringRoundtripIterations = 5000;
const codecScalarRecordIterations = 20000;
const codecNestedRecordIterations = 20000;
const codecRecursiveValueIterations = 20000;
const reactTextRenderIterations = 300;
const reactTextRenderWidth = 40;
const reactCallbackRenderIterations = 200;
const reactCallbackRenderWidth = 20;
const profileStatsInput = {
  enabled: true,
  level: 2,
  score16: 30,
  visits: 400,
  quota: 5,
  checksum: 6000,
  tier: "pro",
  note: "ok",
};
const profileEnvelopeInput = {
  profile: {
    nickname: "lean",
    points: 7,
    tags: ["ir", "wasm", "react", "wit"],
  },
  summary: {
    label: "lean:4",
    total: 24,
    bonus: 17,
  },
};
const recursiveJsonInput = {
  kind: "object",
  value: [
    {
      fst: "items",
      snd: {
        kind: "array",
        value: [
          { kind: "null" },
          { kind: "bool", value: true },
          { kind: "nat", value: 4 },
          {
            kind: "object",
            value: [
              { fst: "nested", snd: { kind: "array", value: [{ kind: "nat", value: 9 }] } },
            ],
          },
        ],
      },
    },
    { fst: "ok", snd: { kind: "bool", value: false } },
  ],
};
const stringRoundtripInput = "lean-ir-wasm-Aé∀Z";
const textEncoder = new TextEncoder();
const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const parsed = {
    ...benchmarkCacheOptionDefaults(),
    jsonPath: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      parsed.jsonPath = requireOptionValue(argv, ++index, "--json");
    } else if (arg.startsWith("--json=")) {
      parsed.jsonPath = arg.slice("--json=".length);
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      const nextIndex = parseBenchmarkCacheOption(parsed, argv, index);
      if (nextIndex !== null) {
        index = nextIndex;
        continue;
      }
      throw new Error(`unknown benchmark argument: ${arg}`);
    }
  }
  if (parsed.jsonPath === "") {
    throw new Error("--json requires a path");
  }
  validateBenchmarkCacheOptions(parsed);
  return parsed;
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
  const wasm = await readPublicArtifact(wasmPublicFile);
  const irPackage = await readPublicArtifact(defaultPackageFile);
  const hostPackage = await readPublicArtifact(hostPackageFile);
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

function readPublicArtifact(file) {
  return readFile(new URL(`../${publicArtifactPath(file)}`, import.meta.url));
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

function benchJsRepeated(label, iterations, fn) {
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

function printDispatchRow(name, named, resolved) {
  const namedPerCall = named.medianMs / named.iterations;
  const resolvedPerCall = resolved.medianMs / resolved.iterations;
  const deltaPct = ((resolvedPerCall - namedPerCall) / namedPerCall) * 100;
  const sign = deltaPct >= 0 ? "+" : "";
  const speed = namedPerCall / resolvedPerCall;
  console.log(`${name}`);
  console.log(`  named ABI:    ${formatMs(named.medianMs)} total, ${formatMs(namedPerCall)} / call`);
  console.log(
    `  resolved ABI: ${formatMs(resolved.medianMs)} total, ${formatMs(resolvedPerCall)} / call ` +
      `(${sign}${deltaPct.toFixed(1)}%, ${speed.toFixed(2)}x speed)`,
  );
  console.log(`  checksums:    named=${named.checksum} resolved=${resolved.checksum}`);
}

function printJsRow(name, sample) {
  const perCall = sample.medianMs / sample.iterations;
  console.log(`${name}`);
  console.log(`  js codec:  ${formatMs(sample.medianMs)} total, ${formatMs(perCall)} / call`);
  console.log(`  checksum:  ${sample.checksum}`);
}

function benchmarkDispatchReportRow(name, title, named, resolved) {
  return {
    name,
    title,
    named: benchmarkSampleReport(named),
    resolved: benchmarkSampleReport(resolved),
  };
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

function benchmarkJsReportRow(name, title, js) {
  return {
    name,
    title,
    js: benchmarkSampleReport(js),
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
  artifactPaths: benchmarkArtifactPaths,
  options: args,
  build: () => runSync("npm", ["run", "--silent", "build:demo"], { cwd: root }),
});
const { runtime, hostRuntime } = await instantiateRuntimes();

function manifestEntry(name) {
  const entry = runtime.findManifestEntry(name);
  if (entry === null) {
    throw new Error(`benchmark interface entry not found: ${name}`);
  }
  return entry;
}

function benchEncodeCallPayload(label, iterations, entry, args) {
  return benchJsRepeated(label, iterations, () => {
    let acc = 0;
    for (let i = 0; i < iterations; i++) {
      acc += encodeCallPayload(entry, args, runtime.codecOptions).byteLength;
    }
    return acc;
  });
}

function resolveRawCallSlot(entry, nameBytes) {
  const namePtr = runtime.allocBytes(nameBytes);
  try {
    const callSlot = runtime.exports.vir_resolve_call(namePtr, nameBytes.byteLength) >>> 0;
    if (callSlot === 0) {
      throw new Error(runtime.lastCallError() || `call entry not found: ${entry.entry}`);
    }
    return callSlot;
  } finally {
    runtime.freeBytes(namePtr);
  }
}

function callRawNamed(entry, namePtr, nameLen, payloadPtr, payloadLen) {
  const resultPtr = runtime.exports.vir_call(namePtr, nameLen, payloadPtr, payloadLen, entry.result.wireTag);
  if (resultPtr === 0) {
    throw new Error(runtime.lastCallError() || `named call failed: ${entry.entry}`);
  }
  const resultLen = runtime.exports.vir_call_result_size();
  return decodeCallResult(entry.result, runtime.readWasmBytes(resultPtr, resultLen), runtime.codecOptions);
}

function callRawResolved(entry, callSlot, payloadPtr, payloadLen) {
  const resultPtr = runtime.exports.vir_call_resolved(callSlot, payloadPtr, payloadLen, entry.result.wireTag);
  if (resultPtr === 0) {
    throw new Error(runtime.lastCallError() || `resolved call failed: ${entry.entry}`);
  }
  const resultLen = runtime.exports.vir_call_result_size();
  return decodeResolvedCallResult(entry.result, runtime.readWasmBytes(resultPtr, resultLen), runtime.codecOptions);
}

function benchTopLevelDispatch(entry) {
  const nameBytes = textEncoder.encode(entry.entry);
  const namedPayload = encodeCallPayload(entry, [], runtime.codecOptions);
  const resolvedPayload = encodeResolvedCallPayload(entry, [], runtime.codecOptions);
  const callSlot = resolveRawCallSlot(entry, nameBytes);
  const namePtr = runtime.allocBytes(nameBytes);
  const namedPayloadPtr = runtime.allocBytes(namedPayload);
  const resolvedPayloadPtr = runtime.allocBytes(resolvedPayload);
  try {
    const named = benchWasmRepeated("named", dispatchIterations, () => {
      let acc = 0;
      for (let i = 0; i < dispatchIterations; i++) {
        acc += Number(callRawNamed(entry, namePtr, nameBytes.byteLength, namedPayloadPtr, namedPayload.byteLength));
      }
      return acc;
    });
    const resolved = benchWasmRepeated("resolved", dispatchIterations, () => {
      let acc = 0;
      for (let i = 0; i < dispatchIterations; i++) {
        acc += Number(callRawResolved(entry, callSlot, resolvedPayloadPtr, resolvedPayload.byteLength));
      }
      return acc;
    });
    return { named, resolved };
  } finally {
    runtime.freeBytes(resolvedPayloadPtr);
    runtime.freeBytes(namedPayloadPtr);
    runtime.freeBytes(namePtr);
  }
}

const dispatchEntry = manifestEntry("Vir.Fixtures.Basic.branchAndSub");
const scalarRecordEntry = manifestEntry("Vir.Fixtures.InterfaceShapes.profileStatsScore");
const nestedRecordEntry = manifestEntry("Vir.Fixtures.InterfaceShapes.profileEnvelopeScore");
const recursiveValueEntry = manifestEntry("Vir.Fixtures.RecursiveTypes.jsonRootScore");

const dispatch = benchTopLevelDispatch(dispatchEntry);

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

const jsCodecScalarRecord = benchEncodeCallPayload(
  "codec-scalar-record",
  codecScalarRecordIterations,
  scalarRecordEntry,
  [profileStatsInput],
);

const jsCodecNestedRecord = benchEncodeCallPayload(
  "codec-nested-record",
  codecNestedRecordIterations,
  nestedRecordEntry,
  [profileEnvelopeInput],
);

const jsCodecRecursiveValue = benchEncodeCallPayload(
  "codec-recursive-value",
  codecRecursiveValueIterations,
  recursiveValueEntry,
  [recursiveJsonInput],
);

const wasmScalarRecord = benchWasmRepeated("scalar-record", scalarRecordIterations, () => {
  let acc = 0;
  for (let i = 0; i < scalarRecordIterations; i++) {
    acc += Number(runtime.call("Vir.Fixtures.InterfaceShapes.profileStatsScore", profileStatsInput));
  }
  return acc;
});

const wasmNestedRecord = benchWasmRepeated("nested-record", nestedRecordIterations, () => {
  let acc = 0;
  for (let i = 0; i < nestedRecordIterations; i++) {
    acc += Number(runtime.call("Vir.Fixtures.InterfaceShapes.profileEnvelopeScore", profileEnvelopeInput));
  }
  return acc;
});

const wasmRecursiveValue = benchWasmRepeated("recursive-value", recursiveValueIterations, () => {
  let acc = 0;
  for (let i = 0; i < recursiveValueIterations; i++) {
    acc += Number(runtime.call("Vir.Fixtures.RecursiveTypes.jsonRootScore", recursiveJsonInput));
  }
  return acc;
});

const wasmStringRoundtrip = benchWasmRepeated("string-roundtrip", stringRoundtripIterations, () => {
  let acc = 0;
  for (let i = 0; i < stringRoundtripIterations; i++) {
    acc += runtime.call("Vir.Fixtures.InterfaceShapes.stringRoundtrip", stringRoundtripInput).length;
  }
  return acc;
});

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

const wasmReactTextRender = benchWasmRepeated("react-html-text-render", reactTextRenderIterations, () => {
  return Number(hostRuntime.call(
    "ReactCounter.renderWideTextLoop",
    "#bench-react",
    reactTextRenderWidth,
    reactTextRenderIterations,
  ));
});

const wasmReactCallbackRender = benchWasmRepeated("react-html-callback-render", reactCallbackRenderIterations, () => {
  return Number(hostRuntime.call(
    "ReactCounter.renderCallbackTreeLoop",
    "#bench-react",
    reactCallbackRenderWidth,
    reactCallbackRenderIterations,
  ));
});

console.log("# Lean VIR benchmark");
console.log("Host baseline is `lean --run` with `interpreter.prefer_native=false`.");
console.log("WASM timings use the manifest-driven JavaScript runtime API.");
console.log("Host timings exclude Lean frontend startup.");
console.log();
console.log("Pure runtime controls");
console.log();
printDispatchRow(`top-level dispatch branchAndSub x ${dispatchIterations}`, dispatch.named, dispatch.resolved);
console.log();
printRow(`fib(${fibInput}) x ${fibIterations}`, wasmFib, hostFib);
console.log();
printRow(`sort/checksum ${sortInput.length} items x ${sortIterations}`, wasmSort, hostSort);
console.log();
console.log("Top-level value conversion paths");
console.log();
printJsRow(`JS codec scalar record/enums encode x ${codecScalarRecordIterations}`, jsCodecScalarRecord);
console.log();
printJsRow(`JS codec nested record/list/option encode x ${codecNestedRecordIterations}`, jsCodecNestedRecord);
console.log();
printJsRow(`JS codec recursive custom-inductive encode x ${codecRecursiveValueIterations}`, jsCodecRecursiveValue);
console.log();
printWasmRow(`scalar record/enums x ${scalarRecordIterations}`, wasmScalarRecord);
console.log();
printWasmRow(`nested record/list/option x ${nestedRecordIterations}`, wasmNestedRecord);
console.log();
printWasmRow(`recursive custom-inductive value x ${recursiveValueIterations}`, wasmRecursiveValue);
console.log();
printWasmRow(`string roundtrip x ${stringRoundtripIterations}`, wasmStringRoundtrip);
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
console.log();
console.log("React Html resource paths");
console.log();
printWasmRow(
  `React text tree render ${reactTextRenderWidth} children x ${reactTextRenderIterations}`,
  wasmReactTextRender,
);
console.log();
printWasmRow(
  `React callback tree render ${reactCallbackRenderWidth} handlers x ${reactCallbackRenderIterations}`,
  wasmReactCallbackRender,
);

if (args.jsonPath !== null) {
  await writeJsonReport(args.jsonPath, [
    benchmarkDispatchReportRow(
      "top-level-dispatch",
      `top-level dispatch branchAndSub x ${dispatchIterations}`,
      dispatch.named,
      dispatch.resolved,
    ),
    benchmarkReportRow("fib", `fib(${fibInput}) x ${fibIterations}`, wasmFib, hostFib),
    benchmarkReportRow("sort", `sort/checksum ${sortInput.length} items x ${sortIterations}`, wasmSort, hostSort),
    benchmarkJsReportRow(
      "codec-scalar-record",
      `JS codec scalar record/enums encode x ${codecScalarRecordIterations}`,
      jsCodecScalarRecord,
    ),
    benchmarkJsReportRow(
      "codec-nested-record",
      `JS codec nested record/list/option encode x ${codecNestedRecordIterations}`,
      jsCodecNestedRecord,
    ),
    benchmarkJsReportRow(
      "codec-recursive-value",
      `JS codec recursive custom-inductive encode x ${codecRecursiveValueIterations}`,
      jsCodecRecursiveValue,
    ),
    benchmarkReportRow(
      "scalar-record",
      `scalar record/enums x ${scalarRecordIterations}`,
      wasmScalarRecord,
    ),
    benchmarkReportRow(
      "nested-record",
      `nested record/list/option x ${nestedRecordIterations}`,
      wasmNestedRecord,
    ),
    benchmarkReportRow(
      "recursive-value",
      `recursive custom-inductive value x ${recursiveValueIterations}`,
      wasmRecursiveValue,
    ),
    benchmarkReportRow(
      "string-roundtrip",
      `string roundtrip x ${stringRoundtripIterations}`,
      wasmStringRoundtrip,
    ),
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
    benchmarkReportRow(
      "react-html-text-render",
      `React text tree render ${reactTextRenderWidth} children x ${reactTextRenderIterations}`,
      wasmReactTextRender,
    ),
    benchmarkReportRow(
      "react-html-callback-render",
      `React callback tree render ${reactCallbackRenderWidth} handlers x ${reactCallbackRenderIterations}`,
      wasmReactCallbackRender,
    ),
  ]);
}

runtime.dispose();
hostRuntime.dispose();
