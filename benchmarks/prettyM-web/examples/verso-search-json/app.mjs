// @ts-check

const appRoot = new URL("../../", import.meta.url);
const lanes = {
  default: {
    id: "owned",
    label: "Lean · owned structural JSON",
    package: "owned.irpkg",
    entry: "Vir.Benchmarks.VersoSearchJson.mapOwnedAll",
    borrowed: false,
  },
  borrowed: {
    id: "borrowed",
    label: "Lean · borrowed JSON handles",
    package: "borrowed.irpkg",
    entry: "Vir.Benchmarks.VersoSearchJson.mapBorrowedAll",
    borrowed: true,
  },
};
const backendColors = {
  js: "#74a9ff",
  owned: "#77c879",
  borrowed: "#f0a35e",
};
const timingPhases = ["lowerMs", "executeMs", "liftMs", "hostMs", "totalMs"];

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function element(id) {
  const value = document.querySelector(`#${id}`);
  if (!(value instanceof HTMLElement)) throw new Error(`missing #${id}`);
  return value;
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

async function fetchVerified(path, expectedSha256, label) {
  const url = new URL(path, appRoot);
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`${label} failed to load: HTTP ${response.status}`);
  }
  const bytes = await response.arrayBuffer();
  const actualSha256 = await sha256(bytes);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `${label} hash mismatch: expected ${expectedSha256}, got ${actualSha256}`,
    );
  }
  return { bytes };
}

function mapXref(xref, domainMappers, domainIds) {
  return Object.fromEntries(
    domainIds.map((domainId) => [
      domainId,
      domainMappers[domainId].dataToSearchables(xref[domainId]),
    ]),
  );
}

async function loadFixture(specification) {
  const [xrefFile, mapperFile] = await Promise.all([
    fetchVerified(
      specification.xref,
      specification.xrefSha256,
      `${specification.id} xref`,
    ),
    fetchVerified(
      specification.mapper,
      specification.mapperSha256,
      `${specification.id} mapper`,
    ),
  ]);
  const xref = JSON.parse(new TextDecoder().decode(xrefFile.bytes));
  const mapperUrl = URL.createObjectURL(
    new Blob([mapperFile.bytes], { type: "text/javascript" }),
  );
  let mapperModule;
  try {
    mapperModule = await import(mapperUrl);
  } finally {
    URL.revokeObjectURL(mapperUrl);
  }
  const domainMappers = mapperModule.domainMappers;
  if (!domainMappers || typeof domainMappers !== "object") {
    throw new Error(`${specification.id} does not export domainMappers`);
  }
  const domainIds = Object.keys(xref).filter(
    (domainId) => domainMappers[domainId] !== undefined,
  );
  if (JSON.stringify(domainIds) !== JSON.stringify(specification.domains)) {
    throw new Error(`${specification.id} domain order does not match tests.json`);
  }
  const expected = mapXref(xref, domainMappers, domainIds);
  const expectedText = JSON.stringify(expected);
  const searchables = Object.values(expected).reduce(
    (sum, values) => sum + values.length,
    0,
  );
  if (searchables !== specification.searchables) {
    throw new Error(
      `${specification.id} expected ${specification.searchables} searchables, got ${searchables}`,
    );
  }
  return {
    ...specification,
    xref,
    domainMappers,
    domainIds,
    inputBytes: xrefFile.bytes.byteLength,
    expectedText,
    expectedBytes: new TextEncoder().encode(expectedText).byteLength,
    expectedSha256: await sha256(new TextEncoder().encode(expectedText)),
  };
}

function outputCount(value) {
  return Object.values(value).reduce((sum, values) => sum + values.length, 0);
}

function assertBorrowedIdentity(fixture, value) {
  for (const domainId of fixture.domainIds) {
    if (domainId === "Verso.Genre.Manual.example") continue;
    const inputEntries = Object.entries(fixture.xref[domainId].contents);
    for (let index = 0; index < inputEntries.length; index += 1) {
      const inputRef = inputEntries[index][1];
      const expectedRef =
        domainId === "Verso.Genre.Manual.doc.suggestion"
          ? inputRef[0].data.suggestedRedirect
          : inputRef;
      if (value[domainId][index].ref !== expectedRef) {
        throw new Error(
          `${fixture.id}/${domainId} borrowed ref ${index} lost JavaScript identity`,
        );
      }
    }
  }
}

