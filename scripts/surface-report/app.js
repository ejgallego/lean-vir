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
  const folderByPath = new Map();
  const rootFolder = buildFolderTree(report.modules);
  const tree = document.querySelector("#module-tree");
  const main = document.querySelector("#report-main");
  const metricSelect = document.querySelector("#metric-select");
  const moduleSearch = document.querySelector("#module-search");
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
  metricSelect.addEventListener("change", () => {
    state.metric = metricSelect.value;
    renderTree();
  });
  moduleSearch.addEventListener("input", () => {
    state.moduleQuery = moduleSearch.value.trim().toLowerCase();
    renderTree();
  });

  const initial = selectionFromHash();
  if (initial?.type === "module") {
    selectModule(initial.value, false);
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
    ].join(" · ");

    const summary = document.querySelector("#global-summary");
    summary.replaceChildren(
      headerStat(percentage(report.counts.publicRunnable, report.counts.publicTotal), "Public constants"),
      headerStat(percentage(report.counts.runnable, report.counts.total), "All IR functions"),
      headerStat(number.format(report.counts.blocked), "Blocked functions"),
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
    row.append(toggle, label, treePercentage(folder.counts));
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
    row.append(spacer, label, treePercentage(module.counts));
    return row;
  }

  function treePercentage(counts) {
    const [runnable, total] = metricValues(counts, state.metric);
    const badge = element("span", "tree-percent", percentage(runnable, total));
    badge.title = `${number.format(runnable)} / ${number.format(total)}`;
    return badge;
  }

  function selectFolder(folder, updateHash = true) {
    state.selectedType = "folder";
    state.selectedValue = folder;
    state.requestVersion += 1;
    expandFolderAncestors(folder.path);
    if (updateHash) setHash("folder", folder.path);
    renderTree();
    renderFolder(folder);
  }

  function selectModule(module, updateHash = true) {
    state.selectedType = "module";
    state.selectedValue = module;
    state.functionQuery = "";
    state.functionStatus = "all";
    state.functionKind = "all";
    state.visibleFunctions = 200;
    expandFolderAncestors(parentPath(module.name));
    if (updateHash) setHash("module", module.name);
    const requestVersion = ++state.requestVersion;
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

  function renderFolder(folder) {
    main.replaceChildren(
      renderBreadcrumbs(folder.path, null),
      contentHeading(folder.path || "All Lean libraries", "Folder", folderDescription(folder)),
      statGrid(folder.counts, "Modules", number.format(folder.moduleCount)),
      renderFolderContents(folder),
    );
    if (folder === rootFolder && report.primaryBlockers.length > 0) {
      main.append(renderTopBlockers());
    }
  }

  function folderDescription(folder) {
    const immediate = folder.folders.size + folder.files.length;
    return `${number.format(immediate)} immediate item${immediate === 1 ? "" : "s"}; `
      + `${number.format(folder.moduleCount)} module${folder.moduleCount === 1 ? "" : "s"} below this folder.`;
  }

  function renderFolderContents(folder) {
    const card = sectionCard("Subfolders and modules", `${folder.folders.size + folder.files.length} items`);
    const tableWrap = element("div", "data-table-wrap");
    const table = tableElement(["Name", "Type", "Public constants", "All IR", "Functions"]);
    const body = table.tBodies[0];
    for (const child of folder.folders.values()) {
      body.append(folderContentRow(child.label, "Folder", child.counts, () => {
        state.expanded.add(child.path);
        selectFolder(child);
      }));
    }
    for (const module of folder.files) {
      body.append(folderContentRow(moduleLabel(module.name), "Module", module.counts, () => selectModule(module)));
    }
    if (body.rows.length === 0) {
      tableWrap.append(element("p", "empty-state", "This folder contains no analyzed modules."));
    } else {
      tableWrap.append(table);
    }
    card.append(tableWrap);
    return card;
  }

  function folderContentRow(label, type, counts, onSelect) {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    const link = element("button", "content-link", label);
    link.type = "button";
    link.addEventListener("click", onSelect);
    nameCell.append(link);
    row.append(
      nameCell,
      tableCell(type),
      tableCell(ratioText(counts.publicRunnable, counts.publicTotal), "percentage-cell"),
      tableCell(ratioText(counts.runnable, counts.total), "percentage-cell"),
      tableCell(number.format(counts.total), "count-cell"),
    );
    return row;
  }

  function renderTopBlockers() {
    const card = sectionCard("Top primary blockers", "Deterministic nearest boundary");
    const wrap = element("div", "data-table-wrap");
    const table = tableElement(["Boundary", "Kind", "Public roots", "All roots"]);
    const body = table.tBodies[0];
    for (const summary of report.primaryBlockers.slice(0, 25)) {
      const row = document.createElement("tr");
      row.append(
        tableCell(summary.blocker.name, "blocker-name"),
        tableCell(summary.blocker.kind),
        tableCell(number.format(summary.publicRoots), "count-cell"),
        tableCell(number.format(summary.roots), "count-cell"),
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
      statGrid(module.counts, "Blocked", number.format(module.counts.blocked)),
      sectionWithMessage("Functions", "Loading this module on demand…", "loading"),
    );
  }

  function renderModuleError(module, error) {
    main.replaceChildren(
      renderBreadcrumbs(parentPath(module.name), module.name),
      contentHeading(module.name, "Module", "Declaration data could not be loaded."),
      statGrid(module.counts, "Blocked", number.format(module.counts.blocked)),
      sectionWithMessage("Functions", String(error), "error-state"),
    );
  }

  function renderModule(module, payload) {
    const card = sectionCard("Functions", `${number.format(payload.declarations.length)} declarations`);
    const controls = element("div", "module-controls");
    const search = control("Search functions", "input");
    search.input.type = "search";
    search.input.placeholder = "Function or blocker name…";
    search.input.value = state.functionQuery;
    const status = control("Status", "select", [
      ["all", "All statuses"],
      ["runnable", "VIR-able"],
      ["blocked", "Blocked"],
    ]);
    status.input.value = state.functionStatus;
    const kind = control("Class", "select", [
      ["all", "All classes"],
      ["publicConstant", "Public constant"],
      ["privateConstant", "Private constant"],
      ["boxed", "Boxed wrapper"],
      ["generated", "Generated"],
    ]);
    kind.input.value = state.functionKind;
    controls.append(search.label, status.label, kind.label);

    const detail = element("div", "function-detail");
    detail.hidden = true;
    const results = element("div", "function-results");
    const refresh = () => renderFunctionResults(payload, results, detail);
    search.input.addEventListener("input", () => {
      state.functionQuery = search.input.value.trim().toLowerCase();
      state.visibleFunctions = 200;
      refresh();
    });
    status.input.addEventListener("change", () => {
      state.functionStatus = status.input.value;
      state.visibleFunctions = 200;
      refresh();
    });
    kind.input.addEventListener("change", () => {
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
        `${number.format(payload.declarations.length)} IR function${payload.declarations.length === 1 ? "" : "s"}.`,
      ),
      statGrid(module.counts, "Blocked", number.format(module.counts.blocked)),
      card,
    );
    refresh();
  }

  function renderFunctionResults(payload, container, detail) {
    const filtered = payload.declarations.filter((declaration) => {
      const runnable = declaration[2] === 1;
      if (state.functionStatus === "runnable" && !runnable) return false;
      if (state.functionStatus === "blocked" && runnable) return false;
      if (state.functionKind !== "all" && declaration[1] !== state.functionKind) return false;
      if (state.functionQuery) {
        const searchable = `${declaration[0]}\n${declaration[4] ?? ""}`.toLowerCase();
        if (!searchable.includes(state.functionQuery)) return false;
      }
      return true;
    });
    const shown = filtered.slice(0, state.visibleFunctions);
    container.replaceChildren();
    if (filtered.length === 0) {
      container.append(element("p", "empty-state", "No functions match these filters."));
      detail.hidden = true;
      return;
    }

    const wrap = element("div", "data-table-wrap");
    const table = tableElement(["Function", "Class", "Status", "Primary blocker"]);
    const body = table.tBodies[0];
    for (const declaration of shown) {
      const runnable = declaration[2] === 1;
      const row = document.createElement("tr");
      const nameCell = document.createElement("td");
      const name = element("button", "name-button", declaration[0]);
      name.type = "button";
      name.addEventListener("click", () => renderFunctionDetail(declaration, detail));
      nameCell.append(name);
      const kindCell = document.createElement("td");
      kindCell.append(element("span", "kind-pill", kindLabel(declaration[1])));
      const statusCell = document.createElement("td");
      statusCell.append(element("span", `status-pill ${runnable ? "good" : "bad"}`, runnable ? "VIR-able" : "Blocked"));
      row.append(
        nameCell,
        kindCell,
        statusCell,
        tableCell(runnable ? "—" : declaration[4], runnable ? "" : "blocker-name"),
      );
      body.append(row);
    }
    wrap.append(table);
    container.append(wrap);

    const footer = element(
      "div",
      "table-footer",
      `Showing ${number.format(shown.length)} of ${number.format(filtered.length)} matching functions.`,
    );
    if (shown.length < filtered.length) {
      footer.append(document.createTextNode(" "));
      const more = element("button", "load-more", "Show 200 more");
      more.type = "button";
      more.addEventListener("click", () => {
        state.visibleFunctions += 200;
        renderFunctionResults(payload, container, detail);
      });
      footer.append(more);
    }
    container.append(footer);
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
      appendFact(facts, "Boundary", declaration[4]);
    }
    detail.append(facts);
    if (!runnable && declaration[5]?.length) {
      detail.append(element("p", "control-label", "Representative dependency path"));
      const path = element("ol", "dependency-path");
      for (const name of declaration[5]) path.append(element("li", "", name));
      detail.append(path);
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
    if (type === "module" && moduleByName.has(value)) return { type, value: moduleByName.get(value) };
    if (type === "folder" && folderByPath.has(value)) return { type, value: folderByPath.get(value) };
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
