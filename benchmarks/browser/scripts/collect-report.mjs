import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const appRoot = dirname(dirname(fileURLToPath(import.meta.url)));

function parseArgs(argv) {
  const options = {
    url: "http://127.0.0.1:18334/",
    output: "_results/pretty-benchmark.json",
    warmup: 2,
    samples: 9,
    scalingWarmup: 2,
    scalingSamples: 9,
    interactionWarmup: 1,
    interactionSamples: 5,
    repeatCycles: 32,
    coldRuns: 5,
    batchTargetMs: 20,
    maxBatchIterations: 512,
    batchMemoryMiB: 64,
    skipIsolatedMemory: false,
    skipIsolatedRepeats: false,
    allowIsolatedFailures: false,
  };
  const numeric = new Map([
    ["--warmup", "warmup"],
    ["--samples", "samples"],
    ["--scaling-warmup", "scalingWarmup"],
    ["--scaling-samples", "scalingSamples"],
    ["--interaction-warmup", "interactionWarmup"],
    ["--interaction-samples", "interactionSamples"],
    ["--repeat-cycles", "repeatCycles"],
    ["--cold-runs", "coldRuns"],
    ["--batch-target-ms", "batchTargetMs"],
    ["--max-batch-iterations", "maxBatchIterations"],
    ["--batch-memory-mib", "batchMemoryMiB"],
  ]);
  let sawUrl = false;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (numeric.has(argument)) {
      const value = Number(argv[++index]);
      if (!Number.isFinite(value)) throw new Error(`${argument} needs a number`);
      options[numeric.get(argument)] = value;
    } else if (argument === "--output") {
      options.output = argv[++index];
    } else if (argument === "--skip-isolated-memory") {
      options.skipIsolatedMemory = true;
    } else if (argument === "--skip-isolated-repeats") {
      options.skipIsolatedRepeats = true;
    } else if (argument === "--allow-isolated-failures") {
      options.allowIsolatedFailures = true;
    } else if (argument === "--help" || argument === "-h") {
      console.log(`Usage: node scripts/collect-report.mjs [URL] [options]

Collect corpus, scaling, retained-memory, interaction, repeated-call,
cold-start, and optional fresh-context studies into one report.

  --output PATH                 report path inside this repository
  --warmup N                    corpus warm-up rounds (default: 2)
  --samples N                   corpus measured rounds (default: 9)
  --scaling-warmup N            scaling warm-up rounds (default: 2)
  --scaling-samples N           scaling measured rounds (default: 9)
  --interaction-warmup N        interaction warm-up rounds (default: 1)
  --interaction-samples N       interaction measured rounds (default: 5)
  --repeat-cycles N             rotated repeat cycles (default: 32)
  --cold-runs N                 fresh-context startup profiles (default: 5)
  --batch-target-ms N           adaptive batch duration (default: 20)
  --max-batch-iterations N      adaptive batch cap (default: 512)
  --batch-memory-mib N          estimated batch memory cap (default: 64)
  --skip-isolated-memory        omit fresh-context memory points
  --skip-isolated-repeats       omit fresh-context VIR-mode repeats
  --allow-isolated-failures     keep success status for isolated-only failures`);
      process.exit(0);
    } else if (!argument.startsWith("-") && !sawUrl) {
      options.url = argument;
      sawUrl = true;
    } else {
      throw new Error(`unknown argument: ${argument}`);
    }
  }
  for (const [name, value] of [
    ["--samples", options.samples],
    ["--scaling-samples", options.scalingSamples],
    ["--interaction-samples", options.interactionSamples],
    ["--repeat-cycles", options.repeatCycles],
    ["--cold-runs", options.coldRuns],
    ["--batch-target-ms", options.batchTargetMs],
    ["--max-batch-iterations", options.maxBatchIterations],
    ["--batch-memory-mib", options.batchMemoryMiB],
  ]) {
    if (value <= 0) throw new Error(`${name} must be positive`);
  }
  return options;
}

function workspacePath(path) {
  const target = resolve(appRoot, path);
  const local = relative(appRoot, target);
  if (local === ".." || local.startsWith(`..${sep}`) || isAbsolute(local)) {
    throw new Error(`refusing to write outside ${appRoot}: ${target}`);
  }
  return target;
}

