# Native-boundary tooling

This directory owns repository-local tooling for the Lean-to-Wasm native
boundary. The stable entry points are the npm commands documented in
`docs/HARNESS.md`; direct script paths are implementation details.

- `check-boundary-registry.mjs` generates and validates the shim registry from
  Lean's native-extern catalog.
- `inventory-native-wrappers.mjs` classifies shim-owned boxed adapters and
  enforces the explicit handwritten exception set.
- `native-symbol-registry.mjs` is the pure registry transformation shared by
  those commands; its focused contracts live under `tests/native/`.
- `check-ir-codec-tags.mjs` and `ir-codec-tags.mjs` validate the declaration-IR
  tag map and generate its C++ header.
- `demo-host-import-targets.mjs` records the complete demo host-import surface.
- `object-abi-linker-flags.mjs` derives linker exports from the browser
  runtime's object ABI manifest.

Generated headers stay below `build/generated/`. Shim implementation sources
remain under `wasm/upstream_shim/`, and Lean-side declarations remain under
`Vir/GeneratePackage/`.
