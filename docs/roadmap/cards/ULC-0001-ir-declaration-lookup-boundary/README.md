# ULC-0001 IR Declaration Lookup Boundary

Status: ready-to-transfer
Kind: upstream-api
Priority: medium
Origin: upstream Lean backlog
Last reviewed: 2026-08-09
Owner: none
Issue: none linked
Lean PR: none linked
Upstream timing: API request is justified; prepare the upstream card
Removal target: VIR's `lean_ir_find_env_decl*` replacements; the dummy environment and other policy shims remain separate follow-up boundaries

## Summary

Ask Lean's IR interpreter to accept an explicit declaration provider for
runtimes that already own real `Lean.IR.Decl` values. Keep the existing
environment-backed entry point unchanged. A bounded real-environment experiment
now establishes why constructing the compiler environment is disproportionate
for VIR's declaration-only runtime.

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

Keep the current indexed provider and prepare an upstream explicit-provider API
request. ULC-0001's real-environment candidate is correct, but the current
public construction path is disproportionate for a declaration-only runtime:
it adds 3.29 MiB to the stripped Wasm file, raises package loading by roughly
60%, and slows steady fresh-entry execution by roughly 19%.

The experiment does not argue against `Lean.Environment` for normal Lean
consumers. It shows that requiring VIR to initialize the compiler's complete
environment-extension closure merely to provide already-decoded
`Lean.IR.Decl` values is the wrong boundary. Keep the existing
environment-backed entry point as Lean's default and add a caller-owned
declaration-provider path.

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

Repository coverage includes 88 package fixtures and 18 runtime smoke tests.
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

The experiment used upstream Lean construction APIs rather than fabricating
the private `Environment` object layout:

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
6. Run package reload/failure tests and all fixtures before interpreting the
   focused result.

Adding declarations as local extension entries was sufficient because the
default lookup falls back to `declMapExt.getState` when a name has no imported
module index. The prototype verified this through public Lean APIs and normal
extension initialization rather than directly constructing extension arrays in
C++.

## Measured Outcome

The checkpointed prototype uses `Lean.mkEmptyEnvironment`, inserts decoded
declarations with `Lean.IR.declMapExt.addEntry`, mirrors initializer metadata
with `Lean.regularInitAttr.setParam`, passes the resulting environment to
unmodified `lean::ir::run_boxed`, and links upstream
`lean_ir_find_env_decl*` and `lean_decl_get_sorry_dep`. It is retained on the
separate `feat/real-environment-experiment` branch and is not part of the
recommended production change.

Both artifacts use Lean `d8b18978322de05a8f3dba51ef03cf5461676c17`, the
`wasm32-wasip1` target, `-O3`, and the same package bytes. The complete upstream
smoke suite passes for both: `fib 17 = 1597`, the Lean DOM and React demos,
editable SortDemo, and all 88 fixtures.

| Measurement | Indexed provider | Real environment | Candidate delta |
| --- | ---: | ---: | ---: |
| Stripped release Wasm | 657,333 B | 4,107,316 B | +3,449,983 B (+524.8%) |
| Release Wasm, gzip -9 -n | 150,177 B | 753,638 B | +603,461 B (+401.8%) |
| Fresh entry, paired run 1 | 168.7 us | 217.3 us | +20.2% paired median |
| Fresh entry, paired run 2 | 163.3 us | 193.4 us | +18.1% paired median |
| Package load, paired run 1 | 27.28 ms | 44.74 ms | +58.9% paired median |
| Package load, paired run 2 | 20.99 ms | 35.79 ms | +61.0% paired median |

The final differential measurements load both frozen artifacts in one Node
process and alternate their order inside every measured round. Each of two
repetitions used the same 1,651 declarations, 5,000 fresh entries per
observation, 20 fresh package loads per load observation, four warmups, and 30
measured rounds. V8 collection, runtime construction, Wasm instantiation, and
disposal remain outside the timed windows. The candidate was slower in 28/30
and 23/30 fresh-entry rounds, and 28/30 package-load rounds in both repetitions.
The paired geometric-mean deltas were +28.6% and +18.9% for fresh entry, and
+62.7% and +62.6% for package load. The paired medians above are the less
outlier-sensitive headline. Both candidates produced identical checksums in
every round. Timings are noisy evidence; the repeated order-balanced direction,
not the last decimal place, supports the decision.

