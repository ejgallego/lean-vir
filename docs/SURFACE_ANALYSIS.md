# VIR Runnable Surface Analysis

This tool measures which functions in Lean's installed libraries have a
complete static IR dependency closure under VIR's current runtime
capabilities. Its purpose is to answer questions such as: if a runtime change
adds 300 KiB to the Wasm binary, exactly which additional Lean functions and
modules become runnable?

The versioned JSON report is the comparison artifact. The Markdown companion
is a compact human view of the same scan.

## Runnable Definition

For every selected module, the analyzer considers each owned Lean IR function
as a root and follows its transitive IR references. A root is statically
runnable when the walk reaches no unsupported terminal boundary. Cycles with
no unsupported boundary are complete.

The current terminal boundaries are:

- `missingExtern`: an extern is not in VIR's native capability table;
- `missingDecl`: referenced IR is absent from the imported environment; and
- `unsupportedInitGlobal`: an initializer-backed global cannot be reduced to a
  supported initializer dependency.

Registered native externs are supported graph nodes and contribute their
declared runtime dependencies. A `@[vir_js]` extern is treated as a satisfiable
host boundary; whether a particular host supplies it is a separate dynamic
question.

A function can reach several terminal boundaries. The aggregate tables assign
it one deterministic nearest primary blocker so blocker totals do not
double-count roots. Every declaration record includes that blocker and one
representative path to it.

The report also catalogs module-owned extern declarations as native, host, or
missing boundaries and preserves their declared backend targets. These extern
rows explain terminals such as `Lean.Expr.eqv`, but do not enter the function
coverage numerator or denominator: coverage continues to answer how many IR
functions have a complete closure, without counting a boundary twice.

The headline deliberately does not require:

- current `.irpkg` encodability, because VIR owns and can extend that format;
- direct JavaScript callability or a supported public interface type; or
- dynamic semantic validation in the browser runtime.

Those are useful independent axes, but making them gates here would obscure
the runtime-coverage question.

## Function Classes

The primary numerator is **public constants with IR**: non-private function
declarations that also have a Lean environment constant. This excludes boxed
wrappers and compiler-generated helpers from the public headline without
claiming that every remaining constant is an intentionally curated API.

The all-IR numerator also includes private constants, boxed wrappers, and
generated functions. This second view describes how much of the compiler's
actual closure is covered and explains why a single missing boundary can block
many generated declarations.

## Running A Scan

Build the executable and scan all installed `Init`, `Lean`, `Std`, and `Lake`
`.ir` modules:

```bash
lake build vir_surface
.lake/build/bin/vir_surface \
  build/vir-surface/lean-libraries.json \
  build/vir-surface/lean-libraries.md
```

For a fast focused scan, repeat `--module` as needed:

```bash
npm run analyze:surface -- \
  /tmp/lean-meta-basic.json \
  /tmp/lean-meta-basic.md \
  --module Lean.Meta.Basic
```

The executable reports import, analysis, rendering, and write times
separately. A complete report contains hundreds of thousands of declaration
records and representative paths, so its JSON can exceed 100 MiB. Keep normal
outputs under ignored `build/` paths.

Run the focused schema and closure-invariant check with:

```bash
npm run test:surface
```

## Comparing Runtime Experiments

Compare scans from control and candidate worktrees with:

```bash
npm run compare:surface -- \
  /path/to/control.json \
  /path/to/candidate.json \
  build/vir-surface/delta.json \
  build/vir-surface/delta.md
```

The comparator requires the same report version, Lean git hash, selected module
set, and declaration universe. A runtime experiment may change the native
capability registry, but not the Lean library being measured. This strictness
keeps source changes from being misreported as runtime coverage changes.

The delta JSON records the exact newly runnable and regressed declarations,
module/folder/library rollups, native-capability and extern-status transitions, and
blocked functions whose nearest boundary changed. The Markdown companion is a
compact review summary. In particular, a current primary-blocker count is only
an upper bound: satisfying that boundary may reveal another one. Only the A/B
delta's `newlyRunnable` set measures the benefit actually delivered by the
candidate runtime.

