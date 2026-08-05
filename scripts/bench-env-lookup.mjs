/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import inspector from "node:inspector";
import { cpus } from "node:os";
import { dirname } from "node:path";

import { ensureCachedBenchArtifacts } from "./bench-artifact-cache.mjs";
import { sampleBenchmarkCandidates } from "./bench-differential.mjs";
import {
  environmentLookupHarnessIdentity,
  environmentLookupPackageIdentity,
  sha256,
  validateEnvironmentLookupOutputPaths,
} from "./bench-env-lookup-contract.mjs";
import {
  leanPackageFile,
  publicArtifactPath,
  wasmDevPublicFile,
  wasmPublicFile,
} from "./browser-package-config.mjs";
import {
  benchmarkCacheOptionDefaults,
  benchmarkWasmBuildIdentity,
  formatMs,
  parseBenchmarkCacheOption,
  parsePositiveInt,
  requireOptionValue,
  validateBenchmarkCacheOptions,
} from "./bench-utils.mjs";
import { readIrPackageFile } from "./irpkg-format.mjs";
import { runSync } from "./process-utils.mjs";
import { createVirRuntimeFactory } from "../web/src/vir-runtime.js";

const root = new URL("..", import.meta.url);
const benchmarkEntryName = "Vir.Fixtures.ExprPrinter.exprCoverageScore";
const expectedResult = 1232;
const args = parseArgs(process.argv.slice(2));
const benchmarkWasmFile = args.cpuProfilePath === null ? wasmPublicFile : wasmDevPublicFile;
const wasmBuild = benchmarkWasmBuildIdentity();
const environmentLookupArtifactPaths = [
  publicArtifactPath(benchmarkWasmFile),
  publicArtifactPath(leanPackageFile),
];
const environmentLookupHarnessPaths = [
  "scripts/bench-env-lookup.mjs",
  "scripts/bench-env-lookup-contract.mjs",
  "scripts/bench-differential.mjs",
];

function parseArgs(argv) {
  const parsed = {
    ...benchmarkCacheOptionDefaults(),
    cpuProfilePath: null,
    buildArtifacts: true,
    iterations: 200,
    jsonPath: null,
    loadIterations: 1,
    loadSampleRounds: 7,
    loadWarmupRounds: 1,
    minimumDeclarations: 1000,
    profileIntervalUs: 100,
    sampleRounds: 7,
    warmupRounds: 1,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--cpu-profile") {
      parsed.cpuProfilePath = requireOptionValue(argv, ++index, "--cpu-profile");
    } else if (arg.startsWith("--cpu-profile=")) {
      parsed.cpuProfilePath = arg.slice("--cpu-profile=".length);
    } else if (arg === "--no-build") {
      parsed.buildArtifacts = false;
    } else if (arg === "--iterations") {
      parsed.iterations = parsePositiveInt(requireOptionValue(argv, ++index, "--iterations"), "--iterations");
    } else if (arg.startsWith("--iterations=")) {
      parsed.iterations = parsePositiveInt(arg.slice("--iterations=".length), "--iterations");
    } else if (arg === "--load-iterations") {
      parsed.loadIterations = parsePositiveInt(
        requireOptionValue(argv, ++index, "--load-iterations"),
        "--load-iterations",
      );
    } else if (arg.startsWith("--load-iterations=")) {
      parsed.loadIterations = parsePositiveInt(
        arg.slice("--load-iterations=".length),
        "--load-iterations",
      );
    } else if (arg === "--load-samples") {
      parsed.loadSampleRounds = parsePositiveInt(
        requireOptionValue(argv, ++index, "--load-samples"),
        "--load-samples",
      );
    } else if (arg.startsWith("--load-samples=")) {
      parsed.loadSampleRounds = parsePositiveInt(
        arg.slice("--load-samples=".length),
        "--load-samples",
      );
    } else if (arg === "--load-warmups") {
      parsed.loadWarmupRounds = parseNonnegativeInt(
        requireOptionValue(argv, ++index, "--load-warmups"),
        "--load-warmups",
      );
    } else if (arg.startsWith("--load-warmups=")) {
      parsed.loadWarmupRounds = parseNonnegativeInt(
        arg.slice("--load-warmups=".length),
        "--load-warmups",
      );
    } else if (arg === "--json") {
      parsed.jsonPath = requireOptionValue(argv, ++index, "--json");
    } else if (arg.startsWith("--json=")) {
      parsed.jsonPath = arg.slice("--json=".length);
    } else if (arg === "--minimum-declarations") {
      parsed.minimumDeclarations = parsePositiveInt(
        requireOptionValue(argv, ++index, "--minimum-declarations"),
        "--minimum-declarations",
      );
    } else if (arg.startsWith("--minimum-declarations=")) {
      parsed.minimumDeclarations = parsePositiveInt(
        arg.slice("--minimum-declarations=".length),
        "--minimum-declarations",
      );
    } else if (arg === "--profile-interval-us") {
      parsed.profileIntervalUs = parsePositiveInt(
        requireOptionValue(argv, ++index, "--profile-interval-us"),
        "--profile-interval-us",
      );
    } else if (arg.startsWith("--profile-interval-us=")) {
      parsed.profileIntervalUs = parsePositiveInt(
        arg.slice("--profile-interval-us=".length),
        "--profile-interval-us",
      );
    } else if (arg === "--samples") {
      parsed.sampleRounds = parsePositiveInt(requireOptionValue(argv, ++index, "--samples"), "--samples");
    } else if (arg.startsWith("--samples=")) {
      parsed.sampleRounds = parsePositiveInt(arg.slice("--samples=".length), "--samples");
    } else if (arg === "--warmups") {
      parsed.warmupRounds = parseNonnegativeInt(
        requireOptionValue(argv, ++index, "--warmups"),
        "--warmups",
      );
    } else if (arg.startsWith("--warmups=")) {
      parsed.warmupRounds = parseNonnegativeInt(arg.slice("--warmups=".length), "--warmups");
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else {
      const nextIndex = parseBenchmarkCacheOption(parsed, argv, index);
      if (nextIndex !== null) {
        index = nextIndex;
        continue;
      }
      throw new Error(`unknown environment lookup benchmark argument: ${arg}`);
    }
  }
  if (parsed.jsonPath === "") throw new Error("--json requires a path");
  if (parsed.cpuProfilePath === "") throw new Error("--cpu-profile requires a path");
  if (!parsed.buildArtifacts && (
    !parsed.artifactCacheEnabled || parsed.artifactCachePath !== null || parsed.refreshArtifactCache
  )) {
    throw new Error("--no-build cannot be combined with artifact-cache options");
  }
  validateBenchmarkCacheOptions(parsed);
  return parsed;
}

