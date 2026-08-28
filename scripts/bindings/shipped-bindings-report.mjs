/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";

import { scriptSafeJson } from "../json-utils.mjs";
import { repositoryRoot as root } from "../repository-paths.mjs";
import { emitGeneratedFile, requiredValue } from "./tool-utils.mjs";
import { VIR_HOST_DISPOSE } from "../../web/src/host-resource.js";
import {
  createBrowserHostBindings,
  createHostResourceState,
  createNodeHostBindings,
  createVirtualDocumentState,
} from "../../web/src/vir-host-bindings.js";
import { createBrowserReactHostBindings } from "../../web/src/vir-react-host-bindings.js";
import { RUNTIME_INTRINSIC_HOST_TARGETS } from "../../web/src/runtime/host-state.js";

const usageLine = "usage: node scripts/bindings/generate-shipped-bindings-report.mjs --lean FILE --out FILE --html FILE [options]";

function usage() {
  console.log(`${usageLine}

Reconcile compiler-derived JavaScript bindings with runtime provider keys.

Options:
  --lean FILE  Compiler-derived VIR JavaScript inventory.
  --out FILE   Write the coverage report JSON to FILE.
  --html FILE  Write the coverage dashboard to FILE.
  --check      Compare generated files with existing outputs.
  -h, --help   Show this help.
`);
}

function parseArgs(argv) {
  const options = { lean: null, out: null, html: null, check: false };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "-h" || option === "--help") {
      usage();
      return null;
    } else if (option === "--lean") options.lean = requiredValue(argv, ++index, option);
    else if (option === "--out") options.out = requiredValue(argv, ++index, option);
    else if (option === "--html") options.html = requiredValue(argv, ++index, option);
    else if (option === "--check") options.check = true;
    else throw new Error(`unknown option ${option}`);
  }
  if (options.lean === null || options.out === null || options.html === null) {
    throw new Error(usageLine);
  }
  return Object.fromEntries(Object.entries(options).map(([key, value]) =>
    [key, typeof value === "string" ? resolve(root, value) : value]));
}

async function readInventory(path) {
  const value = JSON.parse(await readFile(path, "utf8"));
  if (value?.format !== "lean-vir-js-inventory" || value.version !== 1 ||
      !Array.isArray(value.bindings) || value.summary?.declarations !== value.bindings.length ||
      !Array.isArray(value.publicEntries) ||
      value.summary?.publicEntries !== value.publicEntries.length) {
    throw new Error(`${relative(root, path)} is not a compiler-derived VIR JavaScript inventory`);
  }
  const validBoundaries = new Set(["hostResource", "explicitConversion", "objectHandle"]);
  const declarations = new Set();
  for (const binding of value.bindings) {
    if (typeof binding.declaration !== "string" || typeof binding.target !== "string" ||
        typeof binding.type !== "string" || !validBoundaries.has(binding.boundary)) {
      throw new Error(`${relative(root, path)} contains an invalid binding entry`);
    }
    if (declarations.has(binding.declaration)) {
      throw new Error(`duplicate compiler declaration ${binding.declaration}`);
    }
    declarations.add(binding.declaration);
    const expectedBoundary = binding.marker === "vir_js_explicit_conversion"
      ? "explicitConversion"
      : binding.marker === "vir_js" ? null : "invalid";
    if (expectedBoundary === "invalid" ||
        (expectedBoundary === "explicitConversion" && binding.boundary !== expectedBoundary) ||
        (expectedBoundary === null && binding.boundary === "explicitConversion")) {
      throw new Error(`${binding.declaration} has inconsistent marker and boundary metadata`);
    }
  }
  let publicTargetEdges = 0;
  const publicTargets = new Set();
  for (const entry of value.publicEntries) {
    if (typeof entry.declaration !== "string" || typeof entry.module !== "string" ||
        typeof entry.type !== "string" || !Array.isArray(entry.targets) ||
        entry.targets.length === 0) {
      throw new Error(`${relative(root, path)} contains an invalid public entry`);
    }
    for (const reached of entry.targets) {
      if (typeof reached.target !== "string" || !Array.isArray(reached.path) ||
          reached.path[0] !== entry.declaration ||
          reached.path.some((declaration) => typeof declaration !== "string")) {
        throw new Error(`${entry.declaration} contains invalid compiler reachability evidence`);
      }
      publicTargetEdges += 1;
      publicTargets.add(reached.target);
    }
  }
  if (value.summary.publicTargetEdges !== publicTargetEdges ||
      value.summary.publicTargets !== publicTargets.size) {
    throw new Error(`${relative(root, path)} has inconsistent public reachability counts`);
  }
  return value;
}

