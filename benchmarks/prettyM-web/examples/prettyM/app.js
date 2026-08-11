// @ts-check
(function () {
  "use strict";

  var stateEl = /** @type {HTMLElement} */ (
    document.querySelector("#app-state")
  );
  var progressEl = /** @type {HTMLElement} */ (
    document.querySelector("#app-progress")
  );
  var backendList = /** @type {HTMLElement} */ (
    document.querySelector("#backend-list")
  );
  var reportList = /** @type {HTMLElement} */ (
    document.querySelector("#report-list")
  );
  var studyButtons = Array.from(document.querySelectorAll("[data-study]"));
  var openDashboard = /** @type {HTMLButtonElement} */ (
    document.querySelector("#open-dashboard")
  );
  var downloadResults = /** @type {HTMLButtonElement} */ (
    document.querySelector("#download-results")
  );
  var loadResults = /** @type {HTMLButtonElement} */ (
    document.querySelector("#load-results")
  );
  var loadInput = /** @type {HTMLInputElement} */ (
    document.querySelector("#load-results-input")
  );
  var clearResults = /** @type {HTMLButtonElement} */ (
    document.querySelector("#clear-results")
  );

  /** @type {Record<string, *>} */
  var reports = {};
  var running = false;

  /** @type {Record<string, string>} */
  var backendColors = {
    js: "#74a9ff",
    vir: "#f0a35e",
    "vir-format": "#77c879",
    native: "#d879c6",
    llvm: "#d7c45c",
  };

  /** @type {Record<string, string>} */
  var reportTitles = {
    differential: "Corpus",
    scaling: "Scaling",
    "memory-retained": "Memory",
    interactions: "Interactions",
    repeated: "Repeated calls",
  };

  function setState(label, state, detail) {
    stateEl.textContent = label;
    stateEl.dataset.state = state;
    progressEl.textContent = detail;
  }

  function readNumber(id, minimum, maximum) {
    var input = /** @type {HTMLInputElement} */ (
      document.querySelector("#" + id)
    );
    var value = Number(input.value);
    if (!Number.isFinite(value) || value < minimum || value > maximum) {
      throw new TypeError(
        input.labels && input.labels[0] ? input.labels[0].textContent : id,
      );
    }
    return value;
  }

  function selectedBackendIds() {
    return Array.from(
      backendList.querySelectorAll('input[type="checkbox"]:checked'),
    ).map(function (input) {
      return /** @type {HTMLInputElement} */ (input).value;
    });
  }

  function backendStatus(backend) {
    return typeof backend.status === "function" ? backend.status() : "ready";
  }

  function renderBackends() {
    var previous = new Set(selectedBackendIds());
    var backends = getPrettyBackends();
    backendList.replaceChildren();
    backends.forEach(function (backend) {
      var label = document.createElement("label");
      label.className = "backend-card";
      label.dataset.backend = backend.id;
      label.style.setProperty(
        "--backend-color",
        backendColors[backend.id] || "#86b5e8",
      );
      var input = document.createElement("input");
      input.type = "checkbox";
      input.value = backend.id;
      input.checked = previous.size === 0 || previous.has(backend.id);
      var text = document.createElement("span");
      var name = document.createElement("strong");
      name.textContent = backend.label;
      var id = document.createElement("code");
      id.textContent = backend.id;
      var capability = document.createElement("small");
      capability.textContent = backend.capabilities
        ? backend.capabilities.output + " · " + backend.capabilities.width
        : "custom contract";
      var status = document.createElement("em");
      var value = backendStatus(backend);
      status.textContent = value;
      status.dataset.state = value;
      text.append(name, id, capability);
      label.append(input, text, status);
      backendList.appendChild(label);
    });
  }

  function setRunning(value) {
    running = value;
    studyButtons.forEach(function (button) {
      /** @type {HTMLButtonElement} */ (button).disabled = value;
    });
    backendList.querySelectorAll("input").forEach(function (input) {
      /** @type {HTMLInputElement} */ (input).disabled = value;
    });
  }

  function onProgress(prefix) {
    return function (item) {
      var detail = item.caseId || item.dimension || "benchmark";
      progressEl.textContent =
        prefix + " · " + item.completed + "/" + item.total + " · " + detail;
    };
  }

  function studySelection(kind, options) {
    if (options && (options.test || options.benchmark)) return options;
    var variant = globalThis.__benchmarkExampleContext
      ? globalThis.__benchmarkExampleContext.variant
      : null;
    if (!variant) return options || {};
    var test = (variant.tests || []).find(function (candidate) {
      return candidate.study === kind;
    });
    if (test) return { test: test };
    if (variant.benchmark && variant.benchmark.study === kind) {
      return { benchmark: variant.benchmark };
    }
    return options || {};
  }

  function baseOptions(prefix, options) {
    var backendIds =
      options && options.test && Array.isArray(options.test.backends)
        ? options.test.backends.slice()
        : selectedBackendIds();
    if (backendIds.length === 0) throw new Error("select at least one backend");
    return {
      backendIds: backendIds,
      warmup: readNumber("warmup", 0, 100),
      samples: readNumber("samples", 1, 1000),
      batchTargetMs: readNumber("batch-target", 0, 1000),
      maxBatchIterations: 512,
      onProgress: onProgress(prefix),
    };
  }

  async function executeStudy(kind, suppliedOptions) {
    var options = studySelection(kind, suppliedOptions);
    if (kind === "smoke") {
      var scenarios =
        options.test &&
        options.test.data &&
        Array.isArray(options.test.data.scenarios)
          ? options.test.data.scenarios
          : null;
      return runPrettyDifferentialCorpus({
        backendIds:
          options.test && Array.isArray(options.test.backends)
            ? options.test.backends.slice()
            : selectedBackendIds(),
        warmup: 0,
        samples: 1,
        batchTargetMs: 0,
        maxBatchIterations: 1,
        profile: true,
        scenarios: scenarios,
        onProgress: onProgress("Quick check"),
      });
    }
    if (kind === "differential") {
      return runPrettyDifferentialCorpus(baseOptions("Corpus", options));
    }
    if (kind === "scaling") {
      return runPrettyScalingStudy(baseOptions("Scaling", options));
    }
    if (kind === "memory-retained") {
      return runPrettyMemoryScalingStudy(baseOptions("Memory", options));
    }
    if (kind === "interactions") {
      return runPrettyInteractionStudy(baseOptions("Interactions", options));
    }
    if (kind === "repeated") {
      var repeatedOptions = baseOptions("Repeated calls", options);
      repeatedOptions.cycles = readNumber("repeat-cycles", 1, 10000);
      return runPrettyRepeatedCallStudy(repeatedOptions);
    }
    throw new Error("unknown benchmark study " + kind);
  }

  function reportKey(report) {
    return report.kind === "differential" ? "differential" : report.kind;
  }

  function reportSummary(report) {
    if (
      typeof report.parityCount === "number" &&
      typeof report.scenarioCount === "number"
    ) {
      return report.parityCount + "/" + report.scenarioCount + " points agree";
    }
    if (
      typeof report.parityCount === "number" &&
      typeof report.pointCount === "number"
    ) {
      return report.parityCount + "/" + report.pointCount + " points agree";
    }
    if (typeof report.totalBackendCalls === "number") {
      return report.totalBackendCalls + " backend calls";
    }
    return report.passed === false ? "Study failed" : "Report loaded";
  }

  function recordExampleSelection(report, options) {
    var context = globalThis.__benchmarkExampleContext;
    if (!context) return report;
    report.examplePackage = {
      example: context.example.id,
      variant: context.variant.id,
      testPackage: context.testPackageIdentity,
      test: options && options.test ? options.test.id : null,
      benchmark:
        options && options.benchmark ? options.benchmark.study : null,
    };
    return report;
  }

  function renderReports() {
    reportList.replaceChildren();
    var entries = Object.entries(reports);
    if (entries.length === 0) {
      var empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No benchmark has run yet.";
      reportList.appendChild(empty);
    }
    entries.forEach(function (entry) {
      var kind = entry[0];
      var report = entry[1];
      var card = document.createElement("article");
      card.className = "report-card";
      card.dataset.passed = String(report.passed !== false);
      var heading = document.createElement("h3");
      heading.textContent = reportTitles[kind] || kind;
      var summary = document.createElement("strong");
      summary.textContent = reportSummary(report);
      var detail = document.createElement("p");
      detail.textContent =
        typeof report.durationMs === "number"
          ? report.durationMs.toFixed(1) + " ms report duration"
          : report.generatedAt || report.startedAt || "Imported report";
      var open = document.createElement("button");
      open.type = "button";
      open.textContent = "View report";
      open.addEventListener("click", function () {
        PrettyBenchDashboard.openReport(kind);
      });
      card.append(heading, summary, detail, open);
      reportList.appendChild(card);
    });
    var hasData = PrettyBenchDashboard.hasData();
    openDashboard.disabled = !hasData;
    downloadResults.disabled = !hasData;
    clearResults.disabled = !hasData;
  }

  function storeReport(report) {
    reports[reportKey(report)] = report;
    PrettyBenchDashboard.load(report);
    renderReports();
  }

  async function runSuite(options) {
    var studies =
      options &&
      options.benchmark &&
      options.benchmark.data &&
      Array.isArray(options.benchmark.data.studies)
        ? options.benchmark.data.studies
        : [
            "differential",
            "scaling",
            "memory-retained",
            "interactions",
            "repeated",
          ];
    var reportsByStudy = {};
    for (var index = 0; index < studies.length; index++) {
      var study = studies[index];
      reportsByStudy[study] = await executeStudy(study);
      storeReport(reportsByStudy[study]);
    }
    var corpus = reportsByStudy.differential;
    var scaling = reportsByStudy.scaling;
    var memory = reportsByStudy["memory-retained"];
    var interactions = reportsByStudy.interactions;
    var repeated = reportsByStudy.repeated;
    if (!corpus || !scaling || !memory || !interactions || !repeated) {
      throw new Error("benchmark suite omits a required prettyM study");
    }
    corpus.scaling = scaling;
    corpus.memory = memory;
    corpus.interactions = interactions;
    corpus.repeated = repeated;
    corpus.passed = [corpus, scaling, memory, interactions, repeated].every(
      function (report) {
        return report.passed;
      },
    );
    PrettyBenchDashboard.load(corpus);
    return corpus;
  }

  async function runStudy(kind, suppliedOptions) {
    if (running) throw new Error("a benchmark is already running");
    setRunning(true);
    setState(
      "Running",
      "running",
      kind === "suite" ? "Starting full suite…" : kind,
    );
    try {
      var options = studySelection(kind, suppliedOptions);
      var report =
        kind === "suite"
          ? await runSuite(options)
          : await executeStudy(kind, options);
      recordExampleSelection(report, options);
      if (kind !== "suite") storeReport(report);
      setState(
        report.passed === false ? "Mismatch" : "Complete",
        report.passed === false ? "failed" : "ready",
        reportSummary(report),
      );
      return report;
    } catch (error) {
      setState(
        "Failed",
        "failed",
        error instanceof Error ? error.message : String(error),
      );
      throw error;
    } finally {
      setRunning(false);
      renderBackends();
    }
  }

  studyButtons.forEach(function (button) {
    button.addEventListener("click", function () {
      runStudy(
        /** @type {HTMLElement} */ (button).dataset.study || "smoke",
      ).catch(function (error) {
        console.error(error);
      });
    });
  });

  openDashboard.addEventListener("click", function () {
    PrettyBenchDashboard.open();
  });
  downloadResults.addEventListener("click", function () {
    PrettyBenchDashboard.download();
  });
  loadResults.addEventListener("click", function () {
    loadInput.click();
  });
  loadInput.addEventListener("change", function () {
    var file = loadInput.files && loadInput.files[0];
    if (!file) return;
    file
      .text()
      .then(function (body) {
        var data = JSON.parse(body);
        PrettyBenchDashboard.load(data);
        if (data.kind === "pretty-results-dashboard" && data.reports) {
          reports = Object.assign({}, data.reports);
        } else if (data.kind !== "pretty-benchmark-campaign") {
          reports[reportKey(data)] = data;
        }
        renderReports();
        setState("Loaded", "ready", file.name);
      })
      .catch(function (error) {
        setState(
          "Failed",
          "failed",
          error instanceof Error ? error.message : String(error),
        );
      });
  });
  clearResults.addEventListener("click", function () {
    reports = {};
    PrettyBenchDashboard.reset();
    renderReports();
    setState("Ready", "ready", "Reports cleared");
  });

  async function boot() {
    renderBackends();
    var backends = getPrettyBackends();
    await Promise.all(
      backends.map(function (backend) {
        return backend.ready && typeof backend.ready.then === "function"
          ? Promise.resolve(backend.ready).catch(function () {
              return null;
            })
          : Promise.resolve();
      }),
    );
    renderBackends();
    var readyCount = backends.filter(function (backend) {
      return backendStatus(backend) === "ready";
    }).length;
    setState(
      readyCount === backends.length ? "Ready" : "Degraded",
      readyCount === backends.length ? "ready" : "failed",
      readyCount + "/" + backends.length + " backends available",
    );
    return { readyCount: readyCount, backendCount: backends.length };
  }

  var api = {
    ready: /** @type {Promise<*> | null} */ (null),
    runStudy: runStudy,
    getReports: function () {
      return Object.assign({}, reports);
    },
    getBackends: function () {
      return getPrettyBackends().map(function (backend) {
        return {
          id: backend.id,
          label: backend.label,
          status: backendStatus(backend),
        };
      });
    },
  };
  window.__prettyBenchApp = api;
  api.ready = boot();
})();