function assertEquivalent(fixture, value, borrowed) {
  const domains = Object.keys(value);
  if (JSON.stringify(domains) !== JSON.stringify(fixture.domainIds)) {
    throw new Error(`${fixture.id} output domain order changed`);
  }
  const actualText = JSON.stringify(value);
  if (actualText !== fixture.expectedText) {
    throw new Error(`${fixture.id} output differs from the generated mapper`);
  }
  if (outputCount(value) !== fixture.searchables) {
    throw new Error(`${fixture.id} output searchable count changed`);
  }
  if (borrowed) assertBorrowedIdentity(fixture, value);
}

function wasmPages(runtime) {
  const bytes = runtime?.exports?.memory?.buffer?.byteLength;
  return typeof bytes === "number" ? bytes / 65536 : null;
}

function quantile(values, fraction) {
  if (values.length === 0) return 0;
  const ordered = values.slice().sort((left, right) => left - right);
  return ordered[Math.floor((ordered.length - 1) * fraction)];
}

function distribution(values) {
  const median = quantile(values, 0.5);
  return {
    mean:
      values.length === 0
        ? 0
        : values.reduce((sum, value) => sum + value, 0) / values.length,
    median,
    mad: quantile(
      values.map((value) => Math.abs(value - median)),
      0.5,
    ),
    p95: quantile(values, 0.95),
    minimum: values.length === 0 ? 0 : Math.min(...values),
    maximum: values.length === 0 ? 0 : Math.max(...values),
    samples: values.length,
  };
}

function summarize(samples) {
  return Object.fromEntries(
    timingPhases.map((phase) => [
      phase,
      distribution(samples.map((sample) => Number(sample[phase] ?? 0))),
    ]),
  );
}

function fixtureSpecifications(context) {
  const test = context.variant.tests?.find(
    (candidate) => candidate.study === "smoke",
  );
  const specifications = test?.data?.fixtures;
  if (!Array.isArray(specifications) || specifications.length === 0) {
    throw new Error("Verso JSON variant has no fixture specifications");
  }
  return specifications;
}

function selectionFor(context, studyId, supplied) {
  if (supplied?.test || supplied?.benchmark) return supplied;
  const test = context.variant.tests?.find(
    (candidate) => candidate.study === studyId,
  );
  if (test) return { test };
  if (context.variant.benchmark?.study === studyId) {
    return { benchmark: context.variant.benchmark };
  }
  return {};
}

