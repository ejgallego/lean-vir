// @ts-check

// Shared presentation has three deliberately narrow layers in one browser
// module: stable backend identity/filtering, adapters over client-owned report
// objects, and the common comparison dialog. It never changes source reports
// or participates in measurement collection.

const BACKEND_COLORS = Object.freeze({
  js: "#74a9ff",
  vir: "#f0a35e",
  "vir-format": "#77c879",
  native: "#d879c6",
  llvm: "#d7c45c",
  "fir-native": "#d879c6",
  "fir-emscripten": "#d7c45c",
  "compression-stream": "#65d8d2",
  fflate: "#74a9ff",
});

const FALLBACK_COLORS = Object.freeze([
  "#86b5e8",
  "#ef9f76",
  "#78c6a3",
  "#c9a7eb",
  "#dfc66d",
  "#e58fa6",
  "#7bc8d6",
]);

const METRICS = Object.freeze({
  outputBytes: { id: "outputBytes", label: "Compressed size", unit: "bytes" },
  firstCallMs: { id: "firstCallMs", label: "First call", unit: "ms" },
  steadyMs: { id: "steadyMs", label: "Steady median", unit: "ms" },
  totalMs: { id: "totalMs", label: "Total", unit: "ms" },
  prepareMs: { id: "prepareMs", label: "Prepare", unit: "ms" },
  executeMs: { id: "executeMs", label: "Execute", unit: "ms" },
  marshalMs: { id: "marshalMs", label: "Marshal", unit: "ms" },
  decodeMs: { id: "decodeMs", label: "Decode", unit: "ms" },
  renderMs: { id: "renderMs", label: "Render", unit: "ms" },
  retainedResidentBytes: {
    id: "retainedResidentBytes",
    label: "Retained resident growth",
    unit: "bytes",
  },
  retainedCommittedBytes: {
    id: "retainedCommittedBytes",
    label: "Retained committed growth",
    unit: "bytes",
  },
});

const TIMING_METRIC_IDS = Object.freeze([
  "totalMs",
  "prepareMs",
  "executeMs",
  "marshalMs",
  "decodeMs",
  "renderMs",
]);

// Backend identity and non-destructive selection.

/** @param {string} id */
function stringHash(id) {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  }
  return hash;
}

/** @param {string} id */
export function backendColor(id) {
  return (
    BACKEND_COLORS[id] ??
    FALLBACK_COLORS[stringHash(id) % FALLBACK_COLORS.length]
  );
}

/** @param {string[]} [initial] */
export function createBackendSelection(initial = []) {
  let selected = new Set(initial);
  return {
    /** @param {string[]} available */
    selected(available) {
      const visible = available.filter((id) => selected.has(id));
      if (visible.length === 0) {
        selected = new Set(available);
        return available.slice();
      }
      return visible;
    },
    /** @param {string[]} ids */
    set(ids) {
      selected = new Set(ids);
    },
  };
}

/**
 * @param {{
 *   available: string[],
 *   labelFor: (id: string) => string,
 *   onChange: (selected: string[]) => void,
 *   selection?: ReturnType<typeof createBackendSelection>,
 *   className?: string,
 * }} options
 */
export function createBackendFilter(options) {
  const selection = options.selection ?? createBackendSelection();
  let selected = new Set(selection.selected(options.available));
  const fieldset = document.createElement("fieldset");
  fieldset.className = options.className ?? "benchmark-backend-filter";
  const legend = document.createElement("legend");
  legend.textContent = "Visible backends";
  const summary = document.createElement("span");
  summary.className = "benchmark-backend-filter-summary";
  summary.setAttribute("aria-live", "polite");
  const choices = document.createElement("div");
  choices.className = "benchmark-backend-filter-options";
  const actions = document.createElement("div");
  actions.className = "benchmark-backend-filter-actions";
  const selectAll = document.createElement("button");
  selectAll.type = "button";
  selectAll.textContent = "Show all";
  actions.appendChild(selectAll);

  /** @type {Map<string, HTMLInputElement>} */
  const inputs = new Map();

  function publish() {
    const visible = options.available.filter((id) => selected.has(id));
    selection.set(visible);
    summary.textContent = `${visible.length} of ${options.available.length} selected`;
    selectAll.disabled = visible.length === options.available.length;
    options.onChange(visible);
  }

  for (const id of options.available) {
    const label = document.createElement("label");
    label.className = "benchmark-backend-filter-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = id;
    input.checked = selected.has(id);
    input.dataset.backendFilter = id;
    inputs.set(id, input);
    const swatch = document.createElement("span");
    swatch.className = "benchmark-backend-swatch";
    swatch.style.backgroundColor = backendColor(id);
    const name = document.createElement("span");
    name.textContent = options.labelFor(id);
    label.append(input, swatch, name);
    choices.appendChild(label);
    input.addEventListener("change", () => {
      if (input.checked) selected.add(id);
      else selected.delete(id);
      if (selected.size === 0) {
        input.checked = true;
        selected.add(id);
      }
      publish();
    });
  }
  selectAll.addEventListener("click", () => {
    selected = new Set(options.available);
    for (const input of inputs.values()) input.checked = true;
    publish();
  });
  summary.textContent = `${selected.size} of ${options.available.length} selected`;
  selectAll.disabled = selected.size === options.available.length;
  fieldset.append(legend, choices, actions, summary);
  return fieldset;
}

