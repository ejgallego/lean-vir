# lean-zip raw-DEFLATE feasibility probe

Date: 2026-08-11

This probe evaluates whether lean-zip's production raw-DEFLATE entry point can
be packaged as Lean IR for the shared Vir interpreter. It now includes the
implementation that closes the fixed level-1 and full dispatcher boundaries,
plus runtime and native-output checks across levels 0 through 10 and the
high-entropy routing threshold. It remains a scoped acceptance result for the
checked corpus, not a claim over every possible input.

## Result

The stored-block, fixed level-1, and full-dispatcher roots all produce public
`:vir` package sets with zero missing IR, native externs, initializers, or host
imports. Vir now exposes an explicit `vir_extern_fallback` command for
transparent `@[extern] def`s. The lean-zip wrappers use it for their seven
project accelerators; the native compiler remains unchanged.

The fallback expansion exposed one additional core dependency,
`ByteArray.set`, which now uses its canonical runtime provider. The full wrapper
also opts into the Lean body of `UInt8.ofNatLT`; its proof-erased call shape is
not compatible with Lean's ordinary native wrapper. `Float.log2` uses an audited
WASI-libm provider. The strict Wasm link has zero unresolved symbols.

The checked-in acceptance harness compares 89 native/VIR compression vectors
over three passes in one interpreter. It covers levels 0 through 10 over empty,
short, repetitive, byte-cycle, and deterministic-noise inputs, plus a 1 MiB
high-entropy level-6 route. Twelve one-shot vectors add 32 KiB repeated-text and
64 KiB heterogeneous inputs at levels 5 through 10, crossing the split gate and
exercising the approximate- and exact-optimal dispatch paths. Every output is
byte-identical to native lean-zip and independently raw-inflates to its input.
Nine 1 MiB prescan vectors also produce identical native/VIR decisions around
the entropy threshold.

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
| fixed level 1 | 306 | 105 | 0 | 294,135 | runnable |
| full `deflateRaw` | 667 | 136 | 0 | 1,176,305 | runnable |

The stored row retains its original direct-package measurement. Its public
facet split the closure into a 2,262-byte root and a 4,201-byte dependency
member. The fixed package set has 24 members, a 15,846-byte root, 294,135 bytes
across members, and a 2,701-byte descriptor. The full set has 36 members, a
17,389-byte root, 1,176,305 bytes across members, and a 4,279-byte descriptor.

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
UInt8.ofNatLT        -- explicit Lean reference-body fallback
```

`UInt8.ofNatLT` initially appeared suitable for the generic native catalog, but
the levels matrix reached an indirect-call signature mismatch at level 7. Its
proof argument remains present in the interpreted call shape while Lean's
ordinary boxed wrapper uses a different erased ABI. Removing that registration
and selecting its transparent Lean body fixes the path without weakening native
lookup. No further ByteArray operation or initializer is missing.

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

The acceptance corpus exercises alphabet distributions on both sides of the
threshold. Native and VIR both classify alphabets 200, 203, 204, and 205 as
compressible, and 206, 207, 208, 224, and 256 as incompressible. The clear
1 MiB alphabet-256 case also produces byte-identical level-6 stored output.
This establishes routing agreement for the current native platform and WASI
SDK, including the observed 205/206 boundary. If exact cross-platform routing
is required rather than empirical agreement on supported platforms, the
prescan still needs a deterministic implementation shared by native and
interpreted builds.

## Runtime evidence and performance gate

A fresh rc2 `vir-upstream.wasm` was rebuilt in the default development profile
with all generic providers and zero strict unresolved symbols. The original
stored smoke still covers empty, four-byte, 257-byte, and 65,536-byte inputs,
including byte-for-byte RFC stored-block layout and repeated calls.

The maintained command is:

```bash
npm run accept:lean-zip -- /path/to/lean-zip
```

It builds a native oracle through a temporary Lake overlay without editing the
lean-zip checkout, generates one direct VIR package from the checked-in export
fixture, and runs every vector in one shared interpreter. The default three-pass
run checked 279 compression calls: 89 matrix vectors repeated three times plus
12 larger one-shot vectors. These calls represented 3,899,628 input bytes and
3,564,426 output bytes; the prescan set additionally scanned nine 1 MiB inputs.
The repeated-text outputs were 0.49% of their input size, and heterogeneous
outputs ranged from 65.51% to 66.95%, depending on level. Two observed runs took
136.90–156.70 seconds after setup. These figures include lifting, lowering,
assertions, and large-input scans and are acceptance telemetry, not a
compression throughput benchmark.

Wasm memory started at 145 pages, reached 318 after the larger compression and
prescan cases, then read 344 pages after each of the three matrix passes. The
harness now asserts that every pass after the first retains the first pass's
page count; `--passes 1` is available for a quicker diagnostic run but does not
make this steady-state assertion. This is a bounded repeated-pass result, not a
proof that every corpus has the same high-water mark.

Vir still does not expose interpreter fuel or per-declaration sampling through
the public runtime. The next performance gate is explicit hot-declaration
instrumentation, followed by a broader representative corpus and cross-platform
CI.

## Smallest next green slice

The level matrix, current-platform entropy boundary, larger compressible cases,
and repeated-pass memory check are green. The next smallest slice is lightweight
per-declaration timing or sampling around the upper-level paths so future work
can target measured interpreter hotspots. Broader corpus and cross-platform CI
remain necessary before treating the integration as universal acceptance.
