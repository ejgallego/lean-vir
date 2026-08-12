// @ts-check
/* FIR native Wasm bootstrap for direct flat text/style-event output. */
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
   * }} PrettyNativeFlatConfig
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
   *     fmtJson: *, width: number, indent: number, column: number
   *   ) => Segment[],
   *   formatSegmentsTimed?: (
   *     fmtJson: *, width: number, indent: number, column: number
   *   ) => NativeFlatFormatResult,
   *   warnings?: Record<string, boolean>
   * }} PrettyNativeFlatBridge
   *
   * @typedef {{
   *   text: string,
   *   segments: Segment[],
   *   timings: PrettyTimings,
   *   memory?: Record<string, number>
   * }} NativeFlatFormatResult
   */

  var root = /** @type {Window & {
    __prettyBenchNativeFlatConfig?: PrettyNativeFlatConfig,
    __prettyBenchNativeFlat?: PrettyNativeFlatBridge
  }} */ (window);
  var config = root.__prettyBenchNativeFlatConfig || {};
  var bridge = root.__prettyBenchNativeFlat || {};
  bridge.enabled = config.enabled !== false;
  bridge.status = bridge.enabled ? "loading" : "disabled";
  root.__prettyBenchNativeFlat = bridge;

  /** @param {string} key @param {string} message @param {*} error */
  function warnOnce(key, message, error) {
    var warnings = bridge.warnings || (bridge.warnings = {});
    if (warnings[key]) return;
    warnings[key] = true;
    console.warn(message, error);
  }

  /** @type {PrettyBackendDefinition} */
  var backend = {
    id: "native-flat",
    label: "FIR Wasm Flat",
    capabilities: { output: "text-events", width: "columns" },
    status: function () {
      return bridge.status || "unavailable";
    },
    renderTimed: function (fmtJson, _annotations, pixelWidth, measurer) {
      if (
        bridge.enabled === false ||
        bridge.status !== "ready" ||
        typeof bridge.formatSegmentsTimed !== "function"
      ) {
        return { segments: null, timings: emptyPrettyTimings() };
      }
      try {
        var width = pixelWidthToFormatColumns(pixelWidth, measurer);
        var result = bridge.formatSegmentsTimed(fmtJson, width, 0, 0);
        return {
          segments: result.segments,
          timings: result.timings,
          memory: result.memory,
        };
      } catch (error) {
        warnOnce("render", "FIR Wasm Flat pretty-printer failed.", error);
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
  registerPrettyBackend(backend);
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
   * @return {(
   *   fmtJson: *, width: number, indent: number, column: number
   * ) => NativeFlatFormatResult}
   */
  function createClient(adapter, formatFactory) {
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
      var outputDecoded = performance.now();
      var segments = normalizePrettyRendered(result.rendered);
      if (segments === null) {
        throw new Error("invalid UTF-8 text/style-event result");
      }
      var finished = performance.now();
      var memory = result.memory || {};
      var timings = result.timings || {};
      bridge.lastMemory = memory;
      return {
        text: result.rendered.text,
        segments: segments,
        timings: {
          marshalMs: inputAdapted - started + Number(timings.prepareMs || 0),
          executeMs: Number(timings.executeMs || 0),
          decodeMs: Number(timings.decodeMs || 0) + (finished - outputDecoded),
          renderMs: 0,
          totalMs: finished - started,
          adapterInputMs: inputAdapted - started,
          adapterOutputMs: finished - outputDecoded,
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
  }

  var adapterUrl =
    config.adapterUrl ||
    fromScript("./lean-native-flat/prettyM-browser-adapter.mjs");
  var wasmUrl = config.wasmUrl || fromScript("./lean-native-flat/prettyM.wasm");
  var descriptorUrl = config.descriptorUrl || wasmUrl + ".json";
  var buildUrl = config.buildUrl || fromScript("./lean-native-flat/BUILD.json");
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
        adapterModule.PRETTY_M_BROWSER_API_VERSION !==
          "fir.prettyM.flat.browser/v1" ||
        typeof adapterModule.fetchPrettyMAdapter !== "function" ||
        !adapterModule.PrettyFormat
      ) {
        throw new Error(
          "Flat package does not export the required browser API",
        );
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
      bridge.formatSegmentsTimed = createClient(
        loaded.adapter,
        loaded.formatFactory,
      );
      bridge.formatSegments = function (fmtJson, width, indent, column) {
        if (!bridge.formatSegmentsTimed) {
          throw new Error("Flat timing client is unavailable");
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
      warnOnce("load", "FIR Wasm Flat bootstrap failed.", error);
      return null;
    });
  backend.ready = bridge.ready;
})();
