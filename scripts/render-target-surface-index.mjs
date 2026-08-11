/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { classifySurfaceBoundary } from "./surface-boundary-family.mjs";
import {
  hasCompleteBlockerFrontier,
  validateSurfaceReport,
} from "./surface-report-schema.mjs";

const [outputArg, ...reportArgs] = process.argv.slice(2);
if (!outputArg || reportArgs.length === 0 || reportArgs.length % 3 !== 0) {
  console.error(
    "usage: render-target-surface-index.mjs <output-directory> "
      + "<slug> <label> <surface.json> [<slug> <label> <surface.json> ...]",
  );
  process.exit(2);
}

const reports = [];
const slugs = new Set();
for (let index = 0; index < reportArgs.length; index += 3) {
  const [slug, label, pathArg] = reportArgs.slice(index, index + 3);
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) throw new Error(`invalid report slug ${JSON.stringify(slug)}`);
  if (slugs.has(slug)) throw new Error(`duplicate report slug ${JSON.stringify(slug)}`);
  slugs.add(slug);
  const report = JSON.parse(await readFile(resolve(pathArg), "utf8"));
  validateSurfaceReport(report, { label: pathArg });
  const completeFrontier = hasCompleteBlockerFrontier(report);
  const blockers = completeFrontier ? report.reachableBlockers : report.primaryBlockers;
  const externByName = new Map((report.externs ?? []).map((extern) => [extern.name, extern]));
  const families = new Map();
  for (const summary of blockers) {
    const extern = externByName.get(summary.blocker.name);
    const family = classifySurfaceBoundary(summary.blocker.name, extern?.module ?? "");
    families.set(family, (families.get(family) ?? 0) + 1);
  }
  reports.push({
    slug,
    label,
    report,
    blockers,
    completeFrontier,
    blockerNames: new Set(blockers.map((summary) => summary.blocker.name)),
    families,
  });
}

const comparisonReports = reports.filter((entry) =>
  entry.completeFrontier && (entry.report.selectedDeclarations ?? []).length > 0);
const compared = comparisonReports;
const allFamilies = [...new Set(compared.flatMap((entry) => [...entry.families.keys()]))]
  .sort((lhs, rhs) => {
    const lhsCount = compared.reduce((sum, entry) => sum + (entry.families.get(lhs) ?? 0), 0);
    const rhsCount = compared.reduce((sum, entry) => sum + (entry.families.get(rhs) ?? 0), 0);
    return rhsCount - lhsCount || compareText(lhs, rhs);
  });
const shared = compared.length < 2
  ? []
  : [...compared[0].blockerNames]
    .filter((name) => compared.slice(1).every((entry) => entry.blockerNames.has(name)))
    .sort(compareText);
const maxFamilyCount = Math.max(
  1,
  ...compared.flatMap((entry) => [...entry.families.values()]),
);

