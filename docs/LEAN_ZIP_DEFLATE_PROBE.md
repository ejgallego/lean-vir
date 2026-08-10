# lean-zip raw-DEFLATE feasibility probe

Date: 2026-08-10

This probe evaluates whether lean-zip's production raw-DEFLATE entry point can
be packaged as Lean IR for the shared Vir interpreter. It is a compatibility
and closure report, not an acceptance result for levels 0 through 10.

## Result

The stored-block root is a green first slice. Its public `:vir` facet build has
no missing IR, native externs, initializers, or host imports, and its two-member
package set runs repeatedly through the current shared Wasm runtime. The fixed
level-1 root is blocked by six project-local `@[extern]` declarations. The full
dispatcher is blocked by those six, the seventh lean-zip accelerator, the
opaque `Float.log2` primitive, and one standard primitive registration,
`UInt8.ofNatLT`.

The current package generator cannot select the Lean reference body of an
imported project-local extern. Adding an explicit, package-scoped reference-body
fallback is the preferred portable extension. It would keep runtime native
lookup closed and would cover all seven lean-zip accelerators. `Float.log2`
needs a separate audited libm provider or a deterministic source-level
alternative because its Lean declaration is opaque.

## Exact revisions and source compatibility

- lean-zip source: `feat/vir-fir-wasm-port` at
  `9bc0e7d28691223e669474ffdf4ed1041d2522b5`, originally pinned to
  `leanprover/lean4:v4.33.0-rc1`.
- Vir source: `feat/lean-zip-deflate-probe` at base
  `607ef30cf7e93a8adf732d0907009f1aa6865489`, pinned to
  `leanprover/lean4:v4.33.0-rc2`.
- Producer and runtime revision used for all reported IR:
  `leanprover/lean4:v4.33.0-rc2`, Lean commit
  `d8b18978322de05a8f3dba51ef03cf5461676c17`.

A clean local snapshot of the lean-zip source and its already-present pinned
`zipCommon` source compiled under rc2. In particular,
`lake build Zip.Native.DeflateDynamic` completed all 47 jobs; the target itself
took 432 seconds. There were no source incompatibilities, only the existing
lint warnings. No remote dependency was fetched and no rc1 `.olean` or IR was
used in the closure results.

Lean rejects a new-module wrapper importing lean-zip's legacy, non-`module`
files. This does not block the existing integration: Vir's public `:vir` facet
has a legacy-source path. After marking the stored wrapper with `@[vir_export]`,
`lake build +Zip.VirProbeStored:vir` completed all 78 jobs and emitted a
two-member package set. The direct fixed/full closure analysis used the same
legacy frontend in one exact rc2 environment. Lean Beam reported zero
diagnostics for the marked stored wrapper; marking the fixed level-1 wrapper
was rejected at its first expected blocker, `ByteArray.pushUInt64LE`, so the
direct analyzer was used to enumerate the complete missing set.

## Closure results

Each wrapper has the public interface `(ByteArray, UInt8) -> ByteArray`. All
three closures have one interface export, zero JavaScript host imports, zero
initializer globals, zero unsupported initializer globals, and zero missing IR
declarations.

| Root | Lean IR declarations | Registered native externs | Missing native externs | Single-package bytes | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| level 0 stored | 6 | 14 | 0 | 5,769 | runnable |
| fixed level 1 | 288 | 104 | 6 | 268,470 | blocked |
| full `deflateRaw` | 645 | 132 | 9 | 1,142,545 | blocked |

The stored row is the direct single-package serialization. The public facet
split the same closure into a 2,262-byte root and a 4,201-byte dependency member
(6,463 bytes total, plus its 267-byte descriptor); those are the artifacts used
by the runtime smoke. The two blocked byte counts come from diagnostic packages
emitted only after admitting unresolved metadata. They are useful closure-size
estimates, but those payloads are not loadable acceptance artifacts.

### Level-0 native inventory

The stored root reaches exactly these 14 registered natives:

```text
ByteArray.size
Nat.add
Nat.decLe
UInt16.ofNat
UInt16.xor
UInt16.land
UInt16.toUInt8
UInt16.shiftRight
Array.mkEmpty
Array.push
ByteArray.mk
ByteArray.extract
ByteArray.copySlice
Nat.sub
```

There are no missing standard ByteArray operations or initializers at level 0.

### Fixed level-1 blockers

The fixed level-1 root has no missing standard-library ByteArray operation and
no initializer gap. Its six missing names are all lean-zip project externs,
even though five live in the `ByteArray` namespace:

```text
ByteArray.pushUInt64LE
ByteArray.ugetUInt32LE
ByteArray.ugetUInt64LE
UInt64.ctzFast
ByteArray.usetUInt64LE
ByteArray.usetUInt32LE
```

