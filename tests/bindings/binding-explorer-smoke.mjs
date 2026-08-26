#!/usr/bin/env node
/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const report = JSON.parse(await readFile("build/bindings/report.json", "utf8"));
const html = await readFile("build/bindings/index.html", "utf8");
const app = await readFile("build/bindings/assets/app.js", "utf8");
const style = await readFile("build/bindings/assets/style.css", "utf8");
const roots = report.libraries.flatMap((library) =>
  library.apiGroups.map((root) => ({ library: library.id, ...root })));
const targets = roots.flatMap((root) => root.bindings.map((binding) => binding.target));
const uniqueTargets = new Set(targets);
const publicEntries = new Map(report.publicEntries.map((entry) => [entry.declaration, entry]));
const publicTargetEdges = report.publicEntries.reduce(
  (sum, entry) => sum + entry.targets.length,
  0,
);
const reachedTargets = new Set(report.publicEntries.flatMap((entry) =>
  entry.targets.map((target) => target.target)));
const analysisCounts = countBy(roots.map((root) => root.analysis.status));
const comparisons = roots.flatMap((root) => root.comparison === undefined ? [] : [root.comparison]);
const semantic = Object.fromEntries(["exact", "compatible", "weak", "missing"].map((status) => [
  status,
  comparisons.reduce((sum, comparison) => sum + comparison.summary[status], 0),
]));
const coveredRoots = roots.filter((root) =>
  ["complete", "in-progress", "automatic"].includes(root.analysis.status));
const coverageMembers = coveredRoots.flatMap((root) => root.coverage.members);
const coverageStatuses = countBy(coverageMembers.map((member) => member.status));
const issueCounts = countBy(report.issues.map((issue) => issue.severity));
const generationMembers = roots.flatMap((root) => root.coverage?.members ?? []);
const dispositionCounts = countBy(generationMembers.map((member) =>
  member.generation.disposition));
const availabilityCounts = countBy(generationMembers.map((member) =>
  member.generation.availability));

assert.equal(report.format, "lean-vir-binding-explorer");
assert.equal(report.summary.libraries, report.libraries.length);
assert.equal(report.summary.apiGroups, roots.length);
assert.equal(targets.length, uniqueTargets.size, "every shipped target should occur exactly once");
assert.equal(report.summary.targets, uniqueTargets.size);
assert.equal(
  report.summary.provided,
  roots.reduce((sum, root) => sum + root.bindings.filter((binding) =>
    binding.status === "provided").length, 0),
);
assert.equal(report.summary.provided, report.summary.targets);
assert.equal(report.summary.missingProvider, 0);
assert.equal(report.summary.runtimeOnly, 0);
assert.deepEqual(report.summary.publicSurface, {
  entries: publicEntries.size,
  targetEdges: publicTargetEdges,
  reachedTargets: reachedTargets.size,
});
assert.equal(reachedTargets.size, uniqueTargets.size);
assert.deepEqual(report.summary.analysis, {
  externalGroups: roots.length - (analysisCounts["not-applicable"] ?? 0),
  complete: analysisCounts.complete ?? 0,
  inProgress: analysisCounts["in-progress"] ?? 0,
  automatic: analysisCounts.automatic ?? 0,
  curated: analysisCounts.curated ?? 0,
  needsInput: analysisCounts["needs-input"] ?? 0,
  notRun: analysisCounts["not-run"] ?? 0,
  notApplicable: analysisCounts["not-applicable"] ?? 0,
});
assert.deepEqual(report.summary.semantic, semantic);
assert.equal(
  report.summary.upstreamSymbols,
  roots.reduce((sum, root) => sum + (root.typescript?.symbols.length ?? 0), 0),
);
assert.deepEqual(report.summary.coverage, {
  groups: coveredRoots.length,
  members: coverageMembers.length,
  reviewed: (coverageStatuses.exact ?? 0) + (coverageStatuses.compatible ?? 0) +
    (coverageStatuses.weak ?? 0),
  unreviewed: coverageStatuses.unreviewed ?? 0,
  suggested: coverageStatuses.suggested ?? 0,
  ambiguous: coverageStatuses.ambiguous ?? 0,
  missing: coverageStatuses.missing ?? 0,
});
assert.deepEqual(report.summary.issues, {
  error: issueCounts.error ?? 0,
  warning: issueCounts.warning ?? 0,
  gap: issueCounts.gap ?? 0,
});
assert.deepEqual(report.summary.generation, {
  boundaries: {
    operations: roots.reduce((sum, root) => sum + (root.generatedOperations?.length ?? 0), 0),
    targets: new Set(roots.flatMap((root) =>
      (root.generatedOperations ?? []).map((operation) => operation.host.target))).size,
    typescriptDerived: roots.reduce((sum, root) =>
      sum + (root.generatedOperations ?? []).filter((operation) =>
        operation.typescript.kind !== "protocol").length, 0),
    reviewedProtocols: roots.reduce((sum, root) =>
      sum + (root.generatedOperations ?? []).filter((operation) =>
        operation.typescript.kind === "protocol").length, 0),
    handwrittenDeclarations: 0,
  },
  disposition: {
    generated: dispositionCounts.generated ?? 0,
    "needs-annotation": dispositionCounts["needs-annotation"] ?? 0,
    unsupported: dispositionCounts.unsupported ?? 0,
    "not-selected": dispositionCounts["not-selected"] ?? 0,
  },
  availability: {
    available: availabilityCounts.available ?? 0,
    candidate: availabilityCounts.candidate ?? 0,
    "not-provided": availabilityCounts["not-provided"] ?? 0,
  },
  workItems: report.workItems.length,
});
assert.equal(report.summary.generation.boundaries.targets, report.summary.targets);
assert.equal(
  report.summary.generation.boundaries.typescriptDerived +
    report.summary.generation.boundaries.reviewedProtocols,
  report.summary.generation.boundaries.operations,
);
assert.ok(report.summary.generation.disposition.generated > 0);
assert.ok(report.summary.generation.disposition["not-selected"] > 0);
assert.ok(report.workItems.every((item) =>
  typeof item.code === "string" && typeof item.action === "string"));
