# Type Anchors

This note documents the small TypeScript-to-Lean VIR descriptor anchor pipeline.
The goal is reviewable, inexact correspondence data, not a complete type
theory for TypeScript.

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
`vir-v1.manifest.json` fixture exists only to keep this first corpus testable
without committing generated package artifacts.

## Output Contract

The pipeline has three public outputs.

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
- `results[].leanDescriptor` and `results[].tsSymbol`, when found.

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

Validate all generated files and the smoke test with:

```bash
npm run check:type-anchors
```
