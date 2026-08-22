import { requireController } from "../controller-contract.mjs";

export const view = {
  eyebrow: "Real client · raw DEFLATE",
  intro:
    "Compare one production Lean compressor through VIR, FIR-native, and FIR C/Emscripten, alongside browser-native and JavaScript codecs.",
  progress: "Preparing lean-zip browser packages…",
  artifacts: {
    copy:
      "Native Lean supplies build-time oracle bytes. Browser runs verify independent inflation and exact agreement across the three Lean routes.",
  },
  backendDescription:
    "VIR, FIR-native, and FIR C/Emscripten must emit the native-Lean oracle stream exactly. CompressionStream and fflate may choose different valid streams.",
  protocolDescription:
    "Each backend runs in its own worker. Setup, first call, and steady samples remain separate; measurements on loaded developer machines are diagnostic only.",
  controls: [
    { id: "warmup", label: "Warm-up rounds", min: 0, max: 10, value: 1 },
    { id: "samples", label: "Measured rounds", min: 1, max: 20, value: 3 },
    { id: "iterations", label: "Calls per round", min: 1, max: 20, value: 1 }
  ],
  studyDescription:
    "Quick parity checks a small deterministic vector. The suite covers every packaged vector and native-oracle level.",
  studies: [
    { id: "quick", label: "Quick parity" },
    { id: "suite", label: "Compression suite", primary: true }
  ],
  emptyResults: "No lean-zip comparison has run yet.",
  footer:
    "Native Lean is provenance and correctness evidence, not a browser timing row. FIR-native and FIR C/Emscripten remain distinct compiler routes.",
  bootstrap: { artifactScripts: [], classicScripts: [] }
};

export async function loadExample(context) {
  if (context.example.id !== "lean-zip") {
    throw new Error(`lean-zip controller received example ${context.example.id}`);
  }
  const client = await import(
    new URL("workload/catalog-controller.mjs", context.artifactBaseUrl).href
  );
  if (typeof client.loadCatalogExample !== "function") {
    throw new Error("lean-zip workload package omits loadCatalogExample()");
  }
  return requireController(
    await client.loadCatalogExample(context),
    context.example.id
  );
}
