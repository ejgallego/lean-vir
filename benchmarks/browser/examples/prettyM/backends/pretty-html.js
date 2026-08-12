// @ts-check
/* Complete PrettyM HTML candidates and their differential study. */
(function () {
  "use strict";

  function taggedAnnotationsForRuntime(annotations) {
    return Object.keys(annotations)
      .map(Number)
      .filter(function (tag) {
        return Number.isSafeInteger(tag) && tag >= 0;
      })
      .sort(function (left, right) {
        return left - right;
      })
      .map(function (tag) {
        var annotation = annotations[String(tag)];
        return {
          tag: tag,
          annotation: {
            cssClass: annotation.cssClass,
            binding:
              annotation.binding === undefined ? null : annotation.binding,
          },
        };
      });
  }

  function annotationsForFormat(format) {
    var tags = new Set();
    var stack = [format];
    while (stack.length > 0) {
      var value = stack.pop();
      if (!Array.isArray(value)) continue;
      if (value[0] === 7) {
        tags.add(Number(value[1]));
        stack.push(value[2]);
      } else if (value[0] === 3 || value[0] === 5 || value[0] === 6) {
        stack.push(value[value[0] === 3 ? 2 : 1]);
      } else if (value[0] === 4) {
        stack.push(value[1], value[2]);
      }
    }
    var result = {};
    Array.from(tags)
      .sort(function (left, right) {
        return left - right;
      })
      .forEach(function (tag) {
        result[String(tag)] = {
          cssClass: ["keyword", "const", "literal string"][Math.abs(tag) % 3],
          binding: tag % 5 === 0 ? "#tag-" + tag + '&scope="pretty"' : null,
        };
      });
    return result;
  }

  function escapeHtml(value) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function segmentsToHtml(segments, annotations) {
    return segments
      .map(function (segment) {
        var annotation = null;
        for (var index = segment.tags.length - 1; index >= 0; index--) {
          annotation = annotations[String(segment.tags[index])] || null;
          if (annotation) break;
        }
        var text = escapeHtml(segment.text);
        if (!annotation) return text;
        var binding =
          annotation.binding === null || annotation.binding === undefined
            ? ""
            : ' data-binding="' + escapeHtml(annotation.binding) + '"';
        return (
          '<span class="' +
          escapeHtml(annotation.cssClass + " token") +
          '"' +
          binding +
          ">" +
          text +
          "</span>"
        );
      })
      .join("");
  }

  function formatHtmlWithJsTimed(fmtJson, annotations, pixelWidth, measurer) {
    var started = performance.now();
    var fmt = deserializeFormat(fmtJson);
    var context = makeRenderContext(annotations, measurer);
    var marshaled = performance.now();
    prettyM(fmt, pixelWidth, 0, context, measurer);
    var html = segmentsToHtml(context.segments, annotations);
    var executed = performance.now();
    return {
      html: html,
      timings: prettyPhaseTimings(started, marshaled, executed, executed),
    };
  }

  function composeVirTimings(started, marshaled, executed, decoded, runtime) {
    if (!runtime)
      return prettyPhaseTimings(started, marshaled, executed, decoded);
    var keys = ["marshalMs", "executeMs", "decodeMs", "hostMs", "totalMs"];
    if (
      keys.some(function (key) {
        return !Number.isFinite(runtime[key]) || runtime[key] < 0;
      })
    ) {
      throw new Error("VIR timed call returned invalid phase data");
    }
    var adapterInputMs = marshaled - started;
    var adapterOutputMs = decoded - executed;
    return {
      marshalMs: adapterInputMs + runtime.marshalMs,
      executeMs: runtime.executeMs,
      decodeMs: runtime.decodeMs + adapterOutputMs,
      renderMs: 0,
      totalMs: decoded - started,
      adapterInputMs: adapterInputMs,
      adapterOutputMs: adapterOutputMs,
      runtimeMarshalMs: runtime.marshalMs,
      runtimeDecodeMs: runtime.decodeMs,
      runtimeTotalMs: runtime.totalMs,
      hostMs: runtime.hostMs,
    };
  }

  function formatHtmlWithVirTimed(fmtJson, annotations, pixelWidth, measurer) {
    var started = performance.now();
    var marshaled = started;
    var executed = started;
    var bridge = window.__prettyBenchVir;
    if (!bridge || bridge.status !== "ready") {
      return { html: null, timings: emptyPrettyTimings() };
    }
    try {
      var format = compactFormatToStdFormat(fmtJson);
      var tagged = taggedAnnotationsForRuntime(annotations);
      var width = pixelWidthToFormatColumns(pixelWidth, measurer);
      marshaled = performance.now();
      var html;
      var runtimeTimings = null;
      if (typeof bridge.formatHtmlTimed === "function") {
        var timed = bridge.formatHtmlTimed(format, tagged, width, 0);
        html = timed.value;
        runtimeTimings = timed.timings;
      } else if (typeof bridge.formatHtml === "function") {
        html = bridge.formatHtml(format, tagged, width, 0);
      }
      executed = performance.now();
      if (typeof html !== "string") throw new Error("invalid VIR HTML output");
      var decoded = performance.now();
      return {
        html: html,
        timings: composeVirTimings(
          started,
          marshaled,
          executed,
          decoded,
          runtimeTimings,
        ),
      };
    } catch (error) {
      var failed = performance.now();
      return {
        html: null,
        error: error instanceof Error ? error.message : String(error),
        timings: prettyPhaseTimings(
          started,
          marshaled,
          executed === started ? failed : executed,
          failed,
        ),
      };
    }
  }

  registerPrettyBackend({
    id: "js-html",
    label: "JavaScript HTML",
    capabilities: { output: "html", width: "columns" },
    status: function () {
      return "ready";
    },
    renderTimed: formatHtmlWithJsTimed,
  });
  registerPrettyBackend({
    id: "vir-html",
    label: "VIR HTML",
    capabilities: { output: "html", width: "columns" },
    status: function () {
      var bridge = window.__prettyBenchVir;
      return bridge && bridge.status ? bridge.status : "unavailable";
    },
    renderTimed: formatHtmlWithVirTimed,
  });

  function repeatedScenarios(cycles) {
    var sources = createPrettyScalingScenarios().filter(function (scenario) {
      return (
        (scenario.dimension === "text" && scenario.size === 512) ||
        (scenario.dimension === "nodes" && scenario.size >= 500) ||
        (scenario.dimension === "breaks" && scenario.size === 64) ||
        (scenario.dimension === "tags" && scenario.size === 64) ||
        (scenario.dimension === "width" && scenario.size === 40)
      );
    });
    var scenarios = [];
    for (var cycle = 0; cycle < cycles; cycle++) {
      for (var index = 0; index < sources.length; index++) {
        var source = sources[(cycle + index) % sources.length];
        scenarios.push(
          Object.assign({}, source, {
            repeatRound: cycle + 1,
            sequenceIndex: scenarios.length,
          }),
        );
      }
    }
    return scenarios;
  }

  function nextAnimationFrame() {
    return new Promise(function (resolve) {
      requestAnimationFrame(resolve);
    });
  }

  function createPrettyLiveScenarios() {
    var specifications = [
      { id: "preview", label: "Preview", lines: 3, width: 72 },
      { id: "module", label: "Small module", lines: 8, width: 56 },
      { id: "narrow", label: "Narrow layout", lines: 12, width: 34 },
      { id: "escaped", label: "Escaped literals", lines: 16, width: 48 },
      { id: "dense", label: "Dense token stream", lines: 24, width: 80 },
    ];
    return specifications.map(function (specification, scenarioIndex) {
      var lines = [];
      for (var line = 0; line < specification.lines; line++) {
        if (line > 0) lines.push(1);
        var declaration = balancedPrettyAppend([
          [7, 0, line % 3 === 0 ? "def" : "let"],
          " ",
          [7, 1, "renderFrame_" + scenarioIndex + "_" + line],
          " := ",
          [7, 1, "prettyHtml"],
          " ",
          [7, 2, '"Lean <&> Wasm · frame ' + scenarioIndex + "." + line + '"'],
        ]);
        lines.push([3, line % 4, declaration]);
      }
      var format = [6, balancedPrettyAppend(lines)];
      return {
        case: {
          id: "live-" + specification.id,
          label: specification.label,
          origin: "live-synthetic",
          format: format,
        },
        width: specification.width,
        dimension: specification.id,
        size: specification.lines,
        input: measureCompactFormat(format),
      };
    });
  }

  async function runPrettyLiveHtmlStudy(settings, candidates, ids) {
    var panel = document.querySelector("#live-render-panel");
    var stage = document.querySelector("#live-render-stage");
    if (!(panel instanceof HTMLElement) || !(stage instanceof HTMLElement)) {
      throw new Error("live HTML rendering surface is missing");
    }
    panel.hidden = false;
    stage.replaceChildren();
    var colors = {
      "js-html": "#74a9ff",
      "vir-html": "#f0a35e",
      "native-html": "#d879c6",
      "llvm-html": "#d7c45c",
    };
    var lanes = {};
    var states = {};
    candidates.forEach(function (candidate) {
      var lane = document.createElement("article");
      lane.className = "live-render-lane";
      lane.style.setProperty(
        "--backend-color",
        colors[candidate.id] || "#86b5e8",
      );
      var header = document.createElement("header");
      var title = document.createElement("strong");
      title.textContent = candidate.label;
      var frame = document.createElement("span");
      frame.textContent = "waiting";
      var timing = document.createElement("small");
      timing.textContent = "formatter — · DOM — · frame —";
      var output = document.createElement("pre");
      output.className = "live-render-output";
      header.append(title, frame, timing);
      lane.append(header, output);
      stage.appendChild(lane);
      lanes[candidate.id] = { frame: frame, timing: timing, output: output };
      states[candidate.id] = {
        id: candidate.id,
        label: candidate.label,
        status:
          typeof candidate.status === "function" ? candidate.status() : "ready",
        formatterMs: [],
        domCommitMs: [],
        frameMs: [],
        errors: [],
      };
    });

    var sources = createPrettyLiveScenarios();
    var cycles = Math.min(240, Math.max(1, Number(settings.cycles || 32)));
    var parityCount = 0;
    var observations = [];
    var started = performance.now();
    for (var cycle = 0; cycle < cycles; cycle++) {
      var scenario = sources[cycle % sources.length];
      var annotations = annotationsForFormat(scenario.case.format);
      var measurer = createColumnMeasurer(scenario.width);
      await nextAnimationFrame();
      var expected = null;
      var parity = true;
      var frameObservation = {
        frame: cycle + 1,
        caseId: scenario.case.id,
        dimension: scenario.dimension,
        size: scenario.size,
        backends: {},
      };
      for (var index = 0; index < candidates.length; index++) {
        var candidate = candidates[(cycle + index) % candidates.length];
        var state = states[candidate.id];
        var lane = lanes[candidate.id];
        if (state.status !== "ready") {
          parity = false;
          lane.frame.textContent = state.status;
          continue;
        }
        try {
          var frameStarted = performance.now();
          var result = candidate.renderTimed(
            scenario.case.format,
            annotations,
            scenario.width,
            measurer,
          );
          if (typeof result.html !== "string") {
            throw new Error(result.error || "backend returned no HTML");
          }
          var formatterMs = result.timings.totalMs;
          var domStarted = performance.now();
          lane.output.innerHTML = result.html;
          var layoutHeight = lane.output.getBoundingClientRect().height;
          var domFinished = performance.now();
          var domCommitMs = domFinished - domStarted;
          var frameMs = domFinished - frameStarted;
          state.formatterMs.push(formatterMs);
          state.domCommitMs.push(domCommitMs);
          state.frameMs.push(frameMs);
          lane.frame.textContent = "frame " + (cycle + 1) + "/" + cycles;
          lane.timing.textContent =
            "formatter " +
            formatterMs.toFixed(3) +
            " ms · DOM " +
            domCommitMs.toFixed(3) +
            " ms · frame " +
            frameMs.toFixed(3) +
            " ms";
          frameObservation.backends[candidate.id] = {
            formatterMs: formatterMs,
            domCommitMs: domCommitMs,
            frameMs: frameMs,
            layoutHeight: layoutHeight,
          };
          if (expected === null) expected = result.html;
          else if (result.html !== expected) parity = false;
        } catch (error) {
          var message = error instanceof Error ? error.message : String(error);
          state.errors.push(message);
          parity = false;
          lane.frame.textContent = "failed";
          lane.timing.textContent = message;
        }
      }
      if (parity) parityCount++;
      frameObservation.parity = parity;
      observations.push(frameObservation);
      if (typeof settings.onProgress === "function") {
        settings.onProgress({
          completed: cycle + 1,
          total: cycles,
          caseId: scenario.case.id,
        });
      }
    }
    var summaries = {};
    Object.keys(states).forEach(function (id) {
      var state = states[id];
      summaries[id] = {
        id: id,
        label: state.label,
        status: state.status,
        formatterMs: summarizePrettyValues(state.formatterMs),
        domCommitMs: summarizePrettyValues(state.domCommitMs),
        frameMs: summarizePrettyValues(state.frameMs),
        errors: state.errors,
      };
    });
    return {
      schemaVersion: 1,
      kind: "live-render",
      contract: {
        id: "prettyM-live-html/v1",
        input: "synthetic-compact-format-plus-tagged-annotations",
        output: "verso-token-html/v1 committed to DOM",
        formatterEndpoint: "escaped HTML before DOM commit",
        browserEndpoint:
          "innerHTML parse, tree replacement, and forced synchronous layout",
        excluded: "asynchronous paint and presentation",
      },
      generatedAt: new Date().toISOString(),
      durationMs: performance.now() - started,
      backendIds: ids,
      frameCount: cycles,
      parityCount: parityCount,
      summaries: summaries,
      frames: observations,
      passed:
        parityCount === cycles &&
        Object.values(states).every(function (state) {
          return state.status === "ready" && state.errors.length === 0;
        }),
    };
  }

  async function runPrettyHtmlStudy(options) {
    var settings = options || {};
    var ids = settings.backendIds || [
      "js-html",
      "vir-html",
      "native-html",
      "llvm-html",
    ];
    var candidates = ids.map(function (id) {
      var backend = getPrettyBackend(id);
      if (!backend) throw new Error("unknown HTML backend " + id);
      return backend;
    });
    await Promise.all(
      candidates.map(function (backend) {
        return backend.ready
          ? Promise.resolve(backend.ready).catch(function () {})
          : null;
      }),
    );
    if (settings.liveRender) {
      return runPrettyLiveHtmlStudy(settings, candidates, ids);
    }

    var scenarios;
    if (Array.isArray(settings.scenarios)) {
      scenarios = settings.scenarios;
    } else if (settings.smoke) {
      scenarios = [
        {
          case: {
            id: "html-smoke",
            label: "Tags and escaping",
            origin: "html-smoke",
            format: [7, 5, [4, 'Lean <&"', [4, 1, "Wasm"]]],
          },
          width: 8,
        },
      ];
    } else if (settings.scaling) {
      scenarios = createPrettyScalingScenarios();
    } else if (settings.repeated) {
      scenarios = repeatedScenarios(Number(settings.cycles || 32));
    } else {
      scenarios = prettyDifferentialCorpus.flatMap(function (corpusCase) {
        return [20, 40, 80].map(function (width) {
          return { case: corpusCase, width: width };
        });
      });
    }

    var startedAt = new Date().toISOString();
    var started = performance.now();
    var warmup = Number(settings.warmup || 0);
    var samples = Number(settings.samples || 1);
    var batchTargetMs = Number(settings.batchTargetMs || 0);
    var maxBatchIterations = Number(settings.maxBatchIterations || 512);
    var batchMemoryBudgetBytes =
      settings.batchMemoryBudgetBytes === undefined
        ? 64 * 1024 * 1024
        : Number(settings.batchMemoryBudgetBytes);
    var profileBefore = await collectPrettyRuntimeProfile(ids);
    var benchmarkStarted = performance.now();
    var sampled = await runDifferentialSamples({
      candidates: candidates,
      scenarios: scenarios,
      warmup: warmup,
      samples: samples,
      batchTargetMs: batchTargetMs,
      maxBatchIterations: maxBatchIterations,
      batchMemoryBudgetBytes: batchMemoryBudgetBytes,
      prepareScenario: function (scenario) {
        return {
          annotations: annotationsForFormat(scenario.case.format),
          measurer: createColumnMeasurer(scenario.width),
        };
      },
      invoke: function (scenario, candidate, context) {
        var result = candidate.renderTimed(
          scenario.case.format,
          context.annotations,
          scenario.width,
          context.measurer,
        );
        return {
          ok: typeof result.html === "string",
          value: result.html,
          timings: result.timings,
          memory: result.memory,
          error: result.error,
        };
      },
      canonicalize: function (html) {
        return html;
      },
      measureOutput: function (html) {
        return {
          htmlBytes: new TextEncoder().encode(html).byteLength,
          htmlCodePoints: Array.from(html).length,
          spans: (html.match(/<span /g) || []).length,
        };
      },
      residentBytes: function (observation) {
        var memory = observation.memory;
        return memory &&
          Number.isFinite(memory.frontierBefore) &&
          Number.isFinite(memory.frontierAfterDecode)
          ? memory.frontierAfterDecode - memory.frontierBefore
          : null;
      },
      buildScenario: function (scenario, index, results, output, parity) {
        var backends = {};
        Object.keys(results).forEach(function (id) {
          var result = results[id];
          backends[id] = {
            html: result.value,
            signature: result.signature,
            output: result.metrics,
            stable: result.stable,
            errors: result.errors,
            timings: result.timings,
            memorySamples: result.memorySamples,
            batchIterations: result.batchIterations,
            batchResidentBytesPerCall: result.batchResidentBytesPerCall,
            batchLimitReason: result.batchLimitReason,
            invocations: result.invocations,
            summary: result.summary,
          };
        });
        return {
          caseId: scenario.case.id,
          label: scenario.case.label || scenario.case.id,
          origin: scenario.case.origin || "synthetic",
          width: scenario.width,
          input: scenario.input || measureCompactFormat(scenario.case.format),
          dimension: scenario.dimension || null,
          dimensionLabel: scenario.dimensionLabel || null,
          size: typeof scenario.size === "number" ? scenario.size : null,
          sizeLabel: scenario.sizeLabel || null,
          repeatRound: scenario.repeatRound || null,
          sequenceIndex: scenario.sequenceIndex ?? index,
          output: output,
          parity: parity,
          backends: backends,
        };
      },
      buildProgress: function (scenario, completed, total) {
        return {
          completed: completed,
          total: total,
          caseId: scenario.case.id,
          dimension: scenario.dimension,
        };
      },
      onProgress: settings.onProgress,
    });

    var summaries = {};
    sampled.candidateStates.forEach(function (state) {
      summaries[state.id] = {
        id: state.id,
        label: state.label,
        status: state.status,
        invocations: state.invocations,
        timing: summarizePrettyTimings(state.timings),
      };
    });
    var mismatches = sampled.scenarios.filter(function (scenario) {
      return !scenario.parity;
    });
    var unavailable = sampled.candidateStates.filter(function (state) {
      return state.status !== "ready";
    });
    var benchmarkFinished = performance.now();
    var profile = await collectPrettyRuntimeProfile(ids);
    var finished = performance.now();
    var kind = settings.scaling
      ? "scaling"
      : settings.repeated
        ? "repeated"
        : "differential";
    var report = {
      schemaVersion: 2,
      kind: kind,
      contract: {
        id: "prettyM-complete-html/v1",
        input: "compact-format-plus-tagged-annotations",
        output: "verso-token-html/v1",
        endpoint: "escaped HTML before DOM commit",
        interpretation: "exploratory-cross-runtime",
      },
      startedAt: startedAt,
      generatedAt: new Date().toISOString(),
      profileBeforeMs: benchmarkStarted - started,
      benchmarkMs: benchmarkFinished - benchmarkStarted,
      profileMs: finished - benchmarkFinished,
      durationMs: finished - started,
      warmup: warmup,
      samples: samples,
      batchTargetMs: batchTargetMs,
      maxBatchIterations: maxBatchIterations,
      batchMemoryBudgetBytes: batchMemoryBudgetBytes,
      widths: Array.from(
        new Set(
          scenarios.map(function (scenario) {
            return scenario.width;
          }),
        ),
      ),
      backendIds: ids,
      summaries: summaries,
      scenarios: sampled.scenarios,
      scenarioCount: sampled.scenarios.length,
      pointCount: sampled.scenarios.length,
      parityCount: sampled.scenarios.length - mismatches.length,
      mismatches: mismatches,
      unavailable: unavailable,
      passed: mismatches.length === 0 && unavailable.length === 0,
      runtimeProfileBefore: profileBefore,
      runtimeProfile: profile,
      cycles: settings.repeated ? Number(settings.cycles || 32) : null,
    };
    if (settings.scaling) {
      report.timingPhases = [
        { id: "executeMs", label: "Execute" },
        { id: "marshalMs", label: "Marshal" },
        { id: "decodeMs", label: "Decode" },
        { id: "totalMs", label: "Total" },
      ];
      report.dimensions = [];
      var dimensionIds = [];
      scenarios.forEach(function (scenario) {
        if (!dimensionIds.includes(scenario.dimension)) {
          dimensionIds.push(scenario.dimension);
        }
      });
      dimensionIds.forEach(function (dimension) {
        var points = report.scenarios.filter(function (scenario) {
          return scenario.dimension === dimension;
        });
        var phaseTrends = {};
        report.timingPhases.forEach(function (phase) {
          phaseTrends[phase.id] = {};
          ids.forEach(function (id) {
            phaseTrends[phase.id][id] = summarizePrettyScalingTrend(
              points,
              id,
              phase.id,
            );
          });
        });
        report.dimensions.push({
          id: dimension,
          label: points[0] ? points[0].dimensionLabel || dimension : dimension,
          points: points,
          trends: phaseTrends.totalMs,
          phaseTrends: phaseTrends,
        });
      });
    }
    if (settings.repeated) {
      var workloadIds = [];
      report.scenarios.forEach(function (scenario) {
        if (!workloadIds.includes(scenario.caseId)) {
          workloadIds.push(scenario.caseId);
        }
      });
      var stabilityMismatches = [];
      report.workloads = workloadIds.map(function (caseId) {
        var observations = report.scenarios.filter(function (scenario) {
          return scenario.caseId === caseId;
        });
        var stableByBackend = {};
        ids.forEach(function (id) {
          var signatures = new Set(
            observations.map(function (scenario) {
              return scenario.backends[id]
                ? scenario.backends[id].signature
                : null;
            }),
          );
          stableByBackend[id] = signatures.size === 1 && !signatures.has(null);
          if (!stableByBackend[id]) {
            stabilityMismatches.push({ caseId: caseId, backendId: id });
          }
        });
        return {
          id: caseId,
          label: observations[0].label,
          width: observations[0].width,
          input: observations[0].input,
          output: observations[0].output,
          callsPerBackend: observations.length,
          parity: observations.every(function (scenario) {
            return scenario.parity;
          }),
          stableByBackend: stableByBackend,
        };
      });
      report.workloadCount = report.workloads.length;
      report.callsPerBackend = report.scenarios.length;
      report.totalBackendCalls =
        report.scenarios.length * (ids.length - unavailable.length);
      report.stabilityMismatches = stabilityMismatches;
      report.passed = report.passed && stabilityMismatches.length === 0;
      report.memoryGrowth = {};
      ids.forEach(function (id) {
        var before = profileBefore && profileBefore.backends[id];
        var after = profile && profile.backends[id];
        var beforeBytes = before ? before.memoryBytes : null;
        var afterBytes = after ? after.memoryBytes : null;
        report.memoryGrowth[id] = {
          beforeBytes: beforeBytes,
          afterBytes: afterBytes,
          deltaBytes:
            typeof beforeBytes === "number" && typeof afterBytes === "number"
              ? afterBytes - beforeBytes
              : null,
        };
      });
      report.presentation = {
        title: "Complete-HTML repeated-call report",
        note: "Rotated structural inputs exercise retained JavaScript, VIR, and FIR instances. Every result is checked for exact HTML parity and for stability across cycles.",
        workloadHeading: "Alternating inputs and complete HTML output",
        workloadColumns: [
          { label: "Input", path: "label" },
          { label: "Width", path: "width" },
          { label: "Calls/backend", path: "callsPerBackend" },
          { label: "Nodes", path: "input.formatNodes" },
          { label: "Input bytes", path: "input.textBytes" },
          { label: "HTML bytes", path: "output.htmlBytes" },
          { label: "Spans", path: "output.spans" },
          { label: "HTML code points", path: "output.htmlCodePoints" },
        ],
      };
    }
    return report;
  }

  window.runPrettyHtmlStudy = runPrettyHtmlStudy;
})();
