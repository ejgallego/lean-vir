# Binding explorer and shipped JavaScript coverage

The binding explorer is the primary human report for VIR's pre-release library
surface. It combines the exhaustive JavaScript boundary census, colocated
API-group configuration, and available TypeScript-to-Lean comparisons in
one searchable page.

The current report covers 119 ordinary `@[vir_js]` declarations and 13
`@[vir_js_explicit_conversion]` declarations. All 132 distinct targets have a
shipped provider; there are no missing providers and no provider-only targets.
The same compiler scan finds 361 public executable Lean declarations that
reach those targets through 2,884 concrete IR call paths. Every shipped target
is reached by at least one public declaration.
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

This check makes six mechanically enforceable claims:

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
5. Public Lean-to-target links come from transitive references in compiled IR.
   Each link carries its declaration path; the report does not infer callers
   from naming or source text.
6. A reviewed TypeScript property is decomposed into named getter and setter
   operations (getter only for a readonly property). Each operation either
   identifies one host target, one public Lean declaration, and one reviewed
   anchor, or explicitly records a missing coverage gap. Another public
   declaration in the configured binding namespace may not reach that accessor
   target unless it corresponds to a distinct upstream operation.

This prevents accidental representation drift such as exposing a raw Lean
`String` where the JavaScript API returns a `Js String`. Applications may
convert at call sites or in their own policy layer, but the reviewed binding
surface remains one-to-one with the upstream property operations.

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

A **public Lean API** row is a public executable declaration in the measured
`Vir` environment that reaches at least one JavaScript host target. It does not
claim to inventory type-only declarations or pure APIs that never cross the
host boundary. A **host target** is the lower-level dispatch key implemented by
the JavaScript runtime.

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
rather than in parallel symbol, policy, and anchor files. A method mapping
names its target list. A property mapping instead names `get` and `set`
operations, or only `get` for a readonly property, with an exact host target,
public Lean declaration, and comparison anchor for each shipped operation.
An unshipped operation uses an explicit `{ "missing": true, "note": "..." }`
entry, so partial property coverage cannot be mistaken for a faithful pair.

Generation rejects an unowned module, a target assigned to zero or multiple
groups, a stale selector, a property operation that disagrees with its reviewed
anchor, or an unclassified public accessor alias. The current six
configurations assign all 132 shipped targets exactly once.

## Data Flow

```text
compiled Vir + Vir.Infoview environments
  -> compiler-decoded vir_js metadata
  -> signature and boundary-policy validation
  -> public declaration call reachability and exact paths

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

reconciled targets + public call paths + API groups + comparisons
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
coverage. Expanding a mapped upstream entry shows its expected TypeScript
declaration beside the nearest public Lean API type. Use **Public Lean API** for
the reverse product surface: 361 public declarations, their elaborated types,
source locations, nearest upstream expectations, and exact compiler paths to
host targets. Use **Host targets** for all 132 lower-level dispatch keys, their
providers and implementation boundaries. Reviewed mappings prefer the exact
reviewed public declaration; other transitive callers remain available without
being presented as reviewed matches.

`docs/bindings/shipped-v1.coverage.json` and
`docs/bindings/shipped-v1.dashboard.html` remain lower-level reconciliation
artifacts while the consolidated view settles. Focused type-anchor HTML files
likewise remain useful for generator debugging, but they are no longer the
main entry point.
