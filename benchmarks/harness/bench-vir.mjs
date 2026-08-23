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
} from "../../scripts/packages/browser-package-config.mjs";
import {
  benchmarkCacheOptionDefaults,
  formatMs,
  median,
  parseBenchmarkCacheOption,
  requireBenchmarkSample,
  requireOptionValue,
  sha256,
  validateBenchmarkBuildOptions,
} from "./bench-utils.mjs";
import { createVirRuntime as createBrowserVirRuntime } from "../../web/src/vir-runtime.js";
import {
  createVirRuntime as createNodeVirRuntime,
  createVirtualDocumentState,
  ensureVirtualElementState,
} from "../../web/src/vir-runtime-node.js";
import { runSync } from "../../scripts/process-utils.mjs";
import { repositoryRootUrl } from "../../scripts/repository-paths.mjs";
import {
  balancedStdFormatAppend,
  stdFormat,
  taggedStdFormatChunks,
} from "../../fixtures/js/std-format-values.mjs";

const root = repositoryRootUrl;

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
    filters: [],
    jsonPath: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--filter") {
      parsed.filters.push(requireOptionValue(argv, ++index, "--filter"));
    } else if (arg.startsWith("--filter=")) {
      parsed.filters.push(arg.slice("--filter=".length));
    } else if (arg === "--no-build") {
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
  if (parsed.filters.some((filter) => filter === "")) {
    throw new Error("--filter requires nonempty text");
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
    "  --filter TEXT                  run benchmark names containing TEXT (repeatable)",
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
  return {
    runtime,
    hostRuntime,
    prettyRuntime,
    artifacts: [
      { path: publicArtifactPath(wasmPublicFile), sha256: sha256(wasm) },
      { path: publicArtifactPath(defaultPackageFile), sha256: sha256(irPackage) },
      { path: publicArtifactPath(hostPackageFile), sha256: sha256(hostPackage) },
      { path: publicArtifactPath(prettyPackageFile), sha256: sha256(prettyPackage) },
    ],
  };
}

function readPublicArtifact(file) {
  return readFile(new URL(`../../${publicArtifactPath(file)}`, import.meta.url));
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
  const environment = {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
  };
  const report = {
    schema: "lean-vir.bench.v1",
    generatedAt: new Date().toISOString(),
    command: "npm run bench",
    git: gitMetadata(),
    comparisonIdentity: {
      workload: "vir-general-benchmark-v1",
      benchmarks: benchmarks.map(({ name, title, class: benchmarkClass = null }) => ({
        name,
        title,
        class: benchmarkClass,
      })),
      ...environment,
      artifacts: artifactIdentities,
    },
    environment,
    artifactCache,
    selection: {
      filters: args.filters,
      benchmarkNames: benchmarks.map((benchmark) => benchmark.name),
    },
    benchmarks,
  };
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`);
  console.log();
  console.log(`wrote benchmark report: ${path}`);
}

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

const artifactCache = await prepareBenchArtifacts({
  root,
  artifactPaths: benchmarkArtifactPaths,
  options: args,
  build: () => runSync("npm", ["run", "--silent", "build:demo"], { cwd: root }),
});
const { runtime, hostRuntime, prettyRuntime, artifacts: artifactIdentities } = await instantiateRuntimes();
const benchmarkReports = [];
const outputSections = new Map();

function benchmarkSelected(name) {
  return args.filters.length === 0 || args.filters.some((filter) => name.includes(filter));
}

function addBenchmark({ section, name, measure, report, print }) {
  if (!benchmarkSelected(name)) return;
  const measurement = measure();
  benchmarkReports.push(report(measurement));
  const outputs = outputSections.get(section) ?? [];
  outputs.push(() => print(measurement));
  outputSections.set(section, outputs);
}

function addWasmBenchmark(section, name, title, measure) {
  addBenchmark({
    section,
    name,
    measure,
    report: (sample) => benchmarkReportRow(name, title, sample),
    print: (sample) => printWasmRow(title, sample),
  });
}

function addJsBenchmark(section, name, title, measure) {
  addBenchmark({
    section,
    name,
    measure,
    report: (sample) => benchmarkJsReportRow(name, title, sample),
    print: (sample) => printJsRow(title, sample),
  });
}

function addConversionBenchmark(section, benchmarkRuntime, testCase) {
  addBenchmark({
    section,
    name: testCase.name,
    measure: () => benchBoundaryConversionCase(benchmarkRuntime, testCase),
    report: (measurement) => benchmarkConversionReportRow(
      testCase.name,
      testCase.title,
      measurement.lower,
      measurement.wasm,
      testCase.class ?? null,
    ),
    print: (measurement) => printConversionRow(testCase.title, measurement.lower, measurement.wasm),
  });
}

addBenchmark({
  section: "Pure runtime controls",
  name: "top-level-dispatch",
  measure: () => benchTopLevelDispatch(manifestEntry(runtime, "Vir.Fixtures.Basic.branchAndSub")),
  report: (measurement) => benchmarkDispatchReportRow(
    "top-level-dispatch",
    `top-level dispatch branchAndSub x ${dispatchIterations}`,
    measurement.resolveEachCall,
    measurement.cachedSlot,
  ),
  print: (measurement) => printDispatchRow(
    `top-level dispatch branchAndSub x ${dispatchIterations}`,
    measurement.resolveEachCall,
    measurement.cachedSlot,
  ),
});

addBenchmark({
  section: "Pure runtime controls",
  name: "fib",
  measure: () => ({
    wasm: benchRepeated("fib", fibIterations, () => {
      let acc = 0;
      for (let i = 0; i < fibIterations; i++) acc += Number(runtime.call("fib", fibInput));
      return acc;
    }),
    host: benchHostIr("fib", fibIterations, ["fib", String(fibIterations), String(fibInput)]),
  }),
  report: ({ wasm, host }) => benchmarkReportRow("fib", `fib(${fibInput}) x ${fibIterations}`, wasm, host),
  print: ({ wasm, host }) => printRow(`fib(${fibInput}) x ${fibIterations}`, wasm, host),
});

addBenchmark({
  section: "Pure runtime controls",
  name: "sort",
  measure: () => ({
    wasm: benchRepeated("sort", sortIterations, () => {
      let acc = 0;
      for (let i = 0; i < sortIterations; i++) {
        acc += Number(runtime.call("SortDemo.demoFromArray", sortInput));
      }
      return acc;
    }),
    host: benchHostIr("sort", sortIterations, ["sort", String(sortIterations), sortInput.join(",")]),
  }),
  report: ({ wasm, host }) => benchmarkReportRow(
    "sort",
    `sort/checksum ${sortInput.length} items x ${sortIterations}`,
    wasm,
    host,
  ),
  print: ({ wasm, host }) => printRow(
    `sort/checksum ${sortInput.length} items x ${sortIterations}`,
    wasm,
    host,
  ),
});

for (const testCase of baseConversionCases) {
  addConversionBenchmark("Base value conversion paths", runtime, testCase);
}
for (const testCase of formatConversionCases) {
  addConversionBenchmark("Std.Format conversion paths", prettyRuntime, testCase);
}

addJsBenchmark(
  "Object conversion paths",
  "lower-scalar-record",
  `JS object scalar record/enums lower x ${lowerScalarRecordIterations}`,
  () => benchLowerCallObjects(
    runtime,
    "lower-scalar-record",
    lowerScalarRecordIterations,
    manifestEntry(runtime, "Vir.Fixtures.InterfaceShapes.profileStatsScore"),
    [profileStatsInput],
  ),
);
addJsBenchmark(
  "Object conversion paths",
  "lower-nested-record",
  `JS object nested record/list/option lower x ${lowerNestedRecordIterations}`,
  () => benchLowerCallObjects(
    runtime,
    "lower-nested-record",
    lowerNestedRecordIterations,
    manifestEntry(runtime, "Vir.Fixtures.InterfaceShapes.profileEnvelopeScore"),
    [profileEnvelopeInput],
  ),
);
addJsBenchmark(
  "Object conversion paths",
  "lower-recursive-value",
  `JS object recursive custom-inductive lower x ${lowerRecursiveValueIterations}`,
  () => benchLowerCallObjects(
    runtime,
    "lower-recursive-value",
    lowerRecursiveValueIterations,
    manifestEntry(runtime, "Vir.Fixtures.RecursiveTypes.jsonRootScore"),
    [recursiveJsonInput],
  ),
);

addWasmBenchmark(
  "Object conversion paths",
  "scalar-record",
  `scalar record/enums x ${scalarRecordIterations}`,
  () => benchRepeated("scalar-record", scalarRecordIterations, () => {
    let acc = 0;
    for (let i = 0; i < scalarRecordIterations; i++) {
      acc += Number(runtime.call("Vir.Fixtures.InterfaceShapes.profileStatsScore", profileStatsInput));
    }
    return acc;
  }),
);
addWasmBenchmark(
  "Object conversion paths",
  "nested-record",
  `nested record/list/option x ${nestedRecordIterations}`,
  () => benchRepeated("nested-record", nestedRecordIterations, () => {
    let acc = 0;
    for (let i = 0; i < nestedRecordIterations; i++) {
      acc += Number(runtime.call("Vir.Fixtures.InterfaceShapes.profileEnvelopeScore", profileEnvelopeInput));
    }
    return acc;
  }),
);
addWasmBenchmark(
  "Object conversion paths",
  "recursive-value",
  `recursive custom-inductive value x ${recursiveValueIterations}`,
  () => benchRepeated("recursive-value", recursiveValueIterations, () => {
    let acc = 0;
    for (let i = 0; i < recursiveValueIterations; i++) {
      acc += Number(runtime.call("Vir.Fixtures.RecursiveTypes.jsonRootScore", recursiveJsonInput));
    }
    return acc;
  }),
);

addWasmBenchmark(
  "Host/resource paths",
  "host-title",
  `host scalar title handshake x ${hostScalarIterations}`,
  () => benchRepeated("host-title", hostScalarIterations, () => {
    let acc = 0;
    for (let i = 0; i < hostScalarIterations; i++) {
      acc += hostRuntime.call("HostInterop.titleHandshake", "bench").length;
    }
    return acc;
  }),
);
addWasmBenchmark(
  "Host/resource paths",
  "callback-roundtrip",
  `callback root round trip x ${callbackIterations}`,
  () => benchRepeated("callback-roundtrip", callbackIterations, () =>
    Number(hostRuntime.call("HostInterop.callbackRoundTripLoop", callbackIterations))),
);
addWasmBenchmark(
  "Host/resource paths",
  "dom-listener-resource",
  `DOM listener resource create/remove x ${domResourceIterations}`,
  () => benchRepeated("dom-listener-resource", domResourceIterations, () => {
    let acc = 0;
    for (let i = 0; i < domResourceIterations; i++) {
      acc += Number(hostRuntime.call("HostInterop.mountAndRemoveCallbackEvent", "#bench-dom"));
    }
    return acc;
  }),
);
addWasmBenchmark(
  "Host/resource paths",
  "react-root-lifecycle",
  `React root mount/render/unmount x ${reactRootIterations}`,
  () => benchRepeated("react-root-lifecycle", reactRootIterations, () =>
    Number(hostRuntime.call("ReactCounter.mountAndUnmountLoop", "#bench-react", reactRootIterations))),
);
addWasmBenchmark(
  "React Node resource paths",
  "react-node-text-render",
  `React text tree render ${reactTextRenderWidth} children x ${reactTextRenderIterations}`,
  () => benchRepeated("react-node-text-render", reactTextRenderIterations, () => Number(hostRuntime.call(
    "ReactCounter.renderWideTextLoop",
    "#bench-react",
    reactTextRenderWidth,
    reactTextRenderIterations,
  ))),
);
addWasmBenchmark(
  "React Node resource paths",
  "react-node-callback-render",
  `React callback tree render ${reactCallbackRenderWidth} handlers x ${reactCallbackRenderIterations}`,
  () => benchRepeated("react-node-callback-render", reactCallbackRenderIterations, () => Number(hostRuntime.call(
    "ReactCounter.renderCallbackTreeLoop",
    "#bench-react",
    reactCallbackRenderWidth,
    reactCallbackRenderIterations,
  ))),
);

if (benchmarkReports.length === 0) {
  throw new Error(`no benchmark names contain: ${args.filters.join(", ")}`);
}

console.log("# Lean VIR benchmark");
console.log("Host baseline is `lean --run` with `interpreter.prefer_native=false`.");
console.log("WASM timings use the manifest-driven JavaScript runtime API.");
console.log("Host timings exclude Lean frontend startup.");
for (const [section, outputs] of outputSections) {
  console.log();
  console.log(section);
  for (const output of outputs) {
    console.log();
    output();
  }
}

if (args.jsonPath !== null) {
  await writeJsonReport(args.jsonPath, benchmarkReports);
}

runtime.dispose();
hostRuntime.dispose();
prettyRuntime.dispose();
