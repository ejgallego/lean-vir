// @ts-check
(function () {
  "use strict";

  var params = new URLSearchParams(window.location.search);
  var artifactBase = new URL(
    params.get("artifacts") || "artifacts/",
    window.location.href,
  );
  var fetchCache = params.get("cache") === "default" ? "default" : "no-store";
  var artifact = function (path) {
    return new URL(path, artifactBase).href;
  };

  window.__prettyBenchArtifactBase = artifactBase.href;
  window.__prettyBenchVirConfig = {
    runtimeUrl: artifact("lean-vir/js/vir-runtime.js"),
    wasmUrl: artifact("lean-vir/wasm/vir-upstream.wasm"),
    irPackageUrl: artifact("prettyM-vir.irpkg"),
    // Compatibility names in the current Lean 4.32 artifact. A future
    // producer refresh can rename these without changing the app contract.
    jsonExportName: "VersoSlides.Pretty.formatJsonSegmentsJsonForVir",
    formatExportName: "VersoSlides.Pretty.formatSegmentsForVir",
    fetchCache: fetchCache,
  };
  window.__prettyBenchNativeConfig = {
    adapterUrl: artifact("lean-native/prettyM-browser-adapter.mjs"),
    wasmUrl: artifact("lean-native/prettyM.wasm"),
    descriptorUrl: artifact("lean-native/prettyM.wasm.json"),
    buildUrl: artifact("lean-native/BUILD.json"),
    fetchCache: fetchCache,
  };
  window.__prettyBenchLlvmConfig = {
    adapterUrl: artifact("lean-llvm/prettyM-emscripten-adapter.mjs"),
    manifestUrl: artifact("lean-llvm/prettyM.manifest.json"),
  };
})();
