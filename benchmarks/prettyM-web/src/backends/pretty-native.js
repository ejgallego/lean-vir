// @ts-check
/* Optional FIR-produced native Wasm bootstrap for the pretty-printer prototype. */
(function () {
  "use strict";

  /**
   * @typedef {{
   *   enabled?: boolean,
   *   adapterUrl?: string,
   *   wasmUrl?: string,
   *   descriptorUrl?: string,
   *   buildUrl?: string,
   *   fetchCache?: RequestCache,
   *   maximumNodes?: number
   * }} PrettyNativeConfig
   *
   * @typedef {{
   *   enabled?: boolean,
   *   status?: string,
   *   ready?: Promise<*>,
   *   error?: *,
   *   build?: *,
   *   adapter?: *,
   *   lastMemory?: Record<string, number>,
   *   startupTimings?: *,
   *   assets?: string[],
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
   *   ) => NativeFormatResult,
   *   traceToSegments?: (trace: PrettyTrace) => Segment[],
   *   warnings?: Record<string, boolean>
   * }} PrettyNativeBridge
   *
   * @typedef {{
   *   text: string,
   *   segments: Segment[],
   *   timings: {
   *     marshalMs: number,
   *     executeMs: number,
   *     decodeMs: number,
   *     renderMs: number,
   *     totalMs: number,
   *     adapterInputMs?: number,
   *     normalizeMs?: number,
   *     allocateMs?: number,
   *     encodeMs?: number,
   *     inputBytes?: number,
   *     rawObjects?: number,
   *     allocationCalls?: number
   *   },
   *   memory?: *
   * }} NativeFormatResult
   */

  var root = /** @type {Window & {
        __prettyBenchNativeConfig?: PrettyNativeConfig,
        __prettyBenchNative?: PrettyNativeBridge
    }} */ (window);
  var config = root.__prettyBenchNativeConfig || {};
  var bridge = root.__prettyBenchNative || {};
  bridge.enabled = config.enabled !== false;
  bridge.status = bridge.enabled ? "loading" : "disabled";
  root.__prettyBenchNative = bridge;

  /** @type {PrettyBackendDefinition} */
  var nativeBackend = {
    id: "native",
    label: "Native",
    capabilities: { output: "segments", width: "columns" },
    status: function () {
      return bridge.status || "unavailable";
    },
    renderTimed: function (fmtJson, _annotations, pixelWidth, measurer) {
      if (
        bridge.enabled === false ||
        bridge.status !== "ready" ||
        typeof bridge.formatSegments !== "function"
      ) {
        return {
          segments: null,
          timings: {
            marshalMs: 0,
            executeMs: 0,
            decodeMs: 0,
            renderMs: 0,
            totalMs: 0,
          },
        };
      }
      try {
        var spaceWidth = measurer.spaceWidth > 0 ? measurer.spaceWidth : 1;
        var width = Math.max(1, Math.floor(pixelWidth / spaceWidth));
        if (typeof bridge.formatSegmentsTimed === "function") {
          var result = bridge.formatSegmentsTimed(fmtJson, width, 0, 0);
          return {
            segments: result.segments,
            timings: result.timings,
            memory: result.memory,
          };
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
        warnOnce("render", "Native pretty-printer backend failed.", error);
        return {
          segments: null,
          error:
            error instanceof Error
              ? error.name + ": " + error.message
              : String(error),
          timings: {
            marshalMs: 0,
            executeMs: 0,
            decodeMs: 0,
            renderMs: 0,
            totalMs: 0,
          },
        };
      }
    },
  };
  registerPrettyBackend(nativeBackend);
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

  /**
   * @param {*} adapter
   * @param {*} formatFactory
   * @return {(fmtJson: *, width: number, indent: number, column: number) => NativeFormatResult}
   */
  function createNativePrettyClient(adapter, formatFactory) {
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
          marshalMs: adapterInputMs + result.timings.prepareMs,
          executeMs: result.timings.executeMs,
          decodeMs: result.timings.decodeMs + segmentDecodeMs,
          renderMs: 0,
          totalMs: finished - started,
          adapterInputMs: adapterInputMs,
          normalizeMs: result.timings.normalizeMs,
          allocateMs: result.timings.allocateMs,
          encodeMs: result.timings.encodeMs,
          inputBytes: result.memory.inputBytes,
          rawObjects: result.memory.rawObjects,
          allocationCalls: result.memory.residentAllocationCalls,
        },
        memory: result.memory,
      };
    };
  }

  var adapterUrl =
    config.adapterUrl ||
    fromScript("./lean-native/prettyM-browser-adapter.mjs");
  var wasmUrl = config.wasmUrl || fromScript("./lean-native/prettyM.wasm");
  var descriptorUrl = config.descriptorUrl || wasmUrl + ".json";
  var buildUrl = config.buildUrl || fromScript("./lean-native/BUILD.json");
  var startupStarted = performance.now();
  var adapterImported = startupStarted;
  bridge.assets = [scriptUrl, adapterUrl, wasmUrl, descriptorUrl, buildUrl];

  /** @param {RequestInfo | URL} url */
  function fetchArtifact(url) {
    return fetch(url, { cache: config.fetchCache || "default" });
  }

  bridge.ready = import(adapterUrl)
    .then(function (adapterModule) {
      adapterImported = performance.now();
      if (
        typeof adapterModule.fetchPrettyMAdapter !== "function" ||
        !adapterModule.PrettyFormat
      ) {
        throw new Error(
          "native package does not export its browser adapter API",
        );
      }
      return adapterModule
        .fetchPrettyMAdapter(wasmUrl, {
          descriptorUrl: descriptorUrl,
          buildUrl: buildUrl,
          maximumNodes: config.maximumNodes,
          fetchImpl: fetchArtifact,
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
      bridge.build = loaded.adapter.build;
      bridge.startupTimings = Object.assign({}, loaded.adapter.startupTimings, {
        importMs: adapterImported - startupStarted,
        bridgeTotalMs: initialized - startupStarted,
      });
      bridge.formatSegmentsTimed = createNativePrettyClient(
        loaded.adapter,
        loaded.formatFactory,
      );
      bridge.formatSegments = function (fmtJson, width, indent, column) {
        if (!bridge.formatSegmentsTimed) {
          throw new Error("native pretty timing client is unavailable");
        }
        return bridge.formatSegmentsTimed(fmtJson, width, indent, column)
          .segments;
      };
      bridge.status = "ready";
      return loaded.adapter;
    })
    .catch(function (error) {
      bridge.status = "failed";
      bridge.error = error;
      warnOnce("load", "Native pretty-printer bootstrap failed.", error);
      return null;
    });
  nativeBackend.ready = bridge.ready;
})();