The exact stripped artifacts were SHA-256
`b1de481b7828f5dcb20679a50839d2707b693748b93e6fec21e839704e0380e3`
for the control and
`2ac027158c35716915d5d47129abf361f263a6687da4f5f9610e3ce6f34ae4ca`
for the candidate. The package SHA-256 was
`627a07e66aa8bc6bae408bd1e9f9769e2bb69774f64fb5c6bd6fc2bb750831f6`.
These identities and the byte counts are deterministic evidence.

The deterministic size attribution is also clear:

- importing the current public `Lean.Compiler.IR.CompilerM` boundary has a
  579-module generated-C closure;
- the candidate native-support prelink has 586 inputs and 585 retain code or
  data in the final Wasm because adapter initialization roots their module
  initializers;
- all 3,517,396 retained native-support bytes map back to source objects with no
  unattributed bytes;
- the largest retained modules are `Lean.Meta.WHNF` (264,095 B),
  `Lean.Meta.Basic` (234,676 B), `Init.Data.Order.PackageFactories` (173,356 B),
  `Lean.Meta.Instances` (149,738 B), and `Lean.Meta.InferType` (131,872 B).

This is a lower-bound experiment. To make the compiler initialization closure
link in WASI, the candidate still supplies narrow stubs for unused task, Meta,
profiling, stream, and diagnostic services and links four additional kernel C++
helpers. Replacing those stubs with full implementations would broaden the
runtime further.

The experiment exposed three additional boundary facts:

1. A declaration map alone does not supply module/package ownership or extern
   and export attributes, so VIR must still provide its restricted native-symbol
   policy; a minimally populated environment cannot replace every current shim.
2. `Lean.Compiler.InitAttr` declares the external `lean_run_init` with four Wasm
   arguments while the C++ interpreter exports a five-argument implementation.
   The candidate does not execute the mismatched generated call sites, but the
   strict Wasm link reports the ABI collision. This is another reason not to
   expose the entire compiler-initialization surface to the small runtime.
3. Exercising upstream sorry-dependency lookup found an existing decoder bug:
   VIR materialized the one-field `Lean.IR.DeclInfo` and `ExternAttrData`
   structures with an extra constructor. Lean erases these structures to their
   single fields. The independent fix now has direct object-layout regression
   coverage.

## Provider Alternative

The smallest upstream change is a `run_boxed` path that accepts a declaration
provider. Its contract should be deliberately narrow:

- leave the existing environment-backed API unchanged and implement its lookup
  through an environment-backed provider adapter;
- bind one provider to one interpreter invocation;
- expose exact-name lookup and the optimized boxed-name lookup as distinct
  operations, preserving the current cheap negative boxed lookup;
- let the provider return a borrowed declaration or no result, while requiring
  the interpreter to retain any declaration stored in an interpreter cache;
- preserve the current pre-execution sorry check by reading `DeclInfo.sorryDep?`
  from the exact declaration, or by an equally explicit provider operation; and
- avoid `.irpkg`, package-index representation, cache revisions, or
  cross-invocation state in the upstream contract.

VIR would pass its existing package maps through this interface and delete its
replacement definitions of `lean_ir_find_env_decl*`. Native symbol, initializer,
export-name, and package-identity policy should not be folded into this first
declaration-provider API; they remain explicit, separately reviewable
boundaries.

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

The measured outcome is the second: transfer the card upstream as an
explicit-provider request. The checkpointed prototype remains a reproducible
experiment, but it is not a proposed production architecture. The provider
design must preserve package semantics and leave the environment-backed API
unchanged.

## Evidence

- [Environment lookup measurements and accepted design](../../../ENVIRONMENT_LOOKUP_PERFORMANCE.md)
- [Current upstream boundary](../../../UPSTREAM_BOUNDARY.md)
- [VIR interpreter bridge](../../../../wasm/upstream_shim/interpreter/interpreter_bridge.cpp)
- [Package declaration provider](../../../../wasm/upstream_shim/package/package_decl_provider.cpp)
- [IR metadata layout regression](../../../../wasm/upstream_shim/package/package_ir_builders_test.cpp)
- [In-process paired Wasm benchmark](../../../../scripts/bench-env-lookup-wasm-pair.mjs)
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
provider API is discussed upstream.
