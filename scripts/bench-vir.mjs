/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { performance } from "node:perf_hooks";

import { prepareBenchArtifacts } from "./bench-artifact-cache.mjs";
import { sampleBenchmarkCandidates } from "./bench-differential.mjs";
import {
  benchmarkArtifactPaths,
  defaultPackageFile,
  hostPackageFile,
  prettyPackageFile,
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
  validateBenchmarkBuildOptions,
} from "./bench-utils.mjs";
import { createVirRuntime as createBrowserVirRuntime } from "../web/src/vir-runtime.js";
import {
  createVirRuntime as createNodeVirRuntime,
  createVirtualDocumentState,
  ensureVirtualElementState,
} from "../web/src/vir-runtime-node.js";
import { runSync } from "./process-utils.mjs";
import {
  balancedStdFormatAppend,
  stdFormat,
  taggedStdFormatChunks,
} from "./std-format-values.mjs";

const root = new URL("..", import.meta.url);

const fibInput = 17;
const fibIterations = 80;
const dispatchIterations = 20000;
const sortInput = [7, 3, 9, 1, 4, 1, 5, 2, 8, 6, 0, 10, 12, 11, 13, 14];
const sortIterations = 2000;
const hostScalarIterations = 250;
const callbackIterations = 1000;
const domResourceIterations = 300;
const reactRootIterations = 500;
const scalarRecordIterations = 5000;
const nestedRecordIterations = 3000;
const recursiveValueIterations = 2000;
const baseScalarIterations = 10000;
const baseBlobIterations = 3000;
const baseArrayIterations = 3000;
const baseLowerIterations = 20000;
const lowerScalarRecordIterations = 20000;
const lowerNestedRecordIterations = 20000;
const lowerRecursiveValueIterations = 20000;
const formatTagIterations = 4;
const formatTagLowerIterations = 8;
const formatEmptyIterations = 12;
const formatEmptyLowerIterations = 20;
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
const baseStringInput = "Lean IR boundary Aé∀Z ".repeat(8);
const baseByteArrayInput = Uint8Array.from(Array.from({ length: 128 }, (_, index) => (index * 17) & 0xff));
const baseArrayNatInput = Array.from({ length: 64 }, (_, index) => index + 1);
const baseArrayStringInput = Array.from({ length: 32 }, (_, index) => `s${index}`);
const formatTagInput = taggedStdFormatChunks(64, 64);
const formatEmptyInput = balancedStdFormatAppend(
  Array.from({ length: 1024 }, () => stdFormat.nil()),
);
const args = parseArgs(process.argv.slice(2));