/**
 * @param {ParentNode} root
 * @param {string[]} selected
 * @param {string} [attribute]
 */
export function applyBackendVisibility(
  root,
  selected,
  attribute = "data-benchmark-backend",
) {
  const visible = new Set(selected);
  root.querySelectorAll(`[${attribute}]`).forEach((element) => {
    const node = /** @type {HTMLElement} */ (element);
    node.hidden = !visible.has(node.getAttribute(attribute) ?? "");
  });
}

// Source-report adapters. These return one small display model without
// changing the client-owned source report.

/** @param {unknown} value */
function finiteNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** @param {unknown} value */
function distributionMedian(value) {
  if (typeof value === "number") return finiteNumber(value);
  if (!value || typeof value !== "object") return null;
  return finiteNumber(/** @type {{ median?: unknown }} */ (value).median);
}

/** @param {*} summary */
function timingValues(summary) {
  return Object.fromEntries(
    TIMING_METRIC_IDS.map((id) => [id, distributionMedian(summary?.[id])]),
  );
}

function timingMetrics() {
  return TIMING_METRIC_IDS.map((id) => METRICS[id]);
}

/** @param {Map<string, string>} labels @param {string} id */
function backendLabel(labels, id) {
  return labels.get(id) ?? id;
}

/** @param {*} report @param {Map<string, string>} labels */
function normalizeLeanZip(report, labels) {
  const rows = [];
  for (const cell of report.cells) {
    const groupId = `${cell.vector}/level-${cell.level}`;
    const groupLabel = `${cell.vector} · level ${cell.level}`;
    for (const result of cell.results) {
      rows.push({
        groupId,
        groupLabel,
        backendId: result.backend,
        backendLabel: backendLabel(labels, result.backend),
        passed: result.valid !== false && result.exactNative !== false,
        metrics: {
          outputBytes: finiteNumber(result.outputBytes),
          firstCallMs: finiteNumber(result.firstCallMs),
          steadyMs: finiteNumber(result.medianMs),
        },
      });
    }
  }
  return {
    rows,
    metrics: [METRICS.outputBytes, METRICS.firstCallMs, METRICS.steadyMs],
  };
}

/** @param {*} report @param {Map<string, string>} labels */
function normalizeScenarios(report, labels) {
  const rows = [];
  for (const scenario of report.scenarios) {
    const workloadId =
      scenario.caseId ??
      scenario.workloadId ??
      scenario.sequenceIndex ??
      "workload";
    const workloadLabel =
      scenario.label ?? scenario.workloadLabel ?? scenario.caseId ?? workloadId;
    const suffix =
      typeof scenario.sizeLabel === "string"
        ? scenario.sizeLabel
        : typeof scenario.size === "number"
          ? String(scenario.size)
          : typeof scenario.width === "number"
            ? `${scenario.width}px`
            : null;
    const groupLabel = [scenario.dimensionLabel, workloadLabel, suffix]
      .filter(Boolean)
      .join(" · ");
    for (const id of report.backendIds) {
      const result = scenario.backends?.[id];
      if (!result) continue;
      const summary = result.summary ?? result.timing ?? {};
      rows.push({
        groupId: [scenario.dimensionId, workloadId, suffix ?? "default"]
          .filter((part) => part !== null && part !== undefined && part !== "")
          .join("/"),
        groupLabel,
        backendId: id,
        backendLabel: backendLabel(labels, id),
        passed:
          scenario.parity !== false &&
          (!Array.isArray(result.errors) || result.errors.length === 0),
        metrics: timingValues(summary),
      });
    }
  }
  return {
    rows,
    metrics: timingMetrics(),
  };
}

