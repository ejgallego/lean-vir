# Binding explorer and shipped JavaScript coverage

The binding explorer is the primary human report for VIR's pre-release library
surface. It combines the exhaustive JavaScript boundary census, colocated
API-group configuration, and available TypeScript-to-Lean comparisons in
one searchable page.

The current report covers 119 ordinary `@[vir_js]` declarations and 13
`@[vir_js_explicit_conversion]` declarations. All 132 distinct targets have a
shipped provider; there are no missing providers and no provider-only targets.
Generation indexes the complete configured TypeScript surface for 20 API
groups before presenting the report. The reviewed `Document` analysis expands
its inheritance graph to 271 properties and methods: four members map to VIR's
five shipped Document targets, and all five mappings pass their reviewed
type-translation checks. The other 19 groups begin with automatic
correspondence suggestions, not reviewed fidelity claims. Across those 20
groups the explorer currently shows four reviewed members, 58 suggested
members, one ambiguous member, and 2,003 upstream entries with no shipped
target. Two local APIs still need a machine-readable upstream contract, and the
React DOM root retains its narrower curated comparison.

## Fidelity Contract

This check makes four mechanically enforceable claims:

1. Every row comes from elaborated declarations and compiled IR metadata, not
   source-text matching.
2. Lean revalidates every complete signature against `Vir.HostValidation`.
   Ordinary `@[vir_js]` declarations may use only `Unit`, JavaScript resources,
   object handles, and resource-shaped callbacks at the boundary.
3. Conversions between JavaScript values and ordinary Lean values must be
   isolated behind `@[vir_js_explicit_conversion]`; they cannot be hidden in an
   ordinary binding.
4. Every declared target must be implemented by a shipped browser/React,
   virtual Node, or runtime-intrinsic provider, and every such provider target
   must have a compiled declaration.

This prevents accidental representation drift such as exposing a raw Lean
`String` where the JavaScript API returns a `Js String`. Ergonomic wrappers may
convert above the boundary, but they do not change the faithful boundary type.

The compiler/runtime check deliberately does not claim that all upstream APIs
have been ported, or that every phantom resource name has been proven equivalent
to an upstream TypeScript type. Configured API groups and type-anchor
comparisons provide that semantic layer. The explorer keeps the layers visibly
distinct while presenting their findings together.

## Terminology and Independent Statuses

An **API group** is the unit presented in the explorer, such as `Document`,
`HTMLCanvasElement`, or timers. The configuration schema retains the historical
`roots` key, but those entries group upstream entry points, public Lean APIs,
and shipped runtime targets; the UI does not call them roots.

The explorer reports independent facts for each API group:

- **runtime coverage** counts shipped targets with providers;
- **upstream analysis** says whether the complete upstream surface has been
  reviewed, automatically indexed, compared as a curated subset, needs a local
  contract as input, or has no upstream contract;
- **mapping coverage** counts upstream members associated with VIR targets;
- **type fidelity** classifies reviewed mappings as exact, compatible, weak, or
  missing;
- **findings** contain only concrete runtime, coverage, or type-fidelity
  problems. An automatic suggestion is evidence for review, not a fidelity
  verdict.

Therefore a green provided target proves that VIR ships the runtime path, while
an automatic correspondence only proposes which upstream declaration to
review. `Complete surface analysis` is reserved for API groups whose mappings
and type translations have been reviewed.

## Library Configuration

Each Lean source group that owns shipped bindings has a companion
`*.bindings.json` file, validated against
`scripts/binding-library.schema.json`:

- `Vir/Browser.bindings.json`
- `Vir/Common.bindings.json`
- `Vir/Js.bindings.json`
- `Vir/React.bindings.json`
- `Vir/Infoview/Surface.bindings.json`
- `Vir/ProofWidgets/Rpc.bindings.json`

A configuration identifies its compiled Lean modules and divides their targets
into API groups. External groups name their declaration files and upstream
entry points; internal groups explicitly state that they have no external
parity contract. Reviewed anchors and dependency policy live with the group
rather than in parallel symbol, policy, and anchor files.

Generation rejects an unowned module, a target assigned to zero or multiple
groups, a stale selector, or a comparison anchor attached to a target outside
its group. The current six configurations assign all 132 shipped targets exactly
once.

## Data Flow

```text
compiled Vir + Vir.Infoview environments
  -> compiler-decoded vir_js metadata
  -> signature and boundary-policy validation

browser/React + virtual Node provider maps
runtime object-handle intrinsic targets
  -> shipped provider inventory

compiler targets + provider targets
  -> strict reconciliation JSON
  -> configured API groups

TypeScript declarations + configured API-group entry points
  -> generated upstream surface inventory
  -> automatic target/member correspondence suggestions

reviewed API-group intent + focused type-anchor comparisons
  -> semantic comparison results

reconciled targets + API groups + comparisons
  -> one machine report
  -> one interactive library explorer
```

Generate the consolidated tracked report with human-readable progress output:

```bash
npm run generate:bindings
```

Validate all layers and the explorer contract with:

```bash
npm run check:bindings
```

The Lean compiler inventory is an ignored intermediate under
`build/type-descriptors/`. The consolidated machine report is
`docs/bindings/report.json`; the primary human report is
`docs/bindings/index.html`.

The explorer supports library, upstream-analysis, and finding filters; deep
links; generated upstream TypeScript declarations; inherited-member
provenance; Lean and TypeScript source context; exact elaborated boundary
types; side-by-side semantic descriptors; and light/dark themes. Generation
expands every configured TypeScript API group before rendering. Authored
mappings distinguish reviewed compatible members from missing coverage;
automatic groups distinguish unique suggestions, ambiguous suggestions, and
unmapped upstream entries.

Use **Upstream libraries** to start from a library contract and inspect VIR's
coverage. Use **VIR targets** for the reverse direction: all 132 low-level
shipped targets, their providers and boundary declarations, and any reviewed or
suggested upstream correspondence. This reverse view is an exhaustive inventory
of the JavaScript boundary, not yet an inventory of public Lean wrappers.
Deriving public-wrapper-to-target reachability requires an additional
compiler-backed call-graph edge; the explorer deliberately does not infer that
edge from source text.

`docs/bindings/shipped-v1.coverage.json` and
`docs/bindings/shipped-v1.dashboard.html` remain lower-level reconciliation
artifacts while the consolidated view settles. Focused type-anchor HTML files
likewise remain useful for generator debugging, but they are no longer the
main entry point.