assert.equal(publicEntries.has("Lean.Vir.Browser.Document.getTitleString"), false);
assert.equal(publicEntries.has("Lean.Vir.Browser.Document.setTitleString"), false);
assert.equal(publicEntries.has("Lean.Vir.Browser.Element.getInnerHTMLString"), false);
assert.equal(publicEntries.has("Lean.Vir.Browser.Element.setInnerHTMLString"), false);
assert.equal(publicEntries.has("Lean.Vir.Browser.Element.getTextContentString"), false);
assert.equal(publicEntries.has("Lean.Vir.Browser.Element.setTextContentString"), false);
for (const [declaration, expectedType] of [
  [
    "Lean.Vir.Browser.Element.getInnerHTML",
    "Lean.Vir.Js Lean.Vir.Browser.Element → Lean.Vir.Browser.DomM (Lean.Vir.Js String)",
  ],
  [
    "Lean.Vir.Browser.Element.setInnerHTML",
    "Lean.Vir.Js Lean.Vir.Browser.Element → Lean.Vir.Js String → Lean.Vir.Browser.DomM Unit",
  ],
  [
    "Lean.Vir.Browser.Element.getTextContent",
    "Lean.Vir.Js Lean.Vir.Browser.Element → Lean.Vir.Browser.DomM (Lean.Vir.Js String)",
  ],
  [
    "Lean.Vir.Browser.Element.setTextContent",
    "Lean.Vir.Js Lean.Vir.Browser.Element → Lean.Vir.Js.Nullable String → Lean.Vir.Browser.DomM Unit",
  ],
]) {
  assert.equal(
    publicEntries.get(declaration)?.type,
    expectedType,
    `${declaration} must preserve its faithful JavaScript-boundary type`,
  );
}
assert.deepEqual(
  publicEntries.get("Lean.Vir.Browser.HTMLCanvasElement.getContext2D")?.targets.find(
    (entry) => entry.target === "browser.htmlCanvasElement.getContext2D",
  )?.path,
  [
    "Lean.Vir.Browser.HTMLCanvasElement.getContext2D",
    "Lean.Vir.Browser.HTMLCanvasElement.getContext2DNullable",
  ],
);

