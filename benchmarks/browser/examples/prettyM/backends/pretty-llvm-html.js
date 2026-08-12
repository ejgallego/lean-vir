// @ts-check
/* LLVM/Emscripten Wasm bootstrap for complete escaped HTML output. */
(function () {
  "use strict";

  var root = window;
  var config = root.__prettyBenchLlvmHtmlConfig || {};
  var bridge = root.__prettyBenchLlvmHtml || {};
  bridge.enabled = config.enabled !== false;
  bridge.status = bridge.enabled ? "loading" : "disabled";
  root.__prettyBenchLlvmHtml = bridge;

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
    id: "llvm-html",
    label: "LLVM Wasm HTML",
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
    fromScript("./lean-llvm-html/prettyM-html-emscripten-adapter.mjs");
  var manifestUrl =
    config.manifestUrl ||
    fromScript("./lean-llvm-html/prettyM-html.manifest.json");
  var artifactBaseUrl = new URL(".", manifestUrl);
  var startupStarted = performance.now();
  var adapterImported = startupStarted;
  bridge.assets = [
    scriptUrl,
    adapterUrl,
    new URL("prettyM-emscripten-adapter.mjs", adapterUrl).href,
    new URL("emscripten-loader.mjs", adapterUrl).href,
    manifestUrl,
    new URL("prettyM-html.mjs", artifactBaseUrl).href,
    new URL("prettyM-html.wasm", artifactBaseUrl).href,
  ];

  bridge.ready = Promise.resolve()
    .then(function () {
      if (!globalThis.crossOriginIsolated) {
        throw new Error("LLVM prettyM HTML requires a cross-origin-isolated page");
      }
      return import(adapterUrl);
    })
    .then(function (adapterModule) {
      adapterImported = performance.now();
      if (
        adapterModule.PRETTY_M_BROWSER_API_VERSION !==
          "fir.prettyM.html.emscripten.browser/v1" ||
        adapterModule.PRETTY_M_INPUT_LAYOUT_VERSION !==
          "lean-4.32-Std.Format.compact/v1" ||
        adapterModule.PRETTY_M_OUTPUT_VERSION !== "verso-token-html/v1" ||
        typeof adapterModule.loadEmscriptenPrettyMHtmlAdapter !== "function" ||
        !adapterModule.PrettyFormat
      ) {
        throw new Error("LLVM HTML package has an incompatible browser API");
      }
      return adapterModule
        .loadEmscriptenPrettyMHtmlAdapter(manifestUrl, {
          maximumNodes: config.maximumNodes,
          maximumBytes: config.maximumBytes,
        })
        .then(function (adapter) {
          return { adapter: adapter, formatFactory: adapterModule.PrettyFormat };
        });
    })
    .then(function (loaded) {
      var initialized = performance.now();
      bridge.adapter = loaded.adapter;
      bridge.manifest = loaded.adapter.loaded.manifest;
      var artifacts = bridge.manifest.artifacts || {};
      bridge.assets = [
        scriptUrl,
        adapterUrl,
        new URL("prettyM-emscripten-adapter.mjs", adapterUrl).href,
        new URL("emscripten-loader.mjs", adapterUrl).href,
        manifestUrl,
        artifacts.module && artifacts.module.file
          ? new URL(artifacts.module.file, artifactBaseUrl).href
          : new URL("prettyM-html.mjs", artifactBaseUrl).href,
        artifacts.wasm && artifacts.wasm.file
          ? new URL(artifacts.wasm.file, artifactBaseUrl).href
          : new URL("prettyM-html.wasm", artifactBaseUrl).href,
      ];
      bridge.startupTimings = {
        importMs: adapterImported - startupStarted,
        loadMs: initialized - adapterImported,
        totalMs: initialized - startupStarted,
      };
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
          throw new Error("LLVM HTML adapter returned invalid output");
        }
        bridge.lastMemory = result.memory;
        return {
          html: result.html,
          timings: {
            marshalMs: inputAdapted - started + result.timings.encodeMs,
            executeMs: result.timings.executeMs,
            decodeMs: result.timings.decodeMs,
            renderMs: 0,
            totalMs: finished - started,
            adapterInputMs: inputAdapted - started,
            encodeMs: result.timings.encodeMs,
            requestBytes: result.memory.requestBytes,
            responseBytes: result.memory.responseBytes,
            formatNodes: result.memory.formatNodes,
            annotationEntries: result.memory.annotationEntries,
            heapBytesBefore: result.memory.heapBytesBefore,
            heapBytesAfter: result.memory.heapBytesAfter,
          },
          memory: result.memory,
        };
      };
      bridge.dispose = function () {
        loaded.adapter.dispose();
      };
      window.addEventListener("pagehide", bridge.dispose, { once: true });
      bridge.status = "ready";
      return loaded.adapter;
    })
    .catch(function (error) {
      bridge.status = "failed";
      bridge.error = error;
      console.warn("LLVM HTML bootstrap failed.", error);
      return null;
    });
  backend.ready = bridge.ready;
})();