For a size experiment, pair this delta with the Wasm size report for the same
control and candidate artifacts. Review the added native capabilities, exact
new function set, module distribution, regressions, and byte increase together;
none of those numbers alone is a sufficient acceptance signal.

## Pricing A Native Frontier

Missing native externs can be priced before changing the checked-in runtime
catalog. The size-cost runner temporarily adds compiler-generated boxed wrappers
and native-registry entries, links the ordinary stripped release Wasm, and skips
only browser package generation:

```bash
npm run analyze:frontier-size -- \
  --surface-links web/dist/surface/data/size-links.json \
  --output-prefix build/frontier-size-costs/float \
  Float.add Float.beq
```

Every command first builds a control, measures each positional name in
isolation, and finally rebuilds the control. It rejects the run if the restored
artifact's SHA-256 differs from the original control. The JSON and Markdown
outputs record exact stripped raw and deterministic gzip deltas. The optional
surface link data adds current primary-blocker pressure as a ranking hint; it
does not turn that upper bound into an unlock count.

Use a version 1 plan to measure interactions or shared retained code directly:

```json
{
  "version": 1,
  "candidates": [
    { "id": "float-core", "names": ["Float.decLt", "Float.add", "Float.beq"] },
    { "id": "float-format", "names": ["Float.toString", "Float32.toString"] }
  ]
}
```

```bash
npm run analyze:frontier-size -- --plan /tmp/frontier-plan.json
```

Costs are not generally additive: linker garbage collection and compression can
make a cluster cheaper or more expensive than the sum of isolated rows. Always
price the proposed cluster itself. These overlays are intended for ordinary
externs whose normal compiler-generated boxed wrapper is the right ABI. A
boundary that needs a handwritten ownership adapter or an erased-proof alias
must first get that separate runtime design.

Measure the matching exact library-surface benefit without editing runtime
policy by repeating `--native-extern` on an otherwise identical scan:

```bash
npm run analyze:surface -- \
  build/vir-surface/float-core.json \
  build/vir-surface/float-core.md \
  --native-extern Float.decLt \
  --native-extern Float.add \
  --native-extern Float.beq
```

Compare that report to the control as described above. This separates the two
questions deliberately: the size runner determines what the boundary retains;
the surface comparator determines what its complete IR closure actually unlocks.

## Reference Experiments

### `Lean.Expr.eqv`

The first end-to-end runtime frontier experiment used Lean 4.33.0-rc2 at
`d8b18978322de05a8f3dba51ef03cf5461676c17`. The control and candidate scanned
the same 2,481 modules and 398,519 IR functions; the candidate added only the
`Lean.Expr.eqv` native capability.

| Measurement | Control | Candidate | Delta |
| --- | ---: | ---: | ---: |
| Stripped release Wasm | 636,299 B | 643,016 B | +6,717 B |
| Gzip-compressed Wasm | 144,777 B | 147,113 B | +2,336 B |
| Runnable public constants | 26,307 / 36,887 | 26,547 / 36,887 | +240 |
| Runnable all-IR functions | 302,887 / 398,519 | 306,491 / 398,519 | +3,604 |
| Regressions | - | - | 0 |

The raw size cost is 6.56 KiB, or about 549 newly runnable IR functions and 37
newly runnable public constants per added KiB. Most of the gain is in
`Lean.Meta` (+1,930 all-IR, +127 public), followed by `Lean.Elab` (+900,
+32) and `Lean.Compiler` (+404, +30).

Before the experiment, `Lean.Expr.eqv` was the primary blocker for 9,803
functions. The exact comparison divided that upper bound into 3,604 real
unlocks and 6,199 functions that reached a newly exposed boundary. The largest
new boundaries include `Lean.Meta.whnf`, `Lean.Meta.inferType`, `Void.mk`,
`USize.toUInt64`, `Lean.Expr.dbgToString`, and `Lean.Level.beq`. This is the
intended use of the comparator: it both values the current runtime addition and
identifies candidates for the next measured experiment.

The candidate links upstream `expr_eq_fn.cpp` and its narrow kernel support
closure. A host-versus-Wasm fixture covers alpha-equivalent binders, mismatches,
nested applications, levels, literals, and syntax-bearing expression metadata.
The complete 83-fixture differential suite and the upstream smoke pass with the
candidate runtime.