/** @param {*} report @param {Map<string, string>} labels */
function normalizeDimensions(report, labels) {
  return normalizeScenarios(
    {
      ...report,
      scenarios: report.dimensions.flatMap((dimension) =>
        Array.isArray(dimension.points)
          ? dimension.points.map((point) => ({
              ...point,
              dimensionId: dimension.id ?? dimension.label,
              dimensionLabel: dimension.label ?? dimension.id,
            }))
          : [],
      ),
    },
    labels,
  );
}

/** @param {*} report @param {Map<string, string>} labels */
function normalizeMemory(report, labels) {
  const rows = [];
  for (const point of report.points) {
    for (const id of report.backendIds) {
      const result = point.backends?.[id];
      if (!result) continue;
      rows.push({
        groupId: [
          point.dimension,
          point.caseId,
          point.size ?? point.width ?? "default",
        ]
          .filter((part) => part !== null && part !== undefined && part !== "")
          .join("/"),
        groupLabel: [
          point.dimensionLabel,
          point.label ?? point.caseId,
          point.sizeLabel,
        ]
          .filter(Boolean)
          .join(" · "),
        backendId: id,
        backendLabel: backendLabel(labels, id),
        passed:
          point.parity !== false &&
          (!Array.isArray(result.errors) || result.errors.length === 0),
        metrics: {
          totalMs: distributionMedian(result.timing?.totalMs),
          retainedResidentBytes: finiteNumber(
            result.retainedResidentGrowthBytes ?? result.residentDeltaBytes,
          ),
          retainedCommittedBytes: finiteNumber(
            result.retainedCommittedGrowthBytes ?? result.committedDeltaBytes,
          ),
        },
      });
    }
  }
  return {
    rows,
    metrics: [
      METRICS.totalMs,
      METRICS.retainedResidentBytes,
      METRICS.retainedCommittedBytes,
    ],
  };
}

/** @param {*} report @param {Map<string, string>} labels */
function normalizeSummaries(report, labels) {
  const rows = [];
  for (const id of report.backendIds) {
    const summary = report.summaries?.[id];
    if (!summary) continue;
    rows.push({
      groupId: "aggregate",
      groupLabel: "Report aggregate",
      backendId: id,
      backendLabel: backendLabel(labels, id),
      passed: summary.status === undefined || summary.status === "ready",
      metrics: timingValues(summary.timing),
    });
  }
  return {
    rows,
    metrics: timingMetrics(),
  };
}

/** @param {*} report */
function reportTitle(report) {
  const titles = {
    differential: "Corpus",
    scaling: "Scaling",
    "memory-retained": "Memory",
    interactions: "Interactions",
    repeated: "Repeated calls",
    "lean-zip/browser-benchmark-report": "Compression comparison",
  };
  const title = titles[report.kind] ?? report.kind;
  const qualifiers = [report.study, report.examplePackage?.test].filter(
    (value, index, values) =>
      typeof value === "string" &&
      value.length > 0 &&
      values.indexOf(value) === index,
  );
  return [title, ...qualifiers].join(" · ");
}

/**
 * Convert an example-owned report into the small shape consumed by shared
 * presentation. The controller continues to own the untouched source report.
 * @param {*} report
 * @param {{ id: string, label: string }[]} backends
 */
