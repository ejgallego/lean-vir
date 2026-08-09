// @ts-check
/* Optional LLVM/Emscripten-produced Wasm bootstrap for the pretty-printer demo. */
(function () {
  "use strict";

  /**
   * @typedef {{
   *   enabled?: boolean,
   *   adapterUrl?: string,
   *   manifestUrl?: string,
   *   maximumNodes?: number,
   *   maximumBytes?: number
   * }} PrettyLlvmConfig
   *
   * @typedef {{
   *   enabled?: boolean,
   *   status?: string,
   *   ready?: Promise<*>,
   *   error?: *,
   *   manifest?: *,
   *   adapter?: *,
   *   lastMemory?: Record<string, number>,
   *   assets?: string[],
   *   startupTimings?: { importMs: number, loadMs: number, totalMs: number },
   *   dispose?: () => void,
   *   formatSegments?: (
   *     fmtJson: *,
   *     width: number,
   *     indent: number,
   *     column: number
   *   ) => Segment[],
   *   formatSegmentsTimed?: (
   *     fmtJson: *,
   *     width: number,
   *     indent: number,
   *     column: number
   *   ) => LlvmFormatResult,
   *   traceToSegments?: (trace: PrettyTrace) => Segment[],
   *   warnings?: Record<string, boolean>
   * }} PrettyLlvmBridge
   *
   * @typedef {{
   *   text: string,
   *   segments: Segment[],
   *   timings: PrettyTimings,
   *   memory?: *
   * }} LlvmFormatResult
   */

  var root = /** @type {Window & {
        __prettyBenchLlvmConfig?: PrettyLlvmConfig,
        __prettyBenchLlvm?: PrettyLlvmBridge
    }} */ (window);
  var config = root.__prettyBenchLlvmConfig || {};
  var bridge = root.__prettyBenchLlvm || {};
  bridge.enabled = config.enabled !== false;
  bridge.status = bridge.enabled ? "loading" : "disabled";
  root.__prettyBenchLlvm = bridge;

  /**
   * @param {string} key
   * @param {string} message
   * @param {*} error
   */
  function warnOnce(key, message, error) {
    var warnings = bridge.warnings || (bridge.warnings = {});
    if (warnings[key]) return;
    warnings[key] = true;
    console.warn(message, error);
  }

  /** @type {PrettyBackendDefinition} */
  var llvmBackend = {
    id: "llvm",
    label: "LLVM",
    capabilities: { output: "segments", width: "columns" },
    status: function () {
      return bridge.status || "unavailable";
    },
    renderTimed: function (fmtJson, _annotations, pixelWidth, measurer) {
      if (
        bridge.enabled === false ||
        bridge.status !== "ready" ||
        (typeof bridge.formatSegments !== "function" &&
          typeof bridge.formatSegmentsTimed !== "function")
      ) {
        return { segments: null, timings: emptyPrettyTimings() };
      }
      try {
        var width = pixelWidthToFormatColumns(pixelWidth, measurer);
        if (typeof bridge.formatSegmentsTimed === "function") {
          var result = bridge.formatSegmentsTimed(fmtJson, width, 0, 0);
          return {
            segments: result.segments,
            timings: result.timings,
            memory: result.memory,
          };
        }
        if (typeof bridge.formatSegments !== "function") {
          return { segments: null, timings: emptyPrettyTimings() };
        }
        var started = performance.now();
        var segments = bridge.formatSegments(fmtJson, width, 0, 0);
        var finished = performance.now();
        return {
          segments: segments,
          timings: {
            marshalMs: 0,
            executeMs: finished - started,
            decodeMs: 0,
            renderMs: 0,
            totalMs: finished - started,
          },
        };
      } catch (error) {
        warnOnce("render", "LLVM pretty-printer backend failed.", error);
        return {
          segments: null,
          error:
            error instanceof Error
              ? error.name + ": " + error.message
              : String(error),
          timings: emptyPrettyTimings(),
        };
      }
    },
  };
  registerPrettyBackend(llvmBackend);
  bridge.traceToSegments = prettyTraceToSegments;

  if (bridge.enabled === false) return;

  var currentScript = document.currentScript;
  var scriptUrl =
    currentScript instanceof HTMLScriptElement && currentScript.src
      ? currentScript.src
      : window.location.href;

  /** @param {string} path */
  function fromScript(path) {
    return new URL(path, scriptUrl).href;
  }

  /**
   * @param {*} adapter
   * @param {*} formatFactory
   * @return {(fmtJson: *, width: number, indent: number, column: number) => LlvmFormatResult}
   */
  function createLlvmPrettyClient(adapter, formatFactory) {
    return function (fmtJson, width, indent, column) {
      var started = performance.now();
      var format = compactFormatToAdapterInput(formatFactory, fmtJson);
      var inputAdapted = performance.now();
      var result = adapter.render({
        format: format,
        width: width,
        indent: indent,
        column: column,
      });
      var traceDecoded = performance.now();
      var segments = prettyTraceToSegments(result.trace);
      var finished = performance.now();
      var adapterInputMs = inputAdapted - started;
      var segmentDecodeMs = finished - traceDecoded;
      bridge.lastMemory = result.memory;
      return {
        text: result.trace.text,
        segments: segments,
        timings: {
          marshalMs: adapterInputMs + result.timings.encodeMs,
          executeMs: result.timings.executeMs,
          decodeMs: result.timings.decodeMs + segmentDecodeMs,
          renderMs: 0,
          totalMs: finished - started,
          adapterInputMs: adapterInputMs,
          encodeMs: result.timings.encodeMs,
          requestBytes: result.memory.requestBytes,
          responseBytes: result.memory.responseBytes,
          formatNodes: result.memory.formatNodes,
          heapBytesBefore: result.memory.heapBytesBefore,
          heapBytesAfter: result.memory.heapBytesAfter,
        },
        memory: result.memory,
      };
    };
  }

  var adapterUrl =
    config.adapterUrl ||
    fromScript("./lean-llvm/prettyM-emscripten-adapter.mjs");
  var manifestUrl =
    config.manifestUrl || fromScript("./lean-llvm/prettyM.manifest.json");
  var artifactBaseUrl = new URL(".", manifestUrl);
  var startupStarted = performance.now();
  var adapterImported = startupStarted;
  bridge.assets = [
    scriptUrl,
    adapterUrl,
    new URL("emscripten-loader.mjs", adapterUrl).href,
    manifestUrl,
    new URL("prettyM.mjs", artifactBaseUrl).href,
    new URL("prettyM.wasm", artifactBaseUrl).href,
  ];

  bridge.ready = Promise.resolve()
    .then(function () {
      if (!globalThis.crossOriginIsolated) {
        throw new Error("LLVM prettyM requires a cross-origin-isolated page");
      }
      return import(adapterUrl);
    })
    .then(function (adapterModule) {
      adapterImported = performance.now();
      if (
        adapterModule.PRETTY_M_BROWSER_API_VERSION !==
          "fir.prettyM.browser/v1" ||
        adapterModule.PRETTY_M_INPUT_LAYOUT_VERSION !==
          "lean-4.32-Std.Format.compact/v1" ||
        typeof adapterModule.loadEmscriptenPrettyMAdapter !== "function" ||
        !adapterModule.PrettyFormat
      ) {
        throw new Error(
          "LLVM package does not export the shared browser adapter API",
        );
      }
      return adapterModule
        .loadEmscriptenPrettyMAdapter(manifestUrl, {
          maximumNodes: config.maximumNodes,
          maximumBytes: config.maximumBytes,
        })
        .then(
          /** @param {*} adapter */
          function (adapter) {
            return {
              adapter: adapter,
              formatFactory: adapterModule.PrettyFormat,
            };
          },
        );
    })
    .then(function (loaded) {
      var initialized = performance.now();
      bridge.adapter = loaded.adapter;
      bridge.manifest = loaded.adapter.loaded.manifest;
      var artifacts = bridge.manifest.artifacts || {};
      bridge.assets = [
        scriptUrl,
        adapterUrl,
        new URL("emscripten-loader.mjs", adapterUrl).href,
        manifestUrl,
        artifacts.module && artifacts.module.file
          ? new URL(artifacts.module.file, artifactBaseUrl).href
          : new URL("prettyM.mjs", artifactBaseUrl).href,
        artifacts.wasm && artifacts.wasm.file
          ? new URL(artifacts.wasm.file, artifactBaseUrl).href
          : new URL("prettyM.wasm", artifactBaseUrl).href,
      ];
      bridge.startupTimings = {
        importMs: adapterImported - startupStarted,
        loadMs: initialized - adapterImported,
        totalMs: initialized - startupStarted,
      };
      bridge.formatSegmentsTimed = createLlvmPrettyClient(
        loaded.adapter,
        loaded.formatFactory,
      );
      bridge.formatSegments = function (fmtJson, width, indent, column) {
        if (!bridge.formatSegmentsTimed) {
          throw new Error("LLVM pretty timing client is unavailable");
        }
        return bridge.formatSegmentsTimed(fmtJson, width, indent, column)
          .segments;
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
      warnOnce("load", "LLVM pretty-printer bootstrap failed.", error);
      return null;
    });
  llvmBackend.ready = bridge.ready;
})();