### Four Small Native Boundaries

The next experiment added `USize.toUInt64`, `Bool.toUInt64`, `Void.mk`, and
`Lean.Level.beq` on top of the `Lean.Expr.eqv` candidate. It used the same Lean
build, selected modules, and 398,519-function declaration universe.

| Measurement | `Lean.Expr.eqv` checkpoint | Four-boundary candidate | Delta |
| --- | ---: | ---: | ---: |
| Stripped release Wasm | 643,016 B | 643,756 B | +740 B |
| Gzip-compressed Wasm | 147,113 B | 147,317 B | +204 B |
| Runnable public constants | 26,547 / 36,887 | 26,804 / 36,887 | +257 |
| Runnable all-IR functions | 306,491 / 398,519 | 309,411 / 398,519 | +2,920 |
| Regressions | - | - | 0 |

The 740-byte raw increase is 0.72 KiB: about 4,040 newly runnable IR functions
and 356 public constants per added KiB. The exact unlocks grouped by their
previous primary blocker are:

| Boundary | Newly runnable all-IR | Newly runnable public |
| --- | ---: | ---: |
| `USize.toUInt64` | 2,132 | 149 |
| `Lean.Level.beq` | 514 | 71 |
| `Bool.toUInt64` | 268 | 35 |
| `Void.mk` | 6 | 2 |

`Void.mk` illustrates why the upper-bound warning matters: it had 2,704
primary-blocked roots at the checkpoint, but only six became runnable. Most of
the rest advanced to another boundary, led by `Lean.instantiateExprMVarsImp`.
Across all four additions, another 5,066 roots reached a newly exposed blocker.

The gain is concentrated in `Lean.Meta` (+2,070 all-IR, +141 public), including
`Lean.Meta.Tactic.Grind` (+1,094, +66) and `Lean.Meta.Sym` (+590, +35).
`Lean.Compiler` gains another 205 all-IR functions and 36 public constants.
The combined two-step experiment moves the original control from 302,887 to
309,411 runnable IR functions and from 26,307 to 26,804 runnable public
constants for a cumulative 7,457-byte raw increase.

All four raw operations were already available in the selected upstream
runtime closure: three are inline runtime operations and level equality lives
in the already linked `level.cpp`. The size increase is therefore generated
boxed adapters, retained level-equality code, and registry data rather than a
new support module. A host-versus-Wasm fixture checks all four operations; the
complete 84-fixture differential suite and upstream smoke pass with the
candidate runtime.

### Six Already-Linked Primitives

The third experiment added `Lean.Expr.equal`, `String.Internal.get`,
`Int.emod`, `Int.tmod`, `Nat.land`, and `System.Platform.getIsWindows` on top of
the four-boundary candidate. It again used the same Lean build, selected
modules, and 398,519-function declaration universe.

| Measurement | Four-boundary checkpoint | Six-primitive candidate | Delta |
| --- | ---: | ---: | ---: |
| Stripped release Wasm | 643,756 B | 650,910 B | +7,154 B |
| Gzip-compressed Wasm | 147,317 B | 148,103 B | +786 B |
| Runnable public constants | 26,804 / 36,887 | 27,329 / 36,887 | +525 |
| Runnable all-IR functions | 309,411 / 398,519 | 312,344 / 398,519 | +2,933 |
| Regressions | - | - | 0 |

The 7,154-byte raw increase is 6.99 KiB: about 420 newly runnable IR
functions and 75 public constants per added KiB. The exact unlocks grouped by
their previous primary blocker are:

| Boundary | Newly runnable all-IR | Newly runnable public |
| --- | ---: | ---: |
| `Lean.Expr.equal` | 958 | 9 |
| `Nat.land` | 625 | 113 |
| `System.Platform.getIsWindows` | 556 | 183 |
| `Int.emod` | 504 | 129 |
| `String.Internal.get` | 252 | 70 |
| `Int.tmod` | 38 | 21 |

