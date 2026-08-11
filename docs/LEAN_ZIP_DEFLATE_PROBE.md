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
uses a dedicated native registration for `UInt8.ofNatLT`; its shared raw symbol
with `UInt8.ofNat` requires a distinct compiler-generated lookup stem.
`Float.log2` uses an audited WASI-libm provider. The strict Wasm link has zero
unresolved symbols.

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

- Final lean-zip consumer source: `feat/vir-fir-wasm-port` at
  `f244c00a1d7ad837563b560633542755d154c654`, pinned upstream to
  `leanprover/lean4:v4.33.0-rc1`. The final compatibility checkout changed only
  `lean-toolchain` from rc1 to rc2; `git status --short` reported that single
  tracked modification.
- Initial feasibility source: the same branch at
  `9bc0e7d28691223e669474ffdf4ed1041d2522b5`. The production compression core
  measured below is unchanged in the final consumer commit.
- Vir source: `feat/lean-zip-deflate-probe` at base
  `607ef30cf7e93a8adf732d0907009f1aa6865489`, pinned to
  `leanprover/lean4:v4.33.0-rc2`.
- Producer and runtime revision used for all reported IR:
  `leanprover/lean4:v4.33.0-rc2`, Lean commit
  `d8b18978322de05a8f3dba51ef03cf5461676c17`.

A detached compatibility worktree can be reproduced without editing the
lean-zip integration branch:

```bash
git -C /path/to/lean-zip worktree add --detach /tmp/lean-zip-rc2 \
  f244c00a1d7ad837563b560633542755d154c654
sed -i 's/v4.33.0-rc1/v4.33.0-rc2/' /tmp/lean-zip-rc2/lean-toolchain
npm run accept:lean-zip -- /tmp/lean-zip-rc2 --passes 3 --keep
npm run accept:lean-zip -- /tmp/lean-zip-rc2 --passes 1 --profile
```

