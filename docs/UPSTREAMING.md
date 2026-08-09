# VIR Upstreaming Strategy

Status: Living
Owner: VIR maintainers
Last reviewed: 2026-08-10
Technical source: [UPSTREAM_BOUNDARY.md](UPSTREAM_BOUNDARY.md)

## Principle

The goal is not to upstream VIR as one undifferentiated feature. VIR should
contribute small general-purpose interfaces and portability improvements when
they reduce private glue, preserve existing Lean behavior, and have a credible
consumer beyond one browser demo.

The current strongest architectural fact is that VIR compiles Lean's real
`ir_interpreter.cpp` unmodified. Local package, platform, native-symbol, and
JavaScript behavior remains in `wasm/upstream_shim/` and `web/`.

## Component Disposition

| Component | Current position | Likely destination | Evidence required |
| --- | --- | --- | --- |
| `wasm32-wasip1` build and platform guards | Candidate for incremental upstream patches | Lean upstream | Defined semantics, focused tests, and maintainable CI |
| Static native-symbol registration | Possible generic embedded-runtime mechanism | Evaluate with Lean upstream | A clean abstraction and use beyond VIR-specific host imports |
| Explicit IR declaration-provider seam | Measured and ready for upstream feasibility feedback | Lean upstream or remain internal | Review of the narrow provider contract, ownership semantics, and upstream maintenance expectations |
| `.irpkg` encoding and loader | VIR product mechanism | VIR | Package evolution and upgrade evidence from pilots |
| JavaScript object, resource, and callback ABI | Product integration | VIR | Browser compatibility and lifecycle evidence |
| DOM, Canvas, React, and ProofWidgets bindings | Application libraries | VIR or separate downstream libraries | Sustained named use cases |
| General dynamic native lookup | Not proposed | None | A concrete runtime case plus an explicit restricted security policy |

## Candidate 1: WASI Portability

VIR currently selects and cross-compiles a viable subset of Lean's runtime,
generates local configuration overlays, disables mimalloc for this target, and
provides focused platform/runtime implementations or stubs. The strict final
link has zero unresolved symbols.

Plausible upstream work includes:

- recognizing `wasm32-wasip1` in Lean's build configuration;
- compile-time guards for unavailable threads, dynamic loading, filesystem,
  and platform services;
- defined WASI behavior for timing, diagnostics, interruption, and unsupported
  operations;
- a static native-symbol registration mechanism suitable for embedded builds;
- normal generation of Lean configuration headers for the target; and
- a small CI test that builds and executes an IR declaration under a WASI
  engine.

The risk is semantic dishonesty. VIR's inert demo tracing, heartbeat, and
environment hooks are acceptable only within its documented single-threaded
pilot boundary. Upstream behavior must be implemented, explicitly unsupported,
or fail clearly rather than silently becoming a no-op.

## Candidate 2: Declaration Provider

The upstream interpreter currently calls link-time functions to find ordinary
and boxed IR declarations in an elaboration environment. VIR implements those
functions by delegating to a package-backed provider while leaving the
interpreter unchanged.

A generic upstream interface could make the provider explicit—for example, as
an argument or context accepted by an interpreter entry point. The existing
environment lookup would remain the default. This could support in-memory
tests, embedded runtimes, or alternative module and cache loaders.

Only declaration lookup is plausibly generic today. A real-environment
experiment using Lean's public construction path added 3,449,983 bytes
(524.8%) to the stripped Wasm, increased package loading by roughly 60%, and
slowed steady fresh-entry execution by roughly 19%. The experiment therefore
supports a narrow caller-owned declaration-provider path while retaining the
existing environment-backed entry point.

VIR's package call slots,
host-import metadata, manifests, package generations, and `.irpkg` decoding
should not leak into that interface.

The design risk remains that the interpreter also depends on environment-owned
sorry checks, initializer metadata, tracing, options, native symbols, and
caches. The experiment showed that those concerns should not be collapsed into
one broad environment abstraction. The proposed first seam should cover exact
declaration lookup and sorry metadata only; native policy, package identity,
initializer policy, and cross-entry caches remain separate questions. Full
evidence is preserved in
[ULC-0001](roadmap/cards/ULC-0001-ir-declaration-lookup-boundary/README.md).

## Proposal Sequence

1. Ask upstream for feasibility feedback on the component disposition, not
   approval of a complete VIR design.
2. Submit self-contained portability fixes and tests first where semantics are
   clear.
3. Evaluate static native registration separately.
4. Present ULC-0001's measured declaration-provider design for feasibility
   feedback; do not bundle the separate cross-entry cache experiment.
5. Keep package and browser APIs external unless another upstream use case
   changes the boundary.

The coordination work is tracked by
[C-002](project-review/cards/active/C-002-upstream-feasibility.md). Any code
proposal should become a separate bounded card after upstream feedback.

## Upstreaming Risks

- Lean IR data and object layouts are internal and can change with Lean.
- A new provider API could become a compatibility commitment before its true
  requirements are known.
- WASI support expands the build and test matrix.
- Platform no-ops that are safe for a demo may be incorrect for general Lean
  programs.
- Upstream may reasonably consider browser packaging and host integration too
  product-specific.
- Without named long-term ownership, upstreaming can transfer rather than
  reduce maintenance risk.
