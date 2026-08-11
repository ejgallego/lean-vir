# Historical Surface Experiments

This page preserves decision context from early VIR runtime-frontier studies.
The figures are snapshots from the stated control artifacts, not estimates for
the current checkout. Rerun the surface and size tools before making a current
decision.

## What the studies established

- Primary-blocker counts are useful for ranking work, but commonly overstate
  exact unlocks because another blocker appears behind the first.
- Raw and gzip costs are properties of a specific linked baseline. They are not
  additive across candidates.
- A small library-wide unlock can still be justified by a concrete application
  closure, as with the geometry operations used by Illuminate.
- Registration is unsafe when the compiled wrapper ABI or closure model does
  not match VIR's interpreted call shape.

## Representative checkpoints

These experiments used the same Lean library universe within each comparison
and reported zero regressions:

| Experiment | Raw Wasm delta | Gzip delta | Newly runnable all IR | Newly runnable public |
| --- | ---: | ---: | ---: | ---: |
| `Lean.Expr.eqv` | +6,717 B | +2,336 B | +3,604 | +240 |
| Four small boundaries | +740 B | +204 B | +2,920 | +257 |
| Six already-linked primitives | +7,154 B | +786 B | +2,933 | +525 |
| String frontier chain | +6,228 B | +1,988 B | +2,612 | +307 |
| Integer division | +2,435 B | +635 B | +852 | +380 |
| Scalar and string completion | +57,385 B | +11,511 B | +3,796 | +841 |
| ByteArray five-binding frontier | +1,304 B | +383 B | +339 | +97 |

The first `Lean.Expr.eqv` study is the clearest example of pressure versus
benefit: 9,803 functions had it as their primary blocker, but 3,604 became
runnable. The rest advanced to another terminal boundary.

The four-boundary follow-up (`USize.toUInt64`, `Bool.toUInt64`, `Void.mk`, and
`Lean.Level.beq`) was unusually efficient because most implementations were
already linked. `Void.mk` alone had substantial primary pressure but unlocked
only six functions, again demonstrating why an A/B comparison is required.

## Rejected and consumer-specific work

An early string-alias chain through `String.Internal.getUTF8Byte` and raw
substring helpers cost +8,734 raw and +2,154 gzip bytes for only 14 all-IR
functions and no public constants. That cluster was rejected. A later, narrower
`String.Internal.getUTF8Byte` measurement became productive after downstream
string boundaries had changed; this is why historical rankings must not be
carried forward.

The broad Float survey was split into smaller groups. Cheap arithmetic/model
operations were accepted independently from formatting and libm. Geometry
operations (`Float.abs`, `sqrt`, `sin`, `cos`, `acos`, and `atan2`) had modest
library-wide gains but were justified by Illuminate's concrete hit-testing
closure. Later `cbrt` and `floor` additions were likewise consumer-driven.

Two tempting registration-only groups initially failed runtime validation.
`UInt8.ofNatLT` was later enabled with a distinct compiler-generated lookup
stem because its raw symbol is shared with `UInt8.ofNat`; its dynamic fixture
now passes. `Char.ofNatAux` still has an indirect-call signature mismatch with
its ordinary boxed wrapper. `Thunk.mk`/`Thunk.get` remain blocked because the
native thunk runtime attempts to invoke a VIR interpreter closure through a
compiled function pointer. Those remaining cases require explicit runtime
design, not merely native-catalog entries.

For current analysis and reproduction commands, see
[SURFACE_ANALYSIS.md](SURFACE_ANALYSIS.md).
