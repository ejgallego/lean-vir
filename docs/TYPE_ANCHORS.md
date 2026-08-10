# Type Anchors

This note documents the small TypeScript-to-Lean VIR descriptor anchor pipeline.
The goal is reviewable, inexact correspondence data, not a complete type
theory for TypeScript.

This is the review layer for a soft porting loop. Codex (or a person) can draft
Lean bindings, regenerate the real Lean manifest, and use the report's stable
diagnostic codes to decide what to revise. It is deliberately not a source-to-
source binding generator yet. Once repeated, reviewed port intents become
stable, a later generator can consume the same descriptor and intent data.

## Data Flow

TypeScript information is generated from declaration files with the TypeScript
compiler API:

```bash
npm run generate:type-descriptors
```

The generator reads `docs/type-descriptors/vir-v1.types.d.ts`, merges the
manual Lean-to-TypeScript links from
`docs/type-descriptors/vir-v1.anchors.json`, and writes
`docs/type-descriptors/vir-v1.json`.

Each generated symbol records:

- `id`: stable TypeScript symbol id, such as `LeanVir.React.Property`.
- `source`: file path and line range for jump links.
- `display`: compact TypeScript declaration text.
- `hover`: JSDoc text for hovercards or native `title` hovers.
- `shape`: normalized descriptor shape used by the comparator.

The generated descriptor JSON is a TypeScript-side index. It does not claim
that the TypeScript declaration is the implementation source of truth. It says:
for this symbol id, this is the authored TypeScript shape, this is where a
reader can jump, and this is the text that should appear in a hover.

The comparator reads descriptor JSON and a Lean VIR interface manifest:

```bash
npm run compare:type-anchors
```

For normal package work, pass a real `.irpkg` with
`scripts/check-type-anchors.mjs --irpkg <package.irpkg>`. The checked-in
`vir-v1.manifest.json` fixture is itself generated from
`vir-v1.fixture.lean` through the real package generator. The intermediate
`.irpkg` and generator report stay under ignored `build/` paths.

Anchors classify each relation as either `audit` or `coverageGap`. They may
also carry a reviewed `portIntent` object. The first React DOM root intent data
records decisions that TypeScript cannot express by itself: host-resource
representation, effects, borrowing, result ownership, callback retention, and
lifetime boundaries.

The comparator applies the narrow reviewed conventions it understands before
comparing shapes. In this first slice that includes explicit Lean method
receivers, host-resource results, effect annotations, and deliberately omitted
optional parameters. The report records each application as an informational
diagnostic, so intent never becomes an invisible suppression.

Selected TypeScript surfaces can request bounded dependency closure with
`--dependency-depth`. Declarations found in the selected source are included
automatically. A small `--dependency-policy` JSON file supplies reviewed shapes
for external dependencies that should not be expanded, such as browser host
resources or very large recursive library types. The generated descriptor
records every included dependency and any unresolved names.

## Output Contract

The pipeline has four public outputs.

`vir-v1.json` is the TypeScript descriptor index. Consumers may rely on:

- `version = 1`;
- `sources`, the declaration files used to generate the index;
- `symbols[]`, keyed by stable `id`;
- `symbols[].source`, for source jumps;
- `symbols[].display` and `symbols[].hover`, for human inspection;
- `symbols[].shape`, for best-effort structural comparison;
- `anchors[]`, the explicit Lean-to-TypeScript relations to check.

`vir-v1.report.json` is the comparison result. Consumers may rely on:

- `summary`, counts by match status;
- `results[]`, one entry per explicit anchor;
- `results[].lean` and `results[].ts`, the compared names;
- `results[].status`, one of `exact`, `compatible`, `weak`, or `missing`;
- `results[].notes`, short explanations for non-exact matches;
- `results[].relation`, either `audit` or `coverageGap`;
- `results[].portIntent`, when the anchor has reviewed binding intent;
- `results[].diagnostics[]`, stable `code`, `severity`, and `message` values;
- `results[].leanDescriptor` and `results[].tsSymbol`, when found.