export function normalizeBenchmarkReport(report, backends) {
  if (
    !report ||
    typeof report !== "object" ||
    typeof report.kind !== "string" ||
    report.kind.length === 0
  ) {
    throw new TypeError("benchmark report must have a non-empty string kind");
  }
  if (typeof report.passed !== "boolean") {
    throw new TypeError("benchmark report must have a boolean passed result");
  }
  if (
    !Array.isArray(report.backendIds) ||
    report.backendIds.length === 0 ||
    report.backendIds.some((id) => typeof id !== "string" || id.length === 0) ||
    new Set(report.backendIds).size !== report.backendIds.length
  ) {
    throw new TypeError(
      "benchmark report must identify its backends with unique non-empty strings",
    );
  }
  const labels = new Map(backends.map(({ id, label }) => [id, label]));
  let normalized;
  if (report.kind === "repeated") {
    normalized = normalizeSummaries(report, labels);
  } else if (Array.isArray(report.cells)) {
    normalized = normalizeLeanZip(report, labels);
  } else if (Array.isArray(report.scenarios)) {
    normalized = normalizeScenarios(report, labels);
  } else if (Array.isArray(report.points)) {
    normalized = normalizeMemory(report, labels);
  } else if (Array.isArray(report.dimensions)) {
    normalized = normalizeDimensions(report, labels);
  } else normalized = normalizeSummaries(report, labels);
  const metrics = normalized.metrics.filter((candidate) =>
    normalized.rows.some(
      (row) => finiteNumber(row.metrics[candidate.id]) !== null,
    ),
  );
  return {
    key: [report.kind, report.study, report.examplePackage?.test]
      .filter(Boolean)
      .join("/"),
    title: reportTitle(report),
    generatedAt: report.generatedAt ?? report.startedAt ?? null,
    passed: report.passed,
    backendIds: report.backendIds.slice(),
    backends: report.backendIds.map((id) => ({
      id,
      label: backendLabel(labels, id),
    })),
    metrics,
    rows: normalized.rows,
    caveats: Array.isArray(report.caveats) ? report.caveats.slice() : [],
  };
}

/** @param {number} value @param {string} unit */
export function formatMetric(value, unit) {
  if (!Number.isFinite(value)) return "—";
  if (unit === "ms") {
    if (Math.abs(value) < 0.01) return "<0.01 ms";
    return `${value.toFixed(Math.abs(value) < 10 ? 2 : 1)} ms`;
  }
  if (unit === "bytes") {
    if (Math.abs(value) < 1024) return `${Math.round(value)} B`;
    if (Math.abs(value) < 1024 * 1024)
      return `${(value / 1024).toFixed(1)} KiB`;
    return `${(value / (1024 * 1024)).toFixed(2)} MiB`;
  }
  return String(value);
}

// Common comparison dialog.

/**
 * @param {SVGElement} root
 * @param {string} name
 * @param {Record<string, string>} [attributes]
 */
function svg(root, name, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value);
  }
  root.appendChild(node);
  return node;
}