const documentRoot = roots.find((root) => root.library === "browser" && root.id === "document");
assert.deepEqual(documentRoot?.analysis, {
  status: "complete",
  scope: "complete-upstream-surface",
});
assert.equal(documentRoot?.findingStatus, "gap");
assert.deepEqual(documentRoot?.upstream.roots, ["Document"]);
assert.ok(documentRoot?.bindings.some((binding) => binding.target === "browser.document.getTitle"));
assert.deepEqual(documentRoot?.comparison.summary, {
  exact: 0,
  compatible: 5,
  weak: 0,
  missing: 0,
});
assert.deepEqual(documentRoot?.coverage.summary, {
  exact: 0,
  compatible: 4,
  weak: 0,
  missing: 267,
  unreviewed: 0,
  mappedTargets: 5,
});
const documentTitle = documentRoot?.coverage.members.find((member) => member.id === "Document.title");
assert.equal(documentTitle?.status, "compatible");
assert.deepEqual(documentTitle?.generation, {
  disposition: "generated",
  provenance: "generator",
  availability: "available",
  targets: ["browser.document.getTitle", "browser.document.setTitle"],
  diagnostics: [],
});
const documentTitleGetter = documentRoot?.comparison.results.find(
  (result) => result.id === "document.title.get",
);
assert.equal(documentTitleGetter?.modalityContract.profile, "browser-dom-faithful-v1");
assert.equal(documentTitleGetter?.modalityContract.receiver.kind, "global");
assert.deepEqual(documentTitleGetter?.modalityContract.result.modalities, {
  representation: "js-resource",
  ownership: "owned",
});
assert.deepEqual(documentTitle?.mapping.targets, [
  "browser.document.getTitle",
  "browser.document.setTitle",
]);
assert.deepEqual(
  documentRoot?.coverage.targetMappings.filter((mapping) =>
    mapping.typescript === "Document.title"),
  [
    {
      target: "browser.document.getTitle",
      status: "compatible",
      source: "reviewed",
      typescript: "Document.title",
      lean: ["Lean.Vir.Browser.Document.getTitle"],
      anchors: ["document.title.get"],
      accessor: "get",
    },
    {
      target: "browser.document.setTitle",
      status: "compatible",
      source: "reviewed",
      typescript: "Document.title",
      lean: ["Lean.Vir.Browser.Document.setTitle"],
      anchors: ["document.title.set"],
      accessor: "set",
    },
  ],
);
const documentQuerySelector = documentRoot?.coverage.members.find(
  (member) => member.id === "Document.querySelector",
);
assert.equal(documentQuerySelector?.inheritedFrom, "ParentNode");
assert.equal(documentQuerySelector?.status, "compatible");
assert.equal(documentQuerySelector?.generation.disposition, "generated");
assert.equal(documentQuerySelector?.generation.provenance, "generator");
assert.equal(documentQuerySelector?.generation.availability, "available");

const elementRoot = roots.find((root) => root.library === "browser" && root.id === "element");
assert.deepEqual(elementRoot?.analysis, {
  status: "complete",
  scope: "complete-upstream-surface",
});
assert.deepEqual(elementRoot?.comparison.summary, {
  exact: 0,
  compatible: 4,
  weak: 0,
  missing: 0,
});
assert.deepEqual(elementRoot?.coverage.summary, {
  exact: 0,
  compatible: 14,
  weak: 0,
  missing: 728,
  unreviewed: 0,
  mappedTargets: 16,
});
const elementInnerHTML = elementRoot?.coverage.members.find(
  (member) => member.id === "Element.innerHTML",
);
const elementGetAttribute = elementRoot?.coverage.members.find(
  (member) => member.id === "Element.getAttribute",
);
assert.equal(elementGetAttribute?.generation.disposition, "generated");
assert.equal(elementGetAttribute?.generation.availability, "available");
const generatedGetAttribute = elementRoot?.generatedOperations.find((operation) =>
  operation.typescript.member === "Element.getAttribute");
assert.equal(generatedGetAttribute?.typescript.signaturePolicy.selection, "only");
assert.match(generatedGetAttribute?.typescript.documentation, /MDN Reference/u);
assert.equal(generatedGetAttribute?.arguments[0].type, "Lean.Vir.Js String");
assert.equal(generatedGetAttribute?.result.lean, "Lean.Vir.Js.Nullable String");
const generatedAddEventListener = elementRoot?.generatedOperations.find((operation) =>
  operation.typescript.member === "Element.addEventListener");
const generatedRemoveEventListener = elementRoot?.generatedOperations.find((operation) =>
  operation.typescript.member === "Element.removeEventListener");