The candidate makes 1,200 Lean, 907 Std, 525 Lake, and 301 Init functions
runnable. The public gain is spread differently: 176 Std, 159 Lake, 122 Init,
and 68 Lean constants. Another 3,062 roots advance to a newly exposed blocker.
The cumulative three-step experiment moves the original control from 302,887
to 312,344 runnable IR functions and from 26,307 to 27,329 runnable public
constants for a cumulative 14,611-byte raw increase.

All six primary implementations are already materialized by the selected
runtime source closure. Five require no further runtime dependency;
`Lean.Expr.equal` additionally activates binder-sensitive upstream equality
code whose narrow `lean_expr_binder_info` dependency is implemented by a
constant-time shim accessor over the same expression representation used by
VIR's constructors. This avoids linking the complete generated `Lean/Expr.c`
module. A host-versus-Wasm fixture checks all six operations.
The complete 85-fixture differential suite and upstream smoke pass with the
candidate runtime.

The resulting frontier also strengthens the next string experiments:
`String.Internal.trim` is the primary blocker for 6,928 functions (947
public), `String.Internal.foldl` for 6,008 (662 public), and
`String.Internal.isPrefixOf` for 1,374 (181 public). `trim` and `isPrefixOf`
share the generated `Init/Data/String/TakeDrop.c` export provider, while
`foldl` uses `Init/Data/String/Iterate.c`; each support-module addition should
be measured as a separate stage.

### String Frontier Chain

The next experiment followed those string boundaries in three measured stages.
The first stage registered `String.Internal.trim` and
`String.Internal.isPrefixOf`; strict linking showed that the complete upstream
implementation closure is `TakeDrop.c`, `Slice.c`, `FindPos.c`, and `Decode.c`.
The second stage registered `String.Internal.foldl` and added `Iterate.c`.
The scan then exposed `String.Internal.isEmpty` as the shared next boundary for
11,756 roots, so a third registry-only stage retained its implementation from
the already linked `Defs.c`.

| Measurement | Linked-primitives control | `trim` + prefix | + `foldl` | + `isEmpty` |
| --- | ---: | ---: | ---: | ---: |
| Stripped release Wasm | 650,910 B | 655,810 B | 656,951 B | 657,138 B |
| Incremental raw cost | - | +4,900 B | +1,141 B | +187 B |
| Gzip-compressed Wasm | 148,103 B | 149,621 B | 150,104 B | 150,091 B |
| Incremental gzip cost | - | +1,518 B | +483 B | -13 B |
| Runnable public constants | 27,329 | 27,333 | 27,333 | 27,636 |
| Incremental public gain | - | +4 | 0 | +303 |
| Runnable all-IR functions | 312,344 | 312,365 | 312,366 | 314,956 |
| Incremental all-IR gain | - | +21 | +1 | +2,590 |
| Regressions | - | 0 | 0 | 0 |

The small negative gzip delta in the final stage is a deterministic compression
interaction; the raw module grows by 187 bytes. Combined, the string frontier
costs 6,228 raw bytes (6.08 KiB) and 1,988 gzip bytes for 2,612 newly runnable
IR functions and 307 public constants: about 429 all-IR functions and 50 public
constants per raw KiB.

The combined exact gain is 1,949 Lean, 345 Std, 241 Lake, and 77 Init
functions. Its public gain is 156 Lean, 95 Std, 35 Lake, and 21 Init constants.
Grouped by each root's original primary blocker, `trim` accounts for 1,413
all-IR functions, `foldl` for 1,127, `isEmpty` for 69, and `isPrefixOf` for 3.
The incremental scans explain the apparent difference: `trim` and `foldl`
mostly advance roots through a chain, and the cheap `isEmpty` boundary closes
enough of that chain to realize the combined payoff.

At this checkpoint, the next string-shaped frontier was
`String.Internal.getUTF8Byte`, then the primary blocker for 1,885 functions and
293 public constants. Its raw symbol was already used by the registered public
`String.getUTF8Byte` boundary, so it was measured as a registry-only follow-up
rather than by adding another generated support module.

### Historical String Alias Experiment