The top-level `diagnosticSummary` counts `error`, `warning`, and `info`
diagnostics. Missing audited bindings are errors; weak audited comparisons are
warnings; declared coverage gaps are informational. `--fail-on-errors` makes
only error-severity diagnostics fail the command, while `--strict` continues to
reject every weak or missing result.

When descriptor closure is enabled, `typeScriptDependencies` records the root
symbols, included declaration/policy dependencies, closure depth, and unresolved
names in the comparison report.

`vir-v1.anchors.md` is a rendered documentation fragment. It is not the source
of truth. It exists so a Verso/Blueprint document or ordinary Markdown page can
show the same report with usable links and hovers.

`vir-v1.anchors.html` is the standalone human-ready report. It treats the
TypeScript declaration as the primary documentation surface and enriches each
symbol with the Lean declaration, match status, notes, source jump, and hover
text.

## Match Status

The comparator reports four statuses:

- `exact`: the normalized Lean and TypeScript descriptor shapes line up
  directly. This is a statement about this tool's descriptor model, not a proof
  that the runtime representations are identical.
- `compatible`: the shapes differ only by a representation convention that the
  tool knows about, such as Lean exact integers represented by TypeScript
  `string | number | bigint`, or Lean `Unit` represented by TypeScript `void`.
- `weak`: the explicit anchor exists on both sides, but the tool cannot justify
  it structurally. This is still useful as a review pointer, but it should not
  be treated as evidence that the API shapes match.
- `missing`: one side of an explicit anchor was not found. This usually means
  stale anchors, stale descriptor generation, or a package that does not expose
  the expected Lean descriptor.

The status is intentionally not a pass/fail API compatibility verdict. Treat it
as an audit signal:

- `exact` and `compatible` are good enough for lightweight documentation links.
- `weak` should be read manually before publishing an anchor as trustworthy.
- `missing` means the anchor is broken for the compared inputs.

Default checks do not require exact matches. Use `--strict` when a mature anchor
set should reject weak or missing links.

## React DOM Root Seed

The first port-review seed intentionally starts from only seven root symbols in
`@types/react-dom/client`: `Root`, `Root.render`, `Root.unmount`, `createRoot`,
`RootOptions`, `hydrateRoot`, and `HydrationOptions`. The first four audit the
existing VIR wrappers. The last three are explicit gaps.

Two levels of bounded closure resolve `Container` through its DOM resource
arms. The report now identifies that VIR accepts the `Element` arm but not the
whole container union, rather than reporting an unresolved name or overstating
coverage. `React.ReactNode` is deliberately retained as an abstract reviewed
dependency: expanding its recursive union would pull most of React's type
surface into this seed, while VIR currently exposes a separately reviewed
`ReactM (Js Node)` builder representation. Consequently an abstract ReactNode
diagnostic is intentional and distinguishable from an unresolved symbol.

```bash
npm run generate:react-dom-root-type-descriptors
npm run compare:react-dom-root-type-anchors
npm run render:react-dom-root-type-anchors
npm run check:react-dom-root-type-anchors
```

The machine-facing output is
`docs/type-descriptors/react-dom-root-v1.report.json`; the review page is
`docs/type-descriptors/react-dom-root-v1.anchors.html`.

## Verso Fragment

Render the lightweight documentation fragment with:

```bash
npm run render:type-anchors
```

Render the standalone HTML report with:

```bash
npm run render:type-anchors:html
```

The generated `docs/type-descriptors/vir-v1.anchors.md` uses Blueprint-style
`:::definition` blocks with `(lean := "...")` associations, TypeScript source
links, and native hover text through `title` plus
`data-vir-type-anchor-hover`. This is intentionally functional without adding a
full Verso/Blueprint site target to this repository.

The generated `docs/type-descriptors/vir-v1.anchors.html` is the easiest output
to review in a browser today.

Validate the core generated files and comparator smoke test with:

```bash
npm run check:type-anchors
```

Validate the React DOM root seed, including its dependency closure, with:

```bash
npm run check:react-dom-root-type-anchors
```

Both checks reject error-severity diagnostics, such as a missing audited Lean
declaration. Weak mappings remain review warnings and declared coverage gaps
remain informational.