function collectProviders() {
  const browserResources = createHostResourceState();
  const browser = createBrowserHostBindings({
    resources: browserResources,
    reactHostBindings: createBrowserReactHostBindings,
  });
  const nodeState = createVirtualDocumentState();
  const node = createNodeHostBindings(nodeState);
  try {
    return [
      provider("browser", "Browser + React host map", Object.keys(browser)),
      provider("node", "Virtual Node host map", Object.keys(node)),
      provider("runtime-intrinsic", "VIR object-handle dispatcher",
        Object.values(RUNTIME_INTRINSIC_HOST_TARGETS)),
    ];
  } finally {
    browser[VIR_HOST_DISPOSE]?.();
    node[VIR_HOST_DISPOSE]?.();
  }
}

function provider(id, title, targets) {
  return { id, title, targets: [...new Set(targets)].sort() };
}

export function buildShippedBindingsReport(inventory, providers) {
  const declarationsByTarget = new Map();
  const boundaryCounts = { hostResource: 0, objectHandle: 0, explicitConversion: 0 };
  for (const binding of inventory.bindings) {
    boundaryCounts[binding.boundary] += 1;
    const entries = declarationsByTarget.get(binding.target) ?? [];
    entries.push(binding);
    declarationsByTarget.set(binding.target, entries);
  }
  const providersByTarget = new Map();
  for (const entry of providers) {
    for (const target of entry.targets) {
      const ids = providersByTarget.get(target) ?? [];
      ids.push(entry.id);
      providersByTarget.set(target, ids);
    }
  }

  const targets = [...new Set([...declarationsByTarget.keys(), ...providersByTarget.keys()])].sort();
  const bindings = targets.map((target) => {
    const declarations = (declarationsByTarget.get(target) ?? []).sort((lhs, rhs) =>
      lhs.declaration.localeCompare(rhs.declaration));
    const targetProviders = (providersByTarget.get(target) ?? []).sort();
    const status = declarations.length === 0
      ? "runtime-only"
      : targetProviders.length === 0 ? "missing-provider" : "provided";
    return {
      target,
      prefix: target.split(".")[0],
      status,
      providers: targetProviders,
      boundaries: [...new Set(declarations.map((entry) => entry.boundary))].sort(),
      visibility: declarations.some((entry) => !entry.private) ? "public" : "private",
      declarations,
    };
  });

  const count = (status) => bindings.filter((entry) => entry.status === status).length;
  return {
    format: "lean-vir-shipped-bindings-coverage",
    version: 1,
    generatedBy: "scripts/bindings/generate-shipped-bindings-report.mjs",
    analysis: {
      representationPolicy: "compiler-validated-coarse-boundary",
      ordinaryBoundary: "Unit, JavaScript resources, object handles, and resource-shaped callbacks",
      conversionBoundary: "explicit vir_js_explicit_conversion declarations only",
      providerCoverage: "target-name-presence-only",
      providerBehavior: "not-mechanically-verified",
      semanticParity: "library-specific type anchors",
    },
    lean: {
      modules: inventory.modules,
      version: inventory.lean.version,
      toolchain: inventory.lean.toolchain,
      githash: inventory.lean.githash,
    },
    providers: providers.map(({ id, title, targets }) => ({ id, title, targets: targets.length })),
    summary: {
      declarations: inventory.summary.declarations,
      virJs: inventory.summary.virJs,
      explicitConversions: inventory.summary.explicitConversions,
      boundaries: boundaryCounts,
      declaredTargets: declarationsByTarget.size,
      providerTargets: providersByTarget.size,
      totalTargets: bindings.length,
      provided: count("provided"),
      missingProvider: count("missing-provider"),
      runtimeOnly: count("runtime-only"),
      publicTargets: bindings.filter((entry) => entry.visibility === "public").length,
      privateTargets: bindings.filter((entry) => entry.visibility === "private").length,
      publicEntries: inventory.summary.publicEntries,
      publicTargetEdges: inventory.summary.publicTargetEdges,
      targetsReachedByPublicEntries: inventory.summary.publicTargets,
    },
    publicEntries: inventory.publicEntries,
    bindings,
  };
}