const reportCards = reports.map((entry) => {
  const selected = entry.report.selectedDeclarations ?? [];
  const focused = selected.length > 0;
  const unmetExterns = (entry.report.externs ?? [])
    .filter((extern) => extern.status === "missing" || extern.status === "incompatible").length;
  const unique = compared.length >= 2 && compared.includes(entry)
    ? [...entry.blockerNames]
      .filter((name) => compared.every((other) => other === entry || !other.blockerNames.has(name))).length
    : "—";
  const metrics = focused
    ? [
        [entry.completeFrontier ? "Current blockers" : "Primary blockers", entry.blockers.length],
        ["Unmet externs", unmetExterns],
        ["Reachable nodes", entry.report.closure?.rootReachableNodes ?? "—"],
        ["Unique here", unique],
      ]
    : [
        ["Blocked functions", entry.report.counts.blocked],
        ["Unmet externs", unmetExterns],
        ["Modules", entry.report.selectedModules.length],
      ];
  return `
    <article class="report-card">
      <p class="eyebrow">${entry.completeFrontier ? "Selected target · complete frontier" : focused ? "Selected target · primary blockers" : "Complete libraries · primary blockers"} · Lean ${escapeHtml(entry.report.lean.version)}</p>
      <h2><a href="${escapeHtml(entry.slug)}/">${escapeHtml(entry.label)}</a></h2>
      <code>${escapeHtml(selected.join(", ") || `${entry.report.selectedModules.length} installed modules`)}</code>
      <dl>
        ${metrics.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${formatMetric(value)}</dd></div>`).join("")}
      </dl>
      <a class="open-report" href="${escapeHtml(entry.slug)}/">Open boundary explorer <span>→</span></a>
    </article>`;
}).join("");

const familyRows = allFamilies.map((family) => `
  <tr>
    <th scope="row">${escapeHtml(family)}</th>
    ${compared.map((entry) => {
      const count = entry.families.get(family) ?? 0;
      const width = Math.round((count / maxFamilyCount) * 100);
      return `<td><span class="bar" style="--bar:${width}%"><i></i><b>${formatNumber(count)}</b></span></td>`;
    }).join("")}
  </tr>`).join("");

const sharedSummary = compared.length < 2
  ? "Add another selected-target analysis with a complete frontier to compare boundary families."
  : `${formatNumber(shared.length)} blocker${shared.length === 1 ? " is" : "s are"} shared by every target. `
    + "Distinct-boundary counts make the largest reusable runtime gaps visible at a glance.";

const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="color-scheme" content="light dark">
    <title>VIR analysis explorer</title>
    <style>
      :root { color-scheme: light; --bg:#f5f7f8; --panel:#fff; --text:#172126; --muted:#627078; --line:#d8e0e3; --accent:#176b67; --soft:#dff1ef; font:16px/1.5 Inter,system-ui,sans-serif; }
      * { box-sizing:border-box; } body { margin:0; color:var(--text); background:var(--bg); }
      header { padding:3rem max(1.25rem,calc((100vw - 72rem)/2)); color:#f8ffff; background:linear-gradient(128deg,#123d42,#176b67 68%,#225a62); }
      h1 { margin:.25rem 0; font-size:clamp(2rem,5vw,3.4rem); letter-spacing:-.04em; } header p:last-child { max-width:46rem; margin:0; color:#cce7e3; }
      .eyebrow { margin:0; color:#39847e; font-size:.72rem; font-weight:760; letter-spacing:.1em; text-transform:uppercase; }
      header .eyebrow { color:#aee0d7; } main { max-width:72rem; margin:auto; padding:2rem 1.25rem 4rem; }
      .reports { display:grid; grid-template-columns:repeat(auto-fit,minmax(17rem,1fr)); gap:1rem; }
      .report-card { padding:1.2rem; border:1px solid var(--line); border-radius:.8rem; background:var(--panel); box-shadow:0 8px 24px rgb(24 42 49 / 6%); }
      h2 { margin:.2rem 0; font-size:1.3rem; } h2 a { color:inherit; text-decoration:none; } code { color:var(--muted); overflow-wrap:anywhere; font-size:.78rem; }
      dl { display:grid; grid-template-columns:repeat(auto-fit,minmax(6.5rem,1fr)); gap:.55rem; margin:1.15rem 0; } dl div { padding:.65rem; border-radius:.55rem; background:var(--bg); }
      dt { color:var(--muted); font-size:.65rem; font-weight:700; text-transform:uppercase; } dd { margin:.15rem 0 0; font-size:1.25rem; font-weight:760; }
      .open-report { display:flex; justify-content:space-between; padding:.65rem .8rem; color:var(--accent); border-radius:.5rem; background:var(--soft); font-weight:700; text-decoration:none; }
      .comparison { margin-top:2rem; overflow:hidden; border:1px solid var(--line); border-radius:.8rem; background:var(--panel); }
      .comparison-heading { padding:1rem 1.2rem; border-bottom:1px solid var(--line); } .comparison-heading h2 { margin:0; } .comparison-heading p { margin:.2rem 0 0; color:var(--muted); }
      .table-wrap { overflow:auto; } table { width:100%; border-collapse:collapse; font-size:.82rem; } th,td { min-width:12rem; padding:.7rem .85rem; border-bottom:1px solid var(--line); text-align:left; }
      thead th { color:var(--muted); font-size:.68rem; text-transform:uppercase; } tbody tr:last-child > * { border-bottom:0; }
      .bar { display:grid; grid-template-columns:minmax(5rem,1fr) 2.2rem; align-items:center; gap:.6rem; } .bar i { height:.48rem; border-radius:99px; background:linear-gradient(90deg,var(--accent) var(--bar),var(--soft) var(--bar)); } .bar b { text-align:right; font-variant-numeric:tabular-nums; }
      @media(max-width:600px) { header { padding-top:2rem; } dl { grid-template-columns:1fr; } th,td { min-width:10rem; } }
      @media(prefers-color-scheme:dark) { :root { color-scheme:dark; --bg:#101618; --panel:#172024; --text:#e9f0f1; --muted:#a4b1b6; --line:#344247; --accent:#69c9bb; --soft:#183a38; } }
    </style>
  </head>
  <body>
    <header>
      <p class="eyebrow">VIR Boundary Explorer</p>
      <h1>Analysis explorer</h1>
      <p>Browse VIR's complete installed-Lean surface or inspect exact project entry points captured with their own toolchains.</p>
    </header>
    <main>
      <section class="reports" aria-label="Available analyses">${reportCards}
      </section>
      <section class="comparison">
        <div class="comparison-heading"><h2>Where runtime work overlaps</h2><p>${escapeHtml(sharedSummary)} Families are name-based navigation groups, not analysis inputs.</p></div>
        <div class="table-wrap"><table>
          <thead><tr><th scope="col">Boundary family (distinct boundaries)</th>${compared.map((entry) => `<th scope="col">${escapeHtml(entry.label)}</th>`).join("")}</tr></thead>
          <tbody>${familyRows}</tbody>
        </table></div>
      </section>
    </main>
  </body>
</html>
`;

const outputDir = resolve(outputArg);
await mkdir(outputDir, { recursive: true });
await writeFile(join(outputDir, "index.html"), html);
console.log(`rendered ${reports.length} explorer reports to ${join(outputDir, "index.html")}`);

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function formatNumber(value) {
  return new Intl.NumberFormat("en-US").format(value);
}

function formatMetric(value) {
  return typeof value === "number" ? formatNumber(value) : escapeHtml(value);
}

function compareText(lhs, rhs) {
  return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
}
