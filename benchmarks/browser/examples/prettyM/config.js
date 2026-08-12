// @ts-check
(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  var context = globalThis.__benchmarkExampleContext;
  if (!(context && context.artifactBaseUrl instanceof URL)) {
    throw new Error("prettyM requires the benchmark example context");
  }
  var artifactBase = new URL(
    params.get("artifacts") || context.artifactBaseUrl.href,
    window.location.href,
  );
  var fetchCache = params.get("cache") === "default" ? "default" : "no-store";
  var artifact = function (path) {
    return new URL(path, artifactBase).href;
  };

  window.__prettyBenchArtifactBase = artifactBase.href;
  window.__prettyBenchArtifactSetUrl = artifact("ARTIFACT_SET.json");
  var htmlMode = ["html", "live-html"].includes(
    globalThis.__benchmarkExampleContext.variant.id,
  );
  window.__prettyBenchVirConfig = {
    runtimeUrl: artifact("lean-vir/js/vir-runtime.js"),
    wasmUrl: artifact("lean-vir/wasm/vir-upstream.wasm"),
    irPackageUrl: artifact(
      htmlMode ? "prettyM-html-vir.irpkg" : "prettyM-vir.irpkg",
    ),
    // Role-specific mappings for the package exports declared in example.json.
    // A producer refresh can rename them without changing the app contract.
    jsonExportName: "VersoSlides.Pretty.formatJsonSegmentsJsonForVir",
    formatExportName: "VersoSlides.Pretty.formatSegmentsForVir",
    htmlExportName: "VersoSlides.Pretty.formatHtmlForVir",
    fetchCache: fetchCache,
  };
  window.__prettyBenchNativeConfig = {
    enabled: !htmlMode,
    adapterUrl: artifact("lean-native/prettyM-browser-adapter.mjs"),
    wasmUrl: artifact("lean-native/prettyM.wasm"),
    descriptorUrl: artifact("lean-native/prettyM.wasm.json"),
    buildUrl: artifact("lean-native/BUILD.json"),
    fetchCache: fetchCache,
  };
  window.__prettyBenchNativeFlatConfig = {
    enabled: !htmlMode,
    adapterUrl: artifact("lean-native-flat/prettyM-browser-adapter.mjs"),
    wasmUrl: artifact("lean-native-flat/prettyM.wasm"),
    descriptorUrl: artifact("lean-native-flat/prettyM.wasm.json"),
    buildUrl: artifact("lean-native-flat/BUILD.json"),
    fetchCache: fetchCache,
  };
  window.__prettyBenchNativeHtmlConfig = {
    enabled: htmlMode,
    adapterUrl: artifact("lean-native-html/prettyM-browser-adapter.mjs"),
    wasmUrl: artifact("lean-native-html/prettyM.wasm"),
    descriptorUrl: artifact("lean-native-html/prettyM.wasm.json"),
    buildUrl: artifact("lean-native-html/BUILD.json"),
    fetchCache: fetchCache,
  };
  window.__prettyBenchLlvmConfig = {
    enabled: !htmlMode,
    adapterUrl: artifact("lean-llvm/prettyM-emscripten-adapter.mjs"),
    manifestUrl: artifact("lean-llvm/prettyM.manifest.json"),
  };
  window.__prettyBenchLlvmHtmlConfig = {
    enabled: htmlMode,
    adapterUrl: artifact("lean-llvm-html/prettyM-html-emscripten-adapter.mjs"),
    manifestUrl: artifact("lean-llvm-html/prettyM-html.manifest.json"),
  };
})();
