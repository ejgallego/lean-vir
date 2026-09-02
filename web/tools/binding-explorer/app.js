/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

const report = JSON.parse(document.querySelector("#report-data").textContent);
const generation = report.summary.generation;

document.querySelector("#catalog-metric").textContent = String(
  Object.values(generation.availability).reduce((sum, count) => sum + count, 0),
);
document.querySelector("#available-metric").textContent = String(
  generation.availability.available,
);
document.querySelector("#generated-metric").textContent = String(
  generation.boundaries.targets,
);
document.querySelector("#direct-metric").textContent = String(
  generation.boundaries.typescriptDerived,
);
document.querySelector("#work-metric").textContent = String(generation.workItems);
document.querySelector("#work-card").classList.add(
  generation.workItems === 0 ? "good" : "warn",
);

document.querySelector("#scope").replaceChildren(
  Object.assign(document.createElement("b"), { textContent: "Documented source: " }),
  document.createTextNode(
    `${report.summary.libraries} configured libraries · ` +
    `${report.summary.apiGroups} API groups · ` +
    `${report.summary.targets} compiled host targets, ` +
    `${report.summary.provided} with runtime provider keys present. ` +
    `${generation.boundaries.targets} are generated and ` +
    `${generation.boundaries.handwrittenDeclarations} declarations are handwritten: ` +
    `${generation.boundaries.typescriptDerived} boundaries are TypeScript-derived and ` +
    `${generation.boundaries.reviewedProtocols} are policy-authored VIR protocols ` +
    `(${generation.protocolRelations.upstreamAdapters} upstream adapters, ` +
    `${generation.protocolRelations.virOwned} VIR-owned operations, ` +
    `${generation.protocolRelations.localContracts} local-contract operations, ` +
    `${generation.protocolRelations.unclassified} unclassified). ` +
    `${generation.semanticRelations.preserving} contracts claim semantics preservation, ` +
    `${generation.semanticRelations.changing} are explicit semantic adapters, and ` +
    `${generation.semanticRelations.unreviewed} require semantic review. ` +
    `${generation.hostPolicies.exactValueTransport} operations transport exact JavaScript values, ` +
    `${generation.hostPolicies.namedSemanticAdapters} are named semantic adapters, and ` +
    `${Object.values(generation.hostPolicies.activeEffects).reduce((sum, count) => sum + count, 0)} ` +
    "operations register, use, or release private active-effect teardown records. " +
    "Provider behavior is not mechanically verified by this name reconciliation. " +
    "Unselected upstream entries are documentation coverage, not binding defects.",
  ),
);

const escapeHtml = (value) => String(value ?? "").replace(
  /[&<>"]/gu,
  (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character],
);
const tokenPattern = /\s+|--[^\n]*|\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|[A-Za-z_][A-Za-z0-9_']*(?:\.[A-Za-z_][A-Za-z0-9_']*)*|\d+(?:\.\d+)?|=>|->|←|→|:=|::|@&|[?@&|:=<>{}()[\],.;*+\-/]/gu;
const keywords = {
  typescript: new Set(["interface", "extends", "readonly", "keyof", "typeof", "new", "get", "set", "declare"]),
  lean: new Set(["def", "opaque", "private", "namespace", "end", "where", "do", "match", "with", "let", "if", "then", "else"]),
};
const primitiveTypes = {
  typescript: new Set(["string", "number", "bigint", "boolean", "void", "null", "undefined", "unknown", "any", "never"]),
  lean: new Set(["String", "Unit", "Nat", "Int", "Bool", "Float", "DomM", "Option"]),
};

