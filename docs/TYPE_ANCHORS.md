# Type Anchors

This note documents the TypeScript-to-Lean VIR binding pipeline. It provides
both reviewable correspondence data and a deliberately small, fail-closed Lean
source generator; it is not a complete type theory for TypeScript.

The review layer remains useful for the unsupported surface: Codex (or a
person) can propose policy, regenerate the real Lean manifest, and use stable
diagnostic codes to decide what to revise. For supported operations, the source
generator makes the Lean declaration a deterministic function of the pinned
TypeScript declaration, a named library ABI profile, and justified exceptions.
The modality model and operation IR are specified in
`BINDING_MODALITIES.md`.

The exhaustive shipped-boundary gate and consolidated library explorer are
documented in `SHIPPED_BINDINGS.md`. The gate proves that every compiled
`@[vir_js]` and explicit conversion declaration obeys VIR's coarse boundary
policy and has a matching shipped runtime provider key. It does not verify the
provider's implementation behavior. Type anchors add the narrower semantic
question; their results are incorporated into the explorer.

## Data Flow

TypeScript information is generated from declaration files with the TypeScript
compiler API:

```bash
npm run generate:type-descriptors
```

The generator reads `fixtures/type-anchors/vir-v1.types.d.ts`, merges the
manual Lean-to-TypeScript links from
`fixtures/type-anchors/vir-v1.anchors.json`, and writes
`build/type-descriptors/vir-v1.json`.

Each generated symbol records:

- `id`: stable TypeScript symbol id, such as `LeanVir.React.Property`.
- `source`: file path and line range for jump links.
- `display`: compact TypeScript declaration text.
- `hover`: JSDoc text for hovercards or native `title` hovers.
- `shape`: normalized descriptor shape used by the comparator.
- `accessors`: distinct getter and setter shapes for properties. This matters
  for APIs such as `Element.textContent`, whose getter is `string` while its
  setter accepts `string | null`.

The generated descriptor JSON is the TypeScript-side index. For reviewed
generated members, its accessor or function shape is the binding type source
of truth. For report-only members, it remains comparison input and does not by
itself assert a Lean policy.

## Generated Lean Bindings

`Vir/Browser.bindings.json` contains the small amount of policy TypeScript
cannot determine: the generated member set, Lean declaration and host-target
names, a named ABI profile, Lean names for resource marker types, and any
justified semantic exceptions. It does not restate selected TypeScript types or
repeat derived modalities in generated-member anchors.

The initial shipped slice generates `Document.title`, `Element.innerHTML`,
`Element.textContent`, `Element.getAttribute`, and `Element.setAttribute` into
`Vir/Browser/Generated.lean`:

```bash
npm run generate:lean-bindings
npm run check:lean-bindings
```

Generation reads the pinned `lib.dom.d.ts` through the same descriptor code as
the explorer. It first emits canonical operation IR under ignored
`build/bindings/`, then renders the checked-in Lean source and projects the
comparator intent from that same record. TypeScript `string` becomes a
JavaScript string resource, nullable `string` becomes `Js.Nullable String`, and
the ABI profile determines ordinary argument, receiver, result, and effect
modalities. Unsupported shapes, unsafe lifetimes, unmatched exceptions,
mismatched anchors, and stale checked-in output are errors. The generated
module is imported by `Vir.Browser`, so this is the shipped binding surface
rather than a report fixture.

Convenience conversions are intentionally outside this generated faithful
boundary. Callers may use `Lean.Vir.JsValue.ofString`,
`Lean.Vir.JsValue.toString`, and similarly explicit helpers where their own API
policy calls for Lean-owned values.

The comparator reads descriptor JSON and one or more Lean inputs: an interface
manifest or `.irpkg` for package exports, and the compiler-derived shipped
public inventory for library declarations:

```bash
npm run compare:type-anchors
```

For normal package work, pass a real `.irpkg` with
`scripts/bindings/check-type-anchors.mjs --irpkg <package.irpkg>`. Pass
`--inventory build/type-descriptors/vir-js-shipped-v1.lean.json` when anchors
name public declarations shipped by VIR. Each classifiable public entry in that
inventory carries the compiler-derived function interface used for comparison;
unsupported generic entries remain inventoried with `interface: null`.

The local `build/type-descriptors/vir-v1.manifest.json` fixture is generated
from `vir-v1.fixture.lean` through the real package generator. It now supplies
only reviewed shapes that do not have a directly classifiable shipped public
declaration. The manifest, inventory, intermediate `.irpkg`, and generator
report all stay under ignored `build/` paths.

