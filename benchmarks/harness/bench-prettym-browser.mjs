#!/usr/bin/env node
/* Copyright (c) 2026 Lean FRO LLC. Released under Apache 2.0 (see LICENSE). */
// Consumes an already published Slides site and its unchanged native corpus.
// No build, acquisition cache, backend registry or alternate formatter.
import { copyFile, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { cpus, platform, arch } from "node:os";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { serveDist, launchChromium, openChromiumPage, navigate, evaluate } from "../../tests/browser/harness.mjs";
import { sha256, summarizePairedSamples } from "./bench-utils.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const options = parseArgs(process.argv.slice(2));
if (options.help) {
  console.log("usage: npm run bench:prettym -- --site DIR --corpus FILE --adapter FILE --output NEW_DIR [--check] [--repeats N] [--reverse]");
  process.exit(0);
}
await mkdir(dirname(options.output), { recursive: true });
await mkdir(options.output); // Never make an earlier successful report look current.
let phase = "inputs", server, chromium, cdp;
const report = {
  schema: "lean-vir.prettym-public-call.v1", status: "failed", mode: "A/A",
  generatedAt: new Date().toISOString(), argv: [process.execPath, ...process.argv.slice(1)],
  environment: { platform: platform(), arch: arch(), cpu: cpus()[0]?.model ?? null,
    node: process.version, governor: "unknown", backgroundLoad: "uncontrolled" },
  limits: "screening only; one browser process; no speed, startup, paint or leak claim",
};
try {
  const corpusBytes = await readFile(options.corpus);
  const corpus = JSON.parse(corpusBytes);
  const html = await readFile(resolve(options.site, "index.html"), "utf8");
  const files = [
    ["sampler.js", resolve(root, "benchmarks/browser/examples/prettyM/benchmark-core.js")],
    ["adapter.js", options.adapter],
    ["screen.js", resolve(root, "benchmarks/harness/pretty-public-call.js")],
  ];
  report.inputs = { site: options.site, corpus: options.corpus,
    corpusSha256: sha256(corpusBytes), caseCount: corpus.length,
    nativeExpected: corpus, sources: {}, indexSha256: sha256(html) };
  for (const [name, path] of files) {
    report.inputs.sources[name] = { path, sha256: sha256(await readFile(path)) };
    await copyFile(path, resolve(options.output, name));
  }
  report.git = gitIdentity();
  report.harness = {};
  for (const path of ["benchmarks/harness/bench-prettym-browser.mjs",
    "benchmarks/harness/bench-utils.mjs", "tests/browser/harness.mjs"]) {
    report.harness[path] = sha256(await readFile(resolve(root, path)));
  }
  await symlink(options.site, resolve(options.output, "prepared"), "dir");
  await writeFile(resolve(options.output, "index.html"),
    '<!doctype html><title>PrettyM A/A</title><script src="sampler.js"></script><script src="adapter.js"></script>');
  phase = "browser-start";
  server = await serveDist(options.output, "/");
  chromium = await launchChromium();
  report.chromiumCommand = chromium.child.spawnargs;
  cdp = await openChromiumPage(chromium);
  await navigate(cdp, `${server.origin}/index.html`);
  report.browser = await cdp.send("Browser.getVersion");
  phase = "published-inputs";
  const selected = await evaluate(cdp, `(() => {
    const document = new DOMParser().parseFromString(${JSON.stringify(html)}, 'text/html');
    const bootstrap = document.querySelector('script[data-runtime-module]');
    if (!bootstrap) throw Error('site has no resource bootstrap');
    const base = new URL('prepared/index.html', location.href);
    const urls = Object.fromEntries(['runtimeModule', 'runtimeManifest', 'programManifest']
      .map(key => [key, new URL(bootstrap.dataset[key], base).href]));
    return urls;
  })()`);
  report.selected = selected;
  report.artifacts = await artifactSnapshot(selected, server.origin);
  report.policy = options.check ? { warmups: 0, rounds: 2, repeats: 1, reverse: options.reverse }
    : { warmups: 2, rounds: 8, repeats: options.repeats, reverse: options.reverse };
  phase = "public-creation-and-formatting";
  report.screen = await evaluate(cdp, `(async () => {
    const {createProgram} = await import(${JSON.stringify(selected.runtimeModule)});
    const {screenPrettyPublicCalls} = await import('./screen.js');
    const programs = {}, creationOrder = ${JSON.stringify(options.reverse ? ["candidate", "control"] : ["control", "candidate"])};
    let result, failure;
    try {
      for (const side of creationOrder) programs[side] = await createProgram({
        runtimeManifestUrl: new URL(${JSON.stringify(selected.runtimeManifest)}),
        programManifestUrl: new URL(${JSON.stringify(selected.programManifest)})});
      result = await screenPrettyPublicCalls({corpus: ${JSON.stringify(corpus)}, programs,
        format: formatCompactSegments, sample: runDifferentialSamples,
        ${Object.entries(report.policy).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(",")}});
    } catch (error) { failure = {name: error?.name, message: String(error?.message ?? error), stack: error?.stack,
      phase: error?.phase, cause: error?.cause?.stack ?? String(error?.cause)}; }
    const cleanupErrors = [];
    for (const side of creationOrder) {
      try { programs[side]?.dispose(); }
      catch (error) { cleanupErrors.push({side, message: String(error?.message ?? error), stack: error?.stack}); }
    }
    return {result, failure, cleanupErrors};
  })()`);
  phase = "identity-recheck";
  const after = await artifactSnapshot(selected, server.origin);
  if (JSON.stringify(after) !== JSON.stringify(report.artifacts)) throw new Error("prepared artifacts changed during the screen");
  if (sha256(await readFile(options.corpus)) !== report.inputs.corpusSha256) throw new Error("native corpus changed during the screen");
  const { result, failure, cleanupErrors } = report.screen;
  phase = "public-creation-and-formatting";
  if (failure || !result?.passed || cleanupErrors.length) throw new Error(failure?.message ?? result?.error?.message ?? "creation/formatting/cleanup failed");
  const measured = result.observations.filter(r => r.phase === "measured");
  const control = measured.filter(r => r.side === "control").map(r => r.elapsedMs);
  const candidate = measured.filter(r => r.side === "candidate").map(r => r.elapsedMs);
  const orders = Array.from({ length: result.rounds }, (_, i) => measured.slice(i * 2, i * 2 + 2).map(r => r.side));
  report.comparison = summarizePairedSamples(control, candidate, result.repeats, orders);
  report.status = "passed";
} catch (error) {
  report.error = { phase, name: error.name, message: error.message, stack: error.stack };
} finally {
  const cleanupErrors = [];
  for (const close of [() => cdp?.close(), () => chromium?.close(), () => server?.close()]) {
    try { await close(); } catch (error) { cleanupErrors.push(String(error)); }
  }
  if (cleanupErrors.length) {
    report.cleanupErrors = cleanupErrors;
    report.status = "failed";
  }
  await writeFile(resolve(options.output, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
}
if (report.status !== "passed") {
  console.error(`PrettyM screen failed: ${report.error?.message ?? report.cleanupErrors}; evidence: ${options.output}`);
  if (report.screen?.failure?.cause) console.error(report.screen.failure.cause);
  process.exitCode = 1;
} else if (options.check) {
  console.log(`PrettyM public-loader/native-oracle smoke PASS; evidence: ${options.output}`);
} else {
  const c = report.comparison;
  console.log(`PrettyM A/A: ${report.inputs.caseCount} native cases, ${c.rounds.length} paired rounds`);
  for (const r of c.rounds) console.log(`${r.round} ${r.sequence}: ${r.controlMs.toFixed(3)} / ${r.candidateMs.toFixed(3)} ms/corpus; ratio ${r.ratio.toFixed(3)}`);
  console.log(`Median paired ratio ${c.medianRatio.toFixed(3)}; unchanged-artifact variability, not a speed claim. Evidence: ${options.output}`);
}

async function artifactSnapshot(selected, origin) {
  const snapshot = {};
  for (const key of ["runtimeManifest", "programManifest"]) {
    const url = new URL(selected[key]);
    if (url.origin !== origin || !url.pathname.startsWith("/prepared/")) throw new Error("published manifest is outside the prepared site");
    const path = resolve(options.site, decodeURIComponent(url.pathname.slice("/prepared/".length)));
    const bytes = await readFile(path), envelope = JSON.parse(bytes);
    const payloads = [];
    for (const info of envelope.descriptor.files) {
      payloads.push({ path: info.path, sha256: sha256(await readFile(resolve(dirname(path), info.path))) });
    }
    snapshot[key] = { contentId: envelope.contentId, descriptor: envelope.descriptor,
      manifestSha256: sha256(bytes), payloads };
  }
  return snapshot;
}

function gitIdentity() {
  const run = args => spawnSync("git", args, { cwd: root, encoding: "utf8" }).stdout?.trim();
  return { commit: run(["rev-parse", "HEAD"]), status: run(["status", "--short"]),
    trackedDiffSha256: sha256(run(["diff", "--binary", "HEAD"]) ?? "") };
}

function parseArgs(args) {
  const result = { repeats: null, check: false, reverse: false };
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (key === "--help" || key === "-h") return { help: true };
    if (key === "--check" || key === "--reverse") { result[key.slice(2)] = true; continue; }
    if (!["--site", "--corpus", "--adapter", "--output", "--repeats"].includes(key) || !args[i + 1]) {
      throw new Error(`unknown option or missing value: ${key}`);
    }
    result[key.slice(2)] = key === "--repeats" ? Number(args[++i]) : resolve(args[++i]);
  }
  for (const key of ["site", "corpus", "adapter", "output"]) if (!result[key]) throw new Error(`--${key} is required`);
  return result;
}
