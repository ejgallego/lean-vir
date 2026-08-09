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
  const moduleByName = new Map(report.modules.map((module) => [module.name, module]));
  const externs = report.externs ?? [];
  const externByName = new Map(externs.map((declaration) => [declaration.name, declaration]));
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
    report.primaryBlockers.map((summary) => [summary.blocker.name, summary]),
  );
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
  const blockersView = document.querySelector("#top-blockers-view");
  const moduleCache = new Map();
  const modulePromises = new Map();
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
  librariesView.addEventListener("click", () => selectFolder(rootFolder));
  blockersView.addEventListener("click", () => selectTopBlockers());
  metricSelect.addEventListener("change", () => {
    state.metric = metricSelect.value;
    renderTree();
  });
  moduleSearch.addEventListener("input", () => {
    state.moduleQuery = moduleSearch.value.trim().toLowerCase();
    renderTree();
  });

  const initial = selectionFromHash();
  if (initial?.type === "blockers") {
    selectTopBlockers(false);
  } else if (initial?.type === "module") {
    selectModule(initial.value, false, initial.focusDeclaration);
  } else if (initial?.type === "folder") {
    selectFolder(initial.value, false);
  } else {
    selectFolder(rootFolder, false);
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
    const identity = document.querySelector("#report-identity");
    identity.textContent = [
      `Lean ${report.lean.version}`,
      shortHash(report.lean.githash),
      `${number.format(report.selectedModuleCount)} modules`,
      `${number.format(report.runtimeCapabilityCount)} native capabilities`,
      `${number.format(externs.length)} extern boundaries`,
    ].join(" · ");

    const summary = document.querySelector("#global-summary");
    summary.replaceChildren(
      headerStat(percentage(report.counts.publicRunnable, report.counts.publicTotal), "Public constants"),
      headerStat(percentage(report.counts.runnable, report.counts.total), "All IR functions"),
      headerStat(number.format(report.counts.blocked), "Blocked functions"),
    );
    document.querySelector("#libraries-view-count").textContent =
      number.format(report.selectedModuleCount);
    document.querySelector("#top-blockers-view-count").textContent =
      number.format(report.primaryBlockers.length);
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
    if (selected) {
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
    if (state.selectedType === "module" && state.selectedValue.id === module.id) row.classList.add("selected");
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

  function selectModule(module, updateHash = true, focusDeclaration = null) {
    state.selectedType = "module";
    state.selectedValue = module;
    state.functionQuery = focusDeclaration?.toLowerCase() ?? "";
    if (focusDeclaration) state.functionStatus = "all";
    state.functionKind = focusDeclaration ? "extern" : "all";
    state.visibleFunctions = 200;
    state.focusDeclaration = focusDeclaration;
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

  function selectTopBlockers(updateHash = true) {
    state.selectedType = "blockers";
    state.selectedValue = null;
    state.requestVersion += 1;
    if (updateHash) setHash("view", "blockers");
    renderViewNavigation();
    renderTree();
    renderTopBlockersView();
  }

  function renderViewNavigation() {
    const blockersSelected = state.selectedType === "blockers";
    blockersView.classList.toggle("selected", blockersSelected);
    blockersView.setAttribute("aria-current", blockersSelected ? "page" : "false");
    librariesView.classList.toggle("selected", !blockersSelected);
    librariesView.setAttribute("aria-current", blockersSelected ? "false" : "page");
  }

  function renderFolder(folder) {
    main.replaceChildren(
      renderBreadcrumbs(folder.path, null),
      contentHeading(folder.path || "All Lean libraries", "Folder", folderDescription(folder)),
      statGrid(folder.counts, "Modules", number.format(folder.moduleCount)),
      renderFolderContents(folder),
    );
    if (folder === rootFolder && report.primaryBlockers.length > 0) {
      main.append(renderTopBlockers(25));
    }
  }

  function renderTopBlockersView() {
    const publicBlocked = report.counts.publicTotal - report.counts.publicRunnable;
    const stats = element("div", "stat-grid");
    stats.append(
      valueCard("Primary boundaries", number.format(report.primaryBlockers.length)),
      valueCard("Blocked public constants", number.format(publicBlocked)),
      valueCard("Blocked all IR functions", number.format(report.counts.blocked)),
    );
    const sections = [
      contentHeading(
        "Top blockers",
        "Report view",
        "Primary boundaries ranked by blocked IR roots. Each root is counted once at its nearest deterministic boundary.",
      ),
      stats,
    ];
    if (frontierCosts.length > 0) sections.push(renderFrontierCosts());
    sections.push(renderTopBlockers());
    main.replaceChildren(...sections);
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

  function renderTopBlockers(limit = null) {
    const summaries = limit === null ? report.primaryBlockers : report.primaryBlockers.slice(0, limit);
    const card = sectionCard(
      "Top primary blockers",
      limit === null
        ? `${number.format(summaries.length)} ranked boundaries`
        : `${number.format(summaries.length)} of ${number.format(report.primaryBlockers.length)}`,
    );
    const wrap = element("div", "data-table-wrap");
    const headings = ["Boundary", "Kind", "Public roots", "All roots", "Share of blocked IR"];
    if (frontierCosts.length > 0) headings.push("Exact raw cost", "Exact gzip cost");
    if (limit === null) headings.push("Example blocked root");
    const table = tableElement(headings);
    const body = table.tBodies[0];
    for (const summary of summaries) {
      const row = document.createElement("tr");
      const blockerCell = document.createElement("td");
      blockerCell.className = "blocker-name";
      blockerCell.append(boundaryLink(summary.blocker.name));
      const cells = [
        blockerCell,
        tableCell(summary.blocker.kind),
        tableCell(number.format(summary.publicRoots), "count-cell"),
        tableCell(number.format(summary.roots), "count-cell"),
        tableCell(percentage(summary.roots, report.counts.blocked), "percentage-cell"),
      ];
      if (frontierCosts.length > 0) {
        const cost = isolatedCostByName.get(summary.blocker.name);
        cells.push(
          tableCell(cost && !cost.error ? formatBytes(cost.rawDeltaBytes) : "—", "count-cell"),
          tableCell(cost && !cost.error ? formatBytes(cost.gzipDeltaBytes) : "—", "count-cell"),
        );
      }
      if (limit === null) cells.push(tableCell(summary.examplePath?.[0] ?? "—", "example-root"));
      row.append(...cells);
      body.append(row);
    }
    wrap.append(table);
    card.append(wrap);
    return card;
  }

  function renderFrontierCosts() {
    const card = sectionCard(
      "Measured frontier candidates",
      `${number.format(frontierCosts.length)} exact link${frontierCosts.length === 1 ? "" : "s"}`,
    );
    card.append(element(
      "p",
      "section-description",
      `Costs are measured against a ${formatBytes(report.frontierCosts.baseline.rawBytes)} ` +
        "stripped baseline. Cluster rows are measured directly because costs are not additive.",
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
      ["runnable", "VIR-able"],
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
      if (focused) renderDeclarationDetail(focused, detail);
      state.focusDeclaration = null;
    }
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

  function renderDeclarationDetail(item, detail) {
    if (item.type === "extern") {
      renderExternDetail(item.declaration, detail);
      return;
    }
    renderFunctionDetail(item.declaration, detail);
  }

  function renderFunctionDetail(declaration, detail) {
    const runnable = declaration[2] === 1;
    detail.hidden = false;
    detail.replaceChildren();
    detail.append(
      element("h3", "", declaration[0]),
      element("span", `status-pill ${runnable ? "good" : "bad"}`, runnable ? "VIR-able" : "Blocked"),
    );
    const facts = document.createElement("dl");
    appendFact(facts, "Class", kindLabel(declaration[1]));
    if (!runnable) {
      appendFact(facts, "Blocker kind", declaration[3]);
      appendFactNode(facts, "Boundary", boundaryLink(declaration[4]));
    }
    detail.append(facts);
    if (!runnable && declaration[5]?.length) {
      detail.append(element("p", "control-label", "Representative dependency path"));
      detail.append(renderDependencyPath(declaration[5]));
    }
    detail.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function renderExternDetail(declaration, detail) {
    const status = externStatus(declaration.status);
    detail.hidden = false;
    detail.replaceChildren(
      element("h3", "", declaration.name),
      element("span", `status-pill ${status.className}`, status.label),
    );
    const facts = document.createElement("dl");
    appendFact(facts, "Class", "extern boundary");
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
      if (target.value) {
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
    detail.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function renderBreadcrumbs(folderPath, moduleName) {
    const crumbs = element("nav", "breadcrumbs");
    crumbs.ariaLabel = "Breadcrumb";
    const root = element("button", "breadcrumb-button", "All libraries");
    root.type = "button";
    root.addEventListener("click", () => selectFolder(rootFolder));
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
    const fill = element("div", "coverage-fill");
    fill.style.width = total === 0 ? "0%" : `${Math.min(100, (runnable * 100) / total)}%`;
    track.append(fill);
    card.append(track);
    return card;
  }

  function valueCard(label, value) {
    const card = element("div", "stat-card");
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
    track.setAttribute("aria-label", `${number.format(runnable)} of ${number.format(total)} VIR-able`);
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
      ? { label: "VIR-able", className: "good" }
      : { label: "Blocked", className: "bad" };
  }

  function externStatus(status) {
    return {
      native: { label: "Native boundary", className: "good" },
      host: { label: "Host boundary", className: "host" },
      missing: { label: "Missing boundary", className: "bad" },
    }[status] ?? { label: status, className: "bad" };
  }

  function declarationSearchText(item) {
    if (item.type === "extern") {
      return `${item.name}\n${item.declaration.status}\n${externTargetsLabel(item.declaration)}`;
    }
    return `${item.name}\n${item.declaration[4] ?? ""}`;
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
    link.title = `Open ${name} in ${module.name}`;
    link.addEventListener("click", () => selectModule(module, true, name));
    return link;
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
    modulePromises.set(module.id, { promise, resolve: resolvePromise, reject: rejectPromise, script });
    document.body.append(script);
    return promise;
  }

  function selectionFromHash() {
    const hash = location.hash.slice(1);
    const separator = hash.indexOf("=");
    if (separator < 0) return null;
    const type = hash.slice(0, separator);
    const value = decodeURIComponent(hash.slice(separator + 1));
    if (type === "view" && value === "blockers") return { type: "blockers" };
    if (type === "module" && moduleByName.has(value)) return { type, value: moduleByName.get(value) };
    if (type === "folder" && folderByPath.has(value)) return { type, value: folderByPath.get(value) };
    if (type === "declaration" && externByName.has(value)) {
      const declaration = externByName.get(value);
      const module = moduleByName.get(declaration.module);
      if (module) return { type: "module", value: module, focusDeclaration: value };
    }
    return null;
  }

  function setHash(type, value) {
    history.replaceState(null, "", `#${type}=${encodeURIComponent(value)}`);
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
