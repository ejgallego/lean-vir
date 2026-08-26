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
    `${report.summary.provided} with runtime providers. ` +
    `${generation.boundaries.targets} are generated and ` +
    `${generation.boundaries.handwrittenDeclarations} declarations are handwritten: ` +
    `${generation.boundaries.typescriptDerived} boundaries are TypeScript-derived and ` +
    `${generation.boundaries.reviewedProtocols} are reviewed VIR protocols. ` +
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
  "needs-annotation": "needs annotation",
  unsupported: "unsupported",
  "not-selected": "not selected",
})[value] ?? value;
const availabilityLabel = (value) => ({
  available: "VIR binding available",
  candidate: "correspondence not confirmed",
  "not-provided": "not provided",
})[value] ?? value;

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
  "disposition",
  "count",
  "results",
  "detail",
  "theme",
  "reference-view",
  "workbench-view",
].map((id) => [id, document.querySelector("#" + id)]));

const hashWork = location.hash.match(/^#work=(.*)$/u);
let view = hashWork ? "workbench" : "reference";
let selected = decodeURIComponent(
  hashWork?.[1] ?? location.hash.replace(/^#(?:group|root)=/u, ""),
);
if (view === "reference" && !groupById.has(selected)) {
  selected = referenceGroups[0]
    ? referenceGroups[0].library.id + "/" + referenceGroups[0].id
    : "";
}
if (view === "workbench" && !workById.has(selected)) selected = workItems[0]?.id ?? "";

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
  elements["workbench-view"].classList.toggle("active", view === "workbench");
  elements.availability.hidden = view !== "reference";
  elements.disposition.hidden = view !== "workbench";
  if (view === "reference") renderReference();
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

function renderLeanCards(targetIds, { showRuntime = false } = {}) {
  const rendered = [];
  for (const id of targetIds) {
    const target = targetById.get(id);
    if (target === undefined) continue;
    const declarations = preferredPublicEntries(target);
    if (declarations.length === 0) continue;
    rendered.push(...declarations.map((item) =>
      '<article class="binding"><div class="card-head"><span class="card-title">' +
      escapeHtml(item.entry.declaration) + "</span>" +
      sourceLink(item.entry.source, item.entry.module) + "</div>" +
      renderCode(item.entry.type, "lean") +
      (showRuntime
        ? '<details><summary class="note">Compiled boundary evidence</summary><div class="badges">' +
          target.providers.map((provider) => '<span class="badge">' + escapeHtml(provider) + "</span>").join("") +
          "</div>" + renderCode(item.reach.path.join("\n→ "), "lean") + "</details>"
        : "") + "</article>"));
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

function renderGenerationPolicy(group, symbol) {
  const operations = (group.generatedOperations ?? []).filter((operation) =>
    operation.typescript.member === symbol.id);
  if (operations.length === 0) return "";
  return '<details class="generation-policy"><summary>Generated conversion policy</summary>' +
    operations.map((operation) => {
      const receiver = operation.receiver.kind === "global"
        ? "receiver: host global " + operation.receiver.typescriptType
        : modalityText(operation.receiver.argument);
      const arguments_ = operation.arguments.map(modalityText);
      const result = operation.result.modalities;
      const signature = operation.typescript.signaturePolicy;
      return '<article><div class="card-head"><span class="card-title">' +
        escapeHtml(operation.host.target) + '</span><span class="badge">' +
        escapeHtml(operation.effect.id) + '</span></div><div class="policy-flow"><span>' +
        escapeHtml(operation.typescript.member) + '</span><span aria-hidden="true">→</span><span>' +
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
          "</p>") + "</article>";
    }).join("") + "</details>";
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
  const lean = state?.availability === "available"
    ? '<div class="panes"><div class="pane"><div class="pane-title">Upstream TypeScript</div>' +
      renderCode(symbol.display, "typescript") + '</div><div class="pane"><div class="pane-title">Faithful Lean binding</div>' +
      renderLeanCards(state.targets) + "</div></div>"
    : renderCode(symbol.display, "typescript") +
      (state ? '<p class="note">VIR does not currently document a confirmed binding for this entry.</p>' : "");
  return '<details class="binding"><summary><span class="card-title">' + escapeHtml(symbol.id) +
    '</span> <span class="badge">' + escapeHtml(symbol.kind) + "</span> " + inherited + " " +
    availability + '</summary><div class="card-head">' +
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

[elements.search, elements.library, elements.availability, elements.disposition].forEach((element) =>
  element.addEventListener(element === elements.search ? "input" : "change", render));
elements["reference-view"].addEventListener("click", () =>
  selectGroup(groupById.has(selected) ? selected : groupId(referenceGroups[0])));
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
