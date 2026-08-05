# ULC-0001 IR Declaration Lookup Boundary

Status: candidate
Kind: upstream-api
Priority: medium
Origin: upstream Lean backlog
Last reviewed: 2026-08-05
Owner: none
Issue: none linked
Lean PR: none linked
Upstream timing: once the API shape is justified
Removal target: VIR's `lean_ir_find_env_decl*` replacements; possibly the dummy environment and related policy shims if the real-environment path wins

## Summary

Decide whether VIR should construct a valid `Lean.Environment` and use the
interpreter's existing declaration lookup unchanged, or whether Lean's IR
interpreter should accept an explicit declaration provider for runtimes that
load real `Lean.IR.Decl` values without loading an environment.

Do not propose the provider API upstream until a bounded real-environment
experiment establishes why the default API is not an appropriate integration
path.

## Impact

VIR currently passes `lean_box(0)` as the `Lean.Environment` argument to
`lean::ir::run_boxed` and defines the two symbols the interpreter normally gets
from Lean:

- `lean_ir_find_env_decl`;
- `lean_ir_find_env_decl_boxed`.

This keeps the Wasm runtime small and lets `.irpkg` own executable declaration
loading, but symbol replacement hides an important dependency of the upstream
interpreter. A real environment could remove that interposition and improve
fidelity. Conversely, constructing one may pull environment, compiler-extension,
task, initialization, and module state into a runtime that otherwise needs only
decoded IR declarations.

The original local lookup problem is solved: correct `Name` hashes plus a
package-owned `lean::name_hash_map` made fresh entry 6.6x faster in the
independent acceptance run and halved sustained Illuminate callback time. This
card owns architectural cleanup. The later post-index resolution-cache
experiment is tracked separately in ULC-0002.

## Roadmap Decision

Keep the current indexed provider while measuring the real-environment path.
Prefer the existing upstream API if VIR can create a supported environment from
its decoded declarations with acceptable Wasm size, package-load cost, and
boundary complexity. Request an explicit provider API only if that experiment
shows that using the default environment contract requires a materially broader
runtime or reliance on private object representation.

Do not bundle cross-invocation symbol-cache state or provider revision into
this decision. The post-index profile selects that as a separately
instrumented experiment in
[ULC-0002](../ULC-0002-cross-entry-symbol-resolution-cache/README.md); its
profitability and API shape are not yet established.

## Reproduction Status

The current boundary is directly observable in
`wasm/upstream_shim/interpreter/interpreter_bridge.cpp`: it constructs
`elab_environment(lean_box(0))`, calls upstream `run_boxed`, and supplies both
declaration lookup symbols itself.

The pinned upstream lookup implementations are exported from
`Lean/Compiler/IR/CompilerM.lean`. They inspect `Lean.Environment` module
ownership and `Lean.IR.declMapExt`; they are not plain C++ map helpers. VIR's
minimal Wasm link does not include those generated Lean implementations.

Repository coverage includes 82 package fixtures and 16 runtime smoke tests.
The focused benchmark and the external Illuminate acceptance run both reproduce
the expected post-change profile movement.

## Why The Default API Is Not Directly Usable Today

1. VIR does not have a valid environment object. The scalar placeholder is safe
   only because the local shim intercepts every environment operation reached by
   the current interpreter path.
2. The default lookup implementation is generated Lean code backed by
   `Lean.IR.declMapExt`. VIR links the upstream C++ interpreter and a selected
   runtime subset, but not that compiler/environment implementation and its
   initialization closure.
3. Format-10 `.irpkg` packages contain executable `Lean.IR.Decl` objects,
   initializer metadata, host imports, and interface data. They do not contain a
   `Lean.Environment`, module ownership map, or persistent environment-extension
   state.
4. `run_boxed` reaches other environment policies as well: sorry-dependency
   lookup, initializer attributes, symbol mangling/package identity, and export
   names. VIR currently supplies narrow package-backed or inert implementations
   for these. Replacing only declaration lookup would not make the environment
   argument real.