function parseNonnegativeInt(value, option) {
  const parsed = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(parsed)) {
    throw new Error(`${option} requires a nonnegative integer`);
  }
  return parsed;
}

function printUsage() {
  console.log([
    "usage: npm run bench:env-lookup -- [options]",
    "",
    "options:",
    "  --iterations N                 fresh interpreter entries per timed batch (default: 200)",
    "  --warmups N                    unreported warmup batches (default: 1)",
    "  --samples N                    measured batches (default: 7)",
    "  --load-iterations N            package reloads per startup batch (default: 1)",
    "  --load-warmups N               unreported package reload batches (default: 1)",
    "  --load-samples N               measured package reload batches (default: 7)",
    "  --minimum-declarations N       reject a package smaller than N declarations (default: 1000)",
    "  --json PATH                    write a lean-vir.bench.v1 report without overwriting PATH",
    "  --cpu-profile PATH             write a V8 CPU profile for the execution window",
    "  --profile-interval-us N        requested CPU sampling interval (default: 100)",
    "  --no-build                     require and reuse existing generated benchmark inputs",
    "  --artifact-cache DIR           cache built benchmark inputs in DIR",
    "  --no-artifact-cache            rebuild inputs without cache restore/store",
    "  --refresh-artifact-cache       rebuild and replace the current cache entry",
  ].join("\n"));
}

