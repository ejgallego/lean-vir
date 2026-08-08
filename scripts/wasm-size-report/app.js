/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

(() => {
  "use strict";

  const report = globalThis.__virWasmSize;
  if (!report || report.format !== "lean-vir-wasm-size-html") {
    document.body.textContent = "Invalid or missing VIR Wasm size report.";
    return;
  }

  const elements = {
    identity: document.querySelector("#report-identity"),
    summary: document.querySelector("#global-summary"),
    scopeSwitch: document.querySelector("#scope-switch"),
    boundaryViewControl: document.querySelector("#boundary-view-control"),
    viewSwitch: document.querySelector("#view-switch"),
    search: document.querySelector("#node-search"),
    breadcrumbs: document.querySelector("#breadcrumbs"),
    note: document.querySelector("#view-note"),
    treemap: document.querySelector("#treemap"),
    details: document.querySelector("#selection-details"),
    childCount: document.querySelector("#child-count"),
    topChildren: document.querySelector("#top-children"),
    searchSection: document.querySelector("#search-results-section"),
    searchCount: document.querySelector("#search-count"),
    searchResults: document.querySelector("#search-results"),
  };

  const indexes = new Map();
  for (const [view, root] of Object.entries(report.trees)) indexes.set(view, indexTree(root));

  let view = "ownership";
  let current = report.trees[view];
  let selected = current;
  let highlightedId = null;

  renderIdentity();
  renderSummary();
  bindControls();
  restoreHash();
  render();

  function renderIdentity() {
    const build = report.build;
    const parts = [
      `${report.binaries.release.file} + ${report.binaries.debug.file}`,
      build?.target,
      build?.profile ? `${build.profile} ${build.optimization ?? ""}`.trim() : null,
      build?.lean,
      report.revision ? `VIR ${report.revision.slice(0, 12)}` : null,
    ].filter(Boolean);
    elements.identity.textContent = parts.join(" · ");
  }

  function renderSummary() {
    elements.summary.replaceChildren(
      stat(formatBytes(report.binaries.release.rawBytes), "release raw"),
      stat(formatBytes(report.binaries.release.gzipBytes), "release gzip"),
      stat(formatBytes(report.binaries.debug.rawBytes), "debug raw"),
      stat(formatBytes(report.binaries.debug.gzipBytes), "debug gzip"),
      stat(formatPercent(report.attribution.coverage, 2), "Code+Data attributed"),
      stat(report.attribution.symbols.toLocaleString("en-US"), "retained ranges"),
    );
  }

  function bindControls() {
    elements.scopeSwitch.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-scope]");
      if (!button || button.dataset.scope === scopeForView(view)) return;
      setView(button.dataset.scope === "context" ? "runtimeContext" : "ownership");
    });
    elements.viewSwitch.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-view]");
      if (!button || button.dataset.view === view) return;
      setView(button.dataset.view);
    });
    elements.search.addEventListener("input", renderSearch);
    window.addEventListener("hashchange", () => {
      restoreHash();
      render();
    });
  }

  function setView(nextView) {
    if (!report.trees[nextView]) return;
    view = nextView;
    current = report.trees[view];
    selected = current;
    highlightedId = null;
    elements.search.value = "";
    writeHash();
    render();
  }

  function render() {
    const scope = scopeForView(view);
    for (const button of elements.scopeSwitch.querySelectorAll("button[data-scope]")) {
      button.classList.toggle("selected", button.dataset.scope === scope);
    }
    elements.boundaryViewControl.hidden = scope === "context";
    for (const button of elements.viewSwitch.querySelectorAll("button[data-view]")) {
      button.classList.toggle("selected", button.dataset.view === view);
    }
    elements.search.disabled = !searchAvailable(view);
    elements.search.placeholder = view === "ownership"
      ? "package_decl_provider…"
      : view === "runtimeContext"
        ? "environment.cpp.o…"
        : "Search is available in ownership and runtime-context views";
    elements.note.textContent = view === "ownership"
      ? `${formatBytes(report.attribution.attributedBytes)} of ${formatBytes(report.attribution.codeDataBytes)} retained Code+Data bytes have a linker-map owner.`
      : view === "releaseSections"
        ? report.binaries.release.rawBytes < report.binaries.debug.rawBytes
          ? "The stripped release file is the binary shipped by the hosted demo and SDK."
          : "This local build has not produced a distinct stripped release file; run npm run build:site for the deployed profile."
        : view === "debugSections"
          ? "The optimized debug companion retains names and DWARF sections for diagnosis."
          : `${report.runtimeContext.boundaryMembers} of ${report.runtimeContext.members} native runtime archive members have a direct object counterpart in VIR. Green is inside the boundary; gray is outside.`;
    renderBreadcrumbs();
    renderTreemap();
    renderDetails(selected);
    renderTopChildren();
    renderSearch();
  }

  function renderBreadcrumbs() {
    const index = indexes.get(view);
    const path = [];
    let node = current;
    while (node) {
      path.unshift(node);
      node = index.parentById.get(node.id) ?? null;
    }
    elements.breadcrumbs.replaceChildren(...path.flatMap((entry, position) => {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = entry.name;
      button.disabled = entry === current;
      button.addEventListener("click", () => zoomTo(entry));
      return position === 0 ? [button] : [separator(), button];
    }));
  }

  function renderTreemap() {
    elements.treemap.replaceChildren();
    const children = current.children ?? [];
    if (children.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-message";
      empty.textContent = "This is a leaf range; use the breadcrumb to move up.";
      elements.treemap.append(empty);
      return;
    }
    const hueById = new Map();
    children.forEach((child, index) => hueById.set(child.id, hueFor(index)));
    for (const rect of binaryTreemap(children, 0, 0, 100, 100)) {
      const block = makeBlock(rect.node, rect, 0, hueById.get(rect.node.id));
      elements.treemap.append(block);
    }
  }

  function makeBlock(node, rect, depth, hue) {
    const block = document.createElement("div");
    block.className = `map-block depth-${depth}`;
    if (view === "runtimeContext") {
      block.classList.add(
        node.meta?.inVirBoundary
          ? "in-boundary"
          : node.meta?.boundaryMembers > 0
            ? "mixed-boundary"
            : "outside-boundary",
      );
    }
    if (node.id === highlightedId) block.classList.add("highlighted");
    block.dataset.nodeId = node.id;
    block.style.left = `${rect.x}%`;
    block.style.top = `${rect.y}%`;
    block.style.width = `${rect.width}%`;
    block.style.height = `${rect.height}%`;
    block.style.setProperty("--block-hue", String(hue));
    block.setAttribute("role", "button");
    block.tabIndex = 0;
    block.title = `${node.name}\n${formatBytes(node.bytes)} (${formatPercent(node.bytes / current.bytes)} of current view)`;

    const label = document.createElement("span");
    label.className = "block-label";
    const name = document.createElement("strong");
    name.textContent = node.name;
    const size = document.createElement("span");
    size.textContent = formatBytes(node.bytes);
    label.append(name, size);
    if (rect.width < 8 || rect.height < 7) label.classList.add("compact");
    block.append(label);

    block.addEventListener("mouseenter", (event) => {
      event.stopPropagation();
      selected = node;
      renderDetails(node);
    });
    block.addEventListener("click", (event) => {
      event.stopPropagation();
      activateNode(node);
    });
    block.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      event.stopPropagation();
      activateNode(node);
    });

    if (depth === 0 && node.children?.length && rect.width >= 13 && rect.height >= 15) {
      const nested = document.createElement("div");
      nested.className = "nested-map";
      for (const childRect of binaryTreemap(node.children, 0, 0, 100, 100)) {
        nested.append(makeBlock(childRect.node, childRect, 1, hue));
      }
      block.append(nested);
    }
    return block;
  }

  function activateNode(node) {
    selected = node;
    highlightedId = node.id;
    if (node.children?.length) zoomTo(node);
    else {
      renderDetails(node);
      renderTreemap();
    }
  }

  function zoomTo(node) {
    current = node;
    selected = node;
    highlightedId = null;
    writeHash();
    render();
  }

  function renderDetails(node) {
    const reportShare = node.bytes / reportDenominator(view);
    const currentShare = node.bytes / current.bytes;
    const title = document.createElement("h2");
    title.textContent = node.name;
    const kind = document.createElement("p");
    kind.className = "selection-kind";
    kind.textContent = labelKind(node.kind);
    const stats = document.createElement("dl");
    stats.className = "detail-stats";
    appendDetail(stats, view === "runtimeContext" ? "Native archive bytes" : "Retained raw", formatBytes(node.bytes));
    appendDetail(stats, view === "runtimeContext" ? "Share of runtime context" : "Share of binary", formatPercent(reportShare));
    appendDetail(stats, "Share of current", formatPercent(currentShare));
    if (node.gzipBytes != null) appendDetail(stats, "Independent gzip", formatBytes(node.gzipBytes));
    if (node.children) appendDetail(stats, "Children", node.children.length.toLocaleString("en-US"));
    if (node.meta?.section) appendDetail(stats, "Section", node.meta.section);
    if (node.meta?.memberCount) appendDetail(stats, "Archive members", node.meta.memberCount.toLocaleString("en-US"));
    if (node.meta?.boundaryMembers != null) appendDetail(stats, "Inside VIR", node.meta.boundaryMembers.toLocaleString("en-US"));
    if (node.meta?.inVirBoundary != null) appendDetail(stats, "VIR boundary", node.meta.inVirBoundary ? "inside" : "outside");
    if (node.meta?.retainedWasmBytes != null) appendDetail(stats, "Retained in VIR Wasm", formatBytes(node.meta.retainedWasmBytes));
    const source = node.meta?.input;
    const sourceText = source ? document.createElement("p") : null;
    if (sourceText) {
      sourceText.className = "source-path";
      sourceText.textContent = source;
    }
    const note = node.meta?.note ? document.createElement("p") : null;
    if (note) {
      note.className = "detail-note";
      note.textContent = node.meta.note;
    }
    const actions = renderDetailActions(node);
    elements.details.replaceChildren(
      title,
      kind,
      stats,
      ...(sourceText ? [sourceText] : []),
      ...(note ? [note] : []),
      ...(actions ? [actions] : []),
    );
  }

  function renderDetailActions(node) {
    const declarations = node.meta?.surfaceDeclarations ?? [];
    const wasmNodeId = node.meta?.wasmNodeId;
    if (declarations.length === 0 && !wasmNodeId) return null;
    const actions = document.createElement("div");
    actions.className = "detail-actions";
    if (wasmNodeId) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Open retained Wasm object";
      button.addEventListener("click", () => selectTreeNode("ownership", wasmNodeId));
      actions.append(button);
    }
    if (declarations.length > 0) {
      const heading = document.createElement("strong");
      heading.textContent = "Runnable-surface entries";
      actions.append(heading);
      const list = document.createElement("ul");
      for (const declaration of declarations) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = `../surface/#declaration=${encodeURIComponent(declaration.name)}`;
        link.textContent = declaration.name;
        link.title = `${declaration.status} extern in ${declaration.module}`;
        item.append(link, document.createTextNode(` · ${declaration.status}`));
        list.append(item);
      }
      actions.append(list);
    }
    return actions;
  }

  function selectTreeNode(nextView, nodeId) {
    const index = indexes.get(nextView);
    const node = index?.nodeById.get(nodeId);
    if (!node) return;
    view = nextView;
    current = node;
    selected = node;
    highlightedId = null;
    elements.search.value = "";
    writeHash();
    render();
  }

  function renderTopChildren() {
    const children = current.children ?? [];
    elements.childCount.textContent = children.length.toLocaleString("en-US");
    elements.topChildren.replaceChildren(...children.slice(0, 18).map((node) => resultRow(node, current.bytes)));
  }

  function renderSearch() {
    const query = elements.search.value.trim().toLocaleLowerCase();
    if (!searchAvailable(view) || query === "") {
      elements.searchSection.hidden = true;
      elements.searchResults.replaceChildren();
      return;
    }
    const matches = indexes.get(view).nodes
      .filter((node) => node.kind !== "root" && searchableText(node).includes(query))
      .sort((lhs, rhs) => rhs.bytes - lhs.bytes)
      .slice(0, 40);
    elements.searchSection.hidden = false;
    elements.searchCount.textContent = matches.length === 40 ? "40+" : String(matches.length);
    elements.searchResults.replaceChildren(...matches.map((node) => resultRow(node, reportDenominator(view), true)));
  }

  function resultRow(node, denominator, searchResult = false) {
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const label = document.createElement("span");
    label.textContent = node.name;
    const value = document.createElement("span");
    value.textContent = `${formatBytes(node.bytes)} · ${formatPercent(node.bytes / denominator)}`;
    button.append(label, value);
    button.addEventListener("click", () => {
      if (searchResult && !node.children?.length) {
        const parent = indexes.get(view).parentById.get(node.id);
        if (parent) current = parent;
        selected = node;
        highlightedId = node.id;
        writeHash();
        render();
        return;
      }
      zoomTo(node);
    });
    row.append(button);
    return row;
  }

  function writeHash() {
    const params = new URLSearchParams({ view, node: current.id });
    const query = elements.search.value.trim();
    if (query) params.set("query", query);
    const next = `#${params}`;
    if (window.location.hash !== next) history.replaceState(null, "", next);
  }

  function restoreHash() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const requestedView = params.get("view");
    if (report.trees[requestedView]) view = requestedView;
    const index = indexes.get(view);
    current = index.nodeById.get(params.get("node")) ?? report.trees[view];
    selected = current;
    highlightedId = null;
    elements.search.value = params.get("query") ?? "";
  }

  function indexTree(root) {
    const nodeById = new Map();
    const parentById = new Map();
    const nodes = [];
    const visit = (node, parent) => {
      nodeById.set(node.id, node);
      nodes.push(node);
      if (parent) parentById.set(node.id, parent);
      for (const child of node.children ?? []) visit(child, node);
    };
    visit(root, null);
    return { nodeById, parentById, nodes };
  }

  function binaryTreemap(nodes, x, y, width, height) {
    const positive = nodes.filter((node) => node.bytes > 0);
    if (positive.length === 0) return [];
    if (positive.length === 1) return [{ node: positive[0], x, y, width, height }];
    const total = positive.reduce((sum, node) => sum + node.bytes, 0);
    let split = 1;
    let leftBytes = positive[0].bytes;
    let bestDistance = Math.abs(total / 2 - leftBytes);
    for (let index = 2; index < positive.length; index += 1) {
      const nextBytes = leftBytes + positive[index - 1].bytes;
      const distance = Math.abs(total / 2 - nextBytes);
      if (distance > bestDistance) break;
      leftBytes = nextBytes;
      bestDistance = distance;
      split = index;
    }
    const ratio = leftBytes / total;
    if (width >= height) {
      const leftWidth = width * ratio;
      return [
        ...binaryTreemap(positive.slice(0, split), x, y, leftWidth, height),
        ...binaryTreemap(positive.slice(split), x + leftWidth, y, width - leftWidth, height),
      ];
    }
    const topHeight = height * ratio;
    return [
      ...binaryTreemap(positive.slice(0, split), x, y, width, topHeight),
      ...binaryTreemap(positive.slice(split), x, y + topHeight, width, height - topHeight),
    ];
  }

  function stat(value, label) {
    const wrapper = document.createElement("div");
    wrapper.className = "header-stat";
    const strong = document.createElement("strong");
    strong.textContent = value;
    const span = document.createElement("span");
    span.textContent = label;
    wrapper.append(strong, span);
    return wrapper;
  }

  function appendDetail(list, label, value) {
    const term = document.createElement("dt");
    term.textContent = label;
    const detail = document.createElement("dd");
    detail.textContent = value;
    list.append(term, detail);
  }

  function separator() {
    const span = document.createElement("span");
    span.textContent = "/";
    span.setAttribute("aria-hidden", "true");
    return span;
  }

  function searchableText(node) {
    return [
      node.name,
      node.meta?.rawName,
      node.meta?.input,
      node.meta?.archive,
      ...(node.meta?.surfaceDeclarations ?? []).map((declaration) => declaration.name),
    ].filter(Boolean).join(" ").toLocaleLowerCase();
  }

  function labelKind(kind) {
    return ({
      root: "report root",
      area: "ownership area",
      object: "linked object",
      symbol: "retained linker range",
      section: "Wasm section",
      archive: "installed Lean native archive",
      runtimeMember: "native archive member",
    })[kind] ?? kind;
  }

  function scopeForView(activeView) {
    return activeView === "runtimeContext" ? "context" : "boundary";
  }

  function searchAvailable(activeView) {
    return activeView === "ownership" || activeView === "runtimeContext";
  }

  function reportDenominator(activeView) {
    if (activeView === "runtimeContext") return report.runtimeContext.memberBytes;
    return activeView === "debugSections"
      ? report.binaries.debug.rawBytes
      : report.binaries.release.rawBytes;
  }

  function hueFor(index) {
    const hues = [172, 210, 36, 268, 12, 326, 92, 188, 52, 238, 144, 292, 0, 118, 64];
    return hues[index % hues.length];
  }

  function formatBytes(bytes) {
    if (bytes < 1024) return `${bytes.toLocaleString("en-US")} B`;
    if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KiB`;
    return `${(bytes / 1024 ** 2).toFixed(2)} MiB`;
  }

  function formatPercent(ratio, digits = 1) {
    if (!Number.isFinite(ratio)) return "0%";
    if (ratio > 0 && ratio < 0.001) return "<0.1%";
    return `${(ratio * 100).toFixed(digits)}%`;
  }
})();
