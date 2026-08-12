// @ts-check
/* Standalone report views extracted from the original slide-bound dashboard. */
(function () {
  "use strict";

  /** @type {*} */
  var prettyCampaignReport = null;
  /** @type {*} */
  var prettyCorpusReport = null;
  /** @type {*} */
  var prettyScalingReport = null;
  /** @type {*} */
  var prettyRepeatedReport = null;
  /** @type {*} */
  var prettyMemoryReport = null;
  /** @type {*} */
  var prettyInteractionReport = null;
  /** @type {*} */
  var prettyLiveReport = null;
  /** @type {HTMLElement | null} */
  var prettyCorpusOverlay = null;

  function prettyDashboardHasData() {
    return Boolean(
      prettyCampaignReport ||
      prettyCorpusReport ||
      prettyScalingReport ||
      prettyMemoryReport ||
      prettyInteractionReport ||
      prettyRepeatedReport ||
      prettyLiveReport,
    );
  }

  /** @param {*} data */
  function loadPrettyDashboardData(data) {
    if (!data || typeof data !== "object" || typeof data.kind !== "string") {
      throw new TypeError(
        "expected a pretty benchmark report or campaign object",
      );
    }
    if (data.kind === "pretty-benchmark-campaign") {
      if (!Array.isArray(data.backendIds) || !data.corpus || !data.scaling) {
        throw new TypeError("campaign JSON is missing benchmark aggregates");
      }
      prettyCampaignReport = data;
      return;
    }
    if (data.kind === "pretty-results-dashboard") {
      if (data.campaign) loadPrettyDashboardData(data.campaign);
      if (data.reports) {
        Object.values(data.reports).forEach(function (report) {
          if (report) loadPrettyDashboardData(report);
        });
      }
      return;
    }
    if (data.kind === "differential") {
      prettyCorpusReport = data;
      if (data.scaling) prettyScalingReport = data.scaling;
      if (data.memory) prettyMemoryReport = data.memory;
      if (data.interactions) prettyInteractionReport = data.interactions;
      if (data.repeated) prettyRepeatedReport = data.repeated;
      return;
    }
    if (data.kind === "scaling") prettyScalingReport = data;
    else if (data.kind === "memory-retained") prettyMemoryReport = data;
    else if (data.kind === "interactions") prettyInteractionReport = data;
    else if (data.kind === "repeated") prettyRepeatedReport = data;
    else if (data.kind === "live-render") prettyLiveReport = data;
    else throw new TypeError("unsupported pretty benchmark kind: " + data.kind);
  }

  /** @param {number} value */
  function formatCorpusTiming(value) {
    if (!Number.isFinite(value)) return "—";
    if (value < 0.01) return "<0.01";
    return value.toFixed(value < 10 ? 2 : 1);
  }

  /** @param {number | null} value */
  function formatCorpusBytes(value) {
    if (typeof value !== "number" || !Number.isFinite(value)) return "—";
    if (value < 1024) return Math.round(value) + " B";
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KiB";
    return (value / (1024 * 1024)).toFixed(2) + " MiB";
  }

  /**
   * @param {HTMLTableRowElement} row
   * @param {string} text
   * @param {string} [element]
   * @return {HTMLTableCellElement}
   */
  function appendCorpusCell(row, text, element) {
    var cell = /** @type {HTMLTableCellElement} */ (
      document.createElement(element || "td")
    );
    cell.textContent = text;
    row.appendChild(cell);
    return cell;
  }

  /** @param {*} report */
  function downloadPrettyCorpusReport(report) {
    var blob = new Blob([JSON.stringify(report, null, 2) + "\n"], {
      type: "application/json",
    });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download =
      "pretty-" +
      (report.kind || "differential") +
      "-" +
      new Date().toISOString().replace(/[:.]/g, "-") +
      ".json";
    link.click();
    setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 0);
  }

  /** @type {Record<string, string>} */
  var PRETTY_DASHBOARD_COLORS = {
    js: "#74a9ff",
    vir: "#f0a35e",
    "vir-format": "#77c879",
    native: "#d879c6",
    "native-flat": "#a778df",
    llvm: "#d7c45c",
    "js-html": "#74a9ff",
    "vir-html": "#f0a35e",
    "native-html": "#d879c6",
    "llvm-html": "#d7c45c",
  };

  /** @type {Set<string>} */
  var prettyDashboardSelectedBackends = new Set();

  /** @param {string[]} available */
  function prettyDashboardSelectedBackendIds(available) {
    var selected = available.filter(function (id) {
      return prettyDashboardSelectedBackends.has(id);
    });
    if (selected.length === 0) {
      selected = available.slice();
      prettyDashboardSelectedBackends = new Set(selected);
    }
    return selected;
  }

  /**
   * @param {string[]} available
   * @param {(id: string) => string} labelFor
   * @param {(selected: string[]) => void} onChange
   */
  function createPrettyBackendFilter(available, labelFor, onChange) {
    var selected = new Set(prettyDashboardSelectedBackendIds(available));
    var fieldset = document.createElement("fieldset");
    fieldset.className = "pretty-backend-filter";
    var legend = document.createElement("legend");
    legend.textContent = "Visible backends";
    var summary = document.createElement("span");
    summary.className = "pretty-backend-filter-summary";
    summary.setAttribute("aria-live", "polite");
    var options = document.createElement("div");
    options.className = "pretty-backend-filter-options";
    var actions = document.createElement("div");
    actions.className = "pretty-backend-filter-actions";
    var selectAll = document.createElement("button");
    selectAll.type = "button";
    selectAll.textContent = "Show all";
    actions.appendChild(selectAll);

    /** @type {Map<string, HTMLInputElement>} */
    var inputs = new Map();

    function publish() {
      prettyDashboardSelectedBackends = new Set(selected);
      summary.textContent =
        selected.size + " of " + available.length + " selected";
      selectAll.disabled = selected.size === available.length;
      onChange(
        available.filter(function (id) {
          return selected.has(id);
        }),
      );
    }

    available.forEach(function (id) {
      var label = document.createElement("label");
      label.className = "pretty-backend-filter-option";
      var input = document.createElement("input");
      input.type = "checkbox";
      input.value = id;
      input.checked = selected.has(id);
      input.dataset.backendFilter = id;
      inputs.set(id, input);
      var swatch = document.createElement("span");
      swatch.className = "pretty-dashboard-swatch";
      swatch.style.backgroundColor = prettyDashboardColor(id);
      var name = document.createElement("span");
      name.textContent = labelFor(id);
      label.append(input, swatch, name);
      options.appendChild(label);
      input.addEventListener("change", function () {
        if (input.checked) selected.add(id);
        else selected.delete(id);
        if (selected.size === 0) {
          input.checked = true;
          selected.add(id);
        }
        publish();
      });
    });
    selectAll.addEventListener("click", function () {
      selected = new Set(available);
      inputs.forEach(function (input) {
        input.checked = true;
      });
      publish();
    });
    summary.textContent =
      selected.size + " of " + available.length + " selected";
    selectAll.disabled = selected.size === available.length;
    fieldset.append(legend, options, actions, summary);
    return fieldset;
  }

  /** @param {HTMLElement} root @param {string[]} selected */
  function applyPrettyBackendVisibility(root, selected) {
    var visible = new Set(selected);
    root.querySelectorAll("[data-pretty-backend]").forEach(function (element) {
      var node = /** @type {HTMLElement} */ (element);
      node.hidden = !visible.has(node.dataset.prettyBackend || "");
    });
  }

  /** @return {string[]} */
  function prettyDashboardBackendIds() {
    var sources = [
      prettyCampaignReport,
      prettyCorpusReport,
      prettyScalingReport,
      prettyRepeatedReport,
      prettyMemoryReport,
      prettyLiveReport,
    ];
    for (var index = 0; index < sources.length; index++) {
      if (sources[index] && Array.isArray(sources[index].backendIds)) {
        return sources[index].backendIds.slice();
      }
    }
    return [];
  }

  /** @param {string} id */
  function prettyDashboardBackendLabel(id) {
    if (prettyCampaignReport && prettyCampaignReport.corpus[id]) {
      return prettyCampaignReport.corpus[id].label;
    }
    var reports = [
      prettyCorpusReport,
      prettyScalingReport,
      prettyRepeatedReport,
      prettyLiveReport,
    ];
    for (var index = 0; index < reports.length; index++) {
      var report = reports[index];
      if (report && report.summaries && report.summaries[id]) {
        return report.summaries[id].label;
      }
    }
    return id;
  }

  /** @param {*} stat @return {*} */
  function prettyDashboardStat(stat) {
    if (!stat || typeof stat.median !== "number") return null;
    return {
      median: stat.median,
      min: typeof stat.min === "number" ? stat.min : stat.median,
      max: typeof stat.max === "number" ? stat.max : stat.median,
      p95: typeof stat.p95 === "number" ? stat.p95 : stat.median,
      cv: typeof stat.cv === "number" ? stat.cv : null,
      runs:
        typeof stat.runs === "number"
          ? stat.runs
          : typeof stat.samples === "number"
            ? stat.samples
            : 1,
    };
  }

  /** @param {string} id @param {string} phase @return {*} */
  function prettyDashboardCorpusStat(id, phase) {
    if (
      prettyCampaignReport &&
      prettyCampaignReport.corpus[id] &&
      prettyCampaignReport.corpus[id].phases
    ) {
      return prettyDashboardStat(prettyCampaignReport.corpus[id].phases[phase]);
    }
    var summary = prettyCorpusReport && prettyCorpusReport.summaries[id];
    return prettyDashboardStat(
      summary && summary.timing && summary.timing[phase],
    );
  }

  /** @return {*[]} */
  function prettyDashboardScalingDimensions() {
    if (
      prettyCampaignReport &&
      prettyCampaignReport.scaling &&
      Array.isArray(prettyCampaignReport.scaling.dimensions)
    ) {
      return prettyCampaignReport.scaling.dimensions;
    }
    return prettyScalingReport && Array.isArray(prettyScalingReport.dimensions)
      ? prettyScalingReport.dimensions
      : [];
  }

  /** @param {*} point @param {string} id @param {string} phase @return {*} */
  function prettyDashboardScalingStat(point, id, phase) {
    var backend = point.backends && point.backends[id];
    if (!backend) return null;
    if (backend[phase]) return prettyDashboardStat(backend[phase]);
    return prettyDashboardStat(backend.summary && backend.summary[phase]);
  }

  /** @param {string} id */
  function prettyDashboardColor(id) {
    return PRETTY_DASHBOARD_COLORS[id] || "#a8a8a8";
  }

  /** @param {string} label @param {string} value @param {string} note */
  function createPrettyDashboardCard(label, value, note) {
    var card = document.createElement("article");
    card.className = "pretty-dashboard-card";
    var heading = document.createElement("h3");
    heading.textContent = label;
    var main = document.createElement("strong");
    main.textContent = value;
    var detail = document.createElement("p");
    detail.textContent = note;
    card.append(heading, main, detail);
    return card;
  }

  /**
   * @param {string[]} backendIds
   * @param {string} phase
   * @param {string} phaseLabel
   * @param {string} scale
   * @param {boolean} normalized
   */
  function createPrettyDashboardOverviewChart(
    backendIds,
    phase,
    phaseLabel,
    scale,
    normalized,
  ) {
    var namespace = "http://www.w3.org/2000/svg";
    var height = Math.max(220, 86 + backendIds.length * 48);
    var svg = /** @type {SVGSVGElement} */ (
      document.createElementNS(namespace, "svg")
    );
    svg.classList.add(
      "pretty-dashboard-chart",
      "pretty-dashboard-overview-chart",
    );
    svg.setAttribute("viewBox", "0 0 940 " + height);
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      "Backend " + phaseLabel.toLowerCase() + " comparison with process ranges",
    );
    var left = 145;
    var right = 875;
    var top = 52;
    var bottom = height - 36;
    var rows = backendIds
      .map(function (id) {
        return { id: id, stat: prettyDashboardCorpusStat(id, phase) };
      })
      .filter(function (row) {
        return row.stat && row.stat.median >= 0;
      });
    var positive = rows
      .map(function (row) {
        return row.stat.median;
      })
      .filter(function (value) {
        return value > 0;
      });
    var reference =
      normalized && positive.length > 0 ? Math.min.apply(null, positive) : 1;
    if (!Number.isFinite(reference) || reference <= 0) reference = 1;
    var values = rows.map(function (row) {
      return row.stat.median / reference;
    });
    var ranges = rows.flatMap(function (row) {
      return [row.stat.min / reference, row.stat.max / reference];
    });
    var maximum = Math.max.apply(null, values.concat(ranges, [1]));
    var minimumPositive = Math.min.apply(
      null,
      values.concat(ranges).filter(function (value) {
        return value > 0;
      }),
    );
    if (!Number.isFinite(minimumPositive)) minimumPositive = 0.001;
    var low =
      scale === "log" ? Math.log10(Math.max(0.0001, minimumPositive * 0.7)) : 0;
    var high =
      scale === "log"
        ? Math.log10(Math.max(minimumPositive * 1.5, maximum * 1.2))
        : Math.max(1, maximum * 1.12);

    /** @param {string} name @param {Record<string, string>} attributes */
    function element(name, attributes) {
      var node = document.createElementNS(namespace, name);
      Object.keys(attributes).forEach(function (key) {
        node.setAttribute(key, attributes[key]);
      });
      svg.appendChild(node);
      return node;
    }
    /** @param {string} value @param {number} x @param {number} y @param {string} anchor */
    function label(value, x, y, anchor) {
      var node = /** @type {SVGTextElement} */ (
        element("text", { x: String(x), y: String(y), "text-anchor": anchor })
      );
      node.textContent = value;
      return node;
    }
    /** @param {number} value */
    function xFor(value) {
      var transformed =
        scale === "log" ? Math.log10(Math.max(value, 10 ** low)) : value;
      return (
        left +
        ((transformed - low) / Math.max(0.000001, high - low)) * (right - left)
      );
    }

    for (var tick = 0; tick <= 4; tick++) {
      var transformed = low + ((high - low) * tick) / 4;
      var value = scale === "log" ? 10 ** transformed : transformed;
      var x = left + (tick / 4) * (right - left);
      element("line", {
        x1: String(x),
        y1: String(top - 15),
        x2: String(x),
        y2: String(bottom),
        class: "grid",
      });
      label(
        normalized
          ? value.toFixed(value < 10 ? 1 : 0) + "×"
          : formatCorpusTiming(value),
        x,
        top - 25,
        "middle",
      );
    }
    rows.forEach(function (row, index) {
      var y = top + index * 48;
      var value = row.stat.median / reference;
      var rangeMin = row.stat.min / reference;
      var rangeMax = row.stat.max / reference;
      var start = scale === "log" ? left : xFor(0);
      var end = xFor(value);
      label(prettyDashboardBackendLabel(row.id), left - 12, y + 5, "end");
      var bar = element("rect", {
        x: String(Math.min(start, end)),
        y: String(y - 12),
        width: String(Math.max(2, Math.abs(end - start))),
        height: "24",
        rx: "4",
        fill: prettyDashboardColor(row.id),
      });
      var title = document.createElementNS(namespace, "title");
      title.textContent =
        prettyDashboardBackendLabel(row.id) +
        " · median " +
        formatCorpusTiming(row.stat.median) +
        " ms · range " +
        formatCorpusTiming(row.stat.min) +
        "–" +
        formatCorpusTiming(row.stat.max) +
        " ms" +
        (row.stat.cv === null
          ? ""
          : " · CV " + (row.stat.cv * 100).toFixed(1) + "%");
      bar.appendChild(title);
      if (row.stat.runs > 1) {
        element("line", {
          x1: String(xFor(Math.max(rangeMin, 0))),
          y1: String(y),
          x2: String(xFor(rangeMax)),
          y2: String(y),
          class: "pretty-dashboard-range",
        });
        [rangeMin, rangeMax].forEach(function (rangeValue) {
          var rangeX = xFor(Math.max(rangeValue, 0));
          element("line", {
            x1: String(rangeX),
            y1: String(y - 7),
            x2: String(rangeX),
            y2: String(y + 7),
            class: "pretty-dashboard-range",
          });
        });
      }
      label(
        normalized
          ? value.toFixed(value < 10 ? 2 : 1) + "×"
          : formatCorpusTiming(row.stat.median) + " ms",
        Math.min(right - 2, end + 8),
        y + 5,
        end > right - 95 ? "end" : "start",
      );
    });
    label(
      normalized
        ? "relative to fastest selected backend"
        : phaseLabel.toLowerCase() +
            " median ms" +
            (scale === "log" ? " (log)" : ""),
      left,
      height - 8,
      "start",
    );
    return svg;
  }

  /** @param {string[]} backendIds */
  function createPrettyDashboardPhaseChart(backendIds) {
    var namespace = "http://www.w3.org/2000/svg";
    var height = Math.max(225, 100 + backendIds.length * 42);
    var svg = /** @type {SVGSVGElement} */ (
      document.createElementNS(namespace, "svg")
    );
    svg.classList.add("pretty-dashboard-chart", "pretty-dashboard-phase-chart");
    svg.setAttribute("viewBox", "0 0 940 " + height);
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", "Median formatter pipeline phase breakdown");
    var phases = [
      { id: "marshalMs", label: "Marshal", color: "#6baed6" },
      { id: "executeMs", label: "Execute", color: "#74c476" },
      { id: "decodeMs", label: "Decode", color: "#fd8d3c" },
    ];
    var left = 145;
    var right = 875;
    var top = 66;
    var rows = backendIds.map(function (id) {
      var values = phases.map(function (phase) {
        var stat = prettyDashboardCorpusStat(id, phase.id);
        return stat ? stat.median : 0;
      });
      return {
        id: id,
        values: values,
        total: values.reduce(function (sum, value) {
          return sum + value;
        }, 0),
      };
    });
    var maximum = Math.max.apply(
      null,
      rows
        .map(function (row) {
          return row.total;
        })
        .concat([0.001]),
    );

    /** @param {string} name @param {Record<string, string>} attributes */
    function element(name, attributes) {
      var node = document.createElementNS(namespace, name);
      Object.keys(attributes).forEach(function (key) {
        node.setAttribute(key, attributes[key]);
      });
      svg.appendChild(node);
      return node;
    }
    /** @param {string} value @param {number} x @param {number} y @param {string} anchor */
    function label(value, x, y, anchor) {
      var node = /** @type {SVGTextElement} */ (
        element("text", { x: String(x), y: String(y), "text-anchor": anchor })
      );
      node.textContent = value;
      return node;
    }
    phases.forEach(function (phase, index) {
      var x = left + index * 115;
      element("rect", {
        x: String(x),
        y: "18",
        width: "16",
        height: "16",
        rx: "2",
        fill: phase.color,
      });
      label(phase.label, x + 23, 31, "start");
    });
    rows.forEach(function (row, rowIndex) {
      var y = top + rowIndex * 42;
      var x = left;
      label(prettyDashboardBackendLabel(row.id), left - 12, y + 5, "end");
      row.values.forEach(function (value, phaseIndex) {
        var width = (value / maximum) * (right - left);
        var rect = element("rect", {
          x: String(x),
          y: String(y - 12),
          width: String(Math.max(value > 0 ? 1 : 0, width)),
          height: "24",
          fill: phases[phaseIndex].color,
        });
        var title = document.createElementNS(namespace, "title");
        title.textContent =
          prettyDashboardBackendLabel(row.id) +
          " · " +
          phases[phaseIndex].label +
          " · " +
          formatCorpusTiming(value) +
          " ms";
        rect.appendChild(title);
        x += width;
      });
      label(
        formatCorpusTiming(row.total) + " ms",
        Math.min(right, x + 8),
        y + 5,
        "start",
      );
    });
    return svg;
  }

  /**
   * @param {*} dimension
   * @param {string[]} backendIds
   * @param {string} phase
   * @param {string} phaseLabel
   * @param {string} scale
   * @param {boolean} normalized
   */
  function createPrettyDashboardScalingChart(
    dimension,
    backendIds,
    phase,
    phaseLabel,
    scale,
    normalized,
  ) {
    var namespace = "http://www.w3.org/2000/svg";
    var svg = /** @type {SVGSVGElement} */ (
      document.createElementNS(namespace, "svg")
    );
    svg.classList.add(
      "pretty-dashboard-chart",
      "pretty-dashboard-scaling-chart",
    );
    svg.setAttribute("viewBox", "0 0 470 265");
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      dimension.label + " versus " + phaseLabel.toLowerCase() + " runtime",
    );
    var left = 58;
    var right = 444;
    var top = 25;
    var bottom = 215;
    /** @type {{ id: string, points: { x: number, value: number, min: number, max: number, label: string }[] }[]} */
    var series = [];
    /** @type {number[]} */
    var allValues = [];
    backendIds.forEach(function (id) {
      /** @type {{ x: number, value: number, min: number, max: number, label: string }[]} */
      var points = [];
      dimension.points.forEach(
        function (/** @type {*} */ point, /** @type {number} */ pointIndex) {
          var stat = prettyDashboardScalingStat(point, id, phase);
          if (!stat) return;
          var reference = 1;
          if (normalized) {
            var candidates = backendIds
              .map(function (candidate) {
                var candidateStat = prettyDashboardScalingStat(
                  point,
                  candidate,
                  phase,
                );
                return candidateStat && candidateStat.median > 0
                  ? candidateStat.median
                  : null;
              })
              .filter(function (value) {
                return typeof value === "number";
              });
            reference =
              candidates.length > 0 ? Math.min.apply(null, candidates) : 1;
          }
          var value = stat.median / reference;
          points.push({
            x: pointIndex,
            value: value,
            min: stat.min / reference,
            max: stat.max / reference,
            label: point.sizeLabel || String(point.size),
          });
          allValues.push(value, stat.min / reference, stat.max / reference);
        },
      );
      series.push({ id: id, points: points });
    });
    var positive = allValues.filter(function (value) {
      return value > 0;
    });
    var minimum = positive.length > 0 ? Math.min.apply(null, positive) : 0.001;
    var maximum = positive.length > 0 ? Math.max.apply(null, positive) : 1;
    var low = scale === "log" ? Math.log10(Math.max(0.0001, minimum * 0.7)) : 0;
    var high =
      scale === "log"
        ? Math.log10(Math.max(minimum * 1.5, maximum * 1.25))
        : Math.max(1, maximum * 1.15);

    /** @param {string} name @param {Record<string, string>} attributes */
    function element(name, attributes) {
      var node = document.createElementNS(namespace, name);
      Object.keys(attributes).forEach(function (key) {
        node.setAttribute(key, attributes[key]);
      });
      svg.appendChild(node);
      return node;
    }
    /** @param {string} value @param {number} x @param {number} y @param {string} anchor */
    function label(value, x, y, anchor) {
      var node = /** @type {SVGTextElement} */ (
        element("text", { x: String(x), y: String(y), "text-anchor": anchor })
      );
      node.textContent = value;
      return node;
    }
    /** @param {number} value */
    function yFor(value) {
      var transformed =
        scale === "log" ? Math.log10(Math.max(value, 10 ** low)) : value;
      return (
        bottom -
        ((transformed - low) / Math.max(0.000001, high - low)) * (bottom - top)
      );
    }
    /** @param {number} index */
    function xFor(index) {
      return dimension.points.length <= 1
        ? left
        : left + (index / (dimension.points.length - 1)) * (right - left);
    }
    for (var tick = 0; tick <= 3; tick++) {
      var transformed = low + ((high - low) * tick) / 3;
      var value = scale === "log" ? 10 ** transformed : transformed;
      var y = bottom - (tick / 3) * (bottom - top);
      element("line", {
        x1: String(left),
        y1: String(y),
        x2: String(right),
        y2: String(y),
        class: "grid",
      });
      label(
        normalized
          ? value.toFixed(value < 10 ? 1 : 0) + "×"
          : formatCorpusTiming(value),
        left - 7,
        y + 4,
        "end",
      );
    }
    dimension.points.forEach(
      function (/** @type {*} */ point, /** @type {number} */ index) {
        if (
          index !== 0 &&
          index !== dimension.points.length - 1 &&
          index % 2 !== 0
        )
          return;
        label(String(point.size), xFor(index), bottom + 20, "middle");
      },
    );
    series.forEach(function (item) {
      var color = prettyDashboardColor(item.id);
      element("polyline", {
        points: item.points
          .map(function (point) {
            return xFor(point.x) + "," + yFor(point.value);
          })
          .join(" "),
        fill: "none",
        stroke: color,
        "stroke-width": "2",
      });
      item.points.forEach(function (point) {
        var x = xFor(point.x);
        var y = yFor(point.value);
        if (point.max !== point.min) {
          element("line", {
            x1: String(x),
            y1: String(yFor(point.min)),
            x2: String(x),
            y2: String(yFor(point.max)),
            class: "pretty-dashboard-range",
          });
        }
        var circle = element("circle", {
          cx: String(x),
          cy: String(y),
          r: "3.2",
          fill: color,
        });
        var title = document.createElementNS(namespace, "title");
        title.textContent =
          prettyDashboardBackendLabel(item.id) +
          " · " +
          point.label +
          " · " +
          (normalized
            ? point.value.toFixed(2) + "× fastest"
            : formatCorpusTiming(point.value) + " ms") +
          (point.max === point.min
            ? ""
            : " · range " +
              formatCorpusTiming(point.min) +
              "–" +
              formatCorpusTiming(point.max));
        circle.appendChild(title);
      });
    });
    label(normalized ? "relative runtime" : "median ms", left, 255, "start");
    label("input size", right, 255, "end");
    return svg;
  }

  /** @param {string} id @param {string} metric @return {*} */
  function prettyDashboardColdStat(id, metric) {
    if (
      prettyCampaignReport &&
      prettyCampaignReport.coldStart &&
      prettyCampaignReport.coldStart[id]
    ) {
      return prettyDashboardStat(prettyCampaignReport.coldStart[id][metric]);
    }
    var cold =
      prettyCorpusReport &&
      prettyCorpusReport.coldStart &&
      prettyCorpusReport.coldStart.backends &&
      prettyCorpusReport.coldStart.backends[id];
    if (cold) return prettyDashboardStat(cold[metric]);
    var profile =
      prettyCorpusReport &&
      prettyCorpusReport.runtimeProfile &&
      prettyCorpusReport.runtimeProfile.backends[id];
    return profile && typeof profile[metric] === "number"
      ? prettyDashboardStat({ median: profile[metric] })
      : null;
  }

  /** @param {string} id @return {*} */
  function prettyDashboardRuntimeProfile(id) {
    var cold =
      prettyCorpusReport &&
      prettyCorpusReport.coldStart &&
      prettyCorpusReport.coldStart.backends &&
      prettyCorpusReport.coldStart.backends[id];
    if (cold) return cold;
    var live =
      prettyCorpusReport &&
      prettyCorpusReport.runtimeProfile &&
      prettyCorpusReport.runtimeProfile.backends[id];
    if (live) return live;
    var fingerprint =
      prettyCampaignReport &&
      prettyCampaignReport.artifactFingerprint &&
      prettyCampaignReport.artifactFingerprint[id];
    if (!fingerprint || !Array.isArray(fingerprint.assets)) return null;
    return {
      assetBytes: fingerprint.assets.reduce(function (
        /** @type {number} */ sum,
        /** @type {*} */ asset,
      ) {
        return (
          sum +
          (Array.isArray(asset) && typeof asset[2] === "number" ? asset[2] : 0)
        );
      }, 0),
      wasmBytes: fingerprint.assets.reduce(function (
        /** @type {number} */ sum,
        /** @type {*} */ asset,
      ) {
        return (
          sum +
          (Array.isArray(asset) &&
          typeof asset[0] === "string" &&
          asset[0].endsWith(".wasm") &&
          typeof asset[2] === "number"
            ? asset[2]
            : 0)
        );
      }, 0),
    };
  }

  /** @param {HTMLElement} content @param {string[]} backendIds */
  function appendPrettyDashboardColdStart(content, backendIds) {
    var rows = backendIds
      .map(function (id) {
        return {
          id: id,
          startup: prettyDashboardColdStat(id, "startupMs"),
          resource: prettyDashboardColdStat(id, "resourceLoadMs"),
          profile: prettyDashboardRuntimeProfile(id),
        };
      })
      .filter(function (row) {
        return row.startup || row.resource || row.profile;
      });
    if (rows.length === 0) return;
    var heading = document.createElement("h3");
    heading.textContent = "Startup and browser payload";
    content.appendChild(heading);
    var note = document.createElement("p");
    note.className = "pretty-corpus-note";
    note.textContent = prettyCampaignReport
      ? "Startup medians and ranges aggregate fresh browser processes. Shared VIR entry points intentionally have the same runtime startup."
      : "Current-page values are useful for inspection; load campaign JSON for independent-process ranges.";
    content.appendChild(note);
    var table = document.createElement("table");
    table.className = "pretty-dashboard-startup-table";
    var head = document.createElement("tr");
    [
      "Backend",
      "Startup median",
      "Process range",
      "Startup CV",
      "Resource wall",
      "Assets",
      "Wasm",
    ].forEach(function (label) {
      appendCorpusCell(head, label, "th");
    });
    table.appendChild(head);
    rows.forEach(function (row) {
      var tr = document.createElement("tr");
      appendCorpusCell(tr, prettyDashboardBackendLabel(row.id));
      appendCorpusCell(
        tr,
        row.startup ? formatCorpusTiming(row.startup.median) + " ms" : "—",
      );
      appendCorpusCell(
        tr,
        row.startup
          ? formatCorpusTiming(row.startup.min) +
              "–" +
              formatCorpusTiming(row.startup.max) +
              " ms"
          : "—",
      );
      appendCorpusCell(
        tr,
        row.startup && row.startup.cv !== null
          ? (row.startup.cv * 100).toFixed(1) + "%"
          : "—",
      );
      appendCorpusCell(
        tr,
        row.resource ? formatCorpusTiming(row.resource.median) + " ms" : "—",
      );
      appendCorpusCell(
        tr,
        row.profile ? formatCorpusBytes(row.profile.assetBytes) : "—",
      );
      appendCorpusCell(
        tr,
        row.profile ? formatCorpusBytes(row.profile.wasmBytes) : "—",
      );
      table.appendChild(tr);
    });
    content.appendChild(table);
  }

  /** @param {string} key @param {Set<string>} selected */
  function prettyDashboardMemorySelected(key, selected) {
    if (key === "vir-runtime")
      return selected.has("vir") || selected.has("vir-format");
    return selected.has(key);
  }

  /** @param {HTMLElement} content @param {Set<string>} selected */
  function appendPrettyDashboardMemory(content, selected) {
    var campaignMemory = prettyCampaignReport && prettyCampaignReport.memory;
    var trace = prettyRepeatedReport && prettyRepeatedReport.memoryTrace;
    if (!campaignMemory && !trace) return;
    var heading = document.createElement("h3");
    heading.textContent = "Retained memory and repeated calls";
    content.appendChild(heading);
    var note = document.createElement("p");
    note.className = "pretty-corpus-note";
    note.textContent =
      "Committed capacity is a high-water signal, not live/reachable memory. A tail plateau means only that no new Wasm pages were committed in the final observed window.";
    content.appendChild(note);
    if (trace && Array.isArray(trace.series)) {
      var filteredTrace = Object.assign({}, trace, {
        series: trace.series.filter(function (/** @type {*} */ series) {
          return series.backendIds.some(function (/** @type {string} */ id) {
            return selected.has(id);
          });
        }),
      });
      if (filteredTrace.series.length > 0) {
        content.appendChild(
          createPrettyRepeatedMemoryChart(
            filteredTrace,
            "committedBytes",
            "Committed Wasm capacity",
            Array.from(selected),
          ),
        );
      }
    }
    if (campaignMemory && campaignMemory.repeatedCommitted) {
      var table = document.createElement("table");
      table.className = "pretty-dashboard-memory-table";
      var head = document.createElement("tr");
      [
        "Runtime",
        "Observed runs",
        "Growth median",
        "Process range",
        "Tail growth",
        "Plateau runs",
      ].forEach(function (label) {
        appendCorpusCell(head, label, "th");
      });
      table.appendChild(head);
      Object.keys(campaignMemory.repeatedCommitted).forEach(function (key) {
        if (!prettyDashboardMemorySelected(key, selected)) return;
        var item = campaignMemory.repeatedCommitted[key];
        var row = document.createElement("tr");
        appendCorpusCell(row, item.label);
        appendCorpusCell(row, String(item.observedRuns));
        appendCorpusCell(row, formatCorpusBytes(item.growthBytes.median));
        appendCorpusCell(
          row,
          formatCorpusBytes(item.growthBytes.min) +
            "–" +
            formatCorpusBytes(item.growthBytes.max),
        );
        appendCorpusCell(row, formatCorpusBytes(item.tailGrowthBytes.median));
        appendCorpusCell(row, item.plateauRuns + "/" + item.observedRuns);
        table.appendChild(row);
      });
      content.appendChild(table);
    }
    if (campaignMemory && campaignMemory.isolatedVirModes) {
      var isolatedHeading = document.createElement("h4");
      isolatedHeading.textContent = "Fresh-runtime VIR modes";
      content.appendChild(isolatedHeading);
      var isolatedTable = document.createElement("table");
      isolatedTable.className = "pretty-dashboard-isolated-table";
      var isolatedHead = document.createElement("tr");
      [
        "Mode",
        "Observed runs",
        "Growth median",
        "Tail growth",
        "Assessment",
      ].forEach(function (label) {
        appendCorpusCell(isolatedHead, label, "th");
      });
      isolatedTable.appendChild(isolatedHead);
      Object.keys(campaignMemory.isolatedVirModes).forEach(function (id) {
        if (!selected.has(id)) return;
        var item = campaignMemory.isolatedVirModes[id];
        var row = document.createElement("tr");
        appendCorpusCell(row, item.label);
        appendCorpusCell(row, String(item.observedRuns));
        appendCorpusCell(row, formatCorpusBytes(item.growthBytes.median));
        appendCorpusCell(row, formatCorpusBytes(item.tailGrowthBytes.median));
        appendCorpusCell(
          row,
          item.plateauRuns === item.observedRuns
            ? "tail plateau in every run"
            : item.plateauRuns === 0
              ? "still growing in every tail"
              : "mixed tails",
        );
        isolatedTable.appendChild(row);
      });
      content.appendChild(isolatedTable);
    }
  }

  /**
   * @param {HTMLElement} content
   * @param {string[]} backendIds
   * @param {string} phase
   * @param {string} phaseLabel
   */
  function appendPrettyDashboardBaseline(
    content,
    backendIds,
    phase,
    phaseLabel,
  ) {
    var comparison = prettyCampaignReport && prettyCampaignReport.comparison;
    if (!comparison) return;
    var heading = document.createElement("h3");
    heading.textContent = "Baseline comparison — " + phaseLabel;
    content.appendChild(heading);
    var note = document.createElement("p");
    note.className = "pretty-corpus-note";
    if (!comparison.compatible) {
      note.textContent =
        "The baseline protocol differs from this campaign, so timing deltas were intentionally suppressed.";
      content.appendChild(note);
      return;
    }
    note.textContent =
      "A delta inside the candidate process range is descriptive noise, not a regression or improvement claim.";
    content.appendChild(note);
    var table = document.createElement("table");
    table.className = "pretty-dashboard-baseline-table";
    var head = document.createElement("tr");
    [
      "Backend",
      "Baseline",
      "Candidate median",
      "Delta",
      "Range signal",
    ].forEach(function (label) {
      appendCorpusCell(head, label, "th");
    });
    table.appendChild(head);
    backendIds.forEach(function (id) {
      var item =
        comparison.corpus &&
        comparison.corpus[id] &&
        comparison.corpus[id][phase];
      if (!item) return;
      var row = document.createElement("tr");
      row.className =
        item.relation === "within-candidate-run-range"
          ? "pretty-dashboard-signal-neutral"
          : item.relation === "candidate-above-run-range"
            ? "pretty-dashboard-signal-high"
            : "pretty-dashboard-signal-low";
      appendCorpusCell(row, prettyDashboardBackendLabel(id));
      appendCorpusCell(row, formatCorpusTiming(item.baseline) + " ms");
      appendCorpusCell(row, formatCorpusTiming(item.candidateMedian) + " ms");
      appendCorpusCell(
        row,
        typeof item.delta === "number"
          ? (item.delta >= 0 ? "+" : "") + (item.delta * 100).toFixed(1) + "%"
          : "—",
      );
      appendCorpusCell(
        row,
        item.relation === "within-candidate-run-range"
          ? "within process range"
          : item.relation === "candidate-above-run-range"
            ? "above process range"
            : "below process range",
      );
      table.appendChild(row);
    });
    content.appendChild(table);
  }

  function prettyDashboardExportData() {
    return {
      schemaVersion: 1,
      kind: "pretty-results-dashboard",
      generatedAt: new Date().toISOString(),
      campaign: prettyCampaignReport,
      reports: {
        corpus: prettyCorpusReport,
        scaling: prettyScalingReport,
        memory: prettyMemoryReport,
        interactions: prettyInteractionReport,
        repeated: prettyRepeatedReport,
        live: prettyLiveReport,
      },
    };
  }

  function showPrettyResultsDashboard() {
    if (!prettyDashboardHasData()) return;
    if (prettyCorpusOverlay) prettyCorpusOverlay.remove();
    var overlay = document.createElement("section");
    overlay.className = "pretty-corpus-overlay pretty-dashboard-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute(
      "aria-label",
      "Pretty-printer benchmark results dashboard",
    );
    overlay.addEventListener("keydown", function (event) {
      event.stopPropagation();
      if (event.key === "Escape") overlay.remove();
    });
    var header = document.createElement("header");
    var title = document.createElement("h2");
    title.textContent = "Pretty-printer benchmark results";
    var actions = document.createElement("div");
    var exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.textContent = "Export dashboard JSON";
    exportButton.addEventListener("click", function () {
      downloadPrettyCorpusReport(prettyDashboardExportData());
    });
    var closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "pretty-corpus-close";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", function () {
      overlay.remove();
    });
    actions.append(exportButton, closeButton);
    header.append(title, actions);
    overlay.appendChild(header);

    var source = document.createElement("p");
    source.className = "pretty-corpus-note pretty-dashboard-source";
    source.textContent = prettyCampaignReport
      ? prettyCampaignReport.runCount +
        " independent browser processes · campaign generated " +
        new Date(prettyCampaignReport.generatedAt).toLocaleString() +
        " · whiskers show the observed process range"
      : "Live retained-page measurements · load campaign.json to add independent-process ranges and baseline signals";
    overlay.appendChild(source);

    var allBackendIds = prettyDashboardBackendIds();
    var controls = document.createElement("div");
    controls.className = "pretty-dashboard-controls";
    var phaseControl = document.createElement("label");
    phaseControl.appendChild(document.createTextNode("Timing phase "));
    var phaseSelector = document.createElement("select");
    phaseSelector.className = "pretty-dashboard-phase";
    [
      { id: "executeMs", label: "Execute" },
      { id: "marshalMs", label: "Marshal" },
      { id: "decodeMs", label: "Decode" },
      { id: "totalMs", label: "Total" },
    ].forEach(function (phase) {
      var option = document.createElement("option");
      option.value = phase.id;
      option.textContent = phase.label;
      phaseSelector.appendChild(option);
    });
    phaseControl.appendChild(phaseSelector);
    var scaleControl = document.createElement("label");
    scaleControl.appendChild(document.createTextNode("Scale "));
    var scaleSelector = document.createElement("select");
    scaleSelector.className = "pretty-dashboard-scale";
    [
      { id: "log", label: "Logarithmic" },
      { id: "linear", label: "Linear" },
    ].forEach(function (scale) {
      var option = document.createElement("option");
      option.value = scale.id;
      option.textContent = scale.label;
      scaleSelector.appendChild(option);
    });
    scaleControl.appendChild(scaleSelector);
    var normalizationControl = document.createElement("label");
    normalizationControl.appendChild(document.createTextNode("Values "));
    var normalizationSelector = document.createElement("select");
    normalizationSelector.className = "pretty-dashboard-normalization";
    [
      { id: "absolute", label: "Absolute milliseconds" },
      { id: "fastest", label: "Relative to fastest" },
    ].forEach(function (mode) {
      var option = document.createElement("option");
      option.value = mode.id;
      option.textContent = mode.label;
      normalizationSelector.appendChild(option);
    });
    normalizationControl.appendChild(normalizationSelector);
    var backendControls = createPrettyBackendFilter(
      allBackendIds,
      prettyDashboardBackendLabel,
      renderDashboard,
    );
    controls.append(
      phaseControl,
      scaleControl,
      normalizationControl,
      backendControls,
    );
    overlay.appendChild(controls);
    var content = document.createElement("div");
    content.className = "pretty-dashboard-content";
    overlay.appendChild(content);

    function renderDashboard() {
      content.replaceChildren();
      var backendIds = prettyDashboardSelectedBackendIds(allBackendIds);
      var phase = phaseSelector.value;
      var phaseLabel =
        phaseSelector.options[phaseSelector.selectedIndex].textContent || phase;
      var scale = scaleSelector.value;
      var normalized = normalizationSelector.value === "fastest";
      var cards = document.createElement("div");
      cards.className = "pretty-dashboard-cards";
      var parityReports = [
        prettyCorpusReport,
        prettyScalingReport,
        prettyMemoryReport,
        prettyInteractionReport,
      ].filter(function (report) {
        return report && typeof report.parityCount === "number";
      });
      var parityCount = parityReports.reduce(function (sum, report) {
        return sum + report.parityCount;
      }, 0);
      var scenarioCount = parityReports.reduce(function (sum, report) {
        return sum + (report.scenarioCount || report.pointCount || 0);
      }, 0);
      cards.appendChild(
        createPrettyDashboardCard(
          "Data source",
          prettyCampaignReport
            ? prettyCampaignReport.runCount + " processes"
            : "live page",
          prettyCampaignReport
            ? "Protocol and artifact provenance matched across reports."
            : "One retained browser instance; no process error bars.",
        ),
      );
      cards.appendChild(
        createPrettyDashboardCard(
          "Correctness",
          scenarioCount > 0
            ? parityCount + "/" + scenarioCount
            : "campaign accepted",
          scenarioCount > 0
            ? "Exact styled-output parity across loaded studies."
            : "Only reports passing the campaign's core checks were aggregated.",
        ),
      );
      var jsonStat = backendIds.includes("vir")
        ? prettyDashboardCorpusStat("vir", phase)
        : null;
      var directStat = backendIds.includes("vir-format")
        ? prettyDashboardCorpusStat("vir-format", phase)
        : null;
      cards.appendChild(
        createPrettyDashboardCard(
          "VIR boundary",
          jsonStat && directStat && directStat.median > 0
            ? (jsonStat.median / directStat.median).toFixed(1) + "×"
            : "—",
          "JSON/direct ratio for the selected " +
            phaseLabel.toLowerCase() +
            " phase.",
        ),
      );
      var isolated =
        prettyCampaignReport &&
        prettyCampaignReport.memory &&
        prettyCampaignReport.memory.isolatedVirModes;
      cards.appendChild(
        createPrettyDashboardCard(
          "Isolated VIR memory",
          isolated && isolated.vir && backendIds.includes("vir")
            ? "+" + formatCorpusBytes(isolated.vir.growthBytes.median)
            : "load campaign",
          isolated &&
            isolated["vir-format"] &&
            backendIds.includes("vir-format")
            ? "JSON versus " +
                formatCorpusBytes(isolated["vir-format"].growthBytes.median) +
                " direct Format committed growth."
            : "Fresh-runtime mode separation is collected by the CLI.",
        ),
      );
      content.appendChild(cards);

      var overviewStats = backendIds.filter(function (id) {
        return prettyDashboardCorpusStat(id, phase);
      });
      if (overviewStats.length > 0) {
        var overviewHeading = document.createElement("h3");
        overviewHeading.textContent = "Formatter overview — " + phaseLabel;
        content.appendChild(overviewHeading);
        content.appendChild(
          createPrettyDashboardOverviewChart(
            overviewStats,
            phase,
            phaseLabel,
            scale,
            normalized,
          ),
        );
        var phaseHeading = document.createElement("h3");
        phaseHeading.textContent = "Pipeline phase composition";
        content.appendChild(phaseHeading);
        content.appendChild(createPrettyDashboardPhaseChart(overviewStats));
      }

      var dimensions = prettyDashboardScalingDimensions();
      if (dimensions.length > 0) {
        var scalingHeading = document.createElement("h3");
        scalingHeading.textContent =
          "Input size versus runtime — " + phaseLabel;
        content.appendChild(scalingHeading);
        var scalingNote = document.createElement("p");
        scalingNote.className = "pretty-corpus-note";
        scalingNote.textContent = prettyCampaignReport
          ? "Points are process medians; hover for values and observed ranges."
          : "Points are warmed in-page medians; load campaign JSON for process ranges.";
        content.appendChild(scalingNote);
        var grid = document.createElement("div");
        grid.className = "pretty-dashboard-scaling-grid";
        dimensions.forEach(function (dimension) {
          var figure = document.createElement("figure");
          var caption = document.createElement("figcaption");
          caption.textContent = dimension.label;
          figure.append(
            caption,
            createPrettyDashboardScalingChart(
              dimension,
              backendIds,
              phase,
              phaseLabel,
              scale,
              normalized,
            ),
          );
          grid.appendChild(figure);
        });
        content.appendChild(grid);
      }
      appendPrettyDashboardColdStart(content, backendIds);
      appendPrettyDashboardMemory(content, new Set(backendIds));
      appendPrettyDashboardBaseline(content, backendIds, phase, phaseLabel);
    }

    phaseSelector.addEventListener("change", renderDashboard);
    scaleSelector.addEventListener("change", renderDashboard);
    normalizationSelector.addEventListener("change", renderDashboard);
    renderDashboard();
    document.body.appendChild(overlay);
    prettyCorpusOverlay = overlay;
    closeButton.focus();
  }

  /** @param {*} report */
  function showPrettyCorpusReport(report) {
    if (prettyCorpusOverlay) prettyCorpusOverlay.remove();
    var overlay = document.createElement("section");
    overlay.className = "pretty-corpus-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Pretty-printer differential report");
    overlay.addEventListener("keydown", function (event) {
      event.stopPropagation();
      if (event.key === "Escape") overlay.remove();
    });

    var header = document.createElement("header");
    var title = document.createElement("h2");
    title.textContent = "Pretty-printer differential report";
    var headerActions = document.createElement("div");
    var exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.textContent = "Export JSON";
    exportButton.addEventListener("click", function () {
      downloadPrettyCorpusReport(report);
    });
    var closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "pretty-corpus-close";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", function () {
      overlay.remove();
    });
    headerActions.append(exportButton, closeButton);
    header.append(title, headerActions);
    overlay.appendChild(header);

    if (report.error) {
      var error = document.createElement("p");
      error.className = "pretty-corpus-result status-fail";
      error.textContent = report.error;
      overlay.appendChild(error);
    } else {
      var result = document.createElement("p");
      result.className =
        "pretty-corpus-result " +
        (report.passed ? "status-pass" : "status-fail");
      result.textContent =
        report.parityCount +
        "/" +
        report.scenarioCount +
        " scenarios agree · " +
        (report.backendIds.length - report.unavailable.length) +
        "/" +
        report.backendIds.length +
        " backends ready · " +
        report.samples +
        " timed samples after " +
        report.warmup +
        " warm-ups · " +
        (report.benchmarkMs / 1000).toFixed(2) +
        " s corpus wall time";
      overlay.appendChild(result);

      var backendFilter = createPrettyBackendFilter(
        report.backendIds,
        function (id) {
          return report.summaries[id] ? report.summaries[id].label : id;
        },
        function (selected) {
          applyPrettyBackendVisibility(overlay, selected);
        },
      );
      overlay.appendChild(backendFilter);

      var summaryHeading = document.createElement("h3");
      summaryHeading.textContent = "Aggregate formatter timings (ms)";
      overlay.appendChild(summaryHeading);
      var summaryTable = document.createElement("table");
      summaryTable.className = "pretty-corpus-summary";
      var summaryHead = document.createElement("tr");
      [
        "Backend",
        "Status",
        "Samples",
        "Total median",
        "Total p95",
        "Marshal median",
        "Execute median",
        "Decode median",
      ].forEach(function (heading) {
        appendCorpusCell(summaryHead, heading, "th");
      });
      summaryTable.appendChild(summaryHead);
      report.backendIds.forEach(function (/** @type {string} */ id) {
        var summary = report.summaries[id];
        var row = document.createElement("tr");
        row.dataset.prettyBackend = id;
        appendCorpusCell(row, summary.label);
        appendCorpusCell(row, summary.status);
        appendCorpusCell(row, String(summary.timing.totalMs.samples));
        appendCorpusCell(
          row,
          formatCorpusTiming(summary.timing.totalMs.median),
        );
        appendCorpusCell(row, formatCorpusTiming(summary.timing.totalMs.p95));
        appendCorpusCell(
          row,
          formatCorpusTiming(summary.timing.marshalMs.median),
        );
        appendCorpusCell(
          row,
          formatCorpusTiming(summary.timing.executeMs.median),
        );
        appendCorpusCell(
          row,
          formatCorpusTiming(summary.timing.decodeMs.median),
        );
        summaryTable.appendChild(row);
      });
      overlay.appendChild(summaryTable);

      if (report.runtimeProfile) {
        var runtimeHeading = document.createElement("h3");
        runtimeHeading.textContent = "Current-page startup and footprint";
        overlay.appendChild(runtimeHeading);
        var runtimeNote = document.createElement("p");
        runtimeNote.className = "pretty-corpus-note";
        runtimeNote.textContent =
          "Asset bytes are exact SHA-256-profiled total browser payloads, including the shared formatter/segment harness. Backends that share one in-page runtime do not duplicate its bytes; bridge startup and resource-wall time are reported separately.";
        overlay.appendChild(runtimeNote);
        var runtimeTable = document.createElement("table");
        runtimeTable.className = "pretty-corpus-runtime";
        var runtimeHead = document.createElement("tr");
        [
          "Backend",
          "Startup (ms)",
          "Resource wall (ms)",
          "Assets",
          "Wasm",
          "Memory initial → final",
          "Pipeline",
        ].forEach(function (heading) {
          appendCorpusCell(runtimeHead, heading, "th");
        });
        runtimeTable.appendChild(runtimeHead);
        report.backendIds.forEach(function (/** @type {string} */ id) {
          var profile = report.runtimeProfile.backends[id];
          var before =
            report.runtimeProfileBefore &&
            report.runtimeProfileBefore.backends[id];
          var row = document.createElement("tr");
          row.dataset.prettyBackend = id;
          appendCorpusCell(row, report.summaries[id].label);
          appendCorpusCell(
            row,
            profile && typeof profile.startupMs === "number"
              ? formatCorpusTiming(profile.startupMs)
              : "—",
          );
          appendCorpusCell(
            row,
            profile && typeof profile.resourceLoadMs === "number"
              ? formatCorpusTiming(profile.resourceLoadMs)
              : "—",
          );
          appendCorpusCell(
            row,
            profile ? formatCorpusBytes(profile.assetBytes) : "—",
          );
          appendCorpusCell(
            row,
            profile ? formatCorpusBytes(profile.wasmBytes) : "—",
          );
          appendCorpusCell(
            row,
            profile
              ? formatCorpusBytes(before ? before.memoryBytes : null) +
                  " → " +
                  formatCorpusBytes(profile.memoryBytes)
              : "—",
          );
          appendCorpusCell(
            row,
            profile && profile.provenance
              ? profile.provenance.pipeline || "metadata"
              : id === "js"
                ? "JavaScript"
                : id.startsWith("vir")
                  ? "lean-vir"
                  : "—",
          );
          runtimeTable.appendChild(row);
        });
        overlay.appendChild(runtimeTable);
      }

      var scenarioHeading = document.createElement("h3");
      var providedCases = report.cases.filter(
        function (/** @type {*} */ corpusCase) {
          return corpusCase.origin !== "synthetic";
        },
      ).length;
      scenarioHeading.textContent =
        "Case and width breakdown — " +
        providedCases +
        " externally provided formats, median total (ms)";
      overlay.appendChild(scenarioHeading);
      var scenarioTable = document.createElement("table");
      scenarioTable.className = "pretty-corpus-scenarios";
      var scenarioHead = document.createElement("tr");
      appendCorpusCell(scenarioHead, "Case", "th");
      appendCorpusCell(scenarioHead, "Source", "th");
      appendCorpusCell(scenarioHead, "Width", "th");
      appendCorpusCell(scenarioHead, "Nodes", "th");
      appendCorpusCell(scenarioHead, "Output", "th");
      appendCorpusCell(scenarioHead, "Segments", "th");
      appendCorpusCell(scenarioHead, "Parity", "th");
      report.backendIds.forEach(function (/** @type {string} */ id) {
        var cell = appendCorpusCell(
          scenarioHead,
          report.summaries[id].label,
          "th",
        );
        cell.dataset.prettyBackend = id;
      });
      scenarioTable.appendChild(scenarioHead);
      report.scenarios.forEach(function (/** @type {*} */ scenario) {
        var row = document.createElement("tr");
        row.className = scenario.parity ? "status-pass" : "status-fail";
        appendCorpusCell(row, scenario.label);
        appendCorpusCell(row, scenario.origin);
        appendCorpusCell(row, String(scenario.width));
        appendCorpusCell(row, String(scenario.input.formatNodes));
        appendCorpusCell(
          row,
          scenario.output ? formatCorpusBytes(scenario.output.textBytes) : "—",
        );
        appendCorpusCell(
          row,
          scenario.output ? String(scenario.output.segments) : "—",
        );
        appendCorpusCell(
          row,
          scenario.parity ? "match" : "mismatch",
        ).classList.add("pretty-parity");
        report.backendIds.forEach(function (/** @type {string} */ id) {
          var backendResult = scenario.backends[id];
          var cell = appendCorpusCell(
            row,
            backendResult
              ? formatCorpusTiming(backendResult.summary.totalMs.median)
              : "—",
          );
          cell.dataset.prettyBackend = id;
        });
        scenarioTable.appendChild(row);
      });
      overlay.appendChild(scenarioTable);

      var differing = report.scenarios.filter(
        function (/** @type {*} */ scenario) {
          return !scenario.parity;
        },
      );
      if (differing.length > 0) {
        var differences = document.createElement("details");
        differences.className = "pretty-corpus-differences";
        var differenceSummary = document.createElement("summary");
        differenceSummary.textContent =
          "Inspect " + differing.length + " mismatching scenarios";
        differences.appendChild(differenceSummary);
        differing.forEach(function (/** @type {*} */ scenario) {
          var heading = document.createElement("h4");
          heading.textContent =
            scenario.label + " @ " + scenario.width + " columns";
          differences.appendChild(heading);
          report.backendIds.forEach(function (/** @type {string} */ id) {
            var output = document.createElement("pre");
            output.dataset.prettyBackend = id;
            var backendResult = scenario.backends[id];
            output.textContent =
              report.summaries[id].label +
              ": " +
              (backendResult
                ? JSON.stringify(backendResult.segments, null, 2)
                : report.summaries[id].status);
            differences.appendChild(output);
          });
        });
        overlay.appendChild(differences);
      }
      applyPrettyBackendVisibility(
        overlay,
        prettyDashboardSelectedBackendIds(report.backendIds),
      );
    }

    document.body.appendChild(overlay);
    prettyCorpusOverlay = overlay;
    closeButton.focus();
  }

  /**
   * @param {*} dimension
   * @param {string[]} backendIds
   * @param {Record<string, *>} summaries
   * @param {string} phase
   * @param {string} phaseLabel
   * @return {SVGSVGElement}
   */
  function createPrettyScalingChart(
    dimension,
    backendIds,
    summaries,
    phase,
    phaseLabel,
  ) {
    var namespace = "http://www.w3.org/2000/svg";
    var svg = /** @type {SVGSVGElement} */ (
      document.createElementNS(namespace, "svg")
    );
    svg.classList.add("pretty-scaling-chart");
    svg.setAttribute("viewBox", "0 0 900 270");
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      dimension.label +
        " versus median " +
        phaseLabel.toLowerCase() +
        " runtime; logarithmic time axis",
    );
    var left = 70;
    var right = 675;
    var top = 25;
    var bottom = 220;
    /** @type {number[]} */
    var positive = [];
    dimension.points.forEach(function (/** @type {*} */ point) {
      backendIds.forEach(function (id) {
        var result = point.backends[id];
        var value = result && result.summary[phase].median;
        if (typeof value === "number" && value > 0) positive.push(value);
      });
    });
    var minimum = positive.length > 0 ? Math.min.apply(null, positive) : 0.001;
    var maximum = positive.length > 0 ? Math.max.apply(null, positive) : 1;
    var low = Math.log10(Math.max(0.0001, minimum * 0.75));
    var high = Math.log10(Math.max(minimum * 1.5, maximum * 1.25));

    /** @param {string} name @param {Record<string, string>} attributes */
    function element(name, attributes) {
      var node = document.createElementNS(namespace, name);
      Object.keys(attributes).forEach(function (key) {
        node.setAttribute(key, attributes[key]);
      });
      svg.appendChild(node);
      return node;
    }

    /** @param {string} value @param {number} x @param {number} y @param {string} anchor */
    function label(value, x, y, anchor) {
      var node = /** @type {SVGTextElement} */ (
        element("text", { x: String(x), y: String(y), "text-anchor": anchor })
      );
      node.textContent = value;
      return node;
    }

    element("line", {
      x1: String(left),
      y1: String(bottom),
      x2: String(right),
      y2: String(bottom),
      class: "axis",
    });
    element("line", {
      x1: String(left),
      y1: String(top),
      x2: String(left),
      y2: String(bottom),
      class: "axis",
    });
    for (var tick = 0; tick <= 4; tick++) {
      var tickLog = low + ((high - low) * tick) / 4;
      var y = bottom - ((tickLog - low) / (high - low)) * (bottom - top);
      element("line", {
        x1: String(left),
        y1: String(y),
        x2: String(right),
        y2: String(y),
        class: "grid",
      });
      label(formatCorpusTiming(10 ** tickLog), left - 8, y + 4, "end");
    }
    dimension.points.forEach(
      function (/** @type {*} */ point, /** @type {number} */ index) {
        var x =
          dimension.points.length === 1
            ? left
            : left + (index / (dimension.points.length - 1)) * (right - left);
        label(point.sizeLabel || String(point.size), x, bottom + 22, "middle");
      },
    );
    label(phaseLabel.toLowerCase() + " median ms (log)", 8, top + 5, "start");

    backendIds.forEach(function (id, backendIndex) {
      /** @type {{ x: number, y: number, value: number, label: string, batch: number, limited: string | null }[]} */
      var points = [];
      dimension.points.forEach(
        function (/** @type {*} */ point, /** @type {number} */ index) {
          var result = point.backends[id];
          var value = result && result.summary[phase].median;
          if (typeof value !== "number") return;
          var x =
            dimension.points.length === 1
              ? left
              : left + (index / (dimension.points.length - 1)) * (right - left);
          var y =
            bottom -
            ((Math.log10(Math.max(value, minimum * 0.5)) - low) /
              (high - low)) *
              (bottom - top);
          points.push({
            x: x,
            y: y,
            value: value,
            label: point.sizeLabel,
            batch: result.batchIterations || 1,
            limited: result.batchLimitReason || null,
          });
        },
      );
      var color = prettyDashboardColor(id);
      element("polyline", {
        points: points
          .map(function (point) {
            return point.x + "," + point.y;
          })
          .join(" "),
        fill: "none",
        stroke: color,
        "stroke-width": "2",
      });
      points.forEach(function (point) {
        var circle = element("circle", {
          cx: String(point.x),
          cy: String(point.y),
          r: "3.5",
          fill: color,
        });
        var title = document.createElementNS(namespace, "title");
        title.textContent =
          summaries[id].label +
          " · " +
          point.label +
          " · " +
          formatCorpusTiming(point.value) +
          " ms · batch " +
          point.batch +
          (point.limited ? " · " + point.limited : "");
        circle.appendChild(title);
      });
      var legendY = top + backendIndex * 25;
      element("line", {
        x1: "710",
        y1: String(legendY),
        x2: "735",
        y2: String(legendY),
        stroke: color,
        "stroke-width": "3",
      });
      label(summaries[id].label, 745, legendY + 4, "start");
    });
    return svg;
  }

  /** @param {*} report */
  function showPrettyScalingReport(report) {
    if (prettyCorpusOverlay) prettyCorpusOverlay.remove();
    var presentation = report.presentation || {};
    var overlay = document.createElement("section");
    overlay.className = "pretty-corpus-overlay pretty-scaling-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute(
      "aria-label",
      presentation.ariaLabel || "Pretty-printer input scaling report",
    );
    overlay.addEventListener("keydown", function (event) {
      event.stopPropagation();
      if (event.key === "Escape") overlay.remove();
    });
    var header = document.createElement("header");
    var title = document.createElement("h2");
    title.textContent =
      presentation.title || "Pretty-printer input scaling report";
    var actions = document.createElement("div");
    var exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.textContent = "Export JSON";
    exportButton.addEventListener("click", function () {
      downloadPrettyCorpusReport(report);
    });
    var closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "pretty-corpus-close";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", function () {
      overlay.remove();
    });
    actions.append(exportButton, closeButton);
    header.append(title, actions);
    overlay.appendChild(header);
    if (report.error) {
      var error = document.createElement("p");
      error.className = "pretty-corpus-result status-fail";
      error.textContent = report.error;
      overlay.appendChild(error);
    } else {
      var result = document.createElement("p");
      result.className =
        "pretty-corpus-result " +
        (report.passed ? "status-pass" : "status-fail");
      result.textContent =
        report.parityCount +
        "/" +
        report.scenarioCount +
        " " +
        (presentation.pointNoun || "scaling points") +
        " agree · " +
        report.dimensions.length +
        " dimensions · " +
        report.samples +
        " samples · " +
        (report.benchmarkMs / 1000).toFixed(2) +
        " s wall time";
      overlay.appendChild(result);
      var note = document.createElement("p");
      note.className = "pretty-corpus-note";
      note.textContent = presentation.note
        ? presentation.note
        : "Charts show warmed phase medians on a logarithmic time axis. Execute is the default because it best isolates the generated formatter; marshal, decode, and end-to-end total remain selectable. Adaptive batches target " +
          report.batchTargetMs +
          " ms, with allocation-heavy resident arenas capped by a " +
          formatCorpusBytes(report.batchMemoryBudgetBytes) +
          " study budget.";
      overlay.appendChild(note);
      var phaseControl = document.createElement("label");
      phaseControl.className = "pretty-scaling-phase-control";
      phaseControl.appendChild(document.createTextNode("Timing phase "));
      var phaseSelector = document.createElement("select");
      phaseSelector.className = "pretty-scaling-phase";
      var timingPhases = report.timingPhases || [
        { id: "executeMs", label: "Execute" },
        { id: "marshalMs", label: "Marshal" },
        { id: "decodeMs", label: "Decode" },
        { id: "totalMs", label: "Total" },
      ];
      timingPhases.forEach(function (/** @type {*} */ phase) {
        var option = document.createElement("option");
        option.value = phase.id;
        option.textContent = phase.label;
        option.selected =
          phase.id === (presentation.defaultPhase || "executeMs");
        phaseSelector.appendChild(option);
      });
      phaseControl.appendChild(phaseSelector);
      var reportControls = document.createElement("div");
      reportControls.className = "pretty-report-controls";
      reportControls.append(
        phaseControl,
        createPrettyBackendFilter(
          report.backendIds,
          function (id) {
            return report.summaries[id] ? report.summaries[id].label : id;
          },
          renderPhase,
        ),
      );
      overlay.appendChild(reportControls);
      var phaseContent = document.createElement("div");
      phaseContent.className = "pretty-scaling-phase-content";
      overlay.appendChild(phaseContent);

      function renderPhase() {
        var backendIds = prettyDashboardSelectedBackendIds(report.backendIds);
        var phase = phaseSelector.value;
        var phaseDefinition = timingPhases.find(
          function (/** @type {*} */ candidate) {
            return candidate.id === phase;
          },
        );
        var phaseLabel = phaseDefinition ? phaseDefinition.label : phase;
        phaseContent.replaceChildren();
        report.dimensions.forEach(function (/** @type {*} */ dimension) {
          var heading = document.createElement("h3");
          heading.textContent = dimension.label + " — " + phaseLabel;
          phaseContent.appendChild(heading);
          phaseContent.appendChild(
            createPrettyScalingChart(
              dimension,
              backendIds,
              report.summaries,
              phase,
              phaseLabel,
            ),
          );
          var trends = document.createElement("p");
          trends.className = "pretty-corpus-note pretty-scaling-trends";
          var phaseTrends =
            (dimension.phaseTrends && dimension.phaseTrends[phase]) ||
            dimension.trends;
          trends.textContent = backendIds
            .map(function (/** @type {string} */ id) {
              var trend = phaseTrends[id];
              return (
                report.summaries[id].label +
                ": " +
                (trend && typeof trend.growth === "number"
                  ? trend.growth.toFixed(1) + "× growth"
                  : "—") +
                (trend && typeof trend.logLogSlope === "number"
                  ? ", slope " + trend.logLogSlope.toFixed(2)
                  : "")
              );
            })
            .join(" · ");
          phaseContent.appendChild(trends);
          var table = document.createElement("table");
          table.className = "pretty-scaling-table";
          var head = document.createElement("tr");
          var pointColumns = Array.isArray(presentation.pointColumns)
            ? presentation.pointColumns
            : null;
          (pointColumns
            ? pointColumns.map(function (/** @type {*} */ column) {
                return column.label;
              })
            : [
                "Size",
                "Nodes",
                "Input bytes",
                "Depth",
                "Tags",
                "Breaks",
                "Output bytes",
                "Segments",
                "Output lines",
              ]
          ).forEach(function (column) {
            appendCorpusCell(head, column, "th");
          });
          appendCorpusCell(head, "Parity", "th");
          backendIds.forEach(function (/** @type {string} */ id) {
            appendCorpusCell(head, report.summaries[id].label + " ms", "th");
          });
          table.appendChild(head);
          dimension.points.forEach(function (/** @type {*} */ point) {
            var row = document.createElement("tr");
            row.className = point.parity ? "status-pass" : "status-fail";
            if (pointColumns) {
              pointColumns.forEach(function (/** @type {*} */ column) {
                var value = point.table && point.table[column.key];
                appendCorpusCell(
                  row,
                  value === null || value === undefined ? "—" : String(value),
                );
              });
            } else {
              appendCorpusCell(row, point.sizeLabel || String(point.size));
              appendCorpusCell(row, String(point.input.formatNodes));
              appendCorpusCell(row, String(point.input.textBytes));
              appendCorpusCell(row, String(point.input.maxDepth));
              appendCorpusCell(row, String(point.input.maxTagDepth));
              appendCorpusCell(row, String(point.input.lineNodes));
              appendCorpusCell(
                row,
                point.output ? String(point.output.textBytes) : "—",
              );
              appendCorpusCell(
                row,
                point.output ? String(point.output.segments) : "—",
              );
              appendCorpusCell(
                row,
                point.output ? String(point.output.lines) : "—",
              );
            }
            appendCorpusCell(
              row,
              point.parity ? "match" : "mismatch",
            ).classList.add("pretty-parity");
            backendIds.forEach(function (/** @type {string} */ id) {
              var backend = point.backends[id];
              appendCorpusCell(
                row,
                backend
                  ? formatCorpusTiming(backend.summary[phase].median)
                  : "—",
              );
            });
            table.appendChild(row);
          });
          phaseContent.appendChild(table);
        });
      }

      phaseSelector.addEventListener("change", renderPhase);
      renderPhase();
    }
    document.body.appendChild(overlay);
    prettyCorpusOverlay = overlay;
    closeButton.focus();
  }

  /**
   * @param {*} trace
   * @param {"committedBytes" | "residentBytes"} metric
   * @param {string} metricLabel
   * @param {string[]} backendIds
   * @return {SVGSVGElement}
   */
  function createPrettyRepeatedMemoryChart(
    trace,
    metric,
    metricLabel,
    backendIds,
  ) {
    var namespace = "http://www.w3.org/2000/svg";
    var svg = /** @type {SVGSVGElement} */ (
      document.createElementNS(namespace, "svg")
    );
    svg.classList.add("pretty-scaling-chart", "pretty-repeated-memory-chart");
    svg.setAttribute("viewBox", "0 0 900 270");
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      "Repeated-call " + metricLabel.toLowerCase() + " by completed cycle",
    );
    var left = 80;
    var right = 675;
    var top = 25;
    var bottom = 220;
    var series = trace.series
      .map(function (/** @type {*} */ item) {
        return {
          item: item,
          points: item.points.filter(function (/** @type {*} */ point) {
            return (
              typeof point[metric] === "number" &&
              Number.isFinite(point[metric])
            );
          }),
        };
      })
      .filter(function (/** @type {*} */ item) {
        return (
          item.points.length > 0 &&
          item.item.backendIds.some(function (/** @type {string} */ id) {
            return backendIds.includes(id);
          })
        );
      });
    var values = series.flatMap(function (/** @type {*} */ item) {
      return item.points.map(function (/** @type {*} */ point) {
        return point[metric];
      });
    });
    var maximumCycle = Math.max(
      1,
      ...series.flatMap(function (/** @type {*} */ item) {
        return item.points.map(function (/** @type {*} */ point) {
          return point.cycle;
        });
      }),
    );
    var minimum = values.length > 0 ? Math.min.apply(null, values) : 0;
    var maximum = values.length > 0 ? Math.max.apply(null, values) : 1;
    var range = Math.max(1024 * 1024, maximum - minimum);
    var low = Math.max(0, minimum - range * 0.1);
    var high = Math.max(low + 1, maximum + range * 0.1);

    /** @param {string} name @param {Record<string, string>} attributes */
    function element(name, attributes) {
      var node = document.createElementNS(namespace, name);
      Object.keys(attributes).forEach(function (key) {
        node.setAttribute(key, attributes[key]);
      });
      svg.appendChild(node);
      return node;
    }

    /** @param {string} value @param {number} x @param {number} y @param {string} anchor */
    function label(value, x, y, anchor) {
      var node = /** @type {SVGTextElement} */ (
        element("text", { x: String(x), y: String(y), "text-anchor": anchor })
      );
      node.textContent = value;
      return node;
    }

    element("line", {
      x1: String(left),
      y1: String(bottom),
      x2: String(right),
      y2: String(bottom),
      class: "axis",
    });
    element("line", {
      x1: String(left),
      y1: String(top),
      x2: String(left),
      y2: String(bottom),
      class: "axis",
    });
    for (var tick = 0; tick <= 4; tick++) {
      var value = low + ((high - low) * tick) / 4;
      var y = bottom - (tick / 4) * (bottom - top);
      element("line", {
        x1: String(left),
        y1: String(y),
        x2: String(right),
        y2: String(y),
        class: "grid",
      });
      label(formatCorpusBytes(value), left - 8, y + 4, "end");
    }
    for (var cycleTick = 0; cycleTick <= 4; cycleTick++) {
      var cycle = Math.round((maximumCycle * cycleTick) / 4);
      var x = left + (cycle / maximumCycle) * (right - left);
      label(String(cycle), x, bottom + 22, "middle");
    }
    label("Completed cycle", (left + right) / 2, 262, "middle");
    label(metricLabel, 8, top + 5, "start");

    series.forEach(
      function (/** @type {*} */ selected, /** @type {number} */ index) {
        var color = prettyDashboardColor(selected.item.backendIds[0]);
        var plotted = selected.points.map(function (/** @type {*} */ point) {
          return {
            point: point,
            x: left + (point.cycle / maximumCycle) * (right - left),
            y: bottom - ((point[metric] - low) / (high - low)) * (bottom - top),
          };
        });
        element("polyline", {
          points: plotted
            .map(function (/** @type {*} */ point) {
              return point.x + "," + point.y;
            })
            .join(" "),
          fill: "none",
          stroke: color,
          "stroke-width": "2",
        });
        plotted.forEach(function (/** @type {*} */ plottedPoint) {
          var circle = element("circle", {
            cx: String(plottedPoint.x),
            cy: String(plottedPoint.y),
            r: "3.5",
            fill: color,
          });
          var title = document.createElementNS(namespace, "title");
          title.textContent =
            selected.item.label +
            " · cycle " +
            plottedPoint.point.cycle +
            " · " +
            plottedPoint.point.calls +
            " calls · " +
            formatCorpusBytes(plottedPoint.point[metric]);
          circle.appendChild(title);
        });
        var legendY = top + index * 25;
        element("line", {
          x1: "710",
          y1: String(legendY),
          x2: "735",
          y2: String(legendY),
          stroke: color,
          "stroke-width": "3",
        });
        label(selected.item.label, 745, legendY + 4, "start");
      },
    );
    if (series.length === 0) {
      label(
        "No " + metricLabel.toLowerCase() + " telemetry",
        380,
        125,
        "middle",
      );
    }
    return svg;
  }

  /** @param {*} report */
  function showPrettyRepeatedReport(report) {
    if (prettyCorpusOverlay) prettyCorpusOverlay.remove();
    var overlay = document.createElement("section");
    overlay.className = "pretty-corpus-overlay pretty-repeated-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Pretty-printer repeated-call report");
    overlay.addEventListener("keydown", function (event) {
      event.stopPropagation();
      if (event.key === "Escape") overlay.remove();
    });
    var header = document.createElement("header");
    var title = document.createElement("h2");
    title.textContent = "Pretty-printer repeated-call report";
    var actions = document.createElement("div");
    var exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.textContent = "Export JSON";
    exportButton.addEventListener("click", function () {
      downloadPrettyCorpusReport(report);
    });
    var closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "pretty-corpus-close";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", function () {
      overlay.remove();
    });
    actions.append(exportButton, closeButton);
    header.append(title, actions);
    overlay.appendChild(header);

    if (report.error) {
      var error = document.createElement("p");
      error.className = "pretty-corpus-result status-fail";
      error.textContent = report.error;
      overlay.appendChild(error);
    } else {
      var result = document.createElement("p");
      result.className =
        "pretty-corpus-result " +
        (report.passed ? "status-pass" : "status-fail");
      result.textContent =
        report.totalBackendCalls +
        (report.passed
          ? " repeated calls checked without mismatch · "
          : " repeated calls checked; failures found · ") +
        report.cycles +
        " rotated cycles × " +
        report.workloadCount +
        " inputs · " +
        (report.benchmarkMs / 1000).toFixed(2) +
        " s wall time";
      overlay.appendChild(result);
      var note = document.createElement("p");
      note.className = "pretty-corpus-note";
      note.textContent =
        "Each cycle rotates plain, line-heavy, deeply tagged, large-text, and empty-output structural inputs. Every call is checked both against the other backends and against earlier calls of the same backend. Memory is committed Wasm capacity before and after the retained-instance workload.";
      overlay.appendChild(note);

      var rerenderRepeatedMemory = function () {};
      var backendFilter = createPrettyBackendFilter(
        report.backendIds,
        function (id) {
          return report.summaries[id] ? report.summaries[id].label : id;
        },
        function (selected) {
          applyPrettyBackendVisibility(overlay, selected);
          rerenderRepeatedMemory();
        },
      );
      overlay.appendChild(backendFilter);

      var summaryHeading = document.createElement("h3");
      summaryHeading.textContent = "Repeated-call timings and committed memory";
      overlay.appendChild(summaryHeading);
      var summaryTable = document.createElement("table");
      summaryTable.className = "pretty-repeated-summary";
      var summaryHead = document.createElement("tr");
      [
        "Backend",
        "Calls",
        "Total median",
        "Total p95",
        "Marshal",
        "Execute",
        "Decode",
        "Memory before",
        "Memory after",
        "Growth",
      ].forEach(function (heading) {
        appendCorpusCell(summaryHead, heading, "th");
      });
      summaryTable.appendChild(summaryHead);
      report.backendIds.forEach(function (/** @type {string} */ id) {
        var summary = report.summaries[id];
        var memory = report.memoryGrowth[id];
        var row = document.createElement("tr");
        row.dataset.prettyBackend = id;
        appendCorpusCell(row, summary.label);
        appendCorpusCell(row, String(summary.timing.totalMs.samples));
        appendCorpusCell(
          row,
          formatCorpusTiming(summary.timing.totalMs.median),
        );
        appendCorpusCell(row, formatCorpusTiming(summary.timing.totalMs.p95));
        appendCorpusCell(
          row,
          formatCorpusTiming(summary.timing.marshalMs.median),
        );
        appendCorpusCell(
          row,
          formatCorpusTiming(summary.timing.executeMs.median),
        );
        appendCorpusCell(
          row,
          formatCorpusTiming(summary.timing.decodeMs.median),
        );
        appendCorpusCell(row, formatCorpusBytes(memory.beforeBytes));
        appendCorpusCell(row, formatCorpusBytes(memory.afterBytes));
        appendCorpusCell(
          row,
          typeof memory.deltaBytes === "number"
            ? (memory.deltaBytes >= 0 ? "+" : "") +
                formatCorpusBytes(memory.deltaBytes)
            : "—",
        );
        summaryTable.appendChild(row);
      });
      overlay.appendChild(summaryTable);

      if (report.memoryTrace && Array.isArray(report.memoryTrace.series)) {
        var memoryHeading = document.createElement("h3");
        memoryHeading.textContent = "Memory by repeated-call cycle";
        overlay.appendChild(memoryHeading);
        var memoryNote = document.createElement("p");
        memoryNote.className = "pretty-corpus-note";
        memoryNote.textContent =
          "A plateau means committed capacity did not grow in the final trace window; it does not prove that live memory is stable. Backends may share one in-page runtime here; isolated CLI runs remain the stronger check for backend-specific growth.";
        overlay.appendChild(memoryNote);
        var metricControl = document.createElement("label");
        metricControl.className = "pretty-scaling-phase-control";
        metricControl.appendChild(document.createTextNode("Memory metric "));
        var metricSelector = document.createElement("select");
        metricSelector.className = "pretty-repeated-memory-metric";
        [
          { id: "committedBytes", label: "Committed Wasm capacity" },
          { id: "residentBytes", label: "Resident allocation frontier" },
        ].forEach(function (metric) {
          var option = document.createElement("option");
          option.value = metric.id;
          option.textContent = metric.label;
          metricSelector.appendChild(option);
        });
        metricControl.appendChild(metricSelector);
        overlay.appendChild(metricControl);
        var memoryContent = document.createElement("div");
        memoryContent.className = "pretty-repeated-memory-content";
        overlay.appendChild(memoryContent);

        function renderRepeatedMemory() {
          var backendIds = prettyDashboardSelectedBackendIds(report.backendIds);
          var metric = /** @type {"committedBytes" | "residentBytes"} */ (
            metricSelector.value
          );
          var summaryKey =
            metric === "residentBytes" ? "resident" : "committed";
          var metricLabel =
            metricSelector.options[metricSelector.selectedIndex].textContent ||
            metric;
          memoryContent.replaceChildren(
            createPrettyRepeatedMemoryChart(
              report.memoryTrace,
              metric,
              metricLabel,
              backendIds,
            ),
          );
          var table = document.createElement("table");
          table.className = "pretty-repeated-memory-summary";
          var head = document.createElement("tr");
          [
            "Memory",
            "Backends",
            "Initial",
            "Final",
            "Growth",
            "Tail growth",
            "Last growth",
            "Assessment",
          ].forEach(function (heading) {
            appendCorpusCell(head, heading, "th");
          });
          table.appendChild(head);
          report.memoryTrace.series.forEach(function (/** @type {*} */ series) {
            if (
              !series.backendIds.some(function (/** @type {string} */ id) {
                return backendIds.includes(id);
              })
            )
              return;
            var summary = series[summaryKey];
            if (!summary || summary.samples === 0) return;
            var row = document.createElement("tr");
            appendCorpusCell(row, series.label);
            appendCorpusCell(row, series.backendIds.join(", "));
            appendCorpusCell(row, formatCorpusBytes(summary.initialBytes));
            appendCorpusCell(row, formatCorpusBytes(summary.finalBytes));
            appendCorpusCell(row, formatCorpusBytes(summary.growthBytes));
            appendCorpusCell(
              row,
              formatCorpusBytes(summary.tailGrowthBytes) +
                " / " +
                summary.tailCycles +
                " cycles",
            );
            appendCorpusCell(
              row,
              summary.lastGrowthCycle === null
                ? "none"
                : "cycle " + summary.lastGrowthCycle,
            );
            appendCorpusCell(
              row,
              summary.plateau === null
                ? "insufficient data"
                : summary.plateau
                  ? "tail plateau observed"
                  : "still growing in tail",
            );
            table.appendChild(row);
          });
          memoryContent.appendChild(table);
        }
        rerenderRepeatedMemory = renderRepeatedMemory;
        metricSelector.addEventListener("change", renderRepeatedMemory);
        renderRepeatedMemory();
      }

      var workloadHeading = document.createElement("h3");
      workloadHeading.textContent = "Alternating workload and output work";
      overlay.appendChild(workloadHeading);
      var workloadTable = document.createElement("table");
      workloadTable.className = "pretty-repeated-workloads";
      var workloadHead = document.createElement("tr");
      [
        "Input",
        "Width",
        "Calls/backend",
        "Nodes",
        "Input bytes",
        "Output bytes",
        "Segments",
        "Lines",
        "Tag transitions",
        "Parity/stability",
      ].forEach(function (heading) {
        appendCorpusCell(workloadHead, heading, "th");
      });
      workloadTable.appendChild(workloadHead);
      report.workloads.forEach(function (/** @type {*} */ workload) {
        var stable = report.backendIds.every(
          function (/** @type {string} */ id) {
            return workload.stableByBackend[id];
          },
        );
        var row = document.createElement("tr");
        row.className =
          workload.parity && stable ? "status-pass" : "status-fail";
        appendCorpusCell(row, workload.label);
        appendCorpusCell(row, String(workload.width));
        appendCorpusCell(row, String(workload.callsPerBackend));
        appendCorpusCell(row, String(workload.input.formatNodes));
        appendCorpusCell(row, String(workload.input.textBytes));
        appendCorpusCell(
          row,
          workload.output ? String(workload.output.textBytes) : "—",
        );
        appendCorpusCell(
          row,
          workload.output ? String(workload.output.segments) : "—",
        );
        appendCorpusCell(
          row,
          workload.output ? String(workload.output.lines) : "—",
        );
        appendCorpusCell(
          row,
          workload.output ? String(workload.output.tagTransitions) : "—",
        );
        appendCorpusCell(
          row,
          workload.parity && stable ? "match/stable" : "failed",
        ).classList.add("pretty-parity");
        workloadTable.appendChild(row);
      });
      overlay.appendChild(workloadTable);
      applyPrettyBackendVisibility(
        overlay,
        prettyDashboardSelectedBackendIds(report.backendIds),
      );
    }
    document.body.appendChild(overlay);
    prettyCorpusOverlay = overlay;
    closeButton.focus();
  }

  /**
   * @param {*} dimension
   * @param {string[]} backendIds
   * @param {string} metric
   * @param {string} metricLabel
   * @return {SVGSVGElement}
   */
  function createPrettyMemoryChart(dimension, backendIds, metric, metricLabel) {
    var namespace = "http://www.w3.org/2000/svg";
    var svg = /** @type {SVGSVGElement} */ (
      document.createElementNS(namespace, "svg")
    );
    svg.classList.add("pretty-scaling-chart", "pretty-memory-chart");
    svg.setAttribute("viewBox", "0 0 900 270");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", dimension.label + " versus " + metricLabel);
    var left = 78;
    var right = 675;
    var top = 25;
    var bottom = 220;
    /** @type {number[]} */
    var values = [];
    dimension.points.forEach(function (/** @type {*} */ point) {
      backendIds.forEach(function (id) {
        var value = point.backends[id] && point.backends[id][metric];
        if (typeof value === "number" && value >= 0) values.push(value);
      });
    });
    var maximum = values.length > 0 ? Math.max.apply(null, values) : 1;
    var high = Math.log10(Math.max(2, maximum + 1));

    /** @param {string} name @param {Record<string, string>} attributes */
    function element(name, attributes) {
      var node = document.createElementNS(namespace, name);
      Object.keys(attributes).forEach(function (key) {
        node.setAttribute(key, attributes[key]);
      });
      svg.appendChild(node);
      return node;
    }

    /** @param {string} value @param {number} x @param {number} y @param {string} anchor */
    function label(value, x, y, anchor) {
      var node = /** @type {SVGTextElement} */ (
        element("text", { x: String(x), y: String(y), "text-anchor": anchor })
      );
      node.textContent = value;
      return node;
    }

    element("line", {
      x1: String(left),
      y1: String(bottom),
      x2: String(right),
      y2: String(bottom),
      class: "axis",
    });
    element("line", {
      x1: String(left),
      y1: String(top),
      x2: String(left),
      y2: String(bottom),
      class: "axis",
    });
    for (var tick = 0; tick <= 4; tick++) {
      var tickLog = (high * tick) / 4;
      var y = bottom - (tickLog / high) * (bottom - top);
      element("line", {
        x1: String(left),
        y1: String(y),
        x2: String(right),
        y2: String(y),
        class: "grid",
      });
      label(formatCorpusBytes(10 ** tickLog - 1), left - 8, y + 4, "end");
    }
    dimension.points.forEach(
      function (/** @type {*} */ point, /** @type {number} */ index) {
        var x =
          dimension.points.length === 1
            ? left
            : left + (index / (dimension.points.length - 1)) * (right - left);
        label(point.sizeLabel || String(point.size), x, bottom + 22, "middle");
      },
    );
    label(metricLabel + " (log₁₀(bytes + 1))", 8, top + 5, "start");

    backendIds.forEach(function (id, backendIndex) {
      /** @type {{ x: number, y: number, value: number, label: string }[]} */
      var points = [];
      dimension.points.forEach(
        function (/** @type {*} */ point, /** @type {number} */ index) {
          var value = point.backends[id] && point.backends[id][metric];
          if (typeof value !== "number" || value < 0) return;
          var x =
            dimension.points.length === 1
              ? left
              : left + (index / (dimension.points.length - 1)) * (right - left);
          var y = bottom - (Math.log10(value + 1) / high) * (bottom - top);
          points.push({ x: x, y: y, value: value, label: point.sizeLabel });
        },
      );
      if (points.length === 0) return;
      var color = prettyDashboardColor(id);
      element("polyline", {
        points: points
          .map(function (point) {
            return point.x + "," + point.y;
          })
          .join(" "),
        fill: "none",
        stroke: color,
        "stroke-width": "2",
      });
      points.forEach(function (point) {
        var circle = element("circle", {
          cx: String(point.x),
          cy: String(point.y),
          r: "3.5",
          fill: color,
        });
        var title = document.createElementNS(namespace, "title");
        title.textContent =
          dimension.points[0].backends[id].label +
          " · " +
          point.label +
          " · " +
          formatCorpusBytes(point.value);
        circle.appendChild(title);
      });
      var legendY = top + backendIndex * 25;
      element("line", {
        x1: "710",
        y1: String(legendY),
        x2: "735",
        y2: String(legendY),
        stroke: color,
        "stroke-width": "3",
      });
      label(dimension.points[0].backends[id].label, 745, legendY + 4, "start");
    });
    return svg;
  }

  /** @param {*} report */
  function showPrettyMemoryReport(report) {
    if (prettyCorpusOverlay) prettyCorpusOverlay.remove();
    var overlay = document.createElement("section");
    overlay.className = "pretty-corpus-overlay pretty-memory-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Pretty-printer retained-memory report");
    overlay.addEventListener("keydown", function (event) {
      event.stopPropagation();
      if (event.key === "Escape") overlay.remove();
    });
    var header = document.createElement("header");
    var title = document.createElement("h2");
    title.textContent = "Pretty-printer retained-memory scaling";
    var actions = document.createElement("div");
    var exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.textContent = "Export JSON";
    exportButton.addEventListener("click", function () {
      downloadPrettyCorpusReport(report);
    });
    var closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "pretty-corpus-close";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", function () {
      overlay.remove();
    });
    actions.append(exportButton, closeButton);
    header.append(title, actions);
    overlay.appendChild(header);
    if (report.error) {
      var error = document.createElement("p");
      error.className = "pretty-corpus-result status-fail";
      error.textContent = report.error;
      overlay.appendChild(error);
    } else {
      var result = document.createElement("p");
      result.className =
        "pretty-corpus-result " +
        (report.passed ? "status-pass" : "status-fail");
      result.textContent =
        report.parityCount +
        "/" +
        report.pointCount +
        " one-call memory points agree · " +
        (report.durationMs / 1000).toFixed(2) +
        " s wall time";
      overlay.appendChild(result);
      var note = document.createElement("p");
      note.className = "pretty-corpus-note";
      note.textContent =
        "This in-page study reuses each module but invokes every backend exactly once per point. Per-call resident allocation is currently available from native; committed memory is available for every Wasm backend. Retained growth is sequence-dependent. The CLI additionally collects the same points from fresh browser contexts for isolated baselines.";
      overlay.appendChild(note);
      var metricControl = document.createElement("label");
      metricControl.className = "pretty-scaling-phase-control";
      metricControl.appendChild(document.createTextNode("Memory metric "));
      var metricSelector = document.createElement("select");
      metricSelector.className = "pretty-memory-metric";
      [
        { id: "residentDeltaBytes", label: "Resident allocation per call" },
        { id: "committedDeltaBytes", label: "Committed growth per call" },
        {
          id: "retainedCommittedGrowthBytes",
          label: "Retained committed growth",
        },
      ].forEach(function (metric) {
        var option = document.createElement("option");
        option.value = metric.id;
        option.textContent = metric.label;
        option.selected = metric.id === "residentDeltaBytes";
        metricSelector.appendChild(option);
      });
      metricControl.appendChild(metricSelector);
      var reportControls = document.createElement("div");
      reportControls.className = "pretty-report-controls";
      reportControls.append(
        metricControl,
        createPrettyBackendFilter(
          report.backendIds,
          function (id) {
            var firstDimension = report.dimensions[0];
            var firstPoint = firstDimension && firstDimension.points[0];
            var backend = firstPoint && firstPoint.backends[id];
            return backend ? backend.label : id;
          },
          renderMetric,
        ),
      );
      overlay.appendChild(reportControls);
      var content = document.createElement("div");
      overlay.appendChild(content);

      function renderMetric() {
        var backendIds = prettyDashboardSelectedBackendIds(report.backendIds);
        var metric = metricSelector.value;
        var metricLabel =
          metricSelector.options[metricSelector.selectedIndex].textContent ||
          metric;
        content.replaceChildren();
        report.dimensions.forEach(function (/** @type {*} */ dimension) {
          var heading = document.createElement("h3");
          heading.textContent = dimension.label + " — " + metricLabel;
          content.appendChild(heading);
          content.appendChild(
            createPrettyMemoryChart(dimension, backendIds, metric, metricLabel),
          );
          var table = document.createElement("table");
          table.className = "pretty-memory-table";
          var head = document.createElement("tr");
          ["Size", "Input bytes", "Output bytes", "Parity"].forEach(
            function (column) {
              appendCorpusCell(head, column, "th");
            },
          );
          backendIds.forEach(function (/** @type {string} */ id) {
            appendCorpusCell(
              head,
              dimension.points[0].backends[id].label,
              "th",
            );
          });
          table.appendChild(head);
          dimension.points.forEach(function (/** @type {*} */ point) {
            var row = document.createElement("tr");
            row.className = point.parity ? "status-pass" : "status-fail";
            appendCorpusCell(row, point.sizeLabel || String(point.size));
            appendCorpusCell(row, String(point.input.textBytes));
            appendCorpusCell(
              row,
              point.output ? String(point.output.textBytes) : "—",
            );
            appendCorpusCell(
              row,
              point.parity ? "match" : "mismatch",
            ).classList.add("pretty-parity");
            backendIds.forEach(function (/** @type {string} */ id) {
              appendCorpusCell(
                row,
                formatCorpusBytes(point.backends[id][metric]),
              );
            });
            table.appendChild(row);
          });
          content.appendChild(table);
        });
      }
      metricSelector.addEventListener("change", renderMetric);
      renderMetric();
    }
    document.body.appendChild(overlay);
    prettyCorpusOverlay = overlay;
    closeButton.focus();
  }

  /**
   * @param {*} interaction
   * @param {string} backendId
   * @param {string} backendLabel
   * @param {string} phase
   * @param {string} phaseLabel
   * @return {SVGSVGElement}
   */
  function createPrettyInteractionHeatmap(
    interaction,
    backendId,
    backendLabel,
    phase,
    phaseLabel,
  ) {
    var namespace = "http://www.w3.org/2000/svg";
    var svg = /** @type {SVGSVGElement} */ (
      document.createElementNS(namespace, "svg")
    );
    svg.classList.add("pretty-scaling-chart", "pretty-interaction-chart");
    svg.setAttribute("viewBox", "0 0 760 300");
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      interaction.label + " heatmap for " + backendLabel + " " + phaseLabel,
    );
    var left = 185;
    var top = 35;
    var cellWidth = 165;
    var cellHeight = 68;
    var values = interaction.points.map(function (/** @type {*} */ point) {
      return point.backends[backendId].summary[phase].median;
    });
    var maximum = Math.max.apply(null, values.concat([0.001]));

    /** @param {string} name @param {Record<string, string>} attributes */
    function element(name, attributes) {
      var node = document.createElementNS(namespace, name);
      Object.keys(attributes).forEach(function (key) {
        node.setAttribute(key, attributes[key]);
      });
      svg.appendChild(node);
      return node;
    }
    /** @param {string} value @param {number} x @param {number} y @param {string} anchor */
    function label(value, x, y, anchor) {
      var node = /** @type {SVGTextElement} */ (
        element("text", { x: String(x), y: String(y), "text-anchor": anchor })
      );
      node.textContent = value;
      return node;
    }

    interaction.xValues.forEach(
      function (/** @type {*} */ xValue, /** @type {number} */ xIndex) {
        label(
          xValue.label,
          left + xIndex * cellWidth + cellWidth / 2,
          22,
          "middle",
        );
      },
    );
    interaction.yValues.forEach(
      function (/** @type {*} */ yValue, /** @type {number} */ yIndex) {
        label(yValue.label, left - 12, top + yIndex * cellHeight + 39, "end");
        interaction.xValues.forEach(
          function (/** @type {*} */ xValue, /** @type {number} */ xIndex) {
            var point = interaction.points.find(
              function (/** @type {*} */ candidate) {
                return (
                  candidate.x === xValue.value && candidate.y === yValue.value
                );
              },
            );
            if (!point) return;
            var value = point.backends[backendId].summary[phase].median;
            var intensity = Math.max(
              0.08,
              Math.log10(value + 1) / Math.log10(maximum + 1),
            );
            var rect = element("rect", {
              x: String(left + xIndex * cellWidth),
              y: String(top + yIndex * cellHeight),
              width: String(cellWidth - 4),
              height: String(cellHeight - 4),
              rx: "4",
              fill: "rgba(74, 144, 226, " + intensity.toFixed(3) + ")",
            });
            var title = document.createElementNS(namespace, "title");
            title.textContent =
              backendLabel +
              " · " +
              xValue.label +
              " × " +
              yValue.label +
              " · " +
              formatCorpusTiming(value) +
              " ms · output " +
              (point.output ? formatCorpusBytes(point.output.textBytes) : "—");
            title.textContent +=
              " · batch " +
              (point.backends[backendId].batchIterations || 1) +
              (point.backends[backendId].batchLimitReason
                ? " · " + point.backends[backendId].batchLimitReason
                : "");
            rect.appendChild(title);
            label(
              formatCorpusTiming(value) + " ms",
              left + xIndex * cellWidth + cellWidth / 2,
              top + yIndex * cellHeight + 38,
              "middle",
            );
          },
        );
      },
    );
    label(
      interaction.xAxis,
      left + (interaction.xValues.length * cellWidth) / 2,
      288,
      "middle",
    );
    label(interaction.yAxis, 8, top + 5, "start");
    return svg;
  }

  /** @param {*} report */
  function showPrettyInteractionReport(report) {
    if (prettyCorpusOverlay) prettyCorpusOverlay.remove();
    var overlay = document.createElement("section");
    overlay.className = "pretty-corpus-overlay pretty-interaction-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Pretty-printer interaction report");
    overlay.addEventListener("keydown", function (event) {
      event.stopPropagation();
      if (event.key === "Escape") overlay.remove();
    });
    var header = document.createElement("header");
    var title = document.createElement("h2");
    title.textContent = "Pretty-printer interaction study";
    var actions = document.createElement("div");
    var exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.textContent = "Export JSON";
    exportButton.addEventListener("click", function () {
      downloadPrettyCorpusReport(report);
    });
    var closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "pretty-corpus-close";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", function () {
      overlay.remove();
    });
    actions.append(exportButton, closeButton);
    header.append(title, actions);
    overlay.appendChild(header);
    if (report.error) {
      var error = document.createElement("p");
      error.className = "pretty-corpus-result status-fail";
      error.textContent = report.error;
      overlay.appendChild(error);
    } else {
      var result = document.createElement("p");
      result.className =
        "pretty-corpus-result " +
        (report.passed ? "status-pass" : "status-fail");
      result.textContent =
        report.parityCount +
        "/" +
        report.scenarioCount +
        " interaction points agree · " +
        report.interactions.length +
        " grids · adaptive batches target " +
        report.batchTargetMs +
        " ms · memory budget " +
        formatCorpusBytes(report.batchMemoryBudgetBytes);
      overlay.appendChild(result);
      var note = document.createElement("p");
      note.className = "pretty-corpus-note";
      note.textContent =
        "Heatmaps isolate breaks × width, nodes × depth, tag depth × output transitions, and input bytes × output expansion. Hover a cell for exact time and output size.";
      overlay.appendChild(note);
      var controls = document.createElement("div");
      controls.className = "pretty-interaction-controls";
      var backendLabel = document.createElement("label");
      backendLabel.appendChild(document.createTextNode("Backend "));
      var backendSelector = document.createElement("select");
      backendSelector.className = "pretty-interaction-backend";
      backendLabel.appendChild(backendSelector);
      var phaseLabel = document.createElement("label");
      phaseLabel.appendChild(document.createTextNode("Phase "));
      var phaseSelector = document.createElement("select");
      phaseSelector.className = "pretty-interaction-phase";
      report.timingPhases.forEach(function (/** @type {*} */ phase) {
        var option = document.createElement("option");
        option.value = phase.id;
        option.textContent = phase.label;
        option.selected = phase.id === "executeMs";
        phaseSelector.appendChild(option);
      });
      phaseLabel.appendChild(phaseSelector);
      var backendFilter = createPrettyBackendFilter(
        report.backendIds,
        function (id) {
          return report.summaries[id] ? report.summaries[id].label : id;
        },
        function () {
          syncInteractionBackendOptions();
          renderInteraction();
        },
      );
      controls.append(backendFilter, backendLabel, phaseLabel);
      overlay.appendChild(controls);
      var content = document.createElement("div");
      overlay.appendChild(content);

      function syncInteractionBackendOptions() {
        var previous = backendSelector.value;
        var backendIds = prettyDashboardSelectedBackendIds(report.backendIds);
        backendSelector.replaceChildren();
        backendIds.forEach(function (id) {
          var option = document.createElement("option");
          option.value = id;
          option.textContent = report.summaries[id].label;
          backendSelector.appendChild(option);
        });
        backendSelector.value = backendIds.includes(previous)
          ? previous
          : backendIds.includes("native")
            ? "native"
            : backendIds[0];
      }

      function renderInteraction() {
        var backendId = backendSelector.value;
        var phase = phaseSelector.value;
        var selectedPhaseLabel =
          phaseSelector.options[phaseSelector.selectedIndex].textContent ||
          phase;
        content.replaceChildren();
        report.interactions.forEach(function (/** @type {*} */ interaction) {
          var heading = document.createElement("h3");
          heading.textContent =
            interaction.label +
            " — " +
            report.summaries[backendId].label +
            " " +
            selectedPhaseLabel;
          content.appendChild(heading);
          content.appendChild(
            createPrettyInteractionHeatmap(
              interaction,
              backendId,
              report.summaries[backendId].label,
              phase,
              selectedPhaseLabel,
            ),
          );
        });
      }
      backendSelector.addEventListener("change", renderInteraction);
      phaseSelector.addEventListener("change", renderInteraction);
      syncInteractionBackendOptions();
      renderInteraction();
    }
    document.body.appendChild(overlay);
    prettyCorpusOverlay = overlay;
    closeButton.focus();
  }

  /**
   * @param {*} report
   * @param {string[]} backendIds
   * @param {string} metric
   * @param {string} metricLabel
   */
  function createPrettyLiveTimeline(report, backendIds, metric, metricLabel) {
    var namespace = "http://www.w3.org/2000/svg";
    var width = 940;
    var height = 300;
    var left = 62;
    var right = 914;
    var top = 30;
    var bottom = 252;
    var frames = Array.isArray(report.frames) ? report.frames : [];
    var values = frames
      .flatMap(function (frame) {
        return backendIds.map(function (id) {
          return Number(frame.backends?.[id]?.[metric]);
        });
      })
      .filter(function (value) {
        return Number.isFinite(value) && value >= 0;
      });
    var maximum = Math.max.apply(null, values.concat([0.001]));
    var svg = /** @type {SVGSVGElement} */ (
      document.createElementNS(namespace, "svg")
    );
    svg.classList.add("pretty-dashboard-chart", "pretty-live-timeline");
    svg.setAttribute("viewBox", "0 0 " + width + " " + height);
    svg.setAttribute("role", "img");
    svg.setAttribute(
      "aria-label",
      metricLabel + " by live-render frame and backend",
    );

    /** @param {string} name @param {Record<string, string>} attributes @param {Element} [parent] */
    function element(name, attributes, parent) {
      var node = document.createElementNS(namespace, name);
      Object.keys(attributes).forEach(function (key) {
        node.setAttribute(key, attributes[key]);
      });
      (parent || svg).appendChild(node);
      return node;
    }
    /** @param {string} value @param {number} x @param {number} y @param {string} anchor */
    function label(value, x, y, anchor) {
      var node = /** @type {SVGTextElement} */ (
        element("text", { x: String(x), y: String(y), "text-anchor": anchor })
      );
      node.textContent = value;
      return node;
    }
    /** @param {number} index */
    function xFor(index) {
      return frames.length <= 1
        ? left
        : left + (index / (frames.length - 1)) * (right - left);
    }
    /** @param {number} value */
    function yFor(value) {
      return bottom - (value / maximum) * (bottom - top);
    }

    for (var tick = 0; tick <= 4; tick++) {
      var value = (maximum * tick) / 4;
      var y = yFor(value);
      element("line", {
        x1: String(left),
        y1: String(y),
        x2: String(right),
        y2: String(y),
        class: "grid",
      });
      label(formatCorpusTiming(value), left - 10, y + 4, "end");
    }
    backendIds.forEach(function (id) {
      var points = [];
      var group = element("g", {});
      frames.forEach(function (frame, index) {
        var value = Number(frame.backends?.[id]?.[metric]);
        if (!Number.isFinite(value)) return;
        var x = xFor(index);
        var y = yFor(value);
        points.push(x + "," + y);
        var dot = element(
          "circle",
          {
            cx: String(x),
            cy: String(y),
            r: frames.length > 80 ? "1.3" : "2.4",
            fill: prettyDashboardColor(id),
          },
          group,
        );
        var title = document.createElementNS(namespace, "title");
        title.textContent =
          prettyDashboardBackendLabel(id) +
          " · frame " +
          frame.frame +
          " · " +
          formatCorpusTiming(value) +
          " ms";
        dot.appendChild(title);
      });
      if (points.length > 0) {
        group.insertBefore(
          element(
            "polyline",
            {
              points: points.join(" "),
              fill: "none",
              stroke: prettyDashboardColor(id),
              "stroke-width": "2",
              "stroke-linejoin": "round",
            },
            group,
          ),
          group.firstChild,
        );
      }
    });
    label(metricLabel + " (ms)", left, 16, "start");
    label("frame 1", left, height - 14, "start");
    label("frame " + Math.max(1, frames.length), right, height - 14, "end");
    return svg;
  }

  /** @param {*} report */
  function showPrettyLiveReport(report) {
    if (prettyCorpusOverlay) prettyCorpusOverlay.remove();
    var overlay = document.createElement("section");
    overlay.className = "pretty-corpus-overlay pretty-live-overlay";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Live rendering benchmark report");
    overlay.addEventListener("keydown", function (event) {
      event.stopPropagation();
      if (event.key === "Escape") closePrettyDashboard();
    });

    var header = document.createElement("header");
    var title = document.createElement("h2");
    title.textContent = "Live rendering report";
    var actions = document.createElement("div");
    var exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.textContent = "Export JSON";
    exportButton.addEventListener("click", function () {
      downloadPrettyCorpusReport(report);
    });
    var closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "Close";
    closeButton.addEventListener("click", closePrettyDashboard);
    actions.append(exportButton, closeButton);
    header.append(title, actions);
    overlay.appendChild(header);

    var result = document.createElement("p");
    result.className =
      "pretty-corpus-result " + (report.passed ? "status-pass" : "status-fail");
    result.textContent = report.passed
      ? report.parityCount +
        "/" +
        report.frameCount +
        " frames have exact HTML parity"
      : "Live rendering reported a mismatch or backend failure";
    overlay.appendChild(result);

    var cards = document.createElement("div");
    cards.className = "pretty-dashboard-cards";
    cards.append(
      createPrettyDashboardCard(
        "Frames",
        String(report.frameCount),
        "Synthetic updates, backend order rotated each frame",
      ),
      createPrettyDashboardCard(
        "Parity",
        report.parityCount + "/" + report.frameCount,
        "Exact escaped HTML before browser commit",
      ),
      createPrettyDashboardCard(
        "Backends",
        String(report.backendIds.length),
        "Independent formatter implementations",
      ),
      createPrettyDashboardCard(
        "Run duration",
        formatCorpusTiming(report.durationMs) + " ms",
        "Includes animation-frame scheduling",
      ),
    );
    overlay.appendChild(cards);

    var note = document.createElement("p");
    note.className = "pretty-corpus-note";
    note.textContent =
      "Formatter time ends at the escaped HTML string. DOM time covers innerHTML parsing, tree replacement, and forced synchronous layout. Frame time covers both plus adapter and measurement overhead; asynchronous paint is excluded.";
    overlay.appendChild(note);

    var selectedIds = prettyDashboardSelectedBackendIds(report.backendIds);
    var controls = document.createElement("div");
    controls.className = "pretty-dashboard-controls";
    var phaseLabel = document.createElement("label");
    phaseLabel.appendChild(document.createTextNode("Timeline metric "));
    var phaseSelector = document.createElement("select");
    [
      { id: "formatterMs", label: "Formatter" },
      { id: "domCommitMs", label: "DOM commit + layout" },
      { id: "frameMs", label: "Total frame" },
    ].forEach(function (phase) {
      var option = document.createElement("option");
      option.value = phase.id;
      option.textContent = phase.label;
      phaseSelector.appendChild(option);
    });
    phaseSelector.value = "frameMs";
    phaseLabel.appendChild(phaseSelector);
    var backendFilter = createPrettyBackendFilter(
      report.backendIds,
      function (id) {
        return report.summaries[id]?.label || id;
      },
      function (ids) {
        selectedIds = ids;
        renderLiveReport();
      },
    );
    controls.append(backendFilter, phaseLabel);
    overlay.appendChild(controls);

    var content = document.createElement("div");
    overlay.appendChild(content);

    function renderLiveReport() {
      content.replaceChildren();
      var metric = phaseSelector.value;
      var metricLabel =
        phaseSelector.options[phaseSelector.selectedIndex]?.textContent ||
        metric;
      var heading = document.createElement("h3");
      heading.textContent = metricLabel + " across frames";
      content.append(
        heading,
        createPrettyLiveTimeline(report, selectedIds, metric, metricLabel),
      );

      var summaryHeading = document.createElement("h3");
      summaryHeading.textContent = "Backend timing summary";
      content.appendChild(summaryHeading);
      var summaryTable = document.createElement("table");
      summaryTable.className = "pretty-live-summary-table";
      var summaryHead = document.createElement("tr");
      [
        "Backend",
        "Formatter median / p95",
        "DOM median / p95",
        "Frame median / p95",
        "Errors",
      ].forEach(function (label) {
        appendCorpusCell(summaryHead, label, "th");
      });
      summaryTable.appendChild(summaryHead);
      selectedIds.forEach(function (id) {
        var summary = report.summaries[id];
        var row = document.createElement("tr");
        row.dataset.prettyBackend = id;
        var backend = appendCorpusCell(row, summary.label);
        backend.style.color = prettyDashboardColor(id);
        appendCorpusCell(
          row,
          formatCorpusTiming(summary.formatterMs.median) +
            " / " +
            formatCorpusTiming(summary.formatterMs.p95) +
            " ms",
        );
        appendCorpusCell(
          row,
          formatCorpusTiming(summary.domCommitMs.median) +
            " / " +
            formatCorpusTiming(summary.domCommitMs.p95) +
            " ms",
        );
        appendCorpusCell(
          row,
          formatCorpusTiming(summary.frameMs.median) +
            " / " +
            formatCorpusTiming(summary.frameMs.p95) +
            " ms",
        );
        appendCorpusCell(row, String(summary.errors?.length || 0));
        summaryTable.appendChild(row);
      });
      content.appendChild(summaryTable);

      var framesHeading = document.createElement("h3");
      framesHeading.textContent = "Frame observations — " + metricLabel;
      content.appendChild(framesHeading);
      var frameTable = document.createElement("table");
      frameTable.className = "pretty-live-frame-table";
      var frameHead = document.createElement("tr");
      ["Frame", "Synthetic workload", "Parity"].forEach(function (label) {
        appendCorpusCell(frameHead, label, "th");
      });
      selectedIds.forEach(function (id) {
        var cell = appendCorpusCell(
          frameHead,
          report.summaries[id]?.label || id,
          "th",
        );
        cell.style.color = prettyDashboardColor(id);
      });
      frameTable.appendChild(frameHead);
      report.frames.forEach(function (frame) {
        var row = document.createElement("tr");
        appendCorpusCell(row, String(frame.frame));
        appendCorpusCell(
          row,
          frame.caseId + " · " + frame.dimension + "=" + frame.size,
        );
        var parity = appendCorpusCell(row, frame.parity ? "pass" : "fail");
        parity.className = "pretty-parity";
        row.className = frame.parity ? "status-pass" : "status-fail";
        selectedIds.forEach(function (id) {
          appendCorpusCell(
            row,
            formatCorpusTiming(frame.backends?.[id]?.[metric]) + " ms",
          );
        });
        frameTable.appendChild(row);
      });
      content.appendChild(frameTable);
    }

    phaseSelector.addEventListener("change", renderLiveReport);
    renderLiveReport();
    document.body.appendChild(overlay);
    prettyCorpusOverlay = overlay;
    closeButton.focus();
  }

  function closePrettyDashboard() {
    if (prettyCorpusOverlay) prettyCorpusOverlay.remove();
    prettyCorpusOverlay = null;
  }

  function resetPrettyDashboard() {
    closePrettyDashboard();
    prettyCampaignReport = null;
    prettyCorpusReport = null;
    prettyScalingReport = null;
    prettyRepeatedReport = null;
    prettyMemoryReport = null;
    prettyInteractionReport = null;
    prettyLiveReport = null;
  }

  /** @param {string} kind */
  function openPrettyDashboardReport(kind) {
    if (kind === "differential" && prettyCorpusReport)
      return showPrettyCorpusReport(prettyCorpusReport);
    if (kind === "scaling" && prettyScalingReport)
      return showPrettyScalingReport(prettyScalingReport);
    if (kind === "memory-retained" && prettyMemoryReport)
      return showPrettyMemoryReport(prettyMemoryReport);
    if (kind === "interactions" && prettyInteractionReport)
      return showPrettyInteractionReport(prettyInteractionReport);
    if (kind === "repeated" && prettyRepeatedReport)
      return showPrettyRepeatedReport(prettyRepeatedReport);
    if (kind === "live-render" && prettyLiveReport)
      return showPrettyLiveReport(prettyLiveReport);
    if (!prettyDashboardHasData())
      throw new Error("no benchmark report is loaded");
    if (
      kind === "dashboard" &&
      prettyLiveReport &&
      !prettyCampaignReport &&
      !prettyCorpusReport &&
      !prettyScalingReport &&
      !prettyRepeatedReport &&
      !prettyMemoryReport &&
      !prettyInteractionReport
    ) {
      return showPrettyLiveReport(prettyLiveReport);
    }
    return showPrettyResultsDashboard();
  }

  window.PrettyBenchDashboard = {
    load: loadPrettyDashboardData,
    hasData: prettyDashboardHasData,
    open: function () {
      openPrettyDashboardReport("dashboard");
    },
    openReport: openPrettyDashboardReport,
    close: closePrettyDashboard,
    reset: resetPrettyDashboard,
    exportData: prettyDashboardExportData,
    download: function () {
      downloadPrettyCorpusReport(prettyDashboardExportData());
    },
  };
})();
