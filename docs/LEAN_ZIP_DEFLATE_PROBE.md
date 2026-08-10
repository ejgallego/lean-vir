# lean-zip raw-DEFLATE feasibility probe

Date: 2026-08-10

This probe evaluates whether lean-zip's production raw-DEFLATE entry point can
be packaged as Lean IR for the shared Vir interpreter. It now includes the
implementation that closes the fixed level-1 and full dispatcher boundaries,
plus runtime and native-output checks. It is not yet an acceptance result for
all levels 0 through 10 or the high-entropy routing threshold corpus.

## Result

The stored-block, fixed level-1, and full-dispatcher roots all produce public
`:vir` package sets with zero missing IR, native externs, initializers, or host
imports. Vir now exposes an explicit `vir_extern_fallback` command for
transparent `@[extern] def`s. The lean-zip wrappers use it for their seven
project accelerators; the native compiler remains unchanged.

The fallback expansion exposed one additional core dependency,
`ByteArray.set`, which now uses its canonical runtime provider. The generic
native catalog also registers `UInt8.ofNatLT` and an audited WASI-libm
`Float.log2` provider. The strict Wasm link has zero unresolved symbols. Fixed
level 1 and full levels 1 and 6 execute through the shared runtime, raw-inflate
back to the input, and produce exactly the same bytes as native lean-zip for
the checked 81-byte corpus.

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
has a legacy-source path. The marked stored wrapper emits a two-member package
set. After adding explicit fallback declarations, Lean Beam reports zero
diagnostics for both `Zip.VirProbeLevel1` and `Zip.VirProbeFull`, and
`lake build Zip.VirProbeLevel1:vir Zip.VirProbeFull:vir` completes successfully.

## Closure results

Each wrapper has the public interface `(ByteArray, UInt8) -> ByteArray`. All
three closures have one interface export, zero JavaScript host imports, zero
initializer globals, zero unsupported initializer globals, and zero missing IR
declarations.

| Root | Lean IR declarations | Registered native externs | Missing native externs | Package-set bytes | Status |
| --- | ---: | ---: | ---: | ---: | --- |
| level 0 stored | 6 | 14 | 0 | 5,769 | runnable |
| fixed level 1 | 306 | 105 | 0 | 294,047 | runnable |
| full `deflateRaw` | 665 | 136 | 0 | 1,175,981 | runnable |

The stored row retains its original direct-package measurement. Its public
facet split the closure into a 2,262-byte root and a 4,201-byte dependency
member. The fixed package set has 24 members, a 15,758-byte root, 294,047 bytes
across members, and a 2,701-byte descriptor. The full set has 36 members, a
17,065-byte root, 1,175,981 bytes across members, and a 4,279-byte descriptor.

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

### Fixed level-1 fallback boundary

The fixed level-1 root opts into the Lean bodies of these six lean-zip project
externs, even though five live in the `ByteArray` namespace:

```text
ByteArray.pushUInt64LE
ByteArray.ugetUInt32LE
ByteArray.ugetUInt64LE
UInt64.ctzFast
ByteArray.usetUInt64LE
ByteArray.usetUInt32LE
```

Their bodies add `ByteArray.set` to the generic native closure. With that
provider registered, the root has no missing declaration or initializer gap.
`UInt32.log2Clz` is not reached by this fixed level-1 path.

### Full-dispatcher boundary

The full root reaches all six level-1 fallbacks and additionally:

```text
UInt32.log2Clz       -- explicit Lean reference-body fallback
Float.log2           -- audited standard WASI-libm provider
UInt8.ofNatLT        -- canonical standard primitive provider
```

No further ByteArray operation or initializer is missing.

## Project-local extern strategy

Vir now implements the explicit package-local route as the
`vir_extern_fallback` command. It requires an `@[extern] def` with a transparent
kernel body and rejects bodyless, opaque, duplicate, and directly recursive
requests. The command compiles a deterministic private clone without the extern
attribute. Export validation follows that clone, so newly exposed dependencies
are checked at the marker.

Package lookup gives the fallback precedence over a local or imported extern
declaration. It emits an adapter at the original name, calls the clone, and
bridges borrowed/owned reference parameters with explicit increments and
decrements. This preserves the original extern IR call contract rather than
renaming a body with a potentially different inferred borrow signature. The
clone remains in the closure but is excluded from `--target-all` roots.

Unlisted externs still follow the static declared-symbol allowlist. No dynamic
lookup or lean-zip-specific runtime registry was added. Package reports identify
each adapter as a `Lean reference body for <name>`.

## `Float.log2` fidelity

Lean rc2 declares `Float.log2` as `@[extern "log2"] opaque`, so there is no
reference body for the package generator to select. Vir now statically
registers its canonical C symbol. A WASI SDK 33 strict-link A/B probe resolved
it with zero unresolved symbols. Its isolated release cost is 3,019 raw bytes
and 2,512 bytes under deterministic gzip.

This preserves the closed lookup policy, but platform libm implementations are
not guaranteed to produce identical last bits. Since lean-zip compares the
computed entropy with a route-selection threshold, exact route equality for
every possible input cannot be claimed from the API contract alone.

Before accepting the full dispatcher, compare both the prescan decision and
compressed bytes against native lean-zip on high-entropy inputs around the
threshold. If exact cross-platform routing is required rather than empirical
agreement on the supported corpus, the prescan needs a deterministic
implementation shared by native and interpreted builds.

## Runtime evidence and performance gate

A fresh rc2 `vir-upstream.wasm` was rebuilt in the default development profile
with all generic providers and zero strict unresolved symbols. The original
stored smoke still covers empty, four-byte, 257-byte, and 65,536-byte inputs,
including byte-for-byte RFC stored-block layout and repeated calls.

The fixed and full package sets were then loaded through the current Node
runtime. On the 81-byte repeated-text input, fixed level 1 and full level 1 both
produced 50 bytes; full level 6 produced 47 bytes. All three independently
round-tripped through `node:zlib.inflateRawSync`. A linked native lean-zip
executable produced byte-identical output for all three cases. The three-runtime
Node process completed in 6.8 seconds; this includes package loading and process
startup and is not a per-call benchmark.

Vir still does not expose interpreter fuel or per-declaration sampling through
the public runtime. The next performance gate is repeated fixed/full calls in
one interpreter instance with wall time, Wasm memory growth, and explicit hot
declaration instrumentation. High-entropy inputs around the `Float.log2`
prescan threshold remain required for route-fidelity acceptance.

## Smallest next green slice

The fixed level-1 and full dispatcher slices are now green for package closure
and the checked runtime corpus. The next smallest acceptance slice is a shared
runtime loop over levels 0 through 10 with native byte comparison and memory
tracking, followed by the high-entropy threshold corpus for `Float.log2` route
fidelity. Until those checks land, the result establishes that lean-zip can run
through VIR, not that every compression level is fully accepted.