assert.equal(generatedAddEventListener?.arguments[1].role, "callback");
assert.equal(generatedAddEventListener?.arguments[1].modalities.retention, "until-release");
assert.equal(generatedAddEventListener?.result.lean, "Lean.Vir.Js EventListener");
assert.equal(generatedRemoveEventListener?.receiver.kind, "none");
assert.deepEqual(
  generatedRemoveEventListener?.typescript.signaturePolicy.omittedRequiredParameters,
  ["type"],
);
assert.equal(generatedRemoveEventListener?.arguments[0].modalities.passing, "consumed");
assert.match(app, /function highlightCode/u);
assert.match(app, /Generated conversion policy/u);
assert.match(style, /\.tok-keyword/u);
assert.match(style, /\.generation-policy/u);

const canvasRoot = roots.find((root) => root.library === "browser" && root.id === "canvas-2d");
const canvasFillStyle = canvasRoot?.coverage.members.find((member) =>
  member.id === "CanvasRenderingContext2D.fillStyle");
const generatedFillStyle = canvasRoot?.generatedOperations.find((operation) =>
  operation.typescript.member === "CanvasRenderingContext2D.fillStyle");
assert.equal(canvasFillStyle?.status, "missing");
assert.equal(canvasFillStyle?.generation.disposition, "generated");
assert.equal(canvasFillStyle?.mapping.operations[0].missing, true);
assert.equal(canvasFillStyle?.mapping.operations[1].accessor, "set");
assert.ok(canvasRoot?.workItems.some((item) =>
  item.member === "CanvasRenderingContext2D.fillStyle" &&
  item.code === "upstream-accessor-missing" && item.accessor === "get"));
assert.equal(generatedFillStyle?.receiver.argument.name, "ctx");
assert.equal(generatedFillStyle?.arguments[0].name, "style");
assert.equal(generatedFillStyle?.arguments[0].type, "Lean.Vir.Js String");
assert.match(generatedFillStyle?.exception.reason, /string arm/u);

const canvasElementRoot = roots.find((root) =>
  root.library === "browser" && root.id === "canvas-element");
const generatedContext2D = canvasElementRoot?.generatedOperations.find((operation) =>
  operation.typescript.member === "HTMLCanvasElement.getContext");
assert.deepEqual(generatedContext2D?.typescript.signaturePolicy.fixedArguments, {
  contextId: "2d",
});
assert.deepEqual(generatedContext2D?.arguments, []);
assert.equal(generatedContext2D?.receiver.argument.name, "canvas");
assert.equal(generatedContext2D?.result.lean, "Lean.Vir.Js.Nullable CanvasRenderingContext2D");
const elementTextContent = elementRoot?.coverage.members.find(
  (member) => member.id === "Element.textContent",
);
assert.equal(elementTextContent?.status, "compatible");
assert.equal(elementTextContent?.generation.disposition, "generated");
assert.deepEqual(elementTextContent?.mapping.targets, [
  "browser.element.getTextContent",
  "browser.element.setTextContent",
]);
assert.deepEqual(
  elementRoot?.coverage.targetMappings.filter((mapping) =>
    mapping.typescript === "Element.textContent"),
  [
    {
      target: "browser.element.getTextContent",
      status: "compatible",
      source: "reviewed",
      typescript: "Element.textContent",
      lean: ["Lean.Vir.Browser.Element.getTextContent"],
      anchors: ["element.textContent.get"],
      accessor: "get",
    },
    {
      target: "browser.element.setTextContent",
      status: "compatible",
      source: "reviewed",
      typescript: "Element.textContent",
      lean: ["Lean.Vir.Browser.Element.setTextContent"],
      anchors: ["element.textContent.set"],
      accessor: "set",
    },
  ],
);
assert.equal(elementInnerHTML?.status, "compatible");
assert.equal(elementInnerHTML?.generation.disposition, "generated");
assert.deepEqual(elementInnerHTML?.mapping.targets, [
  "browser.element.getInnerHTML",
  "browser.element.setInnerHTML",
]);
assert.deepEqual(
  elementRoot?.coverage.targetMappings.filter((mapping) =>
    mapping.typescript === "Element.innerHTML"),
  [
    {
      target: "browser.element.getInnerHTML",
      status: "compatible",
      source: "reviewed",
      typescript: "Element.innerHTML",
      lean: ["Lean.Vir.Browser.Element.getInnerHTML"],
      anchors: ["element.innerHTML.get"],
      accessor: "get",
    },
    {
      target: "browser.element.setInnerHTML",
      status: "compatible",
      source: "reviewed",
      typescript: "Element.innerHTML",
      lean: ["Lean.Vir.Browser.Element.setInnerHTML"],
      anchors: ["element.innerHTML.set"],
      accessor: "set",
    },
  ],
);

