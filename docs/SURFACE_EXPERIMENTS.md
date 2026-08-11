# Historical Surface Experiments

This page preserves qualitative decision context from early VIR
runtime-frontier studies. The original artifacts were not retained with stable
identities, so rerun the surface and size tools before making a current
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

The original reports were not retained with stable commit and toolchain
identities, so their exact byte and unlock totals are intentionally omitted.
The durable conclusions were:

- `Lean.Expr.eqv` had much greater primary-blocker pressure than exact unlocks;
- small groups such as `USize.toUInt64`, `Bool.toUInt64`, `Void.mk`, and
  `Lean.Level.beq` were cheap when their implementations were already linked;
- string, integer-division, scalar, and ByteArray groups became useful only
  after measuring the complete candidate against one fixed baseline; and
- every accepted comparison reported zero regressions in its selected library
  universe.

## Rejected and consumer-specific work

An early string-alias chain through `String.Internal.getUTF8Byte` and raw
substring helpers had poor cost-to-unlock behavior and was rejected. A later,
narrower measurement became productive after downstream string boundaries had
changed; this is why historical rankings must not be carried forward.

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