The follow-up measured `String.Internal.getUTF8Byte` first, then followed its
nearest-boundary chain through `Substring.Raw.Internal.drop`,
`Substring.Raw.Internal.all`, and `Substring.Raw.Internal.extract`. The first
two stages reused providers already present in the runtime. The final stage
needed the canonical `Init/Util.c` panic-message provider and its
`Init/Data/Repr.c` dependency because `Substring.Raw.Internal.all` validates
raw substring positions before traversing them.

| Measurement | String-frontier control | + `getUTF8Byte` | + `drop` | + `all` and `extract` |
| --- | ---: | ---: | ---: | ---: |
| Stripped release Wasm | 657,138 B | 657,258 B | 658,712 B | 665,872 B |
| Incremental raw cost | - | +120 B | +1,454 B | +7,160 B |
| Gzip-compressed Wasm | 150,091 B | 150,106 B | 150,422 B | 152,245 B |
| Incremental gzip cost | - | +15 B | +316 B | +1,823 B |
| Runnable public constants | 27,636 | 27,636 | 27,636 | 27,636 |
| Incremental public gain | - | 0 | 0 | 0 |
| Runnable all-IR functions | 314,956 | 314,963 | 314,964 | 314,970 |
| Incremental all-IR gain | - | +7 | +1 | +6 |
| Regressions | - | 0 | 0 | 0 |

The primary-blocker count substantially overstated the delivered value. The
first alias moved 1,878 roots to `Substring.Raw.Internal.drop`. Satisfying
`drop` moved 1,878 roots to `Substring.Raw.Internal.all` and another 21 to
`Substring.Raw.Internal.extract`, while making only one function runnable.
Closing that substring cluster moved the largest chains again, chiefly to
`String.Internal.any` (1,812 roots) and
`Substring.Raw.Internal.front` (1,002 roots).

The complete candidate therefore cost 8,734 raw bytes and 2,154 gzip bytes for
14 newly runnable compiler-generated or private IR functions and no public
constants. The runtime additions were rejected and are not retained. This is a
useful negative result: a cheap alias registration is not automatically a good
frontier when it merely advances a long dependency chain.

That rejection was correct for this earlier runtime boundary. Later scalar,
string, and Float completion closed enough of the downstream chain that a fresh
measurement made the first accessor highly productive. The current checkpoint
below therefore accepts `String.Internal.getUTF8Byte` alone; the larger
substring alias cluster from this historical experiment remains rejected.

### Integer Division Frontier

The next accepted experiment registered the canonical `Int.ediv` and
`Int.tdiv` externs. Both implementations are inline Lean runtime operations:
`Int.ediv` maps to `lean_int_ediv`, while `Int.tdiv` maps to `lean_int_div`.
The candidate therefore keeps the same 51-object source closure as its control;
the linker retains the generated boxed adapters, registry data, and the
previously dead scalar and big-integer division paths from those runtime
objects.

| Measurement | Current `main` control | Integer-division candidate | Delta |
| --- | ---: | ---: | ---: |
| Stripped release Wasm | 657,998 B | 660,433 B | +2,435 B |
| Gzip-compressed Wasm | 150,294 B | 150,929 B | +635 B |
| Runnable public constants | 27,657 / 36,887 | 28,037 / 36,887 | +380 |
| Runnable all-IR functions | 315,063 / 398,519 | 315,915 / 398,519 | +852 |
| Regressions | - | - | 0 |

The 2,435-byte raw increase is 2.38 KiB: about 358 newly runnable IR functions
and 160 public constants per added KiB. `Int.tdiv` accounts for 538 all-IR and
247 public unlocks; `Int.ediv` accounts for 314 and 133. Most of the exact gain
is in `Std` (715 all-IR, 329 public), especially `Std.Time`; `Init` gains 92 and
40, while `Lean` gains 45 and 11. Another 275 roots advance to a different
nearest blocker, led by the `Nat.gcd` boundary.

A host-versus-Wasm fixture covers positive and negative divisors, division by
zero, and both scalar and heap-allocated big integers. The focused differential
fixture and upstream smoke pass with the candidate runtime.

### Scalar And String ABI Completion