Anchors classify each relation as either `audit` or `coverageGap`. They may
also carry a reviewed `portIntent` object. The first React DOM API-group intent
records decisions that TypeScript cannot express by itself: host-resource
representation, effects, borrowing, result ownership, callback retention, and
lifetime boundaries.

The comparator applies the narrow reviewed conventions it understands before
comparing shapes. In this first slice that includes explicit Lean method and
property receivers, host-resource results, effect annotations, and deliberately
omitted optional parameters. The report records each application as an
informational diagnostic, so intent never becomes an invisible suppression.

Selected TypeScript surfaces can request bounded dependency closure with
`--dependency-depth`. Declarations found in the selected source are included
automatically. A small `--dependency-policy` JSON file supplies reviewed shapes
for external dependencies that should not be expanded, such as browser host
resources or very large recursive library types. The generated descriptor
records every included dependency and any unresolved names.

The descriptor reader also supports ambient declaration libraries such as
TypeScript's `lib.dom.d.ts` and `@types/react`. Interface properties, methods,
and accessors are indexed, inherited members are expanded onto requested entry-point
interfaces with their declaring-interface provenance, and overloads are
retained as alternative callable shapes. The consolidated explorer expands
members for every configured TypeScript API group and groups entry points that
share a declaration source, so a large ambient library is parsed once per
generation group rather than once per configured API group. Where reviewed
mappings do not yet exist, it proposes candidates from owner, member, and
accessor names. These candidates make the audit queue visible; they do not
claim that the Lean and TypeScript types are faithful.

The explorer joins those candidates with compiler-derived Lean call
reachability. For a proposed or reviewed host target, it displays the expected
TypeScript declaration beside the elaborated type of the nearest public Lean
declaration, followed by the private or public implementation boundary. This
makes the inputs to a fidelity review visible without turning an automatic name
match into a structural verdict.

Properties are operation-specific in the explorer. A reviewed mapping records
the getter and setter independently, including their host targets, public Lean
declarations, and anchors. The expected pane renders accessor-shaped
declarations such as `get title(): string` and `set title(value: string)` rather
than showing the same undifferentiated property for both targets. A writable
property must classify both operations; either may be an explicit missing gap
while a binding is under development. Generation rejects a public sibling in
the configured binding namespace that reaches the same accessor without a
distinct upstream operation.

## Artifact Ownership

Authored inputs and shipped generated Lean declarations are checked in.
Descriptor, manifest, report, Markdown, and HTML outputs are reproducible local
artifacts under ignored `build/` paths. Edit the TypeScript/configuration inputs
and regenerate checked-in Lean; never edit generated declarations or report
outputs directly.

| Slice | Authored inputs | Generated outputs |
| --- | --- | --- |
| Shipped generated DOM bindings | `Vir/Browser.bindings.json`, TypeScript's pinned `lib.dom.d.ts` | checked-in `Vir/Browser/Generated.lean`; ignored `build/bindings/browser.generated-operations.json` |
| Core fixture | `fixtures/type-anchors/vir-v1.types.d.ts`, `vir-v1.anchors.json`, `vir-v1.fixture.lean`, `vir-v1.roots.txt`, `vir-v1.aliases.json` | `build/type-descriptors/vir-v1.json`, `vir-v1.manifest.json`, `vir-v1.report.json`; explicit renderer commands may also produce `vir-v1.anchors.md` and `vir-v1.anchors.html` |
| Shipped public Lean surface | Compiled `Vir` and `Vir.Infoview` modules | `build/type-descriptors/vir-js-shipped-v1.lean.json` |
| DOM Document | `Vir/Browser.bindings.json`, TypeScript's pinned `lib.dom.d.ts`, shipped public inventory | `build/type-descriptors/document-v1.json`, `document-v1.report.json` |
| DOM Element | `Vir/Browser.bindings.json`, TypeScript's pinned `lib.dom.d.ts`, shipped public inventory | `build/type-descriptors/element-v1.json`, `element-v1.report.json` |
| React DOM selected symbols | `Vir/React.bindings.json`, pinned `@types/react-dom` declarations | `build/type-descriptors/react-dom-root-v1.json`, `react-dom-root-v1.report.json`; the focused HTML renderer is explicit |

The binding explorer consumes the React DOM comparison alongside the lower-
level shipped census. Its primary outputs are `build/bindings/report.json` and
`build/bindings/index.html`. All binding and type-descriptor outputs are ignored
local artifacts.

## Lower-level Output Contract

