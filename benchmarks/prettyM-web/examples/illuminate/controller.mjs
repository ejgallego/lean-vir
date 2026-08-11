import { requireController } from "../controller-contract.mjs";

export const view = {
  eyebrow: "Real client · browser Wasm",
  intro:
    "Compare the production JavaScript player with typed VIR and FIR-native implementations over identical animations and event traces.",
  progress: "Preparing rehearsal artifacts…",
  artifacts: {
    root: "artifacts/illuminate",
    copy:
      "Correctness and packaging are validated, but timings from this loaded machine are not accepted as performance evidence.",
  },
  backendDescription:
    "JavaScript is the semantic oracle. VIR and FIR run the same typed replay contract and return normalized frame actions.",
  protocolDescription:
    "Runs are interleaved and starting order rotates. Adaptive batching is disabled because both Wasm runtimes retain allocations.",
  controls: [
    { id: "warmup", label: "Warm-up rounds", min: 0, max: 20, value: 1 },
    { id: "samples", label: "Measured rounds", min: 1, max: 100, value: 5 },
  ],
  studyDescription:
    "Quick check uses three trace lengths. Trace scaling adds longer event sequences and opens the shared plotting report.",
  studies: [
    { id: "quick", label: "Quick parity" },
    { id: "scaling", label: "Trace scaling", primary: true },
  ],
  emptyResults: "No Illuminate benchmark has run yet.",
  footer:
    "Common plotted phases are prepare, execute, decode, and total. Backend-specific raw fields remain in the JSON report.",
  bootstrap: {
    externalScripts: ["artifacts/illuminate/workload/anim_core.js"],
    classicScripts: ["src/dashboard.js"],
  },
};

export async function loadExample(context) {
  if (context.example.id !== "illuminate") {
    throw new Error(`Illuminate controller received example ${context.example.id}`);
  }
  await import("../../src/illuminate-app.js");
  return requireController(globalThis.__illuminateBenchApp, context.example.id);
}