The next accepted experiment audited the remaining ordinary fixed-width scalar,
`Nat`, `String`, and `Substring` externs as one provider class, then measured
the numeric and string groups separately. It adds 213 native capabilities on
top of the integer-division checkpoint: 181 scalar and conversion operations,
followed by 32 string and raw-substring operations.

| Measurement | Integer-division control | Scalar/Nat stage | + String/Substring |
| --- | ---: | ---: | ---: |
| Native capabilities | 229 | 410 | 442 |
| Stripped release Wasm | 660,433 B | 694,295 B | 717,818 B |
| Incremental raw cost | - | +33,862 B | +23,523 B |
| Gzip-compressed Wasm | 150,929 B | 157,076 B | 162,440 B |
| Incremental gzip cost | - | +6,147 B | +5,364 B |
| Runnable public constants | 28,037 | 28,562 | 28,878 |
| Incremental public gain | - | +525 | +316 |
| Runnable all-IR functions | 315,915 | 318,033 | 319,711 |
| Incremental all-IR gain | - | +2,118 | +1,678 |
| Regressions | - | 0 | 0 |

Combined, the accepted sweep costs 57,385 raw bytes and 11,511 gzip bytes for
3,796 newly runnable IR functions and 841 public constants. This is about 68
IR functions and 15 public constants per added raw KiB. The string stage alone
is similarly productive: its 32 registrations deliver about 73 IR functions
and 14 public constants per raw KiB. Representative differential fixtures cover
signed fixed-width multiplication and conversion, `Nat.gcd`/`Nat.xor`, Unicode
`String.toList`, capitalization, intercalation, predicates, and raw-substring
extraction. The complete 93-fixture suite and upstream smoke pass.

Most scalar operations use inline implementations or runtime objects already
in the source closure. String completion additionally retains the canonical
`Init/Data/String/Modify.c` and `Init/Data/String/PosRaw.c` providers. Checked
raw-substring operations reach `Init/Util.c` panic construction and its
`Init/Data/Repr.c` dependency. All four providers remain explicit in the
native-support manifest and are subject to final section-level dead stripping.

A broader reconnaissance candidate also registered 101 missing `Float` and
`Float32` operations. The safe surface increment beyond this accepted sweep
was only 620 all-IR functions and 65 public constants, while the survey artifact
(which still contained the eleven proof-bearing registrations discussed below)
grew to 782,433 raw bytes after pulling additional math/runtime code. That
tail is therefore not retained; it needs a narrower basic-arithmetic versus
libm split before another size experiment.

Eleven proof-bearing declarations were also excluded after the contemporary
dynamic fixtures found a callable-arity mismatch between erased interpreted
calls and their ordinary compiler-generated boxed wrappers. A later
reassessment found that current package IR preserves the irrelevant argument
for `String.Internal.getUTF8Byte`, and its ordinary wrapper passes a
host-versus-Wasm fixture. The other ten remain visible as blockers until they
are independently revalidated; native lookup must not infer support merely
from a shared raw symbol.

### Float Frontier Cost Triage

The first pre-policy size scan split that broad Float tail into directly priced
clusters on top of the scalar/string checkpoint. The exact A/B surface reports
use the same Lean revision and 398,519-function universe.

| Candidate | Names | Raw cost | Gzip cost | New all-IR | New public | All-IR / raw KiB |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Arithmetic/model core | 7 | +1,542 B | +320 B | +402 | +21 | 267.0 |
| Broader basic Float set | 15 | +3,310 B | +576 B | +422 | +27 | 130.6 |
| Formatting | 2 | +1,975 B | +404 B | +30 | +7 | 15.6 |
| Broader basic plus formatting | 17 | +5,285 B | +887 B | +468 | +38 | 90.7 |
| `pow` | 2 | +9,789 B | +6,130 B | +6 | +2 | 0.6 |

The seven-name core is `Float.decLt`, `Float.add`, `Float.beq`,
`Float.toModel`, `Float32.ofBits`, `Float32.decLe`, and `Float32.toModel`.
It captures 402 of the broader basic set's 422 all-IR unlocks at less than half
the raw cost. `Float.decLt` accounts for 280 of those exact unlocks; the other
six contribute smaller but still cheap complete closures. The remaining eight
basic operations add only 20 all-IR and 6 public functions for another 1,768
raw bytes, so they should follow only when a concrete runtime workload values
them.

