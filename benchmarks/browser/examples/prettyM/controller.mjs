import { requireController } from "../controller-contract.mjs";

export const view = {
  eyebrow: "Bounded runtimes · browser Wasm",
  intro:
    "Compare correctness, pipeline timings, scaling, and retained memory across five independently versioned implementations.",
  progress: "Preparing bounded artifact set…",
  artifacts: {
    copy:
      "When present, the manifest ties reports to one immutable set of independently versioned runtimes and workload packages.",
  },
  backendDescription:
    "Choose which implementations participate in the next run. Report views have their own non-destructive backend filter.",
  protocolDescription:
    "Defaults match the consolidated browser study. Treat timings as observations unless the host and run protocol are controlled.",
  controls: [
    { id: "warmup", label: "Warm-up rounds", min: 0, max: 100, value: 2 },
    { id: "samples", label: "Measured rounds", min: 1, max: 1000, value: 9 },
    { id: "batch-target", label: "Batch target (ms)", min: 0, max: 1000, value: 20 },
    { id: "repeat-cycles", label: "Repeat cycles", min: 1, max: 10000, value: 32 },
  ],
  studyDescription: "Execute one study or collect the complete dashboard dataset.",
  studies: [
    { id: "smoke", label: "Quick check" },
    { id: "differential", label: "Corpus" },
    { id: "scaling", label: "Scaling" },
    { id: "memory-retained", label: "Memory" },
    { id: "interactions", label: "Interactions" },
    { id: "repeated", label: "Repeated calls" },
    { id: "suite", label: "Full suite", primary: true },
  ],
  emptyResults: "No prettyM benchmark has run yet.",
  footer:
    "Reports contain artifact provenance, startup timings, per-phase samples, parity results, and memory observations.",
  bootstrap: {
    artifactScripts: [],
    classicScripts: [
      "examples/prettyM/config.js",
      "examples/prettyM/benchmark-core.js",
      "examples/prettyM/backends/pretty-vir.js",
      "examples/prettyM/backends/pretty-native.js",
      "examples/prettyM/backends/pretty-llvm.js",
      "src/dashboard.js",
      "examples/prettyM/app.js",
    ],
  },
};

export async function loadExample(context) {
  if (context.example.id !== "prettyM") {
    throw new Error(`prettyM controller received example ${context.example.id}`);
  }
  return requireController(globalThis.__prettyBenchApp, context.example.id);
}