function parseArgs(argv) {
  const parsed = {
    ...benchmarkCacheOptionDefaults(),
    buildArtifacts: true,
    jsonPath: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--no-build") {
      parsed.buildArtifacts = false;
    } else if (arg === "--json") {
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
  validateBenchmarkBuildOptions(parsed);
  return parsed;
}

function printUsage() {
  console.log([
    "usage: npm run bench -- [options]",
    "",
    "options:",
    "  --json PATH                    write a machine-readable benchmark report",
    "  --no-build                     require and reuse existing generated benchmark inputs",
    "  --artifact-cache DIR           cache built benchmark inputs in DIR",
    "  --no-artifact-cache            rebuild inputs without cache restore/store",
    "  --refresh-artifact-cache       rebuild and replace the current cache entry",
  ].join("\n"));
}

async function instantiateRuntimes() {
  const [wasm, irPackage, hostPackage, prettyPackage] = await Promise.all([
    readPublicArtifact(wasmPublicFile),
    readPublicArtifact(defaultPackageFile),
    readPublicArtifact(hostPackageFile),
    readPublicArtifact(prettyPackageFile),
  ]);
  const virtualDocumentState = createVirtualDocumentState();
  ensureVirtualElementState(virtualDocumentState, "#bench-dom");
  ensureVirtualElementState(virtualDocumentState, "#bench-react");
  const runtime = await createBrowserVirRuntime({ wasmBytes: wasm, irPackageSetBytes: [irPackage] });
  const prettyRuntime = await createBrowserVirRuntime({
    wasmBytes: wasm,
    irPackageSetBytes: [prettyPackage],
  });
  const hostRuntime = await createNodeVirRuntime({
    wasmBytes: wasm,
    irPackageSetBytes: [hostPackage],
    virtualDocumentState,
    hostBindings: createBenchmarkHostBindings(),
  });
  return { runtime, hostRuntime, prettyRuntime };
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

function benchRepeated(label, iterations, fn) {
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

function printDispatchRow(name, resolveEachCall, cachedSlot) {
  const resolveEachPerCall = resolveEachCall.medianMs / resolveEachCall.iterations;
  const cachedPerCall = cachedSlot.medianMs / cachedSlot.iterations;
  const deltaPct = ((cachedPerCall - resolveEachPerCall) / resolveEachPerCall) * 100;
  const sign = deltaPct >= 0 ? "+" : "";
  const speed = resolveEachPerCall / cachedPerCall;
  console.log(`${name}`);
  console.log(`  resolve+call: ${formatMs(resolveEachCall.medianMs)} total, ${formatMs(resolveEachPerCall)} / call`);
  console.log(
    `  cached slot:  ${formatMs(cachedSlot.medianMs)} total, ${formatMs(cachedPerCall)} / call ` +
      `(${sign}${deltaPct.toFixed(1)}%, ${speed.toFixed(2)}x speed)`,
  );
  console.log(`  checksums:    resolve+call=${resolveEachCall.checksum} cached=${cachedSlot.checksum}`);
}

function printJsRow(name, sample) {
  const perCall = sample.medianMs / sample.iterations;
  console.log(`${name}`);
  console.log(`  js lower:  ${formatMs(sample.medianMs)} total, ${formatMs(perCall)} / call`);
  console.log(`  checksum:  ${sample.checksum}`);
}

function printConversionRow(name, lower, wasm) {
  const lowerPerCall = lower.medianMs / lower.iterations;
  const wasmPerCall = wasm.medianMs / wasm.iterations;
  console.log(`${name}`);
  console.log(`  js lower:  ${formatMs(lower.medianMs)} total, ${formatMs(lowerPerCall)} / call`);
  console.log(`  wasm call:  ${formatMs(wasm.medianMs)} total, ${formatMs(wasmPerCall)} / call`);
  console.log(`  checksums: lower=${lower.checksum} wasm=${wasm.checksum}`);
}

function benchmarkDispatchReportRow(name, title, resolveEachCall, cachedSlot) {
  return {
    name,
    title,
    resolveEachCall: benchmarkSampleReport(resolveEachCall),
    cachedSlot: benchmarkSampleReport(cachedSlot),
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

function benchmarkConversionReportRow(name, title, lower, wasm, benchmarkClass = null) {
  return {
    name,
    title,
    ...(benchmarkClass === null ? {} : { class: benchmarkClass }),
    lower: benchmarkSampleReport(lower),
    wasm: benchmarkSampleReport(wasm),
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

const artifactCache = await prepareBenchArtifacts({
  root,
  artifactPaths: benchmarkArtifactPaths,
  options: args,
  build: () => runSync("npm", ["run", "--silent", "build:demo"], { cwd: root }),
});
const { runtime, hostRuntime, prettyRuntime } = await instantiateRuntimes();

function manifestEntry(benchmarkRuntime, name) {
  const entry = benchmarkRuntime.findManifestEntry(name);
  if (entry === null) {
    throw new Error(`benchmark interface entry not found: ${name}`);
  }
  return entry;
}

function benchLowerCallObjects(benchmarkRuntime, label, iterations, entry, args) {
  return benchRepeated(label, iterations, () => {
    let acc = 0;
    for (let i = 0; i < iterations; i++) {
      const objects = [];
      try {
        entry.args.forEach((arg, index) => {
          const obj = benchmarkRuntime.makeObjectValue(
            arg.type,
            args[index],
            `${entry.entry} argument ${arg.name}`,
          );
          objects.push(obj);
          acc += obj === 0 ? 0 : 1;
        });
      } finally {
        benchmarkRuntime.releaseOwnedObjects(objects);
      }
    }
    return acc;
  });
}

function benchBoundaryConversionCase(benchmarkRuntime, testCase) {
  const entry = manifestEntry(benchmarkRuntime, testCase.entry);
  const lower = benchLowerCallObjects(
    benchmarkRuntime,
    `lower-${testCase.name}`,
    testCase.lowerIterations ?? baseLowerIterations,
    entry,
    testCase.args,
  );
  const wasm = benchRepeated(testCase.name, testCase.iterations, () => {
    let acc = 0;
    for (let i = 0; i < testCase.iterations; i++) {
      acc += testCase.checksum(benchmarkRuntime.call(testCase.entry, ...testCase.args));
    }
    return acc;
  });
  return { ...testCase, lower, wasm };
}

function checksumNumber(value) {
  return Number(value);
}

function checksumBool(value) {
  return value === true ? 1 : 0;
}

function checksumString(value) {
  if (typeof value !== "string") {
    throw new Error(`expected benchmark string result, got ${typeof value}`);
  }
  return value.length;
}

function checksumExactString(expected) {
  return (value) => {
    if (value !== expected) {
      throw new Error(`expected benchmark output ${JSON.stringify(expected)}, got ${JSON.stringify(value)}`);
    }
    return value.length;
  };
}

function checksumByteArray(value) {
  if (!(value instanceof Uint8Array)) {
    throw new Error("expected benchmark ByteArray result to decode as Uint8Array");
  }
  return value.length + (value[0] ?? 0) + (value[value.length - 1] ?? 0);
}

function resolveRawCallSlot(entry, exportIndex) {
  const callSlot = runtime.exports.vir_resolve_call_export(exportIndex) >>> 0;
  if (callSlot === 0) {
    throw new Error(runtime.lastCallError() || `call entry not found: ${entry.entry}`);
  }
  return callSlot;
}

function callRawResolvedObjects(entry, callSlot) {
  const resultObj = runtime.exports.vir_call_resolved_objects(callSlot, 0, 0);
  if (resultObj === 0) {
    throw new Error(runtime.lastCallError() || `resolved call failed: ${entry.entry}`);
  }
  try {
    return runtime.liftOwnedObjectValue(entry.result, resultObj, `${entry.entry} result`);
  } finally {
    runtime.exports.vir_obj_dec(resultObj);
  }
}

function benchTopLevelDispatch(entry) {
  const exportIndex = runtime.interfaceManifest.exports.indexOf(entry);
  if (exportIndex < 0) {
    throw new Error(`benchmark interface entry is not part of the active manifest: ${entry.entry}`);
  }
  const callSlot = resolveRawCallSlot(entry, exportIndex);
  const sampled = sampleBenchmarkCandidates({
    candidates: [
      {
        id: "resolveEachCall",
        label: "resolve-each-call",
        run: () => {
          let acc = 0;
          for (let i = 0; i < dispatchIterations; i++) {
            const resolvedSlot = resolveRawCallSlot(entry, exportIndex);
            acc += Number(callRawResolvedObjects(entry, resolvedSlot));
          }
          return acc;
        },
      },
      {
        id: "cachedSlot",
        label: "cached-slot",
        run: () => {
          let acc = 0;
          for (let i = 0; i < dispatchIterations; i++) {
            acc += Number(callRawResolvedObjects(entry, callSlot));
          }
          return acc;
        },
      },
    ],
    warmupRounds: 1,
    sampleRounds: 7,
  });
  if (!sampled.passed) {
    const details = Object.values(sampled.candidates).map((candidate) =>
      `${candidate.id}: checksum=${candidate.checksum}, stable=${candidate.stable}` +
        (candidate.errors.length === 0 ? "" : `, errors=${candidate.errors.join("; ")}`),
    );
    throw new Error(`top-level dispatch differential checks failed (${details.join("; ")})`);
  }
  return Object.fromEntries(Object.entries(sampled.candidates).map(([id, candidate]) => [id, {
    label: candidate.label,
    iterations: dispatchIterations,
    checksum: candidate.checksum,
    medianMs: candidate.medianMs,
  }]));
}

const dispatchEntry = manifestEntry(runtime, "Vir.Fixtures.Basic.branchAndSub");
const scalarRecordEntry = manifestEntry(runtime, "Vir.Fixtures.InterfaceShapes.profileStatsScore");
const nestedRecordEntry = manifestEntry(runtime, "Vir.Fixtures.InterfaceShapes.profileEnvelopeScore");
const recursiveValueEntry = manifestEntry(runtime, "Vir.Fixtures.RecursiveTypes.jsonRootScore");
const baseConversionCases = [
  {
    name: "base-unit",
    title: `Unit -> Unit x ${baseScalarIterations}`,
    entry: "Vir.Fixtures.InterfaceShapes.baseUnitRoundtrip",
    args: [undefined],
    iterations: baseScalarIterations,
    checksum: (value) => value === undefined ? 1 : 0,
  },
  {
    name: "base-bool",
    title: `Bool -> Bool x ${baseScalarIterations}`,
    entry: "Vir.Fixtures.InterfaceShapes.baseBoolFlip",
    args: [true],
    iterations: baseScalarIterations,
    checksum: checksumBool,
  },
  {
    name: "base-nat",
    title: `Nat -> Nat x ${baseScalarIterations}`,
    entry: "Vir.Fixtures.InterfaceShapes.baseNatBump",
    args: [41],
    iterations: baseScalarIterations,
    checksum: checksumNumber,
  },
  {
    name: "base-int",
    title: `Int -> Int x ${baseScalarIterations}`,
    entry: "Vir.Fixtures.InterfaceShapes.baseIntNegate",
    args: [-41],
    iterations: baseScalarIterations,
    checksum: checksumNumber,
  },
  {
    name: "base-string",
    title: `String -> String (${baseStringInput.length} code units) x ${baseBlobIterations}`,
    entry: "Vir.Fixtures.InterfaceShapes.baseStringRoundtrip",
    args: [baseStringInput],
    iterations: baseBlobIterations,
    checksum: checksumString,
  },
  {
    name: "base-uint8",
    title: `UInt8 -> UInt8 x ${baseScalarIterations}`,
    entry: "Vir.Fixtures.InterfaceShapes.baseUInt8Bump",
    args: [41],
    iterations: baseScalarIterations,
    checksum: checksumNumber,
  },
  {
    name: "base-uint16",
    title: `UInt16 -> UInt16 x ${baseScalarIterations}`,
    entry: "Vir.Fixtures.InterfaceShapes.baseUInt16Bump",
    args: [41],
    iterations: baseScalarIterations,
    checksum: checksumNumber,
  },
  {
    name: "base-uint32",
    title: `UInt32 -> UInt32 x ${baseScalarIterations}`,
    entry: "Vir.Fixtures.InterfaceShapes.uint32Bump",
    args: [41],
    iterations: baseScalarIterations,
    checksum: checksumNumber,
  },
  {
    name: "base-uint64",
    title: `UInt64 -> UInt64 x ${baseScalarIterations}`,
    entry: "Vir.Fixtures.InterfaceShapes.uint64Bump",
    args: ["41"],
    iterations: baseScalarIterations,
    checksum: checksumNumber,
  },
  {
    name: "base-usize",
    title: `USize -> USize x ${baseScalarIterations}`,
    entry: "Vir.Fixtures.InterfaceShapes.baseUSizeBump",
    args: ["41"],
    iterations: baseScalarIterations,
    checksum: checksumNumber,
  },
  {
    name: "base-float",
    title: `Float -> Float x ${baseScalarIterations}`,
    entry: "Vir.Fixtures.InterfaceShapes.floatScale",
    args: [1.5],
    iterations: baseScalarIterations,
    checksum: checksumNumber,
  },
  {
    name: "base-float32",
    title: `Float32 -> Float32 x ${baseScalarIterations}`,
    entry: "Vir.Fixtures.InterfaceShapes.float32Roundtrip",
    args: [1.25],
    iterations: baseScalarIterations,
    checksum: checksumNumber,
  },
  {
    name: "base-byte-array",
    title: `ByteArray -> ByteArray (${baseByteArrayInput.length} bytes) x ${baseBlobIterations}`,
    entry: "Vir.Fixtures.InterfaceShapes.baseByteArrayRoundtrip",
    args: [baseByteArrayInput],
    iterations: baseBlobIterations,
    checksum: checksumByteArray,
  },
  {
    name: "base-array-nat",
    title: `Array Nat -> Nat (${baseArrayNatInput.length} items) x ${baseArrayIterations}`,
    entry: "Vir.Fixtures.InterfaceShapes.baseArrayNatSum",
    args: [baseArrayNatInput],
    iterations: baseArrayIterations,
    checksum: checksumNumber,
  },
  {
    name: "base-array-string",
    title: `Array String -> Nat (${baseArrayStringInput.length} items) x ${baseArrayIterations}`,
    entry: "Vir.Fixtures.InterfaceShapes.arrayStringTotalLength",
    args: [baseArrayStringInput],
    iterations: baseArrayIterations,
    checksum: checksumNumber,
  },
];

const formatConversionCases = [
  {
    name: "format-tag-transitions",
    title: `Std.Format tag transitions (64 x 64, 4,223 nodes) x ${formatTagIterations}`,
    class: "representative",
    entry: "Vir.Fixtures.FormatPretty.formatBoundaryPretty",
    args: [formatTagInput, 80],
    iterations: formatTagIterations,
    lowerIterations: formatTagLowerIterations,
    checksum: checksumExactString("x".repeat(64)),
  },
  {
    name: "format-empty-nodes",
    title: `Std.Format empty append tree (2,047 nodes) x ${formatEmptyIterations}`,
    class: "focused",
    entry: "Vir.Fixtures.FormatPretty.formatBoundaryPretty",
    args: [formatEmptyInput, 80],
    iterations: formatEmptyIterations,
    lowerIterations: formatEmptyLowerIterations,
    checksum: checksumExactString(""),
  },
];

const dispatch = benchTopLevelDispatch(dispatchEntry);
const baseConversionBenchmarks = baseConversionCases.map((testCase) =>
  benchBoundaryConversionCase(runtime, testCase));
const formatConversionBenchmarks = formatConversionCases.map((testCase) =>
  benchBoundaryConversionCase(prettyRuntime, testCase));

const wasmFib = benchRepeated("fib", fibIterations, () => {
  let acc = 0;
  for (let i = 0; i < fibIterations; i++) {
    acc += Number(runtime.call("fib", fibInput));
  }
  return acc;
});
const hostFib = benchHostIr("fib", fibIterations, ["fib", String(fibIterations), String(fibInput)]);

const wasmSort = benchRepeated("sort", sortIterations, () => {
  let acc = 0;
  for (let i = 0; i < sortIterations; i++) {
    acc += Number(runtime.call("SortDemo.demoFromArray", sortInput));
  }
  return acc;
});
const hostSort = benchHostIr("sort", sortIterations, ["sort", String(sortIterations), sortInput.join(",")]);

const jsLowerScalarRecord = benchLowerCallObjects(
  runtime,
  "lower-scalar-record",
  lowerScalarRecordIterations,
  scalarRecordEntry,
  [profileStatsInput],
);

const jsLowerNestedRecord = benchLowerCallObjects(
  runtime,
  "lower-nested-record",
  lowerNestedRecordIterations,
  nestedRecordEntry,
  [profileEnvelopeInput],
);

const jsLowerRecursiveValue = benchLowerCallObjects(
  runtime,
  "lower-recursive-value",
  lowerRecursiveValueIterations,
  recursiveValueEntry,
  [recursiveJsonInput],
);

const wasmScalarRecord = benchRepeated("scalar-record", scalarRecordIterations, () => {
  let acc = 0;
  for (let i = 0; i < scalarRecordIterations; i++) {
    acc += Number(runtime.call("Vir.Fixtures.InterfaceShapes.profileStatsScore", profileStatsInput));
  }
  return acc;
});

const wasmNestedRecord = benchRepeated("nested-record", nestedRecordIterations, () => {
  let acc = 0;
  for (let i = 0; i < nestedRecordIterations; i++) {
    acc += Number(runtime.call("Vir.Fixtures.InterfaceShapes.profileEnvelopeScore", profileEnvelopeInput));
  }
  return acc;
});

const wasmRecursiveValue = benchRepeated("recursive-value", recursiveValueIterations, () => {
  let acc = 0;
  for (let i = 0; i < recursiveValueIterations; i++) {
    acc += Number(runtime.call("Vir.Fixtures.RecursiveTypes.jsonRootScore", recursiveJsonInput));
  }
  return acc;
});

const wasmHostScalar = benchRepeated("host-title", hostScalarIterations, () => {
  let acc = 0;
  for (let i = 0; i < hostScalarIterations; i++) {
    acc += hostRuntime.call("HostInterop.titleHandshake", "bench").length;
  }
  return acc;
});

const wasmCallback = benchRepeated("callback-roundtrip", callbackIterations, () => {
  return Number(hostRuntime.call("HostInterop.callbackRoundTripLoop", callbackIterations));
});

const wasmDomResource = benchRepeated("dom-listener-resource", domResourceIterations, () => {
  let acc = 0;
  for (let i = 0; i < domResourceIterations; i++) {
    acc += Number(hostRuntime.call("HostInterop.mountAndRemoveCallbackEvent", "#bench-dom"));
  }
  return acc;
});

const wasmReactRoot = benchRepeated("react-root-lifecycle", reactRootIterations, () => {
  return Number(hostRuntime.call("ReactCounter.mountAndUnmountLoop", "#bench-react", reactRootIterations));
});

const wasmReactTextRender = benchRepeated("react-node-text-render", reactTextRenderIterations, () => {
  return Number(hostRuntime.call(
    "ReactCounter.renderWideTextLoop",
    "#bench-react",
    reactTextRenderWidth,
    reactTextRenderIterations,
  ));
});

const wasmReactCallbackRender = benchRepeated("react-node-callback-render", reactCallbackRenderIterations, () => {
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
printDispatchRow(`top-level dispatch branchAndSub x ${dispatchIterations}`, dispatch.resolveEachCall, dispatch.cachedSlot);
console.log();
printRow(`fib(${fibInput}) x ${fibIterations}`, wasmFib, hostFib);
console.log();
printRow(`sort/checksum ${sortInput.length} items x ${sortIterations}`, wasmSort, hostSort);
console.log();
console.log("Top-level value conversion paths");
console.log();
console.log("Base value conversion paths");
console.log();
for (const testCase of baseConversionBenchmarks) {
  printConversionRow(testCase.title, testCase.lower, testCase.wasm);
  console.log();
}
console.log("Std.Format conversion paths");
console.log();
for (const testCase of formatConversionBenchmarks) {
  printConversionRow(testCase.title, testCase.lower, testCase.wasm);
  console.log();
}
printJsRow(`JS object scalar record/enums lower x ${lowerScalarRecordIterations}`, jsLowerScalarRecord);
console.log();
printJsRow(`JS object nested record/list/option lower x ${lowerNestedRecordIterations}`, jsLowerNestedRecord);
console.log();
printJsRow(`JS object recursive custom-inductive lower x ${lowerRecursiveValueIterations}`, jsLowerRecursiveValue);
console.log();
printWasmRow(`scalar record/enums x ${scalarRecordIterations}`, wasmScalarRecord);
console.log();
printWasmRow(`nested record/list/option x ${nestedRecordIterations}`, wasmNestedRecord);
console.log();
printWasmRow(`recursive custom-inductive value x ${recursiveValueIterations}`, wasmRecursiveValue);
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
console.log("React Node resource paths");
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
      dispatch.resolveEachCall,
      dispatch.cachedSlot,
    ),
    benchmarkReportRow("fib", `fib(${fibInput}) x ${fibIterations}`, wasmFib, hostFib),
    benchmarkReportRow("sort", `sort/checksum ${sortInput.length} items x ${sortIterations}`, wasmSort, hostSort),
    ...baseConversionBenchmarks.map((testCase) =>
      benchmarkConversionReportRow(testCase.name, testCase.title, testCase.lower, testCase.wasm)),
    ...formatConversionBenchmarks.map((testCase) =>
      benchmarkConversionReportRow(
        testCase.name,
        testCase.title,
        testCase.lower,
        testCase.wasm,
        testCase.class,
      )),
    benchmarkJsReportRow(
      "lower-scalar-record",
      `JS object scalar record/enums lower x ${lowerScalarRecordIterations}`,
      jsLowerScalarRecord,
    ),
    benchmarkJsReportRow(
      "lower-nested-record",
      `JS object nested record/list/option lower x ${lowerNestedRecordIterations}`,
      jsLowerNestedRecord,
    ),
    benchmarkJsReportRow(
      "lower-recursive-value",
      `JS object recursive custom-inductive lower x ${lowerRecursiveValueIterations}`,
      jsLowerRecursiveValue,
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
      "react-node-text-render",
      `React text tree render ${reactTextRenderWidth} children x ${reactTextRenderIterations}`,
      wasmReactTextRender,
    ),
    benchmarkReportRow(
      "react-node-callback-render",
      `React callback tree render ${reactCallbackRenderWidth} handlers x ${reactCallbackRenderIterations}`,
      wasmReactCallbackRender,
    ),
  ]);
}

runtime.dispose();
hostRuntime.dispose();
prettyRuntime.dispose();