function tokenClass(token, language) {
  if (/^\s+$/u.test(token)) return null;
  if (/^(?:--|\/\/|\/\*)/u.test(token)) return "comment";
  if (/^"/u.test(token) || /^\d/u.test(token)) return "literal";
  if (keywords[language].has(token)) return "keyword";
  if (language === "lean" && /^(?:Lean\.Vir\.)?Js(?:\.[A-Za-z][A-Za-z0-9_']*)?$/u.test(token)) {
    return "representation";
  }
  if (language === "lean" && /(?:^|\.)(?:DomM|RuntimeM|ReactM)$/u.test(token)) return "effect";
  if (primitiveTypes[language].has(token) ||
      (language === "lean" && /(?:^|\.)[A-Z][A-Za-z0-9_']*$/u.test(token))) return "type";
  if (/^[A-Za-z_]/u.test(token)) return token.includes(".") ? "qualified" : "identifier";
  if (/^(?:=>|->|←|→|:=|::|@&|[?@&|:=*+\-/])$/u.test(token)) return "operator";
  return "punctuation";
}

function highlightCode(value, language) {
  const source = String(value ?? "");
  let cursor = 0;
  let output = "";
  for (const match of source.matchAll(tokenPattern)) {
    output += escapeHtml(source.slice(cursor, match.index));
    const token = match[0];
    const classification = tokenClass(token, language);
    output += classification === null
      ? escapeHtml(token)
      : '<span class="tok tok-' + classification + '">' + escapeHtml(token) + "</span>";
    cursor = match.index + token.length;
  }
  return output + escapeHtml(source.slice(cursor));
}

function renderCode(value, language) {
  return '<pre class="code code-' + language + '"><code>' +
    highlightCode(value, language) + "</code></pre>";
}

function renderDocumentation(value, fallback = "No upstream declaration documentation.") {
  const source = String(value || fallback);
  const inline = (paragraph) => {
    const pattern = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)|`([^`]+)`|\*\*([^*]+)\*\*/gu;
    let cursor = 0;
    let output = "";
    for (const match of paragraph.matchAll(pattern)) {
      output += escapeHtml(paragraph.slice(cursor, match.index));
      if (match[1] !== undefined) {
        output += '<a href="' + escapeHtml(match[2]) +
          '" target="_blank" rel="noreferrer">' + escapeHtml(match[1]) + "</a>";
      } else if (match[3] !== undefined) {
        output += "<code>" + escapeHtml(match[3]) + "</code>";
      } else {
        output += "<strong>" + escapeHtml(match[4]) + "</strong>";
      }
      cursor = match.index + match[0].length;
    }
    return output + escapeHtml(paragraph.slice(cursor)).replaceAll("\n", "<br>");
  };
  return '<div class="documentation">' + source.split(/\n\s*\n/gu)
    .map((paragraph) => "<p>" + inline(paragraph) + "</p>").join("") + "</div>";
}

const dispositionLabel = (value) => ({
  generated: "generated",
  adapted: "reviewed protocol",
  "needs-annotation": "needs annotation",
  unsupported: "unsupported",
  "not-selected": "not selected",
})[value] ?? value;
const availabilityLabel = (value) => ({
  available: "VIR binding available",
  candidate: "correspondence not confirmed",
  "not-provided": "not provided",
})[value] ?? value;
const evidenceLabel = (value) => ({
  exact: "exact comparator match",
  compatible: "comparator-compatible",
  derived: "TypeScript-derived",
  "protocol-linked": "reviewed protocol link",
  "contract-linked": "local contract link",
  weak: "limited comparison",
  unreviewed: "not compared",
  suggested: "suggested correspondence",
  ambiguous: "ambiguous correspondence",
  missing: "no confirmed binding",
})[value] ?? value;
const boundaryEvidence = (operation) => operation === null || operation === undefined
  ? "unclassified"
  : operation.typescript.kind !== "protocol"
    ? "typescript-derived"
    : operation.protocol?.upstreamRelation.kind ?? "unclassified";
const boundaryEvidenceLabel = (value) => ({
  "typescript-derived": "TypeScript-derived",
  "upstream-adapter": "reviewed upstream adapter",
  "vir-owned": "VIR-owned protocol",
  "local-contract": "local contract protocol",
  unclassified: "unclassified protocol",
})[value] ?? value;
const semanticRelation = (operation) => operation?.semantics?.relation ?? "unreviewed";
const semanticRelationLabel = (value) => ({
  preserving: "semantics-preserving contract",
  changing: "explicit semantic adapter",
  unreviewed: "semantic review required",
  "vir-owned": "VIR-owned semantics",
  "local-contract": "local contract semantics",
})[value] ?? value;

function operationsForSymbol(group, symbol) {
  return (group.generatedOperations ?? []).filter((operation) =>
    operation.typescript.member === symbol.id ||
    operation.protocol?.upstreamRelation.member === symbol.id);
}

function combinedSemanticRelation(operations) {
  const relations = new Set(operations.map(semanticRelation));
  if (relations.has("unreviewed")) return "unreviewed";
  if (relations.has("changing")) return "changing";
  if (relations.size === 1) return [...relations][0];
  return operations.length === 0 ? "unreviewed" : "changing";
}

const librarySelect = document.querySelector("#library");
for (const library of report.libraries) {
  librarySelect.add(new Option(library.title, library.id));
}

const groups = report.libraries.flatMap((library) =>
  library.apiGroups.map((group) => ({ ...group, library })));
const referenceGroups = groups.filter((group) => group.typescript?.symbols?.length);
const groupById = new Map(groups.map((group) => [group.library.id + "/" + group.id, group]));
const publicByTarget = new Map();
for (const entry of report.publicEntries) {
  for (const reach of entry.targets) {
    const callers = publicByTarget.get(reach.target) ?? [];
    callers.push({ entry, reach });
    publicByTarget.set(reach.target, callers);
  }
}
const targets = groups.flatMap((group) => group.bindings.map((binding) => ({
  ...binding,
  group,
  operation: group.generatedOperations?.find((operation) =>
    operation.host.target === binding.target) ?? null,
  mapping: group.coverage?.targetMappings?.find((entry) => entry.target === binding.target) ?? null,
  comparison: group.comparison?.results?.find((entry) => entry.target === binding.target) ?? null,
  publicEntries: publicByTarget.get(binding.target) ?? [],
})));
const targetById = new Map(targets.map((target) => [target.target, target]));
const workItems = report.workItems;
const workById = new Map(workItems.map((item) => [item.id, item]));
const elements = Object.fromEntries([
  "search",
  "library",
  "availability",
  "boundary",
  "semantics",
  "disposition",
  "count",
  "results",
  "detail",
  "theme",
  "reference-view",
  "inventory-view",
  "workbench-view",
].map((id) => [id, document.querySelector("#" + id)]));

const typeBrowserOptionValues = {
  boundaryNotes: new Set(["show", "hide"]),
  jsWrapper: new Set(["plain", "highlight", "hide"]),
  leanNames: new Set(["short", "qualified"]),
};
const typeBrowserDefaults = {
  boundaryNotes: "show",
  jsWrapper: "highlight",
  leanNames: "short",
};
const typeBrowserStorageKey = "lean-vir.binding-type-browser.v1";

function loadTypeBrowserSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(typeBrowserStorageKey) ?? "{}");
    return Object.fromEntries(Object.entries(typeBrowserDefaults).map(([key, fallback]) => [
      key,
      typeBrowserOptionValues[key].has(stored[key]) ? stored[key] : fallback,
    ]));
  } catch {
    return { ...typeBrowserDefaults };
  }
}

let typeBrowserSettings = loadTypeBrowserSettings();

function applyTypeBrowserSettings() {
  document.documentElement.dataset.boundaryNotes = typeBrowserSettings.boundaryNotes;
  document.documentElement.dataset.jsWrapper = typeBrowserSettings.jsWrapper;
}

function saveTypeBrowserSettings() {
  try {
    localStorage.setItem(typeBrowserStorageKey, JSON.stringify(typeBrowserSettings));
  } catch {
    // The report remains usable when storage is unavailable.
  }
}

applyTypeBrowserSettings();

const hashWork = location.hash.match(/^#work=(.*)$/u);
const hashTarget = location.hash.match(/^#target=(.*)$/u);
let view = hashWork ? "workbench" : hashTarget ? "inventory" : "reference";
let selected = decodeURIComponent(
  hashWork?.[1] ?? hashTarget?.[1] ?? location.hash.replace(/^#(?:group|root)=/u, ""),
);
if (view === "reference" && !groupById.has(selected)) {
  selected = referenceGroups[0]
    ? referenceGroups[0].library.id + "/" + referenceGroups[0].id
    : "";
}
if (view === "workbench" && !workById.has(selected)) selected = workItems[0]?.id ?? "";
if (view === "inventory" && !targetById.has(selected)) selected = targets[0]?.target ?? "";

function groupId(group) {
  return group.library.id + "/" + group.id;
}

function primarySymbols(group) {
  const roots = new Set(group.upstream.roots ?? []);
  return (group.typescript?.symbols ?? []).filter((symbol) =>
    roots.has(symbol.id) || symbol.surfaceRoot !== undefined);
}

function coverageMember(group, id) {
  return group.coverage?.members.find((member) => member.id === id);
}

function searchText(values) {
  return values.flat(Infinity).filter(Boolean).join(" ").toLowerCase();
}

function groupSearchText(group) {
  return searchText([
    group.library.title,
    group.title,
    group.description,
    group.upstream.roots,
    primarySymbols(group).map((symbol) => [symbol.id, symbol.display, symbol.hover]),
  ]);
}

function referenceGroupMatches(group) {
  const query = elements.search.value.trim().toLowerCase();
  const availability = elements.availability.value;
  const library = elements.library.value;
  const members = group.coverage?.members ?? [];
  return (library === "all" || group.library.id === library) &&
    (availability === "all" || members.some((member) =>
      member.generation.availability === availability)) &&
    (!query || groupSearchText(group).includes(query));
}

function inventoryTargetMatches(target) {
  const query = elements.search.value.trim().toLowerCase();
  const library = elements.library.value;
  const evidence = boundaryEvidence(target.operation);
  const relation = semanticRelation(target.operation);
  return (library === "all" || target.group.library.id === library) &&
    (elements.boundary.value === "all" || evidence === elements.boundary.value) &&
    (elements.semantics.value === "all" || relation === elements.semantics.value) &&
    (!query || searchText([
      target.target,
      target.group.library.title,
      target.group.title,
      target.providers,
      target.declarations.map((declaration) => [declaration.declaration, declaration.type]),
      target.operation?.lean.declaration,
      target.operation?.typescript.member,
      target.operation?.protocol?.upstreamRelation.member,
    ]).includes(query));
}

function workItemMatches(item) {
  const query = elements.search.value.trim().toLowerCase();
  const group = groupById.get(item.library + "/" + item.group);
  return (elements.library.value === "all" || item.library === elements.library.value) &&
    (elements.disposition.value === "all" || item.disposition === elements.disposition.value) &&
    (!query || searchText([
      group?.library.title,
      group?.title,
      item.member,
      item.target,
      item.targets,
      item.candidateTargets,
      item.code,
      item.message,
      item.action,
    ]).includes(query));
}

function render() {
  elements["reference-view"].classList.toggle("active", view === "reference");
  elements["inventory-view"].classList.toggle("active", view === "inventory");
  elements["workbench-view"].classList.toggle("active", view === "workbench");
  elements.availability.hidden = view !== "reference";
  elements.boundary.hidden = view !== "inventory";
  elements.semantics.hidden = view !== "inventory";
  elements.disposition.hidden = view !== "workbench";
  if (view === "reference") renderReference();
  else if (view === "inventory") renderInventory();
  else renderWorkbench();
}

function renderReference() {
  const visible = referenceGroups.filter(referenceGroupMatches);
  if (!visible.some((group) => groupId(group) === selected)) {
    selected = visible[0] ? groupId(visible[0]) : "";
  }
  elements.count.textContent = `${visible.length} upstream API ${visible.length === 1 ? "group" : "groups"}`;
  elements.results.innerHTML = visible.length === 0
    ? '<div class="empty">No upstream API groups match these filters.</div>'
    : visible.map((group) => {
      const id = groupId(group);
      const availability = group.coverage?.generation.availability ?? {};
      return '<button type="button" class="row ' + (id === selected ? "active" : "") +
        '" data-group="' + escapeHtml(id) + '"><span><span class="name">' +
        escapeHtml(group.library.title + " · " + group.title) +
        '</span><span class="sub">' + (availability.available ?? 0) + " confirmed · " +
        (availability.candidate ?? 0) + " unconfirmed · " +
        (availability["not-provided"] ?? 0) +
        ' not provided</span></span><span class="pill available">upstream API</span></button>';
    }).join("");
  elements.results.querySelectorAll("[data-group]").forEach((button) =>
    button.addEventListener("click", () => selectGroup(button.dataset.group)));
  renderGroupDetail(groupById.get(selected));
}

function renderInventory() {
  const visible = targets.filter(inventoryTargetMatches)
    .sort((left, right) => left.target.localeCompare(right.target));
  if (!visible.some((target) => target.target === selected)) {
    selected = visible[0]?.target ?? "";
  }
  elements.count.textContent = `${visible.length} shipped ${visible.length === 1 ? "boundary" : "boundaries"}`;
  elements.results.innerHTML = visible.length === 0
    ? '<div class="empty">No shipped boundaries match these filters.</div>'
    : visible.map((target) => {
      const evidence = boundaryEvidence(target.operation);
      const relation = semanticRelation(target.operation);
      return '<button type="button" class="row ' + (target.target === selected ? "active" : "") +
        '" data-target="' + escapeHtml(target.target) + '"><span><span class="name">' +
        escapeHtml(target.target) + '</span><span class="sub">' +
        escapeHtml(target.group.library.title + " · " + target.group.title) +
        '</span></span><span class="row-badges"><span class="pill ' + escapeHtml(evidence) + '">' +
        escapeHtml(boundaryEvidenceLabel(evidence)) + '</span><span class="pill ' +
        escapeHtml(relation) + '">' + escapeHtml(semanticRelationLabel(relation)) +
        "</span></span></button>";
    }).join("");
  elements.results.querySelectorAll("[data-target]").forEach((button) =>
    button.addEventListener("click", () => selectTarget(button.dataset.target)));
  renderInventoryDetail(targetById.get(selected));
}

function renderWorkbench() {
  const visible = workItems.filter(workItemMatches);
  if (!visible.some((item) => item.id === selected)) selected = visible[0]?.id ?? "";
  elements.count.textContent = `${visible.length} author ${visible.length === 1 ? "action" : "actions"}`;
  elements.results.innerHTML = visible.length === 0
    ? '<div class="empty">No binding-author actions match these filters.</div>'
    : visible.map((item) => {
      const group = groupById.get(item.library + "/" + item.group);
      const subject = item.member ?? item.target ?? group?.title ?? item.code;
      return '<button type="button" class="row ' + (item.id === selected ? "active" : "") +
        '" data-work="' + escapeHtml(item.id) + '"><span><span class="name">' +
        escapeHtml(subject) + '</span><span class="sub">' +
        escapeHtml((group?.library.title ?? item.library) + " · " + item.code) +
        '</span></span><span class="pill ' + escapeHtml(item.disposition) + '">' +
        escapeHtml(dispositionLabel(item.disposition)) + "</span></button>";
    }).join("");
  elements.results.querySelectorAll("[data-work]").forEach((button) =>
    button.addEventListener("click", () => selectWork(button.dataset.work)));
  renderWorkItem(workById.get(selected));
}

function selectGroup(id) {
  view = "reference";
  selected = id;
  history.replaceState(null, "", "#group=" + encodeURIComponent(id));
  render();
}

function selectTarget(id) {
  view = "inventory";
  selected = id;
  history.replaceState(null, "", "#target=" + encodeURIComponent(id));
  render();
}

function selectWork(id) {
  view = "workbench";
  selected = id;
  history.replaceState(null, "", "#work=" + encodeURIComponent(id));
  render();
}

function sourceLink(source, label) {
  return source?.path
    ? '<a class="source" href="../../' + escapeHtml(source.path) + "#L" + source.startLine +
      '">' + escapeHtml(label + ":" + source.startLine) + "</a>"
    : "";
}

function symbolSource(symbol) {
  return symbol?.source?.url
    ? '<a class="source" href="' + escapeHtml(symbol.source.url) + "#L" +
      symbol.source.startLine + '" target="_blank" rel="noreferrer">upstream source</a>'
    : symbol?.source?.path
      ? '<a class="source" href="../../' + escapeHtml(symbol.source.path) + "#L" +
        symbol.source.startLine + '">upstream source</a>'
      : "";
}

function selectorMatches(declaration, selector) {
  return declaration === selector || declaration.startsWith(selector + ".");
}

function preferredPublicEntries(target) {
  const reviewedNames = [
    ...(target.mapping?.source === "reviewed" ? target.mapping.lean ?? [] : []),
    target.comparison?.lean,
  ].filter(Boolean);
  const reviewed = target.publicEntries.filter((item) =>
    reviewedNames.includes(item.entry.declaration));
  if (reviewed.length) return reviewed;
  const selectors = target.group.lean.public ?? [];
  const scoped = target.publicEntries.filter((item) => selectors.some((selector) =>
    selectorMatches(item.entry.declaration, selector)));
  const pool = scoped.length ? scoped : target.publicEntries;
  if (pool.length === 0) return [];
  const minimum = Math.min(...pool.map((item) => item.reach.path.length));
  return pool.filter((item) => item.reach.path.length === minimum)
    .sort((left, right) => left.entry.declaration.localeCompare(right.entry.declaration));
}

function displayLeanName(value) {
  let display = String(value ?? "");
  if (typeBrowserSettings.leanNames === "short") {
    for (const [prefix, replacement] of [
      ["Lean.Vir.Browser.", ""],
      ["Lean.Vir.React.", ""],
      ["Lean.Vir.ProofWidgets.", ""],
      ["Lean.Vir.Infoview.", ""],
      ["Lean.Vir.Common.", ""],
      ["Lean.Vir.Js.", "Js."],
      ["Lean.Vir.Js", "Js"],
      ["Lean.Vir.", ""],
    ]) display = display.replaceAll(prefix, replacement);
  }
  if (typeBrowserSettings.jsWrapper === "hide") {
    display = display.replace(/\b(?:Lean\.Vir\.)?Js(?:\.[A-Z][A-Za-z0-9_']*)?\s+/gu, "");
  }
  return display;
}

function tooltipText(summary, provenance) {
  const evidence = Array.isArray(provenance) ? provenance : [provenance];
  return [
    summary,
    ...evidence.flatMap((entry) => entry === undefined ? [] : [
      entry.detail,
      entry.source ? "Policy source: " + entry.source : undefined,
    ]),
  ].filter(Boolean).join("\n");
}

function semanticText(label, tooltip, className = "") {
  return '<span class="semantic-text ' + escapeHtml(className) +
    '" tabindex="0" data-tooltip="' + escapeHtml(tooltip) +
    '" aria-label="' + escapeHtml(label + ": " + tooltip) + '">' +
    escapeHtml(label) + "</span>";
}

function renderSemanticLeanType(value, provenance = []) {
  const tooltip = tooltipText(String(value), provenance);
  return '<span class="signature-type semantic-text" tabindex="0" data-tooltip="' +
    escapeHtml(tooltip) + '" aria-label="' +
    escapeHtml(displayLeanName(value) + ": " + tooltip) + '">' +
    highlightCode(displayLeanName(value), "lean") + "</span>";
}

const modalityDescriptions = {
  "js-resource": "A JavaScript value represented by an opaque Lean resource handle.",
  immediate: "An immediate Lean value; no JavaScript resource handle is involved.",
  callback: "A Lean callback crossing the JavaScript boundary.",
  borrowed: "Borrowed by the host for this boundary call.",
  owned: "Ownership transfers across this boundary.",
  consumed: "The runtime takes this handle and dynamically revokes its aliases after the call; Lean does not enforce affine use.",
  call: "The host may retain this value only for the duration of the call.",
  "until-release": "The host retains this value until the matching release operation.",
  retained: "The host retains this value after the call.",
  value: "A plain value result without resource ownership.",
};

function modalityTooltip(modalities, provenance = {}) {
  return Object.entries(modalities ?? {}).map(([kind, value]) => tooltipText(
    kind + ": " + (modalityDescriptions[value] ?? String(value)),
    provenance[kind],
  )).join("\n");
}

function renderSignatureAnnotation(role, modalities, provenance = {}) {
  const values = role === "result"
    ? [modalities.representation, modalities.ownership, "result"]
    : [role === "argument" ? undefined : role, modalities.passing, modalities.retention];
  const label = "-- " + values.filter(Boolean).map((value) =>
    String(value).replaceAll("-", " ")).join(" · ");
  return semanticText(
    label,
    modalityTooltip(modalities, provenance),
    "signature-annotation",
  );
}

function parenthesizeLeanArgument(value) {
  return /\s|→/u.test(value) && !(value.startsWith("(") && value.endsWith(")"))
    ? "(" + value + ")"
    : value;
}

function effectfulLeanType(operation) {
  return operation.effect.lean + " " + parenthesizeLeanArgument(operation.result.lean);
}

function renderSignatureArgument(role, argument, nameWidth) {
  return '<div class="signature-line"><code class="signature-expression">' +
    escapeHtml("  (" + argument.name.padEnd(nameWidth) + " : ") +
    renderSemanticLeanType(argument.type, argument.provenance?.type) +
    escapeHtml(")") + "</code>" +
    renderSignatureAnnotation(role, argument.modalities, argument.provenance) + "</div>";
}

function renderReadableLeanSignature(operation, source) {
  const arguments_ = [
    ...(operation.receiver.kind === "argument"
      ? [{ role: "receiver", argument: operation.receiver.argument }]
      : []),
    ...operation.arguments.map((argument) => ({ role: argument.role, argument })),
  ];
  const nameWidth = Math.max(1, ...arguments_.map((entry) => entry.argument.name.length));
  const parameters = arguments_.map((entry) =>
    renderSignatureArgument(entry.role, entry.argument, nameWidth)).join("");
  const receiverContext = operation.receiver.kind === "global"
    ? '<div class="signature-comment">' + semanticText(
      "-- host global: " + operation.receiver.typescriptType,
      tooltipText(
        operation.receiver.typescriptType + " is supplied by the JavaScript host and is not a Lean parameter.",
        operation.receiver.provenance?.kind,
      ),
      "signature-annotation",
    ) + "</div>"
    : operation.receiver.kind === "none" && operation.receiver.typescriptType
      ? '<div class="signature-comment">' + semanticText(
        "-- " + operation.receiver.typescriptType + " receiver replaced by policy",
        tooltipText(
          "The upstream " + operation.receiver.typescriptType + " receiver is not an emitted Lean parameter.",
          operation.receiver.provenance?.kind,
        ),
        "signature-annotation",
      ) + "</div>"
      : "";
  const exactResult = effectfulLeanType(operation);
  return '<section class="readable-signature"><div class="signature-caption"><span>Lean signature</span>' +
    source + '</div><div class="signature-source"><div class="signature-declaration semantic-text" tabindex="0" data-tooltip="' +
    escapeHtml(operation.lean.declaration) + '" aria-label="Lean declaration: ' +
    escapeHtml(operation.lean.declaration) + '">' +
    highlightCode(displayLeanName(operation.lean.declaration), "lean") + "</div>" +
    receiverContext + parameters +
    '<div class="signature-line signature-result"><code class="signature-expression">' +
    escapeHtml("  : ") +
    renderSemanticLeanType(exactResult, [
      operation.effect.provenance,
      ...(operation.result.provenance?.type ?? []),
    ]) + "</code>" +
    renderSignatureAnnotation("result", operation.result.modalities, operation.result.provenance) +
    "</div></div></section>";
}

function formatTypeScriptType(shape) {
  if (shape === undefined || shape === null) return "unknown";
  switch (shape.kind) {
  case "primitive":
    return shape.name;
  case "opaque":
    return shape.name;
  case "literal":
    return JSON.stringify(shape.value);
  case "ref":
    return shape.id + (shape.args?.length
      ? "<" + shape.args.map(formatTypeScriptType).join(", ") + ">"
      : "");
  case "array": {
    const element = formatTypeScriptType(shape.element);
    return (shape.element?.kind === "union" ? "(" + element + ")" : element) + "[]";
  }
  case "option":
    return formatTypeScriptType(shape.element) + " | " + ({
      null: "null",
      undefined: "undefined",
      nullish: "null | undefined",
    }[shape.absence ?? "null"] ?? shape.absence);
  case "union":
    return shape.options.map(formatTypeScriptType).join(" | ");
  case "function":
    return "(" + (shape.args ?? []).map((argument) =>
      (argument.rest ? "..." : "") + argument.name + (argument.optional ? "?" : "") +
      ": " + formatTypeScriptType(argument.type)).join(", ") + ") => " +
      formatTypeScriptType(shape.result);
  default:
    return shape.name ?? shape.id ?? shape.kind;
  }
}

function formatTypeScriptParameter(argument) {
  return (argument.rest ? "..." : "") + argument.name +
    (argument.optional ? "?" : "") + ": " + formatTypeScriptType(argument.type);
}

function renderTransformationValue(value, language, state = "") {
  return '<code class="transformation-value ' + escapeHtml(state) + '">' +
    (language === null ? escapeHtml(value) : highlightCode(value, language)) + "</code>";
}

function renderTransformationRow(from, to, note = "", state = "mapped") {
  return '<div class="transformation-row"><div>' +
    renderTransformationValue(from, "typescript") + '</div><span class="transformation-arrow" aria-hidden="true">→</span><div>' +
    renderTransformationValue(to, state === "mapped" ? "lean" : null, state) +
    (note ? '<span class="transformation-note"> · ' + escapeHtml(note) + "</span>" : "") +
    "</div></div>";
}

function renderTypeTransformation(operation, { showHeading = true } = {}) {
  if (operation.typescript.kind === "protocol") return "";
  const rows = [];
  if (operation.receiver.typescriptType) {
    const leanReceiver = operation.receiver.kind === "argument"
      ? operation.receiver.argument.name + ": " + displayLeanName(operation.receiver.argument.type)
      : operation.receiver.kind === "global"
        ? "host global · no Lean parameter"
        : "no Lean receiver";
    rows.push(renderTransformationRow(
      "this: " + operation.receiver.typescriptType,
      leanReceiver,
      operation.receiver.kind === "argument" ? "explicit borrowed receiver" :
        operation.receiver.kind === "global" ? "provided by the host" : "reviewed specialization",
      operation.receiver.kind === "argument" ? "mapped" : "policy",
    ));
  }
  const usedLeanArguments = new Set();
  if (operation.typescript.kind === "property" && operation.typescript.accessor === "set") {
    const argument = operation.arguments[0];
    if (argument !== undefined) {
      usedLeanArguments.add(argument.name);
      rows.push(renderTransformationRow(
        "value: " + formatTypeScriptType(operation.typescript.shape),
        argument.name + ": " + displayLeanName(argument.type),
        "property setter value",
      ));
    }
  } else if (operation.typescript.shape?.kind === "function") {
    const policy = operation.typescript.signaturePolicy ?? {};
    const omitted = new Set([
      ...(policy.omittedOptionalParameters ?? []),
      ...(policy.omittedRequiredParameters ?? []),
      ...(policy.omittedRestParameters ?? []),
    ]);
    for (const argument of operation.typescript.shape.args ?? []) {
      if (Object.hasOwn(policy.fixedArguments ?? {}, argument.name)) {
        rows.push(renderTransformationRow(
          formatTypeScriptParameter(argument),
          "host literal " + JSON.stringify(policy.fixedArguments[argument.name]),
          "fixed by reviewed signature policy",
          "policy",
        ));
        continue;
      }
      const fixedRest = policy.fixedRestParameters?.[argument.name];
      if (fixedRest !== undefined) {
        for (const name of fixedRest) {
          const emitted = operation.arguments.find((entry) => entry.name === name);
          if (emitted === undefined) continue;
          usedLeanArguments.add(emitted.name);
          rows.push(renderTransformationRow(
            formatTypeScriptParameter(argument),
            emitted.name + ": " + displayLeanName(emitted.type),
            "fixed-arity specialization",
          ));
        }
        continue;
      }
      if (omitted.has(argument.name)) {
        rows.push(renderTransformationRow(
          formatTypeScriptParameter(argument),
          "omitted by reviewed policy",
          argument.optional ? "optional upstream parameter" : "reviewed specialization",
          "omitted",
        ));
        continue;
      }
      const emittedName = policy.parameterRenames?.[argument.name] ?? argument.name;
      const emitted = operation.arguments.find((entry) => entry.name === emittedName);
      if (emitted !== undefined) {
        usedLeanArguments.add(emitted.name);
        rows.push(renderTransformationRow(
          formatTypeScriptParameter(argument),
          emitted.name + ": " + displayLeanName(emitted.type),
          emitted.role === "callback" ? "retained callback policy" : "faithful representation",
        ));
      }
    }
  }
  for (const argument of operation.arguments) {
    if (usedLeanArguments.has(argument.name)) continue;
    rows.push(renderTransformationRow(
      "VIR policy",
      argument.name + ": " + displayLeanName(argument.type),
      "policy-authored boundary argument",
      "policy",
    ));
  }
  const typeScriptResult = operation.typescript.kind === "property"
    ? operation.typescript.accessor === "set"
      ? "void"
      : formatTypeScriptType(operation.typescript.shape)
    : formatTypeScriptType(operation.typescript.shape?.result);
  rows.push(renderTransformationRow(
    "result: " + typeScriptResult,
    "result: " + displayLeanName(effectfulLeanType(operation)),
    operation.effect.id + " effect · " + Object.values(operation.result.modalities).join(" · "),
  ));
  return '<section class="type-transformation">' +
    (showHeading
      ? '<div class="transformation-heading"><span>Type translation</span><span>selected TypeScript shape → emitted Lean boundary</span></div>'
      : "") +
    '<div class="transformation-columns"><span>TypeScript</span><span></span><span>Lean</span></div>' +
    '<div class="transformation-grid">' + rows.join("") + "</div></section>";
}

function renderLeanCards(targetIds, {
  showRuntime = false,
  showTranslation = true,
  showExact = true,
} = {}) {
  const rendered = [];
  for (const id of targetIds) {
    const target = targetById.get(id);
    if (target === undefined) continue;
    const declarations = preferredPublicEntries(target);
    if (declarations.length === 0) continue;
    rendered.push(...declarations.map((item) => {
      const operation = target.operation?.lean.declaration === item.entry.declaration
        ? target.operation
        : null;
      const signature = operation === null
        ? '<div class="card-head"><span class="card-title" title="' +
          escapeHtml(item.entry.declaration) + '">' +
          escapeHtml(displayLeanName(item.entry.declaration)) + "</span>" +
          sourceLink(item.entry.source, item.entry.module) + "</div>" +
          renderCode(item.entry.type, "lean")
        : renderReadableLeanSignature(
          operation,
          sourceLink(item.entry.source, item.entry.module),
        ) + (showTranslation ? renderTypeTransformation(operation) : "") +
          (showExact
            ? '<details class="exact-type"><summary>Exact compiled Lean type</summary>' +
              renderCode(item.entry.type, "lean") + "</details>"
            : "");
      return (
      '<article class="binding lean-binding">' + signature +
      (showRuntime
        ? '<details><summary class="note">Compiled boundary evidence</summary><div class="badges">' +
          target.providers.map((provider) => '<span class="badge">' + escapeHtml(provider) + "</span>").join("") +
          "</div>" + renderCode(item.reach.path.join("\n→ "), "lean") + "</details>"
        : "") + "</article>");
    }));
  }
  return rendered.length
    ? rendered.join("")
    : '<div class="empty">No confirmed public Lean binding.</div>';
}

function symbolMatchesReferenceFilters(group, symbol) {
  const member = coverageMember(group, symbol.id);
  const availability = elements.availability.value;
  const query = elements.search.value.trim().toLowerCase();
  const groupHeaderMatches = query && searchText([
    group.library.title,
    group.title,
    group.description,
    group.upstream.roots,
  ]).includes(query);
  return (availability === "all" || member?.generation.availability === availability) &&
    (!query || groupHeaderMatches || searchText([symbol.id, symbol.display, symbol.hover]).includes(query));
}

function modalityText(argument) {
  const mode = argument.modalities;
  return argument.name + ": " + argument.type + " · " +
    [mode.representation, mode.passing, mode.retention].join(" / ");
}

function renderOperationPolicy(operation) {
  const receiver = operation.receiver.kind === "global"
    ? "receiver: host global " + operation.receiver.typescriptType
    : operation.receiver.kind === "argument"
      ? modalityText(operation.receiver.argument)
      : "receiver: none";
  const arguments_ = operation.arguments.map(modalityText);
  const result = operation.result.modalities;
  const signature = operation.typescript.signaturePolicy;
  return '<article><div class="card-head"><span class="card-title">' +
    escapeHtml(operation.host.target) + '</span><span class="badge">' +
    escapeHtml(operation.effect.id) + '</span><span class="pill ' +
    escapeHtml(semanticRelation(operation)) + '">' +
    escapeHtml(semanticRelationLabel(semanticRelation(operation))) +
    '</span></div><div class="policy-flow"><span>' +
    escapeHtml(operation.protocol?.upstreamRelation.member ?? operation.typescript.member) +
    '</span><span aria-hidden="true">→</span><span>' +
    escapeHtml(operation.lean.declaration) + '</span></div><ul><li>' +
    [receiver, ...arguments_, "result: " + operation.result.lean + " · " +
      [result.representation, result.ownership].join(" / ")]
      .map(escapeHtml).join("</li><li>") + "</li></ul>" +
    (signature === undefined ? "" : '<p class="policy-source">Signature: <code>' +
      escapeHtml(String(signature.selection)) + "</code> · " +
      escapeHtml(signature.provenance) +
      (signature.omittedOptionalParameters.length === 0
        ? " · no parameters omitted"
        : " · omitted: " + escapeHtml(signature.omittedOptionalParameters.join(", "))) +
      "</p>") +
    (operation.protocol === undefined ? "" : '<p class="policy-source"><b>Policy-authored protocol:</b> ' +
      escapeHtml(operation.protocol.reason) + "</p>") +
    (operation.exception === undefined ? "" : '<p class="policy-source"><b>Reviewed specialization:</b> ' +
      escapeHtml(operation.exception.reason) + "</p>") + "</article>";
}

function renderGenerationPolicy(group, symbol) {
  const operations = operationsForSymbol(group, symbol);
  if (operations.length === 0) return "";
  return '<details class="generation-policy"><summary>Generated conversion policy</summary>' +
    operations.map(renderOperationPolicy).join("") + "</details>";
}

function renderUpstreamSymbol(group, symbol) {
  const member = coverageMember(group, symbol.id);
  const state = member?.generation;
  const inherited = symbol.inheritedFrom
    ? '<span class="badge">inherited from ' + escapeHtml(symbol.inheritedFrom) + "</span>"
    : "";
  const availability = state
    ? '<span class="pill ' + escapeHtml(state.availability) + '">' +
      escapeHtml(availabilityLabel(state.availability)) + "</span>"
    : "";
  const evidence = member
    ? '<span class="pill ' + escapeHtml(member.status) + '">' +
      escapeHtml(evidenceLabel(member.status)) + "</span>"
    : "";
  const relation = combinedSemanticRelation(operationsForSymbol(group, symbol));
  const leanPaneTitle = ({
    preserving: "Semantics-preserving Lean boundary",
    changing: "Explicit Lean semantic adapter",
    unreviewed: "Lean boundary — semantic review required",
  })[relation] ?? "Lean boundary";
  const lean = state?.availability === "available"
    ? '<div class="panes"><div class="pane"><div class="pane-title">Upstream TypeScript</div>' +
      renderCode(symbol.display, "typescript") + '</div><div class="pane"><div class="pane-title">' +
      escapeHtml(leanPaneTitle) + '</div>' +
      renderLeanCards(state.targets) + "</div></div>"
    : renderCode(symbol.display, "typescript") +
      (state ? '<p class="note">VIR does not currently document a confirmed binding for this entry.</p>' : "");
  return '<details class="binding"><summary><span class="card-title">' + escapeHtml(symbol.id) +
    '</span> <span class="badge">' + escapeHtml(symbol.kind) + "</span> " + inherited + " " +
    availability + " " + evidence + '</summary><div class="card-head">' +
    renderDocumentation(symbol.hover) +
    symbolSource(symbol) + "</div>" + lean + renderGenerationPolicy(group, symbol) + "</details>";
}

function renderGroupDetail(group) {
  if (group === undefined) {
    elements.detail.innerHTML = '<div class="empty">Select an upstream API group.</div>';
    return;
  }
  const upstream = [group.upstream.package, group.upstream.version].filter(Boolean);
  const docs = group.upstream.docs
    ? '<a href="' + escapeHtml(group.upstream.docs) +
      '" target="_blank" rel="noreferrer">Upstream documentation</a>'
    : "";
  const symbols = primarySymbols(group).filter((symbol) =>
    symbolMatchesReferenceFilters(group, symbol));
  elements.detail.innerHTML = '<div class="badges"><span class="pill available">upstream API</span>' +
    upstream.map((value) => '<span class="badge">' + escapeHtml(value) + "</span>").join("") +
    "</div><h2>" + escapeHtml(group.title) + '</h2><p class="note">' +
    escapeHtml(group.description || group.library.description) + "</p>" + docs +
    '<section class="section"><h3>Upstream entry points</h3><div class="badges">' +
    (group.upstream.roots ?? []).map((root) => '<span class="badge">' + escapeHtml(root) + "</span>").join("") +
    '</div></section><section class="section"><h3>Upstream API</h3>' +
    (symbols.length ? symbols.map((symbol) => renderUpstreamSymbol(group, symbol)).join("")
      : '<div class="empty">No upstream entries match these filters.</div>') + "</section>";
}

function renderTypeOptionGroup(key, label, choices) {
  return '<div class="type-option-group" role="group" aria-label="' + escapeHtml(label) +
    '"><span class="type-option-label">' + escapeHtml(label) +
    '</span><span class="type-option-choices">' + choices.map(([value, text]) => {
      const active = typeBrowserSettings[key] === value;
      return '<button type="button" class="type-option' + (active ? " active" : "") +
        '" data-type-option="' + escapeHtml(key) + '" data-type-value="' +
        escapeHtml(value) + '" aria-pressed="' + String(active) + '">' +
        escapeHtml(text) + "</button>";
    }).join("") + "</span></div>";
}

function renderTypeBrowserOptions() {
  return '<div class="type-browser-options"><span class="type-options-title" ' +
    'title="Presentation only; exact compiled evidence is unchanged.">Type display</span>' +
    renderTypeOptionGroup("boundaryNotes", "Boundary notes", [
      ["show", "Show"],
      ["hide", "Hide"],
    ]) + renderTypeOptionGroup("jsWrapper", "Js wrapper", [
      ["plain", "Plain"],
      ["highlight", "Highlight"],
      ["hide", "Hide"],
    ]) + renderTypeOptionGroup("leanNames", "Lean names", [
      ["short", "Short"],
      ["qualified", "Qualified"],
    ]) + "</div>";
}

function bindTypeBrowserOptions() {
  elements.detail.querySelectorAll("[data-type-option]").forEach((button) =>
    button.addEventListener("click", () => {
      const key = button.dataset.typeOption;
      const value = button.dataset.typeValue;
      if (!typeBrowserOptionValues[key]?.has(value)) return;
      typeBrowserSettings = { ...typeBrowserSettings, [key]: value };
      applyTypeBrowserSettings();
      saveTypeBrowserSettings();
      renderInventoryDetail(targetById.get(selected));
    }));
}

function contractOriginLabel(operation) {
  return ({
    "typescript-derived": "Upstream TypeScript",
    "upstream-adapter": "Upstream API",
    "vir-owned": "VIR-owned contract",
    "local-contract": "Local TypeScript contract",
    unclassified: "Source contract",
  })[boundaryEvidence(operation)] ?? "Source contract";
}

function renderContractOrigin(operation, symbol) {
  const label = contractOriginLabel(operation);
  if (symbol !== undefined) {
    return '<div class="contract-origin"><div class="contract-caption"><span>' +
      escapeHtml(label) + "</span>" + symbolSource(symbol) +
      '</div><div class="contract-title">' + escapeHtml(symbol.id) + "</div>" +
      renderCode(symbol.display, "typescript") + renderDocumentation(symbol.hover) + "</div>";
  }
  if (operation !== null && operation !== undefined) {
    return '<div class="contract-origin"><div class="contract-caption"><span>' +
      escapeHtml(label) + '</span></div><div class="contract-title">' +
      escapeHtml(operation.typescript.display ?? operation.typescript.member) + "</div>" +
      renderDocumentation(operation.typescript.documentation) + "</div>";
  }
  return '<div class="contract-origin"><div class="contract-caption"><span>Source contract</span></div>' +
    '<p class="note">No canonical source contract was recorded.</p></div>';
}

function renderTranslationDisclosure(operation) {
  if (operation === null || operation.typescript.kind === "protocol") return "";
  return '<details class="translation-details"><summary><span>Type translation</span>' +
    '<span>parameter mapping and reviewed policy choices</span></summary>' +
    renderTypeTransformation(operation, { showHeading: false }) + "</details>";
}

function renderBindingContract(target, operation, symbol) {
  return '<div class="binding-contract">' + renderContractOrigin(operation, symbol) +
    '<div class="contract-arrow"><span>maps to</span><b aria-hidden="true">→</b></div>' +
    '<div class="contract-lean">' + renderLeanCards([target.target], {
      showTranslation: false,
      showExact: false,
    }) + "</div></div>" + renderTranslationDisclosure(operation);
}

function signaturePolicySummary(signature) {
  if (signature === undefined) return undefined;
  return "Signature " + signature.selection + " · " + signature.provenance +
    (signature.omittedOptionalParameters.length === 0
      ? " · no optional parameters omitted"
      : " · omitted optional parameters: " + signature.omittedOptionalParameters.join(", "));
}

function renderGenerationDecisions(operation) {
  if (operation === null) {
    return '<section class="evidence-unit"><h4>Generation decisions</h4>' +
      '<p class="note">No canonical generated operation was recorded.</p></section>';
  }
  const decisions = [
    "Semantic relation: " + semanticRelationLabel(semanticRelation(operation)) +
      " (" + operation.semantics.evidence + ")",
    signaturePolicySummary(operation.typescript.signaturePolicy),
    operation.protocol === undefined
      ? undefined
      : boundaryEvidenceLabel(operation.protocol.upstreamRelation.kind) + ": " +
        operation.protocol.reason,
    operation.exception === undefined
      ? undefined
      : "Reviewed specialization: " + operation.exception.reason,
    operation.hostPolicy.valueTransport === "direct"
      ? "Value transport: exact JavaScript value (no public host wrapper)"
      : undefined,
    operation.hostPolicy.semanticAdapter === "named"
      ? "Adapter: named upstream semantic adapter"
      : operation.hostPolicy.semanticAdapter === "declared"
        ? "Adapter: declared TypeScript-operation specialization"
        : undefined,
    operation.hostPolicy.activeEffect === "none"
      ? undefined
      : "Private active-effect teardown: " + operation.hostPolicy.activeEffect,
  ].filter(Boolean);
  return '<section class="evidence-unit"><h4>Generation decisions</h4>' +
    (decisions.length
      ? '<ul class="evidence-list"><li>' + decisions.map(escapeHtml).join("</li><li>") + "</li></ul>"
      : '<p class="note">The ABI profile supplied all generation decisions.</p>') +
    '<p class="evidence-hint">Hover the Lean signature for field-level modality provenance.</p></section>';
}

function renderCompiledEvidence(target) {
  const declarations = preferredPublicEntries(target);
  const runtime = '<section class="evidence-unit"><h4>Runtime provider keys</h4><div class="badges">' +
    (target.providers.length
      ? target.providers.map((provider) => '<span class="badge">' +
        escapeHtml(provider) + "</span>").join("")
      : '<span class="pill missing-provider">missing provider key</span>') +
    '</div><p class="evidence-hint">Presence proves dispatch-name coverage, not provider modality or behavior.</p></section>';
  const compiled = declarations.length
    ? '<section class="evidence-unit compiled-evidence"><h4>Compiled public declaration' +
      (declarations.length === 1 ? "" : "s") + "</h4>" +
      declarations.map((item) => '<article class="compiled-record"><div class="card-head"><div class="contract-title">' +
        escapeHtml(displayLeanName(item.entry.declaration)) + "</div>" +
        sourceLink(item.entry.source, item.entry.module) + "</div>" +
        renderCode(item.entry.type, "lean") + '<div class="evidence-subtitle">Public reachability</div>' +
        renderCode(item.reach.path.join("\n→ "), "lean") + "</article>").join("") + "</section>"
    : '<section class="evidence-unit"><h4>Compiled public declaration</h4>' +
      '<p class="note">No confirmed public Lean declaration reaches this target.</p></section>';
  return runtime + compiled;
}

function renderImplementationEvidence(target, operation) {
  const declarations = preferredPublicEntries(target).length;
  const summary = target.providers.length + " runtime provider " +
    (target.providers.length === 1 ? "key" : "keys") + " · " +
    declarations + " public " + (declarations === 1 ? "declaration" : "declarations");
  return '<details class="implementation-evidence"><summary><span>Implementation evidence</span><span>' +
    escapeHtml(summary) + '</span></summary><div class="implementation-evidence-body">' +
    renderGenerationDecisions(operation) + renderCompiledEvidence(target) + "</div></details>";
}

function renderInventoryDetail(target) {
  if (target === undefined) {
    elements.detail.innerHTML = '<div class="empty">Select a shipped boundary.</div>';
    return;
  }
  const operation = target.operation;
  const evidence = boundaryEvidence(operation);
  const relation = semanticRelation(operation);
  const upstreamMember = operation?.protocol?.upstreamRelation.member ??
    (operation?.typescript.kind === "protocol" ? undefined : operation?.typescript.member);
  const symbol = upstreamMember === undefined
    ? undefined
    : target.group.typescript?.symbols.find((entry) => entry.id === upstreamMember);
  elements.detail.innerHTML = '<div class="badges"><span class="pill ' +
    escapeHtml(evidence) + '">' + escapeHtml(boundaryEvidenceLabel(evidence)) +
    '</span><span class="pill ' + escapeHtml(relation) + '">' +
    escapeHtml(semanticRelationLabel(relation)) + "</span>" + (target.status === "provided"
      ? ""
      : '<span class="pill ' + escapeHtml(target.status) + '">' +
        escapeHtml(target.status) + "</span>") + "</div><h2>" + escapeHtml(target.target) +
    '</h2><p class="note">' + escapeHtml(target.group.library.title + " · " +
      target.group.title) + '</p><section class="section"><h3>Binding contract</h3>' +
    renderTypeBrowserOptions() + renderBindingContract(target, operation, symbol) +
    '</section><section class="section">' +
    renderImplementationEvidence(target, operation) + "</section>";
  bindTypeBrowserOptions();
}

function comparisonResults(group, member) {
  const symbol = group.typescript?.symbols.find((entry) => entry.id === member);
  return (group.comparison?.results ?? []).filter((result) =>
    result.ts === member ||
    (result.portIntent?.disposition === "unsupported" && result.ts === symbol?.surfaceRoot));
}

function renderWorkItem(item) {
  if (item === undefined) {
    elements.detail.innerHTML = '<div class="empty">Select a binding-author action.</div>';
    return;
  }
  const group = groupById.get(item.library + "/" + item.group);
  const symbol = item.member
    ? group?.typescript?.symbols.find((entry) => entry.id === item.member)
    : undefined;
  const targetIds = [...new Set([
    ...(item.targets ?? []),
    ...(item.candidateTargets ?? []),
    ...(item.target ? [item.target] : []),
  ])];
  const comparisons = item.member ? comparisonResults(group, item.member) : [];
  const evidence = symbol
    ? '<section class="section"><h3>Expected versus current</h3><div class="panes"><div class="pane"><div class="pane-title">Upstream TypeScript</div><article class="anchor"><div class="card-head"><span class="card-title">' +
      escapeHtml(symbol.id) + "</span>" + symbolSource(symbol) + "</div>" +
      renderCode(symbol.display, "typescript") + renderDocumentation(symbol.hover) +
      '</article></div><div class="pane"><div class="pane-title">Current public Lean evidence</div>' +
      renderLeanCards(targetIds, { showRuntime: true }) + "</div></div></section>"
    : targetIds.length
      ? '<section class="section"><h3>Current public Lean evidence</h3>' +
        renderLeanCards(targetIds, { showRuntime: true }) + "</section>"
      : "";
  const comparison = comparisons.length
    ? '<section class="section"><h3>Existing comparison evidence</h3>' + comparisons.map((result) =>
      '<article class="anchor"><div class="card-head"><span class="card-title">' +
      escapeHtml(result.id) + '</span><span class="pill ' + escapeHtml(result.status) + '">' +
      escapeHtml(result.status) + "</span></div>" +
      (result.note ? '<p class="note">' + escapeHtml(result.note) + "</p>" : "") +
      "</article>").join("") + "</section>"
    : "";
  elements.detail.innerHTML = '<div class="badges"><span class="pill ' +
    escapeHtml(item.disposition) + '">' + escapeHtml(dispositionLabel(item.disposition)) +
    '</span><span class="pill ' + escapeHtml(item.severity) + '">' +
    escapeHtml(item.severity) + '</span><span class="badge">' +
    escapeHtml(item.provenance) + "</span></div><h2>" +
    escapeHtml(item.member ?? item.target ?? group?.title ?? item.code) +
    '</h2><article class="work-item ' + escapeHtml(item.severity) +
    '"><div class="card-head"><span class="card-title">' + escapeHtml(item.code) +
    '</span></div><p>' + escapeHtml(item.message) +
    '</p><div class="pane-title">Required action</div><p>' + escapeHtml(item.action) +
    "</p></article>" + evidence + comparison +
    '<section class="section"><button type="button" class="inline-button" id="open-reference">Open upstream API group</button></section>';
  elements.detail.querySelector("#open-reference")?.addEventListener("click", () =>
    selectGroup(item.library + "/" + item.group));
}

[elements.search, elements.library, elements.availability, elements.boundary, elements.semantics, elements.disposition].forEach((element) =>
  element.addEventListener(element === elements.search ? "input" : "change", render));
elements["reference-view"].addEventListener("click", () =>
  selectGroup(groupById.has(selected) ? selected : groupId(referenceGroups[0])));
elements["inventory-view"].addEventListener("click", () =>
  selectTarget(targetById.has(selected) ? selected : targets[0]?.target ?? ""));
elements["workbench-view"].addEventListener("click", () =>
  selectWork(workById.has(selected) ? selected : workItems[0]?.id ?? ""));
elements.theme.addEventListener("click", () => {
  document.documentElement.dataset.theme =
    document.documentElement.dataset.theme === "light" ? "dark" : "light";
});
document.addEventListener("keydown", (event) => {
  if (event.key === "/" && document.activeElement !== elements.search) {
    event.preventDefault();
    elements.search.focus();
  }
});
render();
