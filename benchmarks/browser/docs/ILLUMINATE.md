# Illuminate integration

Illuminate is a canonical active example in the browser benchmark catalog. It
compares one player-trace contract across the production JavaScript oracle,
typed VIR, and FIR's zero-import selection runtime.

The artifact set has three independently owned components:

1. Illuminate exports its Lean-compiled animation corpus, production
   JavaScript player helpers, JavaScript trace oracle, and VIR typed-value
   projection.
2. VIR consumes that validated workload package plus exact Illuminate and Lean
   source checkouts. It builds the browser interpreter and a package containing
   only `Illuminate.Animation.Vir.replayTraceTyped`.
3. FIR consumes its pinned Illuminate source revision and exports the verified
   selection player, browser adapter, descriptor, checksums, and package smoke.

The workload and FIR packages may select different exact Illuminate revisions.
Each producer records and validates its own source identity; differential tests
are the compatibility gate between their player contracts.

Run the complete build and differential test with:

```sh
npm run example -- illuminate default --materialize --prepare
```

For prepared exact checkouts, `npm run artifacts:build -- illuminate` builds
the three components and assembles `_artifacts/seed`. The generic pack and fetch
commands then create, verify, and stage `illuminate-player-set-0001`; there is
no Illuminate-specific stager or provenance format.

The quick gate exercises representative animations and trace lengths. FIR's
package-local gate adds a broader differential corpus and a bounded-frontier
stress case. Timing output remains exploratory unless it is collected on a
controlled machine.