Formatting was retained as a separate stage because it pulls string-formatting
support rather than ordinary arithmetic. The `pow` pair was deferred from the
first stage: its roughly 10 KiB libm closure is manageable in absolute terms but
has a very small library-surface gain. This scan also demonstrates why primary
pressure cannot price benefit by itself. `Float.isInf` was the primary blocker
for 45 roots (17 public), yet adding it within the broad basic cluster made only
one root runnable because the others immediately reached another missing boundary.

The core was subsequently promoted to runtime policy. The final catalog build
is 719,360 raw bytes and 162,763 deterministic gzip bytes: +1,542 raw and +323
gzip over the scalar/string checkpoint. It raises native capabilities from 442
to 449 and exact coverage from 319,711 to 320,113 all-IR functions and from
28,878 to 28,899 public constants, with no regressions. A host-versus-Wasm
fixture dynamically covers addition, equality, strict comparison, 64-bit model
extraction, 32-bit construction from bits, non-strict comparison, and 32-bit
model extraction.

Formatting was then promoted on top of that core. Its directly measured pair
costs 1,975 raw and 463 gzip bytes and raises the catalog from 449 to 451
capabilities. Exact coverage rises by 42 all-IR functions and 9 public constants
to 320,155 and 28,908, with zero regressions; 349 blocked roots move to their
next boundary. The resulting artifact is 721,335 raw and 163,226 gzip bytes. A
host-versus-Wasm fixture hashes the exact concatenated output for positive and
negative `Float` values and a `Float32` constructed from bits.

The final low-cost basic remainder was accepted as one coherent stage after a
fresh post-formatting A/B. The eight names are `Float.isInf`, `Float32.add`,
`Float32.beq`, `Float32.decLt`, `Float32.div`, `Float32.mul`, `Float32.neg`, and
`Float32.sub`. The final catalog adds 1,768 raw and 107 gzip bytes, reaches 459
capabilities, and makes another 24 all-IR functions and 8 public constants
runnable with no regressions. The semantic fixture exercises all eight members
and returns its complete 255-point score.

The deployed measurement plan is now rebased on the 723,223-byte checkpoint:

| Remaining candidate | Names | Raw cost | Gzip cost | Exact surface gain | Current primary pressure |
| --- | ---: | ---: | ---: | ---: | ---: |
| `ByteArray.copySlice` | 1 | +175 B | +74 B | 46 all / 9 public | 123 all / 25 public |
| `pow` | 2 | +9,773 B | +6,508 B | 8 all / 3 public | 8 all / 3 public |

The current artifact is 723,223 raw and 163,519 deterministic gzip bytes, with
321,981 of 398,519 all-IR functions and 29,208 of 36,887 public constants
runnable. It exposes 460 native capabilities. The accepted
`String.Internal.getUTF8Byte` stage accounts for the final 120 raw and 186 gzip
bytes and for 1,802 all-IR and 292 public gains, with no regressions. Its gain
spans `Init`, `Lean`, `Lake`, and `Std`, including 1,097 Lean functions. A
host-versus-Wasm fixture reads all seven bytes of a mixed-width UTF-8 string and
returns the exact weighted score 3,944 through Lean's ordinary generated boxed
wrapper.

`ByteArray.copySlice` is the next measured target. Its implementation is
already retained for another caller, so exposing its generated wrapper costs
175 raw and 74 gzip bytes on the current baseline. A fresh exact A/B scan makes
46 all-IR functions and 9 public constants runnable with no regressions,
notably in `Init.System.IO` and `Std.Http`. The remaining `pow` pair has no
cascade: its eight current primary roots are exactly the eight functions it
makes runnable, and no blocked root moves to a new boundary. It should therefore
be accepted only for a concrete `pow` capability need, not as a
frontier-density optimization.

## Interactive HTML Report

The report generated from `main` is published with the hosted demo:

