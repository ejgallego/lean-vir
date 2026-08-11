# Binding explorer and shipped JavaScript coverage

The binding explorer is the primary human report for VIR's pre-release library
surface. It combines the exhaustive JavaScript boundary census, colocated
API-group configuration, and available TypeScript-to-Lean comparisons in
one searchable page.

The current report covers 119 ordinary `@[vir_js]` declarations and 13
`@[vir_js_explicit_conversion]` declarations. All 132 distinct targets have a
shipped provider; there are no missing providers and no provider-only targets.
The first complete upstream-surface analysis expands TypeScript's `Document`
inheritance graph to 271 properties and methods. Four members map to VIR's five
shipped Document targets; the remaining 267 are explicit coverage gaps rather
than invisible omissions. All five mapped operations pass their reviewed
type-translation checks.

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
  analyzed, a curated subset was compared, analysis is in progress, analysis
  has not run, or no upstream contract applies;
- **mapping coverage** counts upstream members associated with VIR targets;
- **type fidelity** classifies reviewed mappings as exact, compatible, weak, or
  missing;
- **findings** contain only concrete runtime, coverage, or type-fidelity
  problems. Analysis not run is a state, not a finding.

Therefore visible bindings and “upstream analysis not run” are not
contradictory: the former proves that VIR ships the runtime path, while the
latter says its correspondence with the upstream API has not been evaluated.

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

TypeScript declarations + reviewed API-group intent
  -> generated upstream surface inventory
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

The explorer supports library, upstream-analysis, and finding filters; deep links;
generated upstream TypeScript declarations; inherited-member provenance; Lean
and TypeScript source context; exact elaborated boundary types; side-by-side
semantic descriptors; and light/dark themes. API groups with authored member
mappings show the complete upstream surface and distinguish compatible mapped
members from missing coverage. A `provided` target proves
the representation policy and runtime dispatch path without implying that an
upstream analysis has run.

`docs/bindings/shipped-v1.coverage.json` and
`docs/bindings/shipped-v1.dashboard.html` remain lower-level reconciliation
artifacts while the consolidated view settles. Focused type-anchor HTML files
likewise remain useful for generator debugging, but they are no longer the
main entry point.
