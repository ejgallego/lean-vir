// @ts-check
/* FIR native Wasm bootstrap for complete escaped HTML output. */
(function () {
  "use strict";

  var root = window;
  var config = root.__prettyBenchNativeHtmlConfig || {};
  var bridge = root.__prettyBenchNativeHtml || {};
  bridge.enabled = config.enabled !== false;
  bridge.status = bridge.enabled ? "loading" : "disabled";
  root.__prettyBenchNativeHtml = bridge;

  function taggedAnnotations(annotations) {
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

  var backend = {
    id: "native-html",
    label: "FIR Wasm HTML",
    capabilities: { output: "html", width: "columns" },
    status: function () {
      return bridge.status || "unavailable";
    },
    renderTimed: function (fmtJson, annotations, pixelWidth, measurer) {
      if (bridge.status !== "ready" || !bridge.formatHtmlTimed) {
        return { html: null, timings: emptyPrettyTimings() };
      }
      try {
        return bridge.formatHtmlTimed(
          fmtJson,
          annotations,
          pixelWidthToFormatColumns(pixelWidth, measurer),
          0,
          0,
        );
      } catch (error) {
        return {
          html: null,
          error: error instanceof Error ? error.message : String(error),
          timings: emptyPrettyTimings(),
        };
      }
    },
  };
  registerPrettyBackend(backend);
  if (!bridge.enabled) return;

  var currentScript = document.currentScript;
  var scriptUrl =
    currentScript instanceof HTMLScriptElement && currentScript.src
      ? currentScript.src
      : window.location.href;
  function fromScript(path) {
    return new URL(path, scriptUrl).href;
  }
  var adapterUrl =
    config.adapterUrl ||
    fromScript("./lean-native-html/prettyM-browser-adapter.mjs");
  var wasmUrl = config.wasmUrl || fromScript("./lean-native-html/prettyM.wasm");
  var descriptorUrl = config.descriptorUrl || wasmUrl + ".json";
  var buildUrl = config.buildUrl || fromScript("./lean-native-html/BUILD.json");
  var startupStarted = performance.now();
  var adapterImported = startupStarted;
  bridge.assets = [scriptUrl, adapterUrl, wasmUrl, descriptorUrl, buildUrl];

  function fetchArtifact(url) {
    return fetch(url, { cache: config.fetchCache || "default" });
  }

  bridge.ready = import(adapterUrl)
    .then(function (adapterModule) {
      adapterImported = performance.now();
      if (
        adapterModule.PRETTY_M_BROWSER_API_VERSION !==
          "fir.prettyM.html.browser/v1" ||
        typeof adapterModule.fetchPrettyMAdapter !== "function" ||
        !adapterModule.PrettyFormat
      ) {
        throw new Error("FIR HTML package has an incompatible browser API");
      }
      return adapterModule
        .fetchPrettyMAdapter(wasmUrl, {
          descriptorUrl: descriptorUrl,
          buildUrl: buildUrl,
          maximumNodes: config.maximumNodes,
          fetchImpl: fetchArtifact,
        })
        .then(function (adapter) {
          return {
            adapter: adapter,
            formatFactory: adapterModule.PrettyFormat,
          };
        });
    })
    .then(function (loaded) {
      var initialized = performance.now();
      bridge.adapter = loaded.adapter;
      bridge.build = loaded.adapter.build;
      bridge.startupTimings = Object.assign({}, loaded.adapter.startupTimings, {
        importMs: adapterImported - startupStarted,
        bridgeTotalMs: initialized - startupStarted,
      });
      bridge.formatHtmlTimed = function (
        fmtJson,
        annotations,
        width,
        indent,
        column,
      ) {
        var started = performance.now();
        var format = compactFormatToAdapterInput(loaded.formatFactory, fmtJson);
        var tagged = taggedAnnotations(annotations);
        var inputAdapted = performance.now();
        var result = loaded.adapter.render({
          format: format,
          annotations: tagged,
          width: width,
          indent: indent,
          column: column,
        });
        var finished = performance.now();
        if (!result || typeof result.html !== "string") {
          throw new Error("FIR HTML adapter returned invalid output");
        }
        var memory = result.memory || {};
        var timings = result.timings || {};
        bridge.lastMemory = memory;
        return {
          html: result.html,
          timings: {
            marshalMs: inputAdapted - started + Number(timings.prepareMs || 0),
            executeMs: Number(timings.executeMs || 0),
            decodeMs: Number(timings.decodeMs || 0),
            renderMs: 0,
            totalMs: finished - started,
            adapterInputMs: inputAdapted - started,
            normalizeMs: Number(timings.normalizeMs || 0),
            allocateMs: Number(timings.allocateMs || 0),
            encodeMs: Number(timings.encodeMs || 0),
            inputBytes: Number(memory.inputBytes || 0),
            rawObjects: Number(memory.rawObjects || 0),
            allocationCalls: Number(memory.residentAllocationCalls || 0),
          },
          memory: memory,
        };
      };
      bridge.status = "ready";
      return loaded.adapter;
    })
    .catch(function (error) {
      bridge.status = "failed";
      bridge.error = error;
      console.warn("FIR HTML bootstrap failed.", error);
      return null;
    });
  backend.ready = bridge.ready;
})();
