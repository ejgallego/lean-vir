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
      "examples/prettyM/backends/pretty-html.js",
      "examples/prettyM/backends/pretty-vir.js",
      "examples/prettyM/backends/pretty-native.js",
      "examples/prettyM/backends/pretty-native-flat.js",
      "examples/prettyM/backends/pretty-llvm.js",
      "examples/prettyM/backends/pretty-native-html.js",
      "examples/prettyM/backends/pretty-llvm-html.js",
      "src/dashboard.js",
      "examples/prettyM/app.js",
    ],
  },
};

export function viewForVariant(variant) {
  if (variant.id !== "html") return view;
  return {
    ...view,
    eyebrow: "Complete renderer · browser Wasm",
    intro:
      "Compare JavaScript, VIR, FIR-native Wasm, and FIR-through-LLVM Wasm across layout, annotation resolution, escaping, and token-span construction.",
    progress: "Preparing complete HTML renderers…",
    backendDescription:
      "Every candidate returns the same escaped verso-token-html/v1 string. The live study then measures browser DOM commit and forced layout separately.",
    protocolDescription:
      "Formatter samples exclude DOM work. Live frames expose formatter, synchronous DOM commit/layout, and end-to-end time as distinct values.",
    studyDescription:
      "Check exact HTML, explore size scaling and repeated calls, or render synthetic output live in four side-by-side lanes.",
    studies: [
      { id: "smoke", label: "Quick check" },
      { id: "differential", label: "HTML corpus" },
      { id: "scaling", label: "HTML scaling" },
      { id: "repeated", label: "Repeated calls" },
      { id: "live-render", label: "Live rendering" },
      { id: "suite", label: "Full HTML suite", primary: true },
    ],
    emptyResults: "No complete-HTML study has run yet.",
    footer:
      "Exact HTML parity gates every timing report. Live rendering includes synchronous DOM parsing, replacement, and forced layout, but not asynchronous paint.",
  };
}

export async function loadExample(context) {
  if (context.example.id !== "prettyM") {
    throw new Error(`prettyM controller received example ${context.example.id}`);
  }
  return requireController(globalThis.__prettyBenchApp, context.example.id);
}