const canvasElement = roots.find((root) =>
  root.library === "browser" && root.id === "canvas-element");
assert.deepEqual(canvasElement?.analysis, {
  status: "in-progress",
  scope: "complete-upstream-surface",
});
assert.equal(canvasElement?.findingStatus, "gap");
assert.deepEqual(canvasElement?.summary, { bindings: 6, provided: 6, issues: 1 });
assert.deepEqual(canvasElement?.coverage.summary, {
  exact: 0,
  compatible: 3,
  weak: 0,
  missing: 330,
  unreviewed: 0,
  mappedTargets: 6,
});
assert.ok(canvasElement?.generatedOperations.some((operation) =>
  operation.id === "browser.htmlCanvasElement.getContext2D" &&
  operation.typescript.kind === "method"));
assert.ok(canvasElement?.generatedOperations.some((operation) =>
  operation.id === "browser.canvas.fromElement" &&
  operation.typescript.kind === "protocol"));

const localCommands = roots.find((root) =>
  root.library === "infoview" && root.id === "commands");
assert.deepEqual(localCommands?.analysis, {
  status: "needs-input",
  scope: "local-upstream-contract-missing",
});
assert.ok(localCommands?.bindings.some((binding) =>
  binding.target === "infoview.command.insertText"));
assert.ok(localCommands?.workItems.some((item) =>
  item.code === "local-upstream-contract-required"));

const reactDomRoot = roots.find((root) => root.library === "react" && root.id === "react-dom-root");
assert.deepEqual(reactDomRoot?.analysis, {
  status: "complete",
  scope: "complete-upstream-surface",
});
assert.equal(reactDomRoot?.findingStatus, "warning");
assert.deepEqual(reactDomRoot?.comparison.summary, {
  exact: 0,
  compatible: 3,
  weak: 1,
  missing: 3,
});
assert.equal(
  reactDomRoot?.comparison.results.find((result) => result.id === "react_dom.root.create")?.target,
  "react.root.create",
);
assert.deepEqual(
  reactDomRoot?.comparison.results.find((result) =>
    result.id === "react_dom.root.resource")?.advisorySemantics,
  [
    { topic: "ownership", note: "The host is expected to own the root resource." },
    { topic: "lifetime", note: "The root is expected to remain live until unmount or runtime disposal." },
  ],
);
assert.ok(reactDomRoot?.comparison.results.some((result) =>
  result.id === "react_dom.hydration.entrypoint" &&
  result.status === "missing" &&
  result.portIntent.disposition === "unsupported"));

assert.match(html, /<h1>Binding reference<\/h1>/u);
assert.match(html, /id="available-metric"/u);
assert.match(html, /id="direct-metric"/u);
assert.match(html, /id="search" type="search"/u);
assert.match(html, /VIR binding reference/u);
assert.match(html, /Binding workbench/u);
assert.doesNotMatch(html, /Complete surface analysis/u);
assert.doesNotMatch(html, /Public Lean API/u);
assert.doesNotMatch(html, /Host targets/u);
assert.match(app, /Expected versus current/u);
assert.match(html, /src="assets\/app\.js"/u);
assert.match(html, /href="assets\/style\.css"/u);
assert.match(app, /function renderUpstreamSymbol\(group, symbol\)/u);
assert.match(style, /\.workspace/u);
assert.match(app, /Required action/u);
assert.match(app, /Unselected upstream entries are documentation coverage/u);
assert.match(style, /\.work-item/u);
const dataMatch = html.match(/<script id="report-data" type="application\/json">([\s\S]*?)<\/script>/u);
assert.ok(dataMatch, "explorer should embed its machine report");
assert.deepEqual(JSON.parse(dataMatch[1]).summary, report.summary);
Function(app);

console.log(
  `binding explorer smoke ok: ${report.summary.libraries} libraries, ` +
  `${report.summary.apiGroups} API groups, ${report.summary.upstreamSymbols} upstream symbols, ` +
  `${report.summary.targets} unique targets`,
);

function countBy(values) {
  const counts = {};
  for (const value of values) counts[value] = (counts[value] ?? 0) + 1;
  return counts;
}