function readCount(id, fallback, minimum, maximum) {
  const input = document.querySelector(`#${id}`);
  if (!(input instanceof HTMLInputElement)) return fallback;
  const value = Number(input.value);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${id} must be between ${minimum} and ${maximum}`);
  }
  return value;
}

export function createController(context) {
  const lane = lanes[context.variant.id];
  if (!lane) {
    throw new Error(`unsupported Verso JSON variant ${context.variant.id}`);
  }

  const state = element("app-state");
  const progress = element("app-progress");
  const backendList = element("backend-list");
  const reportList = element("report-list");
  const openReport = /** @type {HTMLButtonElement} */ (
    element("open-dashboard")
  );
  const downloadReport = /** @type {HTMLButtonElement} */ (
    element("download-results")
  );
  const loadReport = /** @type {HTMLButtonElement} */ (element("load-results"));
  const loadInput = /** @type {HTMLInputElement} */ (
    element("load-results-input")
  );
  const clearReport = /** @type {HTMLButtonElement} */ (
    element("clear-results")
  );
  const studyButtons = Array.from(document.querySelectorAll("[data-study]"));
  const backends = [
    { id: "js", label: "Generated JavaScript mapper", status: "loading" },
    { id: lane.id, label: lane.label, status: "loading" },
  ];
  const listeners = [];
  let fixtureMap = new Map();
  let vir = null;
  let latestReport = null;
  let latestDetails = null;
  let running = false;
  let disposed = false;
  let loadError = null;

  function listen(target, name, callback) {
    target.addEventListener(name, callback);
    listeners.push(() => target.removeEventListener(name, callback));
  }

  function setState(label, tone, detail) {
    state.textContent = label;
    state.dataset.state = tone;
    progress.textContent = detail;
  }

  function selectedBackendIds() {
    return Array.from(
      backendList.querySelectorAll('input[type="checkbox"]:checked'),
    ).map((input) => /** @type {HTMLInputElement} */ (input).value);
  }

  function renderBackends() {
    const selected = new Set(selectedBackendIds());
    backendList.replaceChildren();
    for (const backend of backends) {
      const card = document.createElement("label");
      card.className = "backend-card";
      card.dataset.backend = backend.id;
      card.style.setProperty(
        "--backend-color",
        backendColors[backend.id] ?? "#86b5e8",
      );
      const input = document.createElement("input");
      input.type = "checkbox";
      input.value = backend.id;
      input.checked = selected.size === 0 || selected.has(backend.id);
      input.disabled = running || backend.status !== "ready";
      const body = document.createElement("span");
      const title = document.createElement("strong");
      title.textContent = backend.label;
      const id = document.createElement("code");
      id.textContent = backend.id;
      const capability = document.createElement("small");
      capability.textContent =
        "xref domains → ordered searchables with opaque refs";
      const status = document.createElement("em");
      status.textContent = backend.status;
      status.dataset.state = backend.status;
      body.append(title, id, capability);
      card.append(input, body, status);
      backendList.appendChild(card);
    }
  }

  function setRunning(value) {
    running = value;
    for (const button of studyButtons) {
      /** @type {HTMLButtonElement} */ (button).disabled = value;
    }
    for (const input of backendList.querySelectorAll("input")) {
      /** @type {HTMLInputElement} */ (input).disabled = value;
    }
  }

  function renderReport(report) {
    latestReport = report;
    reportList.replaceChildren();
    const card = document.createElement("article");
    card.className = "report-card";
    card.dataset.passed = String(report.passed !== false);
    const heading = document.createElement("h3");
    heading.textContent =
      report.study === "benchmark" ? "Measured replay" : "Quick parity";
    const summary = document.createElement("strong");
    summary.textContent = report.passed
      ? `${report.fixtureCount} fixtures · ${report.searchables} searchables · exact parity`
      : "Study failed";
    const detail = document.createElement("p");
    detail.textContent =
      `${report.protocol.measuredCalls} measured calls · ` +
      `${report.durationMs.toFixed(1)} ms report duration`;
    const disclosure = document.createElement("details");
    const label = document.createElement("summary");
    label.textContent = "View report";
    const body = document.createElement("pre");
    body.textContent = JSON.stringify(report, null, 2);
    disclosure.append(label, body);
    card.append(heading, summary, detail, disclosure);
    reportList.appendChild(card);
    latestDetails = disclosure;
    openReport.disabled = false;
    downloadReport.disabled = false;
    clearReport.disabled = false;
  }

  async function loadFixtures() {
    const loaded = await Promise.all(
      fixtureSpecifications(context).map(loadFixture),
    );
    fixtureMap = new Map(loaded.map((fixture) => [fixture.id, fixture]));
    backends[0].status = "ready";
  }

  async function loadVir() {
    const runtimeUrl = new URL("lean-vir/js/vir-runtime.js", context.artifactBaseUrl);
    const wasmUrl = new URL(
      "lean-vir/wasm/vir-upstream.wasm",
      context.artifactBaseUrl,
    );
    const packageUrl = new URL(lane.package, context.artifactBaseUrl);
    const runtimeModule = await import(runtimeUrl.href);
    if (
      typeof runtimeModule.createVirRuntime !== "function" ||
      typeof runtimeModule.fetchBytes !== "function" ||
      typeof runtimeModule.releaseHostResource !== "function"
    ) {
      throw new Error("staged VIR runtime omits the JSON-lane browser API");
    }
    const packageBytes = await runtimeModule.fetchBytes(packageUrl, {
      cache: "no-store",
    });
    const runtime = await runtimeModule.createVirRuntime({
      wasmUrl,
      irPackageSetBytes: [packageBytes],
      fetchBytes: (path) => runtimeModule.fetchBytes(path, { cache: "no-store" }),
    });
    vir = {
      runtime,
      releaseHostResource: runtimeModule.releaseHostResource,
      packageBytes: packageBytes.byteLength,
      loadedPages: wasmPages(runtime),
    };
    backends[1].status = "ready";
  }

  const ready = Promise.allSettled([loadFixtures(), loadVir()]).then(
    (results) => {
      const failures = results.filter((result) => result.status === "rejected");
      if (failures.length > 0) {
        loadError = failures
          .map((result) => errorMessage(result.reason))
          .join("; ");
        if (results[0].status === "rejected") {
          backends[0].status = "failed";
          backends[1].status = "failed";
        }
        if (results[1].status === "rejected") backends[1].status = "failed";
      }
      renderBackends();
      const readyCount = backends.filter(
        (backend) => backend.status === "ready",
      ).length;
      setState(
        readyCount === backends.length ? "Ready" : "Degraded",
        readyCount === backends.length ? "ready" : "failed",
        readyCount === backends.length
          ? `${fixtureMap.size} fixtures · ${readyCount}/${backends.length} backends available`
          : loadError,
      );
      return { readyCount, backendCount: backends.length };
    },
  );

  function invokeJs(fixture) {
    const started = performance.now();
    const value = mapXref(
      fixture.xref,
      fixture.domainMappers,
      fixture.domainIds,
    );
    const elapsed = performance.now() - started;
    assertEquivalent(fixture, value, false);
    return {
      lowerMs: 0,
      executeMs: elapsed,
      liftMs: 0,
      hostMs: 0,
      totalMs: elapsed,
    };
  }

  function invokeVir(fixture) {
    if (!vir) throw new Error("VIR backend is not ready");
    if (!lane.borrowed) {
      const timed = vir.runtime.callTimed(lane.entry, fixture.xref);
      assertEquivalent(fixture, timed.value, false);
      return {
        lowerMs: timed.timings.marshalMs,
        executeMs: timed.timings.executeMs,
        liftMs: timed.timings.decodeMs,
        hostMs: timed.timings.hostMs,
        totalMs: timed.timings.totalMs,
      };
    }

    const started = performance.now();
    const lowerStarted = performance.now();
    let inputHandle;
    let outputHandle;
    try {
      inputHandle = vir.runtime.borrowJson(fixture.xref);
      const borrowMs = performance.now() - lowerStarted;
      const timed = vir.runtime.callTimed(lane.entry, inputHandle);
      outputHandle = timed.value;
      const liftStarted = performance.now();
      const value = vir.runtime.jsonValue(outputHandle);
      const unwrapMs = performance.now() - liftStarted;
      assertEquivalent(fixture, value, true);
      return {
        lowerMs: borrowMs + timed.timings.marshalMs,
        executeMs: timed.timings.executeMs,
        liftMs: timed.timings.decodeMs + unwrapMs,
        hostMs: timed.timings.hostMs,
        totalMs: performance.now() - started,
      };
    } finally {
      if (outputHandle !== undefined) vir.releaseHostResource(outputHandle);
      if (inputHandle !== undefined) vir.releaseHostResource(inputHandle);
    }
  }

  function invoke(backendId, fixture) {
    if (backendId === "js") return invokeJs(fixture);
    if (backendId === lane.id) return invokeVir(fixture);
    throw new Error(`unknown Verso JSON backend ${backendId}`);
  }

  function selectedFixtures(selection) {
    const ids = selection.test
      ? selection.test.data.fixtures.map((fixture) => fixture.id)
      : selection.benchmark?.data?.fixtures;
    if (!Array.isArray(ids) || ids.length === 0) {
      throw new Error("study does not select any Verso JSON fixtures");
    }
    return ids.map((id) => {
      const fixture = fixtureMap.get(id);
      if (!fixture) throw new Error(`unknown Verso JSON fixture ${id}`);
      return fixture;
    });
  }

  function reportSelection(report, selection) {
    report.examplePackage = {
      example: context.example.id,
      variant: context.variant.id,
      testPackage: context.testPackageIdentity,
      test: selection.test?.id ?? null,
      benchmark: selection.benchmark?.study ?? null,
    };
    return report;
  }

  async function executeStudy(studyId, selection) {
    const fixtures = selectedFixtures(selection);
    const backendIds = selection.test
      ? selection.test.backends.slice()
      : selectedBackendIds();
    if (backendIds.length < 2) {
      throw new Error("select JavaScript and the VIR lane before benchmarking");
    }
    for (const backendId of backendIds) {
      const backend = backends.find((candidate) => candidate.id === backendId);
      if (backend?.status !== "ready") {
        throw new Error(`backend ${backendId} is not ready`);
      }
    }
    const benchmarkData = selection.benchmark?.data ?? {};
    const warmups =
      studyId === "smoke"
        ? 0
        : readCount("warmup", benchmarkData.warmups ?? 5, 0, 20);
    const samples =
      studyId === "smoke"
        ? 1
        : readCount("samples", benchmarkData.samples ?? 30, 1, 100);
    const observed = new Map(
      fixtures.map((fixture) => [
        fixture.id,
        new Map(backendIds.map((backendId) => [backendId, []])),
      ]),
    );
    const started = performance.now();
    const rounds = warmups + samples;
    for (let round = 0; round < rounds; round += 1) {
      for (let fixtureIndex = 0; fixtureIndex < fixtures.length; fixtureIndex += 1) {
        const fixture = fixtures[fixtureIndex];
        const order =
          (round + fixtureIndex) % 2 === 0
            ? backendIds
            : backendIds.slice().reverse();
        for (const backendId of order) {
          progress.textContent =
            `${round < warmups ? "Warm-up" : "Measure"} ${round + 1}/${rounds} · ` +
            `${fixture.id} · ${backendId}`;
          const timing = invoke(backendId, fixture);
          if (round >= warmups) {
            observed.get(fixture.id).get(backendId).push(timing);
          }
        }
      }
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    const durationMs = performance.now() - started;
    const fixtureReports = fixtures.map((fixture) => ({
      id: fixture.id,
      title: fixture.title,
      domains: fixture.domainIds,
      searchables: fixture.searchables,
      inputBytes: fixture.inputBytes,
      outputBytes: fixture.expectedBytes,
      outputSha256: fixture.expectedSha256,
      timings: Object.fromEntries(
        backendIds.map((backendId) => [
          backendId,
          summarize(observed.get(fixture.id).get(backendId)),
        ]),
      ),
    }));
    return {
      schemaVersion: 1,
      kind: "verso-search-json/report",
      study: studyId,
      generatedAt: new Date().toISOString(),
      passed: true,
      lane: lane.id,
      backendIds,
      fixtureCount: fixtures.length,
      searchables: fixtures.reduce(
        (sum, fixture) => sum + fixture.searchables,
        0,
      ),
      protocol: {
        warmups,
        samples,
        measuredCalls: samples * fixtures.length * backendIds.length,
        ordering: "alternating",
      },
      durationMs,
      package: {
        file: lane.package,
        bytes: vir?.packageBytes ?? null,
        declarations: vir?.runtime?.packageInfo?.count ?? null,
        pages: {
          loaded: vir?.loadedPages ?? null,
          final: vir ? wasmPages(vir.runtime) : null,
        },
      },
      fixtures: fixtureReports,
    };
  }

  async function runStudy(studyId, supplied = {}) {
    if (disposed) throw new Error("Verso JSON controller is disposed");
    if (running) throw new Error("a Verso JSON study is already running");
    const readiness = await ready;
    if (readiness.readyCount !== readiness.backendCount) {
      throw new Error(loadError ?? "Verso JSON backends are not ready");
    }
    const selection = selectionFor(context, studyId, supplied);
    if (!selection.test && !selection.benchmark) {
      throw new Error(`unknown Verso JSON study ${studyId}`);
    }
    setRunning(true);
    setState(
      "Running",
      "running",
      studyId === "smoke" ? "Checking exact parity…" : "Starting measured replay…",
    );
    try {
      const report = reportSelection(
        await executeStudy(studyId, selection),
        selection,
      );
      renderReport(report);
      setState(
        "Complete",
        "ready",
        `${report.searchables} searchables · exact output and order`,
      );
      return report;
    } catch (error) {
      setState("Failed", "failed", errorMessage(error));
      throw error;
    } finally {
      setRunning(false);
      renderBackends();
    }
  }

  for (const button of studyButtons) {
    listen(button, "click", () => {
      runStudy(/** @type {HTMLElement} */ (button).dataset.study ?? "smoke").catch(
        console.error,
      );
    });
  }
  listen(openReport, "click", () => {
    if (latestDetails) latestDetails.open = true;
    reportList.scrollIntoView({ behavior: "smooth", block: "start" });
  });
  listen(downloadReport, "click", () => {
    if (!latestReport) return;
    const url = URL.createObjectURL(
      new Blob([`${JSON.stringify(latestReport, null, 2)}\n`], {
        type: "application/json",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download =
      `verso-search-json-${context.variant.id}-${latestReport.study}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  });
  listen(loadReport, "click", () => loadInput.click());
  listen(loadInput, "change", () => {
    const file = loadInput.files?.[0];
    if (!file) return;
    file
      .text()
      .then((body) => {
        const report = JSON.parse(body);
        if (report?.kind !== "verso-search-json/report") {
          throw new Error("selected file is not a Verso JSON report");
        }
        renderReport(report);
        setState("Loaded", "ready", file.name);
      })
      .catch((error) => setState("Failed", "failed", errorMessage(error)));
  });
  listen(clearReport, "click", () => {
    latestReport = null;
    latestDetails = null;
    reportList.replaceChildren();
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No Verso JSON-lane study has run yet.";
    reportList.appendChild(empty);
    openReport.disabled = true;
    downloadReport.disabled = true;
    clearReport.disabled = true;
    setState("Ready", "ready", "Report cleared");
  });

  renderBackends();
  setState("Loading", "loading", "Verifying fixture and artifact identities…");

  return {
    ready,
    getBackends: () =>
      backends.map(({ id, label, status }) => ({ id, label, status })),
    runStudy,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const remove of listeners.splice(0)) remove();
      vir?.runtime?.dispose();
    },
  };
}