export function renderShippedBindingsHtml(report) {
  const { publicEntries: _publicEntries, ...clientReport } = report;
  const data = scriptSafeJson(clientReport);
  return `<!doctype html>
<!-- Generated by scripts/bindings/generate-shipped-bindings-report.mjs; regenerate instead of editing. -->
<html lang="en" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>Shipped VIR JavaScript bindings</title>
  <style>
    :root { --bg:#071018; --panel:#0d1924; --panel2:#111f2c; --text:#ecf5f7; --muted:#8ea8b5; --line:#243744; --mint:#65e0b1; --blue:#75baff; --amber:#ffc768; --red:#ff7c88; --shadow:0 24px 80px #0008; }
    :root[data-theme="light"] { --bg:#eef5f4; --panel:#fff; --panel2:#f5faf9; --text:#15252c; --muted:#5e7680; --line:#ccdcda; --shadow:0 24px 70px #31546422; }
    * { box-sizing:border-box; } body { margin:0; min-height:100vh; color:var(--text); background:radial-gradient(circle at 15% -10%,#1b696855,transparent 34rem),radial-gradient(circle at 90% 10%,#315b9b44,transparent 30rem),var(--bg); font:15px/1.5 Inter,ui-sans-serif,system-ui,sans-serif; }
    button,input,select { font:inherit; } button { color:inherit; } main { width:min(1500px,calc(100% - 32px)); margin:auto; padding:42px 0 64px; }
    header { display:flex; justify-content:space-between; gap:24px; align-items:flex-start; margin-bottom:28px; } .eyebrow { color:var(--mint); text-transform:uppercase; letter-spacing:.16em; font-weight:800; font-size:12px; }
    h1 { margin:7px 0 9px; font-size:clamp(34px,5vw,66px); line-height:1; letter-spacing:-.045em; } .lede { max-width:850px; color:var(--muted); font-size:17px; margin:0; }
    .theme { border:1px solid var(--line); background:var(--panel); border-radius:999px; padding:9px 14px; cursor:pointer; }
    .metrics { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; margin:26px 0; } .metric { background:linear-gradient(145deg,var(--panel),var(--panel2)); border:1px solid var(--line); border-radius:18px; padding:18px; box-shadow:var(--shadow); }
    .metric strong { display:block; font-size:32px; line-height:1.1; } .metric span { color:var(--muted); } .metric.good strong { color:var(--mint); } .metric.bad strong { color:var(--red); }
    .scope { border:1px solid var(--line); border-radius:16px; padding:14px 18px; color:var(--muted); background:#0002; margin-bottom:16px; } .scope b { color:var(--text); }
    .workspace { display:grid; grid-template-columns:minmax(390px,.9fr) minmax(520px,1.25fr); min-height:690px; border:1px solid var(--line); border-radius:22px; overflow:hidden; background:var(--panel); box-shadow:var(--shadow); }
    .left { border-right:1px solid var(--line); min-width:0; } .toolbar { padding:14px; display:grid; grid-template-columns:1fr 150px; gap:9px; border-bottom:1px solid var(--line); background:var(--panel2); }
    input,select { width:100%; color:var(--text); background:var(--bg); border:1px solid var(--line); border-radius:11px; padding:10px 12px; outline:none; } input:focus,select:focus { border-color:var(--mint); box-shadow:0 0 0 3px #65e0b122; }
    .filters { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; padding:0 14px 14px; background:var(--panel2); border-bottom:1px solid var(--line); } .result-head { padding:10px 15px; color:var(--muted); border-bottom:1px solid var(--line); }
    #results { max-height:620px; overflow:auto; } .row { width:100%; display:grid; grid-template-columns:1fr auto; gap:8px; text-align:left; padding:12px 15px; border:0; border-bottom:1px solid var(--line); background:transparent; cursor:pointer; }
    .row:hover,.row.active { background:#65e0b10d; } .row.active { box-shadow:inset 3px 0 var(--mint); } .target { font:600 13px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace; overflow-wrap:anywhere; } .sub { display:block; color:var(--muted); font-size:12px; margin-top:4px; }
    .pill,.badge { display:inline-flex; align-items:center; width:max-content; border:1px solid var(--line); border-radius:999px; padding:3px 8px; font-size:11px; font-weight:750; } .provided { color:var(--mint); border-color:#65e0b166; } .missing-provider { color:var(--red); border-color:#ff7c8866; } .runtime-only { color:var(--amber); border-color:#ffc76866; }
    .detail { padding:24px; min-width:0; overflow:auto; max-height:690px; } .detail h2 { font:700 clamp(22px,3vw,36px)/1.15 ui-monospace,SFMono-Regular,Menlo,monospace; margin:10px 0 8px; overflow-wrap:anywhere; }
    .badges { display:flex; flex-wrap:wrap; gap:7px; margin:12px 0 22px; } .badge { color:var(--blue); } .section { border-top:1px solid var(--line); padding-top:18px; margin-top:18px; } .section h3 { margin:0 0 12px; font-size:13px; text-transform:uppercase; letter-spacing:.12em; color:var(--muted); }
    .decl { border:1px solid var(--line); border-radius:14px; padding:14px; margin:10px 0; background:var(--panel2); } .decl-head { display:flex; justify-content:space-between; gap:10px; align-items:flex-start; } .decl-name { font:650 13px/1.4 ui-monospace,SFMono-Regular,Menlo,monospace; overflow-wrap:anywhere; }
    code { display:block; margin-top:10px; color:#c9e6ff; white-space:pre-wrap; overflow-wrap:anywhere; font:12px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; } .scope code { display:inline; margin:0; } :root[data-theme="light"] code { color:#19517e; } .source { color:var(--mint); text-decoration:none; font-size:12px; } .empty { color:var(--muted); padding:30px; text-align:center; }
    @media (max-width:980px) { .metrics { grid-template-columns:repeat(2,1fr); } .workspace { grid-template-columns:1fr; } .left { border-right:0; border-bottom:1px solid var(--line); } #results { max-height:420px; } .detail { max-height:none; } }
    @media (max-width:600px) { main { width:min(100% - 18px,1500px); padding-top:24px; } header { display:block; } .theme { margin-top:16px; } .metrics { grid-template-columns:1fr 1fr; } .toolbar { grid-template-columns:1fr; } .filters { grid-template-columns:1fr; } }
  </style>
</head>
<body>
<main>
  <header><div><div class="eyebrow">Lean VIR · pre-release boundary inventory</div><h1>Shipped JavaScript bindings</h1><p class="lede">Every compiler-discovered VIR JavaScript boundary reconciled by target name with the provider maps shipped by this checkout. Lean validates the coarse boundary representation; provider behavior and upstream semantic parity require separate evidence.</p></div><button class="theme" id="theme" type="button">Toggle theme</button></header>
  <section class="metrics">
    <article class="metric good"><strong id="provided-metric">${report.summary.provided}/${report.summary.declaredTargets}</strong><span>declared targets with provider keys</span></article>
    <article class="metric"><strong id="vir-js-metric">${report.summary.virJs}</strong><span>ordinary vir_js boundaries</span></article>
    <article class="metric"><strong id="conversion-metric">${report.summary.explicitConversions}</strong><span>explicit conversions</span></article>
    <article class="metric ${report.summary.missingProvider === 0 ? "good" : "bad"}"><strong id="missing-metric">${report.summary.missingProvider}</strong><span>missing runtime provider keys</span></article>
  </section>
  <div class="scope"><b>Measured surface:</b> compiled <code>${report.lean.modules.join(", ")}</code> environments · ${report.summary.declarations} declarations · ${report.summary.boundaries.hostResource} host-resource boundaries · ${report.summary.boundaries.objectHandle} object-handle boundaries · ${report.summary.boundaries.explicitConversion} explicit conversions. A provider-key-present row proves that the declaration passes VIR's coarse compiler boundary policy and that a matching dispatch key exists. It does not verify provider modality or behavior, callback escape, affine use, or upstream API parity.</div>
  <section class="workspace">
    <div class="left">
      <div class="toolbar"><input id="search" type="search" placeholder="Search target, declaration, type…" aria-label="Search bindings"><select id="status"><option value="all">All statuses</option><option value="provided">Provider key present</option><option value="missing-provider">Missing provider key</option><option value="runtime-only">Runtime only</option></select></div>
      <div class="filters"><select id="provider"><option value="all">All providers</option>${report.providers.map((entry) => `<option value="${entry.id}">${entry.title}</option>`).join("")}</select><select id="boundary"><option value="all">All boundaries</option><option value="hostResource">Host resource</option><option value="explicitConversion">Explicit conversion</option><option value="objectHandle">Object handle</option></select><select id="visibility"><option value="all">All visibility</option><option value="public">Public import</option><option value="private">Private import</option></select></div>
      <div class="result-head" id="count"></div><div id="results"></div>
    </div>
    <article class="detail" id="detail"></article>
  </section>
</main>
<script id="report-data" type="application/json">${data}</script>
<script>
  const report = JSON.parse(document.querySelector("#report-data").textContent);
  const byTarget = new Map(report.bindings.map((entry) => [entry.target, entry]));
  const elements = Object.fromEntries(["search","status","provider","boundary","visibility","count","results","detail","theme"].map((id) => [id, document.querySelector("#" + id)]));
  let selected = decodeURIComponent(location.hash.replace(/^#target=/, ""));
  if (!byTarget.has(selected)) selected = report.bindings.find((entry) => entry.status === "missing-provider")?.target || report.bindings[0]?.target || "";
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>\"]/g, (character) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[character]));
  const statusLabel = (value) => value === "missing-provider" ? "missing provider key" : value === "runtime-only" ? "runtime only" : "provider key present";
  function matches(entry) {
    const query = elements.search.value.trim().toLowerCase();
    const text = [entry.target, entry.prefix, ...entry.providers, ...entry.boundaries, ...entry.declarations.flatMap((decl) => [decl.declaration, decl.module, decl.type])].join(" ").toLowerCase();
    return (!query || text.includes(query)) && (elements.status.value === "all" || entry.status === elements.status.value) && (elements.provider.value === "all" || entry.providers.includes(elements.provider.value)) && (elements.boundary.value === "all" || entry.boundaries.includes(elements.boundary.value)) && (elements.visibility.value === "all" || entry.visibility === elements.visibility.value);
  }
  function render() {
    const rows = report.bindings.filter(matches);
    elements.count.textContent = rows.length + (rows.length === 1 ? " binding" : " bindings");
    elements.results.innerHTML = rows.length === 0 ? '<div class="empty">No bindings match these filters.</div>' : rows.map((entry) => '<button type="button" class="row ' + (entry.target === selected ? "active" : "") + '" data-target="' + escapeHtml(entry.target) + '"><span><span class="target">' + escapeHtml(entry.target) + '</span><span class="sub">' + escapeHtml(entry.visibility) + " · " + escapeHtml(entry.boundaries.join(", ") || "runtime provider key") + '</span></span><span class="pill ' + entry.status + '">' + escapeHtml(statusLabel(entry.status)) + "</span></button>").join("");
    elements.results.querySelectorAll("[data-target]").forEach((button) => button.addEventListener("click", () => select(button.dataset.target)));
    renderDetail(byTarget.get(selected));
  }
  function select(target) { selected = target; history.replaceState(null, "", "#target=" + encodeURIComponent(target)); render(); }
  function renderDetail(entry) {
    if (!entry) { elements.detail.innerHTML = '<div class="empty">Select a binding.</div>'; return; }
    const providerBadges = entry.providers.length === 0 ? '<span class="badge">No shipped provider key</span>' : entry.providers.map((id) => '<span class="badge">' + escapeHtml(report.providers.find((provider) => provider.id === id)?.title || id) + "</span>").join("");
    const declarations = entry.declarations.length === 0 ? '<div class="empty">Runtime provider with no declaration in the measured Lean modules.</div>' : entry.declarations.map((decl) => { const source = decl.source?.path ? '<a class="source" href="../../' + escapeHtml(decl.source.path) + "#L" + decl.source.startLine + '">' + escapeHtml(decl.module) + ":" + decl.source.startLine + "</a>" : '<span class="source">' + escapeHtml(decl.module) + "</span>"; return '<div class="decl"><div class="decl-head"><span class="decl-name">' + escapeHtml(decl.declaration) + "</span>" + source + '</div><div class="badges"><span class="badge">' + (decl.private ? "private implementation" : "public import") + '</span><span class="badge">' + escapeHtml(decl.marker) + '</span><span class="badge">' + escapeHtml(decl.boundary) + '</span></div><code>' + escapeHtml(decl.type) + "</code></div>"; }).join("");
    elements.detail.innerHTML = '<span class="pill ' + entry.status + '">' + escapeHtml(statusLabel(entry.status)) + '</span><h2>' + escapeHtml(entry.target) + '</h2><div class="badges">' + providerBadges + '</div><section class="section"><h3>Compiler-validated Lean boundary</h3>' + declarations + "</section>";
  }
  [elements.search,elements.status,elements.provider,elements.boundary,elements.visibility].forEach((element) => element.addEventListener(element === elements.search ? "input" : "change", render));
  elements.theme.addEventListener("click", () => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "light" ? "dark" : "light"; });
  document.addEventListener("keydown", (event) => { if (event.key === "/" && document.activeElement !== elements.search) { event.preventDefault(); elements.search.focus(); } });
  render();
</script>
</body>
</html>
`;
}