[VIR runnable-surface report](https://ejgallego.github.io/lean-vir/surface/)

Render any JSON scan as a static browser report:

```bash
npm run render:surface -- \
  build/vir-surface/lean-libraries.json \
  build/vir-surface/html
```

Open `build/vir-surface/html/index.html` directly. The artifact supports both
`file://` browsing and an ordinary static HTTP server; it has no runtime npm or
CDN dependency.

`npm run build:surface-site` performs a fresh complete scan and writes the
deployable report to `web/dist/surface/`. `npm run build:site` runs that step
after the Vite build, so the existing Pages workflow publishes the report and
the demo as one atomic artifact from `main`.

The Pages build then prices the tracked candidates in
`scripts/frontier-size-plan.json`, rerenders the surface report with exact
isolated raw/gzip columns and a directly measured cluster table, and supplies
the same cost artifact to the Wasm size explorer. An extern detail shows every
measured candidate containing that boundary. The size explorer has a dedicated
native-frontier table whose declaration links return to the corresponding
surface entry. These figures are exact for the report's displayed baseline;
they are regenerated after accepted runtime changes rather than carried forward
as stale historical estimates.

The left navigator treats dotted Lean module names as folders and files. Both
folders and modules show a compact progress bar and exact percentage for the
selected public-constant or all-IR metric. A four-band color scale distinguishes
low, developing, strong, and broad coverage; folder tables use the same visual
language alongside exact ratios. The first-class **Top blockers** view ranks
every primary boundary and has a stable `#view=blockers` link. Selecting a
folder shows its immediate subfolders/modules and aggregate counts. Selecting a
module loads only that module's function data,
inserts its extern boundaries in name order, and provides declaration-name,
status, and class filters. The status filter remains selected while navigating
between module pages. Blocked function rows show the primary boundary;
linkable boundaries open their owning extern row and expose the backend target,
blocked-root impact, and representative dependency path. Declaration links use
the `#declaration=...` fragment and can be shared directly. Extern targets also
open the matching backend-symbol search in the deployed Wasm size explorer;
retained symbols link back to these declaration fragments.

The size bridge also carries each extern's deterministic primary-blocker counts.
The size explorer uses those counts only as current frontier pressure. They are
additive across primary blockers, but they remain an upper bound rather than an
unlock forecast; use an A/B surface comparison to measure the exact benefit of
a runtime change. Its wider Lean context also matches installed native function
aliases to exact retained Wasm linker symbols. This refines whole-object
membership into function-level retained coverage without treating native and
Wasm byte sizes as interchangeable. The combined context-color mode displays
both facts at once: green is retained code, orange is frontier pressure, purple
is overlap, and gray is neither. Overlap does not violate the accounting: it
means the native implementation is retained for some other path but the
corresponding Lean declaration is still unavailable through VIR's extern
catalog. The combined-mode sidebar lists these overlap functions directly and
opens their symbol and declaration links. Above the map, total coverage reports
matched native-function bytes against the complete installed native-support
archives, together with sized-function byte and function-count ratios. The
shipped Wasm size remains a separate fact because native and Wasm bytes are
different targets. Hovering a context block updates the compact coverage strip
with the corresponding archive, directory, member, or function metrics.

The generated directory contains a navigation index with the comparatively
small extern catalog plus one compact JavaScript data file per module with
functions. This keeps initial browser load independent of the complete
function count and avoids parsing the full JSON report before the user selects
a module.

## Reading And Comparing Reports

The Markdown and HTML reports provide:

- total public-constant and all-IR coverage;
- top-level `Init`, `Lean`, `Std`, and `Lake` rollups;
- exact per-module counts; and
- top primary blockers with an example dependency path.

The JSON additionally records the Lean toolchain identity, selected modules,
the complete native capability table, and every declaration result. When
evaluating a runtime addition, run the same selected modules in control and
candidate worktrees, verify the toolchain identity matches, then compare
declarations by Lean name. The meaningful benefit is the newly runnable set,
grouped by library/module and blocker removed; a headline percentage alone is
not enough to justify binary growth.

Package encoding, JavaScript interface coverage, and dynamic browser tests can
then be applied to the newly runnable set as follow-up analyses without
changing this report's static runtime definition.
