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
    contextColorControl: document.querySelector("#context-color-control"),
    contextColorSwitch: document.querySelector("#context-color-switch"),
    mapDepthControl: document.querySelector("#map-depth-control"),
    mapDepth: document.querySelector("#map-depth"),
    mapDepthValue: document.querySelector("#map-depth-value"),
    viewSwitch: document.querySelector("#view-switch"),
    search: document.querySelector("#node-search"),
    breadcrumbs: document.querySelector("#breadcrumbs"),
    note: document.querySelector("#view-note"),
    runtimeCoverage: document.querySelector("#runtime-coverage"),
    runtimeCoverageTitle: document.querySelector("#runtime-coverage-title"),
    runtimeCoverageDescription: document.querySelector("#runtime-coverage-description"),
    runtimeCoveragePercent: document.querySelector("#runtime-coverage-percent"),
    runtimeCoverageFill: document.querySelector("#runtime-coverage-fill"),
    runtimeCoverageFacts: document.querySelector("#runtime-coverage-facts"),
    colorLegend: document.querySelector("#color-legend"),
    colorLegendTitle: document.querySelector("#color-legend-title"),
    colorLegendMin: document.querySelector("#color-legend-min"),
    colorLegendMax: document.querySelector("#color-legend-max"),
    treemap: document.querySelector("#treemap"),
    details: document.querySelector("#selection-details"),
    childListTitle: document.querySelector("#child-list-title"),
    childCount: document.querySelector("#child-count"),
    topChildren: document.querySelector("#top-children"),
    searchSection: document.querySelector("#search-results-section"),
    searchCount: document.querySelector("#search-count"),
    searchResults: document.querySelector("#search-results"),
    frontierCostPanel: document.querySelector("#frontier-cost-panel"),
    frontierCostBaseline: document.querySelector("#frontier-cost-baseline"),
    frontierCostRows: document.querySelector("#frontier-cost-rows"),
  };

  const indexes = new Map();
  const visibleDepthCache = new WeakMap();
  for (const [view, root] of Object.entries(report.trees)) indexes.set(view, indexTree(root));
  const runtimeWasmNodeIds = new Set(indexes.get("runtimeContext")?.nodes
    .map((node) => node.meta?.wasmNodeId)
    .filter(Boolean) ?? []);
  const contextOverlapLeaves = indexes.get("runtimeContext")?.nodes.filter((node) =>
    !node.children?.length
      && (node.meta?.boundaryDensity ?? 0) > 0
      && (node.meta?.frontierDensity ?? 0) > 0).length ?? 0;
  const nativeContextNode = report.trees.runtimeContext.children?.find((node) =>
    node.meta?.layer === "native") ?? null;
  const defaultVisibleDepth = {
    ownership: 2,
    releaseSections: 1,
    debugSections: 1,
    runtimeContext: 4,
  };
  const visibleDepthByView = new Map(Object.entries(report.trees).map(([name, root]) => [
    name,
    Math.min(defaultVisibleDepth[name] ?? 1, Math.max(1, treeVisibleDepth(root))),
  ]));

  let view = "ownership";
  let current = report.trees[view];
  let selected = current;
  let highlightedId = null;
  let contextColor = "boundary";
  let scheduledTreemapFrame = null;
  let scopeTransitionBlocks = [];

  renderIdentity();
  renderSummary();
  renderFrontierCosts();
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

  function renderFrontierCosts() {
    const costs = report.frontierCosts;
    if (!costs || costs.candidates.length === 0) return;
    elements.frontierCostPanel.hidden = false;
    elements.frontierCostBaseline.textContent =
      `${formatBytes(costs.baseline.rawBytes)} raw / ${formatBytes(costs.baseline.gzipBytes)} gzip baseline`;
    const rows = costs.candidates.map((candidate) => {
      const row = document.createElement("tr");
      const id = document.createElement("td");
      id.textContent = candidate.id;
      const names = document.createElement("td");
      names.className = "frontier-cost-names";
      candidate.names.forEach((name, index) => {
        if (index > 0) names.append(document.createTextNode(", "));
        const link = document.createElement("a");
        link.href = `../surface/#declaration=${encodeURIComponent(name)}`;
        link.textContent = name;
        names.append(link);
      });
      const raw = document.createElement("td");
      raw.className = "numeric";
      raw.textContent = candidate.error ? "error" : formatBytes(candidate.rawDeltaBytes);
      const gzip = document.createElement("td");
      gzip.className = "numeric";
      gzip.textContent = candidate.error ? "error" : formatBytes(candidate.gzipDeltaBytes);
      const pressure = document.createElement("td");
      pressure.className = "numeric";
      pressure.textContent =
        `${candidate.primaryPublicRoots.toLocaleString("en-US")} public / ` +
        `${candidate.primaryRoots.toLocaleString("en-US")} all`;
      row.append(id, names, raw, gzip, pressure);
      return row;
    });
    elements.frontierCostRows.replaceChildren(...rows);
  }

  function bindControls() {
    elements.scopeSwitch.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-scope]");
      if (!button || button.dataset.scope === scopeForView(view)) return;
      setScopeView(button.dataset.scope === "context" ? "runtimeContext" : "ownership");
    });
    elements.viewSwitch.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-view]");
      if (!button || button.dataset.view === view) return;
      setView(button.dataset.view);
    });
    elements.contextColorSwitch.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-context-color]");
      if (!button || button.dataset.contextColor === contextColor) return;
      contextColor = button.dataset.contextColor;
      writeHash();
      renderContextColor();
    });
    elements.treemap.addEventListener("pointerover", (event) => {
      const node = treemapNodeForEvent(event);
      if (!node) return;
      if (view === "runtimeContext") renderRuntimeCoverage(node);
      if (node === selected) return;
      selected = node;
      renderDetails(node);
    });
    elements.treemap.addEventListener("pointerleave", () => renderRuntimeCoverage());
    elements.treemap.addEventListener("focusin", (event) => {
      const node = treemapNodeForEvent(event);
      if (view === "runtimeContext" && node) renderRuntimeCoverage(node);
    });
    elements.treemap.addEventListener("focusout", (event) => {
      if (!elements.treemap.contains(event.relatedTarget)) renderRuntimeCoverage();
    });
    elements.treemap.addEventListener("click", (event) => {
      const node = treemapNodeForEvent(event);
      if (!node) return;
      activateNode(node);
    });
    elements.treemap.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      const node = treemapNodeForEvent(event);
      if (!node) return;
      event.preventDefault();
      activateNode(node);
    });
    elements.mapDepth.addEventListener("input", () => {
      visibleDepthByView.set(view, Number(elements.mapDepth.value));
      renderDepthControl();
      writeHash();
      scheduleTreemapRender();
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

  function setScopeView(nextView) {
    const reducedMotion = globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || typeof document.startViewTransition !== "function") {
      setView(nextView);
      return;
    }
    const sharedWasmNodeIds = applyScopeTransitionNames();
    const transition = document.startViewTransition(() => {
      setView(nextView);
      applyScopeTransitionNames(sharedWasmNodeIds);
    });
    transition.finished.then(clearScopeTransitionNames, clearScopeTransitionNames);
  }

  function applyScopeTransitionNames(allowedWasmNodeIds = null) {
    clearScopeTransitionNames();
    const candidates = Array.from(elements.treemap.querySelectorAll(".map-block[data-wasm-node-id]"))
      .map((block) => {
        const rect = block.getBoundingClientRect();
        return { block, wasmNodeId: block.dataset.wasmNodeId, area: rect.width * rect.height };
      })
      .filter((entry) => entry.area >= 64
        && (allowedWasmNodeIds === null || allowedWasmNodeIds.has(entry.wasmNodeId)))
      .sort((lhs, rhs) => rhs.area - lhs.area);
    const selectedWasmNodeIds = new Set();
    for (const entry of candidates) {
      if (selectedWasmNodeIds.has(entry.wasmNodeId)) continue;
      entry.block.style.viewTransitionName = `vir-shared-${entry.wasmNodeId}`;
      scopeTransitionBlocks.push(entry.block);
      selectedWasmNodeIds.add(entry.wasmNodeId);
      if (allowedWasmNodeIds === null && selectedWasmNodeIds.size >= 28) break;
    }
    return selectedWasmNodeIds;
  }

  function clearScopeTransitionNames() {
    for (const block of scopeTransitionBlocks) block.style.removeProperty("view-transition-name");
    scopeTransitionBlocks = [];
  }

  function render() {
    const scope = scopeForView(view);
    for (const button of elements.scopeSwitch.querySelectorAll("button[data-scope]")) {
      button.classList.toggle("selected", button.dataset.scope === scope);
    }
    elements.boundaryViewControl.hidden = scope === "context";
    elements.runtimeCoverage.hidden = scope !== "context" || nativeContextNode == null;
    renderDepthControl();
    elements.contextColorControl.hidden = scope !== "context"
      || report.runtimeContext.connectedSurfaceEntries === 0;
    for (const button of elements.contextColorSwitch.querySelectorAll("button[data-context-color]")) {
      button.classList.toggle("selected", button.dataset.contextColor === contextColor);
    }
    for (const button of elements.viewSwitch.querySelectorAll("button[data-view]")) {
      button.classList.toggle("selected", button.dataset.view === view);
    }
    elements.search.disabled = !searchAvailable(view);
    elements.search.placeholder = view === "ownership"
      ? "package_decl_provider…"
      : view === "runtimeContext"
        ? "environment.cpp.o…"
        : "Search is available in ownership and runtime-context views";
    elements.note.textContent = viewNote();
    renderRuntimeCoverage();
    renderColorLegend();
    renderBreadcrumbs();
    renderTreemap();
    renderDetails(selected);
    renderTopChildren();
    renderSearch();
  }

  function viewNote() {
    if (view === "ownership") {
      return `${formatBytes(report.attribution.attributedBytes)} of ${formatBytes(report.attribution.codeDataBytes)} retained Code+Data bytes have a linker-map owner.`;
    }
    if (view === "releaseSections") {
      return report.binaries.release.rawBytes < report.binaries.debug.rawBytes
        ? "The stripped release file is the binary shipped by the hosted demo and SDK."
        : "This local build has not produced a distinct stripped release file; run npm run build:site for the deployed profile.";
    }
    if (view === "debugSections") {
      return "The optimized debug companion retains names and DWARF sections for diagnosis.";
    }
    if (contextColor === "frontier") {
      return `${report.runtimeContext.missingSurfaceEntries} of ${report.runtimeContext.totalMissingSurfaceEntries} missing externs map to exact providers in this installed archive slice. They are primary blockers for ${report.runtimeContext.primaryPublicRoots} public / ${report.runtimeContext.primaryRoots} all roots. Area is native archive bytes; color is log-scaled blocker density, averaged by child bytes, not predicted unlock.`;
    }
    if (contextColor === "combined") {
      return `Green marks exact retained native-function bytes, orange marks log-scaled frontier pressure, purple marks overlap, and gray marks neither. ${report.runtimeContext.missingSurfaceEntries} of ${report.runtimeContext.totalMissingSurfaceEntries} missing externs have providers in this archive slice; ${contextOverlapLeaves} leaf functions currently have both signals because retention and extern-catalog exposure are separate boundaries.`;
    }
    return `${report.runtimeContext.retainedFunctions} of ${report.runtimeContext.boundarySizedFunctions} sized functions in VIR object counterparts match exact retained Wasm symbols. Color is matched native-function bytes per archive byte, averaged from child blocks.`;
  }

  function renderColorLegend() {
    elements.colorLegend.hidden = view !== "runtimeContext";
    if (view !== "runtimeContext") return;
    const frontier = contextColor === "frontier";
    const combined = contextColor === "combined";
    elements.colorLegend.classList.toggle("frontier", frontier);
    elements.colorLegend.classList.toggle("combined", combined);
    elements.colorLegend.classList.toggle("boundary", !frontier && !combined);
    elements.colorLegendTitle.textContent = combined
      ? "Green retained · orange pressure · purple overlap"
      : frontier
        ? "Blocker density · log color scale"
        : "Exact retained-function byte density";
    elements.colorLegendMin.textContent = combined ? "neither" : frontier ? "0 roots / MiB" : "0%";
    elements.colorLegendMax.textContent = combined
      ? "both"
      : frontier
        ? formatDensity(report.runtimeContext.maxFrontierDensity)
        : "100%";
  }

  function renderRuntimeCoverage(node = nativeContextNode) {
    if (!nativeContextNode) return;
    if (view !== "runtimeContext" || !node) node = nativeContextNode;
    const meta = node.meta ?? {};
    const isFunction = node.kind === "runtimeFunction";
    const functionCount = meta.functionCount ?? (isFunction ? 1 : 0);
    const functionBytes = meta.functionBytes ?? (isFunction ? node.bytes : 0);
    const retainedFunctionCount = meta.retainedFunctionCount
      ?? (isFunction && meta.inVirBoundary ? 1 : 0);
    const retainedBytes = meta.retainedNativeFunctionBytes
      ?? (isFunction && meta.inVirBoundary ? node.bytes : 0);
    const nodeBytes = node.bytes;
    const archiveRatio = nodeBytes > 0 ? retainedBytes / nodeBytes : 0;
    elements.runtimeCoverageTitle.textContent = node === nativeContextNode
      ? "Full Lean native support"
      : node.name;
    elements.runtimeCoveragePercent.value = formatPercent(archiveRatio);
    elements.runtimeCoverageFill.style.width = `${clampUnit(archiveRatio) * 100}%`;
    elements.runtimeCoverageDescription.textContent =
      `${formatBytes(retainedBytes)} / ${formatBytes(nodeBytes)} have exact retained Wasm counterparts`;
    elements.runtimeCoverageFacts.replaceChildren(
      functionCount > 0
        ? coverageFact(
          `${retainedFunctionCount.toLocaleString("en-US")} / ${functionCount.toLocaleString("en-US")}`,
          `functions · ${formatPercent(retainedFunctionCount / functionCount)}`,
        )
        : coverageFact("No sized functions", "non-function archive bytes"),
      functionBytes > 0
        ? coverageFact(
          `${formatBytes(retainedBytes)} / ${formatBytes(functionBytes)}`,
          `function bytes · ${formatPercent(retainedBytes / functionBytes)}`,
        )
        : coverageFact(formatBytes(node.bytes), "non-function / overhead"),
    );
  }

  function renderContextColor() {
    for (const button of elements.contextColorSwitch.querySelectorAll("button[data-context-color]")) {
      button.classList.toggle("selected", button.dataset.contextColor === contextColor);
    }
    elements.note.textContent = viewNote();
    renderColorLegend();
    for (const block of elements.treemap.querySelectorAll(".map-block")) {
      const node = indexes.get(view).nodeById.get(block.dataset.nodeId);
      if (node) applyContextColor(block, node);
    }
    renderDetails(selected);
    renderTopChildren();
  }

  function renderDepthControl() {
    const localDepth = treeVisibleDepth(current);
    const maximum = Math.max(1, localDepth);
    const preferred = visibleDepthByView.get(view) ?? 1;
    const active = Math.min(preferred, maximum);
    elements.mapDepth.min = "1";
    elements.mapDepth.max = String(maximum);
    elements.mapDepth.value = String(active);
    elements.mapDepth.disabled = localDepth === 0;
    elements.mapDepthValue.value = localDepth === 0 ? "leaf" : `${active} / ${maximum}`;
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
    if (scheduledTreemapFrame !== null) {
      cancelAnimationFrame(scheduledTreemapFrame);
      scheduledTreemapFrame = null;
    }
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
    const maximumNestedDepth = visibleDepthForCurrent() - 2;
    const mapWidth = elements.treemap.clientWidth;
    const mapHeight = elements.treemap.clientHeight;
    const markup = [];
    for (const rect of binaryTreemap(children, 0, 0, 100, 100)) {
      markup.push(makeBlockMarkup(
        rect.node,
        rect,
        0,
        hueById.get(rect.node.id),
        maximumNestedDepth,
        mapWidth * rect.width / 100,
        mapHeight * rect.height / 100,
      ));
    }
    elements.treemap.innerHTML = markup.join("");
  }

  function scheduleTreemapRender() {
    if (scheduledTreemapFrame !== null) cancelAnimationFrame(scheduledTreemapFrame);
    scheduledTreemapFrame = requestAnimationFrame(() => {
      scheduledTreemapFrame = null;
      renderTreemap();
    });
  }

  function makeBlockMarkup(
    node,
    rect,
    depth,
    hue,
    maximumNestedDepth,
    pixelWidth,
    pixelHeight,
  ) {
    const classes = ["map-block", `depth-${depth}`];
    const properties = [
      `left:${rect.x}%`,
      `top:${rect.y}%`,
      `width:${rect.width}%`,
      `height:${rect.height}%`,
      `--block-hue:${hue}`,
    ];
    if (view === "runtimeContext") {
      const presentation = contextColorPresentation(node);
      classes.push(...presentation.classes);
      properties.push(...presentation.properties);
    }
    if (node.id === highlightedId) classes.push("highlighted");
    const contents = [];
    if (pixelWidth >= 18 && pixelHeight >= 14) {
      const labelClass = pixelWidth < 72 || pixelHeight < 34
        ? "block-label compact"
        : "block-label";
      contents.push(
        `<span class="${labelClass}"><strong>${escapeHtml(node.name)}</strong>`
          + `<span>${escapeHtml(formatBytes(node.bytes))}</span></span>`,
      );
    }
    const minimumNestedPixelWidth = depth === 0 ? 44 : 36;
    const minimumNestedPixelHeight = depth === 0 ? 54 : 40;
    const minimumNestedShareWidth = depth === 0 ? 13 : 17;
    const minimumNestedShareHeight = depth === 0 ? 15 : 19;
    const hasNestedPixels = pixelWidth >= minimumNestedPixelWidth
      && pixelHeight >= minimumNestedPixelHeight;
    const hasNestedShare = rect.width >= minimumNestedShareWidth
      && rect.height >= minimumNestedShareHeight;
    if (
      depth <= maximumNestedDepth
      && node.children?.length
      && (hasNestedPixels || hasNestedShare)
    ) {
      const nestedWidth = Math.max(0, pixelWidth - (depth === 0 ? 6 : 4));
      const nestedHeight = Math.max(0, pixelHeight - (depth === 0 ? 41 : 31));
      const nested = [];
      for (const childRect of binaryTreemap(node.children, 0, 0, 100, 100)) {
        nested.push(makeBlockMarkup(
          childRect.node,
          childRect,
          depth + 1,
          hue,
          maximumNestedDepth,
          nestedWidth * childRect.width / 100,
          nestedHeight * childRect.height / 100,
        ));
      }
      contents.push(`<div class="nested-map">${nested.join("")}</div>`);
    }
    const title = `${node.name}\n${formatBytes(node.bytes)} (${formatPercent(node.bytes / current.bytes)} of current view)`;
    const wasmNodeId = view === "runtimeContext"
      ? node.meta?.wasmNodeId
      : runtimeWasmNodeIds.has(node.id)
        ? node.id
        : null;
    const wasmNodeAttribute = wasmNodeId
      ? ` data-wasm-node-id="${escapeAttribute(wasmNodeId)}"`
      : "";
    return `<div class="${classes.join(" ")}" data-node-id="${escapeAttribute(node.id)}"${wasmNodeAttribute}`
      + ` style="${properties.join(";")}" role="button" tabindex="0"`
      + ` aria-label="${escapeAttribute(`${node.name}, ${formatBytes(node.bytes)}`)}"`
      + ` title="${escapeAttribute(title)}">${contents.join("")}</div>`;
  }

  function applyContextColor(block, node) {
    block.classList.remove(
      "in-boundary",
      "mixed-boundary",
      "outside-boundary",
      "frontier-pressure",
      "no-frontier-pressure",
      "combined-context",
      "combined-boundary",
      "combined-frontier",
      "combined-overlap",
      "combined-neither",
    );
    block.style.removeProperty("--boundary-percent");
    block.style.removeProperty("--frontier-lightness");
    block.style.removeProperty("--frontier-saturation");
    block.style.removeProperty("--combined-color");
    const presentation = contextColorPresentation(node);
    block.classList.add(...presentation.classes);
    for (const property of presentation.properties) {
      const separator = property.indexOf(":");
      block.style.setProperty(property.slice(0, separator), property.slice(separator + 1));
    }
  }

  function contextColorPresentation(node) {
    const boundaryDensity = clampUnit(node.meta?.boundaryDensity ?? 0);
    const frontierIntensity = frontierColorIntensity(node.meta?.frontierDensity ?? 0);
    if (contextColor === "frontier") {
      return {
        classes: [frontierIntensity > 0 ? "frontier-pressure" : "no-frontier-pressure"],
        properties: [
          `--frontier-lightness:${94 - frontierIntensity * 49}`,
          `--frontier-saturation:${34 + frontierIntensity * 48}`,
        ],
      };
    }
    if (contextColor === "combined") {
      return {
        classes: [
          "combined-context",
          boundaryDensity > 0 && frontierIntensity > 0
            ? "combined-overlap"
            : boundaryDensity > 0
              ? "combined-boundary"
              : frontierIntensity > 0
                ? "combined-frontier"
                : "combined-neither",
        ],
        properties: [`--combined-color:${combinedContextColor(boundaryDensity, frontierIntensity)}`],
      };
    }
    return {
      classes: [
        boundaryDensity >= 1 - Number.EPSILON
          ? "in-boundary"
          : boundaryDensity > 0
            ? "mixed-boundary"
            : "outside-boundary",
      ],
      properties: [`--boundary-percent:${boundaryDensity * 100}%`],
    };
  }

  function treemapNodeForEvent(event) {
    const block = event.target.closest?.(".map-block");
    if (!block || !elements.treemap.contains(block)) return null;
    return indexes.get(view).nodeById.get(block.dataset.nodeId) ?? null;
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
    const byteLabel = node.kind === "runtimeFunction"
      ? "Sized function bytes"
      : node.kind === "runtimeOverhead"
        ? "Non-function / overhead bytes"
        : view === "runtimeContext"
          ? "Native archive bytes"
          : "Retained raw";
    appendDetail(stats, byteLabel, formatBytes(node.bytes));
    appendDetail(stats, view === "runtimeContext" ? "Share of runtime context" : "Share of binary", formatPercent(reportShare));
    appendDetail(stats, "Share of current", formatPercent(currentShare));
    if (node.gzipBytes != null) appendDetail(stats, "Independent gzip", formatBytes(node.gzipBytes));
    if (node.children) appendDetail(stats, "Children", node.children.length.toLocaleString("en-US"));
    if (node.meta?.section) appendDetail(stats, "Section", node.meta.section);
    if (node.meta?.memberCount) appendDetail(stats, "Archive members", node.meta.memberCount.toLocaleString("en-US"));
    if (node.meta?.functionCount != null) {
      appendDetail(stats, "Sized functions", node.meta.functionCount.toLocaleString("en-US"));
    }
    if (node.meta?.functionBytes != null) {
      appendDetail(stats, "Function bytes", formatBytes(node.meta.functionBytes));
    }
    if (node.meta?.overheadBytes != null) {
      appendDetail(stats, "Non-function / overhead", formatBytes(node.meta.overheadBytes));
    }
    if (node.meta?.retainedFunctionCount != null) {
      appendDetail(
        stats,
        "Retained functions",
        `${node.meta.retainedFunctionCount.toLocaleString("en-US")} / ${node.meta.functionCount.toLocaleString("en-US")}`,
      );
    }
    if (node.meta?.retainedNativeFunctionBytes != null) {
      appendDetail(
        stats,
        "Matched native function bytes",
        formatBytes(node.meta.retainedNativeFunctionBytes),
      );
    }
    if (node.meta?.retainedWasmFunctionBytes != null) {
      appendDetail(
        stats,
        "Retained Wasm function bytes",
        formatBytes(node.meta.retainedWasmFunctionBytes),
      );
    }
    if (node.meta?.boundaryMembers != null) appendDetail(stats, "Inside VIR", node.meta.boundaryMembers.toLocaleString("en-US"));
    if (node.kind === "runtimeMember") {
      appendDetail(stats, "VIR object counterpart", node.meta.inVirBoundary ? "yes" : "no");
    } else if (node.kind === "runtimeFunction") {
      appendDetail(stats, "Retained in VIR Wasm", node.meta.inVirBoundary ? "yes" : "no");
    } else if (node.meta?.inVirBoundary != null) {
      appendDetail(stats, "VIR boundary", node.meta.inVirBoundary ? "inside" : "outside");
    }
    if (node.meta?.retainedWasmBytes != null) appendDetail(stats, "Retained in VIR Wasm", formatBytes(node.meta.retainedWasmBytes));
    if (node.meta?.archive) appendDetail(stats, "Archive", node.meta.archive);
    if (node.meta?.archiveIndex) appendDetail(stats, "Archive position", `#${node.meta.archiveIndex}`);
    if (node.meta?.memberName) appendDetail(stats, "Archive member", node.meta.memberName);
    if (node.meta?.rawName) appendDetail(stats, "Raw symbol", node.meta.rawName);
    if (node.meta?.rawAliases?.length > 1) {
      appendDetail(stats, "Symbol aliases", node.meta.rawAliases.length.toLocaleString("en-US"));
    }
    if (node.kind === "runtimeMember") {
      const functions = node.children?.filter((child) => child.kind === "runtimeFunction") ?? [];
      const pressured = functions.filter((child) =>
        (child.meta?.surfaceSummary?.primaryRoots ?? 0) > 0);
      const overlap = pressured.filter((child) => child.meta.inVirBoundary);
      appendDetail(stats, "Functions with blocker pressure", pressured.length.toLocaleString("en-US"));
      appendDetail(stats, "Retained + blocker overlap", overlap.length.toLocaleString("en-US"));
    }
    const surface = node.meta?.surfaceSummary;
    if (surface) {
      appendDetail(stats, "Surface entries", surface.entries.toLocaleString("en-US"));
      appendDetail(stats, "Native / missing", `${surface.nativeEntries} / ${surface.missingEntries}`);
      if (surface.primaryRoots > 0) {
        appendDetail(
          stats,
          "Primary blocker pressure",
          `${surface.primaryPublicRoots} public / ${surface.primaryRoots} all`,
        );
      }
    }
    if (view === "runtimeContext" && node.meta?.frontierDensity != null) {
      appendDetail(stats, "Blocker density", formatDensity(node.meta.frontierDensity));
      appendDetail(
        stats,
        "Retained-function byte density",
        formatPercent(node.meta.boundaryDensity ?? 0),
      );
    }
    const source = node.meta?.source ?? node.meta?.input;
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
    const highlights = node.kind === "runtimeMember"
      ? renderRuntimeMemberHighlights(node)
      : null;
    elements.details.replaceChildren(
      title,
      kind,
      stats,
      ...(sourceText ? [sourceText] : []),
      ...(note ? [note] : []),
      ...(highlights ? [highlights] : []),
      ...(actions ? [actions] : []),
    );
  }

  function renderRuntimeMemberHighlights(node) {
    const functions = node.children?.filter((child) => child.kind === "runtimeFunction") ?? [];
    if (functions.length === 0) return null;
    const groups = [
      {
        title: "Largest native functions",
        entries: [...functions].sort((lhs, rhs) => rhs.bytes - lhs.bytes).slice(0, 5),
        value: (entry) => formatBytes(entry.bytes),
      },
      {
        title: "Highest frontier pressure",
        entries: functions
          .filter((entry) => (entry.meta?.surfaceSummary?.primaryRoots ?? 0) > 0)
          .sort((lhs, rhs) =>
            rhs.meta.surfaceSummary.primaryPublicRoots - lhs.meta.surfaceSummary.primaryPublicRoots
              || rhs.meta.surfaceSummary.primaryRoots - lhs.meta.surfaceSummary.primaryRoots
              || rhs.bytes - lhs.bytes)
          .slice(0, 5),
        value: (entry) => {
          const summary = entry.meta.surfaceSummary;
          return `${summary.primaryPublicRoots} public · ${summary.primaryRoots} all`;
        },
      },
      {
        title: "Retained in VIR Wasm",
        entries: functions
          .filter((entry) => entry.meta.inVirBoundary)
          .sort((lhs, rhs) => rhs.meta.retainedWasmBytes - lhs.meta.retainedWasmBytes)
          .slice(0, 5),
        value: (entry) =>
          `${formatBytes(entry.bytes)} native · ${formatBytes(entry.meta.retainedWasmBytes)} Wasm`,
      },
    ].filter((group) => group.entries.length > 0);
    if (groups.length === 0) return null;
    const highlights = document.createElement("div");
    highlights.className = "detail-highlights";
    for (const group of groups) {
      const section = document.createElement("section");
      const heading = document.createElement("h3");
      heading.textContent = group.title;
      const list = document.createElement("ul");
      for (const entry of group.entries) {
        const item = document.createElement("li");
        const button = document.createElement("button");
        button.type = "button";
        const label = document.createElement("span");
        label.textContent = entry.name;
        const value = document.createElement("span");
        value.textContent = group.value(entry);
        button.append(label, value);
        button.addEventListener("click", () => {
          selected = entry;
          highlightedId = entry.id;
          renderDetails(entry);
          renderTreemap();
        });
        item.append(button);
        list.append(item);
      }
      section.append(heading, list);
      highlights.append(section);
    }
    return highlights;
  }

  function renderDetailActions(node) {
    const declarations = [
      "symbol",
      "runtimeMember",
      "runtimeFunction",
      "runtimeOverhead",
    ].includes(node.kind)
      ? node.meta?.surfaceDeclarations ?? []
      : [];
    const wasmNodeId = node.meta?.wasmNodeId;
    if (declarations.length === 0 && !wasmNodeId) return null;
    const actions = document.createElement("div");
    actions.className = "detail-actions";
    if (wasmNodeId) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = node.kind === "runtimeFunction"
        ? "Open retained Wasm symbol"
        : "Open retained Wasm object";
      button.addEventListener("click", () => selectTreeNode("ownership", wasmNodeId));
      actions.append(button);
    }
    if (declarations.length > 0) {
      const heading = document.createElement("strong");
      heading.textContent = "Runnable-surface entries";
      actions.append(heading);
      const list = document.createElement("ul");
      const ordered = [...declarations].sort((lhs, rhs) =>
        Number(rhs.status === "missing") - Number(lhs.status === "missing")
          || rhs.primaryRoots - lhs.primaryRoots
          || lhs.name.localeCompare(rhs.name));
      for (const declaration of ordered.slice(0, 24)) {
        const item = document.createElement("li");
        const link = document.createElement("a");
        link.href = `../surface/#declaration=${encodeURIComponent(declaration.name)}`;
        link.textContent = declaration.name;
        link.title = `${declaration.status} extern in ${declaration.module}`;
        item.append(link, document.createTextNode(` · ${declaration.status}`));
        const isolated = declaration.frontierCosts?.find((candidate) =>
          candidate.names.length === 1 && !candidate.error);
        if (isolated) {
          item.append(document.createTextNode(
            ` · +${formatBytes(isolated.rawDeltaBytes)} raw / +${formatBytes(isolated.gzipDeltaBytes)} gzip`,
          ));
        }
        list.append(item);
      }
      actions.append(list);
      if (ordered.length > 24) {
        const remainder = document.createElement("p");
        remainder.className = "detail-actions-remainder";
        remainder.textContent = `${ordered.length - 24} additional entries are summarized above.`;
        actions.append(remainder);
      }
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
    if (view === "runtimeContext" && contextColor === "combined") {
      const overlaps = descendantLeaves(current)
        .filter((node) =>
          (node.meta?.boundaryDensity ?? 0) > 0
            && (node.meta?.frontierDensity ?? 0) > 0)
        .sort((lhs, rhs) => {
          const left = lhs.meta?.surfaceSummary;
          const right = rhs.meta?.surfaceSummary;
          return (right?.primaryPublicRoots ?? 0) - (left?.primaryPublicRoots ?? 0)
            || (right?.primaryRoots ?? 0) - (left?.primaryRoots ?? 0)
            || rhs.bytes - lhs.bytes
            || lhs.name.localeCompare(rhs.name);
        });
      elements.childListTitle.textContent = "Retained + blocker overlap";
      elements.childCount.textContent = overlaps.length.toLocaleString("en-US");
      elements.topChildren.replaceChildren(...overlaps.slice(0, 18).map((node) => {
        const summary = node.meta?.surfaceSummary ?? {};
        return resultRow(
          node,
          current.bytes,
          true,
          `${summary.primaryPublicRoots ?? 0} public · ${summary.primaryRoots ?? 0} all`,
        );
      }));
      return;
    }
    if (view === "runtimeContext" && contextColor === "frontier") {
      const pressured = children
        .filter((node) => (node.meta?.surfaceSummary?.primaryRoots ?? 0) > 0)
        .sort((lhs, rhs) =>
          rhs.meta.surfaceSummary.primaryPublicRoots - lhs.meta.surfaceSummary.primaryPublicRoots
            || rhs.meta.surfaceSummary.primaryRoots - lhs.meta.surfaceSummary.primaryRoots
            || lhs.name.localeCompare(rhs.name));
      elements.childListTitle.textContent = "Frontier pressure";
      elements.childCount.textContent = pressured.length.toLocaleString("en-US");
      elements.topChildren.replaceChildren(...pressured.slice(0, 18).map((node) => {
        const summary = node.meta.surfaceSummary;
        return resultRow(
          node,
          current.bytes,
          false,
          `${summary.primaryPublicRoots} public · ${summary.primaryRoots} all`,
        );
      }));
      return;
    }
    elements.childListTitle.textContent = "Largest children";
    elements.childCount.textContent = children.length.toLocaleString("en-US");
    elements.topChildren.replaceChildren(
      ...children.slice(0, 18).map((node) => resultRow(node, current.bytes)),
    );
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

  function resultRow(node, denominator, searchResult = false, valueOverride = null) {
    const row = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    const label = document.createElement("span");
    label.textContent = node.name;
    const value = document.createElement("span");
    value.textContent = valueOverride
      ?? `${formatBytes(node.bytes)} · ${formatPercent(node.bytes / denominator)}`;
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

  function descendantLeaves(root) {
    const leaves = [];
    const visit = (node) => {
      const children = node.children ?? [];
      if (children.length === 0) {
        leaves.push(node);
        return;
      }
      for (const child of children) visit(child);
    };
    visit(root);
    return leaves;
  }

  function writeHash() {
    const params = new URLSearchParams({ view, node: current.id });
    if (view === "runtimeContext") {
      params.set("color", contextColor);
    }
    params.set("depth", String(visibleDepthByView.get(view) ?? 1));
    const query = elements.search.value.trim();
    if (query) params.set("query", query);
    const next = `#${params}`;
    if (window.location.hash !== next) history.replaceState(null, "", next);
  }

  function restoreHash() {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const requestedView = params.get("view");
    if (report.trees[requestedView]) view = requestedView;
    const requestedColor = params.get("color");
    if (["boundary", "frontier", "combined"].includes(requestedColor)) {
      contextColor = requestedColor;
    }
    const requestedDepth = Number(params.get("depth"));
    const maximumDepth = Math.max(1, treeVisibleDepth(report.trees[view]));
    if (Number.isInteger(requestedDepth) && requestedDepth >= 1 && requestedDepth <= maximumDepth) {
      visibleDepthByView.set(view, requestedDepth);
    }
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
      let maximumChildDepth = -1;
      for (const child of node.children ?? []) {
        maximumChildDepth = Math.max(maximumChildDepth, visit(child, node));
      }
      const depth = maximumChildDepth + 1;
      visibleDepthCache.set(node, depth);
      return depth;
    };
    visit(root, null);
    return { nodeById, parentById, nodes };
  }

  function treeVisibleDepth(node) {
    const cached = visibleDepthCache.get(node);
    if (cached != null) return cached;
    const children = node.children ?? [];
    if (children.length === 0) return 0;
    return 1 + Math.max(...children.map(treeVisibleDepth));
  }

  function visibleDepthForCurrent() {
    return Math.min(
      visibleDepthByView.get(view) ?? 1,
      Math.max(1, treeVisibleDepth(current)),
    );
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

  function coverageFact(value, label) {
    const wrapper = document.createElement("div");
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
      node.meta?.memberName,
      ...(node.meta?.rawAliases ?? []),
      ...(node.meta?.demangledAliases ?? []),
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
      archive: "installed Lean archive",
      runtimeLayer: "Lean execution layer",
      sourceGroup: "Lean source subsystem",
      sourceDirectory: "Lean source directory",
      runtimeMember: "native archive member",
      runtimeFunction: "sized native function",
      runtimeOverhead: "non-function data and object overhead",
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

  function frontierColorIntensity(density) {
    const maximum = report.runtimeContext.maxFrontierDensity;
    if (maximum <= 0 || density <= 0) return 0;
    const logarithmic = clampUnit(Math.log1p(density) / Math.log1p(maximum));
    // Keep sparse parent averages quiet while preserving strong leaf signals.
    return logarithmic ** 1.8;
  }

  function combinedContextColor(boundary, frontier) {
    const corners = [
      { color: [215, 221, 224], weight: (1 - boundary) * (1 - frontier) },
      { color: [120, 207, 173], weight: boundary * (1 - frontier) },
      { color: [223, 76, 47], weight: (1 - boundary) * frontier },
      { color: [143, 96, 191], weight: boundary * frontier },
    ];
    const channels = [0, 1, 2].map((channel) => Math.round(corners.reduce(
      (sum, corner) => sum + corner.color[channel] * corner.weight,
      0,
    )));
    return `rgb(${channels.join(" ")})`;
  }

  function clampUnit(value) {
    return Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>]/g, (character) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
    })[character]);
  }

  function escapeAttribute(value) {
    return escapeHtml(value).replace(/["'\n\r]/g, (character) => ({
      "\"": "&quot;",
      "'": "&#39;",
      "\n": "&#10;",
      "\r": "&#13;",
    })[character]);
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

  function formatDensity(density) {
    if (!Number.isFinite(density) || density === 0) return "0 roots / MiB";
    return `${density.toFixed(density < 10 ? 1 : 0)} roots / MiB`;
  }
})();