/** @param {string} value @param {number} limit */
function compactLabel(value, limit) {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

/** @param {*[]} rows @param {number} limit */
function selectWholeGroups(rows, limit) {
  /** @type {Map<string, *[]>} */
  const groups = new Map();
  for (const row of rows) {
    const group = groups.get(row.groupId) ?? [];
    group.push(row);
    groups.set(row.groupId, group);
  }
  const selected = [];
  for (const group of groups.values()) {
    if (selected.length > 0 && selected.length + group.length > limit) break;
    selected.push(...group);
    if (selected.length >= limit) break;
  }
  return selected;
}

/**
 * @param {SVGSVGElement} chart
 * @param {*} model
 * @param {string[]} selected
 * @param {*} selectedMetric
 * @param {HTMLElement} note
 */
function renderChart(chart, model, selected, selectedMetric, note) {
  chart.replaceChildren();
  const visible = new Set(selected);
  const rows = model.rows.filter(
    (row) =>
      visible.has(row.backendId) &&
      finiteNumber(row.metrics[selectedMetric.id]) !== null,
  );
  const width = 960;
  const labelWidth = 270;
  const barWidth = width - labelWidth - 120;
  const rowHeight = 27;
  if (rows.some((row) => Number(row.metrics[selectedMetric.id]) < 0)) {
    const height = 130;
    chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
    chart.style.height = `${height}px`;
    const message = svg(chart, "text", {
      x: String(width / 2),
      y: String(height / 2),
      "text-anchor": "middle",
      class: "benchmark-report-chart-empty",
    });
    message.textContent = "Signed values are shown in the table";
    note.textContent =
      "The chart is omitted because a one-sided bar would hide the sign of this metric.";
    return;
  }
  const plotted = selectWholeGroups(rows, 36);
  const height = Math.max(130, 62 + plotted.length * rowHeight);
  chart.setAttribute("viewBox", `0 0 ${width} ${height}`);
  chart.style.height = `${height}px`;
  if (plotted.length === 0) {
    const empty = svg(chart, "text", {
      x: String(width / 2),
      y: String(height / 2),
      "text-anchor": "middle",
      class: "benchmark-report-chart-empty",
    });
    empty.textContent = "No numeric values for this selection";
    note.textContent = "Choose another metric or backend.";
    return;
  }
  const maximum = Math.max(
    ...plotted.map((row) => Math.abs(Number(row.metrics[selectedMetric.id]))),
    Number.EPSILON,
  );
  plotted.forEach((row, index) => {
    const value = Number(row.metrics[selectedMetric.id]);
    const y = 44 + index * rowHeight;
    const label = svg(chart, "text", {
      x: String(labelWidth - 12),
      y: String(y + 12),
      "text-anchor": "end",
      class: "benchmark-report-chart-label",
    });
    label.textContent = compactLabel(
      `${row.groupLabel} · ${row.backendLabel}`,
      44,
    );
    svg(chart, "rect", {
      x: String(labelWidth),
      y: String(y),
      width: String(Math.max(1, (Math.abs(value) / maximum) * barWidth)),
      height: "16",
      rx: "3",
      fill: backendColor(row.backendId),
      "data-benchmark-backend": row.backendId,
    });
    const valueLabel = svg(chart, "text", {
      x: String(labelWidth + (Math.abs(value) / maximum) * barWidth + 8),
      y: String(y + 12),
      class: "benchmark-report-chart-value",
    });
    valueLabel.textContent = formatMetric(value, selectedMetric.unit);
  });
  if (rows.length > plotted.length) {
    const plottedGroups = new Set(plotted.map((row) => row.groupId)).size;
    const availableGroups = new Set(rows.map((row) => row.groupId)).size;
    note.textContent =
      `Showing ${plottedGroups} of ${availableGroups} complete workload groups; ` +
      "the table includes all values.";
  } else {
    note.textContent = `${rows.length} comparable workload/backend cells.`;
  }
}

/**
 * @param {HTMLTableSectionElement} body
 * @param {*} model
 * @param {string[]} selected
 * @param {*} selectedMetric
 */
function renderTable(body, model, selected, selectedMetric) {
  body.replaceChildren();
  const visible = new Set(selected);
  for (const row of model.rows) {
    if (!visible.has(row.backendId)) continue;
    const tr = document.createElement("tr");
    tr.dataset.benchmarkBackend = row.backendId;
    const workload = document.createElement("th");
    workload.scope = "row";
    workload.textContent = row.groupLabel;
    const backend = document.createElement("td");
    const swatch = document.createElement("span");
    swatch.className = "benchmark-backend-swatch";
    swatch.style.backgroundColor = backendColor(row.backendId);
    const name = document.createElement("span");
    name.textContent = row.backendLabel;
    backend.append(swatch, name);
    const value = document.createElement("td");
    const number = finiteNumber(row.metrics[selectedMetric.id]);
    value.textContent =
      number === null ? "—" : formatMetric(number, selectedMetric.unit);
    const correctness = document.createElement("td");
    correctness.textContent = row.passed ? "Verified" : "Mismatch";
    correctness.dataset.passed = String(row.passed);
    tr.append(workload, backend, value, correctness);
    body.appendChild(tr);
  }
}

/**
 * @param {{
 *   example: { id: string, title: string },
 *   openButton: HTMLButtonElement,
 * }} options
 */
export function createReportPresentation(options) {
  /** @type {Map<string, ReturnType<typeof normalizeBenchmarkReport>>} */
  const reports = new Map();
  const selection = createBackendSelection();
  let activeKey = null;
  /** @type {HTMLElement | null} */
  let overlay = null;

  function close() {
    overlay?.remove();
    overlay = null;
  }

  function open() {
    if (reports.size === 0) return;
    close();
    const models = Array.from(reports.values());
    const model = reports.get(activeKey) ?? models.at(-1);
    if (!model) return;
    activeKey = model.key;

    const root = document.createElement("section");
    root.className = "benchmark-report-overlay";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-labelledby", "benchmark-report-title");
    const header = document.createElement("header");
    const heading = document.createElement("div");
    const eyebrow = document.createElement("p");
    eyebrow.className = "bench-eyebrow";
    eyebrow.textContent = `${options.example.title} · shared report view`;
    const title = document.createElement("h2");
    title.id = "benchmark-report-title";
    title.textContent = model.title;
    const status = document.createElement("strong");
    status.className = "benchmark-report-status";
    status.dataset.passed = String(model.passed);
    status.textContent = model.passed
      ? "Correctness checks passed"
      : "Correctness mismatch";
    heading.append(eyebrow, title, status);
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", close);
    header.append(heading, closeButton);

    const controls = document.createElement("div");
    controls.className = "benchmark-report-controls";
    if (models.length > 1) {
      const reportLabel = document.createElement("label");
      reportLabel.textContent = "Report";
      const reportSelect = document.createElement("select");
      reportSelect.dataset.reportSelect = "";
      for (const candidate of models) {
        const option = document.createElement("option");
        option.value = candidate.key;
        option.textContent = candidate.title;
        option.selected = candidate.key === model.key;
        reportSelect.appendChild(option);
      }
      reportSelect.addEventListener("change", () => {
        activeKey = reportSelect.value;
        open();
      });
      reportLabel.appendChild(reportSelect);
      controls.appendChild(reportLabel);
    }

    const metricLabel = document.createElement("label");
    metricLabel.textContent = "Metric";
    const metricSelect = document.createElement("select");
    metricSelect.dataset.metricSelect = "";
    for (const candidate of model.metrics) {
      const option = document.createElement("option");
      option.value = candidate.id;
      option.textContent = candidate.label;
      metricSelect.appendChild(option);
    }
    metricLabel.appendChild(metricSelect);
    controls.appendChild(metricLabel);

    const chartFigure = document.createElement("figure");
    chartFigure.className = "benchmark-report-figure";
    const chart = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    chart.classList.add("benchmark-report-chart");
    chart.setAttribute("role", "img");
    chart.setAttribute("aria-label", `${model.title} comparison chart`);
    const chartNote = document.createElement("figcaption");
    chartFigure.append(chart, chartNote);

    const tableShell = document.createElement("div");
    tableShell.className = "benchmark-report-table-shell";
    const table = document.createElement("table");
    table.className = "benchmark-report-table";
    const head = document.createElement("thead");
    const headRow = document.createElement("tr");
    for (const label of ["Workload", "Backend", "Value", "Correctness"]) {
      const th = document.createElement("th");
      th.textContent = label;
      headRow.appendChild(th);
    }
    head.appendChild(headRow);
    const body = document.createElement("tbody");
    table.append(head, body);
    tableShell.appendChild(table);

    const notes = document.createElement("div");
    notes.className = "benchmark-report-notes";
    const generated = document.createElement("p");
    generated.textContent = model.generatedAt
      ? `Report generated ${model.generatedAt}. Values are observations from ` +
        "the recorded run."
      : "Values are observations from the recorded run.";
    notes.appendChild(generated);
    if (model.caveats.length > 0) {
      const list = document.createElement("ul");
      for (const caveat of model.caveats) {
        const item = document.createElement("li");
        item.textContent = caveat;
        list.appendChild(item);
      }
      notes.appendChild(list);
    }

    let selected = selection.selected(model.backendIds);
    let selectedMetric = model.metrics[0] ?? null;
    const refresh = () => {
      if (!selectedMetric) {
        chart.replaceChildren();
        body.replaceChildren();
        chartNote.textContent = "This report has no numeric metrics to plot.";
        return;
      }
      renderChart(chart, model, selected, selectedMetric, chartNote);
      renderTable(body, model, selected, selectedMetric);
    };
    const filter = createBackendFilter({
      available: model.backendIds,
      labelFor: (id) =>
        model.backends.find((backend) => backend.id === id)?.label ?? id,
      selection,
      onChange: (value) => {
        selected = value;
        refresh();
      },
    });
    controls.appendChild(filter);
    metricSelect.addEventListener("change", () => {
      selectedMetric =
        model.metrics.find(
          (candidate) => candidate.id === metricSelect.value,
        ) ?? null;
      refresh();
    });

    root.append(header, controls, chartFigure, tableShell, notes);
    document.body.appendChild(root);
    overlay = root;
    refresh();
    closeButton.focus();
  }

  options.openButton.addEventListener(
    "click",
    (event) => {
      if (reports.size === 0) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      open();
    },
    true,
  );
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && overlay) close();
  });

  return {
    /** @param {*} report @param {{ id: string, label: string }[]} backends */
    record(report, backends) {
      const model = normalizeBenchmarkReport(report, backends);
      reports.set(model.key, model);
      activeKey = model.key;
      options.openButton.disabled = false;
    },
    reset() {
      reports.clear();
      activeKey = null;
      options.openButton.disabled = true;
      close();
    },
  };
}

const presentationApi = Object.freeze({
  applyBackendVisibility,
  backendColor,
  createBackendFilter,
  createBackendSelection,
});

globalThis.BenchmarkPresentation = presentationApi;