`UInt32.log2Clz` is not reached by this fixed level-1 path.

### Full-dispatcher blockers

The full root reaches all six level-1 blockers and additionally:

```text
UInt32.log2Clz       -- lean-zip project extern with a Lean body
Float.log2           -- standard opaque extern
UInt8.ofNatLT        -- standard primitive registration gap
```

No further ByteArray operation or initializer is missing.

## Project-local extern strategy

Vir cannot currently opt into a reference body for an imported `@[extern]`
definition. The frontend deliberately omits imported non-host
`Lean.IR.Decl.extern`
declarations from its declaration index. Closure resolution then accepts only
names in the static `nativeExternSpecs` table, and the shared Wasm contains only
the corresponding statically generated wrappers. The existing
`resolveNativeExternsWithExtras` helper can extend wrapper or surface analysis
for declarations already present in its environment, but it neither changes
package closure's static lookup nor supplies project code to the shared Wasm.

The smallest general extension should be an explicit package-generation option
listing project-local externs whose Lean bodies may be used. For each selected
name, generation should:

1. require an `@[extern] def` with a kernel body in the exact producer
   environment, rejecting opaque and bodyless declarations;
2. compile that body as ordinary Lean IR while suppressing extern lowering for
   this declaration only, retaining the original Lean name and signature;
3. validate the resulting IR signature and ownership behavior, include its
   ordinary dependency closure, and record the fallback and its source
   provenance in the package report; and
4. leave unlisted externs on the existing declared-symbol allowlist path.

This needs no dynamic symbol lookup and no permanent lean-zip entries in the
generic runtime. All seven named lean-zip accelerators are definitions with
trusted Lean reference bodies, so they are candidates for this route.

If compiling a reference body is not practical, the fallback extension point
is a package-declared provider registry that is validated while generating the
shared runtime. That is less portable: an `.irpkg` cannot itself deliver native
code to an already-built shared Wasm, so every provider would still have to be
linked into and allowlisted by that runtime.

## `Float.log2` fidelity

Lean rc2 declares `Float.log2` as `@[extern "log2"] opaque`, so there is no
reference body for the package generator to select. A statically registered
WASI-libm provider is the smallest Vir-local implementation. It preserves the
closed lookup policy, but platform libm implementations are not guaranteed to
produce identical last bits. Since lean-zip compares the computed entropy with
a route-selection threshold, exact route equality for every possible input
cannot be claimed from the API contract alone.

Before accepting the full dispatcher, compare both the prescan decision and
compressed bytes against native lean-zip on high-entropy inputs around the
threshold. If exact cross-platform routing is required rather than empirical
agreement on the supported corpus, the prescan needs a deterministic
implementation shared by native and interpreted builds.

## Runtime evidence and performance gate

A fresh rc2 `vir-upstream.wasm` was built from this worktree in the default
development profile with 55 objects and zero strict unresolved symbols. The
facet-built stored package set was then loaded through the current worktree's
Node runtime. The smoke exercised empty, four-byte, 257-byte, and 65,536-byte
inputs, including the stored-block boundary; it checked byte-for-byte RFC
stored-block layout, independent `node:zlib` raw-inflate round trips, and 12
repeated calls in one interpreter instance. The complete process took 0.08
seconds with a 74,584 KiB maximum RSS. These process-level figures include Node
startup and are sanity evidence, not a per-call benchmark.

Level-1 interpreter fuel, runtime memory, and hot-declaration costs cannot be
measured honestly until its six externs resolve and the package is runnable.
Vir also does not currently expose an interpreter-fuel or per-declaration
sampling counter through the public runtime. The closure paths suggest the
merged LZ77 loop, chain walk, direct-head updates, and bit/frequency emission as
instrumentation candidates, but that is static evidence rather than a timing
claim. The 432-second Lean build and closure-generation memory are compiler
costs and must not be reported as interpreter costs.

The next performance gate should therefore be a clean fixed-level-1 package,
followed by repeated calls in one shared interpreter instance with wall time,
Wasm memory growth, and explicit per-declaration/fuel instrumentation. Only
then should the 645-declaration full graph be benchmarked.

## Smallest next green slice

The immediate green slice is level 0: the public legacy-source facet and shared
runtime are already green. Keep the two-line JavaScript adapter around
`runtime.call` and add native lean-zip byte equality to the already-green
stored-layout and inflate checks. It needs no runtime native additions.

The next implementation slice should target fixed level 1 only: add the
package-scoped Lean reference-body option for its six project externs, require a
zero-missing closure, and collect the requested runtime cost evidence. Defer
`UInt32.log2Clz`, `Float.log2`, `UInt8.ofNatLT`, the full dispatcher, and levels
2 through 10 until that slice is green. Overall acceptance remains pending
byte equality for levels 0 through 10 and the high-entropy prescan corpus.