async function requireAbsent(path, option) {
  if (path === null) return;
  try {
    await access(path);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${option} refuses to overwrite existing path: ${path}`);
}

function sha256Text(value) {
  return sha256(Buffer.from(value));
}

function nullableSha256Text(value) {
  return value.length === 0 ? null : sha256Text(value);
}

function gitMetadata() {
  const status = runSync("git", ["status", "--short", "--untracked-files=all"], {
    cwd: root,
    capture: true,
    trimStdout: false,
  });
  const diff = runSync("git", ["diff", "--binary", "--full-index", "HEAD"], {
    cwd: root,
    capture: true,
    trimStdout: false,
  });
  return {
    commit: runSync("git", ["rev-parse", "HEAD"], { cwd: root, capture: true }),
    ref: runSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: root, capture: true }),
    dirty: status.length !== 0,
    statusSha256: nullableSha256Text(status),
    trackedDiffSha256: nullableSha256Text(diff),
  };
}

function post(session, method, params = {}) {
  return new Promise((resolve, reject) => {
    session.post(method, params, (error, result) => error ? reject(error) : resolve(result));
  });
}

async function startCpuProfile(intervalUs) {
  const session = new inspector.Session();
  session.connect();
  await post(session, "Profiler.enable");
  await post(session, "Profiler.setSamplingInterval", { interval: intervalUs });
  await post(session, "Profiler.start");
  return session;
}

async function stopCpuProfile(session) {
  try {
    const { profile } = await post(session, "Profiler.stop");
    return profile;
  } finally {
    session.disconnect();
  }
}

function summarizeCpuProfile(profile, limit = 20) {
  const namesById = new Map(profile.nodes.map((node) => [
    node.id,
    node.callFrame.functionName || "(anonymous)",
  ]));
  const counts = new Map();
  for (const id of profile.samples ?? []) {
    const name = namesById.get(id) ?? "(unknown)";
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  const totalSamples = profile.samples?.length ?? 0;
  return {
    totalSamples,
    topSelf: [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
      .map(([name, samples]) => ({
        name,
        samples,
        percent: totalSamples === 0 ? 0 : samples / totalSamples * 100,
      })),
  };
}

function displayProfileName(name) {
  if (name.includes("native_symbol_cache_entry") && name.includes("::find")) {
    return "native symbol cache find";
  }
  if (name.includes("symbol_cache_entry") && name.includes("::find")) {
    return "interpreter symbol cache find";
  }
  if (name.includes("constant_cache_entry") && name.includes("::find")) {
    return "interpreter constant cache find";
  }
  if (name.includes("symbol_cache_entry") && name.includes("__emplace_unique")) {
    return "interpreter symbol cache insert";
  }
  return name;
}

function resolveRawCallSlot(runtime, entry) {
  const exportIndex = runtime.interfaceManifest.exports.indexOf(entry);
  if (exportIndex < 0) {
    throw new Error(`benchmark interface entry is not part of the active manifest: ${entry.entry}`);
  }
  const callSlot = runtime.exports.vir_resolve_call_export(exportIndex) >>> 0;
  if (callSlot === 0) {
    throw new Error(runtime.lastCallError() || `call entry not found: ${entry.entry}`);
  }
  return callSlot;
}

function callRawResolvedObjects(runtime, entry, callSlot) {
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

function benchmarkFreshEntries(runtime, entry, callSlot) {
  const sampled = sampleBenchmarkCandidates({
    candidates: [{
      id: "freshInterpreterEntry",
      label: "fresh-interpreter-entry",
      run: () => {
        let checksum = 0;
        for (let index = 0; index < args.iterations; index += 1) {
          const result = Number(callRawResolvedObjects(runtime, entry, callSlot));
          if (result !== expectedResult) {
            throw new Error(`expected ${entry.entry} to return ${expectedResult}, got ${result}`);
          }
          checksum += result;
        }
        return checksum;
      },
    }],
    warmupRounds: args.warmupRounds,
    sampleRounds: args.sampleRounds,
  });
  const sample = sampled.candidates.freshInterpreterEntry;
  if (!sampled.passed) {
    throw new Error(
      `environment lookup benchmark failed: checksum=${sample.checksum}, stable=${sample.stable}, ` +
      `errors=${sample.errors.join("; ")}`,
    );
  }
  return sample;
}

function benchmarkPackageLoad(factory, module, packageBytes, expectedDeclarations) {
  const sampled = sampleBenchmarkCandidates({
    candidates: [{
      id: "packageLoad",
      label: "package-load",
      setup: () => {
        const runtimes = [];
        try {
          for (let index = 0; index < args.loadIterations; index += 1) {
            runtimes.push(factory.instantiateModule(module));
          }
          return runtimes;
        } catch (error) {
          for (const freshRuntime of runtimes) {
            try {
              freshRuntime.dispose();
            } catch {
              // Preserve the setup failure that prevented a comparable sample.
            }
          }
          throw error;
        }
      },
      run: (runtimes) => {
        let checksum = 0;
        for (const freshRuntime of runtimes) {
          const loaded = freshRuntime.installIrPackageSetBytes([packageBytes]);
          if (loaded.count !== expectedDeclarations) {
            throw new Error(
              `expected package load to install ${expectedDeclarations} declarations, got ${loaded.count}`,
            );
          }
          checksum += loaded.count;
        }
        return checksum;
      },
      teardown: (runtimes) => {
        const errors = [];
        for (const freshRuntime of runtimes ?? []) {
          try {
            freshRuntime.dispose();
          } catch (error) {
            errors.push(error);
          }
        }
        if (errors.length !== 0) throw errors[0];
      },
    }],
    warmupRounds: args.loadWarmupRounds,
    sampleRounds: args.loadSampleRounds,
  });
  const sample = sampled.candidates.packageLoad;
  if (!sampled.passed) {
    throw new Error(
      `package load benchmark failed: checksum=${sample.checksum}, stable=${sample.stable}, ` +
      `errors=${sample.errors.join("; ")}`,
    );
  }
  return sample;
}

validateEnvironmentLookupOutputPaths(args);
await requireAbsent(args.jsonPath, "--json");
await requireAbsent(args.cpuProfilePath, "--cpu-profile");

const artifactCache = args.buildArtifacts
  ? await ensureCachedBenchArtifacts({
      root,
      artifactPaths: environmentLookupArtifactPaths,
      options: args,
      build: () => runSync("npm", ["run", "--silent", "build:demo"], { cwd: root }),
    })
  : {
      enabled: false,
      restore: { status: "not-requested" },
      store: { status: "not-requested" },
    };

const wasmPath = new URL(`../${publicArtifactPath(benchmarkWasmFile)}`, import.meta.url);
const packagePath = new URL(`../${publicArtifactPath(leanPackageFile)}`, import.meta.url);
const [wasmBytes, packageBytes, packageInfo, toolchain, harnessSourceBytes, fixtureBytes] = await Promise.all([
  readFile(wasmPath),
  readFile(packagePath),
  readIrPackageFile(packagePath),
  readFile(new URL("../lean-toolchain", import.meta.url), "utf8"),
  Promise.all(environmentLookupHarnessPaths.map((path) =>
    readFile(new URL(`../${path}`, import.meta.url)))),
  readFile(new URL("../fixtures/ExprPrinter.lean", import.meta.url)),
]);
const harnessIdentity = environmentLookupHarnessIdentity(
  environmentLookupHarnessPaths.map((path, index) => ({ path, bytes: harnessSourceBytes[index] })),
);
const packageIdentity = environmentLookupPackageIdentity(
  packageBytes,
  packageInfo,
);

if (packageInfo.package.declarationCount < args.minimumDeclarations) {
  throw new Error(
    `environment lookup benchmark requires at least ${args.minimumDeclarations} declarations; ` +
    `${leanPackageFile} has ${packageInfo.package.declarationCount}`,
  );
}

const factory = createVirRuntimeFactory({ wasmBytes });
const module = await factory.module();
const runtime = factory.instantiateModule(module);
runtime.installIrPackageSetBytes([packageBytes]);
let sample;
let loadSample;
let profile = null;
let profileSummary = null;
let callSlot;
try {
  loadSample = benchmarkPackageLoad(
    factory,
    module,
    packageBytes,
    packageInfo.package.declarationCount,
  );
  const entry = runtime.findManifestEntry(benchmarkEntryName);
  if (entry === null) {
    throw new Error(`benchmark interface entry not found: ${benchmarkEntryName}`);
  }
  callSlot = resolveRawCallSlot(runtime, entry);
  const profileSession = args.cpuProfilePath === null
    ? null
    : await startCpuProfile(args.profileIntervalUs);
  try {
    sample = benchmarkFreshEntries(runtime, entry, callSlot);
  } finally {
    if (profileSession !== null) {
      profile = await stopCpuProfile(profileSession);
    }
  }
} finally {
  runtime.dispose();
}

if (profile !== null) {
  profileSummary = summarizeCpuProfile(profile);
  await mkdir(dirname(args.cpuProfilePath), { recursive: true });
  await writeFile(args.cpuProfilePath, `${JSON.stringify(profile)}\n`);
}

const perCallMs = sample.medianMs / args.iterations;
const perLoadMs = loadSample.medianMs / args.loadIterations;
const executionBenchmark = {
  name: "environment-lookup",
  title: `${benchmarkEntryName} fresh interpreter entry x ${args.iterations}`,
  wasm: {
    label: sample.label,
    iterations: args.iterations,
    checksum: sample.checksum,
    medianMs: sample.medianMs,
    perCallMs,
    samplesMs: sample.samples,
  },
};
const loadBenchmark = {
  name: "package-load",
  title: `${leanPackageFile} package load x ${args.loadIterations}`,
  wasm: {
    label: loadSample.label,
    iterations: args.loadIterations,
    checksum: loadSample.checksum,
    medianMs: loadSample.medianMs,
    perCallMs: perLoadMs,
    samplesMs: loadSample.samples,
  },
};
const report = {
  schema: "lean-vir.bench.v1",
  generatedAt: new Date().toISOString(),
  command: [process.execPath, ...process.execArgv, ...process.argv.slice(1)],
  comparisonIdentity: {
    workload: "environment-lookup-v1",
    entry: benchmarkEntryName,
    expectedResult,
    warmupRounds: args.warmupRounds,
    sampleRounds: args.sampleRounds,
    iterationsPerRound: args.iterations,
    loadWarmupRounds: args.loadWarmupRounds,
    loadSampleRounds: args.loadSampleRounds,
    loadIterationsPerRound: args.loadIterations,
    diagnostics: profile === null ? "off" : "v8-cpu-profile",
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model ?? null,
    leanToolchain: toolchain.trim(),
    manifestVersion: packageInfo.manifest.version,
    declarationCount: packageInfo.package.declarationCount,
    package: packageIdentity,
    harnessSha256: harnessIdentity.sha256,
    fixtureSha256: sha256(fixtureBytes),
    wasmArtifact: publicArtifactPath(benchmarkWasmFile),
    wasmBuild,
  },
  git: gitMetadata(),
  environment: {
    node: process.version,
    v8: process.versions.v8,
    platform: process.platform,
    arch: process.arch,
    cpu: cpus()[0]?.model ?? null,
    leanToolchain: toolchain.trim(),
    wasmBuild,
    artifactPreparation: args.buildArtifacts ? "cache-or-build" : "existing-unverified",
  },
  workload: {
    class: "focused",
    phase: "steady execution; package loading and call-slot resolution excluded",
    entry: benchmarkEntryName,
    callSlot,
    expectedResult,
    terminalState: "completed",
    warmupRounds: args.warmupRounds,
    sampleRounds: args.sampleRounds,
    iterationsPerRound: args.iterations,
    packageLoad: {
      phase: "package decode, initializer execution, and manifest installation; Wasm instantiation excluded",
      warmupRounds: args.loadWarmupRounds,
      sampleRounds: args.loadSampleRounds,
      iterationsPerRound: args.loadIterations,
    },
    minimumDeclarations: args.minimumDeclarations,
  },
  diagnostics: profile === null ? {
    mode: "off",
  } : {
    mode: "v8-cpu-profile",
    timingWarning: "profiled timings are attribution-only and must not be used as headline comparisons",
    requestedIntervalUs: args.profileIntervalUs,
    path: args.cpuProfilePath,
    sha256: sha256(Buffer.from(`${JSON.stringify(profile)}\n`)),
    summary: profileSummary,
  },
  artifacts: {
    wasm: {
      path: publicArtifactPath(benchmarkWasmFile),
      byteLength: wasmBytes.byteLength,
      sha256: sha256(wasmBytes),
    },
    package: {
      path: publicArtifactPath(leanPackageFile),
      byteLength: packageBytes.byteLength,
      sha256: sha256(packageBytes),
      declarationCount: packageInfo.package.declarationCount,
      packageFormatVersion: packageInfo.package.version,
      manifestVersion: packageInfo.manifest.version,
    },
    harness: harnessIdentity,
    fixture: {
      path: "fixtures/ExprPrinter.lean",
      sha256: sha256(fixtureBytes),
    },
  },
  artifactCache,
  benchmarks: [executionBenchmark, loadBenchmark],
};

console.log("# Lean VIR environment lookup benchmark");
console.log(`entry:        ${benchmarkEntryName}`);
console.log(`package:      ${leanPackageFile} (${packageInfo.package.declarationCount} declarations)`);
console.log(`run policy:   ${args.warmupRounds} warmup(s), ${args.sampleRounds} sample(s), ${args.iterations} calls/sample`);
console.log(`fresh entry:  ${formatMs(perCallMs)} / call (median)`);
console.log(`raw batches:  ${sample.samples.map((value) => formatMs(value)).join(", ")}`);
console.log(`checksum:     ${sample.checksum}`);
console.log(
  `package load: ${formatMs(perLoadMs)} / load (median; ` +
  `${args.loadWarmupRounds} warmup(s), ${args.loadSampleRounds} sample(s))`,
);
console.log(`load batches: ${loadSample.samples.map((value) => formatMs(value)).join(", ")}`);
if (profileSummary !== null) {
  console.log("profile:      diagnostic only; package loading excluded");
  for (const row of profileSummary.topSelf.slice(0, 10)) {
    console.log(`  ${row.percent.toFixed(1).padStart(5)}%  ${displayProfileName(row.name)}`);
  }
}

if (args.jsonPath !== null) {
  await mkdir(dirname(args.jsonPath), { recursive: true });
  await writeFile(args.jsonPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`wrote benchmark report: ${args.jsonPath}`);
}
