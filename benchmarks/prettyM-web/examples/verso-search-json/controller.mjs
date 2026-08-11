import { requireController } from "../controller-contract.mjs";
import { createController } from "./app.mjs";

export const view = {
  eyebrow: "Real client · direct JSON boundary",
  intro:
    "Compare Verso's generated JavaScript xref mappers with Lean running through VIR's owned structural and borrowed-handle JSON lanes.",
  progress: "Loading pinned xref fixtures and VIR artifacts…",
  artifacts: {
    copy:
      "Each variant retains its own mapper package, runtime provenance, fixture hashes, and phase-separated measurements.",
  },
  backendDescription:
    "JavaScript is the semantic oracle. The selected variant runs either the bulk owned lane or the identity-preserving borrowed lane.",
  protocolDescription:
    "The committed protocol uses five warm-ups and thirty measured calls per real generated fixture; timings remain observational on uncontrolled machines.",
  controls: [
    { id: "warmup", label: "Warm-up rounds", min: 0, max: 20, value: 5 },
    { id: "samples", label: "Measured rounds", min: 1, max: 100, value: 30 },
  ],
  studyDescription:
    "Quick parity checks all ten domains once. The benchmark repeats both fixtures and reports lower, execute, lift, host, total, and Wasm-page observations.",
  studies: [
    { id: "smoke", label: "Quick parity" },
    { id: "benchmark", label: "Measured replay", primary: true },
  ],
  emptyResults: "No Verso JSON-lane study has run yet.",
  footer:
    "Owned JSON is the bulk-computation lane; borrowed handles target sparse inspection and opaque JavaScript reference passthrough.",
  bootstrap: {
    artifactScripts: [],
    classicScripts: [],
  },
};

export async function loadExample(context) {
  if (context.example.id !== "verso-search-json") {
    throw new Error(
      `Verso JSON controller received example ${context.example.id}`,
    );
  }
  return requireController(createController(context), context.example.id);
}
