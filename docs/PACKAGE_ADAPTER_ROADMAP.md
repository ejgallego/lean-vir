# Generated Package Adapter Roadmap

This note tracks the optional generated JavaScript adapter layer for `.irpkg`
packages. The embedded manifest remains the source of truth; generated code
should be a consumer of the manifest, not a replacement.

## Goal

Keep dynamic manifest-driven loading available while offering package-specific
adapters that expose typed JavaScript calls, exact host-binding expectations,
and exact Wasm export requirements.

## Proposed Shape

For a package `foo.irpkg`, package generation may also emit an optional
JavaScript module such as `foo.irpkg.mjs` or `foo.adapter.mjs` with:

- `requiredWasmExports`;
- host imports and their boundary modes;
- typed wrappers for manifest exports;
- precomputed lower/lift plans or generated lower/lift functions;
- package metadata and manifest version assertions.

Adapters should use the same manifest schema version as the embedded manifest
and the runtime should fall back to the generic manifest interpreter when an
adapter is absent.

## Expected Advantages

- Better SDK ergonomics, for example `pkg.fib(12)` instead of
  `runtime.call("fib", 12)`.
- Exact object ABI requirement data for reduced Wasm export profiles.
- Less generic descriptor interpretation on hot call paths.
- Clearer host binding diagnostics.
- A place to cache generated conversion plans without removing manifest
  introspection.

## Constraints

- Do not remove embedded manifests; they power inspection, dev UI,
  diagnostics, and arbitrary package loading.
- Do not require generated JavaScript for local `.irpkg` workflows.
- Keep the generated adapter versioned against manifest and runtime ABI
  versions.
- Treat per-package Wasm or C generation as a later, separate architecture
  decision.

## Backlog

1. Add a manifest-to-adapter generator that emits an optional ES module.
2. Add runtime API for loading an adapter beside an `.irpkg` and validating it
   against the embedded manifest.
3. Move object ABI export requirement computation into a reusable descriptor
   planner.
4. Have adapters export `requiredWasmExports` and use that data in smoke tests.
5. Explore Wasm export profiles driven by adapter requirements.