async function waitForBackends(page, url) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(
    () =>
      globalThis.crossOriginIsolated === true &&
      typeof runPrettyDifferentialCorpus === "function" &&
      typeof runPrettyScalingStudy === "function" &&
      typeof runPrettyRepeatedCallStudy === "function" &&
      typeof runPrettyMemoryScalingPoint === "function" &&
      typeof runPrettyMemoryScalingStudy === "function" &&
      typeof runPrettyInteractionStudy === "function" &&
      typeof collectPrettyMemorySnapshot === "function" &&
      typeof collectPrettyRuntimeProfile === "function" &&
      typeof getPrettyBackends === "function" &&
      getPrettyBackends().length === 5 &&
      getPrettyBackends().every(
        (backend) =>
          (typeof backend.status !== "function" ? "ready" : backend.status()) ===
          "ready",
      ),
    undefined,
    { timeout: 120_000 },
  );
}

function distribution(values) {
  const ordered = values
    .filter((value) => Number.isFinite(value))
    .toSorted((left, right) => left - right);
  if (ordered.length === 0)
    return { samples: 0, min: 0, median: 0, p95: 0, max: 0 };
  const middle = Math.floor(ordered.length / 2);
  const median =
    ordered.length % 2 === 1
      ? ordered[middle]
      : (ordered[middle - 1] + ordered[middle]) / 2;
  return {
    samples: ordered.length,
    min: ordered[0],
    median,
    p95: ordered[Math.min(ordered.length - 1, Math.ceil(ordered.length * 0.95) - 1)],
    max: ordered.at(-1),
  };
}

async function collectColdProfiles(browser, url, runs) {
  const profiles = [];
  for (let run = 0; run < runs; run += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await waitForBackends(page, url);
    profiles.push(await page.evaluate(() => collectPrettyRuntimeProfile()));
    await context.close();
  }
  return profiles;
}

function summarizeColdProfiles(profiles, backendIds) {
  const backends = {};
  for (const backendId of backendIds) {
    const entries = profiles.map((profile) => profile.backends[backendId]);
    backends[backendId] = {
      label: entries[0]?.label ?? backendId,
      startupMs: distribution(entries.map((entry) => entry.startupMs)),
      resourceLoadMs: distribution(entries.map((entry) => entry.resourceLoadMs)),
      assetBytes: entries[0]?.assetBytes ?? 0,
      wasmBytes: entries[0]?.wasmBytes ?? 0,
      memoryBytes: entries[0]?.memoryBytes ?? null,
      provenance: entries[0]?.provenance ?? null,
    };
  }
  return { runs: profiles.length, backends, profiles };
}

async function collectIsolatedMemory(browser, url, backendIds, pointCount) {
  const points = [];
  for (let pointIndex = 0; pointIndex < pointCount; pointIndex += 1) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await waitForBackends(page, url);
    const point = await page.evaluate(
      ({ index, ids }) => runPrettyMemoryScalingPoint(index, { backendIds: ids }),
      { index: pointIndex, ids: backendIds },
    );
    await context.close();
    points.push(point);
    console.log(
      `isolated memory ${pointIndex + 1}/${pointCount}: ${point.dimension} ${point.sizeLabel}`,
    );
  }
  const dimensions = [];
  for (const point of points) {
    let dimension = dimensions.find((item) => item.id === point.dimension);
    if (!dimension) {
      dimension = { id: point.dimension, label: point.dimensionLabel, points: [] };
      dimensions.push(dimension);
    }
    dimension.points.push(point);
  }
  const mismatches = points.filter((point) => !point.parity);
  return {
    schemaVersion: 1,
    kind: "memory-isolated",
    mode: "fresh-browser-context",
    backendIds,
    pointCount: points.length,
    parityCount: points.length - mismatches.length,
    passed: mismatches.length === 0,
    mismatches: mismatches.map((point) => ({
      caseId: point.caseId,
      label: point.label,
      width: point.width,
      backendErrors: Object.fromEntries(
        backendIds
          .filter((id) => point.backends[id].errors.length > 0)
          .map((id) => [id, point.backends[id].errors]),
      ),
    })),
    dimensions,
    points,
  };
}