export async function runShippedBindingsReportCli(argv) {
  const options = parseArgs(argv);
  if (options === null) return 0;
  const inventory = await readInventory(options.lean);
  const report = buildShippedBindingsReport(inventory, collectProviders());
  const outputOptions = {
    check: options.check,
    root,
    staleHint: "rerun the corresponding shipped-bindings generation step",
  };
  await Promise.all([
    emitGeneratedFile(options.out, `${JSON.stringify(report, null, 2)}\n`, outputOptions),
    emitGeneratedFile(options.html, renderShippedBindingsHtml(report), outputOptions),
  ]);

  if (report.summary.missingProvider !== 0 || report.summary.runtimeOnly !== 0) {
    throw new Error(
      `shipped binding reconciliation found ${report.summary.missingProvider} missing provider keys and ` +
        `${report.summary.runtimeOnly} runtime-only targets`,
    );
  }

  console.log("\nShipped VIR JavaScript bindings: compiler/runtime coverage");
  console.log(`  vir_js declarations: ${report.summary.virJs}`);
  console.log(`  explicit conversions: ${report.summary.explicitConversions}`);
  console.log(`  declared targets: ${report.summary.declaredTargets}`);
  console.log(`  provider keys present: ${report.summary.provided}`);
  console.log(`  missing provider keys: ${report.summary.missingProvider}`);
  console.log(`  runtime-only targets: ${report.summary.runtimeOnly}`);
  console.log(`  public entries reaching targets: ${report.summary.publicEntries}`);
  console.log(`  public entry/target edges: ${report.summary.publicTargetEdges}`);
  console.log(`  artifacts: ${options.check ? "validated" : "wrote"} ${relative(root, options.out)}`);
  console.log(`             ${options.check ? "validated" : "wrote"} ${relative(root, options.html)}`);
  return 0;
}