Populate the detached worktree's ignored `.lake/packages/zipCommon` from its
pinned manifest before the acceptance commands if the dependency is not
already present. This leaves `lean-toolchain` as the only tracked difference.
The source and its pinned `zipCommon` revision compile under rc2. In particular,
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
UInt8.ofNatLT        -- standard generated wrapper with a distinct lookup stem
```

`UInt8.ofNatLT` and `UInt8.ofNat` both declare the raw C symbol
`lean_uint8_of_nat`, but their compiler-generated boxed adapters have different
arities. The initial registration used the shared raw symbol as the lookup stem,
so lookup selected the one-argument `UInt8.ofNat` adapter for the two-argument
proof-bearing call. VIR now registers `UInt8.ofNatLT` under its distinct
compiler-generated `l_UInt8_ofNatLT` stem, matching the existing UInt32, UInt64,
and USize policy. The dedicated dynamic fixture and this acceptance matrix both
exercise the corrected path. No further ByteArray operation or initializer is
missing.

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

The native follow-up for the seven lean-zip accelerators should preserve those
properties while avoiding a VIR source edit per client. One client-native
manifest should name the Lean modules that declare the externs, the extern names
to select, and the C/C++ provider sources. Package generation should use that
same selection to prefer the original extern declaration over an available
`vir_extern_fallback`; wrapper generation should import the named modules and
derive parameter, borrow, result, and symbol metadata from their IR; and the
WASI build should compile the provider sources and strict-link them with the
generated adapters. This lets a project keep one portable fallback annotation
and opt into native execution as a build profile, without handwritten boxed
wrappers or source changes.

The manifest path must remain a closed extension to native lookup. It should
reject unknown or duplicate declarations, collisions with the built-in catalog,
shared lookup stems with incompatible boxed arities, and missing raw provider
symbols. It must not expose general `dlsym`. The current
`VIR_NATIVE_EXTERN_EXTRAS_FILE` experiment covers only wrapper selection for
declarations already imported by VIR and therefore is not yet this client
contract; the module import, package-selection, and provider-source pieces need
to land together before the seven accelerators move off fallback.

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
outputs ranged from 65.51% to 66.95%, depending on level. Observed runs took
136.90–204.46 seconds after setup. These figures include lifting, lowering,
assertions, and large-input scans and are acceptance telemetry, not a
compression throughput benchmark.

Wasm memory started at 145 pages, reached 318 after the larger compression and
prescan cases, then read 344 pages after each of the three matrix passes. The
harness now asserts that every pass after the first retains the first pass's
page count; `--passes 1` is available for a quicker diagnostic run but does not
make this steady-state assertion. This is a bounded repeated-pass result, not a
proof that every corpus has the same high-water mark.

### Scoped upper-level timing

The harness has an opt-in diagnostic path:

```bash
npm run accept:lean-zip -- /path/to/lean-zip --passes 1 --profile
```

It substitutes six direct fixture exports for the larger levels 5 through 10
calls and measures them with the existing `callTimed` execution phase. Each
direct result must still match the public native `deflateRaw` output byte for
byte and independently inflate to the input. Normal acceptance calls do not
read the clock, and the upstream interpreter remains unmodified.

One diagnostic run produced these inclusive execution times. Each cell is one
sample, includes the small export wrapper, and is attribution evidence rather
than a stable benchmark:

| Level | Timed core path | Repeated text, 32 KiB | Heterogeneous, 64 KiB |
| --- | --- | ---: | ---: |
| 5 | `deflateRawL5Adaptive` | 1,541.99 ms | 4,049.72 ms |
| 6 | `deflateRawL6Adaptive` | 1,442.66 ms | 6,288.37 ms |
| 7 | `l7ProfileFor` + `deflateRawL7P` | 947.38 ms | 2,836.30 ms |
| 8 | `deflateRawL8P` | 1,328.32 ms | 4,316.82 ms |
| 9 | `deflateRawL9AdaptiveP` | 2,405.34 ms | 11,057.98 ms |
| 10 | `deflateRawL10P` | 2,463.08 ms | 11,012.17 ms |

On the heterogeneous input, level 9 is 2.56 times the level-8 time, while
level 10 is effectively equal to level 9. This suggests that the common
optimal-path work, rather than only level 10's exact-DP increment, is the first
family to split into finer measurements. Vir still does not expose interpreter
fuel or a general per-declaration sampler through the public runtime; this
fixture-level timing deliberately avoids adding that machinery before it is
needed.

#### Optimal-stage split

Profile mode now also separates the heterogeneous level-9/10 paths into their
packed matcher, base-candidate preparation, and fast or exact optimal candidate.
Packed matcher bytes and optimal DEFLATE bytes are compared with new native
oracle artifacts; base preparation is compared by its candidate byte count.
The VIR-produced packed bytes cross the ordinary `ByteArray` interface before
the base call, so `executeMs` excludes their result lifting and argument
lowering. Both optimal candidates independently raw-inflate to the input.

The final-source diagnostic run produced:

| Level | Whole path | Matcher | Base prep | Optimal candidate | Independent component sum |
| --- | ---: | ---: | ---: | ---: | ---: |
| 9 | 11,057.98 ms | 1,977.73 ms | 1,717.92 ms | 7,734.67 ms fast | 11,430.33 ms (103.4%) |
| 10 | 11,012.17 ms | 2,301.52 ms | 1,311.44 ms | 9,216.23 ms exact | 12,829.19 ms (116.5%) |

Levels 9 and 10 produced the same native/VIR packed matcher stream: 47,840
tokens in 191,360 bytes. Each base preparation selected a 47,405-byte
candidate. The fast and exact optimal candidates were 43,766 and 43,764 bytes
respectively, exactly matching the final public level-9 and level-10 outputs.
The optimal candidate therefore wins both paths and the whole calls do not
force the base emission thunk.

The independently timed components exceed the corresponding whole calls by
3.4% at level 9 and 16.5% at level 10, showing the variance limit of single
inclusive samples. Even with that limit, fast-optimal candidate generation is
70.0% of the level-9 whole and exact-optimal generation is 83.7% of the
level-10 whole; each clearly outweighs its matcher and base-preparation calls.
This supports targeting the optimal parser/emitter family while rejecting a
precise additive allocation from this run.

## Smallest next green slice

The level matrix, current-platform entropy boundary, larger compressible cases,
repeated-pass memory check, and upper-level attribution are green. The next
smallest slice is to separate `lz77OptimalFastIter` / `lz77OptimalIter` parsing
from `emitSharedBlocks` encoding inside the now-dominant optimal candidate.
Broader corpus and cross-platform CI remain necessary before treating the
integration as universal acceptance.