async function collectIsolatedRepeats(browser, url, backendIds, cycles) {
  const selectedIds = ["vir", "vir-format"].filter((id) =>
    backendIds.includes(id),
  );
  const reports = {};
  for (const backendId of selectedIds) {
    const context = await browser.newContext();
    const page = await context.newPage();
    await waitForBackends(page, url);
    reports[backendId] = await page.evaluate(
      ({ id, count }) =>
        runPrettyRepeatedCallStudy({ backendIds: [id], cycles: count }),
      { id: backendId, count: cycles },
    );
    await context.close();
    console.log(
      `isolated repeats: ${backendId} · ${cycles} cycles · ${reports[backendId].passed ? "pass" : "fail"}`,
    );
  }
  return {
    schemaVersion: 1,
    kind: "repeated-isolated-vir-modes",
    mode: "fresh-browser-context-per-mode",
    cycles,
    backendIds: selectedIds,
    passed:
      Object.keys(reports).length === selectedIds.length &&
      Object.values(reports).every((report) => report.passed),
    reports,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const output = workspacePath(options.output);
  const configuredChrome = process.env.CHROMIUM ?? "/usr/bin/google-chrome";
  const browser = await chromium.launch({
    headless: true,
    executablePath: existsSync(configuredChrome) ? configuredChrome : undefined,
  });
  let results;
  let coldProfiles;
  let isolatedMemory;
  let isolatedRepeats;
  try {
    coldProfiles = await collectColdProfiles(browser, options.url, options.coldRuns);
    const context = await browser.newContext();
    const page = await context.newPage();
    await waitForBackends(page, options.url);
    results = await page.evaluate(
      async (settings) => {
        const corpus = await runPrettyDifferentialCorpus({
          warmup: settings.warmup,
          samples: settings.samples,
          profile: true,
        });
        const scaling = await runPrettyScalingStudy({
          warmup: settings.scalingWarmup,
          samples: settings.scalingSamples,
          batchTargetMs: settings.batchTargetMs,
          maxBatchIterations: settings.maxBatchIterations,
          batchMemoryBudgetBytes: settings.batchMemoryBudgetBytes,
        });
        const memory = await runPrettyMemoryScalingStudy();
        const interactions = await runPrettyInteractionStudy({
          warmup: settings.interactionWarmup,
          samples: settings.interactionSamples,
          batchTargetMs: settings.batchTargetMs,
          maxBatchIterations: settings.maxBatchIterations,
          batchMemoryBudgetBytes: settings.batchMemoryBudgetBytes,
        });
        const repeated = await runPrettyRepeatedCallStudy({
          cycles: settings.repeatCycles,
        });
        return {
          corpus,
          scaling,
          memory,
          interactions,
          repeated,
          postRunProfile: await collectPrettyRuntimeProfile(),
        };
      },
      {
        ...options,
        batchMemoryBudgetBytes: options.batchMemoryMiB * 1024 * 1024,
      },
    );
    await context.close();
    isolatedMemory = options.skipIsolatedMemory
      ? null
      : await collectIsolatedMemory(
          browser,
          options.url,
          results.corpus.backendIds,
          results.memory.pointCount,
        );
    isolatedRepeats = options.skipIsolatedRepeats
      ? null
      : await collectIsolatedRepeats(
          browser,
          options.url,
          results.corpus.backendIds,
          options.repeatCycles,
        );
  } finally {
    await browser.close();
  }

  const report = results.corpus;
  report.coldStart = summarizeColdProfiles(coldProfiles, report.backendIds);
  report.scaling = results.scaling;
  results.memory.isolated = isolatedMemory;
  report.memory = results.memory;
  report.interactions = results.interactions;
  results.repeated.isolated = isolatedRepeats;
  report.repeated = results.repeated;
  report.postRunProfile = results.postRunProfile;

  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(report, null, 2)}\n`);

  const corePassed = [
    report,
    report.scaling,
    report.memory,
    report.interactions,
    report.repeated,
  ].every((study) => study.passed);
  const isolatedPassed =
    (isolatedMemory === null || isolatedMemory.passed) &&
    (isolatedRepeats === null || isolatedRepeats.passed);
  console.log(
    `corpus ${report.parityCount}/${report.scenarioCount}; scaling ${report.scaling.parityCount}/${report.scaling.scenarioCount}; interactions ${report.interactions.parityCount}/${report.interactions.scenarioCount}; repeated ${report.repeated.passed ? "pass" : "fail"}`,
  );
  console.log(`report: ${relative(appRoot, output)}`);
  if (!corePassed || (!options.allowIsolatedFailures && !isolatedPassed)) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
