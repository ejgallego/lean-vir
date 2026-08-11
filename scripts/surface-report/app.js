/*
Copyright (c) 2026 Lean FRO LLC. All rights reserved.
Released under Apache 2.0 license as described in the file LICENSE.
Author: Emilio J. Gallego Arias
*/

(() => {
  "use strict";

  const report = globalThis.__virSurfaceIndex;
  if (!report || report.format !== "lean-vir-surface-html") {
    document.body.textContent = "Invalid or missing VIR surface index.";
    return;
  }

  const number = new Intl.NumberFormat("en-US");
  const definition = report.definition ?? {};
  const moduleByName = new Map(report.modules.map((module) => [module.name, module]));
  const externs = report.externs ?? [];
  const completeBlockerFrontier = definition.completeBlockerFrontier === true
    && Array.isArray(report.reachableBlockers);
  const blockerSummaries = completeBlockerFrontier
    ? report.reachableBlockers
    : report.primaryBlockers;
  const externByName = new Map(externs.map((declaration) => [declaration.name, declaration]));
  const selectedDeclarations = report.selectedDeclarations ?? [];
  const selectedRootBlockerSets = report.selectedRootBlockerSets ?? [];
  const focusedReport = selectedDeclarations.length > 0;
  const collectionReport = report.collection === true;
  const blockerSetsAvailable = completeBlockerFrontier && selectedRootBlockerSets.length > 0;
  const closure = report.closure ?? null;
  const selectedDeclarationByName = new Map(
    selectedDeclarations.map((declaration) => [declaration.name, declaration]),
  );
  const externsByModule = new Map();
  for (const declaration of externs) {
    const declarations = externsByModule.get(declaration.module) ?? [];
    declarations.push(declaration);
    externsByModule.set(declaration.module, declarations);
  }
  for (const declarations of externsByModule.values()) {
    declarations.sort((lhs, rhs) => compareText(lhs.name, rhs.name));
  }
  const blockerByName = new Map(
    blockerSummaries.map((summary) => [summary.blocker.name, summary]),
  );
  const frontierBaseline = report.frontierCosts?.baseline ?? null;
  const frontierBaselineId = typeof frontierBaseline?.sha256 === "string"
    ? frontierBaseline.sha256.slice(0, 12)
    : null;
  const frontierCosts = report.frontierCosts?.candidates ?? [];
  const frontierCostsByName = new Map();
  for (const candidate of frontierCosts) {
    for (const name of candidate.names) {
      const costs = frontierCostsByName.get(name) ?? [];
      costs.push(candidate);
      frontierCostsByName.set(name, costs);
    }
  }
  const isolatedCostByName = new Map(
    frontierCosts.filter((candidate) => candidate.names.length === 1)
      .map((candidate) => [candidate.names[0], candidate]),
  );
  const folderByPath = new Map();
  const rootFolder = buildFolderTree(report.modules);
  const tree = document.querySelector("#module-tree");
  const main = document.querySelector("#report-main");
  const metricSelect = document.querySelector("#metric-select");
  const moduleSearch = document.querySelector("#module-search");
  const librariesView = document.querySelector("#libraries-view");
  const blockersView = document.querySelector("#blockers-view");
  const blockerSetsView = document.querySelector("#blocker-sets-view");
  const externsView = document.querySelector("#externs-view");
  const moduleBrowser = document.querySelector("#module-browser");
  const moduleCache = new Map();
  const modulePromises = new Map();
  const drawerStack = [];
  let drawerSequence = 0;
  const state = {
    metric: "public",
    expanded: new Set(),
    selectedType: "folder",
    selectedValue: rootFolder,
    moduleQuery: "",
    requestVersion: 0,
    functionQuery: "",
    functionStatus: "all",
    functionKind: "all",
    visibleFunctions: 200,
    focusDeclaration: null,
    focusShouldScroll: false,
    externQuery: "",
    externStatus: focusedReport ? "missing" : "all",
    visibleExterns: 200,
    blockerQuery: "",
    blockerFamily: "all",
    blockerModule: "all",
    blockerDistance: "all",
    blockerSetQuery: "",
    blockerSetMode: "all",
  };

  globalThis.__virSurfaceAcceptModule = (payload) => {
    const pending = modulePromises.get(payload.id);
    moduleCache.set(payload.id, payload);
    if (pending) {
      pending.script.remove();
      modulePromises.delete(payload.id);
      pending.resolve(payload);
    }
  };

  renderReportIdentity();
  librariesView.addEventListener("click", () => selectPrimaryView());
  blockersView.addEventListener("click", () => selectBlockers());
  blockerSetsView.addEventListener("click", () => selectBlockerSets());
  externsView.addEventListener("click", () => selectExterns());
  metricSelect.addEventListener("change", () => {
    state.metric = metricSelect.value;
    renderTree();
  });
  moduleSearch.addEventListener("input", () => {
    state.moduleQuery = moduleSearch.value.trim().toLowerCase();
    renderTree();
  });

  navigateFromLocation();
  window.addEventListener("popstate", navigateFromLocation);

  function navigateFromLocation() {
    const initial = selectionFromHash();
    if (initial?.type === "targetSet" && focusedReport && selectedDeclarations.length > 1) {
      selectPrimaryView(false);
    } else if (initial?.type === "blockers") {
      selectBlockers(false);
    } else if (initial?.type === "blockerSets" && blockerSetsAvailable) {
      selectBlockerSets(false);
    } else if (initial?.type === "externs") {
      selectExterns(false);
    } else if (initial?.type === "module") {
      selectModule(initial.value, false, initial.focusDeclaration, false);
    } else if (initial?.type === "folder") {
      selectFolder(initial.value, false);
    } else {
      selectPrimaryView(false);
    }
  }

  function buildFolderTree(modules) {
    const root = newFolder("", "All libraries");
    folderByPath.set("", root);
    for (const module of modules) {
      addCounts(root.counts, module.counts);
      root.moduleCount += 1;
      root.externCount += module.externCount ?? 0;
      const parts = module.name.split(".");
      let folder = root;
      let path = "";
      for (const part of parts.slice(0, -1)) {
        path = path ? `${path}.${part}` : part;
        let child = folder.folders.get(path);
        if (!child) {
          child = newFolder(path, part);
          folder.folders.set(path, child);
          folderByPath.set(path, child);
        }
        addCounts(child.counts, module.counts);
        child.moduleCount += 1;
        child.externCount += module.externCount ?? 0;
        folder = child;
      }
      folder.files.push(module);
    }
    sortFolder(root);
    return root;
  }

  function newFolder(path, label) {
    return {
      path,
      label,
      folders: new Map(),
      files: [],
      counts: emptyCounts(),
      moduleCount: 0,
      externCount: 0,
    };
  }

  function emptyCounts() {
    return {
      total: 0,
      runnable: 0,
      blocked: 0,
      publicTotal: 0,
      publicRunnable: 0,
      privateTotal: 0,
      boxedTotal: 0,
      generatedTotal: 0,
    };
  }

  function addCounts(target, source) {
    for (const key of [
      "total",
      "runnable",
      "blocked",
      "publicTotal",
      "publicRunnable",
      "privateTotal",
      "boxedTotal",
      "generatedTotal",
    ]) {
      target[key] += source[key] ?? 0;
    }
  }

  function sortFolder(folder) {
    folder.files.sort((lhs, rhs) => compareText(lhs.name, rhs.name));
    folder.folders = new Map([...folder.folders].sort((lhs, rhs) => compareText(lhs[0], rhs[0])));
    for (const child of folder.folders.values()) sortFolder(child);
  }

  function renderReportIdentity() {
    document.body.classList.toggle("focused-report", focusedReport);
    document.querySelector("#report-eyebrow").textContent =
      focusedReport ? "Selected Lean target" : "Lean library coverage";
    document.querySelector("#report-title").textContent =
      focusedReport ? "VIR Boundary Explorer" : "VIR Runnable Surface";
    const identity = document.querySelector("#report-identity");
    identity.textContent = [
      ...(focusedReport && selectedDeclarations.length === 1
        ? [selectedDeclarations[0].name]
        : []),
      `${report.capture ? "Target " : ""}Lean ${report.lean.version}`,
      shortHash(report.lean.githash),
      ...(report.runtimeCapabilityLean?.githash
          && report.runtimeCapabilityLean.githash !== report.lean.githash
        ? [`VIR policy Lean ${report.runtimeCapabilityLean.version}`]
        : []),
      ...(focusedReport
        ? []
        : [`${number.format(report.selectedModuleCount)} modules`]),
      ...(selectedDeclarations.length <= 1
        ? []
        : [`${number.format(selectedDeclarations.length)} selected declarations`]),
      `${number.format(report.runtimeCapabilityCount)} native capabilities`,
      `${number.format(externs.length)} extern boundaries`,
    ].join(" · ");

    const summary = document.querySelector("#global-summary");
    if (focusedReport && selectedDeclarations.length === 1) {
      summary.replaceChildren();
      summary.hidden = true;
    } else if (focusedReport) {
      summary.hidden = false;
      summary.replaceChildren(
        headerStat(percentage(report.counts.runnable, report.counts.total), "Selected functions"),
        headerStat(number.format(report.counts.blocked), "Blocked functions"),
        headerStat(number.format(blockerSummaries.length), "Distinct blockers"),
      );
    } else {
      summary.hidden = false;
      summary.replaceChildren(
        headerStat(percentage(report.counts.publicRunnable, report.counts.publicTotal), "Public constants"),
        headerStat(percentage(report.counts.runnable, report.counts.total), "All IR functions"),
        headerStat(number.format(report.counts.blocked), "Blocked functions"),
      );
    }
    document.querySelector("#libraries-view-label").textContent = focusedReport
      ? selectedDeclarations.length === 1 ? "Target" : "Target set"
      : "All libraries";
    document.querySelector("#blockers-view-label").textContent = completeBlockerFrontier
      ? "All blockers"
      : "Primary blockers";
    document.querySelector("#libraries-view-count").textContent =
      number.format(focusedReport ? selectedDeclarations.length : report.selectedModuleCount);
    document.querySelector("#blockers-view-count").textContent =
      number.format(blockerSummaries.length);
    blockerSetsView.hidden = !blockerSetsAvailable;
    document.querySelector("#blocker-sets-view-count").textContent =
      number.format(selectedRootBlockerSets.length);
    const missingExternCount = externs.filter((declaration) => declaration.status === "missing").length;
    document.querySelector("#externs-view-count").textContent = focusedReport
      ? `${number.format(missingExternCount)}/${number.format(externs.length)}`
      : number.format(externs.length);
    document.querySelector("#module-browser-count").textContent = number.format(report.modules.length);
    document.querySelector("#all-analyses-link").hidden = !(focusedReport || collectionReport);
    document.querySelector("#wasm-size-link").hidden = focusedReport || collectionReport;
    document.querySelector("#hosted-demo-link").hidden = focusedReport || collectionReport;
    document.querySelector(".navigator-controls").hidden = focusedReport;
    moduleBrowser.open = !focusedReport;
    renderAnalysisMethod();
  }

  function renderAnalysisMethod() {
    const details = document.querySelector("#analysis-method");
    const body = document.querySelector("#analysis-method-body");
    details.open = focusedReport;
    const blockerScope = definition.blockerCoverage
      ? `Blocker coverage: ${definition.blockerCoverage}.`
      : "Blocker coverage was not recorded by this report version.";
    const graphScope = closure === null
      ? "Graph-node closure counts were not recorded by this report version."
      : closure.capturedNodes === closure.rootReachableNodes
        ? `${number.format(closure.rootReachableNodes)} graph nodes are root-reachable.`
        : `${number.format(closure.rootReachableNodes)} of ${number.format(closure.capturedNodes)} captured nodes are root-reachable; `
          + `${number.format(closure.supportOnlyNodes)} ${closure.supportOnlyNodes === 1 ? "is" : "are"} capability-support-only.`;
    const externScope = definition.externScope
      ? `Extern inventory: ${definition.externScope}.`
      : "Extern-inventory scope was not recorded by this report version.";
    const assumptions = element("ul", "analysis-method-assumptions");
    if (definition.hostProvisioningVerified === false) {
      assumptions.append(element(
        "li",
        "",
        "Host annotations count as satisfied; browser host provisioning is not tested.",
      ));
    }
    if (definition.missingNodeKind) {
      assumptions.append(element(
        "li",
        "",
        `Missing-node classification uses ${definition.missingNodeKind}; names and paths come from the dependency graph.`,
      ));
    }
    assumptions.append(element(
      "li",
      "",
      "Boundary families are name-based navigation groups and do not affect the result.",
    ));
    const headline = definition.headline ?? "static transitive IR closure completeness";
    body.replaceChildren(
      element("p", "", `${capitalize(headline)}. ${blockerScope}`),
      element("p", "", `${graphScope} ${externScope}`),
      assumptions,
    );
  }

  function headerStat(value, label) {
    const card = element("div", "header-stat");
    card.append(element("strong", "", value), element("span", "", label));
    return card;
  }

  function renderTree() {
    tree.replaceChildren();
    if (state.moduleQuery) {
      renderModuleSearch();
      return;
    }
    for (const folder of rootFolder.folders.values()) {
      tree.append(renderFolderTreeNode(folder, 0));
    }
    for (const module of rootFolder.files) {
      tree.append(renderModuleTreeNode(module, false));
    }
    const selected = tree.querySelector(".tree-row.selected");
    if (selected && (!focusedReport || moduleBrowser.open)) {
      const navigator = tree.closest(".navigator");
      navigator.scrollTop = Math.max(0, selected.offsetTop - navigator.clientHeight / 2);
    }
  }

  function renderModuleSearch() {
    const matches = report.modules.filter((module) => module.name.toLowerCase().includes(state.moduleQuery));
    tree.append(element(
      "p",
      "search-results-heading",
      `${number.format(matches.length)} matching module${matches.length === 1 ? "" : "s"}`,
    ));
    if (matches.length === 0) {
      tree.append(element("p", "empty-tree", "No module names match this search."));
      return;
    }
    for (const module of matches) tree.append(renderModuleTreeNode(module, true));
  }

  function renderFolderTreeNode(folder) {
    const wrapper = element("div", "tree-node");
    const row = element("div", "tree-row");
    if (state.selectedType === "folder" && state.selectedValue === folder) row.classList.add("selected");
    const hasChildren = folder.folders.size > 0 || folder.files.length > 0;
    const expanded = state.expanded.has(folder.path);
    const toggle = element("button", `tree-toggle${hasChildren ? "" : " empty"}`, hasChildren ? (expanded ? "▾" : "▸") : "");
    toggle.type = "button";
    toggle.ariaLabel = `${expanded ? "Collapse" : "Expand"} ${folder.path}`;
    toggle.ariaExpanded = String(expanded);
    toggle.addEventListener("click", () => {
      if (!hasChildren) return;
      if (expanded) state.expanded.delete(folder.path);
      else state.expanded.add(folder.path);
      renderTree();
    });
    const label = element("button", "tree-label folder", folder.label);
    label.type = "button";
    label.title = folder.path;
    label.addEventListener("click", () => {
      state.expanded.add(folder.path);
      selectFolder(folder);
    });
    row.append(toggle, label, treeCoverage(folder.counts));
    wrapper.append(row);
    if (expanded) {
      const children = element("div", "tree-children");
      for (const child of folder.folders.values()) children.append(renderFolderTreeNode(child));
      for (const module of folder.files) children.append(renderModuleTreeNode(module, false));
      wrapper.append(children);
    }
    return wrapper;
  }

  function renderModuleTreeNode(module, useFullName) {
    const row = element("div", "tree-row");
    if (["module", "target"].includes(state.selectedType)
        && state.selectedValue.id === module.id) row.classList.add("selected");
    const spacer = element("span", "tree-toggle empty", "");
    const label = element("button", "tree-label file", useFullName ? module.name : moduleLabel(module.name));
    label.type = "button";
    label.title = module.name;
    label.addEventListener("click", () => selectModule(module));
    row.append(spacer, label, treeCoverage(module.counts));
    return row;
  }

  function treeCoverage(counts) {
    const [runnable, total] = metricValues(counts, state.metric);
    const coverage = element("span", "tree-coverage");
    coverage.append(progressBar(runnable, total, "tree-progress"));
    const badge = element("span", "tree-percent", percentage(runnable, total));
    badge.title = `${number.format(runnable)} / ${number.format(total)}`;
    coverage.append(badge);
    return coverage;
  }

  function selectFolder(folder, updateHash = true) {
    state.selectedType = "folder";
    state.selectedValue = folder;
    state.requestVersion += 1;
    expandFolderAncestors(folder.path);
    if (updateHash) setHash("folder", folder.path);
    renderViewNavigation();
    renderTree();
    renderFolder(folder);
  }

  function selectPrimaryView(updateHash = true) {
    if (focusedReport && selectedDeclarations.length === 1) {
      const selected = selectedDeclarations[0];
      const module = moduleByName.get(selected.module);
      if (module) {
        moduleBrowser.open = false;
        selectModule(module, updateHash, selected.name, false);
        return;
      }
    }
    if (focusedReport) {
      state.selectedType = "targetSet";
      state.selectedValue = null;
      state.requestVersion += 1;
      moduleBrowser.open = false;
      if (updateHash) setHash("view", "targets");
      renderViewNavigation();
      renderTree();
      renderFocusedTargetSet();
      return;
    }
    selectFolder(rootFolder, updateHash);
  }

  function selectModule(module, updateHash = true, focusDeclaration = null, scrollDetail = true) {
    const targetFocus = focusedReport && selectedDeclarationByName.has(focusDeclaration);
    state.selectedType = targetFocus ? "target" : "module";
    state.selectedValue = module;
    state.functionQuery = focusDeclaration?.toLowerCase() ?? "";
    if (focusDeclaration) state.functionStatus = "all";
    state.functionKind = focusDeclaration && externByName.has(focusDeclaration) ? "extern" : "all";
    state.visibleFunctions = 200;
    state.focusDeclaration = focusDeclaration;
    state.focusShouldScroll = scrollDetail;
    if (focusedReport && !targetFocus) moduleBrowser.open = true;
    expandFolderAncestors(parentPath(module.name));
    if (updateHash) {
      setHash(focusDeclaration ? "declaration" : "module", focusDeclaration ?? module.name);
    }
    const requestVersion = ++state.requestVersion;
    renderViewNavigation();
    renderTree();
    renderModuleLoading(module);
    if (module.dataPath === null) {
      renderModule(module, { id: module.id, name: module.name, declarations: [] });
      return;
    }
    loadModule(module).then((payload) => {
      if (requestVersion === state.requestVersion) renderModule(module, payload);
    }).catch((error) => {
      if (requestVersion === state.requestVersion) renderModuleError(module, error);
    });
  }

  function selectBlockers(updateHash = true) {
    state.selectedType = "blockers";
    state.selectedValue = null;
    state.requestVersion += 1;
    if (updateHash) setHash("view", "blockers");
    renderViewNavigation();
    renderTree();
    renderBlockersView();
  }

  function selectBlockerSets(updateHash = true) {
    if (!blockerSetsAvailable) return;
    state.selectedType = "blockerSets";
    state.selectedValue = null;
    state.requestVersion += 1;
    if (updateHash) setHash("view", "blocker-sets");
    renderViewNavigation();
    renderTree();
    renderBlockerSetsView();
  }

  function selectExterns(updateHash = true) {
    state.selectedType = "externs";
    state.selectedValue = null;
    state.requestVersion += 1;
    if (updateHash) setHash("view", "externs");
    renderViewNavigation();
    renderTree();
    renderExternsView();
  }

  function renderViewNavigation() {
    const blockersSelected = state.selectedType === "blockers";
    const blockerSetsSelected = state.selectedType === "blockerSets";
    const externsSelected = state.selectedType === "externs";
    const primarySelected = focusedReport
      ? state.selectedType === "target" || state.selectedType === "targetSet"
      : !blockersSelected && !blockerSetsSelected && !externsSelected;
    blockersView.classList.toggle("selected", blockersSelected);
    blockersView.setAttribute("aria-current", blockersSelected ? "page" : "false");
    blockerSetsView.classList.toggle("selected", blockerSetsSelected);
    blockerSetsView.setAttribute("aria-current", blockerSetsSelected ? "page" : "false");
    externsView.classList.toggle("selected", externsSelected);
    externsView.setAttribute("aria-current", externsSelected ? "page" : "false");
    librariesView.classList.toggle("selected", primarySelected);
    librariesView.setAttribute("aria-current", primarySelected ? "page" : "false");
  }

  function renderFolder(folder) {
    main.replaceChildren(
      renderBreadcrumbs(folder.path, null),
      contentHeading(folder.path || "All Lean libraries", "Folder", folderDescription(folder)),
      statGrid(folder.counts, "Modules", number.format(folder.moduleCount)),
      renderFolderContents(folder),
    );
    if (folder === rootFolder && blockerSummaries.length > 0) {
      main.append(renderBlockers(25));
    }
  }

  function renderFocusedTargetSet() {
    const stats = element("div", "stat-grid");
    stats.append(
      coverageCard("Selected functions", report.counts.runnable, report.counts.total),
      valueCard("Blocked functions", number.format(report.counts.blocked)),
      valueCard("Distinct blockers", number.format(blockerSummaries.length)),
      valueCard(
        "Root-reachable nodes",
        closureCountLabel(),
      ),
    );
    const card = sectionCard("Selected functions", `${number.format(selectedRootBlockerSets.length)} roots`);
    const wrap = element("div", "data-table-wrap");
    const table = tableElement(["Function", "Status", "Blocker set", "Primary blocker", "Module"]);
    const body = table.tBodies[0];
    for (const root of selectedRootBlockerSets) {
      const row = document.createElement("tr");
      const nameCell = document.createElement("td");
      const name = element("button", "name-button", root.name);
      name.type = "button";
      name.addEventListener("click", () => openFunctionBlockerSetDrawer(root, null, name));
      nameCell.append(name);
      const status = document.createElement("td");
      status.append(element(
        "span",
        `status-pill ${root.runnable ? "good" : "bad"}`,
        root.runnable ? "Closure complete" : "Blocked",
      ));
      const primary = document.createElement("td");
      primary.className = "blocker-name";
      if (root.primaryBlocker?.name) primary.append(boundaryLink(root.primaryBlocker.name));
      else primary.textContent = "—";
      row.append(
        nameCell,
        status,
        tableCell(number.format(root.blockers.length), "count-cell"),
        primary,
        tableCell(root.module, "example-root"),
      );
      body.append(row);
    }
    wrap.append(table);
    const actions = element("div", "target-set-overview-actions");
    const openMatrix = element("button", "target-set-action", "Compare complete blocker sets");
    openMatrix.type = "button";
    openMatrix.addEventListener("click", () => selectBlockerSets());
    actions.append(openMatrix);
    card.append(actions, wrap);
    main.replaceChildren(
      contentHeading(
        "Selected function set",
        "Target profile",
        "Closure progress and blocker-set sizes for the functions selected in this exact-toolchain analysis.",
      ),
      stats,
      card,
    );
  }

  function renderBlockersView() {
    const publicBlocked = report.counts.publicTotal - report.counts.publicRunnable;
    const stats = element("div", "stat-grid");
    if (focusedReport) {
      const nearestSteps = blockerSummaries.length === 0
        ? 0
        : Math.min(...blockerSummaries.map((summary) =>
            Math.max(0, (summary.examplePath?.length ?? 1) - 1)));
      stats.append(
        valueCard("Current blockers", number.format(blockerSummaries.length)),
        valueCard("Nearest distance", `${number.format(nearestSteps)} steps`),
        valueCard(
          "Missing externs",
          number.format(externs.filter((declaration) => declaration.status === "missing").length),
        ),
      );
    } else {
      stats.append(
        valueCard(
          completeBlockerFrontier ? "Reached boundaries" : "Primary boundaries",
          number.format(blockerSummaries.length),
        ),
        valueCard("Blocked public constants", number.format(publicBlocked)),
        valueCard("Blocked all IR functions", number.format(report.counts.blocked)),
      );
    }
    const sections = [
      contentHeading(
        completeBlockerFrontier ? "Complete blocker frontier" : "Primary blockers",
        "Report view",
        completeBlockerFrontier
          ? "Every terminal boundary reached from the selected declarations, with one representative path per root."
          : "Primary boundaries ranked by blocked IR roots. Each root is counted once at its nearest deterministic boundary.",
      ),
      stats,
    ];
    if (frontierCosts.length > 0) sections.push(renderFrontierCosts());
    sections.push(renderBlockers());
    main.replaceChildren(...sections);
  }

  function renderBlockerSetsView() {
    const rows = blockerSetRows();
    const blockedRoots = selectedRootBlockerSets.filter((root) => (root.blockers?.length ?? 0) > 0);
    const common = rows.filter((row) => row.byRoot.size === blockedRoots.length).length;
    const priced = rows.filter((row) => boundarySizeImpact(row.blocker.name).measured).length;
    const stats = element("div", "stat-grid");
    stats.append(
      valueCard("Selected functions", number.format(selectedRootBlockerSets.length)),
      valueCard("Distinct blockers", number.format(rows.length)),
      valueCard("Shared by every blocked function", number.format(common)),
      valueCard("Size measured", `${number.format(priced)} / ${number.format(rows.length)}`),
    );
    const card = sectionCard(
      "Blocker-set matrix",
      `${number.format(rows.length)} terminal boundaries`,
    );
    const controls = element("div", "module-controls blocker-set-controls");
    const search = control("Find a boundary or function", "input");
    search.input.type = "search";
    search.input.placeholder = "IO.getEnv, compiler, main…";
    search.input.value = state.blockerSetQuery;
    const mode = control("Membership", "select", [
      ["all", "All blockers"],
      ["every", "Shared by every blocked function"],
      ["shared", "Shared by 2+ functions"],
      ["unique", "Unique to one function"],
    ]);
    mode.input.value = state.blockerSetMode;
    controls.append(search.label, mode.label);
    const results = element("div", "blocker-set-results");
    const refresh = () => renderBlockerSetMatrix(results, rows, blockedRoots.length);
    search.input.addEventListener("input", () => {
      state.blockerSetQuery = search.input.value.trim().toLowerCase();
      refresh();
    });
    mode.input.addEventListener("change", () => {
      state.blockerSetMode = mode.input.value;
      refresh();
    });
    card.append(controls, results);
    main.replaceChildren(
      contentHeading(
        "Function blocker sets",
        "Complete frontier",
        "Scan blocker membership across selected functions. Open a function heading or a populated cell to inspect its complete set and dependency paths.",
      ),
      stats,
      card,
    );
    refresh();
  }

  function blockerSetRows() {
    const rows = new Map();
    for (const root of selectedRootBlockerSets) {
      for (const entry of root.blockers ?? []) {
        const key = `${entry.blocker.kind}\0${entry.blocker.name}`;
        const row = rows.get(key) ?? {
          blocker: entry.blocker,
          byRoot: new Map(),
        };
        row.byRoot.set(root.name, entry);
        rows.set(key, row);
      }
    }
    return [...rows.values()].sort((lhs, rhs) =>
      rhs.byRoot.size - lhs.byRoot.size
        || compareText(lhs.blocker.name, rhs.blocker.name));
  }

  function renderBlockerSetMatrix(container, rows, blockedRootCount) {
    const filtered = rows.filter((row) => {
      if (state.blockerSetMode === "every" && row.byRoot.size !== blockedRootCount) return false;
      if (state.blockerSetMode === "shared" && row.byRoot.size < 2) return false;
      if (state.blockerSetMode === "unique" && row.byRoot.size !== 1) return false;
      if (!state.blockerSetQuery) return true;
      const declaration = externByName.get(row.blocker.name);
      const roots = [...row.byRoot.keys()].join("\n");
      return (`${row.blocker.name}\n${row.blocker.kind}\n${declaration?.family ?? ""}\n${roots}`)
        .toLowerCase().includes(state.blockerSetQuery);
    });
    container.replaceChildren();
    if (filtered.length === 0) {
      container.append(element("p", "empty-state", "No blocker sets match these filters."));
      return;
    }
    const wrap = element("div", "data-table-wrap blocker-set-matrix-wrap");
    const headings = [
      "Boundary",
      "Family (name-based)",
      "Size impact",
      ...selectedRootBlockerSets.map((root) => compactDeclarationName(root.name)),
      "Functions",
    ];
    const table = tableElement(headings);
    table.classList.add("blocker-set-matrix");
    for (let index = 0; index < selectedRootBlockerSets.length; index += 1) {
      const root = selectedRootBlockerSets[index];
      const header = table.tHead.rows[0].cells[index + 3];
      const button = element("button", "matrix-function-button", compactDeclarationName(root.name));
      button.type = "button";
      button.title = `Open the complete blocker set for ${root.name}`;
      button.addEventListener("click", () => openFunctionBlockerSetDrawer(root, null, button));
      header.replaceChildren(button);
    }
    const body = table.tBodies[0];
    for (const row of filtered) {
      const declaration = externByName.get(row.blocker.name);
      const tableRow = document.createElement("tr");
      const boundary = document.createElement("td");
      boundary.className = "blocker-name";
      boundary.append(boundaryLink(row.blocker.name));
      tableRow.append(
        boundary,
        tableCell(declaration?.family ?? row.blocker.kind),
        sizeImpactCell(row.blocker.name),
      );
      for (const root of selectedRootBlockerSets) {
        const entry = row.byRoot.get(root.name);
        const cell = document.createElement("td");
        cell.className = `blocker-set-cell${entry ? " present" : " absent"}`;
        if (!entry) {
          cell.textContent = "—";
        } else {
          const primary = root.primaryBlocker?.kind === row.blocker.kind
            && root.primaryBlocker?.name === row.blocker.name;
          const button = element("button", primary ? "primary" : "reached", primary ? "◆" : "●");
          button.type = "button";
          button.ariaLabel = `${primary ? "Primary" : "Reached"} blocker for ${root.name}; open complete blocker set`;
          button.title = `${Math.max(0, (entry.path?.length ?? 1) - 1)} steps; open ${root.name}`;
          button.addEventListener("click", () =>
            openFunctionBlockerSetDrawer(root, row.blocker, button));
          cell.append(button);
        }
        tableRow.append(cell);
      }
      tableRow.append(tableCell(number.format(row.byRoot.size), "count-cell"));
      body.append(tableRow);
    }
    wrap.append(table);
    wrap.append(element(
      "p",
      "matrix-legend",
      "◆ nearest primary blocker · ● additionally reached blocker · — not in this function's set",
    ));
    container.append(
      element(
        "p",
        "filter-summary",
        `${number.format(filtered.length)} of ${number.format(rows.length)} blocker rows`,
      ),
      wrap,
    );
  }

  function compactDeclarationName(name) {
    const parts = name.split(".");
    return parts.length <= 2 ? name : parts.slice(-2).join(".");
  }

  function boundarySizeImpact(name) {
    const costs = frontierCostsByName.get(name) ?? [];
    const isolated = costs.find((candidate) => candidate.names.length === 1 && !candidate.error);
    if (isolated) {
      return {
        measured: true,
        label: `${formatBytes(isolated.rawDeltaBytes)} raw / ${formatBytes(isolated.gzipDeltaBytes)} gzip`,
        title: `Exact isolated measurement from ${isolated.id}`
          + (frontierBaselineId ? ` against baseline ${frontierBaselineId}` : ""),
      };
    }
    const clusters = costs.filter((candidate) => candidate.names.length > 1 && !candidate.error);
    if (clusters.length > 0) {
      return {
        measured: true,
        label: `Measured in ${number.format(clusters.length)} cluster${clusters.length === 1 ? "" : "s"}`,
        title: clusters.map((candidate) => candidate.id).join(", "),
      };
    }
    return {
      measured: false,
      label: "Not measured",
      title: "No frontier-size experiment was supplied when this explorer was rendered",
    };
  }

  function sizeImpactCell(name) {
    const impact = boundarySizeImpact(name);
    const cell = tableCell(impact.label, `size-impact ${impact.measured ? "measured" : "unmeasured"}`);
    cell.title = impact.title;
    return cell;
  }

  function renderExternsView() {
    const nativeCount = externs.filter((declaration) => declaration.status === "native").length;
    const hostCount = externs.filter((declaration) => declaration.status === "host").length;
    const missingCount = externs.length - nativeCount - hostCount;
    const card = sectionCard(
      focusedReport ? "Reached extern boundaries" : "Extern boundaries",
      `${number.format(externs.length)} entries`,
    );
    const controls = element("div", "module-controls extern-controls");
    const search = control("Find an extern", "input");
    search.input.type = "search";
    search.input.placeholder = "Boundary, module, or native symbol…";
    search.input.value = state.externQuery;
    const status = control("Status", "select", [
      ["all", "All statuses"],
      ["missing", "Missing"],
      ["native", "Native"],
      ["host", "Host"],
    ]);
    status.input.value = state.externStatus;
    controls.append(search.label, status.label);
    const results = element("div", "extern-results");
    const refresh = () => renderExternResults(results);
    search.input.addEventListener("input", () => {
      state.externQuery = search.input.value.trim().toLowerCase();
      state.visibleExterns = 200;
      refresh();
    });
    status.input.addEventListener("change", () => {
      state.externStatus = status.input.value;
      state.visibleExterns = 200;
      refresh();
    });
    card.append(controls, results);
    const stats = element("div", "stat-grid");
    stats.append(
      valueCard("Missing", number.format(missingCount)),
      valueCard("Native", number.format(nativeCount)),
      valueCard("Host", number.format(hostCount)),
    );
    main.replaceChildren(
      contentHeading(
        focusedReport ? "Reached externs" : "Extern boundaries",
        "Report view",
        focusedReport
          ? "Every extern boundary reached from the selected target. Open one to inspect its native symbol and dependency path."
          : "Extern declarations catalogued across the selected modules.",
      ),
      stats,
      card,
    );
    refresh();
  }

  function renderExternResults(container) {
    const filtered = externs.filter((declaration) => {
      if (state.externStatus !== "all" && declaration.status !== state.externStatus) return false;
      if (!state.externQuery) return true;
      return (`${declaration.name}\n${declaration.module}\n${declaration.family ?? ""}\n`
        + `${declaration.type ?? ""}\n${declaration.doc ?? ""}\n${externTargetsLabel(declaration)}`
      ).toLowerCase().includes(state.externQuery);
    });
    const shown = filtered.slice(0, state.visibleExterns);
    container.replaceChildren();
    if (filtered.length === 0) {
      container.append(element("p", "empty-state", "No extern boundaries match these filters."));
      return;
    }
    const wrap = element("div", "data-table-wrap");
    const table = tableElement(["Boundary", "Status", "Family (name-based)", "Module", "Native target"]);
    const body = table.tBodies[0];
    for (const declaration of shown) {
      const row = document.createElement("tr");
      const boundary = document.createElement("td");
      boundary.className = "blocker-name";
      boundary.append(boundaryLink(declaration.name));
      const statusCell = document.createElement("td");
      const status = externStatus(declaration.status);
      statusCell.append(element("span", `status-pill ${status.className}`, status.label));
      row.append(
        boundary,
        statusCell,
        tableCell(declaration.family ?? "Other runtime"),
        tableCell(declaration.module, "example-root"),
        tableCell(externTargetsLabel(declaration), "blocker-name"),
      );
      body.append(row);
    }
    wrap.append(table);
    container.append(wrap);
    const footer = element(
      "div",
      "table-footer",
      `Showing ${number.format(shown.length)} of ${number.format(filtered.length)} matching externs.`,
    );
    if (shown.length < filtered.length) {
      footer.append(document.createTextNode(" "));
      const more = element("button", "load-more", "Show 200 more");
      more.type = "button";
      more.addEventListener("click", () => {
        state.visibleExterns += 200;
        renderExternResults(container);
      });
      footer.append(more);
    }
    container.append(footer);
  }

  function folderDescription(folder) {
    const immediate = folder.folders.size + folder.files.length;
    return `${number.format(immediate)} immediate item${immediate === 1 ? "" : "s"}; `
      + `${number.format(folder.moduleCount)} module${folder.moduleCount === 1 ? "" : "s"} below this folder.`;
  }

  function renderFolderContents(folder) {
    const card = sectionCard("Subfolders and modules", `${folder.folders.size + folder.files.length} items`);
    const tableWrap = element("div", "data-table-wrap");
    const table = tableElement(["Name", "Type", "Public constants", "All IR", "Functions", "Externs"]);
    const body = table.tBodies[0];
    for (const child of folder.folders.values()) {
      body.append(folderContentRow(child.label, "Folder", child.counts, child.externCount, () => {
        state.expanded.add(child.path);
        selectFolder(child);
      }));
    }
    for (const module of folder.files) {
      body.append(folderContentRow(
        moduleLabel(module.name),
        "Module",
        module.counts,
        module.externCount ?? 0,
        () => selectModule(module),
      ));
    }
    if (body.rows.length === 0) {
      tableWrap.append(element("p", "empty-state", "This folder contains no analyzed modules."));
    } else {
      tableWrap.append(table);
    }
    card.append(tableWrap);
    return card;
  }

  function folderContentRow(label, type, counts, externCount, onSelect) {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    const link = element("button", "content-link", label);
    link.type = "button";
    link.addEventListener("click", onSelect);
    nameCell.append(link);
    row.append(
      nameCell,
      tableCell(type),
      coverageTableCell(counts.publicRunnable, counts.publicTotal),
      coverageTableCell(counts.runnable, counts.total),
      tableCell(number.format(counts.total), "count-cell"),
      tableCell(number.format(externCount), "count-cell"),
    );
    return row;
  }

  function renderBlockers(limit = null) {
    const summaries = limit === null ? blockerSummaries : blockerSummaries.slice(0, limit);
    const singleTarget = focusedReport && selectedDeclarations.length === 1;
    const card = sectionCard(
      completeBlockerFrontier ? "Current blocker frontier" : "Top primary blockers",
      limit === null
        ? `${number.format(summaries.length)} ranked boundaries`
        : `${number.format(summaries.length)} of ${number.format(blockerSummaries.length)}`,
    );
    if (singleTarget && limit === null) {
      const explorer = element("div", "blocker-explorer");
      card.append(explorer);
      renderFocusedBlockerExplorer(explorer);
      return card;
    }
    card.append(renderBlockerTable(summaries, singleTarget, limit));
    return card;
  }

  function renderFocusedBlockerExplorer(container) {
    const families = blockerFamilyCounts(blockerSummaries);
    const familyGrid = element("div", "blocker-family-grid");
    for (const [family, count] of families) {
      const button = element("button", "blocker-family-card");
      button.type = "button";
      button.classList.toggle("selected", state.blockerFamily === family);
      button.append(
        element("strong", "", number.format(count)),
        element("span", "", family),
      );
      button.addEventListener("click", () => {
        state.blockerFamily = state.blockerFamily === family ? "all" : family;
        renderFocusedBlockerExplorer(container);
      });
      familyGrid.append(button);
    }

    const controls = element("div", "blocker-controls");
    const search = control("Find a blocker", "input");
    search.input.type = "search";
    search.input.placeholder = "Boundary, module, or native symbol…";
    search.input.value = state.blockerQuery;
    const family = control("Family (name-based)", "select", [
      ["all", "All families"],
      ...families.map(([name]) => [name, name]),
    ]);
    family.input.value = state.blockerFamily;
    const modules = [...new Set(blockerSummaries.map((summary) =>
      externByName.get(summary.blocker.name)?.module).filter(Boolean))].sort(compareText);
    const module = control("Module", "select", [
      ["all", "All modules"],
      ...modules.map((name) => [name, name]),
    ]);
    module.input.value = state.blockerModule;
    const distance = control("Distance", "select", [
      ["all", "Any distance"],
      ["2", "At most 2 steps"],
      ["4", "At most 4 steps"],
      ["8", "At most 8 steps"],
      ["far", "More than 8 steps"],
    ]);
    distance.input.value = state.blockerDistance;
    controls.append(search.label, family.label, module.label, distance.label);
    const refresh = () => renderFocusedBlockerExplorer(container);
    search.input.addEventListener("input", () => {
      state.blockerQuery = search.input.value.trim().toLowerCase();
      refresh();
    });
    family.input.addEventListener("change", () => {
      state.blockerFamily = family.input.value;
      refresh();
    });
    module.input.addEventListener("change", () => {
      state.blockerModule = module.input.value;
      refresh();
    });
    distance.input.addEventListener("change", () => {
      state.blockerDistance = distance.input.value;
      refresh();
    });

    const filtered = blockerSummaries.filter(matchesBlockerFilters);
    const results = element("div", "blocker-results");
    if (filtered.length === 0) {
      results.append(element("p", "empty-state", "No current blockers match these filters."));
    } else {
      results.append(renderBlockerTable(filtered, true, null));
    }
    const resultSummary = element(
      "p",
      "filter-summary",
      `${number.format(filtered.length)} of ${number.format(blockerSummaries.length)} current blockers`,
    );
    container.replaceChildren(familyGrid, controls, resultSummary, results);
  }

  function matchesBlockerFilters(summary) {
    const declaration = externByName.get(summary.blocker.name);
    const family = summary.family ?? declaration?.family ?? "Other runtime";
    const steps = Math.max(0, (summary.examplePath?.length ?? 1) - 1);
    if (state.blockerFamily !== "all" && family !== state.blockerFamily) return false;
    if (state.blockerModule !== "all" && declaration?.module !== state.blockerModule) return false;
    if (state.blockerDistance === "far" && steps <= 8) return false;
    if (state.blockerDistance !== "all" && state.blockerDistance !== "far"
        && steps > Number(state.blockerDistance)) return false;
    if (!state.blockerQuery) return true;
    return (`${summary.blocker.name}\n${family}\n${declaration?.module ?? ""}\n`
      + `${declaration ? externTargetsLabel(declaration) : ""}`)
      .toLowerCase().includes(state.blockerQuery);
  }

  function blockerFamilyCounts(summaries) {
    const counts = new Map();
    for (const summary of summaries) {
      const declaration = externByName.get(summary.blocker.name);
      const family = summary.family ?? declaration?.family ?? "Other runtime";
      counts.set(family, (counts.get(family) ?? 0) + 1);
    }
    return [...counts].sort((lhs, rhs) => rhs[1] - lhs[1] || compareText(lhs[0], rhs[0]));
  }

  function renderBlockerTable(summaries, singleTarget, limit) {
    const wrap = element("div", "data-table-wrap blocker-table-wrap");
    if (singleTarget) wrap.classList.add("single-target");
    const headings = singleTarget
      ? ["Boundary", "Family (name-based)", "Kind", "Nearest steps", "Module", "Native target"]
      : ["Boundary", "Kind", "Public roots", "All roots", "Share of blocked IR"];
    if (completeBlockerFrontier && !singleTarget) headings.push("Nearest steps");
    if (frontierCosts.length > 0) headings.push("Exact raw cost", "Exact gzip cost");
    if (limit === null && !singleTarget) headings.push("Example blocked root");
    const table = tableElement(headings);
    const body = table.tBodies[0];
    for (const summary of summaries) {
      const row = document.createElement("tr");
      const blockerCell = document.createElement("td");
      blockerCell.className = "blocker-name";
      blockerCell.append(boundaryLink(summary.blocker.name));
      const declaration = externByName.get(summary.blocker.name);
      const cells = singleTarget
        ? [
            blockerCell,
            tableCell(summary.family ?? declaration?.family ?? "Other runtime"),
            blockerKindCell(summary.blocker.kind),
            tableCell(
              number.format(Math.max(0, (summary.examplePath?.length ?? 1) - 1)),
              "count-cell",
            ),
            tableCell(declaration?.module ?? "—", "example-root"),
            tableCell(declaration ? externTargetsLabel(declaration) : "—", "blocker-name"),
          ]
        : [
            blockerCell,
            blockerKindCell(summary.blocker.kind),
            tableCell(number.format(summary.publicRoots), "count-cell"),
            tableCell(number.format(summary.roots), "count-cell"),
            tableCell(percentage(summary.roots, report.counts.blocked), "percentage-cell"),
          ];
      if (completeBlockerFrontier && !singleTarget) {
        cells.push(tableCell(
          number.format(Math.max(0, (summary.examplePath?.length ?? 1) - 1)),
          "count-cell",
        ));
      }
      if (frontierCosts.length > 0) {
        const cost = isolatedCostByName.get(summary.blocker.name);
        cells.push(
          tableCell(cost && !cost.error ? formatBytes(cost.rawDeltaBytes) : "—", "count-cell"),
          tableCell(cost && !cost.error ? formatBytes(cost.gzipDeltaBytes) : "—", "count-cell"),
        );
      }
      if (limit === null && !singleTarget) {
        cells.push(tableCell(summary.examplePath?.[0] ?? "—", "example-root"));
      }
      row.append(...cells);
      body.append(row);
    }
    wrap.append(table);
    if (singleTarget) wrap.append(renderMobileBlockerCards(summaries));
    return wrap;
  }

  function renderMobileBlockerCards(summaries) {
    const list = element("div", "mobile-blocker-list");
    for (const summary of summaries) {
      const declaration = externByName.get(summary.blocker.name);
      const card = element("article", "mobile-blocker-card");
      const heading = element("h4");
      heading.append(boundaryLink(summary.blocker.name));
      card.append(
        heading,
        element("p", "mobile-blocker-family", summary.family ?? declaration?.family ?? "Other runtime"),
      );
      const facts = document.createElement("dl");
      appendFact(facts, "Distance", `${Math.max(0, (summary.examplePath?.length ?? 1) - 1)} steps`);
      appendFact(facts, "Kind", blockerKindLabel(summary.blocker.kind));
      appendFact(facts, "Module", declaration?.module ?? "—");
      appendFact(facts, "Native target", declaration ? externTargetsLabel(declaration) : "—");
      card.append(facts);
      list.append(card);
    }
    return list;
  }

  function renderFrontierCosts() {
    const card = sectionCard(
      "Measured frontier candidates",
      `${number.format(frontierCosts.length)} exact link${frontierCosts.length === 1 ? "" : "s"}`,
    );
    card.append(element(
      "p",
      "section-description",
      `Costs are measured against a ${formatBytes(frontierBaseline.rawBytes)} stripped baseline`
        + (frontierBaselineId ? ` (${frontierBaselineId})` : "")
        + ". Cluster rows are measured directly because costs are not additive.",
    ));
    const wrap = element("div", "data-table-wrap");
    const table = tableElement([
      "Candidate", "Native externs", "Raw delta", "Gzip delta", "Primary public", "Primary all",
    ]);
    const body = table.tBodies[0];
    for (const candidate of frontierCosts) {
      const row = document.createElement("tr");
      const names = document.createElement("td");
      names.className = "candidate-names";
      candidate.names.forEach((name, index) => {
        if (index > 0) names.append(document.createTextNode(", "));
        names.append(boundaryLink(name));
      });
      row.append(
        tableCell(candidate.id),
        names,
        tableCell(candidate.error ? "error" : formatBytes(candidate.rawDeltaBytes), "count-cell"),
        tableCell(candidate.error ? "error" : formatBytes(candidate.gzipDeltaBytes), "count-cell"),
        tableCell(number.format(candidate.primaryPublicRoots), "count-cell"),
        tableCell(number.format(candidate.primaryRoots), "count-cell"),
      );
      body.append(row);
    }
    wrap.append(table);
    card.append(wrap);
    return card;
  }

  function renderModuleLoading(module) {
    if (focusedReport && state.selectedType === "target" && selectedDeclarations.length === 1) {
      main.replaceChildren(
        contentHeading(selectedDeclarations[0].name, "Target", "Loading target declaration…"),
        sectionWithMessage("Target declaration", "Loading declaration data…", "loading"),
      );
      return;
    }
    main.replaceChildren(
      renderBreadcrumbs(parentPath(module.name), module.name),
      contentHeading(module.name, "Module", "Loading declaration data…"),
      statGrid(module.counts, "Extern boundaries", number.format(module.externCount ?? 0)),
      sectionWithMessage("Declarations", "Loading this module on demand…", "loading"),
    );
  }

  function renderModuleError(module, error) {
    main.replaceChildren(
      renderBreadcrumbs(parentPath(module.name), module.name),
      contentHeading(module.name, "Module", "Declaration data could not be loaded."),
      statGrid(module.counts, "Extern boundaries", number.format(module.externCount ?? 0)),
      sectionWithMessage("Declarations", String(error), "error-state"),
    );
  }

  function renderModule(module, payload) {
    const items = moduleDeclarationItems(module, payload);
    const moduleExterns = externsByModule.get(module.name) ?? [];
    if (focusedReport && state.selectedType === "target" && selectedDeclarations.length === 1) {
      const target = items.find((item) => item.name === selectedDeclarations[0].name);
      if (target) {
        renderFocusedTarget(module, target);
        state.focusDeclaration = null;
        state.focusShouldScroll = false;
        return;
      }
    }
    const missingExterns = moduleExterns.filter((declaration) => declaration.status === "missing").length;
    const card = sectionCard("Declarations", `${number.format(items.length)} entries`);
    const controls = element("div", "module-controls");
    const search = control("Search declarations", "input");
    search.input.type = "search";
    search.input.id = "function-search";
    search.input.placeholder = "Function, extern, or blocker name…";
    search.input.value = state.functionQuery;
    const status = control("Status", "select", [
      ["all", "All statuses"],
      ["runnable", "Closure complete"],
      ["blocked", "Blocked"],
    ]);
    status.input.value = state.functionStatus;
    status.input.id = "function-status";
    const kind = control("Class", "select", [
      ["all", "All classes"],
      ["publicConstant", "Public constant"],
      ["privateConstant", "Private constant"],
      ["boxed", "Boxed wrapper"],
      ["generated", "Generated"],
      ["extern", "Extern boundary"],
    ]);
    kind.input.value = state.functionKind;
    kind.input.id = "function-kind";
    controls.append(search.label, status.label, kind.label);

    const detail = element("div", "function-detail");
    detail.hidden = true;
    const results = element("div", "function-results");
    const refresh = () => renderDeclarationResults(items, results, detail);
    search.input.addEventListener("input", () => {
      state.focusDeclaration = null;
      state.functionQuery = search.input.value.trim().toLowerCase();
      state.visibleFunctions = 200;
      refresh();
    });
    status.input.addEventListener("change", () => {
      state.focusDeclaration = null;
      state.functionStatus = status.input.value;
      state.visibleFunctions = 200;
      refresh();
    });
    kind.input.addEventListener("change", () => {
      state.focusDeclaration = null;
      state.functionKind = kind.input.value;
      state.visibleFunctions = 200;
      refresh();
    });
    card.append(controls, detail, results);

    main.replaceChildren(
      renderBreadcrumbs(parentPath(module.name), module.name),
      contentHeading(
        module.name,
        "Module",
        `${number.format(payload.declarations.length)} IR function${payload.declarations.length === 1 ? "" : "s"} · `
          + `${number.format(moduleExterns.length)} extern boundar${moduleExterns.length === 1 ? "y" : "ies"}.`,
      ),
      statGrid(
        module.counts,
        "Extern boundaries",
        `${number.format(moduleExterns.length)} (${number.format(missingExterns)} missing)`,
      ),
      card,
    );
    refresh();
    if (state.focusDeclaration) {
      const focused = items.find((item) => item.name === state.focusDeclaration);
      if (focused) renderDeclarationDetail(focused, detail, state.focusShouldScroll);
      state.focusDeclaration = null;
      state.focusShouldScroll = false;
    }
  }

  function renderFocusedTarget(module, target) {
    const runnable = declarationRunnable(target);
    const blockers = target.declaration[6] ?? [];
    const blockerCount = runnable ? 0 : Math.max(1, blockers.length);
    const nearestSteps = runnable
      ? 0
      : Math.max(0, (target.declaration[5]?.length ?? 1) - 1);
    const stats = element("div", "stat-grid");
    stats.append(
      valueCard(
        "Static closure",
        runnable ? "✓ Complete" : "! Blocked",
        `status-card ${runnable ? "complete" : "blocked"}`,
      ),
      valueCard("Current blockers", number.format(blockerCount)),
      valueCard("Nearest distance", `${number.format(nearestSteps)} steps`),
      valueCard(
        "Root-reachable nodes",
        closureCountLabel(),
      ),
    );
    const card = sectionCard("Target declaration", module.name);
    const detail = element("div", "function-detail focused-target-detail");
    const rootSet = selectedRootBlockerSets.find((root) => root.name === target.name);
    if (rootSet && blockerSetsAvailable) {
      const action = element(
        "button",
        "target-set-action",
        `View complete blocker set (${number.format(rootSet.blockers.length)})`,
      );
      action.type = "button";
      action.addEventListener("click", () => openFunctionBlockerSetDrawer(rootSet, null, action));
      card.append(action);
    }
    card.append(detail);
    main.replaceChildren(
      contentHeading(
        target.name,
        "Target",
        `${number.format(externs.length)} extern boundaries reached under VIR's current runtime policy.`,
      ),
      stats,
      card,
    );
    renderDeclarationDetail(target, detail, false);
  }

  function moduleDeclarationItems(module, payload) {
    const items = payload.declarations.map((declaration) => ({
      type: "function",
      name: declaration[0],
      declaration,
    }));
    for (const declaration of externsByModule.get(module.name) ?? []) {
      items.push({ type: "extern", name: declaration.name, declaration });
    }
    items.sort((lhs, rhs) => compareText(lhs.name, rhs.name) || compareText(lhs.type, rhs.type));
    return items;
  }

  function renderDeclarationResults(items, container, detail) {
    const filtered = items.filter((item) => {
      const runnable = declarationRunnable(item);
      if (state.functionStatus === "runnable" && !runnable) return false;
      if (state.functionStatus === "blocked" && runnable) return false;
      if (state.functionKind !== "all" && declarationKind(item) !== state.functionKind) return false;
      if (state.functionQuery) {
        const searchable = declarationSearchText(item).toLowerCase();
        if (!searchable.includes(state.functionQuery)) return false;
      }
      return true;
    });
    const shown = filtered.slice(0, state.visibleFunctions);
    container.replaceChildren();
    if (filtered.length === 0) {
      container.append(element("p", "empty-state", "No declarations match these filters."));
      detail.hidden = true;
      return;
    }

    const wrap = element("div", "data-table-wrap");
    const table = tableElement(["Declaration", "Class", "Status", "Boundary / target"]);
    const body = table.tBodies[0];
    for (const item of shown) {
      const runnable = declarationRunnable(item);
      const row = document.createElement("tr");
      const nameCell = document.createElement("td");
      const name = element("button", "name-button", item.name);
      name.type = "button";
      name.addEventListener("click", () => renderDeclarationDetail(item, detail));
      nameCell.append(name);
      const kindCell = document.createElement("td");
      kindCell.append(element("span", "kind-pill", kindLabel(declarationKind(item))));
      const statusCell = document.createElement("td");
      const status = declarationStatus(item);
      statusCell.append(element("span", `status-pill ${status.className}`, status.label));
      const boundaryCell = document.createElement("td");
      boundaryCell.className = "blocker-name";
      if (item.type === "extern") {
        boundaryCell.textContent = externTargetsLabel(item.declaration);
      } else if (runnable) {
        boundaryCell.textContent = "—";
      } else {
        boundaryCell.append(boundaryLink(item.declaration[4]));
      }
      row.append(
        nameCell,
        kindCell,
        statusCell,
        boundaryCell,
      );
      body.append(row);
    }
    wrap.append(table);
    container.append(wrap);

    const footer = element(
      "div",
      "table-footer",
      `Showing ${number.format(shown.length)} of ${number.format(filtered.length)} matching declarations.`,
    );
    if (shown.length < filtered.length) {
      footer.append(document.createTextNode(" "));
      const more = element("button", "load-more", "Show 200 more");
      more.type = "button";
      more.addEventListener("click", () => {
        state.visibleFunctions += 200;
        renderDeclarationResults(items, container, detail);
      });
      footer.append(more);
    }
    container.append(footer);
  }

  function renderDeclarationDetail(item, detail, scrollDetail = true) {
    if (item.type === "extern") {
      renderExternDetail(item.declaration, detail, scrollDetail);
      return;
    }
    renderFunctionDetail(item.declaration, detail, scrollDetail);
  }

  function renderFunctionDetail(declaration, detail, scrollDetail = true) {
    const runnable = declaration[2] === 1;
    detail.hidden = false;
    detail.replaceChildren();
    detail.append(
      element("h3", "", declaration[0]),
      element(
        "span",
        `status-pill ${runnable ? "good" : "bad"}`,
        runnable ? "Closure complete" : "Blocked",
      ),
    );
    const facts = document.createElement("dl");
    appendFact(facts, "Class", kindLabel(declaration[1]));
    if (!runnable) {
      appendFact(facts, "Why it stops", blockerKindLabel(declaration[3]));
      appendFactNode(facts, "Boundary", boundaryLink(declaration[4]));
    }
    detail.append(facts);
    appendDeclarationMetadata(detail, declaration[7], declaration[8]);
    if (!runnable && declaration[5]?.length) {
      detail.append(element("p", "control-label", "Representative dependency path"));
      detail.append(renderDependencyPath(declaration[5]));
    }
    if (!runnable && declaration[6]?.length > 1) {
      const allBlockers = document.createElement("details");
      const summary = document.createElement("summary");
      summary.textContent = `All reached blockers (${number.format(declaration[6].length)})`;
      allBlockers.append(summary);
      const wrap = element("div", "data-table-wrap");
      const table = tableElement(["Boundary", "Kind", "Representative path"]);
      const body = table.tBodies[0];
      for (const [kind, name, path] of declaration[6]) {
        const row = document.createElement("tr");
        const boundary = document.createElement("td");
        boundary.className = "blocker-name";
        boundary.append(boundaryLink(name));
        const pathCell = document.createElement("td");
        pathCell.append(renderDependencyPath(path));
        row.append(boundary, blockerKindCell(kind), pathCell);
        body.append(row);
      }
      wrap.append(table);
      allBlockers.append(wrap);
      detail.append(allBlockers);
    }
    if (scrollDetail) detail.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function renderExternDetail(declaration, detail, scrollDetail = true) {
    const status = externStatus(declaration.status);
    detail.hidden = false;
    detail.replaceChildren(
      element("h3", "", declaration.name),
      element("span", `status-pill ${status.className}`, status.label),
    );
    const facts = document.createElement("dl");
    appendFact(facts, "Class", "extern boundary");
    appendFact(facts, "Family (name-based)", declaration.family ?? "Other runtime");
    appendFact(facts, "Owning module", declaration.module);
    const impact = blockerByName.get(declaration.name);
    if (impact) {
      appendFact(
        facts,
        "Primary impact",
        `${number.format(impact.publicRoots)} public / ${number.format(impact.roots)} all blocked roots`,
      );
    }
    const costs = frontierCostsByName.get(declaration.name) ?? [];
    const isolated = costs.find((candidate) => candidate.names.length === 1 && !candidate.error);
    if (isolated) {
      appendFact(
        facts,
        "Exact isolated cost",
        `${formatBytes(isolated.rawDeltaBytes)} raw / ${formatBytes(isolated.gzipDeltaBytes)} gzip`,
      );
    }
    detail.append(facts);
    appendDeclarationMetadata(detail, declaration.type, declaration.doc);
    if (costs.length > 0) {
      detail.append(element("p", "control-label", "Measured frontier candidates"));
      const list = element("ul", "extern-targets");
      for (const candidate of costs) {
        list.append(element(
          "li",
          "",
          candidate.error
            ? `${candidate.id}: measurement error`
            : `${candidate.id}: ${formatBytes(candidate.rawDeltaBytes)} raw / ` +
              `${formatBytes(candidate.gzipDeltaBytes)} gzip (${candidate.names.length} externs)`,
        ));
      }
      detail.append(list);
    }
    detail.append(element("p", "control-label", "Extern targets"));
    const targets = element("ul", "extern-targets");
    for (const target of declaration.targets) {
      const item = element("li", "", externTargetLabel(target));
      if (target.value && !focusedReport && !collectionReport) {
        const link = element("a", "cross-report-link", "Search Wasm size");
        link.href = `../size/#view=ownership&query=${encodeURIComponent(target.value)}`;
        link.title = `Search the Wasm size explorer for ${target.value}`;
        item.append(document.createTextNode(" "), link);
      }
      targets.append(item);
    }
    detail.append(targets);
    if (impact?.examplePath?.length) {
      detail.append(element("p", "control-label", "Representative blocked dependency path"));
      detail.append(renderDependencyPath(impact.examplePath));
    }
    if (scrollDetail) detail.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function renderBreadcrumbs(folderPath, moduleName) {
    const crumbs = element("nav", "breadcrumbs");
    crumbs.ariaLabel = "Breadcrumb";
    const root = element("button", "breadcrumb-button", focusedReport ? "Target" : "All libraries");
    root.type = "button";
    root.addEventListener("click", () => selectPrimaryView());
    crumbs.append(root);
    let path = "";
    for (const part of folderPath ? folderPath.split(".") : []) {
      path = path ? `${path}.${part}` : part;
      const folder = folderByPath.get(path);
      if (!folder) continue;
      crumbs.append(element("span", "breadcrumb-separator", "/"));
      const button = element("button", "breadcrumb-button", part);
      button.type = "button";
      button.addEventListener("click", () => selectFolder(folder));
      crumbs.append(button);
    }
    if (moduleName) {
      crumbs.append(
        element("span", "breadcrumb-separator", "/"),
        element("span", "", moduleLabel(moduleName)),
      );
    }
    return crumbs;
  }

  function contentHeading(title, type, description) {
    const heading = element("div", "content-heading");
    const copy = document.createElement("div");
    copy.append(element("h2", "", title), element("p", "", description));
    heading.append(copy, element("span", "type-pill", type));
    return heading;
  }

  function statGrid(counts, thirdLabel, thirdValue) {
    const grid = element("div", "stat-grid");
    grid.append(
      coverageCard("Public constants", counts.publicRunnable, counts.publicTotal),
      coverageCard("All IR functions", counts.runnable, counts.total),
      valueCard(thirdLabel, thirdValue),
    );
    return grid;
  }

  function coverageCard(label, runnable, total) {
    const card = element("div", "stat-card");
    card.append(
      element("span", "label", label),
      element("strong", "value", ratioText(runnable, total)),
    );
    const track = element("div", "coverage-track");
    track.classList.add(progressTone(runnable, total));
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", `${number.format(runnable)} of ${number.format(total)} closure complete`);
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", total === 0 ? "0" : ((runnable * 100) / total).toFixed(1));
    const fill = element("div", "coverage-fill");
    fill.style.width = total === 0 ? "0%" : `${Math.min(100, (runnable * 100) / total)}%`;
    track.append(fill);
    card.append(track);
    return card;
  }

  function valueCard(label, value, className = "") {
    const card = element("div", `stat-card ${className}`.trim());
    card.append(element("span", "label", label), element("strong", "value", value));
    return card;
  }

  function sectionCard(title, meta) {
    const card = element("section", "section-card");
    const heading = element("div", "section-heading");
    heading.append(element("h3", "", title), element("span", "", meta));
    card.append(heading);
    return card;
  }

  function sectionWithMessage(title, message, className) {
    const card = sectionCard(title, "");
    card.append(element("p", className, message));
    return card;
  }

  function tableElement(headings) {
    const table = element("table", "data-table");
    const head = table.createTHead();
    const row = head.insertRow();
    for (const heading of headings) row.append(element("th", "", heading));
    table.createTBody();
    return table;
  }

  function tableCell(text, className = "") {
    return element("td", className, text ?? "—");
  }

  function formatBytes(value) {
    if (!Number.isFinite(value)) return "—";
    if (Math.abs(value) < 1024) return `${number.format(value)} B`;
    return `${(value / 1024).toFixed(2)} KiB`;
  }

  function coverageTableCell(runnable, total) {
    const cell = element("td", "percentage-cell coverage-table-cell");
    cell.append(
      element("span", "coverage-ratio", ratioText(runnable, total)),
      progressBar(runnable, total, "table-progress"),
    );
    return cell;
  }

  function progressBar(runnable, total, className) {
    const percent = total === 0 ? 0 : Math.min(100, (runnable * 100) / total);
    const track = element("span", `mini-progress ${className}`);
    track.classList.add(progressTone(runnable, total));
    track.setAttribute("role", "progressbar");
    track.setAttribute("aria-label", `${number.format(runnable)} of ${number.format(total)} closure complete`);
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");
    track.setAttribute("aria-valuenow", percent.toFixed(1));
    const fill = element("span", "mini-progress-fill");
    fill.style.width = `${percent}%`;
    track.append(fill);
    return track;
  }

  function progressTone(runnable, total) {
    if (total === 0) return "progress-empty";
    const percent = (runnable * 100) / total;
    if (percent < 40) return "progress-low";
    if (percent < 70) return "progress-developing";
    if (percent < 90) return "progress-strong";
    return "progress-broad";
  }

  function control(labelText, kind, options = []) {
    const label = document.createElement("label");
    label.append(element("span", "", labelText));
    const input = document.createElement(kind);
    if (kind === "select") {
      for (const [value, text] of options) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        input.append(option);
      }
    }
    label.append(input);
    return { label, input };
  }

  function appendFact(list, term, description) {
    list.append(element("dt", "", term), element("dd", "", description));
  }

  function appendFactNode(list, term, description) {
    const value = element("dd");
    value.append(description);
    list.append(element("dt", "", term), value);
  }

  function appendDeclarationMetadata(container, typeSignature, docString) {
    if (typeSignature) {
      const section = element("section", "declaration-metadata");
      section.append(element("p", "control-label", "Lean type"));
      const signature = element("pre", "declaration-signature");
      signature.append(element("code", "", typeSignature));
      section.append(signature);
      container.append(section);
    }
    if (docString) {
      const section = element("section", "declaration-metadata");
      section.append(
        element("p", "control-label", "Lean docstring"),
        element("div", "declaration-docstring", docString),
      );
      container.append(section);
    }
  }

  function declarationRunnable(item) {
    return item.type === "extern"
      ? item.declaration.status !== "missing"
      : item.declaration[2] === 1;
  }

  function declarationKind(item) {
    return item.type === "extern" ? "extern" : item.declaration[1];
  }

  function declarationStatus(item) {
    if (item.type === "extern") return externStatus(item.declaration.status);
    return item.declaration[2] === 1
      ? { label: "Closure complete", className: "good" }
      : { label: "Blocked", className: "bad" };
  }

  function externStatus(status) {
    return {
      native: { label: "Native boundary", className: "good" },
      host: { label: "Host boundary (assumed)", className: "host" },
      missing: { label: "Missing boundary", className: "bad" },
    }[status] ?? { label: status, className: "bad" };
  }

  function blockerKindLabel(kind) {
    return {
      missingExtern: "Missing runtime extern",
      missingDecl: "IR declaration unavailable",
      unsupportedInitGlobal: "Unsupported initialized global",
    }[kind] ?? kind ?? "Unknown boundary";
  }

  function blockerKindCell(kind) {
    const cell = document.createElement("td");
    const label = element("span", "blocker-kind-label", blockerKindLabel(kind));
    label.title = `Analyzer kind: ${kind ?? "unknown"}`;
    cell.append(label);
    return cell;
  }

  function declarationSearchText(item) {
    if (item.type === "extern") {
      return `${item.name}\n${item.declaration.status}\n${item.declaration.family ?? ""}\n`
        + `${item.declaration.type ?? ""}\n${item.declaration.doc ?? ""}\n`
        + externTargetsLabel(item.declaration);
    }
    return `${item.name}\n${item.declaration[4] ?? ""}\n`
      + `${item.declaration[7] ?? ""}\n${item.declaration[8] ?? ""}`;
  }

  function externTargetsLabel(declaration) {
    return declaration.targets.map((target) => target.value ?? externTargetLabel(target)).join(", ");
  }

  function externTargetLabel(target) {
    const kind = target.backend ? `${target.kind} [${target.backend}]` : target.kind;
    return target.value ? `${kind}: ${target.value}` : kind;
  }

  function boundaryLink(name) {
    const declaration = externByName.get(name);
    const module = declaration && moduleByName.get(declaration.module);
    if (!module) return element("span", "", name);
    const link = element("button", "boundary-link", name);
    link.type = "button";
    link.title = focusedReport
      ? `Inspect ${name} without leaving this view`
      : `Open ${name} in ${module.name}`;
    link.addEventListener("click", () => {
      if (focusedReport) openBoundaryDrawer(declaration, module, link);
      else selectModule(module, true, name);
    });
    return link;
  }

  function openDrawerShell({ className = "", eyebrow, title, closeLabel, returnFocus }) {
    const previous = drawerStack.at(-1);
    if (previous) {
      previous.layer.inert = true;
      previous.layer.setAttribute("aria-hidden", "true");
    }
    const layer = element("div", "boundary-drawer-layer");
    layer.style.zIndex = String(20 + drawerStack.length);
    const backdrop = element("button", "boundary-drawer-backdrop");
    backdrop.type = "button";
    backdrop.tabIndex = -1;
    backdrop.ariaLabel = closeLabel;
    const drawer = element("aside", `boundary-drawer ${className}`.trim());
    drawer.setAttribute("role", "dialog");
    drawer.setAttribute("aria-modal", "true");
    const titleId = `boundary-drawer-title-${++drawerSequence}`;
    drawer.setAttribute("aria-labelledby", titleId);
    const header = element("div", "boundary-drawer-header");
    const heading = element("div");
    const titleElement = element("h2", "", title);
    titleElement.id = titleId;
    heading.append(element("p", "eyebrow", eyebrow), titleElement);
    const close = element("button", "boundary-drawer-close", "Close");
    close.type = "button";
    header.append(heading, close);
    const body = element("div", "boundary-drawer-body");
    drawer.append(header, body);
    layer.append(backdrop, drawer);
    const state = { layer, drawer, close, returnFocus };
    const dismiss = () => dismissDrawer(state);
    close.addEventListener("click", dismiss);
    backdrop.addEventListener("click", dismiss);
    drawerStack.push(state);
    document.body.append(layer);
    document.body.classList.add("drawer-open");
    if (drawerStack.length === 1) document.addEventListener("keydown", onDrawerKeyDown);
    close.focus();
    return { body, dismiss };
  }

  function dismissDrawer(state, restoreFocus = true) {
    const index = drawerStack.indexOf(state);
    if (index < 0) return;
    const wasTop = index === drawerStack.length - 1;
    drawerStack.splice(index, 1);
    state.layer.remove();
    if (drawerStack.length === 0) {
      document.removeEventListener("keydown", onDrawerKeyDown);
      document.body.classList.remove("drawer-open");
    } else if (wasTop) {
      const next = drawerStack.at(-1);
      next.layer.inert = false;
      next.layer.removeAttribute("aria-hidden");
    }
    if (restoreFocus && wasTop) {
      const target = state.returnFocus?.isConnected
        ? state.returnFocus
        : drawerStack.at(-1)?.close;
      target?.focus();
    }
  }

  function closeAllDrawers() {
    for (const state of [...drawerStack].reverse()) dismissDrawer(state, false);
  }

  function onDrawerKeyDown(event) {
    const state = drawerStack.at(-1);
    if (!state) return;
    if (event.key === "Escape") {
      event.preventDefault();
      dismissDrawer(state);
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = [...state.drawer.querySelectorAll(
      "button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), "
        + "textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])",
    )].filter((node) => node.getClientRects().length > 0);
    if (focusable.length === 0) {
      event.preventDefault();
      state.drawer.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && (document.activeElement === first || !state.drawer.contains(document.activeElement))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey
        && (document.activeElement === last || !state.drawer.contains(document.activeElement))) {
      event.preventDefault();
      first.focus();
    }
  }

  function openFunctionBlockerSetDrawer(root, focusedBlocker, returnFocus) {
    const { body } = openDrawerShell({
      className: "function-blocker-set-drawer",
      eyebrow: "Complete blocker set",
      title: root.name,
      closeLabel: "Close function blocker set",
      returnFocus,
    });
    body.append(element(
      "span",
      `status-pill ${root.runnable ? "good" : "bad"}`,
      root.runnable ? "Closure complete" : `${number.format(root.blockers.length)} terminal blockers`,
    ));
    const facts = document.createElement("dl");
    appendFact(facts, "Owning module", root.module);
    appendFact(facts, "Blocker coverage", "Complete frontier under the captured runtime policy");
    body.append(facts);
    if (root.blockers.length === 0) {
      body.append(element("p", "empty-state", "This function has no terminal blockers."));
    } else {
      const wrap = element("div", "data-table-wrap blocker-set-drawer-table");
      const table = tableElement(["Boundary", "Role", "Kind", "Size impact", "Path"]);
      const tableBody = table.tBodies[0];
      let focusedRow = null;
      for (const entry of root.blockers) {
        const primary = root.primaryBlocker?.kind === entry.blocker.kind
          && root.primaryBlocker?.name === entry.blocker.name;
        const selected = focusedBlocker?.kind === entry.blocker.kind
          && focusedBlocker?.name === entry.blocker.name;
        const row = document.createElement("tr");
        if (selected) {
          row.classList.add("focused-blocker-row");
          focusedRow = row;
        }
        const boundary = document.createElement("td");
        boundary.className = "blocker-name";
        boundary.append(boundaryLink(entry.blocker.name));
        const pathCell = document.createElement("td");
        const path = document.createElement("details");
        path.open = selected;
        const summary = document.createElement("summary");
        summary.textContent = `${Math.max(0, (entry.path?.length ?? 1) - 1)} steps`;
        path.append(summary, renderDependencyPath(entry.path ?? []));
        pathCell.append(path);
        row.append(
          boundary,
          tableCell(primary ? "Primary" : "Reached"),
          blockerKindCell(entry.blocker.kind),
          sizeImpactCell(entry.blocker.name),
          pathCell,
        );
        tableBody.append(row);
      }
      wrap.append(table);
      body.append(wrap);
      if (focusedRow) requestAnimationFrame(() => focusedRow.scrollIntoView({ block: "center" }));
    }
  }

  function openBoundaryDrawer(declaration, module, returnFocus) {
    const { body } = openDrawerShell({
      eyebrow: "Reached boundary",
      title: declaration.name,
      closeLabel: "Close boundary details",
      returnFocus,
    });
    const status = externStatus(declaration.status);
    body.append(element("span", `status-pill ${status.className}`, status.label));
    const facts = document.createElement("dl");
    appendFact(facts, "Family (name-based)", declaration.family ?? "Other runtime");
    appendFact(facts, "Owning module", module.name);
    appendFact(facts, "Native target", externTargetsLabel(declaration) || "—");
    const blocker = blockerByName.get(declaration.name);
    if (blocker) {
      appendFact(facts, "Why it stops", blockerKindLabel(blocker.blocker.kind));
      appendFact(
        facts,
        focusedReport ? "Selected targets affected" : "Blocked roots",
        focusedReport
          ? number.format(blocker.roots)
          : `${number.format(blocker.publicRoots)} public / ${number.format(blocker.roots)} all`,
      );
    }
    body.append(facts);
    appendDeclarationMetadata(body, declaration.type, declaration.doc);
    if (blocker?.examplePath?.length) {
      body.append(
        element("p", "control-label", "Representative dependency path"),
        renderDependencyPath(blocker.examplePath),
      );
    }
    const openModule = element("button", "drawer-primary-action", "Open owning module");
    openModule.type = "button";
    body.append(openModule);
    openModule.addEventListener("click", () => {
      closeAllDrawers();
      selectModule(module, true, declaration.name, true);
    });
  }

  function renderDependencyPath(names) {
    const path = element("ol", "dependency-path");
    for (const name of names) {
      const item = document.createElement("li");
      item.append(externByName.has(name) ? boundaryLink(name) : document.createTextNode(name));
      path.append(item);
    }
    return path;
  }

  function loadModule(module) {
    if (moduleCache.has(module.id)) return Promise.resolve(moduleCache.get(module.id));
    if (modulePromises.has(module.id)) return modulePromises.get(module.id).promise;
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const script = document.createElement("script");
    script.src = module.dataPath;
    script.async = true;
    script.addEventListener("error", () => {
      modulePromises.delete(module.id);
      script.remove();
      rejectPromise(new Error(
        `Unable to load ${module.dataPath}. If the browser blocks local scripts, serve this directory with a static HTTP server.`,
      ));
    });
    modulePromises.set(module.id, { promise, resolve: resolvePromise, script });
    document.body.append(script);
    return promise;
  }

  function selectionFromHash() {
    const hash = location.hash.slice(1);
    const separator = hash.indexOf("=");
    if (separator < 0) return null;
    const type = hash.slice(0, separator);
    const value = decodeURIComponent(hash.slice(separator + 1));
    if (type === "view" && value === "targets") return { type: "targetSet" };
    if (type === "view" && value === "blockers") return { type: "blockers" };
    if (type === "view" && value === "blocker-sets") return { type: "blockerSets" };
    if (type === "view" && value === "externs") return { type: "externs" };
    if (type === "module" && moduleByName.has(value)) return { type, value: moduleByName.get(value) };
    if (type === "folder" && folderByPath.has(value)) return { type, value: folderByPath.get(value) };
    if (type === "declaration" && externByName.has(value)) {
      const declaration = externByName.get(value);
      const module = moduleByName.get(declaration.module);
      if (module) return { type: "module", value: module, focusDeclaration: value };
    }
    if (type === "declaration" && selectedDeclarationByName.has(value)) {
      const declaration = selectedDeclarationByName.get(value);
      const module = moduleByName.get(declaration.module);
      if (module) return { type: "module", value: module, focusDeclaration: value };
    }
    return null;
  }

  function setHash(type, value) {
    const next = `#${type}=${encodeURIComponent(value)}`;
    if (location.hash !== next) history.pushState(null, "", next);
  }

  function expandFolderAncestors(path) {
    let current = "";
    for (const part of path ? path.split(".") : []) {
      current = current ? `${current}.${part}` : part;
      state.expanded.add(current);
    }
  }

  function metricValues(counts, metric) {
    return metric === "public"
      ? [counts.publicRunnable, counts.publicTotal]
      : [counts.runnable, counts.total];
  }

  function percentage(part, total) {
    if (total === 0) return "n/a";
    return `${((part * 100) / total).toFixed(1)}%`;
  }

  function closureCountLabel() {
    if (closure === null) return "Not recorded";
    return closure.capturedNodes === closure.rootReachableNodes
      ? number.format(closure.rootReachableNodes)
      : `${number.format(closure.rootReachableNodes)} / ${number.format(closure.capturedNodes)}`;
  }

  function capitalize(text) {
    return text.length === 0 ? text : `${text[0].toUpperCase()}${text.slice(1)}`;
  }

  function ratioText(part, total) {
    return `${number.format(part)} / ${number.format(total)} (${percentage(part, total)})`;
  }

  function moduleLabel(name) {
    const index = name.lastIndexOf(".");
    return index < 0 ? name : name.slice(index + 1);
  }

  function parentPath(name) {
    const index = name.lastIndexOf(".");
    return index < 0 ? "" : name.slice(0, index);
  }

  function shortHash(hash) {
    return hash ? hash.slice(0, 10) : "unknown build";
  }

  function kindLabel(kind) {
    return {
      publicConstant: "public",
      privateConstant: "private",
      boxed: "boxed",
      generated: "generated",
    }[kind] ?? kind;
  }

  function compareText(lhs, rhs) {
    return lhs < rhs ? -1 : lhs > rhs ? 1 : 0;
  }

  function element(tag, className = "", text = null) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== null) node.textContent = text;
    return node;
  }
})();