The type-anchor pipeline has five lower-level outputs. They remain stable
machine contracts and useful debugging views, while `build/bindings/index.html`
is the primary human entry point.

`vir-js-shipped-v1.lean.json` is the compiler-derived Lean inventory. In
addition to call-reachability evidence, classifiable `publicEntries[]` carry an
`interface` with effect, ordered arguments, result, and nested VIR interface
types. This is the Lean descriptor source for direct shipped-declaration
anchors; the pretty-printed `type` remains human display data.

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
- `results[].modalityContract`, when generated operation IR supplied the
  derived ABI modalities and their provenance;
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

`vir-v1.anchors.md` is an optional rendered documentation fragment. It is not
the source of truth or a default check artifact. An explicit renderer command
can produce it when a Verso/Blueprint or Markdown consumer needs the focused
view.

`vir-v1.anchors.html` is a legacy standalone focused report. It treats the
TypeScript declaration as the primary documentation surface and enriches each
symbol with the Lean declaration, match status, notes, source jump, and hover
text. New binding work should use the consolidated explorer, whose upstream
reference and author actions provide filtering, semantic TypeScript/Lean
highlighting, generated conversion policy, and documentation links. The
focused renderer remains available for fixture-level comparator debugging, but
the default checks exercise its library contract without producing focused
Markdown or HTML files.

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

## React DOM Curated Comparison

This selected-symbol comparison intentionally starts from only seven symbols in
`@types/react-dom/client`: `Root`, `Root.render`, `Root.unmount`, `createRoot`,
`RootOptions`, `hydrateRoot`, and `HydrationOptions`. The first four audit the
existing VIR wrappers. The last three are explicit gaps.

Two levels of bounded closure resolve `Container` through its DOM resource
arms. The report now identifies that VIR accepts the `Element` arm but not the
whole container union, rather than reporting an unresolved name or overstating
coverage. `React.ReactNode` is deliberately represented as the opaque
JavaScript-owned `Js Node` resource at this boundary: expanding its recursive
union would pull most of React's type surface into this seed without improving
boundary faithfulness. The curated comparison audits `Root.renderNode` against
that resource representation; the separate `Root.render` `ReactM` builder is a
reviewed convenience adapter rather than comparison evidence for the upstream
method.

```bash
npm run generate:react-dom-root-type-descriptors
npm run compare:react-dom-root-type-anchors
npm run check:react-dom-root-type-anchors
```

Run `npm run render:react-dom-root-type-anchors` only when debugging the focused
comparison page.

The machine-facing output is
`build/type-descriptors/react-dom-root-v1.report.json`; the review page is
`build/type-descriptors/react-dom-root-v1.anchors.html`.

## DOM Document Audit

The first complete API-group analysis selects `Document` from TypeScript's pinned
`lib.dom.d.ts`, expands all inherited interfaces, and reconciles every member
against the mappings in `Vir/Browser.bindings.json`. Property accessors,
overload selection, JavaScript-resource arguments/results, and omitted optional
parameters are explicit reviewed port intent. The current five shipped
operations compare as compatible; unmapped upstream members remain visible as
coverage gaps in the consolidated explorer.

```bash
npm run generate:document-type-descriptors
npm run compare:document-type-anchors
npm run check:document-type-anchors
```

## DOM Element Audit

The Element API group indexes the complete `Element`, `DOMTokenList`, and
`CSSStyleDeclaration` surfaces. Its first reviewed properties are `innerHTML`
and `textContent`, each mapped as separate getter and setter operations with an
explicit borrowed receiver. `innerHTML` preserves a JavaScript string resource
in both directions. `textContent` preserves the JavaScript string result and
the setter's `string | null` contract through `Js.Nullable String`; assigning
`null` clears the text. The remaining shipped Element targets stay visibly
mapped but awaiting semantic review.

```bash
npm run generate:element-type-descriptors
npm run compare:element-type-anchors
npm run check:element-type-anchors
```

## Verso Fragment

Render the lightweight documentation fragment with:

```bash
npm run render:type-anchors
```

Render the standalone HTML report with:

```bash
npm run render:type-anchors:html
```

The generated `build/type-descriptors/vir-v1.anchors.md` uses Blueprint-style
`:::definition` blocks with `(lean := "...")` associations, TypeScript source
links, and native hover text through `title` plus
`data-vir-type-anchor-hover`. This is intentionally functional without adding a
full Verso/Blueprint site target to this repository.

The generated `build/type-descriptors/vir-v1.anchors.html` remains useful for
testing the focused renderer. Review the real shipped library surface through
`build/bindings/index.html`.

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