These are facts about the current build, not proof that a real environment is
the wrong design.

## Real-Environment Experiment

Use upstream Lean construction APIs rather than fabricating the private
`Environment` object layout:

1. Build and initialize a valid empty `Lean.Environment` in the Wasm runtime.
2. Add the already-decoded package declarations to `Lean.IR.declMapExt` as local
   entries. This intentionally tests the smallest environment; it does not add
   an `.olean` or raw `.ir` module loader.
3. Pass that environment to unmodified `lean::ir::run_boxed` and use upstream
   `lean_ir_find_env_decl` and `lean_ir_find_env_decl_boxed`.
4. Inventory the generated Lean modules, runtime primitives, initializers, and
   local environment-policy shims that the path adds or removes.
5. Compare Wasm size, package-load time, and fresh-entry execution with the
   current provider using the same package bytes and order-balanced benchmark.
6. Run package reload/failure tests, all fixtures, and the Illuminate acceptance
   workload if the focused result remains competitive.

Adding declarations as local extension entries may be sufficient because the
default lookup falls back to `declMapExt.getState` when a name has no imported
module index. The experiment must verify this through the public Lean APIs and
normal extension initialization; directly constructing extension arrays in C++
would not count as an upstream-aligned result.

## Provider Alternative

If the real-environment experiment is not viable, the smallest upstream change
is a `run_boxed` overload that accepts caller-owned lookup state and full/boxed
declaration callbacks. The existing environment-backed entry point remains the
default. The provider is stable for one interpreter invocation, returns a
borrowed declaration or no result, and the interpreter retains declarations it
caches.

VIR would pass its existing package maps through this interface and delete its
replacement definitions of `lean_ir_find_env_decl*`. The API should not expose
`.irpkg`, VIR's index representation, or a persistent interpreter cache.

## Scope Boundary

This card does not own:

- loading `.olean` or Lean's raw `.ir` module format in the browser;
- full kernel, elaborator, or metaprogramming environment fidelity;
- persistent interpreter state or resolved-symbol caches, which belong to
  ULC-0002;
- a package-format change without separate measured evidence; or
- further declaration-lookup optimization after the accepted hash-map result.

## Expected Outcome

Resolve the card with one of two evidence-backed outcomes:

- VIR adopts a valid environment and the existing upstream declaration API,
  with the added code/initialization cost and deleted shims recorded; or
- the card is transferred upstream as an explicit-provider request, carrying a
  concrete account of why constructing an environment is disproportionate for
  a declaration-only runtime.

Either outcome must preserve package semantics and show no material regression
in the focused and representative workloads.

## Evidence

- [Environment lookup measurements and accepted design](../../../ENVIRONMENT_LOOKUP_PERFORMANCE.md)
- [Current upstream boundary](../../../UPSTREAM_BOUNDARY.md)
- [VIR interpreter bridge](../../../../wasm/upstream_shim/interpreter/interpreter_bridge.cpp)
- [Package declaration provider](../../../../wasm/upstream_shim/package/package_decl_provider.cpp)
- [VIR PR #104: benchmark, indexed provider, and acceptance record](https://github.com/ejgallego/lean-vir/pull/104)

The independent acceptance run measured 371.4 to 56.2 microseconds for fresh
entry, 12.35 to 9.21 milliseconds for package loading, 1.10 to 0.545
milliseconds for sustained 60 Hz callbacks, and zero DOM mismatches or browser
errors across eight order-balanced A/B runs.

## Current Workaround

Keep the package-owned declaration and boxed-declaration maps behind
`decl_provider.h`, keep the dummy environment confined to the interpreter
bridge, and keep all environment-policy replacements explicit in
`wasm/upstream_shim/`. Do not patch the vendored upstream interpreter while the
integration decision remains open.
